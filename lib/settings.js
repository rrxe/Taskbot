import { supabase } from './supabase.js'

export const DEFAULT_SETTINGS = {
  app_name: 'Easy Gram',
  welcome_text: 'Complete simple tasks and collect Gram rewards.',
  min_withdrawal: 1,
  withdrawal_ads_required: 5,
  referral_reward: 0.05,
  referral_reward_coins: 50000,
  mining_rate_per_hour_coins: 20000,
  adsgram_native_task_reward_coins: 10000,
  min_exchange_coins: 1000,
  coin_exchange_rate: 0.0000025,
  min_withdrawal_usdt: 0.1,
  max_withdrawal_usdt: 0.2,
  withdrawal_ads_base: 10,
  withdrawal_ads_increment: 10,
  referral_tasks_required: 3,
  task_min_watch_seconds: 5,
  ad_cooldown_seconds: 15,
  auto_ads_enabled: true,
  auto_ads_interval_seconds: 30,
  // Dedicated AdsGram INT blocks: automatic impressions never share the reward block.
  adsgram_auto_block: process.env.ADSGRAM_AUTO_BLOCK || process.env.ADSGRAM_BLOCK_PRIMARY || 'int-58010',
  adsgram_reward_block: process.env.ADSGRAM_REWARD_BLOCK || process.env.ADSGRAM_BLOCK_SECONDARY || 'int-58009',
  // Optional AdsGram native Task block. Blank disables the popup.
  adsgram_native_task_block: '',
  adsgram_native_task_reward_gram: 0.01,
  adsgram_native_task_reward_coins: 10000,
  maintenance_mode: false,
  registration_enabled: true,
  support_username: '',
  terms_url: '',
  gram_network_label: 'Gram wallet',
  gram_withdrawals_enabled: true,
  gram_payment_note: 'Send withdrawals to the Gram wallet address supplied by the user.',
  mining_rate_per_hour: 0.02,
  mining_duration_hours: 6,
  game_daily_attempts: 3,
  game_min_duration_seconds: 8,
  game_reward_orbit: 600,
  game_reward_memory: 800,
  game_reward_reactor: 500,
  game_reward_pulse: 700,
  game_reward_math: 900,
  game_max_bonus_attempts: 3,
  daily_checkin_rewards: [200, 300, 400, 500, 650, 800, 1200],
}

