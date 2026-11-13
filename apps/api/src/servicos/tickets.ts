/**
 * Entradas, recomendações, confirmação de estacionamento e saída.
 * Regra central: a recomendação NÃO altera a ocupação; só a confirmação (+1) e a saída (−1).
 */
import { recomendar } from '@parkvision/core';
import { mapaCapimDourado, type AvaliacaoRegiao, type Categoria, type NovaEntrada, type Pesos, type Recomendacao, type Regiao, type Rota, type Ticket } from '@parkvision/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { vazaoReferencia, type Config } from '../config.ts';
import { ErroApi } from '../erros.ts';
import type { Emissor } from '../tempo-real.ts';
import { buscarRegiao, calcularIndicadores, listarRegioes } from './regioes.ts';

type TicketDb = Prisma.TicketGetPayload<object>;
type RecomendacaoDb = Prisma.RecomendacaoGetPayload<{ include: { ticket: true } }>;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const codigoTicket = (n: number) => `PV-${String(n).padStart(4, '0')}`;

export function ticketDto(t: TicketDb): Ticket {
  return {
    codigo: t.codigo,
    categoria: t.categoria as Categoria,
    acessoId: t.acessoId,
    placa: t.placa,
    entradaEm: t.entradaEm.toISOString(),
    regiaoRecomendadaId: t.regiaoRecomendadaId,
    regiaoEstacionadaId: t.regiaoEstacionadaId,
    estacionadoEm: t.estacionadoEm?.toISOString() ?? null,
    saidaEm: t.saidaEm?.toISOString() ?? null,
    status: t.status,
  };
}

export function recomendacaoDto(r: RecomendacaoDb): Recomendacao {
  return {
    id: r.id,
    ticketCodigo: r.ticket.codigo,
    regiaoId: r.regiaoId,
    score: r.score,
    pesos: r.pesos as unknown as Pesos,
    avaliacoes: r.avaliacoes as unknown as AvaliacaoRegiao[],
    justificativa: r.justificativa,
    rota: r.rota as unknown as Rota,
    criadaEm: r.criadaEm.toISOString(),
  };
}

/** Recomendações dos últimos N ms por região (critério de fluxo). */
async function fluxoRecente(db: PrismaClient | Prisma.TransactionClient, janelaMs: number) {
  const grupos = await db.recomendacao.groupBy({ by: ['regiaoId'], where: { criadaEm: { gte: new Date(Date.now() - janelaMs) } }, _count: true });
  return Object.fromEntries(grupos.map((g) => [g.regiaoId, g._count]));
}

export interface Dependencias { db: PrismaClient; emissor: Emissor; config: Config }

/** Totem (ou simulador): registra a entrada, recomenda a região e emite o ticket. */
export async function registrarEntrada({ db, emissor, config }: Dependencias, entrada: NovaEntrada, origem = 'totem') {
  const acesso = await db.acesso.findUnique({ where: { id: entrada.acessoId } });
  if (!acesso) throw new ErroApi('ACESSO_NAO_ENCONTRADO', `Acesso ${entrada.acessoId} não existe`);

  const regioes = await listarRegioes(db);
  const resultado = recomendar({
    categoria: entrada.categoria,
    acessoNo: acesso.noMapa,
    regioes,
    fluxoRecente: await fluxoRecente(db, config.janelaFluxoMs),
    vazaoReferencia: Object.fromEntries(regioes.map((r) => [r.id, vazaoReferencia(r.capacidade)])),
    mapa: mapaCapimDourado,
    agora: new Date(),
    validadeDadosMs: config.validadeDadosMs,
  });
  if (resultado.tipo === 'SEM_REGIAO') {
    throw new ErroApi('SEM_REGIAO_ELEGIVEL', resultado.justificativa, { avaliacoes: resultado.avaliacoes });
  }

  const token = randomBytes(16).toString('base64url');
  const criado = await db.$transaction(async (tx) => {
    const provisorio = await tx.ticket.create({
      data: {
        codigo: `TMP-${token}`,
        tokenHash: hashToken(token),
        categoria: entrada.categoria,
        acessoId: acesso.id,
        placa: entrada.placa ?? null,
        regiaoRecomendadaId: resultado.regiaoId,
      },
    });
    const ticket = await tx.ticket.update({ where: { numero: provisorio.numero }, data: { codigo: codigoTicket(provisorio.numero) } });
    const rec = await tx.recomendacao.create({
      data: {
        ticketNumero: ticket.numero,
        regiaoId: resultado.regiaoId,
        score: resultado.score,
        pesos: resultado.pesos as unknown as Prisma.InputJsonValue,
        avaliacoes: resultado.avaliacoes as unknown as Prisma.InputJsonValue,
        justificativa: resultado.justificativa,
        rota: resultado.rota as unknown as Prisma.InputJsonValue,
      },
      include: { ticket: true },
    });
    return { ticket, rec };
  });

  const ticket = ticketDto(criado.ticket), recomendacao = recomendacaoDto(criado.rec);
  emissor.emitir('ticket:criado', { ticket, recomendacao });
  emissor.emitir('indicadores:atualizados', await calcularIndicadores(db));
  void origem;
  return { ticket, recomendacao, qrUrl: `${config.webUrl}/t/${token}` };
}

