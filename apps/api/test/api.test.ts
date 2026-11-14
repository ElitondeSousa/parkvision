import type { Regiao } from '@parkvision/shared';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.ts';
import { lerConfig } from '../src/config.ts';
import { semear } from '../src/seed.ts';
import { emissorColetor } from '../src/tempo-real.ts';

const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TESTE! } } });
const config = { ...lerConfig({}), simuladorToken: 'token-teste', webUrl: 'http://web.teste' };
const coletor = emissorColetor();
/** Token do operador (rotas restritas desde a Etapa 4). */
const OP = { 'x-operador-token': 'token-teste' };
const app = criarApp({ db, emissor: coletor.emissor, config });

const CARROS = ['N1', 'N2', 'N3', 'S1', 'S2', 'SS1', 'SS2O', 'SS2C', 'SS2L'];
const regioes = async () => (await app.inject('/api/regioes')).json() as Regiao[];
const ocupadas = async (id: string) => (await regioes()).find((r) => r.id === id)!.ocupadas;
const entrar = (categoria = 'CARRO_PEQUENO', acessoId = 'A_NE') => app.inject({ method: 'POST', url: '/api/entradas', payload: { acessoId, categoria } });
/** Lota as vagas COMUNS da região (deixando `livres` comuns); as reservadas (PcD/idoso) não entram no ajuste do total. */
const lotar = (id: string, livres = 0) =>
  regioes().then((rs) => app.inject({ method: 'PATCH', headers: OP, url: `/api/regioes/${id}`, payload: { ocupadas: rs.find((r) => r.id === id)!.vagas!.COMUM.capacidade - livres } }));

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await semear(db, { limpar: true }); coletor.eventos.length = 0; });
afterAll(async () => { await app.close(); await db.$disconnect(); });

describe('regiões e mapa', () => {
  it('lista as 10 regiões com a capacidade e a fonte corretas', async () => {
    const rs = await regioes();
    expect(rs.map((r) => r.id)).toEqual(['N1', 'N2', 'N3', 'S1', 'S2', 'SS1', 'SS1M', 'SS2O', 'SS2C', 'SS2L']);
    expect(rs.find((r) => r.id === 'SS1')).toMatchObject({ capacidade: 140, fonteCapacidade: 'planta', livres: 140 });
    expect(rs.find((r) => r.id === 'N3')).toMatchObject({ capacidade: 203, fonteCapacidade: 'desenho' });
  });
  it('entrega o mapa digital', async () => {
    const m = (await app.inject('/api/mapa')).json();
    expect(m.regioes).toHaveLength(10);
  });
});

describe('fluxo do veículo', () => {
  it('entrada recomenda uma região, gera ticket e QR — sem alterar a ocupação', async () => {
    const r = await entrar();
    expect(r.statusCode).toBe(201);
    const { ticket, recomendacao, qrUrl } = r.json();
    expect(ticket).toMatchObject({ codigo: 'PV-0001', status: 'AGUARDANDO', categoria: 'CARRO_PEQUENO' });
    expect(CARROS).toContain(recomendacao.regiaoId);
    expect(recomendacao.justificativa).toMatch(/\S/);
    expect(recomendacao.avaliacoes).toHaveLength(10);
    expect(qrUrl).toMatch(/^http:\/\/web\.teste\/t\/[\w-]{20,}$/);
    expect((await regioes()).reduce((s, x) => s + x.ocupadas, 0)).toBe(0);   // sem reserva
    expect(coletor.eventos.map((e) => e.tipo)).toContain('veiculo:entrou');
    expect(coletor.eventos.every((e) => e.simulado === false)).toBe(true);
  });

  it('confirmação ocupa a vaga e a saída libera', async () => {
    const { ticket, recomendacao } = (await entrar()).json();
    const est = await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/estacionar` });
    expect(est.statusCode).toBe(200);
    expect(est.json().ticket).toMatchObject({ status: 'ESTACIONADO', regiaoEstacionadaId: recomendacao.regiaoId });
    expect(await ocupadas(recomendacao.regiaoId)).toBe(1);
    expect(coletor.eventos.map((e) => e.tipo)).toEqual(expect.arrayContaining(['veiculo:estacionou', 'regiao:ocupacao', 'indicadores:atualizados']));

    const repetir = await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/estacionar` });
    expect(repetir.statusCode).toBe(409);
    expect(repetir.json().erro.codigo).toBe('TRANSICAO_INVALIDA');

    const saida = await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/saida` });
    expect(saida.json().ticket.status).toBe('SAIU');
    expect(await ocupadas(recomendacao.regiaoId)).toBe(0);

    const saidaDuplicada = await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/saida` });
    expect(saidaDuplicada.statusCode).toBe(409);
    expect(await ocupadas(recomendacao.regiaoId)).toBe(0);
  });

  it('permite confirmar em outra região compatível (motorista não seguiu a recomendação)', async () => {
    const { ticket } = (await entrar()).json();
    const r = await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/estacionar`, payload: { regiaoId: 'S2' } });
    expect(r.json().regiao).toMatchObject({ id: 'S2', ocupadas: 1 });
  });

  // Etapa 2: saída só para veículo estacionado; quem desistiu antes de estacionar é cancelado.
  it('saída sem ter estacionado é recusada; desistência usa cancelar (ocupação intacta)', async () => {
    const { ticket } = (await entrar()).json();
    const r = await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/saida` });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe('TRANSICAO_INVALIDA');
    const c = await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/cancelar` });
    expect(c.json()).toMatchObject({ ticket: { status: 'CANCELADO' } });
    expect((await regioes()).reduce((s, x) => s + x.ocupadas, 0)).toBe(0);
  });

  it('localizador pelo token do QR Code', async () => {
    const { ticket, qrUrl, recomendacao } = (await entrar()).json();
    const token = qrUrl.split('/t/')[1];
    const antes = (await app.inject(`/api/localizador/${token}`)).json();
    expect(antes.rota.nos).toEqual(recomendacao.rota.nos); // a caminho: rota da recomendação para a navegação
    await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/estacionar` });
    const r = (await app.inject(`/api/localizador/${token}`)).json();
    expect(r.ticket.codigo).toBe(ticket.codigo);
    expect(r.ticket.estacionadoEm).toMatch(/^\d{4}-/);
    expect(r.acesso).toEqual({ id: 'A_NE', nome: expect.stringContaining('nordeste') });
    expect(r.rota).toBeNull(); // estacionado: sem rota ativa
    expect(r.ticket.saidaEm).toBeNull();
    expect(r.regiao.id).toBe(ticket.regiaoRecomendadaId);
    expect(r.orientacao[0]).toContain(r.regiao.id);
    expect((await app.inject('/api/localizador/token-que-nao-existe')).statusCode).toBe(404);
  });
});

