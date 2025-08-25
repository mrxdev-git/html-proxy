# 🏗️ System Architecture

## Overview

Node HTML Receiver is a modular, scalable service designed for reliable HTML content fetching with advanced anti-detection and security features. The architecture follows a layered approach with clear separation of concerns and pluggable adapters.

```
┌─────────────────────────────────────────────────────────────┐
│                         Client Layer                         │
│                    (CLI / REST API / SDK)                    │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                      API Gateway Layer                       │
│              (Express Server / Rate Limiting)                │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                     Service Layer                            │
│         (FetcherService / CrawleeService)                    │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                      Adapter Layer                           │
│    (HTTP / Browser / Crawlee-HTTP / Crawlee-Browser)         │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                      │
│     (Cache / Proxy Pool / Crawler Pool / Monitoring)         │
└─────────────────────────────────────────────────────────────┘

```

## Core Components

### 1. API Gateway (`src/server.js`)

The entry point for all HTTP requests, responsible for:

- **Request routing** and validation
- **Rate limiting** to prevent abuse
- **CORS handling** for browser clients
- **Health checks** and monitoring endpoints
- **Error handling** and response formatting

**Key Endpoints:**
- `POST /fetch` - Main fetching endpoint
- `GET /healthz` - Health check
- `GET /metrics` - Prometheus metrics
- `GET /cache/stats` - Cache statistics
- `GET /crawlers/status` - Crawler pool status

### 2. Service Layer

#### FetcherService (`src/services/fetcherService.js`)

Central orchestrator for content fetching:

```javascript
class FetcherService {
  // Coordinates adapter selection
  // Implements retry logic
  // Manages caching
  // Enforces SSRF protection
}
```

**Responsibilities:**
- Adapter selection based on mode
- Request validation and sanitization
- Cache management (read/write)
- Retry logic with exponential backoff
- SSRF protection enforcement

#### CrawleeService (`src/services/crawleeService.js`)

Advanced crawling orchestrator using Crawlee framework:

```javascript
class CrawleeService {
  // Manages Crawlee crawlers
  // Implements anti-detection
  // Handles session rotation
  // Coordinates proxy usage
}
```

**Features:**
- Session persistence
- Automatic proxy rotation
- Browser fingerprint randomization
- Request queue management
- Error recovery and retries

### 3. Adapter Layer

Pluggable adapters for different fetching strategies:

#### Base Adapter (`src/adapters/base.js`)

Abstract base class defining the adapter interface:

```javascript
class BaseAdapter {
  async fetch(url, options) // Must be implemented
  validateUrl(url)          // Common validation
  handleError(error)        // Error normalization
}
```

#### HTTP Adapter (`src/adapters/http.js`)

Lightweight, fast fetching using axios:
- Modern browser headers
- Cookie handling
- Redirect following
- Timeout management

#### Browser Adapter (`src/adapters/browser.js`)

Puppeteer-based fetching for JavaScript-heavy sites:
- Real browser rendering
- JavaScript execution
- Screenshot capability
- Element interaction

#### Crawlee Adapters (`src/adapters/crawlee*.js`)

Enterprise-grade adapters using Crawlee:
- **CrawleeHTTP**: HTTP with advanced features
- **CrawleeBrowser**: Playwright with anti-detection

### 4. Infrastructure Layer

#### Cache Service (`src/services/cacheService.js`)

LRU cache with TTL support:

```javascript
{
  maxSize: 500,           // Maximum entries
  ttl: 3600000,          // Time to live (ms)
  hitRate: tracking,     // Performance metrics
  keyGeneration: md5     // Consistent hashing
}
```

#### Proxy Pool (`src/proxy/proxyPool.js`)

Manages proxy rotation:
- Round-robin selection
- Failure tracking
- Automatic retry with different proxy
- Support for HTTP/SOCKS5

#### Crawler Pool (`src/services/crawlerPool.js`)

Browser instance management:
- Connection pooling
- Resource cleanup
- Idle timeout management
- Concurrent request limiting

## Data Flow

### Standard Request Flow

```
1. Client Request
   └─> API Gateway (validation)
       └─> FetcherService (orchestration)
           ├─> Cache Check (if enabled)
           │   └─> Return cached if hit
           └─> Adapter Selection
               ├─> SSRF Protection
               ├─> Proxy Assignment
               └─> Content Fetch
                   ├─> Success: Cache & Return
                   └─> Failure: Retry or Error
```

### Adaptive Mode Flow

```
1. Initial HTTP Attempt
   └─> HTTP Adapter
       ├─> Success: Return content
       └─> Failure: Escalate
           └─> Browser Adapter
               ├─> Success: Return content
               └─> Failure: Crawlee attempt
                   └─> CrawleeBrowser
                       └─> Final result
```

## Security Architecture

### SSRF Protection

Multi-layer defense against Server-Side Request Forgery:

```javascript
{
  protocolValidation: ['http', 'https'],
  dnsResolution: true,
  privateNetworkBlock: configurable,
  hostBlocklist: customizable,
  redirectValidation: recursive
}
```

### Request Validation

- URL sanitization
- Header injection prevention
- Query parameter validation
- Body size limits
- Timeout enforcement

