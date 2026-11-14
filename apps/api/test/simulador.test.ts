/**
 * Testes da Etapa 2 — simulador, sensores virtuais e tempo real.
 * Os blocos seguem a numeração dos 16 testes obrigatórios do enunciado.
 * O motor roda em modo passo a passo (sem timer): o relógio simulado só anda com `avancar`, o que torna tudo determinístico.
 */
import { PESOS_PADRAO, type EventoTempoReal, type Regiao } from '@parkvision/shared';
import { PrismaClient } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io as conectar, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.ts';
import { lerConfig } from '../src/config.ts';
import { semear } from '../src/seed.ts';
import { MotorSimulacao } from '../src/simulador/motor.ts';
import { emissorColetor, iniciarSocket, type Emissor } from '../src/tempo-real.ts';

const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TESTE! } } });
const TOKEN = 'token-teste';
const config = { ...lerConfig({}), simuladorToken: TOKEN, webUrl: 'http://web.teste' };
const coletor = emissorColetor();
/** Token do operador (rotas restritas desde a Etapa 4). */
const OP = { 'x-operador-token': 'token-teste' };
const app = criarApp({ db, emissor: coletor.emissor, config });
const H = { 'x-simulador-token': TOKEN };

// ── ajudantes ──
const regioes = async () => (await app.inject('/api/regioes')).json() as Regiao[];
const regiao = async (id: string) => (await regioes()).find((r) => r.id === id)!;
const totalOcupadas = async () => (await regioes()).reduce((s, r) => s + r.ocupadas, 0);
const sim = (url: string, payload?: object) => app.inject({ method: 'POST', url: `/api/simulacao/${url}`, headers: H, payload: payload ?? {} });
const manual = (payload: object) => sim('eventos', payload);
const sensor = (payload: object) => app.inject({ method: 'POST', url: '/api/sensores/eventos', headers: H, payload: { eventoId: randomUUID(), sensorId: 'TESTE', ...payload } });
const entradaSimulada = async (categoria = 'CARRO_PEQUENO', acessoId = 'A_NE') => (await manual({ acao: 'entrada', categoria, acessoId })).json();
const lotar = async (id: string, livres = 0) => {
  const r = await regiao(id);
  return app.inject({ method: 'PATCH', headers: OP, url: `/api/regioes/${id}`, payload: { ocupadas: r.capacidade - livres } });
};
/** Inicia em modo manual (sem chegadas automáticas) — o relógio só anda com `avancar`. */
const iniciarManual = () => sim('iniciar', { config: { modo: 'manual', entradasPorMinuto: 0 } });

/** Invariante: ocupação de cada região = veículos ESTACIONADOS nela, sempre entre 0 e a capacidade. */
async function conferirConsistencia() {
  const grupos = await db.ticket.groupBy({ by: ['regiaoEstacionadaId'], where: { status: 'ESTACIONADO' }, _count: true });
  const porRegiao = Object.fromEntries(grupos.map((g) => [g.regiaoEstacionadaId, g._count]));
  for (const r of await regioes()) {
    expect(r.ocupadas, `ocupação de ${r.id}`).toBe(porRegiao[r.id] ?? 0);
    expect(r.ocupadas).toBeGreaterThanOrEqual(0);
    expect(r.ocupadas).toBeLessThanOrEqual(r.capacidade);
    expect(r.livres).toBe(r.capacidade - r.ocupadas);
  }
}

beforeAll(async () => { await app.ready(); });
beforeEach(async () => {
  if (app.motor.status !== 'parado') await app.motor.encerrar();
  await semear(db, { limpar: true });
  coletor.eventos.length = 0;
});
afterAll(async () => { await app.close(); await db.$disconnect(); });

