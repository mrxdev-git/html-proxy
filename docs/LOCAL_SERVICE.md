# Local Service Setup Guide

## 🏠 Running Node HTML Receiver Locally

This guide shows how to run the service as a local-only daemon on Ubuntu 22.04 LTS, perfect for:
- Development environments
- Internal tools and automation
- Local web scraping tasks
- Testing and debugging

### Features Available Locally
- ✅ All fetching modes (HTTP, Browser, Crawlee, Adaptive)
- ✅ Advanced caching system
- ✅ Monitoring endpoints
- ✅ CLI tool integration
- ✅ Auto-restart on failure
- ✅ Secure local-only access

---

## 📋 Prerequisites

### System Requirements
- Ubuntu 22.04 LTS (or compatible)
- 2GB+ RAM (4GB for browser modes)
- Node.js 20.x LTS
- Git

### Installation

```bash
# Update system
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git build-essential

# Install Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node -v  # Should be 20.x
npm -v   # Should be 10.x
```

### Browser Mode Dependencies

If using browser or crawlee modes:

```bash
# Install Playwright dependencies
sudo apt-get install -y \
  libnss3 libxss1 libasound2 libxrandr2 libxcomposite1 \
  libxcursor1 libxdamage1 libxi6 libxtst6 libgtk-3-0 \
  libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 \
  libcairo-gobject2 libgdk-pixbuf2.0-0 libgbm1 \
  fonts-liberation libappindicator3-1 xdg-utils
```

---

## 🚀 Quick Setup

### Option 1: Automated Setup Script

```bash
# Download and run the setup script
curl -sSL https://raw.githubusercontent.com/mrxdev-git/node-html-receiver/main/scripts/setup-local-daemon.sh | bash

# Or with custom options
curl -sSL https://raw.githubusercontent.com/mrxdev-git/node-html-receiver/main/scripts/setup-local-daemon.sh | bash -s -- --port 3456 --dir ~/services
```

### Option 2: Manual Setup

```bash
# Create app directory
mkdir -p ~/apps && cd ~/apps

# Clone repository
git clone https://github.com/mrxdev-git/node-html-receiver.git
cd node-html-receiver

# Install dependencies
npm ci

# Install Playwright browsers (optional)
npx playwright install chromium

# Configure environment
cp .env.example .env
nano .env  # Edit configuration
```

### Recommended Local Configuration

```env
# .env file
PORT=3456
DEFAULT_MODE=adaptive  # Or 'http' for lighter usage
CACHE_ENABLED=true
CACHE_TTL_MS=300000    # 5 minutes for local
ALLOW_PRIVATE_NETWORKS=true  # Allow local network access
USE_CRAWLEE=true       # Enable advanced features
HEADLESS=true         # Run browsers in headless mode
```

---

## 🔒 Secure Local-Only Access

### Configure Firewall

```bash
# Install and configure UFW
sudo apt-get install -y ufw

# Allow SSH (if needed)
sudo ufw allow OpenSSH

# Block external access to service port
sudo ufw deny 3456

# Enable firewall
sudo ufw --force enable
sudo ufw status
```

### Bind to Localhost Only (Alternative)

Instead of firewall rules, you can configure the service to bind only to localhost:

```env
# In .env file
HOST=127.0.0.1
PORT=3456
```

### Verification

After starting the service:

```bash
# Should work (from same machine)
curl -I http://127.0.0.1:3456/healthz

# Should fail (from external machine)
curl -I http://SERVER_IP:3456/healthz  # Connection refused
```

---

## 🎯 Create Systemd Service

### User-Level Service (Recommended)

```bash
# Create user systemd directory
mkdir -p ~/.config/systemd/user

# Create service file
cat > ~/.config/systemd/user/node-html-receiver.service <<'EOF'
[Unit]
Description=Node HTML Receiver (Local)
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/apps/node-html-receiver
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=%h/apps/node-html-receiver/storage

# Resource limits
MemoryMax=2G
CPUQuota=80%

[Install]
WantedBy=default.target
EOF

# Enable lingering (auto-start on boot)
loginctl enable-linger "$USER"

# Start service
systemctl --user daemon-reload
systemctl --user enable --now node-html-receiver

# Check status
systemctl --user status node-html-receiver
```

### System-Level Service (Alternative)

```bash
# Create system service
sudo tee /etc/systemd/system/node-html-receiver.service >/dev/null <<'EOF'
[Unit]
Description=Node HTML Receiver (Local)
After=network.target

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=/home/$USER/apps/node-html-receiver
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3456
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
EOF

# Start service
sudo systemctl daemon-reload
sudo systemctl enable --now node-html-receiver
sudo systemctl status node-html-receiver
```

---

## 🧪 Testing & Usage

### API Endpoints

#### Health Check
```bash
curl http://localhost:3456/healthz
# Response: {"status":"ok","timestamp":"2024-01-01T00:00:00.000Z"}
```