export async function getAppSettings() {
  const { data, error } = await supabase.from('easygram_settings').select('key,value')
  if (error) throw error
  const settings = { ...DEFAULT_SETTINGS }
  const rows = data || []
  const storedKeys = new Set(rows.map((row) => row.key))
  for (const row of rows) settings[row.key] = row.value

  // Backward compatibility for existing installations that still have the old
  // primary/secondary settings. New canonical keys always take precedence.
  if (!storedKeys.has('adsgram_auto_block') && storedKeys.has('adsgram_block_primary')) {
    settings.adsgram_auto_block = settings.adsgram_block_primary
  }
  if (!storedKeys.has('adsgram_reward_block') && storedKeys.has('adsgram_block_secondary')) {
    settings.adsgram_reward_block = settings.adsgram_block_secondary
  }
  if (!/^int-\d+$/.test(String(settings.adsgram_auto_block || ''))) {
    settings.adsgram_auto_block = DEFAULT_SETTINGS.adsgram_auto_block
  }
  if (!/^int-\d+$/.test(String(settings.adsgram_reward_block || ''))) {
    settings.adsgram_reward_block = DEFAULT_SETTINGS.adsgram_reward_block
  }
  settings.adsgram_native_task_block = String(settings.adsgram_native_task_block || '').trim()
  if (settings.adsgram_native_task_block && !/^task-\d+$/.test(settings.adsgram_native_task_block)) {
    settings.adsgram_native_task_block = ''
  }
  settings.adsgram_native_task_reward_gram = Math.max(0, Math.min(1000000, Number(settings.adsgram_native_task_reward_gram) || 0))
  settings.adsgram_native_task_reward_coins = Math.max(0, Math.min(1000000000, Math.trunc(Number(settings.adsgram_native_task_reward_coins) || 0)))
  settings.referral_reward_coins = Math.max(0, Math.min(1000000000, Math.trunc(Number(settings.referral_reward_coins) || 0)))
  settings.mining_rate_per_hour_coins = Math.max(0, Math.min(1000000000, Math.trunc(Number(settings.mining_rate_per_hour_coins) || 0)))
  settings.min_exchange_coins = Math.max(1000, Math.min(1000000000, Math.trunc(Number(settings.min_exchange_coins) || 1000)))
  settings.coin_exchange_rate = 0.0000025
  settings.min_withdrawal_usdt = 0.1
  settings.max_withdrawal_usdt = 0.2
  settings.withdrawal_ads_base = 10
  settings.withdrawal_ads_increment = 10
  settings.min_withdrawal = Math.max(0, Number(settings.min_withdrawal) || 0)
  settings.withdrawal_ads_required = Math.max(1, Math.trunc(Number(settings.withdrawal_ads_required) || 5))
  settings.referral_reward = Math.max(0, Number(settings.referral_reward) || 0)
  settings.referral_tasks_required = Math.max(1, Math.min(50, Math.trunc(Number(settings.referral_tasks_required) || 3)))
  settings.mining_rate_per_hour = Math.max(0, Math.min(100, Number(settings.mining_rate_per_hour) || 0))
  settings.mining_duration_hours = Math.max(1, Math.min(24, Number(settings.mining_duration_hours) || 6))
  settings.task_min_watch_seconds = Math.max(5, Math.trunc(Number(settings.task_min_watch_seconds) || 5))
  settings.ad_cooldown_seconds = Math.max(5, Math.trunc(Number(settings.ad_cooldown_seconds) || 15))
  settings.auto_ads_enabled = settings.auto_ads_enabled !== false && settings.auto_ads_enabled !== 'false'
  settings.auto_ads_interval_seconds = Math.max(30, Math.min(300, Math.trunc(Number(settings.auto_ads_interval_seconds) || 30)))
  settings.game_daily_attempts = Math.max(1, Math.min(20, Math.trunc(Number(settings.game_daily_attempts) || 3)))
  settings.game_min_duration_seconds = Math.max(5, Math.min(60, Math.trunc(Number(settings.game_min_duration_seconds) || 8)))
  for (const key of ['game_reward_orbit', 'game_reward_memory', 'game_reward_reactor', 'game_reward_pulse', 'game_reward_math']) {
    settings[key] = Math.max(0, Math.min(1000000000, Math.trunc(Number(settings[key]) || 0)))
  }
  const maxBonusAttempts = Number(settings.game_max_bonus_attempts)
  settings.game_max_bonus_attempts = Number.isFinite(maxBonusAttempts) ? Math.max(0, Math.min(10, Math.trunc(maxBonusAttempts))) : DEFAULT_SETTINGS.game_max_bonus_attempts
  const dailyRewards = Array.isArray(settings.daily_checkin_rewards) ? settings.daily_checkin_rewards : DEFAULT_SETTINGS.daily_checkin_rewards
  settings.daily_checkin_rewards = Array.from({ length: 7 }, (_, index) => {
    const reward = Number(dailyRewards[index])
    return Number.isFinite(reward) ? Math.max(0, Math.min(1000000000, Math.trunc(reward))) : DEFAULT_SETTINGS.daily_checkin_rewards[index]
  })
  settings.maintenance_mode = settings.maintenance_mode === true || settings.maintenance_mode === 'true'
  settings.registration_enabled = settings.registration_enabled !== false && settings.registration_enabled !== 'false'
  settings.gram_withdrawals_enabled = settings.gram_withdrawals_enabled !== false && settings.gram_withdrawals_enabled !== 'false'
  return settings
}

export async function saveAppSettings(values) {
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS))
  const rows = Object.entries(values || {})
    .filter(([key]) => allowed.has(key))
    .map(([key, value]) => ({ key, value }))
  if (!rows.length) return
  const { error } = await supabase.from('easygram_settings').upsert(rows, { onConflict: 'key' })
  if (error) throw error
}
