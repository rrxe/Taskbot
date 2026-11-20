import { authenticateRequest } from '../lib/telegram-auth.js'
import { getRequiredChannelStatus } from '../lib/required-channels.js'

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  const auth = authenticateRequest(req)
  if (!auth) return res.status(401).json({ error: 'Telegram authentication failed. Reopen the Mini App from your Easy Gram bot.' })
  try {
    const subscription = await getRequiredChannelStatus(auth.id, { force: req.method === 'POST' })
    return res.status(200).json({ success: true, subscription })
  } catch (error) {
    console.error('[Easy Gram] subscription check:', error)
    return res.status(500).json({ error: 'Could not check required channel membership.' })
  }
}
