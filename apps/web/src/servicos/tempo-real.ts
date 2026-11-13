/**
 * Tempo real: conexão com o namespace /painel do Socket.IO (envelope EventoTempoReal).
 * Ouve só o canal agregado 'evento' — cada evento chega uma vez, já com tipo, horário e a marca `simulado`.
 */
import { NAMESPACE_PAINEL, type EventoTempoReal } from '@parkvision/shared';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export type EstadoConexao = 'conectando' | 'conectado' | 'desconectado';

export interface ConexaoPainel { fechar(): void }

/** Abre a conexão (separado do hook para os testes poderem substituir). */
export function conectarPainel(aoEvento: (ev: EventoTempoReal) => void, aoMudarEstado: (e: EstadoConexao) => void): ConexaoPainel {
  const socket = io(NAMESPACE_PAINEL, { transports: ['websocket', 'polling'] });
  socket.on('connect', () => aoMudarEstado('conectado'));
  socket.on('disconnect', () => aoMudarEstado('desconectado'));
  socket.on('connect_error', () => aoMudarEstado('desconectado'));
  socket.on('evento', aoEvento);
  return { fechar: () => socket.close() };
}

/** Hook: assina os eventos em tempo real enquanto o componente está montado. */
export function useTempoReal(aoEvento: (ev: EventoTempoReal) => void): EstadoConexao {
  const [estado, setEstado] = useState<EstadoConexao>('conectando');
  const ref = useRef(aoEvento);
  ref.current = aoEvento;
  useEffect(() => {
    const conexao = conectarPainel((ev) => ref.current(ev), setEstado);
    return () => conexao.fechar();
  }, []);
  return estado;
}
