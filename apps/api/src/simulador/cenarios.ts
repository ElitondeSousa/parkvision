/**
 * Cenários reproduzíveis do simulador (A–E). Mesma semente + mesmos passos = mesmo resultado.
 * Os números são de DEMONSTRAÇÃO (não são dados oficiais do Capim Dourado).
 *
 * Preenchimento inicial: a ocupação alvo considera o que já está ocupado (inclusive dados reais);
 * o simulador só cria veículos simulados para completar a diferença e nunca remove ocupação real.
 */
import type { CenarioId, ConfigSimulacao, TipoVaga } from '@parkvision/shared';

/** Evento de sensor agendado (o motor gera eventoId e sensorId). */
export type EventoCenario =
  | { tipo: 'FLUXO'; regiaoId: string; veiculosEmCirculacao: number; duracaoMin: number }
  | { tipo: 'DISPONIBILIDADE'; regiaoId: string; disponivel: boolean }
  | { tipo: 'SEM_COMUNICACAO' | 'LEITURA_INCONSISTENTE' | 'SENSOR_NORMALIZADO'; regiaoId: string };

export interface DefinicaoCenario {
  id: CenarioId;
  nome: string;
  descricao: string;
  config: ConfigSimulacao;
  /** Fração da capacidade ocupada no início (todas as regiões). */
  ocupacaoInicial: number;
  /** Ajustes por região: fração ocupada ou número de vagas livres (livres = vagas comuns). */
  ocupacaoPorRegiao?: Record<string, { fracao?: number; livres?: number }>;
  /** Fração ocupada por tipo de vaga em todas as regiões (sobrepõe a ocupação inicial daquele tipo). */
  ocupacaoPorTipo?: Partial<Record<TipoVaga, number>>;
  /** Eventos de sensor no tempo simulado (minutos após o início). */
  eventos: { aposMin: number; evento: EventoCenario }[];
}

export const CENARIOS_DEF: Record<CenarioId, DefinicaoCenario> = {
  A: {
    id: 'A',
    nome: 'Movimento tranquilo',
    descricao: 'Baixa ocupação (30%), poucas chegadas (2/min) e permanência longa. O algoritmo distribui com folga.',
    config: { entradasPorMinuto: 2, permanenciaMediaMin: 120, chanceIgnorarRecomendacao: 0.05, semente: 101 },
    ocupacaoInicial: 0.3,
    eventos: [],
  },
  B: {
    id: 'B',
    nome: 'Horário de pico',
    descricao: 'Ocupação inicial de 55% e 30 chegadas/min (fim de semana / feriado). O fluxo das regiões preferidas sobe e a distribuição espalha os veículos.',
    config: { entradasPorMinuto: 30, permanenciaMediaMin: 240, chanceIgnorarRecomendacao: 0.1, semente: 202 },
    ocupacaoInicial: 0.55,
    eventos: [],
  },
  C: {
    id: 'C',
    nome: 'Região lotada',
    descricao: 'N3 e N2 começam 100% ocupadas. O algoritmo não as recomenda; motoristas que ignoram a recomendação e tentam confirmar nelas são rejeitados e recebem nova recomendação.',
    config: { entradasPorMinuto: 8, permanenciaMediaMin: 180, chanceIgnorarRecomendacao: 0.25, semente: 303 },
    ocupacaoInicial: 0.45,
    ocupacaoPorRegiao: { N3: { fracao: 1 }, N2: { fracao: 1 } },
    eventos: [],
  },
  D: {
    id: 'D',
    nome: 'Congestionamento',
    descricao: 'Sensores de fluxo medem 40 veículos circulando no SS1 por 60 minutos. O critério de fluxo (peso de 20%, sem alteração) tira o SS1 do topo para quem entra pelo acesso nordeste.',
    config: { entradasPorMinuto: 8, permanenciaMediaMin: 180, chanceIgnorarRecomendacao: 0.1, semente: 404 },
    ocupacaoInicial: 0.45,
    eventos: [{ aposMin: 0, evento: { tipo: 'FLUXO', regiaoId: 'SS1', veiculosEmCirculacao: 40, duracaoMin: 60 } }],
  },
  E: {
    id: 'E',
    nome: 'Indisponibilidade',
    descricao: 'N3 fica indisponível no início e volta aos 15 minutos simulados; os sensores do S1 perdem comunicação entre 5 e 20 minutos. As regiões afetadas saem da recomendação enquanto durar o problema.',
    config: { entradasPorMinuto: 8, permanenciaMediaMin: 180, chanceIgnorarRecomendacao: 0.1, semente: 505 },
    ocupacaoInicial: 0.45,
    eventos: [
      { aposMin: 0, evento: { tipo: 'DISPONIBILIDADE', regiaoId: 'N3', disponivel: false } },
      { aposMin: 5, evento: { tipo: 'SEM_COMUNICACAO', regiaoId: 'S1' } },
      { aposMin: 15, evento: { tipo: 'DISPONIBILIDADE', regiaoId: 'N3', disponivel: true } },
      { aposMin: 20, evento: { tipo: 'SENSOR_NORMALIZADO', regiaoId: 'S1' } },
    ],
  },
  F: {
    id: 'F',
    nome: 'Vagas reservadas',
    descricao: 'Todas as vagas PcD começam ocupadas e as de pessoa idosa pela metade; parte dos veículos pede vaga reservada. Quem pede PcD recebe a indisponibilidade (sem ser mandado para outro tipo) até alguém sair; quem pede vaga de idoso recebe vaga de idoso.',
    config: { entradasPorMinuto: 6, permanenciaMediaMin: 60, chanceIgnorarRecomendacao: 0, semente: 606, proporcaoTipoVaga: { COMUM: 0.6, PCD: 0.2, IDOSO: 0.2 } },
    ocupacaoInicial: 0.4,
    ocupacaoPorTipo: { PCD: 1, IDOSO: 0.5 },
    eventos: [],
  },
};
