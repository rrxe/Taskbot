import { telegramCall, buildMiniAppStartLink } from './telegram.js'
import { supabase } from './supabase.js'

const WEBHOOK_PATH = '/api/telegram/webhook'

export async function setupTelegramWebhook() {
  const webappUrl = process.env.WEBAPP_URL
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!webappUrl || !secret) {
    console.warn('[Easy Gram] WEBAPP_URL or TELEGRAM_WEBHOOK_SECRET is missing; configure the webhook manually.')
    return
  }
  const base = new URL(webappUrl).origin
  const url = `${base}${WEBHOOK_PATH}`
  await telegramCall('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: false,
  })
  await telegramCall('setMyCommands', {
    commands: [
      { command: 'start', description: 'Open Easy Gram' },
      { command: 'help', description: 'Help and support' },
    ],
  })
  console.log(`[Easy Gram] Telegram webhook configured: ${url}`)
}

export async function handleTelegramWebhook(req, res) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ ok: false })
  }

  const message = req.body?.message
  if (!message?.chat?.id || typeof message.text !== 'string') return res.status(200).json({ ok: true })

  const text = message.text.trim()
  const chatId = message.chat.id
  const isStart = /^\/start(?:@\w+)?(?:\s+(.+))?$/i.exec(text)
  const isHelp = /^\/help(?:@\w+)?$/i.test(text)

  if (isStart || isHelp) {
    const payload = isStart?.[1] ? String(isStart[1]).trim().slice(0, 64) : ''
    let appUrl = ''
    try {
      appUrl = await buildMiniAppStartLink(payload || 'home')
    } catch (error) {
      console.warn('[Easy Gram] Could not build Mini App start link:', error?.message || error)
      // Keep a fallback so the user can still open the deployed app if the
      // Telegram bot username is not configured/resolvable.
      appUrl = String(process.env.WEBAPP_URL || '').trim()
    }
    const isArabic = String(message.from?.language_code || '').toLowerCase().startsWith('ar')

    if (isStart && message.chat.type === 'private' && message.from?.id) {
      const { error } = await supabase
        .from('easygram_users')
        .update({
          last_seen_at: new Date().toISOString(),
          notify_last_reminder_at: null,
          notify_reminder_count: 0,
          bot_blocked: false,
        })
        .eq('telegram_id', String(message.from.id))
      if (error) console.warn('[Easy Gram] Could not reset reminder state on /start:', error.message)
    }

    const greeting = isHelp
      ? (isArabic
          ? 'أهلاً بك في Easy Gram. افتح التطبيق لإكمال المهام وجمع مكافآت GRAM وطلب السحب إلى محفظتك.'
          : 'Welcome to Easy Gram. Open the app to complete tasks, collect GRAM and request a wallet payout.')
      : (isArabic
          ? 'أهلاً بك في Easy Gram! 👋\n\nأكمل المهام البسيطة واجمع مكافآت GRAM، وتابع رصيدك وطلبات السحب من داخل التطبيق. 🚀'
          : 'Welcome to Easy Gram! 👋\n\nComplete simple tasks, collect GRAM rewards and manage your balance and withdrawals directly in the app. 🚀')

    const keyboard = appUrl
      ? { inline_keyboard: [[{ text: isArabic ? 'افتح Easy Gram 🚀' : 'Open Easy Gram 🚀', url: appUrl }]] }
      : undefined

    try {
      await telegramCall('sendMessage', {
        chat_id: chatId,
        text: greeting,
        reply_markup: keyboard,
        disable_web_page_preview: true,
      })
    } catch (error) {
      console.error('[Easy Gram] Start message failed:', error?.message || error)
    }
  }

  return res.status(200).json({ ok: true })
}
