-- ─────────────────────────────────────────────────────────────────────────────
-- LSSW Migration 002: LinkedIn Sessions + Search Results persistence
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── linkedin_sessions ───────────────────────────────────────────────────────
-- Stores encrypted LinkedIn session cookies (li_at, JSESSIONID) per user.
-- Allows cookies to survive server restarts without re-entry by the user.

CREATE TABLE IF NOT EXISTS linkedin_sessions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    li_at       TEXT        NOT NULL,   -- AES-256 encrypted li_at cookie
    jsessionid  TEXT        NOT NULL,   -- AES-256 encrypted JSESSIONID cookie
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_sessions_user_id ON linkedin_sessions(user_id);

COMMENT ON TABLE linkedin_sessions IS
  'Encrypted LinkedIn session cookies per user. Enables persistent scraping sessions without re-entry.';
COMMENT ON COLUMN linkedin_sessions.li_at IS
  'AES-256 encrypted li_at cookie value from linkedin.com';
COMMENT ON COLUMN linkedin_sessions.jsessionid IS
  'AES-256 encrypted JSESSIONID cookie value from linkedin.com';

-- ─── search_results ──────────────────────────────────────────────────────────
-- Stores the full JSON results for each completed search.
-- Replaces the ephemeral Redis-only cache with persistent DB storage.
-- Subject to the same 90-day GDPR purge as search_history.

CREATE TABLE IF NOT EXISTS search_results (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    search_history_id UUID        NOT NULL REFERENCES search_history(id) ON DELETE CASCADE,
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    results_json      JSONB       NOT NULL DEFAULT '[]',
    total_count       INTEGER     NOT NULL DEFAULT 0,
    page_number       INTEGER     NOT NULL DEFAULT 1,
    has_more          BOOLEAN     NOT NULL DEFAULT FALSE,
    duration_ms       INTEGER,
    stored_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- GDPR: auto-purge after 90 days, same policy as search_history
    purge_due_at      TIMESTAMPTZ GENERATED ALWAYS AS (stored_at + INTERVAL '90 days') STORED,
    UNIQUE (search_history_id)
);

CREATE INDEX IF NOT EXISTS idx_search_results_user_id ON search_results(user_id);
CREATE INDEX IF NOT EXISTS idx_search_results_history_id ON search_results(search_history_id);
CREATE INDEX IF NOT EXISTS idx_search_results_purge ON search_results(purge_due_at);

COMMENT ON TABLE search_results IS
  'Full JSON candidate results per search. Persistent alternative to Redis cache. GDPR-purged at 90 days.';

-- ─── Schema version ──────────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, description)
VALUES ('002', 'linkedin_sessions + search_results tables for persistent storage')
ON CONFLICT (version) DO NOTHING;
