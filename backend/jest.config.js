/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.js'],
  clearMocks: true,
  collectCoverageFrom: ['lib/**/*.js', 'middleware/**/*.js'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  // Os testes de API usam um Postgres real e compartilhado: um arquivo por vez.
  maxWorkers: 1,
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/globalSetup.js'
};
