/**
 * Esquemas de validação (Zod) das entradas da API e dos comandos do simulador.
 */
import { z } from 'zod';
import { CATEGORIAS, STATUS_TICKET } from './tipos.ts';

export const esquemaCategoria = z.enum(CATEGORIAS);

export const esquemaNovaEntrada = z.object({
  acessoId: z.string().min(1),
  categoria: esquemaCategoria,
  placa: z.string().trim().min(3).max(10).optional(),
});
export type NovaEntrada = z.infer<typeof esquemaNovaEntrada>;

export const esquemaEstacionar = z.object({
  regiaoId: z.string().min(1).optional(),
});

export const esquemaAtualizarRegiao = z
  .object({
    operacional: z.boolean().optional(),
    capacidade: z.number().int().positive().optional(),
    ocupadas: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Informe ao menos um campo' });

export const esquemaListarTickets = z.object({
  status: z.enum(STATUS_TICKET).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(50),
});

export const esquemaListarRecomendacoes = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(20),
});

/* ---------- Simulador (Etapa 2) ---------- */

export const CENARIOS = ["A", "B", "C", "D", "E"] as const;
export type CenarioId = (typeof CENARIOS)[number];

const proporcao = z.number().min(0).max(1);
export const esquemaConfigSimulacao = z.object({
  /** automatico: o motor gera chegadas, confirmações e saídas; manual: só eventos disparados pela API (o relógio ainda avança). */
  modo: z.enum(["automatico", "manual"]).optional(),
  /** Multiplicador do relógio: 1 = tempo real; 60 = 1 minuto simulado por segundo. */
  velocidade: z.number().min(0.1).max(600).optional(),
  /** Chegadas por minuto simulado. */
  entradasPorMinuto: z.number().min(0).max(120).optional(),
  /** Permanência média em minutos simulados (define a frequência das saídas). */
  permanenciaMediaMin: z.number().min(1).max(600).optional(),
  /** Quantidade máxima de veículos gerados automaticamente (0 = sem limite). */
  maxVeiculos: z.number().int().min(0).max(100000).optional(),
  /** Proporção de categorias (normalizada para somar 1). */
  proporcaoCategorias: z.object({ CARRO_PEQUENO: proporcao, CARRO_GRANDE: proporcao, MOTO: proporcao }).optional(),
  /** Chance de o motorista estacionar em outra região compatível em vez da recomendada. */
  chanceIgnorarRecomendacao: proporcao.optional(),
  /** Tempo entre a recomendação e a confirmação (segundos simulados). */
  tempoManobraSeg: z.number().min(0).max(1800).optional(),
  /** Chance por minuto simulado de falha de sensor numa região (sem comunicação / leitura inconsistente). */
  chanceFalhaSensorPorMin: proporcao.optional(),
  /** Chance de um evento de sensor ser reenviado em duplicidade (testa a idempotência). */
  chanceEventoDuplicado: proporcao.optional(),
  /** Semente do gerador pseudoaleatório (mesma semente + mesmos passos = mesmo resultado). */
  semente: z.number().int().optional(),
});
export type ConfigSimulacao = z.infer<typeof esquemaConfigSimulacao>;

export const esquemaIniciarSimulacao = z.object({
  cenario: z.enum(CENARIOS).optional(),
  config: esquemaConfigSimulacao.optional(),
});

export const esquemaAtivarCenario = z.object({ cenario: z.enum(CENARIOS) });

/** Eventos manuais (testes e apresentações). */
export const esquemaEventoManual = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("entrada"), categoria: z.enum(CATEGORIAS).optional(), acessoId: z.string().optional() }),
  z.object({ acao: z.literal("confirmar"), codigo: z.string(), regiaoId: z.string().optional() }),
  z.object({ acao: z.literal("saida"), codigo: z.string().optional() }),
  z.object({ acao: z.literal("fluxo"), regiaoId: z.string(), veiculosEmCirculacao: z.number().int().min(0).max(1000), duracaoMin: z.number().min(1).max(240).default(10) }),
  z.object({ acao: z.literal("disponibilidade"), regiaoId: z.string(), disponivel: z.boolean() }),
  z.object({ acao: z.literal("sensor"), regiaoId: z.string(), status: z.enum(["ok", "sem-comunicacao", "inconsistente"]) }),
  z.object({ acao: z.literal("avancar"), segundos: z.number().min(1).max(86400) }),
]);
export type EventoManual = z.infer<typeof esquemaEventoManual>;

/**
 * Evento de sensor (simulado hoje; o mesmo formato serve para sensores reais).
 * `eventoId` é a chave de idempotência: o mesmo id processado duas vezes não muda nada.
 */
export const esquemaEventoSensor = z.discriminatedUnion("tipo", [
  z.object({ eventoId: z.string().min(8), sensorId: z.string(), tipo: z.literal("VAGA_OCUPADA"), regiaoId: z.string(), ticketCodigo: z.string().optional(), ocorridoEm: z.string().datetime().optional() }),
  z.object({ eventoId: z.string().min(8), sensorId: z.string(), tipo: z.literal("VAGA_LIBERADA"), regiaoId: z.string(), ticketCodigo: z.string().optional(), ocorridoEm: z.string().datetime().optional() }),
  z.object({ eventoId: z.string().min(8), sensorId: z.string(), tipo: z.literal("SEM_COMUNICACAO"), regiaoId: z.string(), ocorridoEm: z.string().datetime().optional() }),
  z.object({ eventoId: z.string().min(8), sensorId: z.string(), tipo: z.literal("LEITURA_INCONSISTENTE"), regiaoId: z.string(), ocorridoEm: z.string().datetime().optional() }),
  z.object({ eventoId: z.string().min(8), sensorId: z.string(), tipo: z.literal("SENSOR_NORMALIZADO"), regiaoId: z.string(), ocorridoEm: z.string().datetime().optional() }),
  z.object({ eventoId: z.string().min(8), sensorId: z.string(), tipo: z.literal("FLUXO"), regiaoId: z.string(), veiculosEmCirculacao: z.number().int().min(0).max(1000), duracaoMin: z.number().min(1).max(240).default(10), ocorridoEm: z.string().datetime().optional() }),
  z.object({ eventoId: z.string().min(8), sensorId: z.string(), tipo: z.literal("DISPONIBILIDADE"), regiaoId: z.string(), disponivel: z.boolean(), ocorridoEm: z.string().datetime().optional() }),
]);
export type EventoSensor = z.infer<typeof esquemaEventoSensor>;

/** Códigos de erro padronizados da API. */
export const CODIGOS_ERRO = {
  DADOS_INVALIDOS: 400,
  TICKET_NAO_ENCONTRADO: 404,
  REGIAO_NAO_ENCONTRADA: 404,
  ACESSO_NAO_ENCONTRADO: 404,
  SEM_REGIAO_ELEGIVEL: 409,
  TRANSICAO_INVALIDA: 409,
  REGIAO_LOTADA: 409,
  CATEGORIA_INCOMPATIVEL: 409,
  REGIAO_INDISPONIVEL: 409,
  NAO_AUTORIZADO: 401,
  SIMULACAO_ESTADO_INVALIDO: 409,
  /** Banco de dados fora do ar ou sem resposta (Etapa 4). */
  BANCO_INDISPONIVEL: 503,
  ROTA_NAO_ENCONTRADA: 404,
} as const;
export type CodigoErro = keyof typeof CODIGOS_ERRO;

export interface RespostaErro {
  erro: { codigo: CodigoErro; mensagem: string; detalhes?: unknown };
}
