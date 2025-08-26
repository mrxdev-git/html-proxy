import pino from 'pino';

// Check for verbose flag from command line args or environment
// Priority: CLI args > VERBOSE env var > NODE_ENV=development
const isVerbose = process.argv.includes('-v') || 
                  process.argv.includes('--verbose') || 
                  process.env.VERBOSE === 'true' ||
                  process.env.NODE_ENV === 'development';

const isProd = process.env.NODE_ENV === 'production';

// Default to appropriate level based on environment and verbosity
const getLogLevel = () => {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  if (isVerbose) {
    return isProd ? 'info' : 'debug';
  }
  // In production, show errors and warnings, not just fatal
  return isProd ? 'warn' : 'info';
};

export const logger = pino(
  isProd || !isVerbose
    ? { level: getLogLevel() }
    : {
        level: getLogLevel(),
        transport: {
          target: 'pino-pretty',
          options: { colorize: true }
        }
      }
);

// Export verbose flag for use in other modules
export const verbose = isVerbose;
