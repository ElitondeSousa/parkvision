/**
 * Testes de integração da Etapa 4 no backend: concorrência no mesmo ticket, versões e ordem dos eventos,
 * eventos de ticket, histórico, modo demonstração, acesso restrito, banco indisponível e sala do localizador.
 */
import { NAMESPACE_LOCALIZADOR, type EventoTempoReal, type Regiao } from '@parkvision/shared';
import { PrismaClient } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import { io as conectar, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.ts';
import { lerConfig } from '../src/config.ts';
import { semear } from '../src/seed.ts';
import { hashToken } from '../src/servicos/tickets.ts';
import { emissorColetor, iniciarSocket, type Emissor } from '../src/tempo-real.ts';

const URL_TESTE = process.env.DATABASE_URL_TESTE!;
const db = new PrismaClient({ datasources: { db: { url: URL_TESTE } } });
const config = { ...lerConfig({}), simuladorToken: 'token-teste', operadorToken: 'token-operador', webUrl: 'http://web.teste' };
const coletor = emissorColetor();
const app = criarApp({ db, emissor: coletor.emissor, config });
const OP = { 'x-operador-token': 'token-operador' };

const entrar = async (extra: object = {}) => (await app.inject({ method: 'POST', url: '/api/entradas', payload: { acessoId: 'A_NE', categoria: 'CARRO_PEQUENO', ...extra } })).json();
const regiao = async (id: string) => ((await app.inject('/api/regioes')).json() as Regiao[]).find((r) => r.id === id)!;
const post = (url: string, payload?: object) => app.inject({ method: 'POST', url, headers: OP, payload: payload ?? {} });

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await semear(db, { limpar: true }); coletor.eventos.length = 0; });
afterAll(async () => { await app.close(); await db.$disconnect(); });

describe('acesso às operações', () => {
  it('confirmar, sair, cancelar, ajustar região e consultar tickets exigem o token do operador', async () => {
    const { ticket } = await entrar();
    for (const [method, url] of [['POST', `/api/tickets/${ticket.codigo}/estacionar`], ['POST', `/api/tickets/${ticket.codigo}/saida`], ['POST', `/api/tickets/${ticket.codigo}/cancelar`],
      ['POST', `/api/tickets/${ticket.codigo}/recomendacao`], ['GET', '/api/tickets'], ['GET', `/api/tickets/${ticket.codigo}`], ['PATCH', '/api/regioes/N1']] as const) {
      const r = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
      expect(r.statusCode, `${method} ${url}`).toBe(401);
      expect(r.json().erro.codigo).toBe('NAO_AUTORIZADO');
    }
    expect((await app.inject({ method: 'POST', url: `/api/tickets/${ticket.codigo}/estacionar`, headers: { 'x-operador-token': 'errado' } })).statusCode).toBe(401);
    // totem, localizador e leitura agregada continuam públicos
    expect((await app.inject('/api/regioes')).statusCode).toBe(200);
    expect((await app.inject('/api/historico')).statusCode).toBe(200);
  });

  it('valida o formato do código e do token e responde rotas inexistentes no formato padrão', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/tickets/DROP%20TABLE/estacionar', headers: OP })).statusCode).toBe(400);
    expect((await app.inject('/api/localizador/curto')).statusCode).toBe(400);
    const r = await app.inject('/api/nao-existe');
    expect(r.statusCode).toBe(404);
    expect(r.json().erro.codigo).toBe('ROTA_NAO_ENCONTRADA');
  });

  it('a consulta do operador mostra o ticket e todas as recomendações dele', async () => {
    const { ticket } = await entrar();
    await post(`/api/tickets/${ticket.codigo}/recomendacao`);
    const r = (await app.inject({ url: `/api/tickets/${ticket.codigo}`, headers: OP })).json();
    expect(r.ticket.codigo).toBe(ticket.codigo);
    expect(r.recomendacoes).toHaveLength(2);
    expect(r.simulado).toBe(false);
  });
});

