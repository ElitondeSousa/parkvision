/**
 * Tipos de domínio do ParkVision (contratos entre api, web, core e simulador).
 * Fonte: docs/mvp/02-contratos.md
 */

export const CATEGORIAS = ['CARRO_PEQUENO', 'CARRO_GRANDE', 'MOTO'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export type Nivel = 'terreo' | 'ss1' | 'ss2';

/** De onde vem a capacidade da região: escrita na planta, contada no desenho ou simulada. */
export type FonteCapacidade = 'planta' | 'desenho' | 'simulada';

/** Estado dos sensores de uma região. Diferente de 'ok' => dados inválidos para o algoritmo. */
export type StatusSensores = 'ok' | 'sem-comunicacao' | 'inconsistente';

/** Nível de fluxo de uma região: fluxo recente ÷ vazão de referência (<0,4 baixo; <0,8 moderado; ≥0,8 elevado). */
export type NivelFluxo = 'baixo' | 'moderado' | 'elevado';

export interface Regiao {
  id: string;
  nome: string;
  nivel: Nivel;
  categorias: Categoria[];
  capacidade: number;
  ocupadas: number;
  livres: number;
  /** Operacional efetivo (operador E simulação). */
  operacional: boolean;
  fonteCapacidade: FonteCapacidade;
  atualizadoEm: string;
  statusSensores?: StatusSensores;
  /** Fluxo recente (recomendações + leitura dos sensores de fluxo) e nível. */
  fluxo?: { recente: number; vazaoReferencia: number; nivel: NivelFluxo };
  /**
   * Versão do registro (Etapa 4): sobe a cada mudança gravada na região, sob a trava da linha no banco.
   * Clientes de tempo real ignoram eventos com versão menor que a já aplicada (eventos fora de ordem).
   */
  versao?: number;
}

export function nivelFluxo(recente: number, vazaoReferencia: number): NivelFluxo {
  const r = recente / Math.max(1, vazaoReferencia);
  return r >= 0.8 ? 'elevado' : r >= 0.4 ? 'moderado' : 'baixo';
}

export const STATUS_TICKET = ['AGUARDANDO', 'ESTACIONADO', 'SAIU', 'CANCELADO'] as const;
export type StatusTicket = (typeof STATUS_TICKET)[number];

export interface Ticket {
  codigo: string;
  categoria: Categoria;
  acessoId: string;
  placa: string | null;
  entradaEm: string;
  regiaoRecomendadaId: string;
  regiaoEstacionadaId: string | null;
  estacionadoEm: string | null;
  saidaEm: string | null;
  status: StatusTicket;
}

export interface Pesos {
  disponibilidade: number;
  distancia: number;
  fluxo: number;
}

export const PESOS_PADRAO: Pesos = { disponibilidade: 0.5, distancia: 0.3, fluxo: 0.2 };

export type MotivoInelegivel =
  | 'CATEGORIA_INCOMPATIVEL'
  | 'SEM_VAGAS'
  | 'FORA_DE_OPERACAO'
  | 'DADOS_INVALIDOS'
  | 'SEM_ROTA';

export interface AvaliacaoRegiao {
  regiaoId: string;
  elegivel: boolean;
  motivo?: MotivoInelegivel;
  /** Critérios normalizados de 0 a 1 (disponibilidade: maior é melhor; distância e fluxo: menor é melhor). */
  criterios?: { disponibilidade: number; distancia: number; fluxo: number };
  custoRota?: number;
  score?: number;
}

export interface Rota {
  nos: string[];
  custo: number;
}

export interface Recomendacao {
  id: string;
  ticketCodigo: string;
  regiaoId: string;
  score: number;
  pesos: Pesos;
  avaliacoes: AvaliacaoRegiao[];
  justificativa: string;
  rota: Rota;
  criadaEm: string;
}

export interface Indicadores {
  capacidadeTotal: number;
  ocupadas: number;
  livres: number;
  taxaOcupacao: number;
  veiculosAguardando: number;
  recomendacoesUltimaHora: number;
  regioesAltaOcupacao: string[];
}

/* ---------- Mapa digital ---------- */

export interface MapaNo {
  id: string;
  nivel: Nivel;
  xy: [number, number];
  rotulo?: string;
}

export interface MapaAresta {
  de: string;
  para: string;
  sentido: 'unico' | 'duplo' | 'a-confirmar';
  observacao?: string;
}

export interface MapaRegiao {
  id: string;
  nome: string;
  nivel: Nivel;
  coberta: boolean;
  referencia: string;
  categorias: Categoria[];
  capacidade: { valor: number | null; fonte: FonteCapacidade | 'a-contar'; observacao: string };
  poligono: [number, number][];
  noAcesso: string;
}

export interface MapaAcesso {
  id: string;
  nome: string;
  nivel: Nivel;
  no: string;
  tipo: 'entrada' | 'saida' | 'entrada-saida';
  confianca: 'alta' | 'media' | 'baixa';
  observacao: string;
}

export interface MapaLigacao {
  de: string;
  para: string;
  status: string;
  observacao: string;
  /** Custo usado enquanto a ligação real (rampas) não é confirmada. */
  custoEstimado?: number;
}

export interface MapaDigital {
  versao: string;
  status: string;
  niveis: { id: Nivel; nome: string; paginaPdf: number; viewBox: [number, number, number, number] }[];
  categorias: { id: Categoria; nome: string }[];
  regioes: MapaRegiao[];
  acessos: MapaAcesso[];
  nos: MapaNo[];
  arestas: MapaAresta[];
  ligacoesEntreNiveis: MapaLigacao[];
}
