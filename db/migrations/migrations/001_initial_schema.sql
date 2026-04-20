-- ─────────────────────────────────────────────────────────────────────────────
-- LinkedIn Smart Search Wrapper — Initial Database Schema
-- Migration: 001
-- GDPR: EU data residency, data minimization, audit logging
-- ─────────────────────────────────────────────────────────────────────────────

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE linkedin_tier AS ENUM ('basic', 'premium', 'recruiter');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE search_status AS ENUM (
        'pending', 'running', 'completed', 'failed', 'rate_limited', 'captcha'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE gdpr_action AS ENUM ('read', 'write', 'delete', 'export');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    linkedin_id           VARCHAR(64) NOT NULL UNIQUE,
    email                 VARCHAR(255),
    full_name             VARCHAR(255) NOT NULL,
    headline              VARCHAR(512),
    profile_pic           TEXT,
    linkedin_tier         linkedin_tier NOT NULL DEFAULT 'premium',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
    -- GDPR compliance fields
    gdpr_consent_at       TIMESTAMPTZ,
    gdpr_consent_version  VARCHAR(20),
    gdpr_consent_ip       VARCHAR(45),
    data_retention_until  TIMESTAMPTZ,
    deletion_requested_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_linkedin_id ON users(linkedin_id);
CREATE INDEX IF NOT EXISTS idx_users_gdpr_consent ON users(gdpr_consent_at);

COMMENT ON TABLE users IS 'User accounts. Minimal data per GDPR Art. 5(1)(c) data minimisation.';
COMMENT ON COLUMN users.gdpr_consent_at IS 'When the user gave explicit consent per GDPR Art. 6(1)(a)';
COMMENT ON COLUMN users.data_retention_until IS 'Scheduled auto-deletion date per retention policy (90 days after last login)';

-- ─── Saved Searches ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS saved_searches (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          VARCHAR(255) NOT NULL,
    description   TEXT,
    search_params JSONB       NOT NULL DEFAULT '{}',
    is_template   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_count     INTEGER     NOT NULL DEFAULT 0,
    last_run_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_params ON saved_searches USING gin(search_params);

COMMENT ON TABLE saved_searches IS 'User-saved compound search configurations. No candidate data stored.';

-- ─── Search History ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS search_history (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    search_params   JSONB         NOT NULL DEFAULT '{}',
    result_count    INTEGER,
    executed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    duration_ms     INTEGER,
    status          search_status NOT NULL DEFAULT 'pending',
    error_message   TEXT,
    saved_search_id UUID          REFERENCES saved_searches(id) ON DELETE SET NULL,
    -- GDPR: auto-purge date (90 days from execution)
    purge_due_at    TIMESTAMPTZ   GENERATED ALWAYS AS (executed_at + INTERVAL '90 days') STORED
);

CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history(user_id);
CREATE INDEX IF NOT EXISTS idx_search_history_executed_at ON search_history(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_history_purge ON search_history(purge_due_at);

COMMENT ON TABLE search_history IS 'Search query log. No candidate profile data. Auto-purged after 90 days per GDPR Art. 5(1)(e) storage limitation.';

-- Auto-trim trigger: max 50 history entries per user
CREATE OR REPLACE FUNCTION trim_search_history()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM search_history
    WHERE user_id = NEW.user_id
      AND id NOT IN (
          SELECT id FROM search_history
          WHERE user_id = NEW.user_id
          ORDER BY executed_at DESC
          LIMIT 50
      );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trim_search_history ON search_history;
CREATE TRIGGER trg_trim_search_history
    AFTER INSERT ON search_history
    FOR EACH ROW EXECUTE FUNCTION trim_search_history();

-- ─── Rate Limit Log (fallback when Redis is unavailable) ──────────────────────

CREATE TABLE IF NOT EXISTS rate_limit_log (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    window_start TIMESTAMPTZ NOT NULL,
    search_count INTEGER     NOT NULL DEFAULT 1,
    UNIQUE (user_id, window_start)
);

-- ─── GDPR Audit Log ───────────────────────────────────────────────────────────
-- This table is intentionally NOT cascade-deleted when user is deleted.
-- Retained for 365 days per applicable law.

CREATE TABLE IF NOT EXISTS gdpr_audit_log (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID         NOT NULL,  -- No FK — survives user deletion
    action     gdpr_action  NOT NULL,
    resource   VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45)  NOT NULL,
    user_agent TEXT,
    details    JSONB        DEFAULT '{}',
    timestamp  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gdpr_audit_user_id   ON gdpr_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_audit_timestamp  ON gdpr_audit_log(timestamp DESC);

COMMENT ON TABLE gdpr_audit_log IS 'GDPR processing audit trail. Retained 365 days. NOT deleted on user erasure.';

-- ─── Row Level Security (optional — enable for multi-tenant isolation) ─────────

-- ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY user_isolation ON saved_searches USING (user_id = current_setting('app.user_id')::uuid);

-- ─── Grants ───────────────────────────────────────────────────────────────────

-- App user should have limited privileges (run as 'lssw' user, not superuser)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'lssw') THEN
        -- User is created by Docker env; this is a safety no-op
        NULL;
    END IF;
END $$;

-- ─── Initial Data ─────────────────────────────────────────────────────────────

-- Insert schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(20) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description TEXT
);

INSERT INTO schema_migrations (version, description)
VALUES ('001', 'Initial schema — users, saved_searches, search_history, gdpr_audit_log')
ON CONFLICT (version) DO NOTHING;