describe('concorrência no mesmo ticket', () => {
  it('confirmações simultâneas do mesmo ticket contam uma única vaga', async () => {
    const { ticket, recomendacao } = await entrar();
    const res = await Promise.all(Array.from({ length: 6 }, () => post(`/api/tickets/${ticket.codigo}/estacionar`)));
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(res.filter((r) => r.statusCode === 409).every((r) => r.json().erro.codigo === 'TRANSICAO_INVALIDA')).toBe(true);
    expect((await regiao(recomendacao.regiaoId)).ocupadas).toBe(1);
    expect(await db.eventoOcupacao.count({ where: { tipo: 'ENTRADA_VAGA' } })).toBe(1);
  });

  it('saídas simultâneas do mesmo ticket liberam uma única vaga', async () => {
    const { ticket } = await entrar();
    await post(`/api/tickets/${ticket.codigo}/estacionar`, { regiaoId: 'S1' });
    await post(`/api/tickets/${ticket.codigo}/estacionar`, { regiaoId: 'S1' }); // repetida: recusada
    const res = await Promise.all(Array.from({ length: 6 }, () => post(`/api/tickets/${ticket.codigo}/saida`)));
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect((await regiao('S1')).ocupadas).toBe(0);
    expect(await db.eventoOcupacao.count({ where: { tipo: 'SAIDA_VAGA' } })).toBe(1);
  });

  it('confirmação rejeitada por lotação não deixa o ticket marcado como estacionado', async () => {
    const { ticket } = await entrar();
    const s1 = await regiao('S1');
    await app.inject({ method: 'PATCH', url: '/api/regioes/S1', headers: OP, payload: { ocupadas: s1.vagas!.COMUM.capacidade } }); // vagas comuns lotadas
    expect((await post(`/api/tickets/${ticket.codigo}/estacionar`, { regiaoId: 'S1' })).json().erro.codigo).toBe('REGIAO_LOTADA');
    expect((await db.ticket.findUnique({ where: { codigo: ticket.codigo } }))!.status).toBe('AGUARDANDO');
    expect((await post(`/api/tickets/${ticket.codigo}/estacionar`)).statusCode).toBe(200); // segue podendo confirmar em outra região
  });
});

describe('ordem e conteúdo dos eventos', () => {
  it('a versão da região sobe a cada mudança e os eventos saem em sequência crescente', async () => {
    const v0 = (await regiao('S2')).versao!;
    const a = await entrar(), b = await entrar();
    await post(`/api/tickets/${a.ticket.codigo}/estacionar`, { regiaoId: 'S2' });
    await post(`/api/tickets/${b.ticket.codigo}/estacionar`, { regiaoId: 'S2' });
    await post(`/api/tickets/${a.ticket.codigo}/saida`);
    expect((await regiao('S2')).versao).toBe(v0 + 3);
    const doS2 = coletor.eventos.filter((e) => e.tipo === 'regiao:ocupacao' && e.entidadeId === 'S2').map((e) => (e.dados as Regiao).versao!);
    expect(doS2).toEqual([v0 + 1, v0 + 2, v0 + 3]);
    const seqs = coletor.eventos.map((e) => e.sequencia);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(coletor.eventos.map((e) => e.id)).size).toBe(coletor.eventos.length);
  });

  it('cada mudança do ticket emite ticket:atualizado, e eventos públicos não levam a placa', async () => {
    const r = await entrar({ placa: 'ABC1D23' });
    expect(r.ticket.placa).toBe('ABC1D23'); // resposta do próprio totem
    await post(`/api/tickets/${r.ticket.codigo}/estacionar`);
    await post(`/api/tickets/${r.ticket.codigo}/saida`);
    const status = coletor.eventos.filter((e) => e.tipo === 'ticket:atualizado').map((e) => (e.dados as { status: string }).status);
    expect(status).toEqual(['AGUARDANDO', 'ESTACIONADO', 'SAIU']);
    expect(JSON.stringify(coletor.eventos)).not.toContain('ABC1D23');
  });

  it('o histórico guarda entrada, estacionamento e saída (do mais novo para o mais antigo)', async () => {
    const { ticket, recomendacao } = await entrar();
    await post(`/api/tickets/${ticket.codigo}/estacionar`);
    await post(`/api/tickets/${ticket.codigo}/saida`);
    const h = (await app.inject('/api/historico?limite=10')).json() as { tipo: string; ticketCodigo: string; regiaoId: string }[];
    expect(h.map((x) => x.tipo)).toEqual(['SAIU', 'ESTACIONOU', 'ENTRADA']);
    expect(h.every((x) => x.ticketCodigo === ticket.codigo && x.regiaoId === recomendacao.regiaoId)).toBe(true);
  });
});

