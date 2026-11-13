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

export const esquemaComandoSimulacao = z.object({
  acao: z.enum(['iniciar', 'pausar', 'reiniciar']),
  cenario: z.enum(['normal', 'pico', 'regiao-lotada', 'regiao-indisponivel']).optional(),
  velocidade: z.union([z.literal(1), z.literal(5), z.literal(20)]).optional(),
  regiaoAlvo: z.string().optional(),
});
export type ComandoSimulacao = z.infer<typeof esquemaComandoSimulacao>;

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
} as const;
export type CodigoErro = keyof typeof CODIGOS_ERRO;

export interface RespostaErro {
  erro: { codigo: CodigoErro; mensagem: string; detalhes?: unknown };
}
