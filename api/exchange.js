import { authenticateRequest } from '../lib/telegram-auth.js'
import { supabase } from '../lib/supabase.js'
import { getAppSettings } from '../lib/settings.js'
import { requireRequiredMembership, requireActiveUser } from '../lib/required-channels.js'

export default async function handler(req, res) {
  const auth = authenticateRequest(req)
  if (!auth) return res.status(401).json({ error: 'Open Easy Gram inside Telegram.' })
  const activeUser = await requireActiveUser(auth.id, res)
  if (!activeUser) return
  const membershipAllowed = await requireRequiredMembership(auth.id, res)
  if (!membershipAllowed) return

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const settings = await getAppSettings()
    if (settings.maintenance_mode) return res.status(503).json({ error: 'Easy Gram is under maintenance.' })

    const amountCoins = Number(req.body?.amountCoins)
    const adSessionId = String(req.body?.adSessionId || '')
    if (!Number.isSafeInteger(amountCoins) || amountCoins < Number(settings.min_exchange_coins || 1000)) {
      return res.status(400).json({ error: `Minimum exchange is ${Number(settings.min_exchange_coins || 1000).toLocaleString()} Coins.` })
    }
    if (!/^[0-9a-f-]{36}$/i.test(adSessionId)) {
      return res.status(400).json({ error: 'A verified AdsGram exchange ad is required.' })
    }

    const { data, error } = await supabase.rpc('easygram_exchange_coins_for_usdt', {
      p_telegram_id: auth.id,
      p_amount_coins: amountCoins,
      p_ad_session_id: adSessionId,
    })
    if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883'
      if (missing) return res.status(503).json({ error: 'Coins/USDT SQL migration is missing. Run easygram_coins_usdt_migration.sql in the EasyGram Supabase project.' })
      const message = String(error.message || 'Exchange failed').replace(/^.*ERROR:\s*/i, '').trim()
      return res.status(400).json({ error: message })
    }
    const result = Array.isArray(data) ? data[0] : data
    return res.status(200).json({
      success: true,
      coinBalance: Number(result?.coin_balance || 0),
      usdtBalance: Number(result?.usdt_balance || 0),
      usdtGained: Number(result?.usdt_gained || 0),
    })
  } catch (error) {
    console.error('[Easy Gram] exchange:', error)
    return res.status(500).json({ error: 'Could not exchange Coins. Please try again.' })
  }
}
