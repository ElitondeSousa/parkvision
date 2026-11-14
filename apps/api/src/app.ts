/**
 * Aplicação Fastify (rotas REST). Separada do servidor para ser testada com app.inject().
 * Contratos: docs/mvp/02-contratos.md §4. Simulador: docs/mvp/08-simulador.md. Integração: docs/mvp/12-integracao.md.
 *
 * Acesso (Etapa 4):
 *  - público: leitura agregada (regiões, indicadores, mapa, recomendações, histórico), entrada pelo totem e localizador (pelo token do QR);
 *  - operador (cabeçalho x-operador-token ou x-simulador-token): confirmar estacionamento, saída, cancelamento, nova recomendação,
 *    consulta de tickets, ajuste de região, sensores e controle do simulador.
 */
import {
  esquemaAtivarCenario, esquemaAtualizarRegiao, esquemaConfigSimulacao, esquemaEstacionar, esquemaEventoManual, esquemaEventoSensor,
  esquemaIniciarSimulacao, esquemaListarRecomendacoes, esquemaListarTickets, esquemaNovaEntrada, esquemaVagasReservadas, mapaCapimDourado,
  acessibilidade, caminhosPedestres, resumoVagasReservadas,
} from '@parkvision/shared';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.ts';
import { ErroApi, ehFalhaDeBanco, registrarTratamentoDeErros } from './erros.ts';
import { atualizarRegiao, calcularIndicadores, configurarVagasReservadas, listarRegioes } from './servicos/regioes.ts';
import { processarEventoSensor } from './servicos/sensores.ts';
import {
  cancelar, consultarTicket, estacionar, historico, listarRecomendacoes, listarTickets, localizar, novaRecomendacao, registrarEntrada, registrarSaida,
} from './servicos/tickets.ts';
import { CENARIOS_DEF } from './simulador/cenarios.ts';
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

const esquemaCodigo = z.object({ codigo: z.string().regex(/^[A-Z]{2,3}-[0-9A-F]{4,12}$/, 'Código de ticket inválido') });
const esquemaToken = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Token inválido') });
const esquemaLimite = z.object({ limite: z.coerce.number().int().min(1).max(100).default(30) });

