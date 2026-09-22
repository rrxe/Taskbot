const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { supabase, must, rpc } = require('../db');
const { wrap } = require('../utils');
const { telegramAuth } = require('../middleware/telegramAuth');
const cpmService = require('../services/cpmService');
const cycleService = require('../services/cycleService');

const router = express.Router();
router.use(telegramAuth);

const adRequestLimiter = rateLimit({
  windowMs: 15 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

const todayStr = () => new Date().toISOString().slice(0, 10);

// ---- List active countries (dynamic, admin-controlled) ----
router.get(
  '/countries',
  wrap(async (req, res) => {
    const rows = must(
      await supabase
        .from('countries')
        .select('id, name')
        .eq('enabled', true)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true })
    );
    res.json(rows);
  })
);

// ---- Choose country (only once; afterwards requires admin/review) ----
router.post(
  '/select-country',
  wrap(async (req, res) => {
    const { countryId } = req.body;
    if (req.user.country_id) {
      return res.status(409).json({ error: 'country_already_set' });
    }
    const country = must(
      await supabase.from('countries').select('id').eq('id', countryId).eq('enabled', true).maybeSingle()
    );
    if (!country) return res.status(400).json({ error: 'invalid_country' });

    const cycle = await cycleService.getOrCreateOpenCycle();
    // Atomic: only succeeds if the country is still empty (blocks parallel/repeated requests).
    const updated = must(
      await supabase
        .from('users')
        .update({ country_id: country.id, current_cycle_id: cycle.id, updated_at: new Date().toISOString() })
        .eq('id', req.user.id)
        .is('country_id', null)
        .select('id')
    );
    if (!updated.length) return res.status(409).json({ error: 'country_already_set' });
    res.json({ ok: true });
  })
);

// ---- Current user profile + stats ----
router.get(
  '/me',
  wrap(async (req, res) => {
    const u = req.user;
    const noRow = { data: null, error: null };
    const [countryRes, statsRes, withdrawalsOpenRaw] = await Promise.all([
      u.country_id
        ? supabase.from('countries').select('id, name').eq('id', u.country_id).maybeSingle()
        : Promise.resolve(noRow),
      u.country_id
        ? supabase
            .from('user_daily_stats')
            .select('impressions, cpm, user_share, status')
            .eq('user_id', u.id)
            .eq('country_id', u.country_id)
            .eq('stat_date', todayStr())
            .maybeSingle()
        : Promise.resolve(noRow),
      cpmService.getSetting('withdrawals_open', 'false'),
    ]);
    const country = must(countryRes);
    const todayStats = must(statsRes);
    const withdrawalsOpen = withdrawalsOpenRaw === 'true';

    res.json({
      telegramId: String(u.telegram_id),
      username: u.username,
      country,
      status: u.status,
      balanceAvailable: Number(u.balance_available),
      balancePaid: Number(u.balance_paid),
      monthlyImpressions: u.monthly_impressions,
      today: todayStats
        ? {
            impressions: todayStats.impressions,
            earnings: todayStats.status === 'pending_cpm' ? 'pending' : Number(todayStats.user_share),
          }
        : { impressions: 0, earnings: 0 },
      withdrawalsOpen,
      ads: {
        rewardBlockId: process.env.ADSGRAM_REWARD_BLOCK_ID || null,
        interstitialBlockId: process.env.ADSGRAM_INTERSTITIAL_BLOCK_ID || null,
      },
    });
  })
);

// ---- Monthly history for the user ----
router.get(
  '/history',
  wrap(async (req, res) => {
    res.json(await rpc('user_history', { p_user_id: req.user.id }));
  })
);

// ---- Monthly leaderboard (top viewers of the currently open cycle) ----
// Resets automatically whenever the admin ends the month, since that
// operation zeroes every user's monthly_impressions counter.
router.get(
  '/leaderboard',
  wrap(async (req, res) => {
    const cycle = await cycleService.getOrCreateOpenCycle();
    const rows = await rpc('leaderboard_top', { p_limit: 20, p_requesting_user_id: req.user.id });
    res.json({ monthLabel: cycle.month_label, entries: rows });
  })
);

