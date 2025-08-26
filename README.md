# Node HTML Receiver

🚀 **Enterprise-grade Node.js service for reliable HTML fetching with advanced anti-detection capabilities**

A high-performance, production-ready service that fetches real HTML content from any webpage using intelligent adapter selection, advanced caching, and comprehensive anti-bot evasion techniques.

## 🎯 Key Highlights

- **Enhanced Architecture**: Resource pooling, intelligent routing, and circuit breakers
- **Multiple Adapter Strategies**: HTTP, Browser, Crawlee (HTTP/Browser), and Adaptive modes
- **Advanced Anti-Detection**: Real browser fingerprints, session management, behavioral patterns
- **Intelligent Caching**: LRU cache with configurable TTL and size limits
- **Production Monitoring**: Built-in metrics, health checks, and performance tracking
- **Enterprise Security**: SSRF protection, DNS validation, host blocklisting
- **Proxy Management**: Automatic rotation, health scoring, and geographic consistency
- **100% Test Coverage**: Comprehensive test suite with all tests passing

## 📋 Features

### 🔧 Core Adapters
| Adapter | Description | Use Case |
|---------|-------------|----------|
| **EnhancedCrawleeHttp** | Crawlee HTTP with resource pooling | High-performance HTTP fetching |
| **EnhancedCrawleeBrowser** | Crawlee browser with browser pool | Advanced browser automation |
| **EnhancedHttp** | HTTP adapter with connection pooling | Static content, APIs |
| **EnhancedBrowser** | Browser adapter with resource management | JavaScript-heavy SPAs |
| **Adaptive** | Intelligent mode switching | Automatic optimization |

### 🛡️ Anti-Detection & Stealth
- **Browser Fingerprinting**: Real Chrome, Firefox, Safari fingerprints
- **Session Management**: Persistent sessions with automatic rotation
- **Behavioral Patterns**: Human-like timing and interaction patterns
- **Geographic Consistency**: Proxy location matches browser locale
- **Hardware Simulation**: Dynamic viewport and device characteristics
- **CrawlerPool**: Centralized crawler lifecycle management

### 🔐 Security & Reliability
- **SSRF Protection**: Protocol validation, DNS checks, IP filtering
- **Smart Retries**: Exponential backoff with adapter fallback
- **Proxy Health**: Automatic scoring and bad proxy removal
- **Error Recovery**: Circuit breakers and graceful degradation
- **Resource Management**: Automatic cleanup and memory optimization

### 📊 Monitoring & Performance
- **Caching System**: LRU cache with hit/miss tracking
- **Metrics Endpoint**: Real-time performance statistics
- **Health Checks**: Service and dependency status monitoring
- **Request Tracking**: Success rates, response times, error analysis
- **Resource Usage**: Memory, CPU, and connection pool metrics

### 🔌 API & Integration
- **REST API**: `POST /fetch` with JSON payload
- **CLI Tool**: `html-fetch <url> [-m mode] [-H "headers"]`
- **Monitoring**: `/metrics`, `/healthz`, `/cache/stats`
- **Logging**: Structured logs with Pino
- **Testing**: Jest with 100% passing tests

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ (20.x recommended)
- Ubuntu 22.04 or macOS (for production)
- 2GB+ RAM for browser operations

### Installation

```bash
# Clone repository
git clone https://github.com/mrxdev-git/html-proxy.git
cd html-proxy

# Install dependencies
npm ci

# Install Playwright browsers (optional, for browser modes)
npx playwright install chromium

# Configure environment
cp .env.example .env
# Edit .env with your settings
```

### Configuration

#### Core Settings
```env
PORT=3456                    # Service port
DEFAULT_MODE=adaptive       # Default fetching mode
TIMEOUT_MS=30000           # Request timeout
MAX_RETRIES=3              # Retry attempts
USER_AGENT="Mozilla/5.0..." # Default user agent
ARCHITECTURE_MODE=enhanced  # Architecture mode (legacy|enhanced)
```

