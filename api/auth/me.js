import { timingSafeEqual } from 'node:crypto'
import { authenticateRequest } from '../../lib/telegram-auth.js'
import { supabase } from '../../lib/supabase.js'
import { getAppSettings } from '../../lib/settings.js'
import { getRequiredChannelStatus } from '../../lib/required-channels.js'
import { buildReferralStartLink, sendUserNotice, escapeHtml } from '../../lib/telegram.js'

function referralFromStartParam(value) {
  // Telegram passes the bot deep-link payload as initData.start_param.
  // Accept the current and legacy referral prefixes, but never a raw arbitrary value.
  const match = String(value || '').trim().match(/^(?:ref_|referral_)(\d{5,20})$/i)
  return match ? match[1] : null
}

function matchesRewardSecret(provided, expected) {
  const actual = Buffer.from(String(provided || ''), 'utf8')
  const wanted = Buffer.from(String(expected || ''), 'utf8')
  return actual.length >= 32 && actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

async function handleAdsgramNativeTaskReward(req, res) {
  const expectedSecret = process.env.ADSGRAM_REWARD_SECRET
  const providedSecret = req.query?.secret
  const telegramId = String(req.query?.userid || '')
  const kind = String(req.query?.kind || '')

  if (!matchesRewardSecret(providedSecret, expectedSecret)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  if (kind !== 'native_task') {
    return res.status(400).json({ success: false, error: 'Invalid reward kind' })
  }
  if (!/^\d{5,20}$/.test(telegramId)) {
    return res.status(400).json({ success: false, error: 'Invalid Telegram user ID' })
  }

  try {
    const { data, error } = await supabase
      .from('easygram_users')
      .update({ adsgram_native_task_verified_at: new Date().toISOString() })
      .eq('telegram_id', telegramId)
      .select('telegram_id')
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, error: 'Easy Gram user not found' })
    return res.status(200).json({ success: true, type: 'native_task' })
  } catch (error) {
    console.error('[Easy Gram] AdsGram native task Reward URL:', error)
    return res.status(500).json({ success: false, error: 'Could not record AdsGram reward' })
  }
}

