#!/usr/bin/env bash
set -euo pipefail

# setup-local-daemon.sh
# Install and run html-proxy as a local-only daemon on Ubuntu 22.04+
# - Clones repo or uses existing installation
# - Installs Node.js LTS if missing
# - Installs Chrome/Chromium for Playwright
# - Creates a user-level systemd service
# - Configures service for local-only access
#
# Usage:
#   ./scripts/setup-local-daemon.sh [--port 3456] [--dir $HOME/apps/html-proxy]
#
# Notes:
# - Requires sudo for installing packages.
# - Service will auto-start on boot for the current user (via systemd user + lingering).
# - Includes browser dependencies for Crawlee/Playwright support.

REPO_URL="https://github.com/mrxdev-git/html-proxy.git"
APP_DEFAULT_DIR="$HOME/apps/html-proxy"
SERVICE_NAME="html-proxy"
PORT="3456"
APP_DIR="${APP_DEFAULT_DIR}"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="${2:-}"; shift 2;;
    --dir)
      APP_DIR="${2:-}"; shift 2;;
    -h|--help)
      echo "Usage: $0 [--port 8080] [--dir $HOME/apps/html-proxy]"; exit 0;;
    *)
      echo "Unknown arg: $1"; exit 1;;
  esac
done

# Helpers
have_cmd() { command -v "$1" >/dev/null 2>&1; }

info() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
success() { echo -e "\033[1;32m[SUCCESS]\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }

# 1) Ensure base packages
info "Installing base packages (sudo required)"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git build-essential \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libasound2

# 2) Install Node.js LTS if missing
if ! have_cmd node; then
  info "Node.js not found. Installing Node.js 20.x (LTS)"
  # Use NodeSource repository for Node.js 20.x
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
  sudo apt-get update
  sudo apt-get install -y nodejs
else
  info "Node.js found: $(node -v)"
  # Verify Node.js version is at least 18
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VERSION" -lt 18 ]]; then
    warn "Node.js version is too old. Please upgrade to Node.js 18 or later."
    exit 1
  fi
fi

# 3) Clone or update repository
info "Preparing application directory: $APP_DIR"
mkdir -p "${APP_DIR}"
if [[ ! -d "${APP_DIR}/.git" ]]; then
  info "Cloning ${REPO_URL}"
  git clone "${REPO_URL}" "${APP_DIR}"
else
  info "Repository exists; pulling latest"
  git -C "${APP_DIR}" fetch --all --prune
  git -C "${APP_DIR}" pull --ff-only
fi

# 4) Install dependencies
info "Installing dependencies with npm ci"
cd "${APP_DIR}"
if [[ -f package-lock.json ]]; then
  npm ci
else
  warn "package-lock.json not found; using npm install"
  npm install --no-audit --no-fund
fi

# Install Playwright browsers if needed
if [[ -f node_modules/.bin/playwright ]]; then
  info "Installing Playwright browsers"
  npx playwright install chromium || warn "Failed to install Playwright browsers"
fi

# 5) Create .env if missing and ensure PORT is set
if [[ ! -f .env ]]; then
  info "Creating .env from example"
  cp -f .env.example .env || true
fi

# Update PORT in .env
if grep -q '^PORT=' .env; then
  info "Updating PORT to ${PORT} in .env"
  sed -i "s/^PORT=.*/PORT=${PORT}/" .env
else
  info "Adding PORT=${PORT} to .env"
  echo "PORT=${PORT}" >> .env
fi

# Configure enhanced architecture mode
if ! grep -q '^ARCHITECTURE_MODE=' .env; then
  info "Setting ARCHITECTURE_MODE=enhanced in .env"
  echo "ARCHITECTURE_MODE=enhanced" >> .env
fi

# Configure monitoring port
if ! grep -q '^MONITORING_PORT=' .env; then
  info "Setting MONITORING_PORT=9090 in .env"
  echo "MONITORING_PORT=9090" >> .env
fi

# Ensure cache and storage directories exist
mkdir -p "${APP_DIR}/cache" "${APP_DIR}/storage"
chmod 755 "${APP_DIR}/cache" "${APP_DIR}/storage"

# 6) Create systemd user service
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_USER_DIR"
SERVICE_FILE="$SYSTEMD_USER_DIR/${SERVICE_NAME}.service"

info "Writing systemd user unit: $SERVICE_FILE"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Node HTML Receiver Service (local-only)
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment="NODE_ENV=production"
Environment="NODE_OPTIONS=--max-old-space-size=2048"
Environment="ARCHITECTURE_MODE=enhanced"
# App reads .env from WorkingDirectory
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitInterval=60
# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${APP_DIR}/cache ${APP_DIR}/storage

[Install]
WantedBy=default.target
EOF

# 7) Enable lingering so user services start at boot
info "Enabling lingering for user: $USER (sudo required)"
sudo loginctl enable-linger "$USER" || true

# 8) Reload and start the service
info "Starting systemd user service"
systemctl --user daemon-reload
systemctl --user enable --now "${SERVICE_NAME}.service"

# 9) Configure local-only access (optional UFW rules)
if have_cmd ufw; then
  info "UFW detected. Note: Service binds to 127.0.0.1 by default (local-only)"
  # Uncomment below to enable UFW rules if needed:
  # sudo ufw allow OpenSSH || true
  # sudo ufw deny "${PORT}" || true
  # sudo ufw --force enable
else
  info "UFW not installed. Service configured for local-only access via binding."
fi

# 10) Final checks
sleep 1
SYSTEMCTL_STATUS=$(systemctl --user is-active "${SERVICE_NAME}.service" || true)
if [[ "$SYSTEMCTL_STATUS" != "active" ]]; then
  warn "Service is not active yet. Check logs:"
  echo "  journalctl --user -u ${SERVICE_NAME}.service -f"
else
  success "Service is active: ${SERVICE_NAME}.service"
fi

info "Service endpoints:"
echo "  Health check:    curl -sS http://127.0.0.1:${PORT}/healthz"
echo "  Fetch HTML:      curl -X POST http://127.0.0.1:${PORT}/fetch -H 'Content-Type: application/json' -d '{\"url\":\"https://example.com\"}'"
echo "  Cache stats:     curl -sS http://127.0.0.1:${PORT}/cache/stats"
echo "  Metrics:         curl -sS http://127.0.0.1:9090/metrics"
echo "  Adapter stats:   curl -sS http://127.0.0.1:9090/stats/adapters"
echo "  Pool stats:      curl -sS http://127.0.0.1:9090/stats/pools"
echo "  Active requests: curl -sS http://127.0.0.1:9090/requests/active"

echo
success "Setup complete! Node HTML Receiver is running locally on port ${PORT}."
info "Service management:"
echo "  View logs:    journalctl --user -u ${SERVICE_NAME} -f"
echo "  Restart:      systemctl --user restart ${SERVICE_NAME}"
echo "  Stop:         systemctl --user stop ${SERVICE_NAME}"
echo "  Status:       systemctl --user status ${SERVICE_NAME}"