export function criarApp({ db, emissor, config, log = false, motor: motorInformado }: OpcoesApp) {
  const app = Fastify({ logger: log });
  registrarTratamentoDeErros(app);
  const deps = { db, emissor, config };
  const motor = motorInformado ?? new MotorSimulacao(deps);
  app.decorate('motor', motor);
  app.addHook('onClose', async () => motor.desligar());

  const cabecalho = (req: FastifyRequest, nome: string) => { const v = req.headers[nome]; return typeof v === 'string' ? v : undefined; };
  const ehSimulador = (req: FastifyRequest) => cabecalho(req, 'x-simulador-token') === config.simuladorToken;
  const ehOperador = (req: FastifyRequest) => {
    const t = cabecalho(req, 'x-operador-token') ?? cabecalho(req, 'x-simulador-token');
    return t !== undefined && (t === config.operadorToken || t === config.simuladorToken);
  };
  /** Operações administrativas exigem o token do operador (um único segredo no MVP). */
  const exigirOperador = (req: FastifyRequest) => {
    if (!ehOperador(req)) throw new ErroApi('NAO_AUTORIZADO', 'Operação restrita ao operador: informe o cabeçalho x-operador-token válido');
  };
  const origem = (req: FastifyRequest) => (ehSimulador(req) ? 'simulador' : 'operador');
  /** Relógio da API: simulado enquanto há simulação ativa (para fluxo e indicadores coerentes); real quando parada. */
  const agora = () => motor.agora();
  const codigo = (req: FastifyRequest) => esquemaCodigo.parse(req.params).codigo;

  // CORS: só a origem da web configurada
  app.addHook('onRequest', async (req, reply: FastifyReply) => {
    reply.header('Access-Control-Allow-Origin', config.webUrl);
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Headers', 'content-type, x-operador-token, x-simulador-token');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return reply.status(204).send();
  });

  /** Saúde: confere o banco de verdade. 503 se ele não responder (a web mostra "sistema indisponível"). */
  app.get('/api/saude', async (_req, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { ok: true, banco: 'ok', modoDemonstracao: config.modoDemonstracao };
    } catch (e) {
      if (!ehFalhaDeBanco(e)) throw e;
      return reply.status(503).send({ ok: false, banco: 'indisponivel', modoDemonstracao: config.modoDemonstracao });
    }
  });
  app.get('/api/mapa', async () => mapaCapimDourado);

  // ── leitura pública ──
  app.get('/api/regioes', async () => listarRegioes(db, agora()));
  app.get('/api/indicadores', async () => calcularIndicadores(db, agora()));
  app.get('/api/recomendacoes', async (req) => listarRecomendacoes(db, esquemaListarRecomendacoes.parse(req.query).limite));
  app.get('/api/historico', async (req) => historico(db, esquemaLimite.parse(req.query).limite));
  // vagas reservadas: totais por tipo, mínimos legais, alertas, critérios da proposta e caminhos a pé (o que a planta diz)
  app.get('/api/vagas-reservadas', async () => ({
    ...resumoVagasReservadas(await listarRegioes(db, agora())),
    referenciasLegais: acessibilidade.referenciasLegais,
    baseDeCalculo: acessibilidade.baseDeCalculo,
    normasAVerificar: acessibilidade.normasAVerificar,
    criterios: acessibilidade.criteriosDistribuicao,
    vagasNaPlanta: acessibilidade.vagasNaPlanta,
    caminhos: caminhosPedestres(),
  }));

  // ── totem e localizador ──
  app.post('/api/entradas', async (req, reply) => {
    const r = await registrarEntrada(deps, esquemaNovaEntrada.parse(req.body), {
      agora: agora(), origem: ehSimulador(req) ? 'simulador' : 'totem', simulado: config.modoDemonstracao,
    });
    return reply.status(201).send(r);
  });
  app.get('/api/localizador/:token', async (req) => localizar(db, esquemaToken.parse(req.params).token));

  // ── operação (restrita) ──
  app.patch<{ Params: { id: string } }>('/api/regioes/:id', async (req) => {
    exigirOperador(req);
    return atualizarRegiao(db, emissor, req.params.id, esquemaAtualizarRegiao.parse(req.body), origem(req));
  });
  app.patch<{ Params: { id: string } }>('/api/regioes/:id/vagas-reservadas', async (req) => {
    exigirOperador(req);
    return configurarVagasReservadas(db, emissor, req.params.id, esquemaVagasReservadas.parse(req.body));
  });
  app.get('/api/tickets', async (req) => { exigirOperador(req); return listarTickets(db, esquemaListarTickets.parse(req.query)); });
  app.get('/api/tickets/:codigo', async (req) => { exigirOperador(req); return consultarTicket(db, codigo(req)); });
  app.post('/api/tickets/:codigo/estacionar', async (req) => {
    exigirOperador(req);
    return estacionar(deps, codigo(req), esquemaEstacionar.parse(req.body ?? {}).regiaoId, { agora: agora(), origem: origem(req) });
  });
  app.post('/api/tickets/:codigo/saida', async (req) => { exigirOperador(req); return registrarSaida(deps, codigo(req), { agora: agora(), origem: origem(req) }); });
  app.post('/api/tickets/:codigo/recomendacao', async (req) => {
    exigirOperador(req);
    return novaRecomendacao(deps, codigo(req), 'Nova recomendação solicitada', { agora: agora() });
  });
  app.post('/api/tickets/:codigo/cancelar', async (req) => { exigirOperador(req); return cancelar(deps, codigo(req), { agora: agora() }); });

  // ── sensores (virtuais hoje; o mesmo contrato servirá para sensores reais) ──
  app.post('/api/sensores/eventos', async (req) => {
    exigirOperador(req);
    return processarEventoSensor(deps, esquemaEventoSensor.parse(req.body), { simulado: true, agora: agora() });
  });

  // ── simulador ──
  app.get('/api/simulacao', async () => ({
    ...motor.estadoAtual(),
    /** Veículos simulados ainda ativos no banco (o painel usa para sinalizar o ambiente de demonstração mesmo com o motor parado). */
    veiculosSimuladosAtivos: await db.ticket.count({ where: { simulado: true, status: { in: ['AGUARDANDO', 'ESTACIONADO'] } } }),
    modoDemonstracao: config.modoDemonstracao,
  }));
  app.get('/api/simulacao/cenarios', async () =>
    Object.values(CENARIOS_DEF).map(({ id, nome, descricao, ocupacaoInicial, config: c }) => ({ id, nome, descricao, ocupacaoInicial, entradasPorMinuto: c.entradasPorMinuto ?? null })));
  app.post('/api/simulacao/iniciar', async (req) => { exigirOperador(req); return motor.iniciar(esquemaIniciarSimulacao.parse(req.body ?? {})); });
  app.post('/api/simulacao/pausar', async (req) => { exigirOperador(req); return motor.pausar(); });
  app.post('/api/simulacao/retomar', async (req) => { exigirOperador(req); return motor.retomar(); });
  app.post('/api/simulacao/encerrar', async (req) => { exigirOperador(req); return motor.encerrar(); });
  app.post('/api/simulacao/reiniciar', async (req) => { exigirOperador(req); return motor.reiniciar(); });
  app.patch('/api/simulacao/config', async (req) => { exigirOperador(req); return motor.configurar(esquemaConfigSimulacao.parse(req.body ?? {})); });
  app.post('/api/simulacao/cenario', async (req) => {
    exigirOperador(req);
    const { cenario } = esquemaAtivarCenario.parse(req.body);
    const cfg = esquemaConfigSimulacao.optional().parse((req.body as { config?: unknown } | undefined)?.config);
    return motor.aplicarCenario(cenario, cfg);
  });
  app.post('/api/simulacao/eventos', async (req) => { exigirOperador(req); return motor.executarManual(esquemaEventoManual.parse(req.body)); });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance { motor: MotorSimulacao }
}
