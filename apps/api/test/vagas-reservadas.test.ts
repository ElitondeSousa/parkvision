/**
 * Vagas reservadas (PcD e pessoa idosa) com o banco de teste: estrutura por região, recomendação por tipo,
 * ocupação por tipo na confirmação e na saída, concorrência, ajuste administrativo, QR Code e simulador.
 */
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
const OP = { 'x-operador-token': 'token-teste' };
const SIM = { 'x-simulador-token': 'token-teste' };
const app = criarApp({ db, emissor: coletor.emissor, config });

const regioes = async () => (await app.inject('/api/regioes')).json() as Regiao[];
const regiao = async (id: string) => (await regioes()).find((r) => r.id === id)!;
const entrar = (tipoVaga?: string, categoria = 'CARRO_PEQUENO', acessoId = 'A_ROT') =>
  app.inject({ method: 'POST', url: '/api/entradas', payload: { acessoId, categoria, ...(tipoVaga ? { tipoVaga } : {}) } });
const estacionar = (codigo: string, regiaoId?: string) => app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${codigo}/estacionar`, payload: regiaoId ? { regiaoId } : {} });
const sair = (codigo: string) => app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${codigo}/saida` });
const configurar = (id: string, capacidadePcd: number, capacidadeIdoso: number) =>
  app.inject({ method: 'PATCH', headers: OP, url: `/api/regioes/${id}/vagas-reservadas`, payload: { capacidadePcd, capacidadeIdoso } });

beforeAll(async () => { await app.ready(); });
beforeEach(async () => {
  if (app.motor.status !== 'parado') await app.motor.encerrar();
  await semear(db, { limpar: true });
  coletor.eventos.length = 0;
});
afterAll(async () => { await app.close(); await db.$disconnect(); });

describe('estrutura de dados por região', () => {
  it('cada região informa comum, PcD e pessoa idosa, e a soma bate com a capacidade total', async () => {
    for (const r of await regioes()) {
      const v = r.vagas!;
      expect(v.COMUM.capacidade + v.PCD.capacidade + v.IDOSO.capacidade).toBe(r.capacidade);
      expect(v.COMUM.ocupadas + v.PCD.ocupadas + v.IDOSO.ocupadas).toBe(r.ocupadas);
    }
    expect((await regiao('SS1')).vagas).toMatchObject({ PCD: { capacidade: 3 }, IDOSO: { capacidade: 11 }, COMUM: { capacidade: 126 } });
    expect((await regiao('SS1')).fonteVagasReservadas).toBe('planta');
    expect((await regiao('SS1M')).vagas).toMatchObject({ PCD: { capacidade: 0 }, IDOSO: { capacidade: 0 } });
  });

  it('resumo: mínimos legais sobre o total, totais por tipo e nenhum alerta com a proposta', async () => {
    const r = (await app.inject('/api/vagas-reservadas')).json();
    expect(r).toMatchObject({ status: 'proposta-simulada', base: 1269, minimos: { PCD: 26, IDOSO: 64 } });
    expect(r.totais.PCD.capacidade).toBe(26);
    expect(r.totais.IDOSO.capacidade).toBe(64);
    expect(r.alertas).toEqual([]);
    expect(r.caminhos.N2).toMatchObject({ situacao: 'mesmo-nivel', validado: false });
    expect(r.caminhos.SS1).toMatchObject({ situacao: 'nao-identificado', validado: false });
    const ind = (await app.inject('/api/indicadores')).json();
    expect(ind.porTipoVaga.PCD).toEqual({ capacidade: 26, ocupadas: 0, livres: 26 });
  });
});