describe('1. entrada de veículos', () => {
  it('entrada simulada gera ticket marcado como simulado, com recomendação e evento no envelope padrão', async () => {
    const r = await entradaSimulada();
    expect(r.ticket).toMatchObject({ status: 'AGUARDANDO', categoria: 'CARRO_PEQUENO' });
    expect(r.recomendacao.regiaoId).toMatch(/\S/);
    expect((await db.ticket.findUnique({ where: { codigo: r.ticket.codigo } }))!.simulado).toBe(true);
    const ev = coletor.eventos.find((e) => e.tipo === 'veiculo:entrou')!;
    expect(ev).toMatchObject({ entidadeId: r.ticket.codigo, simulado: true });
    expect(ev.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(ev.ocorridoEm).toString()).not.toBe('Invalid Date');
  });

  it('chegadas automáticas respeitam a proporção de categorias configurada', async () => {
    await sim('iniciar', { config: { entradasPorMinuto: 20, tempoManobraSeg: 600, proporcaoCategorias: { CARRO_PEQUENO: 0, CARRO_GRANDE: 0, MOTO: 1 }, semente: 7 } });
    const estado = (await manual({ acao: 'avancar', segundos: 60 })).json();
    expect(estado.estatisticas.entradas).toBeGreaterThan(5);
    const tickets = await db.ticket.findMany({ where: { simulado: true } });
    expect(tickets.length).toBe(estado.estatisticas.entradas);
    expect(tickets.every((t) => t.categoria === 'MOTO' && t.regiaoRecomendadaId === 'SS1M')).toBe(true);
  });
});

describe('2. confirmação de estacionamento', () => {
  it('confirmar ocupa uma vaga na região e muda o ticket para ESTACIONADO', async () => {
    const { ticket, recomendacao } = await entradaSimulada();
    const antes = (await regiao(recomendacao.regiaoId)).ocupadas;
    const r = (await manual({ acao: 'confirmar', codigo: ticket.codigo })).json();
    expect(r).toMatchObject({ resultado: 'APLICADO', regiaoId: recomendacao.regiaoId });
    expect((await regiao(recomendacao.regiaoId)).ocupadas).toBe(antes + 1);
    expect((await db.ticket.findUnique({ where: { codigo: ticket.codigo } }))!.status).toBe('ESTACIONADO');
    expect(coletor.eventos.map((e) => e.tipo)).toEqual(expect.arrayContaining(['veiculo:estacionou', 'regiao:ocupacao', 'simulador:sensor']));
  });

  it('confirmação revalida a disponibilidade: região indisponível depois da recomendação é rejeitada', async () => {
    const { ticket, recomendacao } = await entradaSimulada();
    await manual({ acao: 'disponibilidade', regiaoId: recomendacao.regiaoId, disponivel: false });
    const r = (await manual({ acao: 'confirmar', codigo: ticket.codigo })).json();
    expect(r.resultado).toBe('REJEITADO_REGIAO_INDISPONIVEL');
    expect(r.novaRecomendacao.regiaoId).not.toBe(recomendacao.regiaoId);
    expect(await totalOcupadas()).toBe(0);
  });
});

describe('3. saída de veículos', () => {
  it('saída libera a vaga na mesma região em que o veículo estava', async () => {
    const { ticket, recomendacao } = await entradaSimulada();
    await manual({ acao: 'confirmar', codigo: ticket.codigo });
    const r = (await manual({ acao: 'saida', codigo: ticket.codigo })).json();
    expect(r).toMatchObject({ resultado: 'APLICADO', regiaoId: recomendacao.regiaoId });
    expect((await regiao(recomendacao.regiaoId)).ocupadas).toBe(0);
    expect((await db.ticket.findUnique({ where: { codigo: ticket.codigo } }))!.status).toBe('SAIU');
    expect(coletor.eventos.map((e) => e.tipo)).toContain('veiculo:saiu');
  });
});

