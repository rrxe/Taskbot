import { authenticateRequest } from '../lib/telegram-auth.js'
import { supabase } from '../lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = authenticateRequest(req)
  if (!auth) return res.status(401).json({ error: 'Telegram authentication failed.' })

  try {
    const { data, error } = await supabase
      .from('easygram_users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('telegram_id', auth.id)
      .eq('is_banned', false)
      .select('telegram_id')
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(403).json({ error: 'This account is suspended or unavailable.' })
    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('[Easy Gram] presence:', error?.message || error)
    return res.status(500).json({ error: 'Could not update member presence.' })
  }
}
