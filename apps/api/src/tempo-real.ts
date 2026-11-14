/**
 * Tempo real: os serviços publicam eventos num Emissor; o Socket.IO (ou um coletor nos testes) recebe.
 * Todo evento sai no envelope padronizado EventoTempoReal (id único, sequência, tipo, horário, entidade, simulado).
 *
 * Namespaces:
 *  /painel      público: todos os eventos (sem placa nem token de ticket), no canal do tipo e no canal agregado 'evento'
 *  /simulador   exige o token do simulador: eventos 'simulador:*'
 *  /localizador exige o token do QR: o socket entra na sala do próprio ticket e recebe só 'ticket:atualizado' dele
 */
import { NAMESPACE_LOCALIZADOR, NAMESPACE_PAINEL, NAMESPACE_SIMULADOR, type DadosEventos, type EventoTempoReal, type TipoEvento } from '@parkvision/shared';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';

export interface Emissor {
  emitir<T extends TipoEvento>(tipo: T, entidadeId: string, dados: DadosEventos[T], simulado?: boolean): void;
}

let sequencia = 0;
export function envelope<T extends TipoEvento>(tipo: T, entidadeId: string, dados: DadosEventos[T], simulado = false): EventoTempoReal<DadosEventos[T]> {
  return { id: randomUUID(), sequencia: ++sequencia, tipo, ocorridoEm: new Date().toISOString(), entidadeId, simulado, dados };
}

export const emissorSilencioso: Emissor = { emitir() {} };

/** Emissor que guarda os eventos em memória (usado nos testes). */
export function emissorColetor() {
  const eventos: EventoTempoReal[] = [];
  const emissor: Emissor = { emitir: (tipo, entidadeId, dados, simulado) => { eventos.push(envelope(tipo, entidadeId, dados, simulado)); } };
  return { emissor, eventos };
}

const TOKEN_QR = /^[A-Za-z0-9_-]{16,64}$/;
export const salaDoTicket = (codigo: string) => `ticket:${codigo}`;

/** Liga o Socket.IO ao servidor HTTP do Fastify. */
export function iniciarSocket(http: HttpServer, opcoes: {
  simuladorToken: string;
  origemWeb: string;
  /** Resolve o token do QR para o código do ticket (null se não existir). */
  resolverTicket?: (token: string) => Promise<string | null>;
}) {
  const io = new Server(http, { cors: { origin: opcoes.origemWeb } });
  const painel = io.of(NAMESPACE_PAINEL);
  const simulador = io.of(NAMESPACE_SIMULADOR);
  const localizador = io.of(NAMESPACE_LOCALIZADOR);

  simulador.use((socket, next) => {
    if (socket.handshake.auth?.token === opcoes.simuladorToken) return next();
    next(new Error('token do simulador inválido'));
  });
  localizador.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !TOKEN_QR.test(token) || !opcoes.resolverTicket) return next(new Error('ticket inválido'));
    try {
      const codigo = await opcoes.resolverTicket(token);
      if (!codigo) return next(new Error('ticket não encontrado'));
      await socket.join(salaDoTicket(codigo));
      next();
    } catch {
      next(new Error('não foi possível validar o ticket agora'));
    }
  });

  const emissor: Emissor = {
    emitir: (tipo, entidadeId, dados, simulado) => {
      const ev = envelope(tipo, entidadeId, dados, simulado);
      painel.emit(tipo, ev);       // canal específico (ex.: 'veiculo:entrou')
      painel.emit('evento', ev);   // canal agregado, para quem quer ouvir tudo
      if (tipo.startsWith('simulador:')) simulador.emit(tipo, ev);
      if (tipo === 'ticket:atualizado') localizador.to(salaDoTicket(entidadeId)).emit(tipo, ev);
    },
  };
  return { io, emissor, simulador, localizador };
}