describe('4. atualização correta da ocupação', () => {
  it('após uma simulação automática com falhas e duplicidades, a ocupação bate com os veículos estacionados', async () => {
    await sim('iniciar', {
      config: {
        entradasPorMinuto: 10, permanenciaMediaMin: 4, tempoManobraSeg: 40, chanceIgnorarRecomendacao: 0.3,
        chanceEventoDuplicado: 0.3, chanceFalhaSensorPorMin: 0.3, semente: 99,
      },
    });
    const estado = (await manual({ acao: 'avancar', segundos: 12 * 60 })).json();
    expect(estado.estatisticas.confirmacoes).toBeGreaterThan(50);
    expect(estado.estatisticas.saidas).toBeGreaterThan(20);
    expect(estado.estatisticas.duplicadosIgnorados).toBeGreaterThan(0);
    await conferirConsistencia();
    const ind = (await app.inject('/api/indicadores')).json();
    expect(ind.ocupadas).toBe(await totalOcupadas());
    expect(ind.ocupadas).toBe(estado.estatisticas.confirmacoes - estado.estatisticas.saidas);
  });
});

describe('5. rejeição de estacionamento em região cheia', () => {
  it('região que lotou entre a recomendação e a confirmação rejeita e gera nova recomendação', async () => {
    const { ticket, recomendacao } = await entradaSimulada();
    await lotar(recomendacao.regiaoId);
    const cheia = await regiao(recomendacao.regiaoId);
    const r = (await manual({ acao: 'confirmar', codigo: ticket.codigo })).json();
    expect(r.resultado).toBe('REJEITADO_REGIAO_LOTADA');
    expect(r.novaRecomendacao.regiaoId).not.toBe(recomendacao.regiaoId);
    expect((await regiao(recomendacao.regiaoId)).ocupadas).toBe(cheia.capacidade);
    expect(coletor.eventos.map((e) => e.tipo)).toEqual(expect.arrayContaining(['simulador:alerta', 'veiculo:recomendado']));
    // o ticket continua aguardando e agora confirma na nova região
    const ok = (await manual({ acao: 'confirmar', codigo: ticket.codigo })).json();
    expect(ok).toMatchObject({ resultado: 'APLICADO', regiaoId: r.novaRecomendacao.regiaoId });
    expect(await db.recomendacao.count({ where: { ticket: { codigo: ticket.codigo } } })).toBe(2);
  });

  it('pela API REST a confirmação em região cheia responde 409 e o ticket pode pedir nova recomendação', async () => {
    const { ticket, recomendacao } = (await app.inject({ method: 'POST', url: '/api/entradas', payload: { acessoId: 'A_NE', categoria: 'CARRO_PEQUENO' } })).json();
    await lotar(recomendacao.regiaoId);
    const r = await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/estacionar` });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe('REGIAO_LOTADA');
    const nova = (await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${ticket.codigo}/recomendacao` })).json();
    expect(nova.recomendacao.regiaoId).not.toBe(recomendacao.regiaoId);
    expect(nova.ticket.regiaoRecomendadaId).toBe(nova.recomendacao.regiaoId);
  });
});

describe('6. recomendação não altera a ocupação', () => {
  it('20 entradas e novas recomendações não ocupam nenhuma vaga (sem reserva temporária)', async () => {
    const codigos: string[] = [];
    for (let i = 0; i < 20; i++) codigos.push((await entradaSimulada(i % 3 === 0 ? 'MOTO' : 'CARRO_GRANDE')).ticket.codigo);
    await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${codigos[1]}/recomendacao` });
    expect(await totalOcupadas()).toBe(0);
    expect(await db.eventoOcupacao.count()).toBe(0);
    expect((await app.inject('/api/indicadores')).json()).toMatchObject({ ocupadas: 0, veiculosAguardando: 20 });
  });
});

describe('7. rejeição de saída duplicada', () => {
  it('a segunda saída, a saída de quem não estacionou e a saída em outra região são rejeitadas', async () => {
    const a = await entradaSimulada();
    await manual({ acao: 'confirmar', codigo: a.ticket.codigo, regiaoId: 'N1' });
    const errada = (await sensor({ tipo: 'VAGA_LIBERADA', regiaoId: 'N2', ticketCodigo: a.ticket.codigo })).json();
    expect(errada.resultado).toBe('REJEITADO_TRANSICAO_INVALIDA');
    expect((await regiao('N1')).ocupadas).toBe(1);

    expect((await sensor({ tipo: 'VAGA_LIBERADA', regiaoId: 'N1', ticketCodigo: a.ticket.codigo })).json().resultado).toBe('APLICADO');
    expect((await sensor({ tipo: 'VAGA_LIBERADA', regiaoId: 'N1', ticketCodigo: a.ticket.codigo })).json().resultado).toBe('REJEITADO_TRANSICAO_INVALIDA');
    expect((await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${a.ticket.codigo}/saida` })).statusCode).toBe(409);

    const b = await entradaSimulada();
    expect((await manual({ acao: 'saida', codigo: b.ticket.codigo })).json().resultado).toBe('REJEITADO_TRANSICAO_INVALIDA');
    expect(await totalOcupadas()).toBe(0);
  });
});

