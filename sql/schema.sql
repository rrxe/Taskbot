-- ============================================================
-- AdsGram TMA Revenue-Share Bot — PostgreSQL Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
    key             VARCHAR(64) PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
    ('withdrawals_open', 'false'),
    ('daily_ad_limit', '100'),
    ('min_ad_interval_seconds', '20'),
    ('user_share_percent', '80'),
    ('platform_share_percent', '20'),
    ('min_withdraw_amount', '1.00')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS countries (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    code            VARCHAR(10)  NOT NULL UNIQUE,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_cycles (
    id                  SERIAL PRIMARY KEY,
    month_label         VARCHAR(20) NOT NULL,      -- e.g. '2026-09'
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    total_impressions   BIGINT NOT NULL DEFAULT 0,
    total_revenue        NUMERIC(14,4) NOT NULL DEFAULT 0,
    users_share          NUMERIC(14,4) NOT NULL DEFAULT 0,
    platform_share        NUMERIC(14,4) NOT NULL DEFAULT 0,
    status              VARCHAR(20) NOT NULL DEFAULT 'open', -- open | closed
    closed_at           TIMESTAMPTZ,
    payment_confirmed_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (month_label)
);

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                  BIGSERIAL PRIMARY KEY,
    telegram_id         BIGINT NOT NULL UNIQUE,
    username            VARCHAR(64),
    first_name          VARCHAR(128),
    country_id          INTEGER REFERENCES countries(id),
    current_cycle_id    INTEGER REFERENCES monthly_cycles(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'active', -- active | suspended
    balance_pending      NUMERIC(14,4) NOT NULL DEFAULT 0,
    balance_available    NUMERIC(14,4) NOT NULL DEFAULT 0,
    balance_paid         NUMERIC(14,4) NOT NULL DEFAULT 0,
    monthly_impressions BIGINT NOT NULL DEFAULT 0,
    referrer_id         BIGINT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_country ON users(country_id);

-- ------------------------------------------------------------
-- CPM is tied to (country + date), never to a fixed date-less value.
CREATE TABLE IF NOT EXISTS daily_country_cpm (
    id              SERIAL PRIMARY KEY,
    country_id      INTEGER NOT NULL REFERENCES countries(id),
    cpm_date        DATE NOT NULL,
    cpm             NUMERIC(10,4) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT, -- admin telegram id
    UNIQUE (country_id, cpm_date)
);

-- ------------------------------------------------------------
-- Every ad lifecycle event is recorded, not just the "counted" ones,
-- so Requested / Completed / Valid-Impression / Revenue stay separate.
CREATE TABLE IF NOT EXISTS impressions (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(id),
    country_id          INTEGER NOT NULL REFERENCES countries(id),
    cycle_id            INTEGER NOT NULL REFERENCES monthly_cycles(id),
    impression_date     DATE NOT NULL,
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    ad_block_id         VARCHAR(64),
    ad_session_id       VARCHAR(128) UNIQUE, -- AdsGram session/reward token, prevents duplicates
    impression_status   VARCHAR(20) NOT NULL DEFAULT 'requested',
        -- requested | completed | counted | rejected
    validation_status   VARCHAR(20) NOT NULL DEFAULT 'pending',
        -- pending | valid | invalid | suspicious
    ip_hash             VARCHAR(64),
    user_agent_hash     VARCHAR(64),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impr_user_date ON impressions(user_id, impression_date);
CREATE INDEX IF NOT EXISTS idx_impr_country_date ON impressions(country_id, impression_date);
CREATE INDEX IF NOT EXISTS idx_impr_status ON impressions(impression_status, validation_status);

-- ------------------------------------------------------------
-- One row per user + country + day. Recalculated whenever CPM
-- for that (country, date) is entered or edited.
CREATE TABLE IF NOT EXISTS user_daily_stats (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    country_id      INTEGER NOT NULL REFERENCES countries(id),
    stat_date       DATE NOT NULL,
    cycle_id        INTEGER NOT NULL REFERENCES monthly_cycles(id),
    impressions     BIGINT NOT NULL DEFAULT 0,
    cpm             NUMERIC(10,4),              -- NULL = CPM not set yet ("Pending")
    gross_revenue   NUMERIC(14,6) NOT NULL DEFAULT 0,
    user_share      NUMERIC(14,6) NOT NULL DEFAULT 0,
    platform_share  NUMERIC(14,6) NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending_cpm', -- pending_cpm | calculated
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, country_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_uds_country_date ON user_daily_stats(country_id, stat_date);

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawals (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(id),
    cycle_id            INTEGER REFERENCES monthly_cycles(id),
    amount              NUMERIC(14,4) NOT NULL,
    method              VARCHAR(40),      -- e.g. USDT / Wallet / etc.
    account_info        TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|approved|rejected|paid
    admin_id            BIGINT,
    payment_reference   VARCHAR(128),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id                  BIGSERIAL PRIMARY KEY,
    cycle_id            INTEGER NOT NULL REFERENCES monthly_cycles(id),
    user_id             BIGINT NOT NULL REFERENCES users(id),
    amount              NUMERIC(14,4) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'paid',
    paid_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    payment_reference   VARCHAR(128),
    admin_id            BIGINT
);

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    admin_id        BIGINT NOT NULL,
    action          VARCHAR(64) NOT NULL,
    entity          VARCHAR(64),
    entity_id       VARCHAR(64),
    old_value       JSONB,
    new_value       JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Simple anti-abuse: last request timestamps per user for rate limiting
CREATE TABLE IF NOT EXISTS ad_rate_limits (
    user_id         BIGINT PRIMARY KEY REFERENCES users(id),
    last_request_at TIMESTAMPTZ,
    requests_today  INTEGER NOT NULL DEFAULT 0,
    day_reset_date  DATE
);

-- ------------------------------------------------------------
-- Countries are NOT seeded: add them from the Admin panel.

-- ------------------------------------------------------------
-- Supabase security: block public REST access (anon key).
-- The backend connects directly via DATABASE_URL, which bypasses RLS.
ALTER TABLE settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE countries           ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_cycles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_country_cpm   ENABLE ROW LEVEL SECURITY;
ALTER TABLE impressions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_daily_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_rate_limits      ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Server-side functions (used by the backend via supabase.rpc)
-- Everything that touches money runs inside ONE transaction here.
-- ============================================================

CREATE OR REPLACE FUNCTION get_setting_num(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT value::numeric FROM settings WHERE key = p_key), p_default)
$$;

-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_or_create_open_cycle()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    c monthly_cycles;
    d date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
    SELECT * INTO c FROM monthly_cycles WHERE status = 'open' ORDER BY id DESC LIMIT 1;
    IF FOUND THEN
        RETURN to_jsonb(c);
    END IF;

    INSERT INTO monthly_cycles (month_label, start_date, end_date, status)
    VALUES (
        to_char(d, 'YYYY-MM'),
        date_trunc('month', d)::date,
        (date_trunc('month', d) + interval '1 month')::date - 1,
        'open'
    )
    ON CONFLICT (month_label) DO UPDATE SET month_label = EXCLUDED.month_label
    RETURNING * INTO c;

    RETURN to_jsonb(c);
END $$;

-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION end_month(p_admin_id bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    cyc  monthly_cycles;
    newc monthly_cycles;
    t    record;
    nm   date;
BEGIN
    SELECT * INTO cyc FROM monthly_cycles WHERE status = 'open' ORDER BY id DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no_open_cycle';
    END IF;

    SELECT COALESCE(SUM(impressions), 0)   AS total_impressions,
           COALESCE(SUM(gross_revenue), 0) AS total_revenue,
           COALESCE(SUM(user_share), 0)    AS users_share,
           COALESCE(SUM(platform_share), 0) AS platform_share
      INTO t
      FROM user_daily_stats WHERE cycle_id = cyc.id;

    UPDATE monthly_cycles
       SET status = 'closed', closed_at = now(), payment_confirmed_at = now(),
           total_impressions = t.total_impressions, total_revenue = t.total_revenue,
           users_share = t.users_share, platform_share = t.platform_share
     WHERE id = cyc.id
    RETURNING * INTO cyc;

    INSERT INTO payments (cycle_id, user_id, amount, status, admin_id)
    SELECT cyc.id, id, balance_available, 'paid', p_admin_id
      FROM users WHERE balance_available > 0;

    UPDATE users
       SET balance_paid = balance_paid + balance_available,
           balance_available = 0,
           monthly_impressions = 0,
           updated_at = now();

    nm := (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month')::date;

    INSERT INTO monthly_cycles (month_label, start_date, end_date, status)
    VALUES (to_char(nm, 'YYYY-MM'), nm, (nm + interval '1 month')::date - 1, 'open')
    ON CONFLICT (month_label) DO UPDATE SET month_label = EXCLUDED.month_label
    RETURNING * INTO newc;

    INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, new_value)
    VALUES (p_admin_id, 'end_month', 'monthly_cycles', cyc.id::text, to_jsonb(t));

    RETURN jsonb_build_object('closedCycle', to_jsonb(cyc), 'newCycle', to_jsonb(newc));
END $$;

-- ------------------------------------------------------------
-- Admin sets/updates CPM for (country, date) and every affected
-- user_daily_stats row + user balance is recalculated atomically.
CREATE OR REPLACE FUNCTION set_daily_cpm(p_country_id int, p_date date, p_cpm numeric, p_admin_id bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_old     numeric;
    v_user_pct numeric := get_setting_num('user_share_percent', 80);
    v_plat_pct numeric := get_setting_num('platform_share_percent', 20);
    r         record;
    v_gross   numeric;
    v_ushare  numeric;
    v_pshare  numeric;
    v_delta   numeric;
    n         int := 0;
BEGIN
    IF p_cpm IS NULL OR p_cpm < 0 THEN
        RAISE EXCEPTION 'invalid_cpm';
    END IF;

    SELECT cpm INTO v_old FROM daily_country_cpm WHERE country_id = p_country_id AND cpm_date = p_date;

    INSERT INTO daily_country_cpm (country_id, cpm_date, cpm, updated_by)
    VALUES (p_country_id, p_date, p_cpm, p_admin_id)
    ON CONFLICT (country_id, cpm_date)
    DO UPDATE SET cpm = EXCLUDED.cpm, updated_by = EXCLUDED.updated_by, updated_at = now();

    FOR r IN
        SELECT id, user_id, impressions, user_share
          FROM user_daily_stats
         WHERE country_id = p_country_id AND stat_date = p_date
           FOR UPDATE
    LOOP
        v_gross  := round((r.impressions::numeric / 1000) * p_cpm, 6);
        v_ushare := round(v_gross * v_user_pct / 100, 6);
        v_pshare := round(v_gross * v_plat_pct / 100, 6);
        v_delta  := v_ushare - COALESCE(r.user_share, 0);

        UPDATE user_daily_stats
           SET cpm = p_cpm, gross_revenue = v_gross, user_share = v_ushare,
               platform_share = v_pshare, status = 'calculated', updated_at = now()
         WHERE id = r.id;

        IF v_delta <> 0 THEN
            UPDATE users SET balance_available = balance_available + v_delta, updated_at = now()
             WHERE id = r.user_id;
        END IF;
        n := n + 1;
    END LOOP;

    INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, old_value, new_value)
    VALUES (p_admin_id, 'set_daily_cpm', 'daily_country_cpm', p_country_id::text || ':' || p_date::text,
            jsonb_build_object('cpm', v_old), jsonb_build_object('cpm', p_cpm));

    RETURN jsonb_build_object('affectedUsers', n);
END $$;

-- ------------------------------------------------------------
-- One validated ad impression: +1 for today; if CPM is already set,
-- earnings are calculated immediately, otherwise stays "pending_cpm".
CREATE OR REPLACE FUNCTION record_counted_impression(p_user_id bigint, p_country_id int, p_cycle_id int, p_date date)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_cpm      numeric;
    v_user_pct numeric := get_setting_num('user_share_percent', 80);
    v_plat_pct numeric := get_setting_num('platform_share_percent', 20);
    r          record;
    v_gross    numeric;
    v_ushare   numeric;
    v_pshare   numeric;
    v_delta    numeric;
BEGIN
    SELECT cpm INTO v_cpm FROM daily_country_cpm WHERE country_id = p_country_id AND cpm_date = p_date;

    INSERT INTO user_daily_stats (user_id, country_id, stat_date, cycle_id, impressions, status)
    VALUES (p_user_id, p_country_id, p_date, p_cycle_id, 1, 'pending_cpm')
    ON CONFLICT (user_id, country_id, stat_date)
    DO UPDATE SET impressions = user_daily_stats.impressions + 1, updated_at = now()
    RETURNING id, impressions, user_share INTO r;

    IF v_cpm IS NOT NULL THEN
        v_gross  := round((r.impressions::numeric / 1000) * v_cpm, 6);
        v_ushare := round(v_gross * v_user_pct / 100, 6);
        v_pshare := round(v_gross * v_plat_pct / 100, 6);
        v_delta  := v_ushare - COALESCE(r.user_share, 0);

        UPDATE user_daily_stats
           SET cpm = v_cpm, gross_revenue = v_gross, user_share = v_ushare,
               platform_share = v_pshare, status = 'calculated', updated_at = now()
         WHERE id = r.id;

        IF v_delta <> 0 THEN
            UPDATE users SET balance_available = balance_available + v_delta, updated_at = now()
             WHERE id = p_user_id;
        END IF;
    END IF;

    UPDATE users SET monthly_impressions = monthly_impressions + 1, updated_at = now()
     WHERE id = p_user_id;

    RETURN jsonb_build_object('pending', v_cpm IS NULL);
END $$;

-- ------------------------------------------------------------
-- Atomic rate-limit gate for ad requests (min interval + daily cap).
CREATE OR REPLACE FUNCTION ad_request_gate(p_user_id bigint, p_date date, p_daily_limit int, p_min_interval int)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    r     ad_rate_limits;
    secs  numeric;
    v_cnt int;
BEGIN
    INSERT INTO ad_rate_limits (user_id, requests_today, day_reset_date)
    VALUES (p_user_id, 0, p_date)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO r FROM ad_rate_limits WHERE user_id = p_user_id FOR UPDATE;

    v_cnt := CASE WHEN r.day_reset_date = p_date THEN r.requests_today ELSE 0 END;

    IF r.last_request_at IS NOT NULL THEN
        secs := EXTRACT(EPOCH FROM (now() - r.last_request_at));
        IF secs < p_min_interval THEN
            RETURN jsonb_build_object('error', 'too_soon',
                                      'retryAfterSeconds', ceil(p_min_interval - secs)::int);
        END IF;
    END IF;

    IF v_cnt >= p_daily_limit THEN
        RETURN jsonb_build_object('error', 'daily_limit_reached');
    END IF;

    UPDATE ad_rate_limits
       SET last_request_at = now(), requests_today = v_cnt + 1, day_reset_date = p_date
     WHERE user_id = p_user_id;

    RETURN jsonb_build_object('ok', true);
END $$;

-- ------------------------------------------------------------
-- Withdrawal request: balance check + deduction + insert, atomically.
CREATE OR REPLACE FUNCTION request_withdrawal(p_user_id bigint, p_amount numeric, p_method text, p_account_info text, p_cycle_id int)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    wid bigint;
BEGIN
    UPDATE users
       SET balance_available = balance_available - p_amount, updated_at = now()
     WHERE id = p_user_id AND balance_available >= p_amount;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient_balance';
    END IF;

    INSERT INTO withdrawals (user_id, cycle_id, amount, method, account_info, status)
    VALUES (p_user_id, p_cycle_id, p_amount, p_method, p_account_info, 'pending')
    RETURNING id INTO wid;

    RETURN wid;
END $$;

-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_withdrawal_status(p_id bigint, p_status text, p_admin_id bigint, p_ref text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    wd withdrawals;
BEGIN
    IF p_status NOT IN ('approved', 'rejected', 'paid') THEN
        RAISE EXCEPTION 'invalid_status';
    END IF;

    SELECT * INTO wd FROM withdrawals WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found';
    END IF;
    IF wd.status IN ('rejected', 'paid') THEN
        RAISE EXCEPTION 'withdrawal_already_final';
    END IF;

    IF p_status = 'rejected' THEN
        UPDATE users SET balance_available = balance_available + wd.amount, updated_at = now()
         WHERE id = wd.user_id;
    ELSIF p_status = 'paid' THEN
        UPDATE users SET balance_paid = balance_paid + wd.amount, updated_at = now()
         WHERE id = wd.user_id;
    END IF;

    UPDATE withdrawals
       SET status = p_status, admin_id = p_admin_id, payment_reference = p_ref,
           paid_at = CASE WHEN p_status = 'paid' THEN now() ELSE paid_at END
     WHERE id = p_id
    RETURNING * INTO wd;

    RETURN to_jsonb(wd);
END $$;

-- ------------------------------------------------------------
-- Read helpers (aggregations for the admin panel / user history)
CREATE OR REPLACE FUNCTION cycle_totals(p_cycle_id int)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'impressions',    COALESCE(SUM(impressions), 0),
        'revenue',        COALESCE(SUM(gross_revenue), 0),
        'users_share',    COALESCE(SUM(user_share), 0),
        'platform_share', COALESCE(SUM(platform_share), 0))
    FROM user_daily_stats WHERE cycle_id = p_cycle_id
$$;

CREATE OR REPLACE FUNCTION pending_payments()
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object('pending_payments', COALESCE(SUM(balance_available), 0)) FROM users
$$;

CREATE OR REPLACE FUNCTION admin_dashboard_counts()
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'totalUsers',      (SELECT COUNT(*) FROM users),
        'activeCountries', (SELECT COUNT(*) FROM countries WHERE enabled = true),
        'pendingWithdrawals', (SELECT jsonb_build_object('c', COUNT(*), 'total', COALESCE(SUM(amount), 0))
                                 FROM withdrawals WHERE status = 'pending'))
$$;

CREATE OR REPLACE FUNCTION admin_countries()
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(
        to_jsonb(c) || jsonb_build_object('user_count', (SELECT COUNT(*) FROM users u WHERE u.country_id = c.id))
        ORDER BY c.sort_order, c.id), '[]'::jsonb)
    FROM countries c
$$;

CREATE OR REPLACE FUNCTION admin_cpm_overview(p_date date)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'country_id',     c.id,
        'name',           c.name,
        'cpm',            dc.cpm,
        'impressions',    s.imps,
        'revenue',        s.rev,
        'users_share',    s.ush,
        'platform_share', s.psh) ORDER BY c.sort_order, c.id), '[]'::jsonb)
    FROM countries c
    LEFT JOIN daily_country_cpm dc ON dc.country_id = c.id AND dc.cpm_date = p_date
    LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(uds.impressions), 0)   AS imps,
               COALESCE(SUM(uds.gross_revenue), 0) AS rev,
               COALESCE(SUM(uds.user_share), 0)    AS ush,
               COALESCE(SUM(uds.platform_share), 0) AS psh
          FROM user_daily_stats uds
         WHERE uds.country_id = c.id AND uds.stat_date = p_date
    ) s ON true
    WHERE c.enabled = true
