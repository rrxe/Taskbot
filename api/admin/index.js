import { requireAdmin, isOwner, ADMIN_PERMISSIONS } from '../../lib/admin.js'
import { supabase } from '../../lib/supabase.js'
import { getAppSettings, saveAppSettings } from '../../lib/settings.js'
import { escapeHtml, sendUserNotice, telegramCall } from '../../lib/telegram.js'
import { clearMembershipCache } from '../../lib/required-channels.js'
import { extractTelegramChatId, describeTelegramChatError } from '../../lib/telegram-membership.js'

const TASK_KINDS = new Set(['ad', 'link', 'channel', 'bot'])
const SETTINGS_KEYS = new Set([
  'app_name', 'welcome_text', 'min_withdrawal', 'withdrawal_ads_required',
  'referral_reward', 'referral_tasks_required', 'referral_reward_coins', 'mining_rate_per_hour_coins',
  'adsgram_native_task_reward_coins', 'min_exchange_coins', 'task_min_watch_seconds', 'ad_cooldown_seconds', 'auto_ads_enabled', 'auto_ads_interval_seconds',
  'adsgram_auto_block', 'adsgram_reward_block', 'adsgram_block_primary', 'adsgram_block_secondary',
  'adsgram_native_task_block', 'adsgram_native_task_reward_gram', 'maintenance_mode',
  'registration_enabled', 'support_username', 'terms_url', 'gram_network_label',
  'gram_withdrawals_enabled', 'gram_payment_note', 'mining_rate_per_hour', 'mining_duration_hours', 'min_withdrawal_usdt', 'max_withdrawal_usdt', 'withdrawal_ads_base', 'withdrawal_ads_increment',
  'game_daily_attempts', 'game_min_duration_seconds', 'game_reward_orbit', 'game_reward_memory', 'game_reward_reactor', 'game_reward_pulse', 'game_reward_math', 'game_max_bonus_attempts',
  'daily_checkin_rewards',
])

function cleanText(value, max = 400) {
  return String(value ?? '').trim().slice(0, max)
}

function permissionFor(action) {
  if (['save_task', 'delete_task', 'toggle_task', 'test_task_channel'].includes(action)) return 'tasks'
  if (['review_withdrawal'].includes(action)) return 'withdrawals'
  if (['save_settings', 'save_gift_code', 'toggle_gift_code', 'delete_gift_code'].includes(action)) return 'settings'
  if (['save_moderator', 'delete_moderator'].includes(action)) return 'moderators'
  if (['broadcast'].includes(action)) return 'broadcast'
  if (['users', 'ban_user', 'adjust_balance'].includes(action)) return 'users'
  if (['save_required_channel', 'delete_required_channel', 'toggle_required_channel', 'test_required_channel'].includes(action)) return 'subscriptions'
  return 'dashboard'
}


async function attachUserTracking(rows) {
  const users = Array.isArray(rows) ? rows : []
  const ids = users.map((row) => String(row.telegram_id || '')).filter(Boolean)
  if (!ids.length) return users.map((row) => ({ ...row, tracking: { tasksCompleted: 0, uniqueTasksCompleted: 0, referralsJoined: 0, referralsRewarded: 0, referralsPending: 0 } }))

  const { data, error } = await supabase.rpc('easygram_admin_user_tracking', { p_telegram_ids: ids })
  if (error) throw error
  const byId = new Map((data || []).map((row) => [String(row.telegram_id), {
    tasksCompleted: Number(row.tasks_completed || 0),
    uniqueTasksCompleted: Number(row.distinct_tasks_completed || 0),
    referralsJoined: Number(row.referrals_joined || 0),
    referralsRewarded: Number(row.referrals_rewarded || 0),
    referralsPending: Number(row.referrals_pending || 0),
  }]))
  return users.map((row) => ({
    ...row,
    tracking: byId.get(String(row.telegram_id)) || { tasksCompleted: 0, uniqueTasksCompleted: 0, referralsJoined: 0, referralsRewarded: 0, referralsPending: 0 },
  }))
}

