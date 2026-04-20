#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# LSSW VPS Setup Script
# Run once as ROOT on a fresh Hostinger Ubuntu 22.04 VPS
# Domain: deepakkulkarni.space
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

echo "═══════════════════════════════════════════════"
echo "   LSSW — Hostinger VPS Setup"
echo "   Domain: deepakkulkarni.space"
echo "═══════════════════════════════════════════════"

# ── 1. System Update ──
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git ufw fail2ban postgresql-client

# ── 2. Install Docker ──
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Docker Compose v2
apt-get install -y docker-compose-plugin

# ── 3. Create deploy user ──
if ! id "deploy" &>/dev/null; then
    useradd -m -s /bin/bash deploy
    echo "deploy user created"
fi
usermod -aG docker deploy

# Copy SSH keys from root
mkdir -p /home/deploy/.ssh
if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/deploy/.ssh/
fi
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true

# ── 4. Create app directory with data directories ──
mkdir -p /opt/lssw/data/{postgres,redis,backups}
chown -R deploy:deploy /opt/lssw
chmod -R 755 /opt/lssw/data

# ── 5. Add swap (important for Playwright on 4GB RAM) ──
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "✅ 2GB swap created"
else
    echo "Swap already exists"
fi

# Tune swappiness for containers
echo 'vm.swappiness=10' >> /etc/sysctl.conf
sysctl -p

# ── 6. Firewall ──
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "✅ Firewall configured"

# ── 7. Fail2ban (SSH brute force protection) ──
systemctl enable fail2ban
systemctl start fail2ban

# ── 8. Kernel tuning for many concurrent connections ──
cat >> /etc/sysctl.conf << 'EOF'
# Network tuning for web server
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 10000 65535
net.ipv4.tcp_tw_reuse = 1
EOF
sysctl -p

# ── 9. Docker log rotation (prevent disk fill) ──
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "data-root": "/var/lib/docker"
}
EOF
systemctl restart docker

echo ""
echo "═══════════════════════════════════════════════"
echo "✅ VPS setup complete!"
echo ""
echo "Next steps (run as 'deploy' user):"
echo "  1. cd /opt/lssw"
echo "  2. git clone https://github.com/YOUR_ORG/lssw.git ."
echo "  3. cp .env.example .env && nano .env"
echo "  4. docker compose pull"
echo "  5. docker compose up -d"
echo "  6. bash scripts/init-ssl.sh"
echo "═══════════════════════════════════════════════"
