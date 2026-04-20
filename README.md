# LinkedIn Smart Search Wrapper

**Production URL:** https://deepakkulkarni.space

A web application that combines LinkedIn's structured search filters with custom Boolean strings to surface precisely targeted candidates from a single interface. Built for LinkedIn Premium accounts with full GDPR/EU compliance.

---

## Quick Start — Hostinger Deployment

### Prerequisites

- Hostinger Cloud VPS (Ubuntu 22.04, min 2vCPU / 4GB RAM / 50GB SSD)
- Domain `deepakkulkarni.space` with DNS A record → VPS IP
- GitHub account with this repo pushed
- LinkedIn Developer App created at https://developer.linkedin.com/apps
- LinkedIn **Premium** account

### Step 1 — VPS Setup (run as root, one time only)

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/lssw/main/scripts/setup-vps.sh | bash
```

### Step 2 — Clone & Configure

```bash
su - deploy
git clone https://github.com/YOUR_ORG/lssw.git /opt/lssw
cd /opt/lssw
cp .env.example .env
nano .env   # Fill ALL required values
```

Key variables to set:
```bash
LINKEDIN_CLIENT_ID=<from LinkedIn Developer Portal>
LINKEDIN_CLIENT_SECRET=<from LinkedIn Developer Portal>
SESSION_SECRET=$(openssl rand -hex 64)
SESSION_ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
GHCR_ORG=<your GitHub org or username>
```

### Step 3 — Start Stack

```bash
cd /opt/lssw
docker compose pull
docker compose up -d
```

### Step 4 — SSL Certificate

```bash
bash scripts/init-ssl.sh
```

### Step 5 — LinkedIn Developer App

1. Go to https://developer.linkedin.com/apps
2. Create app → Products tab → add **Sign In with LinkedIn using OpenID Connect**
3. Auth tab → Add redirect URL: `https://deepakkulkarni.space/auth/linkedin/callback`
4. Copy Client ID and Client Secret to `.env`

### Step 6 — GitHub Actions CI/CD

Add these secrets to your GitHub repo (Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `HOSTINGER_HOST` | VPS public IP |
| `HOSTINGER_USER` | `deploy` |
| `HOSTINGER_SSH_KEY` | Content of `~/.ssh/id_ed25519` private key |
| `LINKEDIN_CLIENT_ID` | From LinkedIn Developer Portal |
| `LINKEDIN_CLIENT_SECRET` | From LinkedIn Developer Portal |

Push to `main` → CI/CD pipeline auto-deploys.

---

## Architecture

```
Internet → Nginx (SSL/TLS) → React SPA (frontend)
                           → Node.js API (backend)
                               → Playwright Adapter → linkedin.com
                               → PostgreSQL (users, searches)
                               → Redis (sessions, cache, rate limits)
```

## GDPR Compliance

| Feature | Implementation |
|---------|---------------|
| Data residency | EU only (Hostinger Frankfurt) |
| Candidate data | Never stored (10 min cache max) |
| Search history | Auto-purged after 90 days |
| Right to erasure | `DELETE /api/gdpr/me` |
| Data export | `GET /api/gdpr/export` |
| Audit log | 365 day retention |
| Cookie consent | First-visit modal |
| Encryption | AES-256-GCM for tokens |

## Operations

```bash
# View logs
docker compose logs -f app

# Restart app only
docker compose restart app

# Update to latest
docker compose pull && docker compose up -d --remove-orphans

# Run DB migrations
docker compose exec db psql -U lssw -d lssw -f /docker-entrypoint-initdb.d/001_initial_schema.sql

# Backup database
docker compose exec db pg_dump -U lssw lssw | gzip > backup-$(date +%Y%m%d).sql.gz

# Shell into app container
docker compose exec app sh

# Health check
curl https://deepakkulkarni.space/health
```

## Rate Limits

- Max 30 searches per user per hour (LinkedIn bot-detection compliance)
- Nginx: 100 req/min per IP on `/api/` routes
- Auth: 10 req/min per IP on `/auth/` routes

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Backend | Node.js 20 + Express + TypeScript |
| Browser | Playwright + Chromium (headless) |
| Database | PostgreSQL 15 |
| Cache/Sessions | Redis 7 |
| Proxy | Nginx 1.25 |
| SSL | Let's Encrypt (auto-renew) |
| CI/CD | GitHub Actions → GHCR → Hostinger SSH |

---

**⚠️ Legal Notice:** Review LinkedIn's Terms of Service Section 8.2 before production launch. The headless browser approach for search result scraping may conflict with LinkedIn's ToS. Consider applying for LinkedIn's Talent Solutions Partner Program for a compliant API path.