async function getOverview(admin) {
  const onlineSince = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const [users, pending, allWithdrawals, taskCount, onlineUsers] = await Promise.all([
    supabase.from('easygram_users').select('telegram_id,username,first_name,coin_balance,usdt_balance,created_at,last_seen_at,is_banned,ban_reason', { count: 'exact' }).order('created_at', { ascending: false }).limit(10),
    supabase.from('easygram_usdt_withdrawals').select('id,telegram_id,amount_usdt,method,target,status,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(100),
    supabase.from('easygram_usdt_withdrawals').select('id', { count: 'exact', head: true }),
    supabase.from('easygram_tasks').select('id', { count: 'exact', head: true }),
    supabase.from('easygram_users').select('telegram_id', { count: 'exact', head: true }).gte('last_seen_at', onlineSince),
  ])
  for (const result of [users, pending, allWithdrawals, taskCount, onlineUsers]) if (result.error) throw result.error

  const permissions = Array.isArray(admin.permissions) ? admin.permissions : []
  const isFull = admin.role === 'owner'
  const result = {
    success: true,
    admin: { telegramId: admin.telegram_id, username: admin.username, firstName: admin.first_name, role: admin.role, permissions },
    stats: { users: users.count || 0, onlineUsers: onlineUsers.count || 0, pendingWithdrawals: pending.data?.length || 0, totalWithdrawals: allWithdrawals.count || 0, tasks: taskCount.count || 0 },
  }

  if (isFull || permissions.includes('tasks')) {
    const { data, error } = await supabase.from('easygram_tasks').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    if (error) throw error
    result.tasks = data || []
  }
  if (isFull || permissions.includes('withdrawals')) {
    const withdrawalRows = pending.data || []
    const telegramIds = [...new Set(withdrawalRows.map((row) => String(row.telegram_id))) ]
    let usersById = new Map()
    if (telegramIds.length) {
      const { data: userRows, error: userError } = await supabase
        .from('easygram_users')
        .select('telegram_id,first_name,username')
        .in('telegram_id', telegramIds)
      if (userError) throw userError
      usersById = new Map((userRows || []).map((row) => [String(row.telegram_id), row]))
    }
    result.withdrawals = withdrawalRows.map((row) => ({
      ...row,
      first_name: usersById.get(String(row.telegram_id))?.first_name || 'Gram User',
      username: usersById.get(String(row.telegram_id))?.username || null,
    }))
  }
  if (isFull || permissions.includes('settings')) {
    result.settings = await getAppSettings()
    const { data: giftCodes, error: giftCodeError } = await supabase.from('easygram_gift_codes').select('*').order('created_at', { ascending: false }).limit(200)
    if (giftCodeError) throw giftCodeError
    result.giftCodes = giftCodes || []
  }
  if (isFull || permissions.includes('moderators')) {
    const { data, error } = await supabase.from('easygram_admins').select('telegram_id,username,first_name,role,permissions,created_at').order('created_at', { ascending: true })
    if (error) throw error
    result.moderators = [
      { telegram_id: 'ADMIN_SECRET_OWNER', username: null, first_name: 'Easy Gram Owner (ADMIN_SECRET)', role: 'owner', permissions: ADMIN_PERMISSIONS },
      ...(data || []).filter((row) => row.role !== 'owner'),
    ]
  }
  if (isFull || permissions.includes('users')) result.users = await attachUserTracking(users.data || [])
  if (isFull || permissions.includes('subscriptions')) {
    const { data: channels, error: channelError } = await supabase.from('easygram_required_channels').select('*').order('created_at', { ascending: false })
    if (channelError) throw channelError
    result.requiredChannels = channels || []
  }
  return result
}

export default async function handler(req, res) {
  const requestedAction = req.method === 'GET' ? 'dashboard' : cleanText(req.body?.action, 40)
  const permission = permissionFor(requestedAction)
  try {
    const access = await requireAdmin(req, res, permission)
    if (!access) return
    const { actor, admin } = access

    if (req.method === 'GET') {
      const data = await getOverview(admin)
      return res.status(200).json(data)
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const body = req.body || {}
    switch (body.action) {
      case 'save_task': {
        const id = Number(body.id) || null
        const title = cleanText(body.title, 100)
        const description = cleanText(body.description, 240)
        const kind = cleanText(body.kind, 20)
        const reward = Math.trunc(Number(body.rewardCoins))
        const url = cleanText(body.url, 500)
        const chatId = cleanText(body.chatId, 100)
        const maxCompletions = Math.max(0, Math.trunc(Number(body.maxCompletions ?? 1)))
        const cooldownHours = Math.max(1, Math.min(168, Math.trunc(Number(body.cooldownHours ?? 5) || 5)))
        if (!title || !TASK_KINDS.has(kind) || !Number.isFinite(reward) || reward < 0 || reward > 1000000000000) {
          return res.status(400).json({ error: 'Check the title, task type and Coin reward amount.' })
        }
        if (kind !== 'ad' && !/^https:\/\//i.test(url)) return res.status(400).json({ error: 'Task link must start with https://' })
        const resolvedTaskChatId = kind === 'channel' ? (extractTelegramChatId(chatId) || extractTelegramChatId(url)) : null
        if (kind === 'channel' && !resolvedTaskChatId) return res.status(400).json({ error: 'Enter @channel or the numeric -100… channel ID. A private invite link alone cannot be checked; keep it in Task URL and enter the numeric chat ID here.' })
        const values = {
          title, description, kind, reward_coins: reward, url: kind === 'ad' ? null : url,
          chat_id: resolvedTaskChatId,
          max_completions: maxCompletions, cooldown_hours: cooldownHours,
          is_active: body.isActive !== false,
          sort_order: Math.max(0, Math.trunc(Number(body.sortOrder) || 0)),
          updated_at: new Date().toISOString(),
        }
        const query = id
          ? supabase.from('easygram_tasks').update(values).eq('id', id).select('*').single()
          : supabase.from('easygram_tasks').insert(values).select('*').single()
        const { data, error } = await query
        if (error) throw error
        return res.status(200).json({ success: true, task: data })
      }
      case 'delete_task': {
        const id = Number(body.id)
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid task ID.' })
        const { error } = await supabase.from('easygram_tasks').delete().eq('id', id)
        if (error) throw error
        return res.status(200).json({ success: true })
      }
      case 'toggle_task': {
        const id = Number(body.id)
        const { data, error } = await supabase.from('easygram_tasks').update({ is_active: body.isActive === true, updated_at: new Date().toISOString() }).eq('id', id).select('id,is_active').single()
        if (error) throw error
        return res.status(200).json({ success: true, task: data })
      }
      case 'save_settings': {
        const values = {}
        for (const [key, value] of Object.entries(body.settings || {})) if (SETTINGS_KEYS.has(key)) values[key] = value
        // Accept old field names from a cached/older admin page, but persist
        // only the new explicit automatic/reward settings.
        if (values.adsgram_auto_block === undefined && values.adsgram_block_primary !== undefined) {
          values.adsgram_auto_block = values.adsgram_block_primary
        }
        if (values.adsgram_reward_block === undefined && values.adsgram_block_secondary !== undefined) {
          values.adsgram_reward_block = values.adsgram_block_secondary
        }
        delete values.adsgram_block_primary
        delete values.adsgram_block_secondary
        if (values.adsgram_auto_block !== undefined && !/^int-\d+$/.test(String(values.adsgram_auto_block))) {
          return res.status(400).json({ error: 'Automatic ads block ID must be a valid AdsGram INT ID, for example int-58010.' })
        }
        if (values.adsgram_reward_block !== undefined && !/^int-\d+$/.test(String(values.adsgram_reward_block))) {
          return res.status(400).json({ error: 'Reward/action ads block ID must be a valid AdsGram INT ID, for example int-58009.' })
        }
        if (values.adsgram_native_task_block !== undefined) {
          values.adsgram_native_task_block = cleanText(values.adsgram_native_task_block, 32)
          if (values.adsgram_native_task_block && !/^task-\d+$/.test(values.adsgram_native_task_block)) {
            return res.status(400).json({ error: 'Native Task block ID must use the AdsGram format task-0000.' })
          }
        }
        if (values.adsgram_native_task_reward_coins !== undefined) {
          const rewardCoins = Math.trunc(Number(values.adsgram_native_task_reward_coins))
          if (!Number.isFinite(rewardCoins) || rewardCoins < 0 || rewardCoins > 1000000000) return res.status(400).json({ error: 'Native Task Coin reward must be a valid non-negative integer.' })
          values.adsgram_native_task_reward_coins = rewardCoins
        }
        if (values.referral_reward_coins !== undefined) values.referral_reward_coins = Math.max(0, Math.min(1000000000, Math.trunc(Number(values.referral_reward_coins) || 0)))
        if (values.mining_rate_per_hour_coins !== undefined) values.mining_rate_per_hour_coins = Math.max(0, Math.min(1000000000, Math.trunc(Number(values.mining_rate_per_hour_coins) || 0)))
        if (values.min_exchange_coins !== undefined) values.min_exchange_coins = Math.max(1000, Math.min(1000000000, Math.trunc(Number(values.min_exchange_coins) || 1000)))
        if (values.adsgram_native_task_reward_gram !== undefined) {
          const nativeTaskReward = Number(values.adsgram_native_task_reward_gram)
          if (!Number.isFinite(nativeTaskReward) || nativeTaskReward < 0 || nativeTaskReward > 1000000) {
            return res.status(400).json({ error: 'Native Task reward must be a valid non-negative GRAM amount.' })
          }
          values.adsgram_native_task_reward_gram = nativeTaskReward
        }
        values.coin_exchange_rate = 0.0000025
        values.min_withdrawal_usdt = 0.1
        values.max_withdrawal_usdt = 0.2
        values.withdrawal_ads_base = 10
        values.withdrawal_ads_increment = 10
        if (values.min_withdrawal !== undefined) values.min_withdrawal = Math.max(0, Number(values.min_withdrawal) || 0)
        if (values.withdrawal_ads_required !== undefined) values.withdrawal_ads_required = Math.min(50, Math.max(1, Math.trunc(Number(values.withdrawal_ads_required) || 5)))
        if (values.referral_reward !== undefined) values.referral_reward = Math.max(0, Number(values.referral_reward) || 0)
        if (values.referral_tasks_required !== undefined) values.referral_tasks_required = Math.max(1, Math.min(50, Math.trunc(Number(values.referral_tasks_required) || 3)))
        if (values.mining_rate_per_hour !== undefined) values.mining_rate_per_hour = Math.min(100, Math.max(0, Number(values.mining_rate_per_hour) || 0))
        if (values.mining_duration_hours !== undefined) values.mining_duration_hours = Math.min(24, Math.max(1, Number(values.mining_duration_hours) || 6))
        if (values.task_min_watch_seconds !== undefined) values.task_min_watch_seconds = Math.max(5, Math.min(60, Math.trunc(Number(values.task_min_watch_seconds) || 5)))
        if (values.ad_cooldown_seconds !== undefined) values.ad_cooldown_seconds = Math.max(5, Math.min(120, Math.trunc(Number(values.ad_cooldown_seconds) || 15)))
        if (values.auto_ads_enabled !== undefined) values.auto_ads_enabled = values.auto_ads_enabled === true || values.auto_ads_enabled === 'true'
        if (values.auto_ads_interval_seconds !== undefined) values.auto_ads_interval_seconds = Math.max(30, Math.min(300, Math.trunc(Number(values.auto_ads_interval_seconds) || 30)))
        if (values.game_daily_attempts !== undefined) values.game_daily_attempts = Math.max(1, Math.min(20, Math.trunc(Number(values.game_daily_attempts) || 3)))
        if (values.game_min_duration_seconds !== undefined) values.game_min_duration_seconds = Math.max(5, Math.min(60, Math.trunc(Number(values.game_min_duration_seconds) || 8)))
        if (values.game_max_bonus_attempts !== undefined) values.game_max_bonus_attempts = Math.max(0, Math.min(10, Math.trunc(Number(values.game_max_bonus_attempts) || 0)))
        for (const key of ['game_reward_orbit', 'game_reward_memory', 'game_reward_reactor', 'game_reward_pulse', 'game_reward_math']) {
          if (values[key] !== undefined) values[key] = Math.max(0, Math.min(1000000000, Math.trunc(Number(values[key]) || 0)))
        }
        if (values.daily_checkin_rewards !== undefined) {
          if (!Array.isArray(values.daily_checkin_rewards) || values.daily_checkin_rewards.length !== 7) {
            return res.status(400).json({ error: 'Daily check-in rewards must contain exactly seven values.' })
          }
          values.daily_checkin_rewards = values.daily_checkin_rewards.map((value) => {
            const reward = Number(value)
            return Number.isFinite(reward) ? Math.max(0, Math.min(1000000000, Math.trunc(reward))) : 0
          })
        }
        await saveAppSettings(values)
        return res.status(200).json({ success: true, settings: await getAppSettings() })
      }
      case 'save_gift_code': {
        const id = cleanText(body.id, 50) || null
        const code = cleanText(body.code, 32).toUpperCase().replace(/\s+/g, '')
        const rewardCoins = Math.trunc(Number(body.rewardCoins))
        const maxUses = Math.trunc(Number(body.maxUses))
        const expiresRaw = cleanText(body.expiresAt, 40)
        const expiresAt = expiresRaw ? new Date(expiresRaw) : null
        if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return res.status(400).json({ error: 'Code must be 3–32 letters, numbers, dashes or underscores.' })
        if (!Number.isFinite(rewardCoins) || rewardCoins < 0 || rewardCoins > 1000000000) return res.status(400).json({ error: 'Reward must be a whole number between 0 and 1,000,000,000.' })
        if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > 10000000) return res.status(400).json({ error: 'Maximum uses must be 0 or a positive whole number. 0 means unlimited.' })
        if (expiresRaw && (!expiresAt || Number.isNaN(expiresAt.getTime()))) return res.status(400).json({ error: 'Invalid expiry date.' })
        const values = { code, reward_coins: rewardCoins, max_uses: maxUses, expires_at: expiresAt?.toISOString() || null, updated_at: new Date().toISOString() }
        const query = id
          ? supabase.from('easygram_gift_codes').update(values).eq('id', id).select('*').single()
          : supabase.from('easygram_gift_codes').insert(values).select('*').single()
        const { data, error } = await query
        if (error?.code === '23505') return res.status(400).json({ error: 'This gift code already exists.' })
        if (error) throw error
        await supabase.from('easygram_audit_logs').insert({ actor_telegram_id: actor.id, action: 'save_gift_code', details: { code, reward_coins: rewardCoins, max_uses: maxUses } })
        return res.status(200).json({ success: true, giftCode: data })
      }
      case 'toggle_gift_code': {
        const id = cleanText(body.id, 50)
        const { data, error } = await supabase.from('easygram_gift_codes')
          .update({ is_active: body.isActive === true, updated_at: new Date().toISOString() })
          .eq('id', id).select('*').single()
        if (error) throw error
        return res.status(200).json({ success: true, giftCode: data })
      }
      case 'delete_gift_code': {
        const id = cleanText(body.id, 50)
        if (!id) return res.status(400).json({ error: 'Gift code ID is required.' })
        const { error } = await supabase.from('easygram_gift_codes').delete().eq('id', id)
        if (error) throw error
        await supabase.from('easygram_audit_logs').insert({ actor_telegram_id: actor.id, action: 'delete_gift_code', details: { id } })
        return res.status(200).json({ success: true })
      }
      case 'review_withdrawal': {
        const id = String(body.id || '')
        const action = body.review === 'approve' ? 'approve' : body.review === 'reject' ? 'reject' : ''
        if (!id || !action) return res.status(400).json({ error: 'Invalid withdrawal action.' })
        const { data: before, error: findError } = await supabase.from('easygram_usdt_withdrawals').select('id,telegram_id,amount_usdt,method,target,status').eq('id', id).maybeSingle()
        if (findError) throw findError
        if (!before) return res.status(404).json({ error: 'Withdrawal not found.' })
        const { data, error } = await supabase.rpc('easygram_review_usdt_withdrawal', { p_withdrawal_id: id, p_action: action, p_admin_id: actor.id, p_admin_note: cleanText(body.note, 300) })
        if (error) throw error
        if (action === 'approve') {
          await sendUserNotice(before.telegram_id, `✅ Your Easy Gram withdrawal of <b>${Number(before.amount_usdt).toFixed(4)} USDT</b> has been approved.`)
        } else {
          await sendUserNotice(before.telegram_id, `Your Easy Gram withdrawal was rejected. <b>${Number(before.amount_usdt).toFixed(4)} USDT</b> has been returned to your balance.${body.note ? `\nReason: ${escapeHtml(body.note)}` : ''}`)
        }
        return res.status(200).json({ success: true, result: Array.isArray(data) ? data[0] : data })
      }
      case 'save_moderator': {
        if (!isOwner(admin)) return res.status(403).json({ error: 'Only the owner can manage moderators.' })
        const telegramId = cleanText(body.telegramId, 30)
        if (!/^\d{5,20}$/.test(telegramId)) return res.status(400).json({ error: 'Enter a valid Telegram numeric ID.' })
        const permissions = [...new Set((Array.isArray(body.permissions) ? body.permissions : []).filter((value) => ADMIN_PERMISSIONS.includes(value)))]
        const { data: player } = await supabase.from('easygram_users').select('username,first_name').eq('telegram_id', telegramId).maybeSingle()
        const { data, error } = await supabase.from('easygram_admins').upsert({
          telegram_id: telegramId,
          username: player?.username || null,
          first_name: player?.first_name || null,
          role: 'moderator',
          permissions,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'telegram_id' }).select('*').single()
        if (error) throw error
        return res.status(200).json({ success: true, moderator: data })
      }
      case 'delete_moderator': {
        if (!isOwner(admin)) return res.status(403).json({ error: 'Only the owner can manage moderators.' })
        const telegramId = cleanText(body.telegramId, 30)
        if (!/^\d{5,20}$/.test(telegramId)) return res.status(400).json({ error: 'Invalid moderator Telegram ID.' })
        const { error } = await supabase.from('easygram_admins').delete().eq('telegram_id', telegramId).eq('role', 'moderator')
        if (error) throw error
        return res.status(200).json({ success: true })
      }
      case 'test_task_channel': {
        const id = Number(body.id)
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid task ID.' })
        const { data: task, error: taskError } = await supabase.from('easygram_tasks').select('id,title,kind,chat_id,url').eq('id', id).maybeSingle()
        if (taskError) throw taskError
        if (!task || task.kind !== 'channel') return res.status(404).json({ error: 'Join-channel task not found.' })
        const chatId = extractTelegramChatId(task.chat_id) || extractTelegramChatId(task.url)
        if (!chatId) return res.status(400).json({ error: 'This task has no valid @channel or -100… ID. Edit it and enter the actual channel ID; invite links cannot be queried.' })
        try {
          const bot = await telegramCall('getMe', {})
          const chat = await telegramCall('getChat', { chat_id: chatId })
          const botMember = await telegramCall('getChatMember', { chat_id: chatId, user_id: bot.id })
          const botIsAdmin = ['creator', 'administrator'].includes(String(botMember?.status || ''))
          return res.status(200).json({
            success: true,
            botIsAdmin,
            botStatus: botMember?.status || 'unknown',
            resolvedChatId: chatId,
            channelTitle: chat?.title || task.title,
            channelUsername: chat?.username ? `@${chat.username}` : null,
            botUsername: bot?.username ? `@${bot.username}` : null,
            message: botIsAdmin
              ? `Access verified for ${chat?.title || task.title} (${chatId}). Bot ${bot?.username ? `@${bot.username}` : ''} is an administrator.`
              : `Telegram found ${chat?.title || task.title}, but the bot status is ${botMember?.status || 'unknown'}. Promote this exact bot to administrator.`,
          })
        } catch (error) {
          return res.status(400).json({ error: describeTelegramChatError(error, chatId) })
        }
      }
      case 'test_required_channel': {
        const id = Number(body.id)
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid channel ID.' })
        const { data: channel, error: channelError } = await supabase.from('easygram_required_channels').select('id,title,chat_id,join_url').eq('id', id).maybeSingle()
        if (channelError) throw channelError
        if (!channel) return res.status(404).json({ error: 'Channel not found.' })
        const chatId = extractTelegramChatId(channel.chat_id) || extractTelegramChatId(channel.join_url)
        if (!chatId) return res.status(400).json({ error: 'Invalid channel ID. Use @channel or a numeric -100… ID, not an invite link.' })
        const bot = await telegramCall('getMe', {})
        let botMember
        try { botMember = await telegramCall('getChatMember', { chat_id: chatId, user_id: bot.id }) }
        catch (error) { return res.status(400).json({ error: describeTelegramChatError(error, chatId) }) }
        const botIsAdmin = ['creator', 'administrator'].includes(String(botMember?.status || ''))
        return res.status(200).json({
          success: true,
          botIsAdmin,
          botStatus: botMember?.status || 'unknown',
          message: botIsAdmin
            ? 'Membership check is ready. The bot is an administrator in this channel.'
            : 'The bot is not an administrator. Promote it to administrator so Telegram allows it to verify members.',
        })
      }
      case 'save_required_channel': {
        const id = Number(body.id) || null
        const title = cleanText(body.title, 80)
        const rawChatId = cleanText(body.chatId, 100)
        const joinUrl = cleanText(body.joinUrl, 500)
        const chatId = extractTelegramChatId(rawChatId) || extractTelegramChatId(joinUrl)
        if (!title || !chatId || !/^https:\/\//i.test(joinUrl)) {
          return res.status(400).json({ error: 'Enter a channel title, valid @username or numeric -100… chat ID (not an invite link), and an HTTPS invite link.' })
        }
        const values = { title, chat_id: chatId, join_url: joinUrl, is_active: body.isActive !== false, updated_at: new Date().toISOString() }
        const query = id
          ? supabase.from('easygram_required_channels').update(values).eq('id', id).select('*').single()
          : supabase.from('easygram_required_channels').insert(values).select('*').single()
        const { data, error } = await query
        if (error) throw error
        clearMembershipCache()
        await supabase.from('easygram_audit_logs').insert({ actor_telegram_id: actor.id, action: 'save_required_channel', details: { id: data.id, chat_id: chatId } })
        return res.status(200).json({ success: true, channel: data })
      }
      case 'delete_required_channel': {
        const id = Number(body.id)
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid channel ID.' })
        const { error } = await supabase.from('easygram_required_channels').delete().eq('id', id)
        if (error) throw error
        clearMembershipCache()
        return res.status(200).json({ success: true })
      }
      case 'toggle_required_channel': {
        const id = Number(body.id)
        const { data, error } = await supabase.from('easygram_required_channels')
          .update({ is_active: body.isActive === true, updated_at: new Date().toISOString() })
          .eq('id', id).select('*').single()
        if (error) throw error
        clearMembershipCache()
        return res.status(200).json({ success: true, channel: data })
      }
      case 'ban_user': {
        const telegramId = cleanText(body.telegramId, 30)
        if (!/^\d{5,20}$/.test(telegramId)) return res.status(400).json({ error: 'Invalid Telegram ID.' })
        const isBanned = body.banned === true
        const { data, error } = await supabase.from('easygram_users')
          .update({ is_banned: isBanned, ban_reason: isBanned ? cleanText(body.reason, 240) : null, banned_at: isBanned ? new Date().toISOString() : null })
          .eq('telegram_id', telegramId)
          .select('telegram_id,is_banned,ban_reason')
          .single()
        if (error) throw error
        await supabase.from('easygram_audit_logs').insert({ actor_telegram_id: actor.id, action: isBanned ? 'ban_user' : 'unban_user', details: { telegram_id: telegramId, reason: body.reason || null } })
        return res.status(200).json({ success: true, user: data })
      }
      case 'adjust_balance': {
        const telegramId = cleanText(body.telegramId, 30)
        const delta = Number(body.delta)
        if (!/^\d{5,20}$/.test(telegramId) || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1000000000000) {
          return res.status(400).json({ error: 'Enter a valid user ID and balance adjustment.' })
        }
        const coinDelta = Math.trunc(delta)
        if (coinDelta === 0) return res.status(400).json({ error: 'Coin adjustment must be a whole number.' })
        const { data: player, error: readError } = await supabase.from('easygram_users').select('coin_balance').eq('telegram_id', telegramId).single()
        if (readError) throw readError
        const nextBalance = Number(player.coin_balance || 0) + coinDelta
        if (nextBalance < 0) return res.status(400).json({ error: 'The adjustment would make the Coin balance negative.' })
        const { data, error } = await supabase.from('easygram_users').update({ coin_balance: nextBalance }).eq('telegram_id', telegramId).select('telegram_id,coin_balance,usdt_balance').single()
        if (error) throw error
        await supabase.from('easygram_audit_logs').insert({ actor_telegram_id: actor.id, action: 'adjust_balance', details: { telegram_id: telegramId, delta: coinDelta, new_coin_balance: nextBalance } })
        return res.status(200).json({ success: true, user: data })
      }
      case 'broadcast': {
        const message = cleanText(body.message, 3500)
        if (!message) return res.status(400).json({ error: 'Write a message first.' })
        const { data: users, error } = await supabase.from('easygram_users').select('telegram_id').limit(100000)
        if (error) throw error
        let sent = 0
        let failed = 0
        for (const user of users || []) {
          try {
            await telegramCall('sendMessage', { chat_id: user.telegram_id, text: message, disable_web_page_preview: true })
            sent += 1
          } catch {
            failed += 1
          }
          await new Promise((resolve) => setTimeout(resolve, 35))
        }
        return res.status(200).json({ success: true, sent, failed, total: users?.length || 0 })
      }
      case 'users': {
        const q = cleanText(body.query, 60).replace(/[(),]/g, '')
        let query = supabase.from('easygram_users').select('telegram_id,username,first_name,coin_balance,usdt_balance,withdrawal_ads_watched,created_at,last_seen_at,is_banned,ban_reason').order('created_at', { ascending: false }).limit(30)
        if (q) query = query.or(`telegram_id.eq.${q},username.ilike.%${q}%,first_name.ilike.%${q}%`)
        const { data, error } = await query
        if (error) throw error
        return res.status(200).json({ success: true, users: await attachUserTracking(data || []) })
      }
      default:
        return res.status(400).json({ error: 'Unknown admin action.' })
    }
  } catch (error) {
    console.error('[Easy Gram] admin:', error)
    if (!res.headersSent) return res.status(500).json({ error: error.message || 'Admin request failed.' })
  }
}
