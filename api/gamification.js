import { createHmac } from 'node:crypto'
import { authenticateRequest } from '../lib/telegram-auth.js'
import { supabase } from '../lib/supabase.js'
import { getAppSettings } from '../lib/settings.js'
import { requireActiveUser, requireRequiredMembership } from '../lib/required-channels.js'

const GAME_IDS = new Set(['orbit', 'memory', 'reactor', 'pulse', 'math'])
const GAME_REWARD_KEYS = {
  orbit: 'game_reward_orbit',
  memory: 'game_reward_memory',
  reactor: 'game_reward_reactor',
  pulse: 'game_reward_pulse',
  math: 'game_reward_math',
}

const todayUtc = () => new Date().toISOString().slice(0, 10)
const cleanInt = (value, fallback = 0, max = 1000000000) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.trunc(number))) : fallback
}

async function getSnapshot(telegramId, settings) {
  const today = todayUtc()
  const [userResult, checkinResult, runsResult, bonusResult, leaderboardResult] = await Promise.all([
    supabase.from('easygram_users')
      .select('coin_balance,daily_streak,last_daily_claim')
      .eq('telegram_id', telegramId).single(),
    supabase.from('easygram_daily_checkins')
      .select('checkin_date,streak,reward_coins')
      .eq('telegram_id', telegramId)
      .order('checkin_date', { ascending: false }).limit(7),
    supabase.from('easygram_game_runs')
      .select('id,game_id,score,reward_coins,status,started_at,finished_at')
      .eq('telegram_id', telegramId)
      .gte('started_at', `${today}T00:00:00.000Z`)
      .order('started_at', { ascending: false }),
    supabase.from('easygram_game_bonus_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('telegram_id', telegramId)
      .eq('attempt_date', today),
    supabase.rpc('easygram_weekly_game_leaderboard'),
  ])
  for (const result of [userResult, checkinResult, runsResult, bonusResult, leaderboardResult]) {
    if (result.error) throw result.error
  }

  const leaderboard = (leaderboardResult.data || []).map((row) => {
    const key = createHmac('sha256', process.env.TELEGRAM_BOT_TOKEN || 'easygram-leaderboard-private').update(String(row.telegram_id)).digest('hex').slice(0, 16)
    return {
      key,
      name: row.username ? `@${row.username}` : (row.first_name || `Player ${key.slice(0, 4).toUpperCase()}`),
      score: cleanInt(row.score),
      coins: cleanInt(row.coins),
      games: cleanInt(row.games),
    }
  })

  const user = userResult.data
  const lastClaim = user.last_daily_claim || null
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const storedStreak = Number(user.daily_streak || 0)
  // A missed UTC day has already broken the visible streak, even before the
  // next claim persists the reset in the database.
  const visibleStreak = lastClaim && (lastClaim === today || lastClaim === yesterday) ? storedStreak : 0
  return {
    success: true,
    balance: Number(user.coin_balance || 0),
    daily: {
      streak: visibleStreak,
      lastClaim,
      canClaim: lastClaim !== today,
      rewards: Array.isArray(settings.daily_checkin_rewards) ? settings.daily_checkin_rewards.map((value) => cleanInt(value)) : [200, 300, 400, 500, 650, 800, 1200],
      history: checkinResult.data || [],
    },
    games: {
      attemptsUsed: (runsResult.data || []).length,
      freeAttempts: cleanInt(settings.game_daily_attempts, 3, 20) || 3,
      bonusAttempts: Number(bonusResult.count || 0),
      bonusLimit: cleanInt(settings.game_max_bonus_attempts, 3, 10),
      attemptsLimit: (cleanInt(settings.game_daily_attempts, 3, 20) || 3) + Number(bonusResult.count || 0),
      minDurationSeconds: cleanInt(settings.game_min_duration_seconds, 8, 60) || 8,
      rewards: {
        orbit: cleanInt(settings.game_reward_orbit, 600),
        memory: cleanInt(settings.game_reward_memory, 800),
        reactor: cleanInt(settings.game_reward_reactor, 500),
        pulse: cleanInt(settings.game_reward_pulse, 700),
        math: cleanInt(settings.game_reward_math, 900),
      },
      recent: (runsResult.data || []).filter((row) => row.status === 'completed').slice(0, 5),
      leaderboard,
    },
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const auth = authenticateRequest(req)
  if (!auth) return res.status(401).json({ success: false, error: 'Open Easy Gram inside Telegram.' })

  try {
    const active = await requireActiveUser(auth.id, res)
    if (!active) return
    const member = await requireRequiredMembership(auth.id, res)
    if (!member) return
    const settings = await getAppSettings()

    if (req.method === 'GET') {
      return res.status(200).json(await getSnapshot(auth.id, settings))
    }

    const body = req.body || {}
    if (body.action === 'checkin') {
      const { data, error } = await supabase.rpc('easygram_claim_daily_checkin', { p_telegram_id: auth.id })
      if (error) throw new Error(error.message || 'Daily check-in failed')
      return res.status(200).json(data)
    }

    if (body.action === 'redeem_code') {
      const code = String(body.code || '').trim().toUpperCase().replace(/\s+/g, '')
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
        return res.status(400).json({ success: false, error: 'Enter a valid 3–32 character code.' })
      }
      const { data, error } = await supabase.rpc('easygram_redeem_gift_code', {
        p_telegram_id: auth.id,
        p_code: code,
      })
      if (error) throw new Error(error.message || 'Could not redeem this code')
      return res.status(200).json(data)
    }

    if (body.action === 'bonus_attempt') {
      const adSessionId = String(body.adSessionId || '')
      if (!/^[0-9a-f-]{36}$/i.test(adSessionId)) {
        return res.status(400).json({ success: false, error: 'Invalid game reward ad session.' })
      }
      const bonusLimit = cleanInt(settings.game_max_bonus_attempts, 3, 10)
      const { data, error } = await supabase.rpc('easygram_grant_game_bonus_attempt', {
        p_telegram_id: auth.id,
        p_ad_session_id: adSessionId,
        p_daily_limit: bonusLimit,
      })
      if (error) throw new Error(error.message || 'Could not grant the extra game attempt')
      return res.status(200).json(data)
    }

    if (body.action === 'start_game') {
      const gameId = String(body.gameId || '')
      if (!GAME_IDS.has(gameId)) return res.status(400).json({ success: false, error: 'Unknown game.' })
      const reward = cleanInt(settings[GAME_REWARD_KEYS[gameId]], 0)
      if (reward <= 0) return res.status(400).json({ success: false, error: 'This game is temporarily disabled.' })
      const freeLimit = cleanInt(settings.game_daily_attempts, 3, 20) || 3
      const { count: earnedAttempts, error: earnedError } = await supabase.from('easygram_game_bonus_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('telegram_id', auth.id)
        .eq('attempt_date', todayUtc())
      if (earnedError) throw earnedError
      const dailyLimit = Math.min(30, freeLimit + Number(earnedAttempts || 0))
      const { data, error } = await supabase.rpc('easygram_start_game', {
        p_telegram_id: auth.id,
        p_game_id: gameId,
        p_daily_limit: dailyLimit,
        p_reward_coins: reward,
      })
      if (error) throw new Error(error.message || 'Could not start this game')
      return res.status(200).json(data)
    }

    if (body.action === 'finish_game') {
      const runId = String(body.runId || '')
      const score = Number(body.score)
      if (!/^[0-9a-f-]{36}$/i.test(runId) || !Number.isInteger(score) || score < 0 || score > 10000) {
        return res.status(400).json({ success: false, error: 'Invalid game result.' })
      }
      const { data, error } = await supabase.rpc('easygram_finish_game', {
        p_telegram_id: auth.id,
        p_run_id: runId,
        p_score: score,
        p_min_duration_seconds: cleanInt(settings.game_min_duration_seconds, 8, 60) || 8,
      })
      if (error) throw new Error(error.message || 'Could not claim game reward')
      return res.status(200).json(data)
    }

    return res.status(400).json({ success: false, error: 'Unknown action.' })
  } catch (error) {
    console.error('[Easy Gram] gamification:', error)
    const message = String(error?.message || 'Request failed')
    const status = /already claimed|already used|usage limit|expired|Invalid or inactive|Daily game attempts|Extra game attempts|Play the game|suspended|Target score|matching pairs|Reactor score|reaction rounds|math questions|bonus game attempt|verified game reward ad|Unknown game|temporarily disabled|Game session not found/i.test(message) ? 400 : 500
    return res.status(status).json({ success: false, error: message })
  }
}
