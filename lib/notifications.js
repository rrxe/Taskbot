import { supabase } from './supabase.js'

const TICK_MS = 60 * 1000
const FIRST_TICK_DELAY_MS = 30 * 1000
const PAGE_SIZE = 1000
const SEND_INTERVAL_MS = 40
const REQUEST_TIMEOUT_MS = 10000
const HOUR_MS = 60 * 60 * 1000

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

const REMINDER_INTERVAL_MS = Math.max(0.1, envNumber('NOTIFY_REMINDER_HOURS', 6)) * HOUR_MS
const MAX_REMINDERS = Math.trunc(envNumber('NOTIFY_MAX_REMINDERS', 12))
const LOOKBACK_MS = Math.max(1, envNumber('NOTIFY_LOOKBACK_DAYS', 14)) * 24 * HOUR_MS
const LANG_MODE = String(process.env.NOTIFY_LANG_MODE || 'auto').toLowerCase()

const PLAYER_COLUMNS =
  'telegram_id,first_name,username,language,last_seen_at,notify_last_reminder_at,notify_reminder_count'

const MESSAGES = {
  ar: {
    text: (name) =>
      `👋 <b>اشتقنالك في Easy Gram!</b>\n\n` +
      `صارلك فترة ما فتحت التطبيق. ارجع هسه واكمل مهامك واجمع مكافآت GRAM. 💎\n\n` +
      `ننتظرك ترجع! 🚀`,
    button: 'افتح Easy Gram 🚀',
  },
  en: {
    text: () =>
      `👋 <b>We miss you on Easy Gram!</b>\n\n` +
      `You haven't opened the app in a while. Come back, complete tasks and collect GRAM rewards. 💎\n\n` +
      `We hope to see you again! 🚀`,
    button: 'Open Easy Gram 🚀',
  },
  both: {
    text: () =>
      `👋 <b>اشتقنالك في Easy Gram!</b>\n` +
      `صارلك فترة ما فتحت التطبيق. ارجع وكمل مهامك واجمع مكافآت GRAM. 💎\n\n` +
      `━━━━━━━━━━━━\n\n` +
      `<b>We miss you on Easy Gram!</b>\n` +
      `You haven't opened the app in a while. Come back, complete tasks and collect GRAM rewards. 💎`,
    button: 'افتح Easy Gram | Open 🚀',
  },
}

function getLanguage(player) {
  if (LANG_MODE === 'both') return 'both'
  if (LANG_MODE === 'ar' || LANG_MODE === 'en') return LANG_MODE
  const language = String(player?.language || '').toLowerCase()
  return language === 'ar' ? 'ar' : language === 'en' ? 'en' : 'both'
}

