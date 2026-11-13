import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Lê apps/api/.env para os testes (DATABASE_URL_TESTE)
const env = Object.fromEntries(
  readFileSync(new URL('./.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);

export default defineConfig({
  test: {
    env,
    globalSetup: ['./test/preparar-banco.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