#### Fetch Content
```bash
# Using POST (recommended)
curl -X POST http://localhost:3456/fetch \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "mode": "http"
  }' | jq .

# Using GET (legacy)
curl "http://localhost:3456/fetch?url=https://example.com&mode=http" | jq .
```

#### Monitoring Endpoints
```bash
# Cache statistics
curl http://localhost:3456/cache/stats | jq .
# Response: {"hits":100,"misses":20,"hitRate":0.83,"size":50,"maxSize":500}

# Metrics (Prometheus format)
curl http://localhost:3456/metrics

# Crawler pool status
curl http://localhost:3456/crawlers/status | jq .
```

### CLI Usage

```bash
# Basic fetch
~/apps/node-html-receiver/bin/html-fetch https://example.com

# With specific mode
~/apps/node-html-receiver/bin/html-fetch https://example.com -m browser

# Save to file
~/apps/node-html-receiver/bin/html-fetch https://example.com -o output.html

# With custom headers
~/apps/node-html-receiver/bin/html-fetch https://example.com \
  -H "User-Agent: Custom/1.0" \
  -H "Accept-Language: en-US"
```

---

## 🔧 Service Management

### Basic Commands

```bash
# Start/Stop/Restart
systemctl --user start node-html-receiver
systemctl --user stop node-html-receiver
systemctl --user restart node-html-receiver

# Enable/Disable auto-start
systemctl --user enable node-html-receiver
systemctl --user disable node-html-receiver

# Check status
systemctl --user status node-html-receiver
```

### Log Management

```bash
# View logs
journalctl --user -u node-html-receiver -f

# Last 100 lines
journalctl --user -u node-html-receiver -n 100

# Logs from last hour
journalctl --user -u node-html-receiver --since "1 hour ago"

# Export logs
journalctl --user -u node-html-receiver > receiver.log
```

### Updating the Service

```bash
# Pull latest code
cd ~/apps/node-html-receiver
git pull

# Update dependencies
npm ci

# Restart service
systemctl --user restart node-html-receiver
```

---

## 📊 Performance Monitoring

### Built-in Monitoring

```bash
# Create monitoring script
cat > ~/monitor-receiver.sh <<'EOF'
#!/bin/bash
while true; do
  clear
  echo "=== Node HTML Receiver Monitor ==="
  echo
  echo "Service Status:"
  systemctl --user status node-html-receiver --no-pager | head -n 5
  echo
  echo "Cache Stats:"
  curl -s http://localhost:3456/cache/stats | jq .
  echo
  echo "Recent Logs:"
  journalctl --user -u node-html-receiver -n 5 --no-pager
  sleep 5
done
EOF

chmod +x ~/monitor-receiver.sh
./monitor-receiver.sh
```

### Integration with Monitoring Tools

#### Prometheus
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'html-receiver'
    static_configs:
      - targets: ['localhost:3456']
    metrics_path: '/metrics'
```

#### Grafana Dashboard
```bash
# Import dashboard for metrics visualization
# Dashboard ID: [TBD - create and publish]
```

---

## 🚨 Troubleshooting

### Common Issues

#### Service Won't Start
```bash
# Check for port conflicts
sudo netstat -tlnp | grep 3456

# Check Node.js version
node -v  # Should be 20.x or higher

# Check logs for errors
journalctl --user -u node-html-receiver -n 50
```

#### Browser Mode Not Working
```bash
# Install missing dependencies
sudo apt-get install -y $(npx playwright install-deps chromium)

# Test Playwright
cd ~/apps/node-html-receiver
npx playwright test
```

#### High Memory Usage
```bash
# Check memory
free -h

# Adjust in .env
MAX_CRAWLERS=2  # Reduce concurrent browsers
CRAWLER_IDLE_TIMEOUT_MS=60000  # Shorter timeout
```

### Performance Tuning

```bash
# For HTTP-heavy workloads
DEFAULT_MODE=http
CACHE_MAX_SIZE=1000

# For browser-heavy workloads
DEFAULT_MODE=browser
MAX_CRAWLERS=3
HEADLESS=true
```

## 📚 Advanced Configuration

### Custom Proxy Setup
```env
# In .env
PROXIES=http://localhost:8888,socks5://localhost:1080
PROXIES_FILE=/home/user/proxies.txt
```

### Custom Headers
```env
USER_AGENT="Custom Bot 1.0"
DEFAULT_HEADERS='{"Accept-Language":"en-US","X-Custom":"value"}'
```

### Rate Limiting
```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
```

## 🎉 Success!

Your local Node HTML Receiver service is now:
- ✅ Running as a daemon
- ✅ Auto-starting on boot
- ✅ Accessible only locally
- ✅ Monitored and logged
- ✅ Ready for automation

### Next Steps

1. **Test the endpoints**: Try different fetching modes
2. **Monitor performance**: Check cache hit rates
3. **Automate tasks**: Integrate with your workflows
4. **Optimize settings**: Tune for your use case

For production deployment, see [DEPLOYMENT.md](./DEPLOYMENT.md)
For API documentation, see [README.md](./README.md)