function getWebAppUrl() {
  const configured = String(process.env.WEBAPP_URL || '').trim()
  if (!configured) return ''

  try {
    const url = new URL(configured)
    // Telegram Web App buttons require an HTTPS URL. Do not silently turn this
    // into a normal URL button, because that opens the user's external browser.
    if (url.protocol !== 'https:') {
      console.error('[notifications] WEBAPP_URL must use HTTPS; Mini App button omitted')
      return ''
    }
    return url.toString()
  } catch {
    console.error('[notifications] WEBAPP_URL is invalid; Mini App button omitted')
    return ''
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendTelegramMessage(botToken, player) {
  const language = getLanguage(player)
  const message = MESSAGES[language]
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const webAppUrl = getWebAppUrl()

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: player.telegram_id,
        text: message.text(player.first_name),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(webAppUrl
          ? { reply_markup: { inline_keyboard: [[{ text: message.button, web_app: { url: webAppUrl } }]] } }
          : {}),
      }),
      signal: controller.signal,
    })

    const data = await response.json().catch(() => null)
    if (data?.ok) return { status: 'sent' }

    const code = Number(data?.error_code || response.status)
    const description = String(data?.description || '')
    if (code === 403 || (code === 400 && /chat not found|user is deactivated|peer_id_invalid/i.test(description))) {
      return { status: 'blocked' }
    }
    if (code === 429) {
      return { status: 'transient', retryAfterMs: (Number(data?.parameters?.retry_after) || 5) * 1000 }
    }
    if (code >= 500) return { status: 'transient' }

    console.error('[notifications] Telegram send failed:', code, description)
    return { status: 'failed' }
  } catch (error) {
    return { status: 'transient', error: error?.message }
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchCandidates(threshold, lookback) {
  const all = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('easygram_users')
      .select(PLAYER_COLUMNS)
      .eq('bot_blocked', false)
      .eq('is_banned', false)
      .lte('last_seen_at', threshold)
      .gte('last_seen_at', lookback)
      .or(`notify_last_reminder_at.is.null,notify_last_reminder_at.lte.${threshold}`)
      .order('last_seen_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return all
}

async function reserveReminder(player, nowIso) {
  const count = Number(player.notify_reminder_count || 0)
  let query = supabase
    .from('easygram_users')
    .update({
      notify_last_reminder_at: nowIso,
      notify_reminder_count: count + 1,
    })
    .eq('telegram_id', player.telegram_id)
    .eq('notify_reminder_count', count)
    .eq('last_seen_at', player.last_seen_at)
    .eq('bot_blocked', false)
    .eq('is_banned', false)

  if (player.notify_last_reminder_at) {
    query = query.eq('notify_last_reminder_at', player.notify_last_reminder_at)
  } else {
    query = query.is('notify_last_reminder_at', null)
  }

  const { data, error } = await query.select('telegram_id')
  if (error) {
    console.error('[notifications] reserve failed:', error.message)
    return false
  }
  return Array.isArray(data) && data.length > 0
}

async function releaseReminder(player, nowIso) {
  await supabase
    .from('easygram_users')
    .update({
      notify_last_reminder_at: player.notify_last_reminder_at ?? null,
      notify_reminder_count: Number(player.notify_reminder_count || 0),
    })
    .eq('telegram_id', player.telegram_id)
    .eq('notify_last_reminder_at', nowIso)
    .eq('notify_reminder_count', Number(player.notify_reminder_count || 0) + 1)
}

async function markBlocked(telegramId) {
  const { error } = await supabase
    .from('easygram_users')
    .update({ bot_blocked: true })
    .eq('telegram_id', telegramId)
  if (error) console.error('[notifications] mark blocked failed:', error.message)
}

export async function runNotificationTick(botToken) {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const threshold = new Date(now - REMINDER_INTERVAL_MS).toISOString()
  const lookback = new Date(now - LOOKBACK_MS).toISOString()
  const candidates = await fetchCandidates(threshold, lookback)

  let sent = 0
  let processed = 0

  for (const player of candidates) {
    if (processed >= 3000) break
    const count = Number(player.notify_reminder_count || 0)
    if (MAX_REMINDERS > 0 && count >= MAX_REMINDERS) continue

    if (player.last_seen_at && now - new Date(player.last_seen_at).getTime() < REMINDER_INTERVAL_MS) continue
    if (player.notify_last_reminder_at && now - new Date(player.notify_last_reminder_at).getTime() < REMINDER_INTERVAL_MS) continue
    if (!(await reserveReminder(player, nowIso))) continue

    const result = await sendTelegramMessage(botToken, player)
    if (result.status === 'sent') {
      sent += 1
    } else if (result.status === 'blocked') {
      await markBlocked(player.telegram_id)
    } else if (result.status === 'transient') {
      await releaseReminder(player, nowIso)
      if (result.retryAfterMs) await sleep(result.retryAfterMs)
      break
    }

    processed += 1
    await sleep(SEND_INTERVAL_MS)
  }

  if (sent) console.log(`[notifications] sent reminders=${sent}`)
}

let running = false
let timer = null

function scheduleNext(botToken, delayMs) {
  timer = setTimeout(async () => {
    if (!running) {
      running = true
      try {
        await runNotificationTick(botToken)
      } catch (error) {
        console.error('[notifications] tick failed:', error?.message || error)
      } finally {
        running = false
      }
    }
    scheduleNext(botToken, TICK_MS)
  }, delayMs)
}

export function startNotificationScheduler() {
  if (process.env.NOTIFICATIONS_ENABLED === 'false') {
    console.log('[notifications] disabled by NOTIFICATIONS_ENABLED=false')
    return
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN
  if (!botToken) {
    console.error('[notifications] TELEGRAM_BOT_TOKEN is missing; reminders are disabled')
    return
  }

  if (timer) return
  scheduleNext(botToken, FIRST_TICK_DELAY_MS)
  console.log(
    `[notifications] scheduler started (every ${REMINDER_INTERVAL_MS / HOUR_MS}h, max ${MAX_REMINDERS || 'unlimited'} reminders)`,
  )
}
