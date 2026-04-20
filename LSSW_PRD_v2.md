# LinkedIn Smart Search Wrapper (LSSW) — Product Requirements Document v2.0

**Domain:** deepakkulkarni.space  
**Stack:** Node.js 20 + TypeScript · React 18 + Vite · PostgreSQL 15 · Redis 7 · Playwright (stealth) · Docker Compose  
**Hosting:** Hostinger VPS (EU/Frankfurt) · GitHub Actions CI/CD · GHCR image registry  
**Last updated:** April 2026

---

## 1. Overview

LSSW is a self-hosted LinkedIn people-search tool. It uses a Playwright headless Chromium browser (with stealth anti-detection) to execute searches against LinkedIn on behalf of an authenticated user, then displays structured candidate results. Authentication is via LinkedIn OAuth 2.0. All data is stored in EU infrastructure in compliance with GDPR.

### What's new in v2

| Area | v1 | v2 |
|---|---|---|
| Code management | Files edited directly on VPS | GitHub repo + GitHub Actions CI/CD |
| LinkedIn session cookies | Redis only (1hr TTL, lost on restart) | PostgreSQL (encrypted, persistent) — editable from Settings |
| Search results | Redis cache only (10min TTL) | PostgreSQL (permanent, GDPR-purged at 90 days) |
| Deployment | Manual `docker build` on VPS | `git push main` triggers full build + deploy pipeline |

---

## 2. User Personas

**Primary user: Deepak (solo recruiter/operator)**
- Runs LinkedIn people searches to find candidates
- Wants results to persist across sessions so he can revisit them
- Doesn't want to re-enter LinkedIn cookies every time the server restarts
- Wants the app to be maintainable via code changes without SSH every time

---

## 3. Core Features

### 3.1 LinkedIn Search (Playwright + Stealth)

- User enters search criteria: keywords, title, company, location, school, connection degree, company size, years of experience, or a custom Boolean string
- Backend builds a LinkedIn search URL and navigates with a headless Chromium browser
- Stealth mode (`playwright-extra` + `puppeteer-extra-plugin-stealth`) prevents bot detection fingerprinting
- Results are extracted via DOM traversal walking upward from `a[href*="/in/"]` links
- Results stored in PostgreSQL `search_results` table (persistent) AND Redis cache (for speed)
- Page shows: name, title, company, location, headline, profile URL, profile pic, connection degree, Open to Work badge, mutual connections

### 3.2 LinkedIn Session Management (v2 NEW)

**Problem:** The Playwright browser needs valid `li_at` + `JSESSIONID` cookies from a real logged-in LinkedIn browser session. In v1 these were ephemeral (Redis, 1hr TTL). In v2 they are persisted in the database per user.

**Flow:**
1. User logs into LinkedIn in their browser
2. Opens DevTools → Application → Cookies → `linkedin.com`
3. Copies `li_at` value and `JSESSIONID` value
4. Goes to Settings → LinkedIn Session → pastes both values → Save
5. Backend encrypts and stores in `linkedin_sessions` table
6. On every search, backend loads cookies from DB, injects into Playwright context
7. Settings page shows: last updated time, estimated expiry (~24hrs), and a status indicator
8. User can update cookies any time from the same screen

**Cookie lifecycle:**
- `li_at` tokens typically last 1 year but LinkedIn may revoke them earlier if suspicious activity is detected
- If a search returns `LINKEDIN_SESSION_EXPIRED`, the UI shows a clear prompt: "Your LinkedIn session has expired — update your session in Settings"

### 3.3 Persistent Search Results (v2 NEW)

**Problem:** In v1, results lived only in Redis with a 10-minute TTL. After TTL or server restart, results were gone permanently.

**New behavior:**
- After a successful search, results JSON is stored in `search_results` table tied to the `search_history` entry
- Results page loads from DB — results survive server restarts and Redis flushes
- History page shows past searches with a "View Results" link that loads from DB
- Results are subject to GDPR 90-day auto-purge (same as search history)

### 3.4 Authentication (LinkedIn OAuth 2.0 PKCE)

- User authenticates via LinkedIn OAuth — no username/password required
- Session managed with `express-session` + `connect-redis` + `connect-pg-simple`
- GDPR consent gate on first login

### 3.5 Saved Searches

- User can save a search configuration with a name
- Saved searches can be re-run from the history or saved searches page
- Saved searches persist in DB

### 3.6 Search History

- Every search is logged (params, status, result count, duration)
- Up to 50 entries per user (auto-trimmed)
- Auto-purged at 90 days (GDPR Art. 5 storage limitation)

---

## 4. Architecture

```
Browser (user)
    │
    ▼
Nginx (reverse proxy + SSL/Let's Encrypt)
    │
    ├──► React SPA (lssw-frontend container, port 80)
    │
    └──► Node.js API (lssw-app container, port 3000)
              │
              ├──► PostgreSQL (lssw-db container)
              │       • users
              │       • linkedin_sessions  ← NEW
              │       • search_results     ← NEW
              │       • search_history
              │       • saved_searches
              │       • gdpr_audit_log
              │
              ├──► Redis (lssw-redis container)
              │       • sessions
              │       • job status (300s TTL)
              │       • result cache (600s TTL, supplemental)
              │       • rate limit counters
              │       • browser context state (1hr TTL)
              │
              └──► Playwright Chromium (in-process, stealth mode)
                       • loads linkedin_sessions cookies from DB
                       • executes LinkedIn people search
                       • returns structured CandidateCard[]
```

