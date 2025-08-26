import { PlaywrightCrawler, Dataset } from 'crawlee';
import { BaseAdapter } from './base.js';
import { logger } from '../logger.js';
import { getCrawlerPool, destroyCrawlerPool } from '../services/crawlerPool.js';

export class CrawleeBrowserAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    
    // Use the singleton crawler pool
    this.crawlerPool = getCrawlerPool(config);
    logger.info('CrawleeBrowserAdapter initialized with pool');
  }

  async fetch(url, options = {}) {
    try {
      logger.info({ url, adapter: 'crawlee-browser' }, 'Fetching with Crawlee Browser (pooled)');

      // Use the crawler pool for maximum performance
      const result = await this.crawlerPool.processRequest(url, options);
      
      if (!result || !result.html) {
        logger.error({ url, result }, 'No data retrieved from browser crawler pool');
        throw new Error('No data retrieved from browser crawler pool');
      }
      
      return {
        body: result.html,
        status: result.status || 200,
      };

    } catch (error) {
      logger.error({ 
        url, 
        error: error.message,
        stack: error.stack,
        type: error.constructor.name
      }, 'Crawlee browser pool fetch failed - detailed error');
      throw error;
    }
  }

  async close() {
    // Pool handles cleanup
    logger.info('CrawleeBrowserAdapter closing (pool will persist)');
  }
  
  // Get pool statistics for monitoring
  getStats() {
    return this.crawlerPool.getStats();
  }
  
  async destroy() {
    // Destroy the singleton pool
    await destroyCrawlerPool();
  }
}
