/** Sobe a API (Fastify) com o Socket.IO no mesmo servidor HTTP. */
import { PrismaClient } from '@prisma/client';
import { criarApp } from './app.ts';
import { lerConfig } from './config.ts';
import { iniciarSocket, type Emissor } from './tempo-real.ts';

const config = lerConfig();
const db = new PrismaClient();
// O emissor real só existe depois que o servidor HTTP é criado; até lá, um repasse.
let destino: Emissor = { emitir() {} };
const app = criarApp({ db, config, log: true, emissor: { emitir: (e, ...d) => destino.emitir(e, ...d) } });

await app.ready();
destino = iniciarSocket(app.server, { simuladorToken: config.simuladorToken, origemWeb: config.webUrl }).emissor;
await app.listen({ port: config.porta, host: '0.0.0.0' });

const encerrar = async () => { await app.close(); await db.$disconnect(); process.exit(0); };
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
