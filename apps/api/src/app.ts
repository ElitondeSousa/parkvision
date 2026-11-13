/**
 * Aplicação Fastify (rotas REST). Separada do servidor para ser testada com app.inject().
 * Contratos: docs/mvp/02-contratos.md §4.
 */
import {
  esquemaAtualizarRegiao, esquemaEstacionar, esquemaListarRecomendacoes, esquemaListarTickets, esquemaNovaEntrada, mapaCapimDourado,
} from '@parkvision/shared';
import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import type { Config } from './config.ts';
import { registrarTratamentoDeErros } from './erros.ts';
import { atualizarRegiao, calcularIndicadores, listarRegioes } from './servicos/regioes.ts';
import { estacionar, listarRecomendacoes, listarTickets, localizar, registrarEntrada, registrarSaida } from './servicos/tickets.ts';
import type { Emissor } from './tempo-real.ts';

export interface OpcoesApp { db: PrismaClient; emissor: Emissor; config: Config; log?: boolean }

export function criarApp({ db, emissor, config, log = false }: OpcoesApp) {
  const app = Fastify({ logger: log });
  registrarTratamentoDeErros(app);
  const deps = { db, emissor, config };
  const origem = (req: { headers: Record<string, unknown> }) =>
    req.headers['x-simulador-token'] === config.simuladorToken ? 'simulador' : 'totem';

  // CORS simples para a web local
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', config.webUrl);
    reply.header('Access-Control-Allow-Headers', 'content-type, x-simulador-token');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    if (req.method === 'OPTIONS') return reply.status(204).send();
  });

  app.get('/api/saude', async () => ({ ok: true }));
  app.get('/api/mapa', async () => mapaCapimDourado);

  app.get('/api/regioes', async () => listarRegioes(db));
  app.patch<{ Params: { id: string } }>('/api/regioes/:id', async (req) =>
    atualizarRegiao(db, emissor, req.params.id, esquemaAtualizarRegiao.parse(req.body), origem(req) === 'simulador' ? 'simulador' : 'operador'));

  app.post('/api/entradas', async (req, reply) => {
    const r = await registrarEntrada(deps, esquemaNovaEntrada.parse(req.body), origem(req));
    return reply.status(201).send(r);
  });
  app.post<{ Params: { codigo: string } }>('/api/tickets/:codigo/estacionar', async (req) =>
    estacionar(deps, req.params.codigo, esquemaEstacionar.parse(req.body ?? {}).regiaoId, origem(req) === 'simulador' ? 'simulador' : 'operador'));
  app.post<{ Params: { codigo: string } }>('/api/tickets/:codigo/saida', async (req) =>
    registrarSaida(deps, req.params.codigo, origem(req) === 'simulador' ? 'simulador' : 'operador'));
  app.get('/api/tickets', async (req) => listarTickets(db, esquemaListarTickets.parse(req.query)));
  app.get('/api/recomendacoes', async (req) => listarRecomendacoes(db, esquemaListarRecomendacoes.parse(req.query).limite));
  app.get<{ Params: { token: string } }>('/api/localizador/:token', async (req) => localizar(db, req.params.token));
  app.get('/api/indicadores', async () => calcularIndicadores(db));

  return app;
}
