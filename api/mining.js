import { authenticateRequest } from '../lib/telegram-auth.js'
import { supabase } from '../lib/supabase.js'
import { getAppSettings } from '../lib/settings.js'
import { requireRequiredMembership, requireActiveUser } from '../lib/required-channels.js'

function cleanRpcError(error, fallback) {
  const message = String(error?.message || fallback).replace(/^.*ERROR:\s*/i, '').trim()
  if (error?.code === '42P01' || error?.code === '42703') {
    return 'The mining database update is missing. Run EasyGram_SLY_AdsMining_AllInOne.sql and easygram_coins_usdt_migration.sql in the Easy GRAM Supabase project, then try again.'
  }
  return message || fallback
}

export default async function handler(req, res) {
  const auth = authenticateRequest(req)
  if (!auth) return res.status(401).json({ error: 'Telegram authentication failed. Reopen the Mini App from your Easy Gram bot.' })
  const activeUser = await requireActiveUser(auth.id, res)
  if (!activeUser) return

  try {
    const allowed = await requireRequiredMembership(auth.id, res)
    if (!allowed) return

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('easygram_mining_sessions')
        .select('id,started_at,ends_at,rate_per_hour,duration_hours,claimed_at,reward_gram')
        .eq('telegram_id', auth.id)
        .is('claimed_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return res.status(200).json({ success: true, session: data || null })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const action = String(req.body?.action || '')
    if (action !== 'start' && action !== 'claim') return res.status(400).json({ error: 'Unknown mining action.' })

    const settings = await getAppSettings()
    if (settings.maintenance_mode) return res.status(503).json({ error: 'Easy Gram is under maintenance.' })
    const adSessionId = String(req.body?.adSessionId || '')
    if (!/^[0-9a-f-]{36}$/i.test(adSessionId)) {
      return res.status(400).json({ error: 'A verified AdsGram session is required for this mining action.' })
    }

    // Fast feedback before the RPC. The SQL functions repeat these checks while
    // holding row locks, so concurrent clicks cannot consume the same ad twice.
    const { data: activeSession, error: activeError } = await supabase
      .from('easygram_mining_sessions')
      .select('id,ends_at')
      .eq('telegram_id', auth.id)
      .is('claimed_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (activeError) throw activeError
    if (action === 'start' && activeSession) {
      return res.status(409).json({ error: 'You already have an active mining session. Claim it when it finishes.' })
    }
    if (action === 'claim' && (!activeSession || Date.now() < Date.parse(activeSession.ends_at))) {
      return res.status(409).json({ error: 'Your mining session is not ready to claim yet.' })
    }

    const functionName = action === 'start' ? 'easygram_start_mining_with_ad' : 'easygram_claim_mining_with_ad'
    const rpcResult = action === 'start'
      ? await supabase.rpc(functionName, {
        p_telegram_id: auth.id,
        p_rate_per_hour: Number(settings.mining_rate_per_hour_coins),
        p_duration_hours: Number(settings.mining_duration_hours),
        p_ad_session_id: adSessionId,
      })
      : await supabase.rpc(functionName, {
        p_telegram_id: auth.id,
        p_ad_session_id: adSessionId,
      })

    const data = rpcResult.data
    if (rpcResult.error) {
      const rpcMessage = String(rpcResult.error.message || '').toLowerCase()
      const missingAdRpc = rpcResult.error.code === 'PGRST202' || (
        rpcMessage.includes(functionName.toLowerCase()) &&
        (rpcMessage.includes('function') || rpcMessage.includes('schema cache') || rpcMessage.includes('not found'))
      )
      if (missingAdRpc) {
        console.error(`[Easy Gram] missing ${functionName}; apply EasyGram_SLY_AdsMining_AllInOne.sql`, rpcResult.error)
        return res.status(503).json({
          error: `The ${functionName} database function is missing. Run EasyGram_SLY_AdsMining_AllInOne.sql and easygram_coins_usdt_migration.sql in the Easy GRAM Supabase project, then retry. Your verified ad has not been consumed.`,
        })
      }
      return res.status(400).json({ error: cleanRpcError(rpcResult.error, 'Could not complete the mining action.') })
    }

    const result = Array.isArray(data) ? data[0] : data
    if (action === 'start') {
      return res.status(200).json({ success: true, session: result || null })
    }
    return res.status(200).json({
      success: true,
      rewardCoins: Number(result?.reward_gram || 0),
      coinBalance: Number(result?.balance_gram || 0),
    })
  } catch (error) {
    console.error('[Easy Gram] mining:', error)
    const status = Number(error?.status) || (error?.code === '42P01' || error?.code === '42703' ? 503 : 500)
    return res.status(status).json({ error: cleanRpcError(error, 'Mining request failed. Please try again.') })
  }
}
