# Production Deployment Guide

## 🚀 Deploying Node HTML Receiver

This guide provides three production-ready deployment strategies:
- **Option A (Recommended)**: Docker + Docker Compose + Nginx
- **Option B**: PM2 cluster mode + Nginx + Certbot
- **Option C**: Systemd multi-instance + Nginx + Certbot

All options include:
- ✅ Zero-downtime deployments
- ✅ Multiple instances for high availability
- ✅ TLS/SSL with auto-renewal
- ✅ Health monitoring and metrics
- ✅ Advanced anti-detection features
- ✅ Production-grade security hardening

---

## 🐳 Option A: Docker Deployment (Recommended)

### Prerequisites for Docker
- Docker 20.10+ and Docker Compose 2.0+
- 4GB+ RAM (8GB recommended)
- 2+ CPU cores
- 20GB+ disk space

### Quick Docker Setup

#### 1. Install Docker and Docker Compose
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Logout and login again, or run:
newgrp docker
```

#### 2. Clone and Configure
```bash
# Clone the repository
git clone <repository-url> html-proxy
cd html-proxy

# Create environment configuration
cp .env.docker .env.local

# Edit configuration as needed
nano .env.local
```

#### 3. Deploy Production Environment
```bash
# Start production services
./scripts/docker-deploy.sh prod

# Check status
./scripts/docker-deploy.sh status

# View logs
./scripts/docker-deploy.sh logs prod

# Health check
./scripts/docker-deploy.sh health
```

### Docker Production Features

#### Multi-Stage Build
- Optimized production image with minimal attack surface
- Separate development and production stages
- Non-root user execution for security

#### Container Security
- Read-only filesystem with specific writable mounts
- Dropped capabilities and security options
- Resource limits and health checks
- No-new-privileges security option

#### Monitoring and Scaling
```bash
# Production with monitoring (Prometheus + Grafana)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Scale horizontally
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale html-proxy=3
```

#### Load Balancing with Nginx
The production setup includes Nginx with:
- Rate limiting (5 req/s for /fetch, 10 req/s for other endpoints)
- Security headers
- CORS support
- Health check routing
- SSL termination support

#### SSL/TLS Setup
```bash
# Install Certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal (already configured in most systems)
sudo systemctl enable certbot.timer
```

#### Environment Variables for Production
```bash
# Essential production settings in .env.local
NODE_ENV=production
PORT=8080
DEFAULT_MODE=crawlee-browser
VERBOSE=false
LOG_LEVEL=error

# Security settings
ALLOW_PRIVATE_NETWORKS=false
BLOCKLIST_HOSTS=*.internal,*.local,metadata.google,169.254.169.254

# Performance tuning
CACHE_ENABLED=true
CACHE_MAX_SIZE=1000
MAX_CRAWLERS=5
MAX_SESSIONS=20
```

#### Backup and Persistence
```bash
# Backup Docker volumes
docker run --rm -v html-proxy_html-proxy-storage:/data -v $(pwd):/backup alpine tar czf /backup/storage-backup.tar.gz -C /data .

# Restore from backup
docker run --rm -v html-proxy_html-proxy-storage:/data -v $(pwd):/backup alpine tar xzf /backup/storage-backup.tar.gz -C /data
```

#### Monitoring Endpoints
- Health: `http://localhost:8080/healthz`
- Metrics: `http://localhost:8080/metrics`
- Cache Stats: `http://localhost:8080/stats/cache`
- Adapter Stats: `http://localhost:8080/stats/adapters`
- Pool Stats: `http://localhost:8080/stats/pool`

#### Troubleshooting Docker Deployment
```bash
# View container logs
docker-compose logs html-proxy

# Execute commands in container
docker-compose exec html-proxy sh

# Restart services
docker-compose restart

# Clean rebuild
docker-compose down
docker system prune -f
./scripts/docker-deploy.sh build
./scripts/docker-deploy.sh prod
```

---

## 📋 Prerequisites for Native Deployment

### System Requirements
- Ubuntu 22.04 LTS (or compatible)
- 4GB+ RAM (8GB recommended for browser modes)
- 2+ CPU cores
- 20GB+ disk space
- sudo access

### Network Requirements
- Domain pointing to server IP (e.g., `api.example.com`)
- Open ports:
  - 22 (SSH)
  - 80 (HTTP for Certbot)
  - 443 (HTTPS)
  - 3456 (internal service port)

