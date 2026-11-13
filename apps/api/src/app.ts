/**
 * Aplicação Fastify (rotas REST). Separada do servidor para ser testada com app.inject().
 * Contratos: docs/mvp/02-contratos.md §4. Simulador: docs/mvp/08-simulador.md.
 */
import {
  esquemaAtivarCenario, esquemaAtualizarRegiao, esquemaConfigSimulacao, esquemaEstacionar, esquemaEventoManual, esquemaEventoSensor,
  esquemaIniciarSimulacao, esquemaListarRecomendacoes, esquemaListarTickets, esquemaNovaEntrada, mapaCapimDourado,
} from '@parkvision/shared';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import { ErroApi, registrarTratamentoDeErros } from './erros.ts';
import { atualizarRegiao, calcularIndicadores, listarRegioes } from './servicos/regioes.ts';
import { processarEventoSensor } from './servicos/sensores.ts';
import { cancelar, estacionar, listarRecomendacoes, listarTickets, localizar, novaRecomendacao, registrarEntrada, registrarSaida } from './servicos/tickets.ts';
import { MotorSimulacao } from './simulador/motor.ts';
import type { Emissor } from './tempo-real.ts';

export interface OpcoesApp {
  db: PrismaClient;
  emissor: Emissor;
  config: Config;
  log?: boolean;
  /** Motor do simulador. Se omitido, é criado em modo passo a passo (sem timer). */
  motor?: MotorSimulacao;
}

export function criarApp({ db, emissor, config, log = false, motor: motorInformado }: OpcoesApp) {
  const app = Fastify({ logger: log });
  registrarTratamentoDeErros(app);
  const deps = { db, emissor, config };
  const motor = motorInformado ?? new MotorSimulacao(deps);
  app.decorate('motor', motor);
  app.addHook('onClose', async () => motor.desligar());

  const ehSimulador = (req: FastifyRequest) => req.headers['x-simulador-token'] === config.simuladorToken;
  const operador = (req: FastifyRequest) => (ehSimulador(req) ? 'simulador' : 'operador');
  /** Rotas de controle do simulador e de sensores exigem o token do simulador. */
  const exigirToken = (req: FastifyRequest) => {
    if (!ehSimulador(req)) throw new ErroApi('NAO_AUTORIZADO', 'Informe o cabeçalho x-simulador-token válido');
  };
  /** Relógio da API: simulado enquanto há simulação ativa (para fluxo e indicadores coerentes); real quando parada. */
  const agora = () => motor.agora();

  // CORS simples para a web local
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', config.webUrl);
    reply.header('Access-Control-Allow-Headers', 'content-type, x-simulador-token');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    if (req.method === 'OPTIONS') return reply.status(204).send();
  });

  app.get('/api/saude', async () => ({ ok: true }));
  app.get('/api/mapa', async () => mapaCapimDourado);

  // ── regiões, tickets e indicadores (Etapa 1) ──
  app.get('/api/regioes', async () => listarRegioes(db, agora()));
  app.patch<{ Params: { id: string } }>('/api/regioes/:id', async (req) =>
    atualizarRegiao(db, emissor, req.params.id, esquemaAtualizarRegiao.parse(req.body), operador(req)));

  app.post('/api/entradas', async (req, reply) => {
    const r = await registrarEntrada(deps, esquemaNovaEntrada.parse(req.body), { agora: agora(), origem: ehSimulador(req) ? 'simulador' : 'totem' });
    return reply.status(201).send(r);
  });
  app.post<{ Params: { codigo: string } }>('/api/tickets/:codigo/estacionar', async (req) =>
    estacionar(deps, req.params.codigo, esquemaEstacionar.parse(req.body ?? {}).regiaoId, { agora: agora(), origem: operador(req) }));
  app.post<{ Params: { codigo: string } }>('/api/tickets/:codigo/saida', async (req) =>
    registrarSaida(deps, req.params.codigo, { agora: agora(), origem: operador(req) }));
  app.post<{ Params: { codigo: string } }>('/api/tickets/:codigo/recomendacao', async (req) =>
    novaRecomendacao(deps, req.params.codigo, 'Nova recomendação solicitada', { agora: agora() }));
  app.post<{ Params: { codigo: string } }>('/api/tickets/:codigo/cancelar', async (req) =>
    cancelar(deps, req.params.codigo, { agora: agora() }));
  app.get('/api/tickets', async (req) => listarTickets(db, esquemaListarTickets.parse(req.query)));
  app.get('/api/recomendacoes', async (req) => listarRecomendacoes(db, esquemaListarRecomendacoes.parse(req.query).limite));
  app.get<{ Params: { token: string } }>('/api/localizador/:token', async (req) => localizar(db, req.params.token));
  app.get('/api/indicadores', async () => calcularIndicadores(db, agora()));

  // ── sensores (virtuais hoje; o mesmo contrato servirá para sensores reais) ──
  app.post('/api/sensores/eventos', async (req) => {
    exigirToken(req);
    return processarEventoSensor(deps, esquemaEventoSensor.parse(req.body), { simulado: true, agora: agora() });
  });

  // ── controle do simulador (Etapa 2) ──
  app.get('/api/simulacao', async () => motor.estadoAtual());
  app.post('/api/simulacao/iniciar', async (req) => { exigirToken(req); return motor.iniciar(esquemaIniciarSimulacao.parse(req.body ?? {})); });
  app.post('/api/simulacao/pausar', async (req) => { exigirToken(req); return motor.pausar(); });
  app.post('/api/simulacao/retomar', async (req) => { exigirToken(req); return motor.retomar(); });
  app.post('/api/simulacao/encerrar', async (req) => { exigirToken(req); return motor.encerrar(); });
  app.post('/api/simulacao/reiniciar', async (req) => { exigirToken(req); return motor.reiniciar(); });
  app.patch('/api/simulacao/config', async (req) => { exigirToken(req); return motor.configurar(esquemaConfigSimulacao.parse(req.body ?? {})); });
  app.post('/api/simulacao/cenario', async (req) => {
    exigirToken(req);
    const { cenario } = esquemaAtivarCenario.parse(req.body);
    const config = esquemaConfigSimulacao.optional().parse((req.body as { config?: unknown } | undefined)?.config);
    return motor.aplicarCenario(cenario, config);
  });
  app.post('/api/simulacao/eventos', async (req) => { exigirToken(req); return motor.executarManual(esquemaEventoManual.parse(req.body)); });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance { motor: MotorSimulacao }
}