describe('recomendação e ocupação por tipo', () => {
  it('PcD: recomenda região com vaga PcD, o ticket guarda o tipo e só a confirmação ocupa a vaga PcD', async () => {
    const r = await entrar('PCD');
    expect(r.statusCode).toBe(201);
    const { ticket, recomendacao } = r.json();
    expect(ticket.tipoVaga).toBe('PCD');
    expect(recomendacao.justificativa).toContain('vaga PcD');
    const antes = await regiao(recomendacao.regiaoId);
    expect(antes.vagas!.PCD.capacidade).toBeGreaterThan(0);
    expect(antes.vagas!.PCD.ocupadas).toBe(0); // recomendação não reserva
    expect((await estacionar(ticket.codigo)).statusCode).toBe(200);
    const depois = await regiao(recomendacao.regiaoId);
    expect(depois.vagas!.PCD.ocupadas).toBe(1);
    expect(depois.vagas!.COMUM.ocupadas).toBe(0);
    expect(depois.ocupadas).toBe(1);
    // saída libera a vaga PcD
    expect((await sair(ticket.codigo)).statusCode).toBe(200);
    expect((await regiao(recomendacao.regiaoId)).vagas!.PCD.ocupadas).toBe(0);
  });

  it('pessoa idosa: vaga do próprio tipo', async () => {
    const { ticket, recomendacao } = (await entrar('IDOSO')).json();
    await estacionar(ticket.codigo);
    expect((await regiao(recomendacao.regiaoId)).vagas!.IDOSO.ocupadas).toBe(1);
  });

  it('pedido comum (padrão) ocupa vaga comum, nunca reservada', async () => {
    const { ticket, recomendacao } = (await entrar()).json();
    expect(ticket.tipoVaga).toBe('COMUM');
    await estacionar(ticket.codigo);
    const r = await regiao(recomendacao.regiaoId);
    expect(r.vagas!.COMUM.ocupadas).toBe(1);
    expect(r.vagas!.PCD.ocupadas + r.vagas!.IDOSO.ocupadas).toBe(0);
  });

  it('confirmar ticket PcD em região sem vaga PcD é recusado (não troca de tipo)', async () => {
    const { ticket } = (await entrar('PCD')).json();
    const r = await estacionar(ticket.codigo, 'SS2L');
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe('TIPO_VAGA_INCOMPATIVEL');
  });

  it('sem vaga PcD livre: 409 claro, sem indicar outro tipo; o pedido comum segue normal', async () => {
    for (const r of await regioes()) {
      if (r.vagas!.PCD.capacidade) await db.regiao.update({ where: { id: r.id }, data: { ocupadasPcd: r.vagas!.PCD.capacidade, ocupadas: r.ocupadas + r.vagas!.PCD.capacidade } });
    }
    const r = await entrar('PCD');
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe('SEM_REGIAO_ELEGIVEL');
    expect(r.json().erro.mensagem).toContain('Nenhuma vaga PcD disponível');
    expect(r.json().erro.detalhes.tipoVaga).toBe('PCD');
    expect((await entrar()).statusCode).toBe(201);
  });

  it('confirmações simultâneas nas últimas vagas PcD nunca passam da capacidade do tipo', async () => {
    const pcdN2 = (await regiao('N2')).vagas!.PCD.capacidade;
    const tickets = await Promise.all(Array.from({ length: pcdN2 + 4 }, () => entrar('PCD').then((r) => r.json().ticket.codigo as string)));
    const res = await Promise.all(tickets.map((c) => estacionar(c, 'N2')));
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(pcdN2);
    expect(res.filter((r) => r.statusCode === 409).every((r) => r.json().erro.codigo === 'REGIAO_LOTADA')).toBe(true);
    const n2 = await regiao('N2');
    expect(n2.vagas!.PCD.ocupadas).toBe(pcdN2);
    expect(n2.vagas!.COMUM.ocupadas).toBe(0); // os excedentes não "vazaram" para as comuns
  });

  it('ajuste do total pelo operador não invade as reservadas', async () => {
    const n1 = await regiao('N1');
    // capacidade menor que as reservadas: recusada com a explicação do tipo de vaga
    expect((await app.inject({ method: 'PATCH', headers: OP, url: '/api/regioes/N1', payload: { capacidade: 5 } })).json().erro.codigo).toBe('TIPO_VAGA_INCOMPATIVEL');
    expect((await app.inject({ method: 'PATCH', headers: OP, url: '/api/regioes/N1', payload: { ocupadas: n1.capacidade } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', headers: OP, url: '/api/regioes/N1', payload: { ocupadas: n1.vagas!.COMUM.capacidade } })).statusCode).toBe(200);
  });
});

describe('ajuste administrativo das vagas reservadas', () => {
  it('exige o token do operador', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/regioes/N1/vagas-reservadas', payload: { capacidadePcd: 1, capacidadeIdoso: 1 } })).statusCode).toBe(401);
  });

  it('altera as reservadas, mantém a soma e marca a fonte como operador; o resumo passa a alertar abaixo do mínimo', async () => {
    const r = await configurar('N3', 2, 5);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ fonteVagasReservadas: 'operador', vagas: { PCD: { capacidade: 2 }, IDOSO: { capacidade: 5 }, COMUM: { capacidade: 196 } } });
    const resumo = (await app.inject('/api/vagas-reservadas')).json();
    expect(resumo.alertas.map((a: { tipo: string }) => a.tipo)).toEqual(['PCD', 'IDOSO']);
    expect(coletor.eventos.some((e) => e.tipo === 'regiao:status' && e.entidadeId === 'N3')).toBe(true);
    // o seed (sem limpar) não desfaz o ajuste do operador
    await semear(db);
    expect((await regiao('N3')).vagas!.PCD.capacidade).toBe(2);
  });

  it('recusa reduzir abaixo do que está ocupado, passar da capacidade ou espremer as comuns ocupadas', async () => {
    const { ticket } = (await entrar('PCD')).json();
    await estacionar(ticket.codigo, 'N2');
    expect((await configurar('N2', 0, 0)).json().erro.mensagem).toMatch(/vaga PcD ocupada/);
    expect((await configurar('N2', 40, 40)).json().erro.codigo).toBe('TIPO_VAGA_INCOMPATIVEL');
    const n1 = await regiao('N1');
    await app.inject({ method: 'PATCH', headers: OP, url: '/api/regioes/N1', payload: { ocupadas: n1.vagas!.COMUM.capacidade } });
    expect((await configurar('N1', n1.vagas!.PCD.capacidade + 1, n1.vagas!.IDOSO.capacidade)).json().erro.mensagem).toMatch(/vagas comuns/);
    expect((await configurar('SS1M', 1, 0)).json().erro.codigo).toBe('TIPO_VAGA_INCOMPATIVEL');
  });
});

describe('QR Code', () => {
  it('o localizador mostra o tipo de vaga e o que a planta diz do caminho a pé, sem afirmar acessibilidade', async () => {
    const r = (await entrar('PCD')).json();
    const token = r.qrUrl.split('/t/')[1];
    const l = (await app.inject(`/api/localizador/${token}`)).json();
    expect(l.ticket.tipoVaga).toBe('PCD');
    expect(l.caminhoPedestre).toMatchObject({ validado: false });
    expect(l.orientacao.join(' ')).toContain('credencial');
    expect(l.rota.nos.length).toBeGreaterThan(1);
    const comum = (await app.inject(`/api/localizador/${(await entrar()).json().qrUrl.split('/t/')[1]}`)).json();
    expect(comum.caminhoPedestre).toBeNull();
  });
});

describe('simulador', () => {
  it('entrada manual PcD e pessoa idosa', async () => {
    await app.inject({ method: 'POST', headers: SIM, url: '/api/simulacao/iniciar', payload: { config: { modo: 'manual', entradasPorMinuto: 0 } } });
    const pcd = (await app.inject({ method: 'POST', headers: SIM, url: '/api/simulacao/eventos', payload: { acao: 'entrada', categoria: 'CARRO_GRANDE', tipoVaga: 'PCD' } })).json();
    expect(pcd.ticket.tipoVaga).toBe('PCD');
    const conf = (await app.inject({ method: 'POST', headers: SIM, url: '/api/simulacao/eventos', payload: { acao: 'confirmar', codigo: pcd.ticket.codigo } })).json();
    expect(conf.resultado).toBe('APLICADO');
    expect((await regiao(pcd.recomendacao.regiaoId)).vagas!.PCD.ocupadas).toBe(1);
    const sai = (await app.inject({ method: 'POST', headers: SIM, url: '/api/simulacao/eventos', payload: { acao: 'saida', codigo: pcd.ticket.codigo } })).json();
    expect(sai.resultado).toBe('APLICADO');
    expect((await regiao(pcd.recomendacao.regiaoId)).vagas!.PCD.ocupadas).toBe(0);
  });

  it('cenário F: PcD lotadas desde o início → pedido PcD sem ticket; reinício devolve as vagas por tipo', async () => {
    await app.inject({ method: 'POST', headers: SIM, url: '/api/simulacao/cenario', payload: { cenario: 'F' } });
    const rs = await regioes();
    for (const r of rs) expect(r.vagas!.PCD.livres).toBe(0);
    const pedido = await app.inject({ method: 'POST', headers: SIM, url: '/api/simulacao/eventos', payload: { acao: 'entrada', categoria: 'CARRO_PEQUENO', tipoVaga: 'PCD' } });
    expect(pedido.statusCode).toBe(409);
    await app.inject({ method: 'POST', headers: SIM, url: '/api/simulacao/eventos', payload: { acao: 'avancar', segundos: 600 } });
    for (const r of await regioes()) {
      for (const t of ['COMUM', 'PCD', 'IDOSO'] as const) expect(r.vagas![t].ocupadas).toBeLessThanOrEqual(r.vagas![t].capacidade);
    }
    await app.inject({ method: 'POST', headers: SIM, url: '/api/simulacao/reiniciar' });
    for (const r of await regioes()) expect(r.vagas).toMatchObject({ PCD: { ocupadas: 0 }, IDOSO: { ocupadas: 0 }, COMUM: { ocupadas: 0 } });
  });
});