describe('8. ocupação nunca fica negativa', () => {
  it('saída em região já zerada é recusada e a ocupação continua em zero', async () => {
    const { ticket } = await entradaSimulada();
    await manual({ acao: 'confirmar', codigo: ticket.codigo, regiaoId: 'S1' });
    await app.inject({ method: 'PATCH', headers: OP, url: '/api/regioes/S1', payload: { ocupadas: 0 } }); // ajuste manual inconsistente
    const r = (await manual({ acao: 'saida', codigo: ticket.codigo })).json();
    expect(r.resultado).toBe('REJEITADO_DADOS_INVALIDOS');
    expect((await regiao('S1')).ocupadas).toBe(0);
    expect((await app.inject({ method: 'PATCH', headers: OP, url: '/api/regioes/S1', payload: { ocupadas: -1 } })).statusCode).toBe(400);
    expect((await regioes()).every((x) => x.ocupadas >= 0 && x.livres >= 0)).toBe(true);
  });
});

describe('9. capacidade nunca é ultrapassada', () => {
  it('leituras simultâneas de vaga ocupada numa região com 3 vagas confirmam exatamente 3', async () => {
    await lotar('S2', 3);
    const tickets = await Promise.all(Array.from({ length: 10 }, () => entradaSimulada().then((r) => r.ticket.codigo as string)));
    const res = await Promise.all(tickets.map((c) => sensor({ tipo: 'VAGA_OCUPADA', regiaoId: 'S2', ticketCodigo: c }).then((r) => r.json().resultado)));
    expect(res.filter((x) => x === 'APLICADO')).toHaveLength(3);
    expect(res.filter((x) => x === 'REJEITADO_REGIAO_LOTADA')).toHaveLength(7);
    const s2 = await regiao('S2');
    expect(s2.ocupadas).toBe(s2.capacidade);
  });
});

describe('10. sensores simulados', () => {
  it('falha de comunicação tira a região da recomendação; normalização devolve', async () => {
    await lotar('N3'); await lotar('N2'); // deixa SS1 como melhor opção do acesso nordeste
    expect((await entradaSimulada()).recomendacao.regiaoId).toBe('SS1');
    expect((await sensor({ tipo: 'SEM_COMUNICACAO', regiaoId: 'SS1' })).json().resultado).toBe('APLICADO');
    expect((await regiao('SS1')).statusSensores).toBe('sem-comunicacao');
    const r = (await entradaSimulada()).recomendacao;
    expect(r.regiaoId).not.toBe('SS1');
    expect(r.avaliacoes.find((a: { regiaoId: string }) => a.regiaoId === 'SS1').motivo).toBe('DADOS_INVALIDOS');
    await sensor({ tipo: 'SENSOR_NORMALIZADO', regiaoId: 'SS1' });
    expect((await entradaSimulada()).recomendacao.regiaoId).toBe('SS1');
  });

  it('indisponibilidade simulada não sobrescreve o estado do operador; leitura sem ticket não mexe na ocupação', async () => {
    await sensor({ tipo: 'DISPONIBILIDADE', regiaoId: 'N1', disponivel: false });
    expect((await regiao('N1')).operacional).toBe(false);
    expect((await db.regiao.findUnique({ where: { id: 'N1' } }))!.operacional).toBe(true); // estado do operador intacto
    expect((await sensor({ tipo: 'VAGA_OCUPADA', regiaoId: 'N2' })).json().resultado).toBe('IGNORADO_SEM_TICKET');
    expect(await totalOcupadas()).toBe(0);
  });

  it('endpoint de sensores exige o token e valida o formato', async () => {
    const semToken = await app.inject({ method: 'POST', url: '/api/sensores/eventos', payload: { eventoId: randomUUID(), sensorId: 'X', tipo: 'SEM_COMUNICACAO', regiaoId: 'N1' } });
    expect(semToken.statusCode).toBe(401);
    expect(semToken.json().erro.codigo).toBe('NAO_AUTORIZADO');
    expect((await sensor({ tipo: 'QUEBRADO', regiaoId: 'N1' })).statusCode).toBe(400);
    expect((await sensor({ tipo: 'SEM_COMUNICACAO', regiaoId: 'ZZ' })).statusCode).toBe(404);
  });
});

