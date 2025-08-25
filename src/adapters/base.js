export class BaseAdapter {
  constructor(config) {
    this.config = config;
  }
  
  // eslint-disable-next-line no-unused-vars
  async fetch(url, options = {}) {
    throw new Error('Not implemented');
  }
  
  async close() {
    // Override in subclasses if needed
  }
}
