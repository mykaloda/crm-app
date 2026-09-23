/** Unit tests: pure logic, no database. */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['@swc/jest'] },
  moduleNameMapper: { '^@agentmatch/shared$': '<rootDir>/../../packages/shared/src' },
};
