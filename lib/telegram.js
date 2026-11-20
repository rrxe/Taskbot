export async function telegramCall(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured')
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) {
    throw new Error(data.description || `Telegram API error: ${response.status}`)
  }
  return data.result
}

let cachedBotUsername = ''
let cachedBotUsernameAt = 0

export async function getBotUsername() {
  const configured = String(process.env.BOT_USERNAME || '').replace(/^@/, '').trim()
  if (configured && !/^your[_-]?easygram[_-]?bot$/i.test(configured)) return configured
  if (cachedBotUsername && Date.now() - cachedBotUsernameAt < 60 * 60 * 1000) return cachedBotUsername
  const me = await telegramCall('getMe', {})
  cachedBotUsername = String(me?.username || '').replace(/^@/, '').trim()
  cachedBotUsernameAt = Date.now()
  return cachedBotUsername
}

export async function buildMiniAppStartLink(startParam = 'home') {
  const username = await getBotUsername()
  if (!username) return ''
  const shortName = String(process.env.BOT_APP_SHORT_NAME || '').trim().replace(/^\/+|\/+$/g, '')
  if (shortName && !/^[A-Za-z0-9_-]{1,64}$/.test(shortName)) {
    throw new Error('BOT_APP_SHORT_NAME must contain only letters, numbers, underscores or hyphens.')
  }
  const appPath = shortName ? `/${shortName}` : ''
  const safeParam = String(startParam || 'home').trim().slice(0, 64)
  return `https://t.me/${username}${appPath}?startapp=${encodeURIComponent(safeParam)}`
}

// Referral URLs deliberately open the bot chat first. Telegram then delivers
// /start ref_<id> to the bot, allowing it to send the welcome message before
// the user opens the Mini App from the button in that message.
export async function buildReferralStartLink(telegramId) {
  const username = await getBotUsername()
  if (!username) return ''
  const id = String(telegramId || '').trim()
  if (!/^\d+$/.test(id)) throw new Error('Invalid Telegram referral ID.')
  return `https://t.me/${username}?start=ref_${encodeURIComponent(id)}`
}

export async function sendUserNotice(telegramId, text) {
  try {
    await telegramCall('sendMessage', { chat_id: telegramId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  } catch (error) {
    console.warn('[Easy Gram] Could not send Telegram notice:', error?.message || error)
  }
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}
