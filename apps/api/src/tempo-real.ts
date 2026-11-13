/**
 * Tempo real: os serviços publicam eventos num Emissor; o Socket.IO (ou um coletor nos testes) recebe.
 */
import { NAMESPACE_PAINEL, NAMESPACE_SIMULADOR, type EventosPainel } from '@parkvision/shared';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';

export type NomeEvento = keyof EventosPainel;
export interface Emissor {
  emitir<E extends NomeEvento>(evento: E, ...dados: Parameters<EventosPainel[E]>): void;
}

export const emissorSilencioso: Emissor = { emitir() {} };

/** Emissor que guarda os eventos em memória (usado nos testes). */
export function emissorColetor() {
  const eventos: { evento: NomeEvento; dados: unknown }[] = [];
  const emissor: Emissor = { emitir: (evento, ...dados) => { eventos.push({ evento, dados: dados[0] }); } };
  return { emissor, eventos };
}

/** Liga o Socket.IO ao servidor HTTP do Fastify. */
export function iniciarSocket(http: HttpServer, opcoes: { simuladorToken: string; origemWeb: string }) {
  const io = new Server(http, { cors: { origin: opcoes.origemWeb } });
  const painel = io.of(NAMESPACE_PAINEL);
  const simulador = io.of(NAMESPACE_SIMULADOR);
  simulador.use((socket, next) => {
    if (socket.handshake.auth?.token === opcoes.simuladorToken) return next();
    next(new Error('token do simulador inválido'));
  });
  const emissor: Emissor = { emitir: (evento, ...dados) => { painel.emit(evento, ...dados); } };
  return { io, emissor, simulador };
}
