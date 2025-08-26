import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

function parseBool(v, def = false) {
  if (v === undefined) return def;
  return String(v).toLowerCase() === 'true';
}

function parseNumber(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function loadProxies() {
  const list = [];
  if (process.env.PROXIES) {
    list.push(
      ...process.env.PROXIES.split(',')
        .map(s => s.trim())
        .filter(Boolean)
    );
  }
  const file = process.env.PROXIES_FILE;
  if (file && fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    content
      .split(/\r?\n/) 
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(p => list.push(p));
  }
  return Array.from(new Set(list));
}

export function getConfig() {
  const cfg = {
    port: parseNumber(process.env.PORT, 8080),
    defaultMode: (process.env.DEFAULT_MODE || 'http').toLowerCase(),
    
    // Timeout settings
    timeoutMs: parseInt(process.env.TIMEOUT_MS || '20000'),
    maxRetries: parseNumber(process.env.MAX_RETRIES, 2),
    
    // Page loading strategy: 'fast', 'balanced', 'thorough', or 'custom'
    loadingStrategy: process.env.LOADING_STRATEGY || 'balanced',
    
    // Browser settings
    headless: parseBool(process.env.HEADLESS, true),
    userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    
    // Advanced loading detection settings
    progressiveCapture: process.env.PROGRESSIVE_CAPTURE !== 'false',
    jsCompletionTimeout: parseInt(process.env.JS_COMPLETION_TIMEOUT || '5000'),
    networkIdleTimeout: parseInt(process.env.NETWORK_IDLE_TIMEOUT || '2000'),
    concurrency: parseNumber(process.env.CONCURRENCY, 100),
    proxies: loadProxies(),
    allowPrivateNetworks: parseBool(process.env.ALLOW_PRIVATE_NETWORKS, false),
    blocklistHosts: (process.env.BLOCKLIST_HOSTS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    
    // Crawlee-specific configuration
    useCrawlee: parseBool(process.env.USE_CRAWLEE, false),
    maxSessions: parseNumber(process.env.MAX_SESSIONS, 20),
    renderingDetectionRatio: parseNumber(process.env.RENDERING_DETECTION_RATIO, 0.1),
    fingerprintBrowsers: (process.env.FINGERPRINT_BROWSERS || 'chrome,firefox')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    fingerprintDevices: (process.env.FINGERPRINT_DEVICES || 'desktop,mobile')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    fingerprintLocales: (process.env.FINGERPRINT_LOCALES || 'en-US,en-GB')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    fingerprintOS: (process.env.FINGERPRINT_OS || 'windows,macos,linux')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    sessionMaxUsage: parseNumber(process.env.SESSION_MAX_USAGE, 50),
    sessionMaxErrors: parseNumber(process.env.SESSION_MAX_ERRORS, 3),
  };
  
  // Support new modes: adaptive, crawlee-http, crawlee-browser
  if (!['http', 'browser', 'adaptive', 'crawlee-http', 'crawlee-browser'].includes(cfg.defaultMode)) {
    cfg.defaultMode = 'http';
  }
  
  return cfg;
}