#### Caching
```env
CACHE_ENABLED=true         # Enable LRU cache
CACHE_TTL_MS=600000       # Cache TTL (10 minutes)
CACHE_MAX_SIZE=500        # Max cached entries
```

#### Proxy Configuration
```env
PROXIES=http://proxy1.com:8080,http://proxy2.com:8080
PROXIES_FILE=/path/to/proxies.txt  # Alternative: file-based
```

#### Security
```env
ALLOW_PRIVATE_NETWORKS=false  # SSRF protection
BLOCKLIST_HOSTS=*.internal,*.local,metadata.google
```

#### Enhanced Architecture Settings
```env
# Resource Pooling
ENABLE_RESOURCE_POOLING=true
HTTP_POOL_MIN_SIZE=5
HTTP_POOL_MAX_SIZE=50
BROWSER_POOL_MIN_SIZE=2
BROWSER_POOL_MAX_SIZE=10

# Intelligent Routing
ENABLE_INTELLIGENT_ROUTING=true
ROUTING_STRATEGY=ml_based  # rule_based|ml_based|hybrid

# Circuit Breakers
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT_MS=60000

# Monitoring
ENABLE_MONITORING=true
MONITORING_PORT=3002
METRICS_ENABLED=true
METRICS_FLUSH_INTERVAL_MS=10000
```

#### Advanced Anti-Detection
```env
# Crawlee Settings
USE_CRAWLEE=true
MAX_SESSIONS=20
SESSION_MAX_USAGE=50
SESSION_MAX_ERRORS=3

# Browser Fingerprinting
FINGERPRINT_BROWSERS=chrome,firefox,safari
FINGERPRINT_DEVICES=desktop,mobile
FINGERPRINT_LOCALES=en-US,en-GB,de-DE
FINGERPRINT_OS=windows,macos,linux

# Crawler Pool
MAX_CRAWLERS=5
CRAWLER_IDLE_TIMEOUT_MS=300000
```

#### Page Loading Strategies
```env
# Loading Detection Strategies
LOADING_STRATEGY=adaptive  # Options: adaptive, fast, thorough, custom
WAIT_STRATEGIES=load,domcontentloaded,networkidle  # Comma-separated list

# Progressive Content Capture
PROGRESSIVE_CAPTURE=true  # Enable progressive content capture
PROGRESSIVE_INTERVAL_MS=2000  # Capture interval
PROGRESSIVE_MAX_CAPTURES=5  # Maximum capture attempts

# Advanced Wait Conditions
JS_COMPLETION_TIMEOUT=5000  # Wait for JS execution to complete
NETWORK_IDLE_TIMEOUT=3000  # Wait for network to be idle
WAIT_FOR_ELEMENT=#content  # CSS selector to wait for
```

### Running the Service

#### Logging Modes
```bash
# Silent mode (default) - Only fatal errors shown
npm start

# Verbose mode - All logs shown
npm run start:verbose
# Or with environment variable
VERBOSE=true npm start
# Or with command line flag
node src/start.js --verbose
```

#### Development Mode
```bash
# Start with verbose logging enabled by default
npm run dev

# Test the service
curl -X POST http://localhost:3456/fetch \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "mode": "http"}'
```

#### Production Mode
```bash
# Start production server (silent by default)
NODE_ENV=production npm start

# Start with verbose logging
NODE_ENV=production npm run start:verbose

# Or use systemd (Ubuntu)
sudo ./scripts/setup-local-daemon.sh --port 3456
```

### 🐳 Docker Deployment

#### Quick Start with Docker
```bash
# Build and run with Docker Compose
docker-compose up -d

# Or use the deployment script
./scripts/docker-deploy.sh prod
```

#### Development with Docker
```bash
# Start development environment
./scripts/docker-deploy.sh dev

# View logs
./scripts/docker-deploy.sh logs dev -f
```

