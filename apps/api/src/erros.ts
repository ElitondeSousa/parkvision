import { CODIGOS_ERRO, type CodigoErro, type RespostaErro } from '@parkvision/shared';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/** Erro de negócio com código padronizado (docs/mvp/02-contratos.md §4). */
export class ErroApi extends Error {
  constructor(public codigo: CodigoErro, mensagem: string, public detalhes?: unknown) {
    super(mensagem);
  }
}

export function registrarTratamentoDeErros(app: FastifyInstance) {
  app.setErrorHandler((erro, _req, reply) => {
    if (erro instanceof ErroApi) {
      const corpo: RespostaErro = { erro: { codigo: erro.codigo, mensagem: erro.message, detalhes: erro.detalhes } };
      return reply.status(CODIGOS_ERRO[erro.codigo]).send(corpo);
    }
    if (erro instanceof ZodError) {
      const corpo: RespostaErro = { erro: { codigo: 'DADOS_INVALIDOS', mensagem: 'Dados inválidos', detalhes: erro.issues } };
      return reply.status(400).send(corpo);
    }
    const e = erro as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ erro: { codigo: 'DADOS_INVALIDOS', mensagem: e.message ?? 'Requisição inválida' } });
    }
    app.log.error(erro);
    return reply.status(500).send({ erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno' } });
  });
}
