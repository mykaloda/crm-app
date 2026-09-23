/** E2E tests: real Postgres (pgvector) + Redis. Uses DATABASE_URL_TEST if set. */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['@swc/jest'] },
  moduleNameMapper: { '^@agentmatch/shared$': '<rootDir>/../../packages/shared/src' },
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/env.ts'],
  testTimeout: 60000,
};