#### Production Deployment
```bash
# Start production with monitoring
./scripts/docker-deploy.sh prod

# Check status
./scripts/docker-deploy.sh status

# Health check
./scripts/docker-deploy.sh health
```

#### Docker Configuration

**Environment Variables:**
Copy `.env.docker` to `.env.local` and customize:
```bash
cp .env.docker .env.local
# Edit .env.local with your settings
```

**Available Docker Commands:**
- `./scripts/docker-deploy.sh build` - Build Docker image
- `./scripts/docker-deploy.sh dev` - Start development environment
- `./scripts/docker-deploy.sh prod` - Start production environment
- `./scripts/docker-deploy.sh stop [env]` - Stop services
- `./scripts/docker-deploy.sh logs [env] [-f]` - View logs
- `./scripts/docker-deploy.sh status` - Show container status
- `./scripts/docker-deploy.sh health` - Perform health check
- `./scripts/docker-deploy.sh clean` - Clean up Docker resources

**Docker Compose Files:**
- `docker-compose.yml` - Base production configuration
- `docker-compose.dev.yml` - Development overrides
- `docker-compose.prod.yml` - Production with monitoring and scaling

#### CLI Usage

### Basic Fetch
```bash
# Fetch a page (silent mode by default)
html-fetch https://example.com

# With verbose logging
html-fetch https://example.com -v
html-fetch https://example.com --verbose

# With specific mode
html-fetch https://example.com -m browser

# Save output to file
html-fetch https://example.com -o output.html

# With custom headers
html-fetch https://example.com \
  -H "User-Agent: Custom/1.0" \
  -H "Accept-Language: en-US"

# Save to file
html-fetch https://example.com -o output.html
```

## 📚 API Documentation

### POST /fetch
Fetch HTML content from a URL

**Request:**
```json
{
  "url": "https://example.com",
  "mode": "adaptive",  // optional: http|browser|crawlee-http|crawlee-browser|adaptive
  "headers": {          // optional: custom headers
    "Accept-Language": "en-US"
  },
  "timeout": 30000,     // optional: override timeout
  "retries": 3          // optional: override retries
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "html": "<!DOCTYPE html>...",
    "url": "https://example.com",
    "statusCode": 200,
    "headers": {...},
    "mode": "http",
    "cached": false,
    "responseTime": 234
  }
}
```

### GET /healthz
Health check endpoint with architecture status

### GET /metrics
Prometheus-compatible metrics with enhanced architecture metrics

### GET /stats/adapters
Adapter performance statistics and circuit breaker status

### GET /stats/cache
Cache performance statistics

### GET /stats/pool
Resource pool statistics (browser and HTTP connection pools)

### GET /config
Current architecture configuration and feature flags

### GET /requests/active
Active request tracking (enhanced architecture only)

## 🎯 Architecture & Scaling

### System Architecture

#### Enhanced Architecture (ARCHITECTURE_MODE=enhanced)
```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Client    │────▶│   Express    │────▶│ Architecture     │
└─────────────┘     │    Server    │     │ Integration      │
                    └──────────────┘     └──────────────────┘
                            │                     │
                    ┌───────▼──────┐      ┌──────▼──────────┐
                    │   Metrics    │      │ AdapterRouter   │
                    │  Collector   │      │ (ML-based)      │
                    └──────────────┘      └─────────────────┘
                                                 │
                                    ┌────────────┼────────────┐
                                    │            │            │
                            ┌───────▼──────┐ ┌──▼───┐ ┌──────▼──────┐
                            │Resource Pool │ │Cache │ │  Enhanced   │
                            │  Manager     │ │      │ │  Adapters   │
                            └──────────────┘ └──────┘ └─────────────┘
```

