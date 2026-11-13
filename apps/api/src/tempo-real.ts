/**
 * Tempo real: os serviços publicam eventos num Emissor; o Socket.IO (ou um coletor nos testes) recebe.
 * Todo evento sai no envelope padronizado EventoTempoReal (id único, tipo, horário, entidade, simulado).
 */
import { NAMESPACE_PAINEL, NAMESPACE_SIMULADOR, type DadosEventos, type EventoTempoReal, type TipoEvento } from '@parkvision/shared';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';

export interface Emissor {
  emitir<T extends TipoEvento>(tipo: T, entidadeId: string, dados: DadosEventos[T], simulado?: boolean): void;
}

export function envelope<T extends TipoEvento>(tipo: T, entidadeId: string, dados: DadosEventos[T], simulado = false): EventoTempoReal<DadosEventos[T]> {
  return { id: randomUUID(), tipo, ocorridoEm: new Date().toISOString(), entidadeId, simulado, dados };
}

export const emissorSilencioso: Emissor = { emitir() {} };

/** Emissor que guarda os eventos em memória (usado nos testes). */
export function emissorColetor() {
  const eventos: EventoTempoReal[] = [];
  const emissor: Emissor = { emitir: (tipo, entidadeId, dados, simulado) => { eventos.push(envelope(tipo, entidadeId, dados, simulado)); } };
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
  const emissor: Emissor = {
    emitir: (tipo, entidadeId, dados, simulado) => {
      const ev = envelope(tipo, entidadeId, dados, simulado);
      painel.emit(tipo, ev);       // canal específico (ex.: 'veiculo:entrou')
      painel.emit('evento', ev);   // canal agregado, para quem quer ouvir tudo
      if (tipo.startsWith('simulador:')) simulador.emit(tipo, ev);
    },
  };
  return { io, emissor, simulador };
}
