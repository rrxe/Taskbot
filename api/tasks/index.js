import { authenticateRequest } from '../../lib/telegram-auth.js'
import { supabase } from '../../lib/supabase.js'
import { getAppSettings } from '../../lib/settings.js'
import { telegramCall, sendUserNotice } from '../../lib/telegram.js'
import { requireRequiredMembership, requireActiveUser } from '../../lib/required-channels.js'
import { extractTelegramChatId, describeTelegramChatError, isTelegramMember } from '../../lib/telegram-membership.js'

async function verifyMembership(task, telegramId) {
  const chat = extractTelegramChatId(task.chat_id) || extractTelegramChatId(task.url)
  if (!chat) {
    return {
      ok: false,
      error: 'Channel ID cannot be resolved. Enter @channel or its numeric -100… ID in the task settings. A private invite link alone is not enough.',
    }
  }
  try {
    const member = await telegramCall('getChatMember', {
      chat_id: chat,
      user_id: Number(telegramId),
    })
    return {
      ok: isTelegramMember(member),
      status: member?.status || 'unknown',
      error: null,
    }
  } catch (error) {
    return { ok: false, error: describeTelegramChatError(error, chat), chatId: chat }
  }
}

export default async function handler(req, res) {
  const auth = authenticateRequest(req)
  if (!auth) return res.status(401).json({ error: 'Open Easy Gram inside Telegram.' })
  const activeUser = await requireActiveUser(auth.id, res)
  if (!activeUser) return
  const membershipAllowed = await requireRequiredMembership(auth.id, res)
  if (!membershipAllowed) return

  try {
    const appSettings = await getAppSettings()
    if (appSettings.maintenance_mode) return res.status(503).json({ error: 'Easy Gram is under maintenance.' })
    if (req.method === 'GET') {
      const { data: tasks, error } = await supabase
        .from('easygram_tasks')
        .select('id,title,description,reward_coins,kind,url,chat_id,max_completions,cooldown_hours,is_active,sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false })
      if (error) throw error
      const { data: completions, error: completionError } = await supabase
        .from('easygram_task_completions')
        .select('task_id,completion_count,last_completed_at,cycle_count,cooldown_until')
        .eq('telegram_id', auth.id)
      if (completionError) throw completionError
      const completionMap = new Map((completions || []).map((row) => [String(row.task_id), row]))
      const nowMs = Date.now()
      return res.status(200).json({
        success: true,
        tasks: (tasks || []).map((task) => {
          const completion = completionMap.get(String(task.id))
          const completed = Number(completion?.completion_count || 0)
          const batchLimit = Math.max(0, Number(task.max_completions || 0))
          const cooldownUntil = task.kind === 'ad' ? completion?.cooldown_until || null : null
          const cooldownActive = Boolean(task.kind === 'ad' && batchLimit > 0 && cooldownUntil && Date.parse(cooldownUntil) > nowMs)
          const cycleCompleted = task.kind === 'ad'
            ? batchLimit > 0
              ? (cooldownActive ? batchLimit : Math.max(0, Number(completion?.cycle_count || 0)))
              : completed
            : completed
          const nextAvailableAt = cooldownActive ? cooldownUntil : null
          return {
            ...task,
            completed,
            cycle_completed: cycleCompleted,
            // For ad tasks, max_completions is the number of rewarded views in one batch.
            remaining: task.kind === 'ad'
              ? batchLimit > 0 ? Math.max(0, batchLimit - cycleCompleted) : null
              : batchLimit > 0 ? Math.max(0, batchLimit - completed) : null,
            next_available_at: nextAvailableAt,
          }
        }),
      })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const { action, taskId, taskSessionId, adSessionId } = req.body || {}
    const normalizedId = Number(taskId)
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) return res.status(400).json({ error: 'Invalid task.' })

    const { data: task, error: taskError } = await supabase
      .from('easygram_tasks')
      .select('*')
      .eq('id', normalizedId)
      .eq('is_active', true)
      .maybeSingle()
    if (taskError) throw taskError
    if (!task) return res.status(404).json({ error: 'This task is unavailable.' })

    if (action === 'open') {
      if (task.kind === 'ad') return res.status(400).json({ error: 'Ad tasks use the ad player.' })
      const { data: session, error } = await supabase
        .from('easygram_task_sessions')
        .insert({ telegram_id: auth.id, task_id: normalizedId })
        .select('id,opened_at')
        .single()
      if (error) throw error
      return res.status(200).json({ success: true, taskSessionId: session.id, url: task.url })
    }

    if (action !== 'complete') return res.status(400).json({ error: 'Unknown task action.' })

    if (task.kind === 'channel') {
      const member = await verifyMembership(task, auth.id)
      if (!member.ok) return res.status(400).json({ error: member.error || 'Join the channel first, then try again.' })
    }

    const { data, error } = await supabase.rpc('easygram_complete_task', {
      p_telegram_id: auth.id,
      p_task_id: normalizedId,
      p_task_session_id: taskSessionId || null,
      p_ad_session_id: adSessionId || null,
    })
    if (error) {
      const message = String(error.message || '')
      const status = message.toLowerCase().includes('cooldown') ? 429 : message.includes('already completed') || message.includes('limit reached') ? 409 : 400
      return res.status(status).json({ error: message.replace(/^.*ERROR:\s*/i, '') || 'Could not complete this task.' })
    }
    const result = Array.isArray(data) ? data[0] : data
    let referralQualified = false
    try {
      const { data: referralBefore, error: referralReadError } = await supabase
        .from('easygram_referrals').select('referrer_id,reward_coins,status')
        .eq('referred_id', auth.id).eq('status', 'pending').maybeSingle()
      if (referralReadError) throw referralReadError
      if (referralBefore) {
        const { data: qualified, error: qualifyError } = await supabase.rpc('easygram_qualify_referral', {
          p_referred_id: auth.id,
        })
        if (qualifyError) throw qualifyError
        referralQualified = qualified === true
        if (referralQualified) {
          await sendUserNotice(referralBefore.referrer_id,
            `🎉 Your invited friend completed the required tasks. <b>${Number(referralBefore.reward_coins || 0).toLocaleString()} Coins</b> has been added to your balance.`)
        }
      }
    } catch (referralError) {
      // Task reward has already been committed. A later task completion will retry referral qualification.
      console.warn('[Easy Gram] referral qualification:', referralError?.message || referralError)
    }
    return res.status(200).json({ success: true, reward: Number(result?.reward_coins ?? task.reward_coins ?? 0), coinBalance: Number(result?.coin_balance || 0), referralQualified })
  } catch (error) {
    console.error('[Easy Gram] tasks:', error)
    return res.status(500).json({ error: 'Task request failed. Please try again.' })
  }
}