describe('11. proteção contra eventos duplicados', () => {
  it('o mesmo eventoId (em sequência ou simultâneo) só é aplicado uma vez', async () => {
    const { ticket } = await entradaSimulada();
    const eventoId = randomUUID();
    const corpo = { eventoId, tipo: 'VAGA_OCUPADA', regiaoId: 'N1', ticketCodigo: ticket.codigo };
    const res = await Promise.all([sensor(corpo), sensor(corpo), sensor(corpo)]);
    const resultados = res.map((r) => r.json().resultado).sort();
    expect(resultados).toEqual(['APLICADO', 'DUPLICADO', 'DUPLICADO']);
    expect((await sensor(corpo)).json()).toMatchObject({ resultado: 'DUPLICADO', resultadoOriginal: 'APLICADO' });
    expect((await regiao('N1')).ocupadas).toBe(1);
    expect(await db.eventoSensor.count({ where: { eventoId } })).toBe(1);
  });
});

describe('12. fluxo e congestionamento', () => {
  it('congestionamento medido pelos sensores muda a recomendação sem alterar os pesos e expira sozinho', async () => {
    await iniciarManual();
    const normal = (await entradaSimulada()).recomendacao;
    expect(normal.regiaoId).toBe('SS1');
    await manual({ acao: 'fluxo', regiaoId: 'SS1', veiculosEmCirculacao: 40, duracaoMin: 60 });
    const ss1 = await regiao('SS1');
    expect(ss1.fluxo).toMatchObject({ nivel: 'elevado' });
    expect(ss1.fluxo!.recente).toBeGreaterThanOrEqual(40);
    expect(coletor.eventos.map((e) => e.tipo)).toContain('regiao:fluxo');
    const congestionado = (await entradaSimulada()).recomendacao;
    expect(congestionado.regiaoId).not.toBe('SS1');
    expect(congestionado.pesos).toEqual(PESOS_PADRAO);
    await manual({ acao: 'avancar', segundos: 61 * 60 }); // a medição vence e a janela de recomendações passa
    expect((await regiao('SS1')).fluxo).toMatchObject({ nivel: 'baixo' });
    expect((await entradaSimulada()).recomendacao.regiaoId).toBe('SS1');
  });
});