$$;

CREATE OR REPLACE FUNCTION user_history(p_user_id bigint)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'month_label', mc.month_label,
        'status',      mc.status,
        'impressions', (SELECT COALESCE(SUM(uds.impressions), 0) FROM user_daily_stats uds WHERE uds.cycle_id = mc.id AND uds.user_id = p_user_id),
        'earnings',    (SELECT COALESCE(SUM(uds.user_share), 0)  FROM user_daily_stats uds WHERE uds.cycle_id = mc.id AND uds.user_id = p_user_id),
        'paid',        (SELECT COALESCE(SUM(p.amount), 0)        FROM payments p WHERE p.cycle_id = mc.id AND p.user_id = p_user_id)
    ) ORDER BY mc.id DESC), '[]'::jsonb)
    FROM monthly_cycles mc
$$;

-- ------------------------------------------------------------
-- Monthly leaderboard: top viewers of the currently open cycle,
-- ranked by monthly_impressions. Resets automatically every time
-- end_month() runs (it zeroes monthly_impressions for all users),
-- so no separate "reset" step is ever needed. Only users with at
-- least one counted view this month are listed, and no telegram_id
-- or other private identifier is ever exposed to other users.
CREATE OR REPLACE FUNCTION leaderboard_top(p_limit int DEFAULT 20, p_requesting_user_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'rank',         q.rn,
        'display_name', CASE
                             WHEN q.username IS NOT NULL AND q.username <> '' THEN '@' || q.username
                             WHEN q.first_name IS NOT NULL AND q.first_name <> '' THEN q.first_name
                             ELSE 'Player ' || RIGHT(q.telegram_id::text, 4)
                         END,
        'impressions',  q.monthly_impressions,
        'is_you',       (q.id = p_requesting_user_id)
    ) ORDER BY q.rn), '[]'::jsonb)
    FROM (
        SELECT id, telegram_id, username, first_name, monthly_impressions,
               ROW_NUMBER() OVER (ORDER BY monthly_impressions DESC, id ASC) AS rn
          FROM users
         WHERE monthly_impressions > 0 AND status = 'active'
         ORDER BY monthly_impressions DESC, id ASC
         LIMIT GREATEST(p_limit, 1)
    ) q
$$;

CREATE OR REPLACE FUNCTION admin_search_users(p_search text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.id DESC), '[]'::jsonb)
    FROM (
        SELECT u.id, u.telegram_id, u.username, u.status, u.monthly_impressions,
               u.balance_available, u.balance_paid, c.name AS country, u.created_at
          FROM users u LEFT JOIN countries c ON c.id = u.country_id
         WHERE p_search IS NULL OR p_search = ''
            OR u.username ILIKE '%' || p_search || '%'
            OR u.telegram_id::text = p_search
         ORDER BY u.id DESC
         LIMIT 200
    ) q
$$;

-- ------------------------------------------------------------
-- Only the backend (service_role) may call these functions.
DO $$
DECLARE f record;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('get_setting_num','get_or_create_open_cycle','end_month','set_daily_cpm',
                             'record_counted_impression','ad_request_gate','request_withdrawal',
                             'update_withdrawal_status','cycle_totals','pending_payments',
                             'admin_dashboard_counts','admin_countries','admin_cpm_overview',
                             'user_history','admin_search_users','leaderboard_top')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
