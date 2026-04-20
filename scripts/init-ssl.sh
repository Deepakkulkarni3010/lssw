#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SSL Certificate Initialization
# Run AFTER docker compose up -d, with DNS already pointing to VPS IP
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DOMAIN="deepakkulkarni.space"
EMAIL="deepakakulkarni@gmail.com"

echo "Obtaining Let's Encrypt certificate for $DOMAIN"
echo "Ensure DNS A record for $DOMAIN points to this VPS IP before running."

# Step 1: Start Nginx in HTTP-only mode (for ACME challenge)
# The nginx conf handles /.well-known/acme-challenge/ on port 80

# Step 2: Run certbot
docker compose run --rm certbot certonly \
    --webroot \
    -w /var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    -d "$DOMAIN" \
    -d "www.$DOMAIN"

echo "✅ Certificate obtained!"

# Step 3: Reload Nginx to pick up the certificate
docker compose exec nginx nginx -s reload

echo "✅ Nginx reloaded with SSL!"
echo ""
echo "Test: https://$DOMAIN/health"
curl -s "https://$DOMAIN/health" | python3 -m json.tool || echo "Health check pending..."