export default async function handler(req, res) {
  // AdsGram calls this public HTTPS GET URL only after a real Task reward.
  // Process the signed callback before Telegram Mini App authentication.
  if (req.method === 'GET' && String(req.query?.adsgram_reward || '') === '1') {
    return handleAdsgramNativeTaskReward(req, res)
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.TELEGRAM_BOT_TOKEN && !process.env.BOT_TOKEN) {
    return res.status(500).json({ error: 'Server configuration is missing TELEGRAM_BOT_TOKEN (or BOT_TOKEN). Add the bot token in Dokploy environment variables.' })
  }
  const auth = authenticateRequest(req)
  if (!auth) return res.status(401).json({ error: 'Telegram signature verification failed. Confirm that the configured bot token belongs to this Easy Gram bot, then close and reopen the Mini App.' })

  try {
    const settings = await getAppSettings()
    const { data: existing, error: readError } = await supabase
      .from('easygram_users')
      .select('*')
      .eq('telegram_id', auth.id)
      .maybeSingle()
    if (readError) throw readError

    let user = existing
    if (user?.is_banned) {
      return res.status(403).json({ error: user.ban_reason ? `This account is suspended: ${user.ban_reason}` : 'This Easy Gram account is suspended.' })
    }

    // AdsGram's browser event only starts the claim attempt. The database
    // function grants the configured reward only when the server-to-server
    // Reward URL has already marked this user as verified.
    if (req.body?.action === 'adsgram_native_task_claim') {
      if (!user) return res.status(404).json({ success: false, error: 'Easy Gram user not found' })
      const rewardCoins = Math.max(0, Math.trunc(Number(settings.adsgram_native_task_reward_coins) || 0))
      if (rewardCoins <= 0) return res.status(400).json({ success: false, error: 'Native Task reward is disabled' })

      const { data: claimedRows, error: claimError } = await supabase.rpc('easygram_claim_adsgram_native_task', {
        p_telegram_id: auth.id,
        p_reward: rewardCoins,
      })
      if (claimError) throw claimError
      const claimed = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows
      if (!claimed) return res.status(200).json({ success: true, pending: true })

      const grantedReward = Number(claimed.reward_coins)
      const balanceCoins = Number(claimed.coin_balance)
      try {
        await supabase.from('easygram_audit_logs').insert({
          actor_telegram_id: auth.id,
          action: 'adsgram_native_task_reward',
          details: { reward_coins: grantedReward, balance_after: balanceCoins },
        })
      } catch { /* audit logging must not block an already-completed claim */ }

      return res.status(200).json({ success: true, reward: grantedReward, balanceCoins })
    }

    if (!user) {
      if (!settings.registration_enabled) {
        return res.status(403).json({ error: 'New registrations are temporarily disabled.' })
      }
      const referredBy = referralFromStartParam(auth.startParam)
      const validReferrer = referredBy && referredBy !== auth.id ? referredBy : null
      const { data: inserted, error: insertError } = await supabase
        .from('easygram_users')
        .insert({
          telegram_id: auth.id,
          username: auth.username,
          first_name: auth.firstName,
          referred_by: validReferrer,
          language: auth.languageCode?.toLowerCase().startsWith('ar') ? 'ar' : 'en',
        })
        .select('*')
        .single()
      if (insertError) {
        if (insertError.code === '23505') {
          const retry = await supabase.from('easygram_users').select('*').eq('telegram_id', auth.id).single()
          if (retry.error) throw retry.error
          user = retry.data
        } else throw insertError
      } else user = inserted

    }

    // Retry referral creation from the persisted referred_by column on every
    // authenticated launch. This recovers registrations where the user row was
    // created successfully but the referral RPC temporarily failed.
    const persistedReferrer = String(user?.referred_by || '').trim()
    if (/^\d{5,20}$/.test(persistedReferrer) && persistedReferrer !== auth.id) {
      const { data: referralCreated, error: referralError } = await supabase.rpc('easygram_award_referral', {
        p_referrer_id: persistedReferrer,
        p_referred_id: auth.id,
        p_reward: Number(settings.referral_reward_coins),
      })
      if (referralError) {
        console.warn('[Easy Gram] Referral creation retry failed:', referralError.message)
      } else if (referralCreated === true) {
        const { data: referrer } = await supabase
          .from('easygram_users')
          .select('language')
          .eq('telegram_id', persistedReferrer)
          .maybeSingle()

        const invitedName = escapeHtml(auth.username ? `@${auth.username}` : auth.firstName)
        const notice = referrer?.language === 'ar'
          ? `🎉 <b>انضم شخص جديد من رابط دعوتك!</b>\n\n👤 الاسم: <b>${invitedName}</b>\n\nتابع حالة الإحالة ومكافأتها من داخل Easy Gram. 💎`
          : `🎉 <b>Someone joined through your referral link!</b>\n\n👤 Name: <b>${invitedName}</b>\n\nYou can track this referral and its reward inside Easy Gram. 💎`
        await sendUserNotice(persistedReferrer, notice)
      }
    }

    // If the invitee completed enough tasks before a referral row was repaired,
    // qualify it now instead of waiting for another task completion.
    try {
      const { data: pendingReferral, error: pendingReferralError } = await supabase
        .from('easygram_referrals')
        .select('referrer_id,reward_coins')
        .eq('referred_id', auth.id)
        .eq('status', 'pending')
        .maybeSingle()
      if (pendingReferralError) throw pendingReferralError
      if (pendingReferral) {
        const { data: qualified, error: qualifyError } = await supabase.rpc('easygram_qualify_referral', {
          p_referred_id: auth.id,
        })
        if (qualifyError) throw qualifyError
        if (qualified === true) {
          await sendUserNotice(pendingReferral.referrer_id,
            `🎉 Your invited friend completed the required tasks. <b>${Number(pendingReferral.reward_coins || 0).toLocaleString()} Coins</b> has been added to your balance.`)
        }
      }
    } catch (referralQualificationError) {
      console.warn('[Easy Gram] Referral qualification retry failed:', referralQualificationError?.message || referralQualificationError)
    }

    const requestedLanguage = req.body?.language === 'ar' || req.body?.language === 'en' ? req.body.language : null
    const { data: updated, error: updateError } = await supabase
      .from('easygram_users')
      .update({
        username: auth.username,
        first_name: auth.firstName,
        ...(requestedLanguage ? { language: requestedLanguage } : {}),
        last_seen_at: new Date().toISOString(),
        notify_last_reminder_at: null,
        notify_reminder_count: 0,
        bot_blocked: false,
      })
      .eq('telegram_id', auth.id)
      .select('*')
      .single()
    if (updateError) throw updateError
    user = updated

    const [referralsRes, linkedUsersRes, qualifiedReferralsRes, pendingReferralsRes, tasksRes, adminRes] = await Promise.all([
      supabase.from('easygram_referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', auth.id),
      // referred_by is the durable registration record; use it as a fallback
      // so the invite count remains visible while a missing referral row retries.
      supabase.from('easygram_users').select('telegram_id', { count: 'exact', head: true }).eq('referred_by', auth.id),
      supabase.from('easygram_referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', auth.id).eq('status', 'paid'),
      supabase.from('easygram_referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', auth.id).eq('status', 'pending'),
      supabase.from('easygram_task_completions').select('id', { count: 'exact', head: true }).eq('telegram_id', auth.id),
      supabase.from('easygram_admins').select('role').eq('telegram_id', auth.id).maybeSingle(),
    ])
    for (const result of [referralsRes, linkedUsersRes, qualifiedReferralsRes, pendingReferralsRes, tasksRes, adminRes]) if (result.error) throw result.error

    // Do not silently bypass forced-subscription status if the database
    // cannot be queried. Individual Telegram membership failures are returned
    // as missing memberships by getRequiredChannelStatus itself.
    const subscription = await getRequiredChannelStatus(auth.id)

    let referralLink = ''
    try { referralLink = await buildReferralStartLink(auth.id) } catch (error) { console.warn('[Easy Gram] Could not build referral link:', error?.message || error) }

    return res.status(200).json({
      success: true,
      user: {
        telegramId: user.telegram_id,
        username: user.username,
        firstName: user.first_name,
        photoUrl: auth.photoUrl,
        coinBalance: Number(user.coin_balance || 0),
        legacyGramBalance: Number(user.balance_gram || 0),
        usdtBalance: Number(user.usdt_balance || 0),
        withdrawalAdsWatched: Number(user.withdrawal_ads_watched || 0),
        withdrawalsToday: user.withdrawal_count_date === new Date().toISOString().slice(0, 10) ? Number(user.withdrawals_today || 0) : 0,
        withdrawalAdsRequired: 10 + ((user.withdrawal_count_date === new Date().toISOString().slice(0, 10) ? Number(user.withdrawals_today || 0) : 0) * 10),
        referralsCount: Math.max(referralsRes.count || 0, linkedUsersRes.count || 0),
        qualifiedReferralsCount: qualifiedReferralsRes.count || 0,
        pendingReferralsCount: pendingReferralsRes.count || 0,
        completedTasks: tasksRes.count || 0,
        language: user.language || (auth.languageCode?.startsWith('ar') ? 'ar' : 'en'),
        createdAt: user.created_at,
        dailyStreak: Number(user.daily_streak || 0),
        lastDailyClaim: user.last_daily_claim || null,
      },
      isAdmin: Boolean(adminRes.data),
      adminRole: adminRes.data?.role || null,
      referralLink,
      settings,
      subscription,
    })
  } catch (error) {
    console.error('[Easy Gram] auth/me:', error)
    return res.status(500).json({ error: 'Could not load your account.' })
  }
}
