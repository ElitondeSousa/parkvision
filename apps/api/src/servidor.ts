/** Sobe a API (Fastify) com o Socket.IO no mesmo servidor HTTP e o motor do simulador em modo automático. */
import { PrismaClient } from '@prisma/client';
import { criarApp } from './app.ts';
import { lerConfig } from './config.ts';
import { hashToken } from './servicos/tickets.ts';
import { MotorSimulacao } from './simulador/motor.ts';
import { iniciarSocket, type Emissor } from './tempo-real.ts';

const config = lerConfig();
const db = new PrismaClient();
// O emissor real só existe depois que o servidor HTTP é criado; até lá, um repasse.
let destino: Emissor = { emitir() {} };
const emissor: Emissor = { emitir: (...args) => destino.emitir(...args) };
const motor = new MotorSimulacao({ db, emissor, config }, { automatico: true });
const app = criarApp({ db, config, log: true, emissor, motor });

await app.ready();
destino = iniciarSocket(app.server, {
  simuladorToken: config.simuladorToken,
  origemWeb: config.webUrl,
  // localizador: o token do QR vira a sala do próprio ticket (nunca recebe eventos de outros veículos)
  resolverTicket: async (token) => (await db.ticket.findUnique({ where: { tokenHash: hashToken(token) }, select: { codigo: true } }))?.codigo ?? null,
}).emissor;
await app.listen({ port: config.porta, host: '0.0.0.0' });

const encerrar = async () => { await app.close(); await db.$disconnect(); process.exit(0); };
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
