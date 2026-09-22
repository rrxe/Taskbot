const express = require('express');
const jwt = require('jsonwebtoken');
const { supabase, must, rpc } = require('../db');
const { wrap } = require('../utils');
const { adminAuth } = require('../middleware/adminAuth');
const cpmService = require('../services/cpmService');
const cycleService = require('../services/cycleService');

const router = express.Router();

const nowIso = () => new Date().toISOString();
const audit = async (row) => must(await supabase.from('admin_audit_log').insert(row));

// ---- Login (password-based; separate from Telegram auth) ----
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return res.status(401).json({ error: 'invalid_password' });
  }
  const token = jwt.sign({ role: 'admin', adminId: 0 }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

router.use(adminAuth);

// ---- Dashboard ----
router.get(
  '/dashboard',
  wrap(async (req, res) => {
    const [counts, cycle] = await Promise.all([rpc('admin_dashboard_counts'), cycleService.getOrCreateOpenCycle()]);
    const totals = await rpc('cycle_totals', { p_cycle_id: cycle.id });
    res.json({
      totalUsers: counts.totalUsers,
      activeCountries: counts.activeCountries,
      pendingWithdrawals: counts.pendingWithdrawals,
      currentCycle: { ...cycle, ...totals },
    });
  })
);

// ---- Countries ----
router.get(
  '/countries',
  wrap(async (req, res) => {
    res.json(await rpc('admin_countries'));
  })
);

router.post(
  '/countries',
  wrap(async (req, res) => {
    const { name, code, sortOrder } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'missing_fields' });
    const row = must(
      await supabase
        .from('countries')
        .insert({ name: String(name).trim(), code: String(code).trim().toUpperCase(), sort_order: Number(sortOrder) || 0 })
        .select()
        .single()
    );
    res.json(row);
  })
);

router.put(
  '/countries/:id',
  wrap(async (req, res) => {
    const { name, enabled, sortOrder } = req.body;
    const patch = {};
    if (name !== undefined && name !== null) patch.name = name;
    if (enabled !== undefined && enabled !== null) patch.enabled = enabled;
    if (sortOrder !== undefined && sortOrder !== null) patch.sort_order = sortOrder;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing_to_update' });

    const row = must(await supabase.from('countries').update(patch).eq('id', req.params.id).select().maybeSingle());
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  })
);

router.delete(
  '/countries/:id',
  wrap(async (req, res) => {
    const { count, error } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('country_id', req.params.id);
    if (error) throw error;
    if (count > 0) return res.status(409).json({ error: 'country_has_users' });
    must(await supabase.from('countries').delete().eq('id', req.params.id));
    res.json({ ok: true });
  })
);

// ---- Daily CPM ----
router.get(
  '/cpm',
  wrap(async (req, res) => {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const rows = await rpc('admin_cpm_overview', { p_date: targetDate });
    res.json({ date: targetDate, rows });
  })
);

router.post(
  '/cpm',
  wrap(async (req, res) => {
    const { countryId, date, cpm } = req.body;
    if (!countryId || !date || cpm === undefined || cpm === '' || cpm === null) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    const cpmNum = Number(cpm);
    if (!Number.isFinite(cpmNum) || cpmNum < 0) return res.status(400).json({ error: 'invalid_cpm' });

    const result = await cpmService.setDailyCpm(countryId, date, cpmNum, req.admin.adminId);
    res.json({ ok: true, ...result });
  })
);

// ---- Users ----
router.get(
  '/users',
  wrap(async (req, res) => {
    const { search } = req.query;
    res.json(await rpc('admin_search_users', { p_search: search ? String(search) : null }));
  })
);

router.put(
  '/users/:id/status',
  wrap(async (req, res) => {
    const { status } = req.body; // 'active' | 'suspended'
    if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'invalid_status' });

    const row = must(
      await supabase
        .from('users')
        .update({ status, updated_at: nowIso() })
        .eq('id', req.params.id)
        .select('id, status')
        .maybeSingle()
    );
    if (!row) return res.status(404).json({ error: 'not_found' });

    await audit({
      admin_id: req.admin.adminId,
      action: 'set_user_status',
      entity: 'users',
      entity_id: String(req.params.id),
      new_value: { status },
    });
    res.json(row);
  })
);

// ---- Withdrawals ----
router.get(
  '/withdrawals',
  wrap(async (req, res) => {
    const { status } = req.query;
    let q = supabase
      .from('withdrawals')
      .select('*, users(telegram_id, username)')
      .order('id', { ascending: false })
      .limit(200);
    if (status) q = q.eq('status', status);
    const rows = must(await q);
    res.json(rows.map(({ users, ...w }) => ({ ...w, telegram_id: users?.telegram_id, username: users?.username })));
  })
);

router.put('/withdrawals/:id', async (req, res) => {
  const { status, paymentReference } = req.body; // approved | rejected | paid
  try {
    const row = await rpc('update_withdrawal_status', {
      p_id: req.params.id,
      p_status: status,
      p_admin_id: req.admin.adminId,
      p_ref: paymentReference || null,
    });
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- AdsGram config status (read-only; real values are set as env vars) ----
router.get('/ads-config', (req, res) => {
  res.json({
    rewardConfigured: !!process.env.ADSGRAM_REWARD_BLOCK_ID,
    interstitialConfigured: !!process.env.ADSGRAM_INTERSTITIAL_BLOCK_ID,
  });
});

// ---- Settings (includes the withdraw lock switch) ----
router.get(
  '/settings',
  wrap(async (req, res) => {
    const rows = must(await supabase.from('settings').select('key, value'));
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  })
);

router.put(
  '/settings',
  wrap(async (req, res) => {
    const rows = Object.entries(req.body || {}).map(([key, value]) => ({
      key,
      value: String(value),
      updated_at: nowIso(),
    }));
    if (rows.length) must(await supabase.from('settings').upsert(rows, { onConflict: 'key' }));
    await audit({
      admin_id: req.admin.adminId,
      action: 'update_settings',
      entity: 'settings',
      new_value: req.body,
    });
    res.json({ ok: true });
  })
);

// convenience toggle used by the "unlock withdraw" button in the panel
router.post(
  '/withdrawals-toggle',
  wrap(async (req, res) => {
    const { open } = req.body;
    must(
      await supabase
        .from('settings')
        .upsert({ key: 'withdrawals_open', value: open ? 'true' : 'false', updated_at: nowIso() }, { onConflict: 'key' })
    );
    await audit({
      admin_id: req.admin.adminId,
      action: 'toggle_withdrawals',
      entity: 'settings',
      new_value: { open },
    });
    res.json({ ok: true, open: !!open });
  })
);

// ---- Monthly cycles ----
router.get(
  '/cycles',
  wrap(async (req, res) => {
    res.json(must(await supabase.from('monthly_cycles').select('*').order('id', { ascending: false })));
  })
);

router.get(
  '/cycles/current-preview',
  wrap(async (req, res) => {
    const cycle = await cycleService.getOrCreateOpenCycle();
    const [totals, pending] = await Promise.all([rpc('cycle_totals', { p_cycle_id: cycle.id }), rpc('pending_payments')]);
    res.json({ cycle, ...totals, ...pending });
  })
);

router.post('/cycles/end-month', async (req, res) => {
  try {
    const result = await cycleService.endMonth(req.admin.adminId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Audit log ----
router.get(
  '/audit-log',
  wrap(async (req, res) => {
    res.json(must(await supabase.from('admin_audit_log').select('*').order('id', { ascending: false }).limit(300)));
  })
);

module.exports = router;
