/**
 * Tempo real (Socket.IO, envelope EventoTempoReal).
 *
 *  - /painel: ouve o canal agregado 'evento' (cada evento chega uma vez, com tipo, sequência e a marca `simulado`).
 *  - /localizador: entra com o token do QR e recebe só 'ticket:atualizado' do próprio ticket.
 *
 * Robustez (Etapa 4): o Socket.IO reconecta sozinho; a cada reconexão o componente recebe `aoReconectar`
 * para buscar o estado atual no backend (eventos perdidos durante a queda não são necessários).
 * Eventos repetidos (mesmo `id`) são descartados aqui.
 */
import { NAMESPACE_LOCALIZADOR, NAMESPACE_PAINEL, type EventoTempoReal } from '@parkvision/shared';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export type EstadoConexao = 'conectando' | 'conectado' | 'desconectado';

export interface ConexaoTempoReal { fechar(): void }

interface Ouvintes {
  aoEvento: (ev: EventoTempoReal) => void;
  aoMudarEstado: (e: EstadoConexao) => void;
  /** Chamado em toda conexão depois da primeira (reconexão). */
  aoReconectar: () => void;
}

/** Descarta eventos com id já visto (mantém os últimos 500). */
export function filtroDeRepetidos() {
  const vistos = new Set<string>();
  return (id: string) => {
    if (vistos.has(id)) return false;
    vistos.add(id);
    if (vistos.size > 500) vistos.delete(vistos.values().next().value!);
    return true;
  };
}

function conectar(namespace: string, canais: string[], ouvintes: Ouvintes, auth?: Record<string, string>): ConexaoTempoReal {
  const socket = io(namespace, { transports: ['websocket', 'polling'], ...(auth ? { auth } : {}) });
  const novo = filtroDeRepetidos();
  let jaConectou = false;
  socket.on('connect', () => {
    ouvintes.aoMudarEstado('conectado');
    if (jaConectou) ouvintes.aoReconectar();
    jaConectou = true;
  });
  socket.on('disconnect', () => ouvintes.aoMudarEstado('desconectado'));
  socket.on('connect_error', () => ouvintes.aoMudarEstado('desconectado'));
  for (const canal of canais) socket.on(canal, (ev: EventoTempoReal) => { if (novo(ev.id)) ouvintes.aoEvento(ev); });
  return { fechar: () => socket.close() };
}

/** Abre a conexão do painel (separado do hook para os testes poderem substituir o socket). */
export const conectarPainel = (o: Ouvintes) => conectar(NAMESPACE_PAINEL, ['evento'], o);
export const conectarLocalizador = (token: string, o: Ouvintes) => conectar(NAMESPACE_LOCALIZADOR, ['ticket:atualizado'], o, { token });

function useConexao(abrir: ((o: Ouvintes) => ConexaoTempoReal) | null, aoEvento: (ev: EventoTempoReal) => void, aoReconectar?: () => void): EstadoConexao {
  const [estado, setEstado] = useState<EstadoConexao>('conectando');
  const refs = useRef({ aoEvento, aoReconectar });
  refs.current = { aoEvento, aoReconectar };
  useEffect(() => {
    if (!abrir) return;
    const conexao = abrir({ aoEvento: (ev) => refs.current.aoEvento(ev), aoMudarEstado: setEstado, aoReconectar: () => refs.current.aoReconectar?.() });
    return () => conexao.fechar();
  }, [abrir]);
  return estado;
}

/** Hook do painel: assina todos os eventos; `aoReconectar` deve recarregar o estado do backend. */
export function useTempoReal(aoEvento: (ev: EventoTempoReal) => void, aoReconectar?: () => void): EstadoConexao {
  return useConexao(conectarPainel, aoEvento, aoReconectar);
}

/** Hook do localizador: avisa quando o próprio ticket muda (ou quando a conexão volta). `token` null = não conecta. */
export function useTicketAoVivo(token: string | null, aoMudar: () => void): EstadoConexao {
  const [abrir, setAbrir] = useState<((o: Ouvintes) => ConexaoTempoReal) | null>(null);
  useEffect(() => { setAbrir(() => (token ? (o: Ouvintes) => conectarLocalizador(token, o) : null)); }, [token]);
  return useConexao(abrir, () => aoMudar(), aoMudar);
}