describe('regras da distribuição', () => {
  it('moto vai sempre para a região de motos', async () => {
    const { recomendacao } = (await entrar('MOTO')).json();
    expect(recomendacao.regiaoId).toBe('SS1M');
  });

  it('nunca recomenda região lotada e escolhe outra', async () => {
    for (const id of CARROS.filter((x) => x !== 'S2')) await lotar(id);
    const { recomendacao } = (await entrar()).json();
    expect(recomendacao.regiaoId).toBe('S2');
  });

  it('sem região elegível responde 409 com os motivos', async () => {
    for (const id of CARROS) await lotar(id);
    const r = await entrar();
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe('SEM_REGIAO_ELEGIVEL');
    expect(r.json().erro.detalhes.avaliacoes.find((a: { regiaoId: string }) => a.regiaoId === 'N3').motivo).toBe('SEM_VAGAS');
  });

  it('região fora de operação não é recomendada', async () => {
    for (const id of CARROS.filter((x) => x !== 'N1' && x !== 'N2')) await lotar(id);
    await app.inject({ method: 'PATCH', headers: OP, url: '/api/regioes/N1', payload: { operacional: false } });
    const { recomendacao } = (await entrar()).json();
    expect(recomendacao.regiaoId).toBe('N2');
  });

  it('bloqueia confirmação em região incompatível ou lotada', async () => {
    const { ticket } = (await entrar()).json();
    const moto = await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/estacionar`, payload: { regiaoId: 'SS1M' } });
    expect(moto.json().erro.codigo).toBe('CATEGORIA_INCOMPATIVEL');
    await lotar('S1');
    const cheia = await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/estacionar`, payload: { regiaoId: 'S1' } });
    expect(cheia.json().erro.codigo).toBe('REGIAO_LOTADA');
  });

  it('confirmações simultâneas nunca passam da capacidade', async () => {
    const cap = (await regioes()).find((r) => r.id === 'N2')!.vagas!.COMUM.capacidade;
    await lotar('N2', 5);                                        // sobram 5 vagas comuns
    const tickets = await Promise.all(Array.from({ length: 12 }, () => entrar().then((r) => r.json().ticket.codigo as string)));
    const res = await Promise.all(tickets.map((c) => app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${c}/estacionar`, payload: { regiaoId: 'N2' } })));
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(5);
    expect(res.filter((r) => r.statusCode === 409).every((r) => r.json().erro.codigo === 'REGIAO_LOTADA')).toBe(true);
    expect(await ocupadas('N2')).toBe(cap);
  });
});

describe('validação e indicadores', () => {
  it('rejeita dados inválidos com 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/entradas', payload: { acessoId: 'A_NE', categoria: 'BICICLETA' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro.codigo).toBe('DADOS_INVALIDOS');
    expect((await app.inject({ method: 'POST', url: '/api/entradas', payload: { acessoId: 'X', categoria: 'MOTO' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', headers: OP, url: '/api/regioes/N1', payload: { ocupadas: 99999 } })).statusCode).toBe(400);
  });

  it('indicadores refletem a ocupação e as recomendações', async () => {
    const { ticket } = (await entrar()).json();
    await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/estacionar` });
    await entrar();
    const i = (await app.inject('/api/indicadores')).json();
    expect(i).toMatchObject({ capacidadeTotal: 1269, ocupadas: 1, livres: 1268, veiculosAguardando: 1, recomendacoesUltimaHora: 2 });
    const recs = (await app.inject('/api/recomendacoes?limite=5')).json();
    expect(recs).toHaveLength(2);
  });

  it('o fluxo recente faz a recomendação espalhar os carros', async () => {
    const regs = new Set<string>();
    for (let i = 0; i < 12; i++) regs.add((await entrar()).json().recomendacao.regiaoId);
    expect(regs.size).toBeGreaterThan(1);
  });
});