describe('13. pausa e retomada', () => {
  it('controla o ciclo de vida e recusa transições inválidas', async () => {
    expect((await sim('pausar')).statusCode).toBe(409);
    expect((await sim('iniciar')).json().status).toBe('rodando');
    expect((await sim('iniciar')).json().erro.codigo).toBe('SIMULACAO_ESTADO_INVALIDO');
    expect((await sim('pausar')).json().status).toBe('pausado');
    expect((await sim('retomar')).json().status).toBe('rodando');
    expect((await sim('encerrar')).json().status).toBe('parado');
    expect((await app.inject({ method: 'POST', url: '/api/simulacao/iniciar' })).statusCode).toBe(401);
    expect(coletor.eventos.filter((e) => e.tipo === 'simulador:estado').map((e) => (e.dados as { acao: string }).acao))
      .toEqual(['iniciado', 'pausado', 'retomado', 'encerrado']);
  });

  it('no modo automático o relógio simulado congela na pausa e volta a andar na retomada', async () => {
    const motor = new MotorSimulacao({ db, emissor: emissorColetor().emissor, config }, { automatico: true, tickMs: 20 });
    try {
      await motor.iniciar({ config: { modo: 'manual', entradasPorMinuto: 0, velocidade: 600 } });
      await esperar(150);
      expect(motor.estadoAtual().decorridoSimuladoSeg).toBeGreaterThan(0); // andou sozinho (timer × velocidade)
      await motor.pausar();
      const pausado = motor.estadoAtual().relogioSimulado;
      await esperar(150);
      expect(motor.estadoAtual().relogioSimulado).toBe(pausado);
      await motor.retomar();
      await esperar(150);
      expect(motor.estadoAtual().relogioSimulado).toBeGreaterThan(pausado);
      await motor.configurar({ velocidade: 1 });
      expect(motor.estadoAtual().velocidade).toBe(1);
    } finally {
      if (motor.status !== 'parado') await motor.encerrar();
    }
  });
});

describe('14. reinicialização segura', () => {
  it('apaga só o que é simulado e preserva tickets reais, ocupação real e ajustes do operador', async () => {
    // dados reais
    const real = (await app.inject({ method: 'POST', url: '/api/entradas', payload: { acessoId: 'A_S1', categoria: 'CARRO_PEQUENO' } })).json();
    await app.inject({ method: 'POST', headers: OP, url: `/api/tickets/${real.ticket.codigo}/estacionar`, payload: { regiaoId: 'S1' } });
    await app.inject({ method: 'PATCH', headers: OP, url: '/api/regioes/N2', payload: { ocupadas: 10 } });
    await app.inject({ method: 'PATCH', headers: OP, url: '/api/regioes/S2', payload: { operacional: false } });
    // simulação com preenchimento, bloqueio, falha de sensor e fluxo
    await sim('cenario', { cenario: 'A' });
    await manual({ acao: 'disponibilidade', regiaoId: 'N3', disponivel: false });
    await manual({ acao: 'sensor', regiaoId: 'SS1', status: 'inconsistente' });
    await manual({ acao: 'fluxo', regiaoId: 'N1', veiculosEmCirculacao: 30, duracaoMin: 30 });
    await manual({ acao: 'avancar', segundos: 5 * 60 });
    expect(await db.ticket.count({ where: { simulado: true } })).toBeGreaterThan(300);
    expect((await app.inject('/api/simulacao')).json().veiculosSimuladosAtivos).toBeGreaterThan(300);

    const r = (await sim('reiniciar')).json();
    expect(r.removidos.tickets).toBeGreaterThan(300);
    expect(r.estado.status).toBe('parado');
    expect(await db.ticket.count({ where: { simulado: true } })).toBe(0);
    expect(await db.eventoSensor.count({ where: { simulado: true } })).toBe(0);
    expect(await db.eventoOcupacao.count({ where: { simulado: true } })).toBe(0);
    const rs = await regioes();
    const por = (id: string) => rs.find((x) => x.id === id)!;
    expect(por('S1').ocupadas).toBe(1);           // ticket real
    expect(por('N2').ocupadas).toBe(10);          // ajuste do operador
    expect(por('S2').operacional).toBe(false);    // decisão do operador
    expect(por('N3').operacional).toBe(true);     // bloqueio simulado desfeito
    expect(por('SS1').statusSensores).toBe('ok');
    expect(por('N1').fluxo!.recente).toBe(0);
    expect(rs.reduce((s, x) => s + x.ocupadas, 0)).toBe(11);
    expect((await db.ticket.findUnique({ where: { codigo: real.ticket.codigo } }))!.status).toBe('ESTACIONADO');
    // o simulador não opera tickets reais
    expect((await manual({ acao: 'saida', codigo: real.ticket.codigo })).json().erro.codigo).toBe('DADOS_INVALIDOS');
  });
});