async function buscarTicket(db: PrismaClient | Prisma.TransactionClient, codigo: string) {
  const t = await db.ticket.findUnique({ where: { codigo } });
  if (!t) throw new ErroApi('TICKET_NAO_ENCONTRADO', `Ticket ${codigo} não encontrado`);
  return t;
}

/** Confirmação de estacionamento: a ocupação só sobe aqui. */
export async function estacionar({ db, emissor }: Dependencias, codigo: string, regiaoId?: string, origem = 'operador') {
  const resultado = await db.$transaction(async (tx) => {
    const t = await buscarTicket(tx, codigo);
    if (t.status !== 'AGUARDANDO') throw new ErroApi('TRANSICAO_INVALIDA', `Ticket ${codigo} está ${t.status}; só tickets AGUARDANDO podem ser estacionados`);
    const destino = regiaoId ?? t.regiaoRecomendadaId;
    const regiao = await buscarRegiao(tx, destino);
    if (!regiao.categorias.includes(t.categoria as Categoria)) throw new ErroApi('CATEGORIA_INCOMPATIVEL', `Região ${destino} não aceita ${t.categoria}`);
    // incremento atômico condicionado: nunca passa da capacidade, mesmo com confirmações simultâneas
    const r = await tx.regiao.updateMany({ where: { id: destino, ocupadas: { lt: regiao.capacidade } }, data: { ocupadas: { increment: 1 } } });
    if (r.count === 0) throw new ErroApi('REGIAO_LOTADA', `Região ${destino} está lotada`);
    await tx.eventoOcupacao.create({ data: { regiaoId: destino, tipo: 'ENTRADA_VAGA', origem, ticketNumero: t.numero } });
    const ticket = await tx.ticket.update({ where: { numero: t.numero }, data: { status: 'ESTACIONADO', regiaoEstacionadaId: destino, estacionadoEm: new Date() } });
    return { ticket: ticketDto(ticket), regiao: await buscarRegiao(tx, destino) };
  });
  emissor.emitir('ticket:estacionado', resultado);
  emissor.emitir('regiao:atualizada', resultado.regiao);
  emissor.emitir('indicadores:atualizados', await calcularIndicadores(db));
  return resultado;
}

/** Saída: libera a vaga (se o carro chegou a estacionar). */
export async function registrarSaida({ db, emissor }: Dependencias, codigo: string, origem = 'operador') {
  const resultado = await db.$transaction(async (tx) => {
    const t = await buscarTicket(tx, codigo);
    if (t.status === 'SAIU' || t.status === 'CANCELADO') throw new ErroApi('TRANSICAO_INVALIDA', `Ticket ${codigo} já está ${t.status}`);
    let regiao: Regiao | null = null;
    if (t.status === 'ESTACIONADO' && t.regiaoEstacionadaId) {
      await tx.regiao.updateMany({ where: { id: t.regiaoEstacionadaId, ocupadas: { gt: 0 } }, data: { ocupadas: { decrement: 1 } } });
      await tx.eventoOcupacao.create({ data: { regiaoId: t.regiaoEstacionadaId, tipo: 'SAIDA_VAGA', origem, ticketNumero: t.numero } });
      regiao = await buscarRegiao(tx, t.regiaoEstacionadaId);
    }
    const ticket = await tx.ticket.update({ where: { numero: t.numero }, data: { status: 'SAIU', saidaEm: new Date() } });
    return { ticket: ticketDto(ticket), regiao };
  });
  emissor.emitir('ticket:saida', resultado);
  if (resultado.regiao) emissor.emitir('regiao:atualizada', resultado.regiao);
  emissor.emitir('indicadores:atualizados', await calcularIndicadores(db));
  return resultado;
}

export async function listarTickets(db: PrismaClient, filtro: { status?: Ticket['status']; limite: number }) {
  const lista = await db.ticket.findMany({ where: filtro.status ? { status: filtro.status } : {}, orderBy: { numero: 'desc' }, take: filtro.limite });
  return lista.map(ticketDto);
}

export async function listarRecomendacoes(db: PrismaClient, limite: number) {
  const lista = await db.recomendacao.findMany({ orderBy: { criadaEm: 'desc' }, take: limite, include: { ticket: true } });
  return lista.map(recomendacaoDto);
}

/** Localizador (QR Code): resumo do ticket sem dados pessoais. */
export async function localizar(db: PrismaClient, token: string) {
  const t = await db.ticket.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!t) throw new ErroApi('TICKET_NAO_ENCONTRADO', 'Ticket não encontrado. Confira o QR Code ou procure o atendimento.');
  const recomendada = await buscarRegiao(db, t.regiaoRecomendadaId);
  const regiao = t.regiaoEstacionadaId ? await buscarRegiao(db, t.regiaoEstacionadaId) : null;
  const referencia = (id: string) => mapaCapimDourado.regioes.find((r) => r.id === id)?.referencia ?? '';
  const orientacao = regiao
    ? [`Seu carro está na região ${regiao.id} (${regiao.nome}).`, referencia(regiao.id)]
    : [`O estacionamento ainda não foi confirmado. A região recomendada foi ${recomendada.id} (${recomendada.nome}).`, referencia(recomendada.id)];
  return {
    ticket: { codigo: t.codigo, entradaEm: t.entradaEm.toISOString(), status: t.status, categoria: t.categoria },
    regiao,
    recomendada,
    orientacao: orientacao.filter(Boolean),
  };
}