### 4.1 CI/CD Pipeline

```
git push main
    │
    ▼
GitHub Actions
    ├── Job 1: Lint + TypeScript typecheck (backend + frontend)
    ├── Job 2: Unit tests (with Postgres + Redis services)
    ├── Job 3: Build Docker images → push to GHCR
    └── Job 4: SSH deploy to Hostinger VPS
              └── docker compose pull && docker compose up -d
```

**Required GitHub Secrets:**

| Secret | Value |
|---|---|
| `HOSTINGER_HOST` | VPS IP: `187.127.153.25` |
| `HOSTINGER_USER` | `root` |
| `HOSTINGER_SSH_KEY` | Private SSH key (generate with `ssh-keygen -t ed25519`) |
| `HOSTINGER_SSH_PORT` | `22` (or custom port if changed) |

GHCR auth is handled automatically via `secrets.GITHUB_TOKEN`.

---

## 5. Database Schema (v2)

### 5.1 New: `linkedin_sessions`

Stores encrypted LinkedIn session cookies per user. One row per user (UNIQUE on `user_id`). Upserted on save.

```sql
CREATE TABLE linkedin_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  li_at       TEXT NOT NULL,         -- AES-256 encrypted
  jsessionid  TEXT NOT NULL,         -- AES-256 encrypted
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (user_id)
);
```

### 5.2 New: `search_results`

Stores the full results JSON for each completed search. One row per search history entry.

```sql
CREATE TABLE search_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_history_id   UUID NOT NULL REFERENCES search_history(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  results_json        JSONB NOT NULL DEFAULT '[]',
  total_count         INTEGER NOT NULL DEFAULT 0,
  page_number         INTEGER NOT NULL DEFAULT 1,
  has_more            BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms         INTEGER,
  stored_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purge_due_at        TIMESTAMPTZ GENERATED ALWAYS AS (stored_at + INTERVAL '90 days') STORED,
  UNIQUE (search_history_id)
);
```

---

## 6. API Endpoints (v2)

### Existing (unchanged)
- `GET  /auth/linkedin` — Initiate OAuth
- `GET  /auth/linkedin/callback` — OAuth callback
- `POST /auth/gdpr-consent` — Record GDPR consent
- `POST /auth/logout`
- `GET  /auth/me`
- `POST /api/search` — Submit search (async, returns jobId)
- `GET  /api/search/status/:jobId` — Poll job status
- `GET  /api/search/stream/:jobId` — SSE stream
- `GET  /api/search/results/:jobId` — Get results (now also reads from DB)
- `GET  /api/search/rate-limit`
- `GET  /api/history`
- `GET  /api/saved-searches`

### New in v2
- `GET  /auth/linkedin-session` — Get current session status (masked li_at, updated_at)
- `POST /auth/linkedin-session` — Save li_at + jsessionid (encrypted to DB)
- `DELETE /auth/linkedin-session` — Clear stored session
- `GET  /api/history/:historyId/results` — Fetch stored results for a past search

---

## 7. Frontend Pages (v2)

### Settings Page (updated)
Adds a new "LinkedIn Session" card:
- Shows current session status (active/not set/expired)
- Shows last updated date
- Form: `li_at` textarea + `JSESSIONID` input + Save button
- Help text: step-by-step instructions for extracting cookies from Chrome DevTools
- Clear Session button

### Results Page (updated)
- Job polling unchanged
- On completion, results are loaded from API (which now reads from DB)
- "View in History" link added to results header so user can return to results later

### History Page (updated)
- Each history entry now has "View Results" button (if results exist in DB)
- Clicking navigates to results page populated from DB

---

## 8. Security & GDPR

- LinkedIn cookies stored AES-256 encrypted in DB (same `SESSION_ENCRYPTION_KEY` as OAuth tokens)
- Search results subject to 90-day GDPR auto-purge
- `linkedin_sessions` row deleted when user deletes account (CASCADE)
- `search_results` rows deleted when user deletes account (CASCADE)
- GDPR export includes linkedin_session updated_at (not the cookie values)
- All cookies transmitted over HTTPS only

---

## 9. Deployment Runbook (first setup)

### On GitHub
1. Create repo: `github.com/[USERNAME]/lssw`
2. Push code: `git remote add origin git@github.com:[USERNAME]/lssw.git && git push -u origin main`
3. Add GitHub Secrets (Settings → Secrets → Actions): `HOSTINGER_HOST`, `HOSTINGER_USER`, `HOSTINGER_SSH_KEY`
4. Enable Packages (GHCR) for the repo

### On VPS (one-time)
1. Add the deploy SSH public key to `/root/.ssh/authorized_keys`
2. Ensure `/opt/lssw/.env` has all real values (no placeholders)
3. Update `docker-compose.yml` to use GHCR images (not `lssw-app:local`)
4. Run migration 002: `docker exec lssw-db psql -U $POSTGRES_USER -d lssw -f /docker-entrypoint-initdb.d/002_linkedin_sessions_and_results.sql`

### After every push to main
GitHub Actions automatically: lint → test → build → push to GHCR → SSH deploy → health check

---

## 10. Out of Scope (v2)

- LinkedIn API (official) integration — scraping only
- Multi-user tenancy / team accounts
- Email notifications
- CSV/Excel export of results
- LinkedIn Premium filters (companySize, yearsOfExperience) — may not work without Premium account
