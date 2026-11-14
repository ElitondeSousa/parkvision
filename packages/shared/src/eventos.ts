/**
 * Eventos em tempo real (Socket.IO).
 * Namespace /painel: servidor → painel web. Namespace /simulador: servidor → simulador.
 *
 * Todo evento usa o mesmo envelope (EventoTempoReal): id único, tipo, horário, entidade e a marca `simulado`.
 * O Socket.IO emite no canal com o mesmo nome do `tipo` e também no canal agregado 'evento'.
 */
import type { Indicadores, Recomendacao, Regiao, Ticket } from './tipos.ts';

export const NAMESPACE_PAINEL = '/painel';
export const NAMESPACE_SIMULADOR = '/simulador';
/** Etapa 4: o localizador entra com o token do QR e recebe só os eventos do próprio ticket. */
export const NAMESPACE_LOCALIZADOR = '/localizador';

export interface EventoTempoReal<T = unknown> {
  /** UUID único do evento (clientes podem descartar repetidos). */
  id: string;
  tipo: TipoEvento;
  /** ISO 8601. */
  ocorridoEm: string;
  /** Id da entidade relacionada (código do ticket, id da região, 'simulador' ou 'indicadores'). */
  entidadeId: string;
  /** true quando o evento foi gerado pelo simulador (dados de demonstração). */
  simulado: boolean;
  /** Sequência crescente por processo da API (Etapa 4): permite descartar eventos atrasados do mesmo tipo/entidade. */
  sequencia: number;
  dados: T;
}

/** Resumo público de um ticket para eventos (sem placa nem token). */
export interface TicketAtualizado {
  codigo: string;
  status: Ticket['status'];
  regiaoRecomendadaId: string;
  regiaoEstacionadaId: string | null;
}

export interface EstadoSimulacaoResumo {
  status: 'parado' | 'rodando' | 'pausado';
  cenario: string | null;
  relogioSimulado: number;
  velocidade: number;
}

export interface DadosEventos {
  // veículos
  'veiculo:entrou': { ticket: Ticket; recomendacao: Recomendacao };
  'veiculo:recomendado': { ticket: Ticket; recomendacao: Recomendacao; motivo: string };
  'veiculo:estacionou': { ticket: Ticket; regiao: Regiao };
  'veiculo:saiu': { ticket: Ticket; regiao: Regiao | null };
  // regiões
  'regiao:ocupacao': Regiao;
  'regiao:fluxo': Regiao;
  'regiao:status': Regiao;
  // simulador
  'simulador:estado': EstadoSimulacaoResumo & { acao: 'iniciado' | 'pausado' | 'retomado' | 'encerrado' | 'reiniciado' | 'configurado' };
  'simulador:cenario': { cenario: string; descricao: string };
  'simulador:sensor': { eventoId: string; tipo: string; regiaoId: string; resultado: string };
  'simulador:alerta': { codigo: string; mensagem: string; ticketCodigo?: string; regiaoId?: string };
  // tickets (Etapa 4): qualquer mudança de status ou de recomendação
  'ticket:atualizado': TicketAtualizado;
  // agregados
  'indicadores:atualizados': Indicadores;
}

export type TipoEvento = keyof DadosEventos;
export const TIPOS_EVENTO = [
  'veiculo:entrou', 'veiculo:recomendado', 'veiculo:estacionou', 'veiculo:saiu',
  'regiao:ocupacao', 'regiao:fluxo', 'regiao:status',
  'simulador:estado', 'simulador:cenario', 'simulador:sensor', 'simulador:alerta',
  'ticket:atualizado', 'indicadores:atualizados',
] as const satisfies readonly TipoEvento[];
