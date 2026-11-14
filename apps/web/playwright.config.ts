/**
 * Testes ponta a ponta (Playwright) com o Microsoft Edge já instalado (channel 'msedge' — não baixa navegador).
 * Sobe a API apontando para o banco de TESTE (parkvision_teste) e a web numa porta própria, sem tocar no ambiente de desenvolvimento.
 */
import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

const envApi = Object.fromEntries(
  readFileSync(new URL('../api/.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const PORTA_API = 3334, PORTA_WEB = 5174;
export const TOKEN_E2E = envApi.SIMULADOR_TOKEN ?? 'troque-este-token';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  globalSetup: './e2e/preparar.ts',
  use: { baseURL: `http://localhost:${PORTA_WEB}`, channel: 'msedge', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @parkvision/api inicio',
      url: `http://localhost:${PORTA_API}/api/saude`,
      reuseExistingServer: false,
      env: { DATABASE_URL: envApi.DATABASE_URL_TESTE!, PORTA: String(PORTA_API), WEB_URL: `http://localhost:${PORTA_WEB}`, SIMULADOR_TOKEN: TOKEN_E2E, MODO_DEMONSTRACAO: 'false' },
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @parkvision/web dev',
      url: `http://localhost:${PORTA_WEB}/painel`,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${PORTA_API}`, WEB_PORT: String(PORTA_WEB) },
      cwd: '../..',
    },
  ],
});