### Process Isolation

- Separate browser processes
- Sandboxed JavaScript execution
- Resource limits (CPU/Memory)
- Temporary file cleanup

## Scaling Architecture

### Horizontal Scaling

```
        Load Balancer
             │
    ┌────────┼────────┐
    │        │        │
Instance1 Instance2 Instance3
    │        │        │
    └────────┼────────┘
         Shared
      Cache/State
```

### Deployment Options

#### PM2 Cluster Mode
```javascript
{
  instances: "max",      // CPU cores
  exec_mode: "cluster",  // Node.js clustering
  max_memory_restart: "1G"
}
```

#### Docker Swarm
```yaml
services:
  app:
    replicas: 3
    resources:
      limits:
        memory: 2G
```

#### Kubernetes
```yaml
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
```

## Monitoring & Observability

### Metrics Collection

```
Application Metrics
    └─> Prometheus Format
        └─> Time Series Data
            ├─> Request rates
            ├─> Response times
            ├─> Error rates
            ├─> Cache hit rates
            └─> Resource usage
```

### Health Checks

```javascript
{
  "/healthz": {
    status: "ok|degraded|down",
    checks: {
      cache: boolean,
      browser: boolean,
      memory: percentage,
      uptime: seconds
    }
  }
}
```

### Logging Strategy

- **Structured logging** with JSON format
- **Log levels**: error, warn, info, debug
- **Correlation IDs** for request tracing
- **Performance metrics** in logs
- **Error stack traces** with context

## Performance Optimizations

### Caching Strategy

1. **Content Cache**: Full HTML responses
2. **DNS Cache**: Resolution results
3. **Session Cache**: Browser sessions
4. **Proxy Cache**: Working proxy status

### Resource Management

```javascript
{
  browserPool: {
    max: 3,
    idleTimeout: 60000,
    recycleAfter: 100
  },
  memoryLimits: {
    heap: "1.5GB",
    rss: "2GB"
  },
  requestTimeouts: {
    http: 30000,
    browser: 60000
  }
}
```

### Network Optimizations

- Keep-alive connections
- DNS prefetching
- Compression (gzip/brotli)
- HTTP/2 support
- Connection pooling

## Extension Points

### Custom Adapters

Implement new fetching strategies:

```javascript
class CustomAdapter extends BaseAdapter {
  async fetch(url, options) {
    // Custom implementation
  }
}
```

### Middleware Pipeline

Add custom processing:

```javascript
app.use('/fetch', [
  authMiddleware,
  customValidation,
  customTransform
]);
```

### Plugin System

Future extensibility:

```javascript
{
  plugins: [
    'cache-redis',
    'metrics-datadog',
    'auth-oauth2'
  ]
}
```

## Configuration Management

### Environment Variables

```bash
# Core settings
PORT=3456
DEFAULT_MODE=adaptive

# Performance tuning
MAX_CRAWLERS=3
CACHE_TTL_MS=3600000

# Security
ALLOW_PRIVATE_NETWORKS=false
BLOCKLIST_HOSTS=internal.com

# Features
USE_CRAWLEE=true
USE_FINGERPRINTING=true
```

### Configuration Precedence

1. Environment variables
2. `.env` file
3. Config files (`config/*.js`)
4. Default values

## Development Architecture

### Project Structure

```
src/
├── adapters/        # Fetching strategies
├── config/          # Configuration
├── services/        # Business logic
├── proxy/           # Proxy management
├── utils/           # Utilities
├── middleware/      # Express middleware
├── server.js        # Entry point
└── index.js         # Service wrapper

tests/
├── unit/           # Unit tests
├── integration/    # Integration tests
└── e2e/           # End-to-end tests
```

### Testing Strategy

- **Unit tests**: Individual components
- **Integration tests**: Component interaction
- **E2E tests**: Full request flow
- **Load tests**: Performance validation
- **Security tests**: Vulnerability scanning

## Deployment Architecture

### Production Stack

```
    CDN (Optional)
         │
    Load Balancer
         │
    Nginx Proxy
         │
    Application
         │
    ┌────┴────┐
Cache    Database
```

### High Availability

- Multiple instances across zones
- Health check-based routing
- Automatic failover
- Session affinity (if needed)
- Graceful shutdown handling

## Future Architecture Considerations

### Planned Enhancements

1. **Distributed Caching**: Redis/Memcached integration
2. **Queue System**: RabbitMQ/SQS for async processing
3. **ML Integration**: Smart mode selection
4. **WebSocket Support**: Real-time updates
5. **GraphQL API**: Flexible querying

### Scalability Roadmap

- Microservices decomposition
- Event-driven architecture
- CQRS pattern implementation
- Service mesh adoption
- Serverless functions

## Conclusion

The Node HTML Receiver architecture is designed to be:

- **Modular**: Easy to extend and maintain
- **Scalable**: Horizontal and vertical scaling
- **Secure**: Multiple defense layers
- **Performant**: Optimized for speed and efficiency
- **Reliable**: Fault-tolerant with retry mechanisms
- **Observable**: Comprehensive monitoring

This architecture supports both simple use cases and enterprise-grade deployments while maintaining flexibility for future enhancements.
