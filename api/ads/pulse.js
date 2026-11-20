import { authenticateRequest } from '../../lib/telegram-auth.js'
import { supabase } from '../../lib/supabase.js'
import { getAppSettings } from '../../lib/settings.js'
import { requireRequiredMembership, requireActiveUser } from '../../lib/required-channels.js'

const MIN_SERVER_ELAPSED_MS = 4500
const MIN_WATCH_MS = 4500
const MAX_SESSION_AGE_MS = 10 * 60 * 1000
const VALID_PLACEMENTS = new Set(['task', 'withdrawal', 'mining_start', 'mining_claim', 'exchange', 'game_attempt'])

function isMissingConfirmRpc(error) {
  const message = String(error?.message || '').toLowerCase()
  return error?.code === 'PGRST202' || (
    message.includes('easygram_confirm_ad_session') &&
    (message.includes('function') || message.includes('schema cache') || message.includes('not found'))
  )
}

function publicError(error) {
  const message = String(error?.message || '').replace(/^.*ERROR:\s*/i, '').trim()
  if (error?.code === '23514' && message.toLowerCase().includes('placement')) {
    return 'AdsGram database setup is incomplete: the ad placement constraint must allow task, withdrawal, mining_start, mining_claim, exchange, and game_attempt. Run easygram_coins_usdt_migration.sql and easygram_arcade_expansion_migration.sql.'
  }
  if (error?.code === '42P01' || error?.code === '42703') {
    return `AdsGram database setup is incomplete (${error.code}): ${message || 'required table or column is missing'}. Run easygram_coins_usdt_migration.sql and easygram_arcade_expansion_migration.sql.`
  }
  if (error?.code === 'PGRST202') {
    return 'Supabase cannot find the required ad confirmation function yet. Run the Easy Gram ad migrations and easygram_arcade_expansion_migration.sql, then reload the Supabase API schema.'
  }
  // Keep actionable Postgres/Supabase diagnostics visible; never return tokens or request headers.
  return message ? `${message}${error?.code ? ` [${error.code}]` : ''}` : 'Could not verify this ad. Please try again.'
}

