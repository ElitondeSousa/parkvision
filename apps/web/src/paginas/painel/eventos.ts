/**
 * Transforma os eventos em tempo real (envelope EventoTempoReal) e o histórico do backend em itens da lista de movimentações.
 *
 * Entradas, estacionamentos e saídas usam um id estável por fato (`entrada-PV-0001`, `estacionou-PV-0001`, `saiu-PV-0001`),
 * igual ao do histórico (GET /api/historico): ao recarregar ou reconectar, o painel junta as duas fontes sem duplicar.
 * Eventos repetitivos (ocupação a cada carro) só viram item quando mudam algo relevante: região lotou ou voltou a ter vaga.
 */
import type { DadosEventos, EventoTempoReal, Regiao, TipoEvento } from '@parkvision/shared';
import { NOME_CATEGORIA } from '../../mapa/estado.ts';
import type { ItemHistorico } from '../../servicos/api.ts';

export type TipoItem = 'entrada' | 'recomendacao' | 'estacionou' | 'saida' | 'lotada' | 'disponibilidade' | 'congestionamento' | 'sensor' | 'simulador' | 'alerta';
export interface ItemMovimentacao {
  id: string;
  tipo: TipoItem;
  quando: string;
  texto: string;
  regiaoId?: string;
  simulado: boolean;
}
/** Tipos que o backend também guarda no histórico (os demais só existem em tempo real). */
export const TIPOS_DO_HISTORICO: TipoItem[] = ['entrada', 'estacionou', 'saida'];

const ev = <T extends TipoEvento>(e: EventoTempoReal, tipo: T) => (e.tipo === tipo ? (e.dados as DadosEventos[T]) : null);

/** `anterior` = estado da região antes deste evento (para detectar transições). */
export function itemDoEvento(e: EventoTempoReal, anterior?: Regiao): ItemMovimentacao | null {
  const base = { id: e.id, quando: e.ocorridoEm, simulado: e.simulado };
  let d;
  if ((d = ev(e, 'veiculo:entrou'))) {
    return { ...base, id: `entrada-${d.ticket.codigo}`, quando: d.ticket.entradaEm ?? e.ocorridoEm, tipo: 'entrada', regiaoId: d.recomendacao.regiaoId, texto: `${d.ticket.codigo} entrou (${NOME_CATEGORIA[d.ticket.categoria].toLowerCase()}) e foi orientado para ${d.recomendacao.regiaoId}` };
  }
  if ((d = ev(e, 'veiculo:recomendado'))) {
    return { ...base, tipo: 'recomendacao', regiaoId: d.recomendacao.regiaoId, texto: `Nova recomendação para ${d.ticket.codigo}: ${d.recomendacao.regiaoId}. ${d.motivo}.` };
  }
  if ((d = ev(e, 'veiculo:estacionou'))) {
    return { ...base, id: `estacionou-${d.ticket.codigo}`, quando: d.ticket.estacionadoEm ?? e.ocorridoEm, tipo: 'estacionou', regiaoId: d.regiao.id, texto: `${d.ticket.codigo} estacionou em ${d.regiao.id}` };
  }
  if ((d = ev(e, 'veiculo:saiu'))) {
    return d.regiao
      ? { ...base, id: `saiu-${d.ticket.codigo}`, quando: d.ticket.saidaEm ?? e.ocorridoEm, tipo: 'saida', regiaoId: d.regiao.id, texto: `${d.ticket.codigo} saiu de ${d.regiao.id}` }
      : { ...base, id: `cancelado-${d.ticket.codigo}`, tipo: 'saida', texto: `${d.ticket.codigo} desistiu antes de estacionar (ticket cancelado)` };
  }
  if ((d = ev(e, 'regiao:ocupacao'))) {
    if (d.livres === 0 && (anterior?.livres ?? 1) > 0) return { ...base, tipo: 'lotada', regiaoId: d.id, texto: `Região ${d.id} lotou` };
    if (d.livres > 0 && anterior?.livres === 0) return { ...base, tipo: 'disponibilidade', regiaoId: d.id, texto: `Região ${d.id} voltou a ter vagas` };
    return null;
  }
  if ((d = ev(e, 'regiao:status'))) {
    if (anterior && anterior.operacional !== d.operacional) {
      return { ...base, tipo: 'disponibilidade', regiaoId: d.id, texto: d.operacional ? `Região ${d.id} voltou a operar` : `Região ${d.id} ficou indisponível` };
    }
    if (anterior && anterior.statusSensores !== d.statusSensores) {
      return { ...base, tipo: 'sensor', regiaoId: d.id, texto: d.statusSensores === 'ok' ? `Sensores da região ${d.id} normalizados` : `Falha de sensor na região ${d.id} (${d.statusSensores === 'sem-comunicacao' ? 'sem comunicação' : 'leitura inconsistente'}) — fora da recomendação` };
    }
    return null;
  }
  if ((d = ev(e, 'regiao:fluxo'))) {
    if (d.fluxo?.nivel === 'elevado' && anterior?.fluxo?.nivel !== 'elevado') return { ...base, tipo: 'congestionamento', regiaoId: d.id, texto: `Congestionamento detectado em ${d.id} (${d.fluxo.recente} veículos circulando)` };
    return null;
  }
  if ((d = ev(e, 'simulador:alerta'))) {
    if (d.codigo === 'REGIAO_LOTADA' || d.codigo === 'REGIAO_INDISPONIVEL' || d.codigo === 'SEM_REGIAO_ELEGIVEL' || d.codigo === 'DESISTENCIA') {
      return { ...base, tipo: 'alerta', regiaoId: d.regiaoId, texto: d.mensagem };
    }
    return null;
  }
  if ((d = ev(e, 'simulador:estado'))) {
    const acoes = { iniciado: 'Simulação iniciada', pausado: 'Simulação pausada', retomado: 'Simulação retomada', encerrado: 'Simulação encerrada', reiniciado: 'Dados simulados reiniciados', configurado: 'Simulação reconfigurada' };
    return { ...base, tipo: 'simulador', texto: `${acoes[d.acao]}${d.cenario ? ` (cenário ${d.cenario})` : ''}` };
  }
  return null;
}

export function itemDoHistorico(h: ItemHistorico): ItemMovimentacao {
  const categoria = h.categoria ? ` (${NOME_CATEGORIA[h.categoria].toLowerCase()})` : '';
  const base = { id: h.id, quando: h.quando, regiaoId: h.regiaoId, simulado: h.simulado };
  switch (h.tipo) {
    case 'ENTRADA': return { ...base, tipo: 'entrada', texto: `${h.ticketCodigo} entrou${categoria} e foi orientado para ${h.regiaoId}` };
    case 'ESTACIONOU': return { ...base, tipo: 'estacionou', texto: `${h.ticketCodigo} estacionou em ${h.regiaoId}` };
    case 'SAIU': return { ...base, tipo: 'saida', texto: `${h.ticketCodigo} saiu de ${h.regiaoId}` };
    default: return { ...base, tipo: 'disponibilidade', texto: `Ajuste de ocupação em ${h.regiaoId}` };
  }
}

/** Junta o histórico (fonte da verdade para entradas, estacionamentos e saídas) com os itens só de tempo real. */
export function juntarMovimentacoes(historico: ItemMovimentacao[], atuais: ItemMovimentacao[], max: number): ItemMovimentacao[] {
  const porId = new Map<string, ItemMovimentacao>();
  for (const i of historico) porId.set(i.id, i);
  for (const i of atuais) if (!porId.has(i.id)) porId.set(i.id, i);
  return [...porId.values()].sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, max);
}
