/**
 * Eventos em tempo real (Socket.IO).
 * Namespace /painel: servidor → painel web. Namespace /simulador: servidor → simulador.
 */
import type { Indicadores, Recomendacao, Regiao, Ticket } from './tipos.ts';

export const NAMESPACE_PAINEL = '/painel';
export const NAMESPACE_SIMULADOR = '/simulador';

export interface EventosPainel {
  'regiao:atualizada': (regiao: Regiao) => void;
  'ticket:criado': (dados: { ticket: Ticket; recomendacao: Recomendacao }) => void;
  'ticket:estacionado': (dados: { ticket: Ticket; regiao: Regiao }) => void;
  'ticket:saida': (dados: { ticket: Ticket; regiao: Regiao | null }) => void;
  'indicadores:atualizados': (indicadores: Indicadores) => void;
}
