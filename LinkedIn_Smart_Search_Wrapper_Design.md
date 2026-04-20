# LinkedIn Smart Search Wrapper — Technical Design Document
**Version:** 1.0
**Date:** April 2026
**Status:** Draft — Ready for Engineering Review
**Based on:** PRD v1.0 (April 2025)

---

## Table of Contents

1. [Overview & Scope](#1-overview--scope)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Database Design](#4-database-design)
5. [Backend API Design](#5-backend-api-design)
6. [LinkedIn Adapter Layer](#6-linkedin-adapter-layer)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Security Design](#8-security-design)
9. [Deployment Pipeline](#9-deployment-pipeline)
10. [Docker Architecture](#10-docker-architecture)
11. [Hostinger Deployment Guide](#11-hostinger-deployment-guide)
12. [Monitoring & Observability](#12-monitoring--observability)
13. [Environment Configuration](#13-environment-configuration)
14. [Open Items & Decisions Required](#14-open-items--decisions-required)

---

## 1. Overview & Scope

LinkedIn Smart Search Wrapper is a multi-container web application that enables recruiters to combine LinkedIn's structured people-search filters with free-text Boolean strings in a single query, executing searches via an authenticated browser session and displaying paginated candidate results.

### 1.1 Design Goals

- **Clean separation of concerns** — authentication, search orchestration, LinkedIn adapter, and result storage are independent modules
- **Stateless backend** — all session state lives in Redis; the `app` container can be horizontally scaled without sticky sessions
- **Adapter isolation** — all Playwright/LinkedIn interaction is confined to a dedicated `LinkedInAdapterService`; UI changes to LinkedIn require changes only in that one file
- **Zero credential storage** — no LinkedIn usernames or passwords are ever persisted; only OAuth tokens in server-side sessions
- **Single-command deployment** — `docker compose up -d` brings up the full stack on a fresh Hostinger VPS

### 1.2 Key Constraints

- Max 20 concurrent authenticated users (v1.0)
- Max 30 searches per user per hour (rate limit)
- Search result caching TTL: 10 minutes maximum
- No persistent candidate data storage — results live in Redis cache only
- Target response time: first results within 5 seconds of search submission

---

## 2. System Architecture

### 2.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Hostinger Cloud VPS                          │
│                    (Ubuntu 22.04, 2vCPU / 4GB RAM)                  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   Docker Compose Network                     │   │
│  │                                                              │   │
│  │  ┌─────────────┐     ┌──────────────────────────────────┐   │   │
│  │  │   Certbot   │     │         Nginx (Reverse Proxy)    │   │   │
│  │  │  (SSL Cert  │────▶│     Port 80 → 443 redirect       │   │   │
│  │  │   renewal)  │     │     Port 443 → app:3000          │   │   │
│  │  └─────────────┘     │     /static → frontend:80        │   │   │
│  │                      └──────────────┬───────────────────┘   │   │
│  │                                     │                        │   │
│  │              ┌──────────────────────▼─────────────────────┐ │   │
│  │              │         App Container (Node.js)            │ │   │
│  │              │                                            │ │   │
│  │              │  ┌─────────────┐  ┌──────────────────────┐ │ │   │
│  │              │  │  Auth       │  │  Search Orchestrator  │ │ │   │
│  │              │  │  Service    │  │  (REST API)           │ │ │   │
│  │              │  │  (OAuth2)   │  │                       │ │ │   │
│  │              │  └─────────────┘  └──────────┬────────────┘ │ │   │
│  │              │                              │              │ │   │
│  │              │         ┌────────────────────▼───────────┐ │ │   │
│  │              │         │  LinkedIn Adapter Service      │ │ │   │
│  │              │         │  (Playwright headless browser) │ │ │   │
│  │              │         └────────────────────────────────┘ │ │   │
│  │              └──────────┬─────────────────────────────────┘ │   │
│  │                         │                                    │   │
│  │          ┌──────────────▼──────┐   ┌───────────────────┐    │   │
│  │          │   PostgreSQL 15     │   │    Redis 7         │    │   │
│  │          │   (persistent vol)  │   │  (sessions +       │    │   │
│  │          │                     │   │   rate limits +    │    │   │
│  │          │  - users            │   │   result cache)    │    │   │
│  │          │  - saved_searches   │   └───────────────────┘    │   │
│  │          │  - search_history   │                             │   │
│  │          └─────────────────────┘                             │   │
│  │                                                              │   │
│  │  ┌─────────────────────────────────────────────────────┐    │   │
│  │  │          Frontend Container (React SPA)             │    │   │
│  │  │          Served as static files via Nginx           │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                      ┌────────────────────────┐
                      │  LinkedIn.com          │
                      │  OAuth 2.0 endpoints   │
                      │  People Search pages   │
                      └────────────────────────┘
```

### 2.2 Request Flow — Search Execution

```
Browser          Nginx         App (Node)       LinkedIn Adapter      LinkedIn.com
  │                │                │                    │                  │
  │─── GET / ─────▶│                │                    │                  │
  │◀── React SPA ──│                │                    │                  │
  │                │                │                    │                  │
  │─── OAuth Init ─▶───────────────▶│                    │                  │
  │◀── 302 Redirect to LinkedIn ────│                    │                  │
  │───────────────────────────────────────────────────────────── OAuth ────▶│
  │◀───────────────────────────────────────────────────── auth_code ────────│
  │─── /auth/callback?code=... ─────▶│                   │                  │
  │                │                │─── exchange code ─────────────────────▶│
  │                │                │◀── access_token ──────────────────────│
  │                │                │─ store token in Redis session          │
  │◀── 200 + session cookie ────────│                    │                  │
  │                │                │                    │                  │
  │─── POST /api/search ───────────▶│                    │                  │
  │                │                │─── enqueue job ──▶│                  │
  │                │                │                    │── launch browser ─▶│
  │                │                │                    │◀─ result HTML ────│
  │                │                │◀─ candidate JSON ──│                  │
  │                │                │─── cache in Redis  │                  │
  │                │                │─── save to history │                  │
  │◀── 200 + results JSON ──────────│                    │                  │
```

---

## 3. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend** | React 18 + TypeScript | Typed SPA; rich ecosystem; good accessibility libraries |
| **UI Components** | Tailwind CSS + shadcn/ui | Rapid UI development; LinkedIn-inspired blue palette |
| **State Management** | Zustand | Lightweight; no boilerplate; easy TypeScript integration |
| **Backend** | Node.js 20 LTS + Express | Non-blocking I/O suits long-lived Playwright jobs |
| **Language** | TypeScript | End-to-end type safety shared with frontend |
| **Browser Automation** | Playwright | More reliable than Puppeteer; built-in anti-detection helpers |
| **Database** | PostgreSQL 15 | ACID compliance; JSONB for flexible filter storage |
| **Session Store** | Redis 7 | Fast read/write; built-in TTL; pub/sub for job status |
| **Reverse Proxy** | Nginx | SSL termination; static file serving; rate limiting |
| **SSL** | Let's Encrypt via Certbot | Free; auto-renewing |
| **Containerization** | Docker + Docker Compose v2 | Reproducible; single-command deploy on Hostinger |
| **CI/CD** | GitHub Actions | Automated build, test, push to GHCR, deploy via SSH |

---

## 4. Database Design

### 4.1 Schema Overview

The database stores only application metadata — user accounts, saved searches, and search history references. **No candidate profile data is persisted.** Results are stored transiently in Redis with a 10-minute TTL.

### 4.2 Entity Relationship Diagram

```
┌──────────────────────────────┐
│           users              │
├──────────────────────────────┤
│ id            UUID  PK       │
│ linkedin_id   VARCHAR(64)    │──────────────────────────────────────┐
│ email         VARCHAR(255)   │                                      │
│ full_name     VARCHAR(255)   │                                      │
│ headline      VARCHAR(512)   │                                      │
│ profile_pic   TEXT           │                                      │
│ linkedin_tier ENUM           │  ◄ basic | premium | recruiter       │
│ created_at    TIMESTAMPTZ    │                                      │
│ last_login_at TIMESTAMPTZ    │                                      │
│ is_active     BOOLEAN        │                                      │
└──────────────────────────────┘                                      │
         │ 1                                                          │
         │                                                            │
         │ n                                                          │
┌──────────────────────────────┐         ┌────────────────────────┐  │
│       saved_searches         │         │   search_history       │  │
├──────────────────────────────┤         ├────────────────────────┤  │
│ id          UUID  PK         │         │ id          UUID  PK   │  │
│ user_id     UUID  FK ────────┼────────▶│ user_id     UUID  FK──▶│  │
│ name        VARCHAR(255)     │         │ search_params  JSONB   │  │
│ description TEXT             │         │ result_count   INTEGER │  │
│ search_params  JSONB         │◄──┐     │ executed_at TIMESTAMPTZ│  │
│ is_template    BOOLEAN       │   │     │ duration_ms INTEGER    │  │
│ created_at  TIMESTAMPTZ      │   │     │ status  ENUM           │  │
│ updated_at  TIMESTAMPTZ      │   └─────│ saved_search_id UUID FK│  │
│ run_count   INTEGER          │         └────────────────────────┘  │
│ last_run_at TIMESTAMPTZ      │                                      │
└──────────────────────────────┘                                      │
                                                                      │
┌──────────────────────────────┐                                      │
│       user_sessions          │  (managed by connect-pg-simple)      │
├──────────────────────────────┤                                      │
│ sid         VARCHAR  PK      │                                      │
│ sess        JSONB            │  ◄ encrypted token + metadata       │
│ expire      TIMESTAMPTZ      │                                      │
└──────────────────────────────┘                                      │
                                                                      │
┌──────────────────────────────┐                                      │
│       rate_limit_log         │  (optional; Redis primary)           │
├──────────────────────────────┤                                      │
│ id          UUID  PK         │                                      │
│ user_id     UUID  FK ────────┼──────────────────────────────────────┘
│ window_start TIMESTAMPTZ     │
│ search_count INTEGER         │
└──────────────────────────────┘
```

### 4.3 Table Definitions (SQL)

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────
-- users
-- ─────────────────────────────────────────────────────────
CREATE TYPE linkedin_tier AS ENUM ('basic', 'premium', 'recruiter');

CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    linkedin_id     VARCHAR(64) NOT NULL UNIQUE,
    email           VARCHAR(255),
    full_name       VARCHAR(255) NOT NULL,
    headline        VARCHAR(512),
    profile_pic     TEXT,
    linkedin_tier   linkedin_tier NOT NULL DEFAULT 'basic',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_users_linkedin_id ON users(linkedin_id);

-- ─────────────────────────────────────────────────────────
-- saved_searches
-- ─────────────────────────────────────────────────────────
CREATE TABLE saved_searches (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    -- JSONB structure documented below
    search_params   JSONB       NOT NULL DEFAULT '{}',
    is_template     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_count       INTEGER     NOT NULL DEFAULT 0,
    last_run_at     TIMESTAMPTZ
);

CREATE INDEX idx_saved_searches_user_id ON saved_searches(user_id);
CREATE INDEX idx_saved_searches_params  ON saved_searches USING gin(search_params);

-- ─────────────────────────────────────────────────────────
-- search_history
-- ─────────────────────────────────────────────────────────
CREATE TYPE search_status AS ENUM (
    'pending', 'running', 'completed', 'failed', 'rate_limited', 'captcha'
);

CREATE TABLE search_history (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Mirrors saved_search.search_params structure
    search_params       JSONB       NOT NULL DEFAULT '{}',
    result_count        INTEGER,
    executed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms         INTEGER,
    status              search_status NOT NULL DEFAULT 'pending',
    error_message       TEXT,
    -- Optional back-reference if search was run from a saved template
    saved_search_id     UUID        REFERENCES saved_searches(id) ON DELETE SET NULL
);

CREATE INDEX idx_search_history_user_id     ON search_history(user_id);
CREATE INDEX idx_search_history_executed_at ON search_history(executed_at DESC);

-- Enforce max 50 history rows per user via trigger
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

CREATE TRIGGER trg_trim_search_history
AFTER INSERT ON search_history
FOR EACH ROW EXECUTE FUNCTION trim_search_history();

-- ─────────────────────────────────────────────────────────
-- rate_limit_log  (fallback for Redis unavailability)
-- ─────────────────────────────────────────────────────────
CREATE TABLE rate_limit_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    window_start    TIMESTAMPTZ NOT NULL,
    search_count    INTEGER     NOT NULL DEFAULT 1,
    UNIQUE (user_id, window_start)
);
```

### 4.4 `search_params` JSONB Schema

All search parameters are stored as a structured JSONB object. This allows saved searches and history to be fully self-contained.

```jsonc
{
  // LinkedIn structured filters
  "keywords": "Data Scientist",
  "title": "Data Scientist",
  "company": "Eaton",
  "location": "Mumbai, Maharashtra",
  "industry": "Information Technology",
  "connectionDegree": ["F", "S"],      // 1st, 2nd degree
  "schoolName": "",
  "serviceCategories": [],

  // Custom Boolean string added to URL
  "customString": "#OpenToWork OR \"Immediate Joiner\" OR \"Notice period: 0\"",

  // UI metadata
  "templateId": "open-to-work",       // null if manually typed
  "version": 1                        // for future migration
}
```

### 4.5 Redis Key Schema

```
# OAuth state (CSRF nonce during OAuth flow) — TTL 5 min
oauth:state:{nonce}                    → "1"

# Server session (connect-redis) — TTL 7 days
sess:{session_id}                      → { userId, accessToken, refreshToken, ... }

# Rate limiting (sliding window) — TTL 1 hour
rate:{user_id}:{epoch_hour}            → count (INCR/EXPIRE)

# Result cache — TTL 10 min
cache:results:{sha256(search_params)}  → JSON array of candidate cards

# Job status (SSE) — TTL 30 sec
job:{job_id}                           → { status, progress, resultKey }
```

---

## 5. Backend API Design

### 5.1 REST Endpoints

#### Authentication

| Method | Path | Auth Required | Description |
|--------|------|:---:|-------------|
| `GET` | `/auth/linkedin` | No | Initiates OAuth 2.0 PKCE flow; redirects to LinkedIn |
| `GET` | `/auth/linkedin/callback` | No | Handles OAuth callback; creates session |
| `POST` | `/auth/logout` | Yes | Destroys server session; clears cookie |
| `GET` | `/auth/me` | Yes | Returns current user profile |

#### Search

| Method | Path | Auth Required | Description |
|--------|------|:---:|-------------|
| `POST` | `/api/search` | Yes | Executes a new search; returns job ID |
| `GET` | `/api/search/status/:jobId` | Yes | Polls job status (or use SSE) |
| `GET` | `/api/search/results/:jobId` | Yes | Returns cached results for completed job |

#### Saved Searches

| Method | Path | Auth Required | Description |
|--------|------|:---:|-------------|
| `GET` | `/api/saved-searches` | Yes | Lists all saved searches for current user |
| `POST` | `/api/saved-searches` | Yes | Creates a new saved search |
| `PUT` | `/api/saved-searches/:id` | Yes | Updates name, description, or params |
| `DELETE` | `/api/saved-searches/:id` | Yes | Deletes a saved search |
| `POST` | `/api/saved-searches/:id/run` | Yes | Executes a saved search; returns job ID |

#### Search History

| Method | Path | Auth Required | Description |
|--------|------|:---:|-------------|
| `GET` | `/api/history` | Yes | Returns last 50 searches for current user |
| `DELETE` | `/api/history/:id` | Yes | Removes a single history entry |

#### Templates

| Method | Path | Auth Required | Description |
|--------|------|:---:|-------------|
| `GET` | `/api/templates` | Yes | Returns predefined search string templates |

#### Health

| Method | Path | Auth Required | Description |
|--------|------|:---:|-------------|
| `GET` | `/health` | No | Returns `{ status: "ok", db: bool, redis: bool }` |

### 5.2 Request/Response Examples

**POST `/api/search`**

```jsonc
// Request
{
  "keywords": "Data Scientist",
  "company": "Eaton",
  "location": "Mumbai",
  "connectionDegree": ["F", "S"],
  "customString": "#OpenToWork OR \"Immediate Joiner\""
}

// Response 202 Accepted
{
  "jobId": "job_01HXYZ...",
  "estimatedSeconds": 5,
  "sseUrl": "/api/search/stream/job_01HXYZ..."
}
```

**GET `/api/search/results/:jobId`**

```jsonc
// Response 200 OK
{
  "total": 47,
  "page": 1,
  "perPage": 10,
  "results": [
    {
      "name": "Anjali Verma",
      "title": "Senior Data Scientist",
      "company": "Eaton Technologies",
      "location": "Mumbai, Maharashtra",
      "headline": "ML Engineer | Open to Work | Ex-Amazon",
      "profileUrl": "https://www.linkedin.com/in/anjali-verma-...",
      "profilePicUrl": "https://media.licdn.com/...",
      "connectionDegree": "2nd",
      "isOpenToWork": true,
      "badges": ["Open to Work"]
    }
    // ...
  ],
  "cached": false,
  "executedAt": "2026-04-11T10:30:00Z"
}
```

### 5.3 Error Response Standard

```jsonc
// All errors follow this envelope
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",      // machine-readable
    "message": "You have reached the 30 searches per hour limit.",
    "retryAfter": 1800                   // seconds (if applicable)
  }
}
```

**Error Codes:**
- `UNAUTHENTICATED` — session missing or expired
- `RATE_LIMIT_EXCEEDED` — 30 search/hour cap hit
- `LINKEDIN_CAPTCHA` — LinkedIn returned CAPTCHA challenge
- `LINKEDIN_TIMEOUT` — search page did not load within 15 seconds
- `LINKEDIN_SESSION_EXPIRED` — LinkedIn OAuth token needs refresh
- `INVALID_PARAMS` — Malformed search parameters
- `INTERNAL_ERROR` — Unhandled server error

---

## 6. LinkedIn Adapter Layer

### 6.1 Responsibilities

The `LinkedInAdapterService` is the only module allowed to interact with LinkedIn directly. It is strictly isolated behind an interface so it can be swapped if LinkedIn's DOM changes or a legitimate API becomes available.

```typescript
// src/adapters/linkedin/ILinkedInAdapter.ts
export interface ILinkedInAdapter {
  executeSearch(params: SearchParams, accessToken: string): Promise<SearchResult[]>;
  refreshToken(refreshToken: string): Promise<TokenPair>;
  getUserProfile(accessToken: string): Promise<UserProfile>;
}
```

### 6.2 URL Construction Strategy

LinkedIn people search uses the following URL pattern. The adapter constructs this URL from the structured filter inputs and appends the custom Boolean string as the main keyword.

```
https://www.linkedin.com/search/results/people/?
  keywords=<CUSTOM_BOOLEAN_STRING>
  &title=<JOB_TITLE>
  &company=<COMPANY_NAME>
  &geoUrn=<LOCATION_URN>
  &network=%5B%22F%22%2C%22S%22%5D   ← ["F","S"] URL-encoded
  &origin=FACETED_SEARCH
```

The custom Boolean string is set as the `keywords` parameter, while structured filters are appended as separate params. This is the core mechanism that solves the PRD's problem statement — LinkedIn processes `keywords` as a full-text Boolean query while applying structured filters simultaneously.

### 6.3 Playwright Browser Pool

```
┌───────────────────────────────────────────────────────┐
│               Browser Pool Manager                    │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  Context 1  │  │  Context 2  │  │  Context N  │   │
│  │ (User A     │  │ (User B     │  │  ...        │   │
│  │  session)   │  │  session)   │  │             │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
│          └──────────────┼──────────────┘              │
│                         │                             │
│              Shared Chromium Browser                  │
│              (single browser process)                 │
└───────────────────────────────────────────────────────┘
```

- One Playwright `Browser` instance shared across all requests
- Each authenticated user gets a persistent `BrowserContext` stored in Redis (serialized cookies/storage)
- Contexts are created lazily on first search and destroyed after 1 hour of inactivity
- Max concurrent pages: 5 (configurable via `PLAYWRIGHT_MAX_PAGES` env var)

### 6.4 Anti-Detection Measures

- `playwright-extra` with `puppeteer-extra-plugin-stealth` for fingerprint spoofing
- Randomized navigation delays (500–1500ms between actions)
- Human-like scroll behavior before scraping result cards
- User-agent rotation from a curated pool of real browser UAs
- Per-user rate limiting (30 searches/hour) with jitter on execution timing

### 6.5 Graceful Degradation

```
CAPTCHA Detected
      │
      ├──▶ Return error code LINKEDIN_CAPTCHA to frontend
      ├──▶ Log event with timestamp and user_id
      ├──▶ Pause adapter for that user for 30 minutes
      └──▶ Display user-friendly message: "LinkedIn requires verification.
            Please log in to LinkedIn directly to complete verification,
            then try your search again."

Session Expired
      │
      ├──▶ Attempt token refresh via OAuth refresh_token
      ├──▶ If refresh succeeds: retry search automatically
      └──▶ If refresh fails: redirect user to re-authenticate
```

---

## 7. Frontend Architecture

### 7.1 Page Structure

```
src/
├── pages/
│   ├── LoginPage.tsx          ← LinkedIn SSO button only
│   ├── SearchPage.tsx         ← Main search builder (home after login)
│   ├── ResultsPage.tsx        ← Candidate cards + pagination
│   ├── SavedSearchesPage.tsx  ← Table: run / edit / delete
│   ├── HistoryPage.tsx        ← Timeline of recent searches
│   └── SettingsPage.tsx       ← Rate limit status, logout
├── components/
│   ├── auth/
│   │   └── LinkedInLoginButton.tsx
│   ├── search/
│   │   ├── FilterPanel.tsx        ← Left panel: structured filters
│   │   ├── BooleanStringBuilder.tsx ← Right panel: custom string
│   │   ├── QueryPreview.tsx       ← Shows constructed query string
│   │   ├── TemplateSelector.tsx   ← Predefined templates dropdown
│   │   └── SearchButton.tsx
│   ├── results/
│   │   ├── CandidateCard.tsx
│   │   ├── ResultsGrid.tsx
│   │   └── Pagination.tsx
│   └── shared/
│       ├── Navbar.tsx
│       ├── ErrorBoundary.tsx
│       └── LoadingSpinner.tsx
├── stores/
│   ├── authStore.ts            ← Zustand: user session
│   ├── searchStore.ts          ← Zustand: current search params + results
│   └── savedSearchStore.ts     ← Zustand: saved searches CRUD
├── hooks/
│   ├── useSearch.ts            ← Executes search + polls job status
│   ├── useRateLimit.ts         ← Reads rate limit from /auth/me
│   └── useSSE.ts               ← Server-Sent Events for job progress
├── api/
│   └── client.ts               ← Axios instance with auth interceptors
└── types/
    └── index.ts                ← Shared TypeScript types
```

### 7.2 State Machine — Search Flow

```
IDLE
  │
  │ User submits form
  ▼
VALIDATING ──(invalid)──▶ IDLE (show inline errors)
  │
  │ Params valid
  ▼
SUBMITTING ──(rate limited)──▶ IDLE (show rate limit toast)
  │
  │ 202 Accepted + jobId
  ▼
POLLING (SSE or polling /status/:jobId)
  │                 │
  │(completed)      │(error: captcha/timeout)
  ▼                 ▼
RESULTS          ERROR (show error card with actionable message)
  │
  │ User requests more / page change
  ▼
RESULTS (updated)
```

---

## 8. Security Design

### 8.1 Authentication & Session Security

**OAuth 2.0 PKCE Flow:**
- `code_verifier` generated client-side (256-bit random, Base64URL-encoded)
- `code_challenge` = SHA-256 hash of `code_verifier`
- State parameter = cryptographically random nonce stored in Redis for 5 minutes
- Token exchange happens server-side only; tokens never touch the browser

**Session Management:**
- `express-session` with `connect-redis` store
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`
- Session ID: 128-bit random (default express-session behavior)
- Session TTL: 7 days; sliding expiry on each authenticated request
- Access token stored encrypted in session with AES-256-GCM using `SESSION_ENCRYPTION_KEY`

**Token Storage in Redis:**
```
sess:{sid} = {
  userId: "uuid",
  encryptedAccessToken: "base64(AES-256-GCM(token))",
  encryptedRefreshToken: "base64(AES-256-GCM(token))",
  tokenExpiresAt: 1712345678,
  linkedinId: "..."
}
```

### 8.2 CSRF Protection

All state-changing endpoints (`POST`, `PUT`, `DELETE`) require:
1. Valid session cookie
2. `X-Requested-With: XMLHttpRequest` header (simple CSRF guard)
3. For the `/auth/linkedin/callback` endpoint: state parameter validation against Redis

### 8.3 Input Validation & Sanitization

```typescript
// All API inputs validated with Zod
const SearchParamsSchema = z.object({
  keywords:         z.string().max(200).optional(),
  title:            z.string().max(100).optional(),
  company:          z.string().max(100).optional(),
  location:         z.string().max(100).optional(),
  industry:         z.string().max(100).optional(),
  connectionDegree: z.array(z.enum(["F", "S", "O"])).max(3).optional(),
  customString:     z.string().max(500).optional(),
  templateId:       z.string().max(50).optional(),
});
```

- Boolean string field validated for balanced parentheses and known operators (`AND`, `OR`, `NOT`)
- All user-supplied strings are sanitized before being interpolated into LinkedIn URLs (URL-encoding via `encodeURIComponent`)
- SQL injection: impossible via parameterized queries (pg + Drizzle ORM)
- XSS: React escapes all rendered content; `DOMPurify` applied to any HTML-containing fields

### 8.4 Rate Limiting Architecture

```
Sliding Window Rate Limiter (Redis)

For each search request:
1. MULTI
2. INCR  rate:{user_id}:{floor(now/3600)}
3. EXPIRE rate:{user_id}:{floor(now/3600)} 7200   (2h TTL to allow overlap)
4. EXEC

If count > 30:
  - Return 429 with Retry-After header
  - Log to rate_limit_log table
  - Return RATE_LIMIT_EXCEEDED error to frontend
```

Additionally, Nginx enforces a global rate limit of 100 req/min per IP on `/api/` routes.

### 8.5 Security Headers (Nginx)

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "
  default-src 'self';
  script-src  'self';
  style-src   'self' 'unsafe-inline';
  img-src     'self' data: https://media.licdn.com;
  connect-src 'self';
  frame-ancestors 'none';
" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
```

### 8.6 Data Protection

- **No candidate profile data is persisted.** Results exist only in:
  - Redis result cache (TTL 10 minutes, auto-expires)
  - Browser memory/state while the user views results
- `search_history` table stores only `search_params` (the query), not result data
- LinkedIn OAuth tokens are AES-256-GCM encrypted before being written to Redis
- Database connection uses SSL (`sslmode=require`)
- All secrets injected via environment variables; no hardcoded values anywhere

---

## 9. Deployment Pipeline

### 9.1 CI/CD Overview

```
Developer pushes to GitHub
         │
         ▼
┌─────────────────────────────────────────┐
│           GitHub Actions                │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │  1. Lint & Type Check            │   │
│  │     - ESLint + tsc --noEmit      │   │
│  └────────────────┬─────────────────┘   │
│                   │                     │
│  ┌────────────────▼─────────────────┐   │
│  │  2. Unit & Integration Tests     │   │
│  │     - Jest + Supertest           │   │
│  │     - Playwright component tests │   │
│  └────────────────┬─────────────────┘   │
│                   │                     │
│  ┌────────────────▼─────────────────┐   │
│  │  3. Build Docker Images          │   │
│  │     - app: node:20-alpine        │   │
│  │     - frontend: nginx:alpine     │   │
│  └────────────────┬─────────────────┘   │
│                   │                     │
│  ┌────────────────▼─────────────────┐   │
│  │  4. Push to GHCR                 │   │
│  │     ghcr.io/{org}/lssw-app       │   │
│  │     ghcr.io/{org}/lssw-frontend  │   │
│  └────────────────┬─────────────────┘   │
│                   │ (main branch only)  │
│  ┌────────────────▼─────────────────┐   │
│  │  5. Deploy to Hostinger VPS      │   │
│  │     SSH + docker compose pull    │   │
│  │       + docker compose up -d     │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### 9.2 GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Build & Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_APP: ghcr.io/${{ github.repository_owner }}/lssw-app
  IMAGE_FRONTEND: ghcr.io/${{ github.repository_owner }}/lssw-frontend

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: lssw_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
      redis:
        image: redis:7-alpine
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost/lssw_test
          REDIS_URL: redis://localhost:6379

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: ./backend
          push: true
          tags: ${{ env.IMAGE_APP }}:${{ github.sha }},${{ env.IMAGE_APP }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - uses: docker/build-push-action@v5
        with:
          context: ./frontend
          push: true
          tags: ${{ env.IMAGE_FRONTEND }}:${{ github.sha }},${{ env.IMAGE_FRONTEND }}:latest

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Deploy to Hostinger VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.HOSTINGER_HOST }}
          username: ${{ secrets.HOSTINGER_USER }}
          key: ${{ secrets.HOSTINGER_SSH_KEY }}
          script: |
            cd /opt/lssw
            docker compose pull
            docker compose up -d --remove-orphans
            docker system prune -f
```

### 9.3 Rollback Procedure

```bash
# On the VPS: roll back to the previous image tag
ssh user@hostinger-vps
cd /opt/lssw
docker compose down
# Edit docker-compose.yml to pin previous SHA tag
docker compose up -d
```

---

## 10. Docker Architecture

### 10.1 Project File Structure

```
lssw/
├── docker-compose.yml
├── docker-compose.override.yml   ← Dev overrides (bind mounts, hot reload)
├── .env.example
├── nginx/
│   ├── nginx.conf
│   └── conf.d/
│       └── lssw.conf
├── certbot/
│   └── www/                      ← ACME challenges
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
└── db/
    └── migrations/
        └── 001_initial_schema.sql
```

### 10.2 `docker-compose.yml`

```yaml
version: "3.9"

services:

  nginx:
    image: nginx:1.25-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - certbot-www:/var/www/certbot:ro
      - certbot-certs:/etc/letsencrypt:ro
    depends_on:
      - app
      - frontend
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "nginx", "-t"]
      interval: 30s

  certbot:
    image: certbot/certbot:latest
    volumes:
      - certbot-www:/var/www/certbot
      - certbot-certs:/etc/letsencrypt
    entrypoint: >
      /bin/sh -c "trap exit TERM;
      while :; do
        certbot renew --webroot -w /var/www/certbot --quiet;
        sleep 12h & wait $${!};
      done"

  app:
    image: ghcr.io/${GHCR_ORG}/lssw-app:latest
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      SESSION_ENCRYPTION_KEY: ${SESSION_ENCRYPTION_KEY}
      LINKEDIN_CLIENT_ID: ${LINKEDIN_CLIENT_ID}
      LINKEDIN_CLIENT_SECRET: ${LINKEDIN_CLIENT_SECRET}
      LINKEDIN_CALLBACK_URL: ${LINKEDIN_CALLBACK_URL}
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS}
      PLAYWRIGHT_MAX_PAGES: ${PLAYWRIGHT_MAX_PAGES:-5}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  frontend:
    image: ghcr.io/${GHCR_ORG}/lssw-frontend:latest
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: lssw
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pg-data:/var/lib/postgresql/data
      - ./db/migrations:/docker-entrypoint-initdb.d:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d lssw"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  pg-data:
  redis-data:
  certbot-www:
  certbot-certs:

networks:
  default:
    name: lssw-network
```

### 10.3 Backend `Dockerfile`

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Playwright + Runtime
FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS runtime
WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .

# Install only Chromium (smallest browser footprint)
RUN npx playwright install chromium --with-deps

# Non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser
USER appuser

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 10.4 Frontend `Dockerfile`

```dockerfile
# Stage 1: Build React app
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:1.25-alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### 10.5 Nginx Configuration

```nginx
# nginx/conf.d/lssw.conf

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Rate limiting on API routes
    limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;

    # Backend API
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass         http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 30s;
    }

    # Auth routes
    location /auth/ {
        proxy_pass http://app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check (no rate limiting)
    location /health {
        proxy_pass http://app:3000;
    }

    # Frontend SPA (React Router support)
    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 11. Hostinger Deployment Guide

### 11.1 VPS Provisioning

1. Log into Hostinger Cloud panel → **Create VPS**
2. Select: **Ubuntu 22.04 LTS**, **KVM 2** (2 vCPU, 4GB RAM, 50GB NVMe) or higher
3. Add your SSH public key during provisioning
4. Note the assigned public IP address

### 11.2 Server Setup Script

Run this once on a fresh VPS as `root`:

```bash
#!/bin/bash
# setup-vps.sh — Run as root on fresh Ubuntu 22.04

set -euo pipefail

# System update
apt-get update && apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Add deploy user
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys

# Create app directory
mkdir -p /opt/lssw
chown deploy:deploy /opt/lssw

# Firewall
ufw allow ssh
ufw allow 80
ufw allow 443
ufw --force enable

# Swap (recommended for 4GB RAM with Playwright)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

echo "✅ VPS setup complete. Deploy as user 'deploy'."
```

### 11.3 Application Deployment

```bash
# On your local machine — copy files to VPS
scp docker-compose.yml .env.example deploy@YOUR_VPS_IP:/opt/lssw/
ssh deploy@YOUR_VPS_IP

# On VPS
cd /opt/lssw
cp .env.example .env
nano .env   # Fill in all required values (see Section 13)

# Pull images and start stack
docker compose pull
docker compose up -d

# First-run: Obtain SSL certificate
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  --email your@email.com \
  --agree-tos \
  --no-eff-email \
  -d yourdomain.com

# Reload Nginx to pick up certificate
docker compose exec nginx nginx -s reload

# Verify health
curl https://yourdomain.com/health
```

### 11.4 DNS Configuration

In your domain registrar or Hostinger Domains panel:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| `A` | `@` | `YOUR_VPS_IP` | 300 |
| `A` | `www` | `YOUR_VPS_IP` | 300 |

### 11.5 LinkedIn Developer App Registration

1. Go to [LinkedIn Developer Portal](https://developer.linkedin.com/apps)
2. Create new app with your product name
3. Add OAuth 2.0 Redirect URL: `https://yourdomain.com/auth/linkedin/callback`
4. Request scopes: `r_liteprofile`, `r_emailaddress`, `w_member_social` (for future use)
5. Copy `Client ID` and `Client Secret` to `.env`

### 11.6 Operational Commands

```bash
# View logs
docker compose logs -f app

# Restart a single service
docker compose restart app

# Run database migrations
docker compose exec app npm run db:migrate

# Backup database
docker compose exec db pg_dump -U $POSTGRES_USER lssw > backup-$(date +%Y%m%d).sql

# Update to latest images
docker compose pull && docker compose up -d --remove-orphans

# Emergency stop
docker compose down
```

---

## 12. Monitoring & Observability

### 12.1 Health Check Endpoints

`GET /health` returns:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "playwright": "ok"
  },
  "uptime": 3600
}
```

### 12.2 Structured Logging

All application logs are emitted as JSON to stdout (captured by Docker):

```json
{
  "level": "info",
  "timestamp": "2026-04-11T10:30:00.000Z",
  "requestId": "req_01HX...",
  "userId": "uuid",
  "action": "search_executed",
  "durationMs": 3421,
  "resultCount": 47,
  "rateLimit": { "used": 5, "limit": 30 }
}
```

### 12.3 Key Metrics to Monitor

- **Search success rate** — `search_history` table `status` column distribution
- **Rate limit hits** — count of `rate_limited` status per hour
- **CAPTCHA encounters** — count of `captcha` status (signals LinkedIn detection risk)
- **P95 search latency** — `duration_ms` percentile from `search_history`
- **Redis memory usage** — alert at 80% of 256MB
- **Container restarts** — Docker health check failure count

### 12.4 Alerting (Hostinger + Uptime Robot)

Configure [Uptime Robot](https://uptimerobot.com) (free tier):
- Monitor `https://yourdomain.com/health` every 5 minutes
- Alert via email/Slack if status non-200 for 2 consecutive checks

---

## 13. Environment Configuration

### `.env.example`

```bash
# ─── App ────────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
ALLOWED_ORIGINS=https://yourdomain.com

# ─── Session ────────────────────────────────────────────────────
# Generate with: openssl rand -hex 64
SESSION_SECRET=REPLACE_WITH_64_CHAR_RANDOM_HEX
# Generate with: openssl rand -hex 32
SESSION_ENCRYPTION_KEY=REPLACE_WITH_32_CHAR_RANDOM_HEX

# ─── LinkedIn OAuth ──────────────────────────────────────────────
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
LINKEDIN_CALLBACK_URL=https://yourdomain.com/auth/linkedin/callback

# ─── Database ────────────────────────────────────────────────────
POSTGRES_USER=lssw
POSTGRES_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
DATABASE_URL=postgresql://lssw:REPLACE_WITH_STRONG_PASSWORD@db:5432/lssw?sslmode=disable

# ─── Redis ───────────────────────────────────────────────────────
REDIS_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
REDIS_URL=redis://:REPLACE_WITH_STRONG_PASSWORD@redis:6379

# ─── Playwright ──────────────────────────────────────────────────
PLAYWRIGHT_MAX_PAGES=5
PLAYWRIGHT_BROWSER_TIMEOUT_MS=15000
PLAYWRIGHT_NAV_DELAY_MIN_MS=500
PLAYWRIGHT_NAV_DELAY_MAX_MS=1500

# ─── Rate Limiting ───────────────────────────────────────────────
RATE_LIMIT_SEARCHES_PER_HOUR=30
RATE_LIMIT_WINDOW_SECONDS=3600

# ─── Cache ───────────────────────────────────────────────────────
RESULT_CACHE_TTL_SECONDS=600

# ─── GHCR ────────────────────────────────────────────────────────
GHCR_ORG=your_github_org
```

---

## 14. Open Items & Decisions Required

| # | Item | Owner | Priority | Notes |
|---|------|-------|----------|-------|
| 1 | **Legal review of ToS compliance** — headless scraping approach vs. LinkedIn Partner API | Legal / Product | 🔴 Critical | Must resolve before production launch. Section 8.2 of LinkedIn User Agreement. |
| 2 | **LinkedIn Developer App registration** — OAuth scopes approved | Engineering | 🔴 Critical | Block on CI/CD; required for any testing. |
| 3 | **Multi-tenant vs. single-user** — determines session isolation model and DB access control | Product | 🟡 High | Current design supports multi-user. Single-user simplifies significantly. |
| 4 | **LinkedIn account tier** — Basic vs. Premium vs. Recruiter | Product | 🟡 High | Affects available filters and result volume per page. |
| 5 | **GDPR / data residency** — any requirements if EU profiles are surfaced? | Legal | 🟡 High | Redis cache TTL and no-persistence policy likely sufficient; needs confirmation. |
| 6 | **CI/CD pipeline scope** — GitHub Actions included in v1.0? | Engineering | 🟢 Medium | Design above assumes yes; if not, manual `ssh + docker compose pull` workflow documented. |
| 7 | **Hostinger domain** — domain name to register + DNS cutover plan | Ops | 🟢 Medium | Required before SSL certificate generation. |
| 8 | **v1.1 CSV export** — schema impact on `search_history` | Engineering | 🔵 Low | Consider adding `export_count` column to `search_history` in initial schema for forward-compatibility. |

---

*Document prepared for engineering handoff. All section numbers align with PRD v1.0 section references. Raise any discrepancies with the Product team before beginning implementation.*
