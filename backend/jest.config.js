/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  // Código de produção em TypeScript: transpila na hora (checagem de tipos fica com `npm run typecheck`).
  // NestJS exige decorators experimentais + metadata.
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          esModuleInterop: true,
          target: 'ES2020',
          isolatedModules: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true
        },
        diagnostics: false
      }
    ]
  },
  testMatch: ['**/*.test.js'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  // Os testes de API usam um Postgres real e compartilhado: um arquivo por vez.
  maxWorkers: 1,
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/globalSetup.js'
};
