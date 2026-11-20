const TELEGRAM_HOSTS = new Set(['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'])
const PUBLIC_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/

/**
 * Convert a Telegram channel reference to a Bot API chat_id.
 * Supported: @username, username, numeric chat IDs, public t.me links,
 * and t.me/c/<id> private-channel message links. Invite links cannot be
 * resolved by getChatMember and must be paired with the numeric -100 chat ID.
 */
export function extractTelegramChatId(rawValue) {
  const raw = String(rawValue ?? '').trim()
  if (!raw) return null

  // Channel and group chat IDs are negative in the Bot API. A positive
  // numeric value is ambiguous (often a user ID), so don't treat it as a chat.
  if (/^-\d{5,20}$/.test(raw)) return raw

  const directUsername = raw.startsWith('@') ? raw.slice(1) : raw
  if (PUBLIC_USERNAME.test(directUsername)) return `@${directUsername}`

  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (!TELEGRAM_HOSTS.has(parsed.hostname.toLowerCase())) return null
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (!parts.length) return null

    const first = parts[0]
    const publicSlug = first.toLowerCase() === 's' ? (parts[1] || '') : first
    if (first.toLowerCase() === 'joinchat' || first.startsWith('+')) return null

    if (first.toLowerCase() === 'c' && /^\d{5,20}$/.test(parts[1] || '')) {
      return `-100${parts[1]}`
    }

    if (PUBLIC_USERNAME.test(publicSlug)) return `@${publicSlug}`
    return null
  } catch {
    return null
  }
}

export function describeTelegramChatError(error, chatRef) {
  const description = String(error?.message || error || 'Unknown Telegram error')
  if (/chat not found/i.test(description)) {
    return `Telegram cannot find chat ${chatRef ? `"${chatRef}"` : 'for this task'}. Use the exact public @channel username or numeric private channel ID beginning -100, not an invite link. Also confirm TELEGRAM_BOT_TOKEN belongs to this Easy GRAM bot and that this same bot is an administrator in this exact channel. Original error: ${description}`
  }
  if (/bot is not a member|not enough rights|administrator required|chat_admin_required/i.test(description)) {
    return `Telegram found the chat but this bot does not have sufficient access. Add the Easy GRAM bot as an administrator in this exact channel. Original error: ${description}`
  }
  return `Telegram membership check failed for ${chatRef || 'this channel'}. Check the channel ID and Easy GRAM bot access. Original error: ${description}`
}

export function isTelegramMember(member) {
  const status = String(member?.status || '')
  return ['creator', 'administrator', 'member'].includes(status)
    || (status === 'restricted' && member?.is_member === true)
}
