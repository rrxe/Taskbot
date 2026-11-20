import crypto from 'node:crypto'

function getBotToken() {
  // Accept both names: TELEGRAM_BOT_TOKEN is preferred; BOT_TOKEN is kept
  // for compatibility with older SLY/Dokploy deployments.
  return String(process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim()
}

export function verifyTelegramInitData(initData) {
  if (!initData || typeof initData !== 'string') {
    console.warn('[Easy Gram auth] Telegram initData is missing.')
    return null
  }

  const token = getBotToken()
  if (!token) {
    console.error('[Easy Gram auth] Missing TELEGRAM_BOT_TOKEN (or BOT_TOKEN fallback).')
    return null
  }

  try {
    const params = new URLSearchParams(initData)
    const receivedHash = String(params.get('hash') || '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(receivedHash)) {
      console.warn('[Easy Gram auth] Missing or malformed Telegram hash.')
      return null
    }
    params.delete('hash')

    // Keep the exact check-string construction used by the supplied SLY
    // project: build key=value pairs, sort the complete pairs, then join.
    // This is compatible with Telegram's documented WebApp validation data.
    const pairs = [...params.entries()].map(([key, value]) => `${key}=${value}`)
    pairs.sort()
    const checkString = pairs.join('\n')
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
    const expectedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest()
    const providedHash = Buffer.from(receivedHash, 'hex')
    if (providedHash.length !== expectedHash.length || !crypto.timingSafeEqual(providedHash, expectedHash)) {
      console.warn('[Easy Gram auth] Telegram hash mismatch. Check that the bot token belongs to this Mini App bot.')
      return null
    }

    const authDate = Number(params.get('auth_date') || 0)
    const now = Math.floor(Date.now() / 1000)
    const configuredAge = Number(process.env.TELEGRAM_INITDATA_MAX_AGE_SECONDS || 86400)
    const maxAge = Number.isFinite(configuredAge) ? Math.max(300, Math.min(configuredAge, 604800)) : 86400
    if (!authDate || authDate > now + 60 || now - authDate > maxAge) {
      console.warn('[Easy Gram auth] Telegram initData is expired or has an invalid auth_date.')
      return null
    }

    const userJson = params.get('user')
    if (!userJson) {
      console.warn('[Easy Gram auth] Telegram initData does not include a user.')
      return null
    }
    const user = JSON.parse(userJson)
    if (!user?.id || !/^\d+$/.test(String(user.id))) return null

    return {
      id: String(user.id),
      username: user.username || null,
      firstName: user.first_name || 'Gram User',
      lastName: user.last_name || null,
      photoUrl: user.photo_url || null,
      languageCode: user.language_code || null,
      startParam: params.get('start_param') || null,
    }
  } catch (error) {
    console.warn('[Easy Gram auth] Could not validate Telegram initData:', error?.message || error)
    return null
  }
}

export function getInitDataFromRequest(req) {
  const authorization = req.headers.authorization || req.headers.Authorization || ''
  if (typeof authorization === 'string' && authorization.startsWith('tga ')) return authorization.slice(4).trim()
  const alternate = req.headers['x-telegram-init-data']
  return typeof alternate === 'string' ? alternate.trim() : ''
}

export function authenticateRequest(req) {
  return verifyTelegramInitData(getInitDataFromRequest(req))
}
