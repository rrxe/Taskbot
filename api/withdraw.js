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

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('easygram_usdt_withdrawals')
        .select('id,amount_usdt,method,target,status,created_at,updated_at,admin_note')
        .eq('telegram_id', auth.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return res.status(200).json({ success: true, withdrawals: data || [] })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const settings = await getAppSettings()
    if (settings.maintenance_mode) return res.status(503).json({ error: 'Easy Gram is under maintenance.' })
    if (!settings.gram_withdrawals_enabled) return res.status(403).json({ error: 'USDT withdrawals are temporarily disabled.' })
    const amount = Number(req.body?.amount)
    const method = String(req.body?.method || '')
    const target = String(req.body?.target || '').trim()
    if (!Number.isFinite(amount) || amount < Number(settings.min_withdrawal_usdt) || amount > Number(settings.max_withdrawal_usdt)) {
      return res.status(400).json({ error: `Withdrawal amount must be between ${settings.min_withdrawal_usdt} and ${settings.max_withdrawal_usdt} USDT.` })
    }
    if (!['binance', 'gram'].includes(method)) return res.status(400).json({ error: 'Choose Binance or GRAM.' })
    if (target.length < 6 || target.length > 160) return res.status(400).json({ error: method === 'binance' ? 'Enter your Binance ID.' : 'Enter a valid GRAM / TON wallet address.' })

    const { data, error } = await supabase.rpc('easygram_submit_usdt_withdrawal', {
      p_telegram_id: auth.id,
      p_amount_usdt: amount,
      p_method: method,
      p_target: target,
    })
    if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883'
      if (missing) return res.status(503).json({ error: 'Coins/USDT SQL migration is missing. Run easygram_coins_usdt_migration.sql in the EasyGram Supabase project.' })
      const message = String(error.message || 'Withdrawal failed').replace(/^.*ERROR:\s*/i, '').trim()
      return res.status(400).json({ error: message })
    }
    const withdrawal = Array.isArray(data) ? data[0] : data
    return res.status(200).json({ success: true, withdrawal })
  } catch (error) {
    console.error('[Easy Gram] USDT withdraw:', error)
    return res.status(500).json({ error: 'Could not submit your USDT withdrawal. Please try again.' })
  }
}
