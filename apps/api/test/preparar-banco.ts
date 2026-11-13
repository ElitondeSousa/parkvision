/** Garante o esquema no banco de testes (parkvision_teste), sem apagar nada; a limpeza entre testes é feita por semear({ limpar: true }). */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default function () {
  const env = Object.fromEntries(
    readFileSync(resolve(import.meta.dirname, '../.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
  );
  if (!env.DATABASE_URL_TESTE) throw new Error('Defina DATABASE_URL_TESTE em apps/api/.env');
  process.env.DATABASE_URL_TESTE = env.DATABASE_URL_TESTE;
  execSync('npx prisma db push --skip-generate', {
    cwd: resolve(import.meta.dirname, '..'), stdio: 'pipe', env: { ...process.env, DATABASE_URL: env.DATABASE_URL_TESTE, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}
