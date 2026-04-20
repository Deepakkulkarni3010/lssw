# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --ignore-scripts

COPY tsconfig.json .
COPY src ./src

RUN npm run build

# ─── Stage 2: Runtime with Playwright ────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS runtime

# Install Node 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean

WORKDIR /app

# Copy only production dependencies
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

# Copy build output
COPY --from=builder /app/dist ./dist

# Install only Chromium (smallest footprint)
RUN npx playwright install chromium --with-deps

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -m appuser
RUN chown -R appuser:appuser /app

USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/index.js"]
