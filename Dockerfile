# Multi-stage build for production optimization
FROM node:20-alpine AS base

# Install system dependencies for Puppeteer and Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Tell Puppeteer to skip installing Chromium. We'll be using the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Development stage
FROM base AS development
RUN npm ci --include=dev
COPY . .
EXPOSE 8080
CMD ["npm", "run", "dev"]

# Production dependencies stage
FROM base AS deps
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM base AS production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodeuser:nodejs . .

# Create storage directory with proper permissions
RUN mkdir -p storage/key_value_stores/default storage/request_queues/default && \
    chown -R nodeuser:nodejs storage

# Switch to non-root user
USER nodeuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); \
    const options = { hostname: 'localhost', port: process.env.PORT || 8080, path: '/healthz', timeout: 5000 }; \
    const req = http.request(options, (res) => { \
        if (res.statusCode === 200) { console.log('Health check passed'); process.exit(0); } \
        else { console.log('Health check failed'); process.exit(1); } \
    }); \
    req.on('error', () => { console.log('Health check error'); process.exit(1); }); \
    req.end();"

# Expose port
EXPOSE 8080

# Default command
CMD ["npm", "start"]