---

## 1) Create a deploy user and basic hardening
```bash
# As root or a sudo user
adduser deploy
usermod -aG sudo deploy

# SSH hardening (optional, recommended)
# Edit /etc/ssh/sshd_config, set PasswordAuthentication no, PermitRootLogin no
# Then restart SSH: systemctl restart ssh

# Basic firewall
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
ufw status
```

---

## 2) Install Node.js 20 LTS and Dependencies

```bash
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git build-essential

# Install Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Playwright browser dependencies
sudo apt-get install -y \
  libnss3 libxss1 libasound2 libxrandr2 libxcomposite1 \
  libxcursor1 libxdamage1 libxi6 libxtst6 libgtk-3-0 \
  libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 \
  libcairo-gobject2 libgdk-pixbuf2.0-0 libgbm1 \
  fonts-liberation libappindicator3-1 xdg-utils

# Verify installation
node -v  # Should be 20.x
npm -v   # Should be 10.x
```

---

## 3) Deploy the Application

```bash
# Switch to deploy user
sudo -iu deploy

# Create app directory
mkdir -p ~/apps && cd ~/apps

# Clone the repository
git clone https://github.com/mrxdev-git/html-proxy.git
cd html-proxy

# Install production dependencies
npm ci --production

# Install Playwright browsers (for browser/crawlee modes)
npx playwright install chromium

# Verify installation
node bin/html-fetch.js --version
```

---

## 4) Configure Environment

### Production Environment File

Create a secure environment configuration:

```bash
# Copy example and customize
cp .env.example .env

# Edit with production values
nano .env
```

### Recommended Production Settings

```env
# Core Settings
PORT=3456
NODE_ENV=production
DEFAULT_MODE=adaptive  # Intelligent mode selection
TIMEOUT_MS=30000
MAX_RETRIES=3

# Caching (Highly Recommended)
CACHE_ENABLED=true
CACHE_TTL_MS=600000     # 10 minutes
CACHE_MAX_SIZE=1000     # Adjust based on memory

# Security
ALLOW_PRIVATE_NETWORKS=false
BLOCKLIST_HOSTS=metadata.google.internal,169.254.169.254,*.internal,*.local

# Advanced Anti-Detection
USE_CRAWLEE=true
MAX_SESSIONS=20
SESSION_MAX_USAGE=50
SESSION_MAX_ERRORS=3

# Browser Fingerprinting
FINGERPRINT_BROWSERS=chrome,firefox,safari
FINGERPRINT_DEVICES=desktop,mobile
FINGERPRINT_LOCALES=en-US,en-GB
FINGERPRINT_OS=windows,macos,linux

# Crawler Pool Management
MAX_CRAWLERS=5
CRAWLER_IDLE_TIMEOUT_MS=300000

# Proxy Configuration (if using)
# PROXIES=http://proxy1:8080,http://proxy2:8080
# PROXIES_FILE=/etc/html-proxy/proxies.txt
```

### System-wide Configuration (for systemd)

```bash
sudo tee /etc/html-proxy.env >/dev/null <<'EOF'
PORT=3456
NODE_ENV=production
DEFAULT_MODE=adaptive
CACHE_ENABLED=true
USE_CRAWLEE=true
ALLOW_PRIVATE_NETWORKS=false
BLOCKLIST_HOSTS=metadata.google.internal,169.254.169.254,*.internal
EOF

sudo chmod 600 /etc/html-proxy.env
```

If using PM2, you can keep `.env` in the repo root or export vars in your shell.

---