describe('modo demonstração e saúde', () => {
  it('no modo demonstração tudo o que o totem cria é simulado e o reinício limpa', async () => {
    const appDemo = criarApp({ db, emissor: emissorColetor().emissor, config: { ...config, modoDemonstracao: true } });
    try {
      expect((await appDemo.inject('/api/saude')).json()).toMatchObject({ ok: true, banco: 'ok', modoDemonstracao: true });
      const { ticket } = (await appDemo.inject({ method: 'POST', url: '/api/entradas', payload: { acessoId: 'A_S1', categoria: 'MOTO' } })).json();
      await appDemo.inject({ method: 'POST', url: `/api/tickets/${ticket.codigo}/estacionar`, headers: OP });
      expect((await db.ticket.findUnique({ where: { codigo: ticket.codigo } }))!.simulado).toBe(true);
      expect((await appDemo.inject('/api/simulacao')).json()).toMatchObject({ modoDemonstracao: true, veiculosSimuladosAtivos: 1 });
      await appDemo.inject({ method: 'POST', url: '/api/simulacao/reiniciar', headers: OP });
      expect(await db.ticket.count()).toBe(0);
      expect((await regiao('SS1M')).ocupadas).toBe(0);
    } finally {
      await appDemo.close();
    }
  });

  it('banco fora do ar: 503 com mensagem clara e sem detalhes internos', async () => {
    const dbFora = new PrismaClient({ datasources: { db: { url: 'postgresql://usuario:senha-secreta@127.0.0.1:1/parkvision' } } });
    const appFora = criarApp({ db: dbFora, emissor: emissorColetor().emissor, config });
    try {
      const r = await appFora.inject('/api/regioes');
      expect(r.statusCode).toBe(503);
      expect(r.json().erro).toMatchObject({ codigo: 'BANCO_INDISPONIVEL' });
      expect(r.body).not.toMatch(/senha-secreta|usuario|127\.0\.0\.1/);
      expect((await appFora.inject('/api/saude')).statusCode).toBe(503);
    } finally {
      await appFora.close();
      await dbFora.$disconnect().catch(() => {});
    }
  }, 30_000);
});

describe('localizador em tempo real', () => {
  it('cada localizador recebe só os eventos do próprio ticket; token inválido é recusado', async () => {
    let destino: Emissor = { emitir() {} };
    const appRT = criarApp({ db, config, emissor: { emitir: (t, e, d, s) => destino.emitir(t, e, d, s) } });
    await appRT.listen({ port: 0, host: '127.0.0.1' });
    const rt = iniciarSocket(appRT.server, {
      simuladorToken: config.simuladorToken, origemWeb: '*',
      resolverTicket: async (token) => (await db.ticket.findUnique({ where: { tokenHash: hashToken(token) } }))?.codigo ?? null,
    });
    destino = rt.emissor;
    const url = `http://127.0.0.1:${(appRT.server.address() as AddressInfo).port}${NAMESPACE_LOCALIZADOR}`;
    const sockets: Socket[] = [];
    try {
      const meu = (await appRT.inject({ method: 'POST', url: '/api/entradas', payload: { acessoId: 'A_NE', categoria: 'CARRO_PEQUENO' } })).json();
      const outro = (await appRT.inject({ method: 'POST', url: '/api/entradas', payload: { acessoId: 'A_NE', categoria: 'CARRO_PEQUENO' } })).json();
      const token = (meu.qrUrl as string).split('/t/')[1]!;
      const s = conectar(url, { transports: ['websocket'], auth: { token } });
      sockets.push(s);
      await new Promise<void>((ok, erro) => { s.on('connect', () => ok()); s.on('connect_error', erro); });
      const recebidos: EventoTempoReal[] = [];
      s.on('ticket:atualizado', (ev: EventoTempoReal) => recebidos.push(ev));
      await appRT.inject({ method: 'POST', url: `/api/tickets/${outro.ticket.codigo}/estacionar`, headers: OP });
      await appRT.inject({ method: 'POST', url: `/api/tickets/${meu.ticket.codigo}/estacionar`, headers: OP });
      await expect.poll(() => recebidos.length).toBe(1);
      expect(recebidos[0]).toMatchObject({ tipo: 'ticket:atualizado', entidadeId: meu.ticket.codigo, dados: { status: 'ESTACIONADO' } });

      const invasor = conectar(url, { transports: ['websocket'], auth: { token: 'AAAAAAAAAAAAAAAAAAAAAA' } });
      sockets.push(invasor);
      await expect(new Promise((ok, erro) => { invasor.on('connect', () => ok(null)); invasor.on('connect_error', erro); })).rejects.toThrow('ticket não encontrado');
    } finally {
      sockets.forEach((x) => x.close());
      await new Promise((ok) => rt.io.close(() => ok(null)));
      await appRT.close().catch(() => {});
    }
  });
});