async function confirmWithLegacyQueries({ sessionId, telegramId, placement, awayMs, pulseAway }) {
  const { data: session, error: readError } = await supabase
    .from('easygram_ad_sessions')
    .select('id,placement,started_at,confirmed_at,used_at')
    .eq('id', sessionId)
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (readError) throw readError
  if (!session || session.placement !== placement || session.used_at) {
    throw Object.assign(new Error('This ad session is invalid or has already been used.'), { status: 409 })
  }

  // A retry after a successful confirmation is idempotent. In particular, it
  // must not increment the withdrawal counter for the same ad a second time.
  if (session.confirmed_at) {
    let withdrawalAdsWatched = null
    if (placement === 'withdrawal') {
      const { data: user, error: userError } = await supabase
        .from('easygram_users')
        .select('withdrawal_ads_watched')
        .eq('telegram_id', telegramId)
        .maybeSingle()
      if (userError) throw userError
      withdrawalAdsWatched = Number(user?.withdrawal_ads_watched || 0)
    }
    return { withdrawalAdsWatched }
  }

  const elapsed = Date.now() - Date.parse(session.started_at)
  if (!Number.isFinite(elapsed) || elapsed < MIN_SERVER_ELAPSED_MS || elapsed > MAX_SESSION_AGE_MS) {
    throw Object.assign(new Error('Ad session expired. Please watch another ad.'), { status: 400 })
  }

  const confirmedAt = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('easygram_ad_sessions')
    .update({ confirmed_at: confirmedAt, pulse_away: pulseAway === true, away_ms: Math.trunc(awayMs) })
    .eq('id', sessionId)
    .eq('telegram_id', telegramId)
    .is('confirmed_at', null)
    .is('used_at', null)
    .select('id')
    .maybeSingle()
  if (updateError) throw updateError
  if (!updated) throw Object.assign(new Error('This ad was already confirmed or used.'), { status: 409 })

  let withdrawalAdsWatched = null
  if (placement === 'withdrawal') {
    const { data: newCount, error: countError } = await supabase.rpc('easygram_increment_withdrawal_ads', { p_telegram_id: telegramId })
    if (countError) {
      // Old databases may not have the atomic confirmation RPC yet. Roll back
      // the confirmation if the legacy counter update fails so this ad can be
      // retried instead of being permanently lost.
      const { error: rollbackError } = await supabase
        .from('easygram_ad_sessions')
        .update({ confirmed_at: null, pulse_away: false, away_ms: 0 })
        .eq('id', sessionId)
        .eq('telegram_id', telegramId)
        .eq('confirmed_at', confirmedAt)
        .is('used_at', null)
      if (rollbackError) console.error('[Easy Gram] ad confirmation rollback:', rollbackError)
      throw countError
    }
    withdrawalAdsWatched = Number(newCount || 0)
  }
  return { withdrawalAdsWatched }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = authenticateRequest(req)
  if (!auth) return res.status(401).json({ error: 'Open Easy Gram inside Telegram.' })
  const activeUser = await requireActiveUser(auth.id, res)
  if (!activeUser) return
  const membershipAllowed = await requireRequiredMembership(auth.id, res)
  if (!membershipAllowed) return

  try {
    const settings = await getAppSettings()
    if (settings.maintenance_mode) return res.status(503).json({ error: 'Easy Gram is under maintenance.' })
    const { action, placement } = req.body || {}
    if (!VALID_PLACEMENTS.has(String(placement || ''))) {
      return res.status(400).json({ error: 'Invalid ad placement.' })
    }

    if (action === 'begin') {
      const { data: last, error: lastError } = await supabase
        .from('easygram_ad_sessions')
        .select('confirmed_at')
        .eq('telegram_id', auth.id)
        .not('confirmed_at', 'is', null)
        .order('confirmed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastError) throw lastError
      if (last?.confirmed_at) {
        const cooldownMs = Math.max(0, Number(settings.ad_cooldown_seconds) || 15) * 1000
        const left = Math.ceil((cooldownMs - (Date.now() - Date.parse(last.confirmed_at))) / 1000)
        if (left > 0) return res.status(429).json({ error: `Please wait ${left} seconds before the next ad.`, waitSeconds: left })
      }

      const blockId = String(settings.adsgram_reward_block || '').trim()
      if (!/^int-\d+$/.test(blockId)) {
        return res.status(503).json({ error: 'The AdsGram reward block is not configured correctly. Set an active INT block in Admin → Settings.' })
      }

      const { data: session, error } = await supabase
        .from('easygram_ad_sessions')
        .insert({ telegram_id: auth.id, placement, block_id: blockId, started_at: new Date().toISOString() })
        .select('id,started_at')
        .single()
      if (error) throw error
      return res.status(200).json({ success: true, sessionId: session.id, blockId, startedAt: session.started_at })
    }

    if (action === 'cancel') {
      const sessionId = String(req.body.sessionId || '')
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return res.status(400).json({ error: 'Invalid ad session.' })
      const { data: cancelled, error: cancelError } = await supabase
        .from('easygram_ad_sessions')
        .update({ used_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('telegram_id', auth.id)
        .eq('placement', placement)
        .is('confirmed_at', null)
        .is('used_at', null)
        .select('id')
        .maybeSingle()
      if (cancelError) throw cancelError
      return res.status(200).json({ success: true, cancelled: Boolean(cancelled) })
    }

    if (action === 'confirm') {
      const sessionId = String(req.body.sessionId || '')
      const awayMs = Number(req.body.awayMs)
      const pulseAway = req.body.pulseAway === true
      if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !Number.isFinite(awayMs) || awayMs < MIN_WATCH_MS) {
        return res.status(400).json({ error: 'Watch the ad for at least 5 seconds, then return to Easy Gram.' })
      }

      const rpcResult = await supabase.rpc('easygram_confirm_ad_session', {
        p_session_id: sessionId,
        p_telegram_id: auth.id,
        p_placement: placement,
        p_away_ms: Math.trunc(awayMs),
        p_pulse_away: pulseAway,
      })

      let result
      if (rpcResult.error && isMissingConfirmRpc(rpcResult.error)) {
        result = await confirmWithLegacyQueries({ sessionId, telegramId: auth.id, placement, awayMs, pulseAway })
      } else if (rpcResult.error) {
        const message = String(rpcResult.error.message || 'Ad confirmation failed').replace(/^.*ERROR:\s*/i, '')
        const status = message.includes('already') || message.includes('invalid') ? 409 : 400
        return res.status(status).json({ error: message })
      } else {
        const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data
        result = { withdrawalAdsWatched: row?.withdrawal_ads_watched == null ? null : Number(row.withdrawal_ads_watched) }
      }

      return res.status(200).json({ success: true, sessionId, withdrawalAdsWatched: result.withdrawalAdsWatched })
    }

    return res.status(400).json({ error: 'Unknown ad action.' })
  } catch (error) {
    console.error('[Easy Gram] ad pulse:', error)
    return res.status(Number(error?.status) || 500).json({ error: publicError(error) })
  }
}