#### Legacy Architecture (ARCHITECTURE_MODE=legacy)
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client    │────▶│   Express    │────▶│  Fetcher    │
└─────────────┘     │    Server    │     │   Service   │
                    └──────────────┘     └─────────────┘
                            │                     │
                    ┌───────▼──────┐      ┌──────▼──────┐
                    │Cache Service │      │   Adapters  │
                    └──────────────┘      └─────────────┘
                                                 │
                                          ┌──────▼──────┐
                                          │CrawlerPool  │
                                          └─────────────┘
```

### Scaling Recommendations

1. **Horizontal Scaling**: Stateless design allows multiple instances
2. **Load Balancing**: Use nginx/HAProxy for distribution
3. **Cache Strategy**: Consider Redis for shared cache across instances
4. **Resource Allocation**:
   - HTTP mode: 100-200 req/s per instance
   - Browser mode: 10-20 req/s per instance
   - Memory: 2-4GB per instance with browsers
5. **Monitoring**: Use Prometheus + Grafana for metrics visualization

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- tests/fetcher.test.js

# Run with open handles detection
npm test -- --detectOpenHandles
```

### Test Coverage
- ✅ SSRF protection utilities
- ✅ FetcherService with all adapters
- ✅ Server endpoints and error handling
- ✅ Proxy rotation and health scoring
- ✅ Cache operations and TTL
- ✅ Crawlee integration
- ✅ 100% of tests passing (18/18)

## 🔒 Security

### Built-in Protections
- **SSRF Prevention**: Blocks private IPs, validates protocols
- **DNS Validation**: Resolves and checks IPs before requests
- **Host Blocklisting**: Pattern-based domain filtering
- **Input Validation**: Strict URL and parameter validation
- **Rate Limiting**: Configurable per-client limits (when enabled)
- **Secure Headers**: Proper CORS and security headers

### Best Practices
- Never log sensitive data (tokens, passwords, cookies)
- Use HTTPS proxies when possible
- Rotate user agents and fingerprints
- Monitor failed request patterns
- Keep dependencies updated

## 📁 Project Structure

```
├── src/
│   ├── adapters/          # Fetching strategies
│   │   ├── interfaces/    # Adapter interfaces
│   │   │   └── ITransportAdapter.js
│   │   ├── managers/      # Resource managers
│   │   │   ├── AdapterRouter.js
│   │   │   └── ResourceManager.js
│   │   ├── pools/         # Resource pools
│   │   │   ├── BrowserPool.js
│   │   │   └── HttpConnectionPool.js
│   │   ├── EnhancedCrawleeHttpAdapter.js
│   │   ├── EnhancedCrawleeBrowserAdapter.js
│   │   ├── EnhancedHttpAdapter.js
│   │   └── EnhancedBrowserAdapter.js
│   ├── config/            # Configuration management
│   ├── proxy/             # Proxy pool and rotation
│   ├── services/          # Core services
│   │   ├── ArchitectureIntegration.js # Enhanced architecture
│   │   ├── EnhancedFetcherService.js  # Enhanced fetcher
│   │   ├── MetricsCollector.js        # Metrics collection
│   │   ├── fetcherService.js          # Legacy fetcher
│   │   └── cacheService.js            # LRU cache
│   ├── utils/             # Utilities
│   │   └── ssrf.js        # SSRF protection
│   ├── server.js          # Express application
│   └── main.js            # Entry point
├── bin/
│   └── html-fetch.js      # CLI tool
├── tests/                 # Test suite
├── scripts/               # Deployment scripts
└── storage/              # Crawlee storage (gitignored)
```

## 🤝 Contributing

Contributions are welcome! Please ensure:
1. All tests pass (`npm test`)
2. Code follows existing style
3. New features include tests
4. Documentation is updated

## 📄 License

MIT - See LICENSE file for details

## 🔗 Links

- [API Documentation](./docs/API.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [Local Service Setup](./LOCAL_SERVICE.md)

---

**Built with ❤️ for reliable web scraping**
