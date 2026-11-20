import { supabase } from './supabase.js'
import { telegramCall } from './telegram.js'
import { extractTelegramChatId, describeTelegramChatError, isTelegramMember } from './telegram-membership.js'

const CACHE_MS = 30000
const membershipCache = new Map()

export async function getRequiredChannels() {
  const { data, error } = await supabase
    .from('easygram_required_channels')
    .select('id,title,chat_id,join_url,is_active,created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(20)
  if (error) throw error
  return data || []
}

export async function getRequiredChannelStatus(telegramId, { force = false } = {}) {
  const key = String(telegramId)
  const cached = membershipCache.get(key)
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value

  const channels = await getRequiredChannels()
  const status = await Promise.all(channels.map(async (channel) => {
    const chatId = extractTelegramChatId(channel.chat_id) || extractTelegramChatId(channel.join_url)
    if (!chatId) {
      return {
        id: channel.id,
        title: channel.title,
        chatId: channel.chat_id,
        joinUrl: channel.join_url,
        isMember: false,
        checkError: 'Invalid channel reference. Use @channel or a numeric -100… chat ID, not an invite link.',
      }
    }
    try {
      const member = await telegramCall('getChatMember', {
        chat_id: chatId,
        user_id: Number(telegramId),
      })
      return {
        id: channel.id,
        title: channel.title,
        chatId: channel.chat_id,
        joinUrl: channel.join_url,
        isMember: isTelegramMember(member),
        checkError: null,
      }
    } catch (error) {
      return {
        id: channel.id,
        title: channel.title,
        chatId: channel.chat_id,
        joinUrl: channel.join_url,
        isMember: false,
        checkError: describeTelegramChatError(error, chatId),
      }
    }
  }))

  const value = {
    channels: status,
    requiredCount: status.length,
    missingCount: status.filter((channel) => !channel.isMember).length,
    isComplete: status.every((channel) => channel.isMember),
  }
  membershipCache.set(key, { at: Date.now(), value })
  return value
}

export async function requireRequiredMembership(telegramId, res, options = {}) {
  const status = await getRequiredChannelStatus(telegramId, options)
  if (!status.isComplete) {
    res.status(403).json({
      success: false,
      code: 'SUBSCRIPTION_REQUIRED',
      error: 'Join all required channels, then tap Check membership.',
      subscription: status,
    })
    return false
  }
  return true
}

export async function requireActiveUser(telegramId, res) {
  const { data, error } = await supabase.from('easygram_users').select('is_banned,ban_reason').eq('telegram_id', String(telegramId)).maybeSingle()
  if (error) throw error
  if (!data) { res.status(401).json({ error: 'Easy Gram account not found. Reopen the Mini App.' }); return false }
  if (data.is_banned) { res.status(403).json({ error: data.ban_reason ? `This account is suspended: ${data.ban_reason}` : 'This Easy Gram account is suspended.' }); return false }
  return true
}

export function clearMembershipCache(telegramId) {
  if (telegramId) membershipCache.delete(String(telegramId))
  else membershipCache.clear()
}
