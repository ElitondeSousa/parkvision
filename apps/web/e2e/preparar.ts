/** Antes dos testes ponta a ponta: limpa e recarrega o banco de TESTE (nunca o de desenvolvimento). */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export default function preparar() {
  const env = Object.fromEntries(
    readFileSync(new URL('../../api/.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
  );
  if (!env.DATABASE_URL_TESTE?.includes('parkvision_teste')) throw new Error('DATABASE_URL_TESTE precisa apontar para o banco parkvision_teste');
  execSync('pnpm --filter @parkvision/api exec tsx src/seed.ts --limpar', {
    cwd: new URL('../../..', import.meta.url),
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL_TESTE },
    stdio: 'inherit',
  });
}