// ---- AdsGram ad flow ----
// Step 1: client asks to start an ad -> server checks limits & returns block id
router.post(
  '/ads/request',
  adRequestLimiter,
  wrap(async (req, res) => {
    const u = req.user;
    if (!u.country_id) return res.status(400).json({ error: 'country_not_set' });
    if (u.status === 'suspended') return res.status(403).json({ error: 'account_suspended' });

    const dailyLimit = parseInt(await cpmService.getSetting('daily_ad_limit', '100'), 10);
    const minInterval = parseInt(await cpmService.getSetting('min_ad_interval_seconds', '20'), 10);
    const today = todayStr();

    const gate = await rpc('ad_request_gate', {
      p_user_id: u.id,
      p_date: today,
      p_daily_limit: dailyLimit,
      p_min_interval: minInterval,
    });
    if (gate.error === 'too_soon') {
      return res.status(429).json({ error: 'too_soon', retryAfterSeconds: gate.retryAfterSeconds });
    }
    if (gate.error) return res.status(429).json({ error: gate.error });

    const sessionId = crypto.randomBytes(24).toString('hex');
    const cycle = await cycleService.getOrCreateOpenCycle();

    must(
      await supabase.from('impressions').insert({
        user_id: u.id,
        country_id: u.country_id,
        cycle_id: cycle.id,
        impression_date: today,
        ad_block_id: process.env.ADSGRAM_REWARD_BLOCK_ID || null,
        ad_session_id: sessionId,
        impression_status: 'requested',
      })
    );

    res.json({ sessionId, blockId: process.env.ADSGRAM_REWARD_BLOCK_ID });
  })
);

// Step 2: client reports the AdsGram reward callback fired (ad watched fully).
// This only marks the impression "completed" — it becomes a paid/valid
// impression only after passing server-side validation below.
router.post(
  '/ads/complete',
  wrap(async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'missing_session' });

    const impression = must(
      await supabase
        .from('impressions')
        .select('*')
        .eq('ad_session_id', sessionId)
        .eq('user_id', req.user.id)
        .maybeSingle()
    );
    if (!impression) return res.status(404).json({ error: 'session_not_found' });
    if (impression.impression_status !== 'requested') {
      return res.status(409).json({ error: 'already_processed' });
    }

    // Server-side sanity check: an ad cannot realistically complete in under ~4s.
    const elapsedMs = Date.now() - new Date(impression.requested_at).getTime();
    const valid = elapsedMs >= 4000;

    // Conditional update: only one concurrent request can flip 'requested' -> final state.
    const updated = must(
      await supabase
        .from('impressions')
        .update({
          impression_status: valid ? 'counted' : 'rejected',
          validation_status: valid ? 'valid' : 'suspicious',
          completed_at: new Date().toISOString(),
        })
        .eq('id', impression.id)
        .eq('impression_status', 'requested')
        .select('id')
    );
    if (!updated.length) return res.status(409).json({ error: 'already_processed' });

    if (!valid) {
      return res.status(400).json({ error: 'validation_failed' });
    }

    const result = await cpmService.recordCountedImpression({
      userId: req.user.id,
      countryId: impression.country_id,
      cycleId: impression.cycle_id,
      date: impression.impression_date,
    });

    res.json({ ok: true, pending: result.pending });
  })
);

// ---- Withdrawals ----
router.post(
  '/withdraw',
  wrap(async (req, res) => {
    const withdrawalsOpen = (await cpmService.getSetting('withdrawals_open', 'false')) === 'true';
    if (!withdrawalsOpen) {
      return res.status(423).json({ error: 'withdrawals_locked' });
    }

    if (!req.user.country_id) return res.status(400).json({ error: 'country_not_set' });

    const { amount, method, accountInfo } = req.body;
    const minAmount = parseFloat(await cpmService.getSetting('min_withdraw_amount', '1.00'));
    const amt = Math.round(Number(amount) * 10000) / 10000;

    if (!amt || amt < minAmount) {
      return res.status(400).json({ error: 'amount_below_minimum', minAmount });
    }
    if (!method || !accountInfo) {
      return res.status(400).json({ error: 'missing_payment_details' });
    }
    if (String(method).toUpperCase() !== 'GRAM') {
      return res.status(400).json({ error: 'invalid_method' });
    }

    try {
      const withdrawalId = await rpc('request_withdrawal', {
        p_user_id: req.user.id,
        p_amount: amt,
        p_method: 'GRAM',
        p_account_info: String(accountInfo).trim().slice(0, 200),
        p_cycle_id: req.user.current_cycle_id,
      });
      res.json({ ok: true, withdrawalId });
    } catch (err) {
      if (err.message === 'insufficient_balance') {
        return res.status(400).json({ error: 'insufficient_balance' });
      }
      throw err;
    }
  })
);

router.get(
  '/withdraw/history',
  wrap(async (req, res) => {
    const rows = must(
      await supabase
        .from('withdrawals')
        .select('id, amount, method, status, requested_at, paid_at')
        .eq('user_id', req.user.id)
        .order('id', { ascending: false })
        .limit(50)
    );
    res.json(rows);
  })
);

module.exports = router;