## 5) Reverse proxy with Nginx + TLS (applies to both options)
```bash
sudo apt-get install -y nginx

# Create an upstream and server block
sudo tee /etc/nginx/sites-available/html-proxy.conf >/dev/null <<'EOF'
upstream html_receiver_upstream {
    # For Option A (PM2 cluster), all instances share port 3456
    server 127.0.0.1:3456;
    
    # For Option B (systemd multi-instance), uncomment and use:
    # server 127.0.0.1:3456;
    # server 127.0.0.1:3457;
    # server 127.0.0.1:3458;
    # server 127.0.0.1:3459;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name YOUR_DOMAIN_HERE; # e.g., api.example.com

    # Large headers if needed by target sites
    client_max_body_size 10m;

    # Main fetching endpoint
    location /fetch {
        proxy_pass http://html_receiver_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        client_max_body_size 10m;
    }
    
    # Health check endpoint
    location /healthz {
        proxy_pass http://html_receiver_upstream;
        proxy_http_version 1.1;
        access_log off;
    }
    
    # Metrics endpoint (restrict access)
    location /metrics {
        proxy_pass http://html_receiver_upstream;
        proxy_http_version 1.1;
        # Restrict to monitoring systems
        allow 10.0.0.0/8;
        deny all;
    }
    
    # Cache statistics (restrict access)
    location /cache/stats {
        proxy_pass http://html_receiver_upstream;
        proxy_http_version 1.1;
        # Restrict to admin IPs
        allow 10.0.0.0/8;
        deny all;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/html-proxy.conf /etc/nginx/sites-enabled/html-proxy.conf
sudo nginx -t && sudo systemctl reload nginx
```

Issue a certificate with Certbot:
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN_HERE --redirect --agree-tos -m you@example.com --no-eff-email
# Auto-renewal is installed by default; test it:
sudo certbot renew --dry-run
```

---

## Option A (Recommended): PM2 cluster mode
PM2 manages clustering (multiple Node.js workers), restarts on crash, and zero-downtime reloads.

### 6A) Install PM2 and logrotate
```bash
sudo npm i -g pm2@latest
pm2 -v

# Optional: PM2 log rotate
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### 7A) Start the app in cluster mode
From the project directory:
```bash
cd ~/apps/html-proxy
# Ensure NODE_ENV and PORT are exported or present in .env
# Start with cluster mode (auto-scale to CPU cores)
pm2 start src/server.js -i max --name html-proxy \
  --merge-logs \
  --log-date-format="YYYY-MM-DD HH:mm:ss Z" \
  --update-env

# Persist across reboots
pm2 save
pm2 startup systemd -u $(whoami) --hp $(eval echo ~$(whoami))
# Follow the printed instruction to run the generated sudo command
```

Useful commands:
```bash
pm2 list
pm2 status html-proxy
pm2 logs html-proxy
pm2 reload html-proxy   # zero-downtime reload
pm2 restart html-proxy  # restart
pm2 stop html-proxy
```

Nginx upstream section for PM2 cluster can remain as a single `server 127.0.0.1:8080;` because PM2 uses a single port with multiple workers behind the same process name.

---

## Option B: Pure systemd with multiple instances
Run several app instances on different ports, and let Nginx round-robin them.

### 6B) Create a system user and directories
```bash
# As root
useradd -r -s /usr/sbin/nologin nodehtml || true
mkdir -p /opt/html-proxy
chown -R nodehtml:nodehtml /opt/html-proxy

# Deploy code (simple copy or CI/CD)
rsync -a --delete /home/deploy/apps/html-proxy/ /opt/html-proxy/
chown -R nodehtml:nodehtml /opt/html-proxy
```

### 7B) systemd unit template
```bash
sudo tee /etc/systemd/system/html-proxy@.service >/dev/null <<'EOF'
[Unit]
Description=html-proxy instance %i
After=network.target

[Service]
Type=simple
User=nodehtml
Group=nodehtml
WorkingDirectory=/opt/html-proxy
EnvironmentFile=/etc/html-proxy.env
# Override PORT per instance with systemd drop-in or via ExecStart env
ExecStart=/usr/bin/env PORT=%i NODE_ENV=production /usr/bin/node src/server.js
Restart=always
RestartSec=3
# Hardening (tune as needed)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
EOF
```

Start multiple instances on different ports:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now html-proxy@3456
sudo systemctl enable --now html-proxy@3457
sudo systemctl enable --now html-proxy@3458
sudo systemctl enable --now html-proxy@3459

