export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['js', 'json'],
  verbose: false,
  // ESM is enabled via package.json { "type": "module" }
  
  // Fix for Jest deprecation warning about soft-deleted objects
  // This prevents the _ClientRequestInterceptor warning from nock
  restoreMocks: true,
  clearMocks: true,
  resetMocks: true,
  
  // Ensure test isolation and prevent memory leaks
  resetModules: false,
  testTimeout: 30000,
};
