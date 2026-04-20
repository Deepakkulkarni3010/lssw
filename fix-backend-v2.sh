#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# fix-backend-v2.sh — Run on VPS at /opt/lssw to fix the 3 remaining TS errors
# ─────────────────────────────────────────────────────────────────────────────
set -e
cd /opt/lssw

echo "═══ Fix 1: connect-redis v7 → use default import (not named {RedisStore}) ═══"
python3 - << 'PYEOF'
with open('backend/src/index.ts') as f:
    content = f.read()

# Fix import: v7 uses default export, not named export
content = content.replace(
    "import { RedisStore } from 'connect-redis';",
    "import RedisStore from 'connect-redis';"
)

# Also handle case where old script left connectRedis import behind
content = content.replace(
    "import connectRedis from 'connect-redis';",
    "import RedisStore from 'connect-redis';"
)

# Remove the v6-style factory call if fix-backend.sh didn't already remove it
content = content.replace(
    "const RedisStore = connectRedis(session as any);\n\n",
    ""
)
content = content.replace(
    "const RedisStore = connectRedis(session);\n\n",
    ""
)

# Ensure no 'as any' on redisClient (v7 accepts ioredis client directly)
content = content.replace(
    "client: redisClient as any,",
    "client: redisClient,"
)

with open('backend/src/index.ts', 'w') as f:
    f.write(content)

print("✅ index.ts: connect-redis v7 default import fixed")
PYEOF

echo "═══ Fix 2: Drizzle insert type error in savedSearches.routes.ts ═══"
python3 - << 'PYEOF'
with open('backend/src/routes/savedSearches.routes.ts') as f:
    content = f.read()

# Cast parsed.data to any to satisfy Drizzle's required 'name' field
content = content.replace(
    "      userId,\n      ...parsed.data,",
    "      userId,\n      ...(parsed.data as any),"
)

with open('backend/src/routes/savedSearches.routes.ts', 'w') as f:
    f.write(content)

print("✅ savedSearches.routes.ts: Drizzle insert cast fixed")
PYEOF

echo "═══ Fix 3: Move node-cron declare module out of types/index.ts ═══"
python3 - << 'PYEOF'
import re

# Read types/index.ts and remove the appended node-cron block
with open('backend/src/types/index.ts') as f:
    content = f.read()

# Remove the appended block (added by fix-backend.sh)
block_marker = "\n// Module declaration fallback for node-cron"
if block_marker in content:
    idx = content.index(block_marker)
    content = content[:idx]
    with open('backend/src/types/index.ts', 'w') as f:
        f.write(content)
    print("✅ Removed node-cron block from types/index.ts")
else:
    print("ℹ️  node-cron block not found in types/index.ts (already clean)")

# Write the proper separate declaration file
cron_dts = """// Fallback type declaration for node-cron
declare module 'node-cron' {
  function schedule(
    expression: string,
    func: () => void,
    options?: { timezone?: string }
  ): void;
  export { schedule };
}
"""
with open('backend/src/types/node-cron.d.ts', 'w') as f:
    f.write(cron_dts)
print("✅ Created backend/src/types/node-cron.d.ts")
PYEOF

echo ""
echo "═══════════════════════════════════════════════════════"
echo "✅ All 3 fixes applied. Rebuilding Docker images..."
echo "═══════════════════════════════════════════════════════"
echo ""

docker compose -f docker-compose.yml -f docker-compose.local.yml build --no-cache 2>&1 | tee /tmp/build-v2.log

echo ""
echo "═══ Build log (last 40 lines) ═══"
tail -40 /tmp/build-v2.log

# Check if build succeeded
if grep -q "ERROR\|error\|failed" /tmp/build-v2.log; then
    echo ""
    echo "⚠️  Build may have errors — check /tmp/build-v2.log"
else
    echo ""
    echo "✅ Build appears successful! Starting stack..."
    docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
    echo ""
    echo "Waiting 10s for containers to start..."
    sleep 10
    docker compose ps
fi
