/**
 * @parkvision/core — algoritmo de distribuição e rotas (funções puras).
 * Contrato: docs/mvp/02-contratos.md §2. Implementação: agent algorithm-engineer.
 */
import type { AvaliacaoRegiao, Categoria, MapaDigital, Pesos, Regiao, Rota } from '@parkvision/shared';

export interface EntradaRecomendacao {
  categoria: Categoria;
  /** Nó do mapa onde fica o totem/acesso de entrada. */
  acessoNo: string;
  regioes: Regiao[];
  /** Recomendações + entradas para cada região nos últimos 5 minutos. */
  fluxoRecente: Record<string, number>;
  /** Vazão de referência de cada região (veículos por 5 minutos). */
  vazaoReferencia: Record<string, number>;
  mapa: MapaDigital;
  agora: Date;
  pesos?: Partial<Pesos>;
  /** Se definido, regiões com atualizadoEm mais antigo que isso (ms) ficam com DADOS_INVALIDOS. */
  validadeDadosMs?: number | null;
}

export type ResultadoRecomendacao =
  | { tipo: 'RECOMENDADA'; regiaoId: string; score: number; pesos: Pesos; avaliacoes: AvaliacaoRegiao[]; justificativa: string; rota: Rota }
  | { tipo: 'SEM_REGIAO'; pesos: Pesos; avaliacoes: AvaliacaoRegiao[]; justificativa: string };

export { recomendar } from './recomendar.ts';
export { menorCaminho } from './rotas.ts';
