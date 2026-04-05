#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — One-shot DietPi setup for pos-print-server
#
# Run as root (or with sudo) on a freshly flashed DietPi:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/pos-print-server/main/scripts/setup.sh | sudo bash
#   OR after cloning:
#   sudo bash scripts/setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="dietpi"
APP_HOME="/home/${APP_USER}/pos-print-server"
SERVICE_NAME="pos-print-server"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  POS Print Server — DietPi Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. System update ──────────────────────────────────────────────────────────
echo ""
echo "[1/7] Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ── 2. Install Node.js (LTS) ──────────────────────────────────────────────────
echo ""
echo "[2/7] Installing Node.js LTS..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "       Node.js already installed: $(node --version)"
fi

# ── 3. Install Tailscale ──────────────────────────────────────────────────────
echo ""
echo "[3/7] Installing Tailscale..."
if ! command -v tailscale &>/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
  systemctl enable tailscaled
  systemctl start tailscaled
  echo ""
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║  ACTION REQUIRED: Authenticate Tailscale     ║"
  echo "  ║  Run: tailscale up                           ║"
  echo "  ║  Then approve in your Tailscale admin panel  ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo ""
else
  echo "       Tailscale already installed: $(tailscale --version | head -1)"
fi

# ── 4. Printer permissions ────────────────────────────────────────────────────
echo ""
echo "[4/7] Setting up printer permissions..."

# Add the app user to the 'lp' group so it can access /dev/usb/lp0
usermod -aG lp "${APP_USER}" 2>/dev/null || true

# Create a udev rule to give consistent permissions to USB thermal printers
UDEV_RULE="/etc/udev/rules.d/99-thermal-printer.rules"
if [ ! -f "${UDEV_RULE}" ]; then
  cat > "${UDEV_RULE}" <<'EOF'
# Give lp group read/write access to USB printers
SUBSYSTEM=="usb", ATTRS{bDeviceClass}=="07", GROUP="lp", MODE="0664"
# Also cover the lp device interface
KERNEL=="lp[0-9]*", GROUP="lp", MODE="0664"
EOF
  udevadm control --reload-rules
  udevadm trigger
  echo "       udev rule created at ${UDEV_RULE}"
else
  echo "       udev rule already exists"
fi

# ── 5. Copy app to home dir & install deps ────────────────────────────────────
echo ""
echo "[5/7] Installing app dependencies..."

if [ "${REPO_DIR}" != "${APP_HOME}" ]; then
  echo "       Copying repo to ${APP_HOME}..."
  cp -r "${REPO_DIR}" "${APP_HOME}"
  chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}"
fi

cd "${APP_HOME}"
sudo -u "${APP_USER}" npm install --production

# ── 6. Set up .env ────────────────────────────────────────────────────────────
echo ""
echo "[6/7] Configuring environment..."

ENV_FILE="${APP_HOME}/.env"
if [ ! -f "${ENV_FILE}" ]; then
  cp "${APP_HOME}/.env.example" "${ENV_FILE}"
  chown "${APP_USER}:${APP_USER}" "${ENV_FILE}"

  # Generate a random API key
  GENERATED_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s/change-me-to-a-long-random-secret/${GENERATED_KEY}/" "${ENV_FILE}"
  chmod 640 "${ENV_FILE}"

  echo ""
  echo "  ╔══════════════════════════════════════════════════════════╗"
  echo "  ║  .env file created at: ${ENV_FILE}"
  echo "  ║  Generated API Key: ${GENERATED_KEY}"
  echo "  ║                                                          ║"
  echo "  ║  !! SAVE THIS KEY — you need it in your POS app !!      ║"
  echo "  ║  To view it again: cat ${ENV_FILE}  ║"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  echo ""

  echo "       Review and adjust printer settings in ${ENV_FILE}"
  echo "       Default printer interface: /dev/usb/lp0"
  echo "       Run 'ls /dev/usb/' to confirm your printer path."
else
  echo "       .env already exists, skipping."
fi

# ── 7. Install & enable systemd service ──────────────────────────────────────
echo ""
echo "[7/7] Installing systemd service..."

SERVICE_SRC="${APP_HOME}/systemd/${SERVICE_NAME}.service"
SERVICE_DEST="/etc/systemd/system/${SERVICE_NAME}.service"

cp "${SERVICE_SRC}" "${SERVICE_DEST}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl start "${SERVICE_NAME}"

sleep 2
STATUS=$(systemctl is-active "${SERVICE_NAME}" 2>/dev/null || echo "unknown")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup complete! Service status: ${STATUS}"
echo ""
echo "  Useful commands:"
echo "    systemctl status ${SERVICE_NAME}     — check status"
echo "    journalctl -fu ${SERVICE_NAME}       — live logs"
echo "    systemctl restart ${SERVICE_NAME}    — restart"
echo ""
echo "  Health check (once Tailscale is up):"
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "100.x.x.x")
echo "    curl http://${TAILSCALE_IP}:3000/health"
echo ""
echo "  Plugin in to your POS:"
echo "    PRINT_SERVER_URL = http://${TAILSCALE_IP}:3000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