describe('15. eventos em tempo real (Socket.IO)', () => {
  it('o painel recebe os eventos no envelope padrão e o namespace do simulador exige token', async () => {
    let destino: Emissor = { emitir() {} };
    const appRT = criarApp({ db, config, emissor: { emitir: (t, e, d, s) => destino.emitir(t, e, d, s) } });
    await appRT.listen({ port: 0, host: '127.0.0.1' });
    const rt = iniciarSocket(appRT.server, { simuladorToken: TOKEN, origemWeb: '*' });
    destino = rt.emissor;
    const url = `http://127.0.0.1:${(appRT.server.address() as AddressInfo).port}`;
    const sockets: Socket[] = [];
    try {
      const painel = conectar(`${url}/painel`, { transports: ['websocket'] });
      sockets.push(painel);
      await new Promise<void>((ok, erro) => { painel.on('connect', () => ok()); painel.on('connect_error', erro); });
      const recebido = new Promise<EventoTempoReal>((ok) => painel.on('veiculo:entrou', ok));
      const agregado = new Promise<EventoTempoReal>((ok) => painel.on('evento', (ev: EventoTempoReal) => { if (ev.tipo === 'veiculo:entrou') ok(ev); }));

      const res = await appRT.inject({ method: 'POST', url: '/api/simulacao/eventos', headers: H, payload: { acao: 'entrada', categoria: 'MOTO' } });
      const ev = await recebido;
      expect(ev).toMatchObject({ tipo: 'veiculo:entrou', entidadeId: res.json().ticket.codigo, simulado: true });
      expect(ev.id).toMatch(/^[0-9a-f-]{36}$/);
      expect((ev.dados as { recomendacao: { regiaoId: string } }).recomendacao.regiaoId).toBe('SS1M');
      expect((await agregado).id).toBe(ev.id);

      const invasor = conectar(`${url}/simulador`, { transports: ['websocket'], auth: { token: 'errado' } });
      sockets.push(invasor);
      await expect(new Promise((ok, erro) => { invasor.on('connect', () => ok(null)); invasor.on('connect_error', erro); })).rejects.toThrow();

      const simulador = conectar(`${url}/simulador`, { transports: ['websocket'], auth: { token: TOKEN } });
      sockets.push(simulador);
      await new Promise<void>((ok) => simulador.on('connect', () => ok()));
      const estado = new Promise<EventoTempoReal>((ok) => simulador.on('simulador:estado', ok));
      await appRT.inject({ method: 'POST', url: '/api/simulacao/iniciar', headers: H, payload: { config: { modo: 'manual' } } });
      expect(await estado).toMatchObject({ tipo: 'simulador:estado', entidadeId: 'simulador', simulado: true, dados: { acao: 'iniciado', status: 'rodando' } });
    } finally {
      sockets.forEach((s) => s.close());
      if (appRT.motor.status !== 'parado') await appRT.motor.encerrar();
      await new Promise((ok) => rt.io.close(() => ok(null)));
      await appRT.close().catch(() => {});
    }
  });
});

