#!/usr/bin/env bash
# scripts/setup-vps.sh
# Production VPS Provisioning & Dependency Installer for Granblue Fantasy Remote Controller
# Optimized for Ubuntu 22.04/24.04 LTS & Debian instances (1 vCPU / 1GB RAM)

set -e

echo "========================================================================"
echo "    Granblue Fantasy Remote Controller - VPS Production Setup Gate       "
echo "========================================================================"

if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (or with sudo)."
   exit 1
fi

echo "[1/6] Updating package repositories..."
apt-get update -y

echo "[2/6] Checking Swap Space (Critical for 1GB RAM VPS Stability)..."
SWAP_TOTAL=$(free -m | awk '/^Swap:/ {print $2}')
if [[ "$SWAP_TOTAL" -lt 1024 ]]; then
  echo "⚠️ Swap space is low (${SWAP_TOTAL}MB). Creating 2GB swapfile to prevent OOM killer..."
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q "/swapfile" /etc/fstab; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
  fi
  sysctl vm.swappiness=10
  echo "vm.swappiness=10" >> /etc/sysctl.d/99-swappiness.conf
  echo "✅ 2GB Swap space successfully configured!"
else
  echo "✅ Swap space is adequate (${SWAP_TOTAL}MB)."
fi

echo "[3/6] Installing Essential System Libraries & Fonts..."
apt-get install -y \
  curl \
  wget \
  git \
  unzip \
  ca-certificates \
  fonts-noto-cjk \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  xdg-utils

echo "[4/6] Installing Google Chrome Stable..."
if ! command -v google-chrome &> /dev/null && ! command -v google-chrome-stable &> /dev/null; then
  wget -q -O /tmp/google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/google-chrome-stable_current_amd64.deb
  rm -f /tmp/google-chrome-stable_current_amd64.deb
  echo "✅ Google Chrome Stable installed: $(google-chrome --version)"
else
  echo "✅ Google Chrome is already installed: $(google-chrome --version 2>/dev/null || google-chrome-stable --version)"
fi

echo "[5/6] Checking & Installing Bun Runtime..."
if ! command -v bun &> /dev/null; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo "export BUN_INSTALL=\"$HOME/.bun\"" >> ~/.bashrc
  echo "export PATH=\"\$BUN_INSTALL/bin:\$PATH\"" >> ~/.bashrc
  echo "✅ Bun installed successfully: $($HOME/.bun/bin/bun --version)"
else
  echo "✅ Bun is already installed: $(bun --version)"
fi

echo "[6/6] Initializing Project Directories & Dependencies..."
mkdir -p "$HOME/.gbf-profiles/acc1"
mkdir -p "$HOME/.gbf-profiles/acc2"
mkdir -p data logs

# Ensure bun is in PATH for this execution
if command -v bun &> /dev/null; then
  bun install
elif [[ -f "$HOME/.bun/bin/bun" ]]; then
  "$HOME/.bun/bin/bun" install
fi

echo ""
echo "========================================================================"
echo "🎉 VPS PROVISIONING COMPLETE & SYSTEM READY FOR PRODUCTION AUTOMATION!"
echo "========================================================================"
echo "👉 Quick Start Commands:"
echo "   1. Sync Cookies from local PC:  bun run session:sync acc1 (run on local Windows)"
echo "   2. Import Cookies directly:    bun run session:import acc1"
echo "   3. Launch Assisted Cockpit:    bun src/cli/setup-account.ts acc1"
echo "   4. Run Headless Daily Routine: bun run daily:acc1"
echo "========================================================================"
