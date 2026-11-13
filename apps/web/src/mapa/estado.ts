/**
 * Estado visual de uma região a partir dos dados da API.
 * Regra do Design System: cor nunca é o único sinal — cada estado tem rótulo, ícone e padrão no mapa.
 */
import type { Categoria, Regiao } from '@parkvision/shared';

export type FaixaRegiao = 'livre' | 'alta' | 'critica' | 'lotada' | 'indisponivel' | 'sem-dados';

export const ROTULO_FAIXA: Record<FaixaRegiao, string> = {
  livre: 'Com vagas',
  alta: 'Ocupação alta',
  critica: 'Quase lotada',
  lotada: 'Lotada',
  indisponivel: 'Indisponível',
  'sem-dados': 'Falha de sensor',
};

/** Indisponível e falha de sensor vêm antes da ocupação (a região sai da recomendação nesses casos). */
export function faixaDaRegiao(r: Pick<Regiao, 'capacidade' | 'ocupadas' | 'livres' | 'operacional' | 'statusSensores'>): FaixaRegiao {
  if (!r.operacional) return 'indisponivel';
  if (r.statusSensores && r.statusSensores !== 'ok') return 'sem-dados';
  if (r.livres <= 0) return 'lotada';
  const taxa = r.capacidade ? r.ocupadas / r.capacidade : 0;
  return taxa >= 0.9 ? 'critica' : taxa >= 0.7 ? 'alta' : 'livre';
}

export const congestionada = (r: Pick<Regiao, 'fluxo'>) => r.fluxo?.nivel === 'elevado';
export const percentual = (r: Pick<Regiao, 'capacidade' | 'ocupadas'>) => (r.capacidade ? Math.round((r.ocupadas / r.capacidade) * 100) : 0);

export const NOME_CATEGORIA: Record<Categoria, string> = {
  CARRO_PEQUENO: 'Carro pequeno',
  CARRO_GRANDE: 'Carro grande, SUV ou picape',
  MOTO: 'Motocicleta',
};

export const ROTULO_FLUXO = { baixo: 'Fluxo baixo', moderado: 'Fluxo moderado', elevado: 'Fluxo elevado' } as const;

export const ROTULO_FONTE: Record<string, string> = {
  planta: 'Capacidade escrita na planta',
  desenho: 'Capacidade contada no desenho da planta',
  simulada: 'Capacidade simulada',
};

const fmtHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDataHora = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const hora = (iso: string) => fmtHora.format(new Date(iso));
export const dataHora = (iso: string) => fmtDataHora.format(new Date(iso));
