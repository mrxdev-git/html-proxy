#!/usr/bin/env node
import { Command } from 'commander';
import { getConfig } from './config/index.js';
import { buildApp } from './server.js';
import { logger, verbose } from './logger.js';

const program = new Command();

program
  .name('html-proxy')
  .description('Start the Node HTML Receiver server')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-p, --port <port>', 'Port to listen on')
  .option('-m, --mode <mode>', 'Default fetching mode (http|browser|crawlee-http|crawlee-browser|adaptive)')
  .option('--dev', 'Run in development mode (enables verbose logging)')
  .option('--prod', 'Run in production mode')
  .parse(process.argv);

const options = program.opts();

// Set environment variables based on CLI options
if (options.verbose || options.dev) {
  process.env.VERBOSE = 'true';
}

if (options.dev) {
  process.env.NODE_ENV = 'development';
}

if (options.prod) {
  process.env.NODE_ENV = 'production';
}

if (options.port) {
  process.env.PORT = options.port;
}

if (options.mode) {
  process.env.DEFAULT_MODE = options.mode;
}

// Start the server
async function startServer() {
  try {
    const config = getConfig();
    const app = buildApp(config);

    const server = app.listen(config.port, () => {
      if (verbose) {
        logger.info({ 
          port: config.port, 
          mode: config.defaultMode,
          environment: process.env.NODE_ENV || 'development',
          verbose: verbose
        }, 'Server started');
      } else {
        console.log(`Server listening on port ${config.port}`);
      }
    });

    // Graceful shutdown
    const shutdown = async (sig) => {
      if (verbose) {
        logger.info({ sig }, 'Shutting down gracefully');
      }
      
      // Close server
      server.close(() => {
        if (verbose) {
          logger.info('Server closed');
        }
        process.exit(0);
      });
      
      // Force exit after timeout
      setTimeout(() => {
        logger.error('Force exit after timeout');
        process.exit(1);
      }, 10000).unref();
    };

    // Handle process signals
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => shutdown(sig));
    }

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.fatal({ reason, promise }, 'Unhandled rejection');
      process.exit(1);
    });

  } catch (error) {
    logger.fatal({ error: error.message, stack: error.stack }, 'Failed to start server');
    process.exit(1);
  }
}

// If called directly (not imported), start the server
// Simply start the server when this file is executed
startServer();

export { startServer };
