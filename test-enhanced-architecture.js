#!/usr/bin/env node

import axios from 'axios';
import { logger } from './src/logger.js';

const BASE_URL = 'http://localhost:8080';

async function testEndpoint(name, endpoint, options = {}) {
  try {
    const response = await axios({
      url: `${BASE_URL}${endpoint}`,
      ...options
    });
    console.log(`✅ ${name}: Success`);
    return response.data;
  } catch (error) {
    console.error(`❌ ${name}: Failed - ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('\n🚀 Testing Enhanced Architecture\n');
  console.log('================================\n');

  // Test health check
  const health = await testEndpoint('Health Check', '/healthz');
  if (health) {
    console.log(`   Status: ${health.status}`);
    console.log(`   Architecture: ${health.architecture || 'legacy'}\n`);
  }

  // Test configuration endpoint
  const config = await testEndpoint('Configuration', '/config');
  if (config) {
    console.log(`   Architecture Mode: ${config.architectureMode}`);
    console.log(`   Features: ${JSON.stringify(config.features)}\n`);
  }

  // Test metrics
  const metrics = await testEndpoint('Metrics', '/metrics');
  if (metrics) {
    console.log(`   Total Requests: ${metrics.totalRequests || 0}`);
    console.log(`   Success Rate: ${metrics.successRate || 'N/A'}%\n`);
  }

  // Test adapter stats
  const adapterStats = await testEndpoint('Adapter Stats', '/stats/adapters');
  if (adapterStats) {
    console.log(`   Adapters: ${Object.keys(adapterStats).length}\n`);
  }

  // Test cache stats
  const cacheStats = await testEndpoint('Cache Stats', '/stats/cache');
  if (cacheStats) {
    console.log(`   Cache Size: ${cacheStats.size || 0}`);
    console.log(`   Hit Rate: ${cacheStats.hitRate || 0}%\n`);
  }

  // Test active requests
  const activeRequests = await testEndpoint('Active Requests', '/requests/active');
  if (activeRequests) {
    console.log(`   Active: ${activeRequests.count || 0}\n`);
  }

  // Test fetch endpoint with different modes
  console.log('Testing Fetch Endpoints:\n');
  
  const testUrl = 'https://example.com';
  
  // Test HTTP mode
  const httpFetch = await testEndpoint('Fetch (HTTP)', '/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: { url: testUrl, mode: 'http' }
  });
  if (httpFetch?.data) {
    console.log(`   Mode: ${httpFetch.data.mode}`);
    console.log(`   Cached: ${httpFetch.data.cached}`);
    console.log(`   Response Time: ${httpFetch.data.responseTime}ms\n`);
  }

  // Test enhanced Crawlee HTTP mode
  const crawleeHttpFetch = await testEndpoint('Fetch (Crawlee HTTP)', '/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: { url: testUrl, mode: 'crawlee-http' }
  });
  if (crawleeHttpFetch?.data) {
    console.log(`   Mode: ${crawleeHttpFetch.data.mode}`);
    console.log(`   Response Time: ${crawleeHttpFetch.data.responseTime}ms\n`);
  }

  // Test adaptive mode
  const adaptiveFetch = await testEndpoint('Fetch (Adaptive)', '/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: { url: testUrl, mode: 'adaptive' }
  });
  if (adaptiveFetch?.data) {
    console.log(`   Selected Mode: ${adaptiveFetch.data.mode}`);
    console.log(`   Response Time: ${adaptiveFetch.data.responseTime}ms\n`);
  }

  console.log('================================\n');
  console.log('✨ Enhanced Architecture Test Complete!\n');
}

// Check if server is running
async function checkServer() {
  try {
    await axios.get(`${BASE_URL}/healthz`);
    return true;
  } catch (error) {
    return false;
  }
}

async function main() {
  const serverRunning = await checkServer();
  
  if (!serverRunning) {
    console.log('⚠️  Server is not running. Please start the server first:');
    console.log('   ARCHITECTURE_MODE=enhanced npm start\n');
    process.exit(1);
  }

  await runTests();
}

main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
