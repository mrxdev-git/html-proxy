import { getConfig } from './config/index.js';
import { buildApp } from './server.js';
import { logger, verbose } from './logger.js';

const config = getConfig();
const app = buildApp(config);

const server = app.listen(config.port, () => {
  if (verbose) {
    logger.info({ port: config.port, mode: config.defaultMode }, 'Server started');
  } else {
    // Only show minimal output in non-verbose mode
    console.log(`Server listening on port ${config.port}`);
  }
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (verbose) {
      logger.info({ sig }, 'Shutting down');
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