describe('16. cenários predefinidos', () => {
  it('lista os cenários disponíveis para o painel', async () => {
    const lista = (await app.inject('/api/simulacao/cenarios')).json();
    expect(lista.map((c: { id: string }) => c.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(lista[0]).toMatchObject({ nome: 'Movimento tranquilo', ocupacaoInicial: 0.3 });
  });

  const ocupacaoDe = (rs: Regiao[], id: string) => rs.find((r) => r.id === id)!;

  it('A — tranquilo: 30% de ocupação inicial e distribuição consistente', async () => {
    const e = (await sim('cenario', { cenario: 'A' })).json();
    expect(e).toMatchObject({ status: 'rodando', cenario: 'A' });
    const rs = await regioes();
    for (const r of rs) expect(r.ocupadas).toBe(Math.round(r.capacidade * 0.3));
    // painéis abertos recebem a ocupação inicial do cenário em tempo real
    const ultimaN3 = coletor.eventos.filter((ev) => ev.tipo === 'regiao:ocupacao' && ev.entidadeId === 'N3').at(-1)!;
    expect((ultimaN3.dados as Regiao).ocupadas).toBe(Math.round(203 * 0.3));
    await manual({ acao: 'avancar', segundos: 10 * 60 });
    await conferirConsistencia();
  });

  it('B — pico: 55% de ocupação inicial e muitas chegadas', async () => {
    await sim('cenario', { cenario: 'B' });
    for (const r of await regioes()) expect(r.ocupadas).toBe(Math.round(r.capacidade * 0.55));
    const e = (await manual({ acao: 'avancar', segundos: 3 * 60 })).json();
    expect(e.estatisticas.entradas).toBeGreaterThan(50);
    await conferirConsistencia();
  });

  it('C — região lotada: N3 e N2 cheias nunca são recomendadas e tentativas nelas são rejeitadas', async () => {
    await sim('cenario', { cenario: 'C' });
    const rs = await regioes();
    expect(ocupacaoDe(rs, 'N3').livres).toBe(0);
    expect(ocupacaoDe(rs, 'N2').livres).toBe(0);
    const e = (await manual({ acao: 'avancar', segundos: 15 * 60 })).json();
    const recomendadasCheias = await db.recomendacao.count({ where: { regiaoId: { in: ['N3', 'N2'] }, ticket: { simulado: true } } });
    const cheiasAgora = (await regioes()).filter((r) => ['N3', 'N2'].includes(r.id) && r.livres === 0).length;
    if (cheiasAgora === 2) expect(recomendadasCheias).toBe(0);
    expect(e.estatisticas.rejeicoesLotada).toBeGreaterThan(0);
    expect(e.estatisticas.novasRecomendacoes).toBeGreaterThan(0);
    await conferirConsistencia();
  });

  it('D — congestionamento: SS1 com fluxo elevado deixa de ser a recomendação do acesso nordeste', async () => {
    await sim('cenario', { cenario: 'D' });
    expect((await regiao('SS1')).fluxo).toMatchObject({ nivel: 'elevado' });
    const r = (await entradaSimulada('CARRO_PEQUENO', 'A_NE')).recomendacao;
    expect(r.regiaoId).not.toBe('SS1');
    expect(r.pesos).toEqual(PESOS_PADRAO);
  });

  it('E — indisponibilidade: N3 fora até 15 min e S1 sem comunicação entre 5 e 20 min', async () => {
    await sim('cenario', { cenario: 'E' });
    expect((await regiao('N3')).operacional).toBe(false);
    await manual({ acao: 'avancar', segundos: 6 * 60 });
    expect((await regiao('S1')).statusSensores).toBe('sem-comunicacao');
    await manual({ acao: 'avancar', segundos: 10 * 60 });
    expect((await regiao('N3')).operacional).toBe(true);
    await manual({ acao: 'avancar', segundos: 5 * 60 });
    expect((await regiao('S1')).statusSensores).toBe('ok');
    const recsEmN3 = await db.recomendacao.findMany({ where: { regiaoId: 'N3' }, select: { criadaEm: true } });
    const inicio = new Date(app.motor.estadoAtual().relogioSimulado - 21 * 60_000).getTime();
    expect(recsEmN3.every((x) => x.criadaEm.getTime() >= inicio + 15 * 60_000)).toBe(true);
    await conferirConsistencia();
  });

  it('cenários são reproduzíveis: mesma semente e mesmos passos dão o mesmo resultado', async () => {
    const rodar = async () => {
      await sim('cenario', { cenario: 'C' });
      const e = (await manual({ acao: 'avancar', segundos: 8 * 60 })).json();
      return { estatisticas: e.estatisticas, ocupacao: (await regioes()).map((r) => `${r.id}:${r.ocupadas}`) };
    };
    const primeira = await rodar();
    const segunda = await rodar();
    expect(segunda).toEqual(primeira);
  });
});

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