systemctl status html-proxy@3456 --no-pager -l
journalctl -u html-proxy@3456 -f
```

Update Nginx upstream to include all ports:
```nginx
upstream html_receiver_upstream {
    server 127.0.0.1:3456;
    server 127.0.0.1:3457;
    server 127.0.0.1:3458;
    server 127.0.0.1:3459;
    keepalive 32;
}
```
Then reload Nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

Zero-downtime deployments can be done by restarting instances in a rolling fashion:
```bash
sudo systemctl restart html-proxy@3456
sleep 3
sudo systemctl restart html-proxy@3457
sleep 3
sudo systemctl restart html-proxy@3458
sleep 3
sudo systemctl restart html-proxy@3459
```

---

## 8) Health checks and monitoring
- Health endpoint: If you need a dedicated health route, consider adding `/health` in `src/server.js` returning 200.
- Nginx: add passive health checks via `proxy_next_upstream` options, or use active probes with external monitors.
- Monitoring: integrate Prometheus node_exporter and process metrics, or PM2 built-in monitoring (`pm2 monit`).
- Logs: Use PM2 logrotate (Option A) or systemd’s journald (Option B) + `journalctl`.

---

## 8) Health Checks and Monitoring

### Built-in Endpoints

```bash
# Health check
curl http://localhost:3456/healthz
# Returns: {"status":"ok","timestamp":"..."}

# Metrics (Prometheus-compatible)
curl http://localhost:3456/metrics

# Cache statistics
curl http://localhost:3456/cache/stats
# Returns cache hit rates, size, evictions, etc.
```

### Monitoring Integration

#### Option A: PM2 Monitoring
```bash
# Built-in monitoring
pm2 monit

# Web dashboard
pm2 install pm2-web
pm2 web
```

#### Option B: Prometheus + Grafana
```bash
# Install Prometheus node exporter
sudo apt-get install -y prometheus-node-exporter

# Configure Prometheus to scrape /metrics endpoint
# Add to prometheus.yml:
scrape_configs:
  - job_name: 'html-proxy'
    static_configs:
      - targets: ['localhost:3456']
```

### Log Management

```bash
# PM2 logs (Option A)
pm2 logs html-proxy --lines 100

# Systemd logs (Option B)
journalctl -u html-proxy@3456 -f --since "1 hour ago"

# Aggregate logs with ELK or Loki
```

---

## 9) Security best practices
- Keep `ALLOW_PRIVATE_NETWORKS=false` in production to prevent SSRF to private IPs.
- Maintain a strong `BLOCKLIST_HOSTS`.
- Avoid exposing the app port (8080/808x) publicly; only expose Nginx 80/443.
- Keep Node and system packages updated.
- Don’t commit secrets; manage environment variables securely (e.g., in `/etc/html-proxy.env`).

---

## 🔧 Troubleshooting

### Common Issues

#### Nginx 502/504 Errors
```bash
# Check service status
pm2 status  # or systemctl status html-proxy@*

# Check logs
pm2 logs html-proxy --err
journalctl -xe

# Verify ports
sudo netstat -tlnp | grep 3456
```

#### Playwright/Browser Issues
```bash
# Missing dependencies
sudo apt-get install -y $(npx playwright install-deps chromium)

# Headless issues
export DISPLAY=:99
Xvfb :99 -screen 0 1280x720x24 &
```

#### Memory Issues
```bash
# Check memory usage
pm2 status
free -h

# Adjust Node memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Reduce crawler pool size
MAX_CRAWLERS=3  # in .env
```

#### Cache Issues
```bash
# Check cache stats
curl http://localhost:3456/cache/stats

# Clear cache (restart service)
pm2 restart html-proxy
```

### Performance Tuning

```bash
# Sysctl optimizations
sudo tee -a /etc/sysctl.conf <<EOF
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
EOF

sudo sysctl -p
```

### Security Hardening

```bash
# Install fail2ban
sudo apt-get install -y fail2ban

# Configure UFW
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Regular updates
sudo apt-get update && sudo apt-get upgrade -y
npm audit fix
```

---

## 📊 Production Checklist

- [ ] Node.js 20 LTS installed
- [ ] Playwright browsers installed
- [ ] Environment variables configured
- [ ] PM2/systemd service running
- [ ] Nginx reverse proxy configured
- [ ] SSL certificate installed
- [ ] Health endpoints tested
- [ ] Monitoring configured
- [ ] Logs rotation setup
- [ ] Firewall configured
- [ ] Backup strategy in place
- [ ] Update procedure documented

---

## 🎉 Success!

Your Node HTML Receiver is now running in production with:
- High availability through clustering
- Advanced anti-detection capabilities
- Intelligent caching system
- Comprehensive monitoring
- Enterprise-grade security

For support and updates, check the [GitHub repository](https://github.com/mrxdev-git/html-proxy.git).
