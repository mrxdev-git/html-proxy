import pino from 'pino';

// Check for verbose flag from command line args or environment
const isVerbose = process.argv.includes('-v') || 
                  process.argv.includes('--verbose') || 
                  process.env.VERBOSE === 'true';

const isProd = process.env.NODE_ENV === 'production';

// Default to 'fatal' level unless verbose mode is enabled
const getLogLevel = () => {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  if (isVerbose) {
    return isProd ? 'info' : 'debug';
  }
  return 'fatal'; // Only show fatal errors by default
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
