// @ts-check
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');
const { db, API_PORT, WEB_PORT, API_URL, WEB_URL, JWT_SECRET } = require('./support/env');

const raiz = path.join(__dirname, '..');
const reuse = !process.env.CI;

module.exports = defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./global-setup.js'),
  // Um worker só: todos os testes compartilham o mesmo banco, semeado a cada teste.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // Localmente para na 1ª falha: o resto costuma ser consequência (ambiente, seed, serviço fora do ar) e deve
  // ser analisado antes de continuar. Use E2E_MAX_FAILURES=0 para rodar tudo; no CI roda tudo.
  maxFailures: process.env.CI ? 0 : parseInt(process.env.E2E_MAX_FAILURES ?? '1', 10),
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      // SLOWMO=800 atrasa cada ação em 800 ms (use junto com --headed para acompanhar)
      use: { ...devices['Desktop Chrome'], launchOptions: { slowMo: parseInt(process.env.SLOWMO, 10) || 0 } }
    }
  ],
  webServer: [
    {
      name: 'api',
      command: 'npx tsx src/main.ts',
      cwd: path.join(raiz, 'backend'),
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: reuse,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'test',
        LOG_HTTP: '0',
        JWT_SECRET,
        DB_HOST: db.host,
        DB_PORT: String(db.port),
        DB_NAME: db.database,
        DB_USER: db.user,
        DB_PASSWORD: db.password
      }
    },
    {
      name: 'web',
      command: 'npx react-scripts start',
      cwd: path.join(raiz, 'frontend'),
      url: WEB_URL,
      reuseExistingServer: reuse,
      timeout: 180_000,
      env: {
        PORT: String(WEB_PORT),
        HOST: '127.0.0.1',
        BROWSER: 'none',
        REACT_APP_API_URL: API_URL,
        CI: 'false'
      }
    }
  ]
});
