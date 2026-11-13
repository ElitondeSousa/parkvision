/**
 * Entradas, recomendações, confirmação de estacionamento, saída e cancelamento.
 * Regras: a recomendação NÃO altera a ocupação; só a confirmação (+1) e a saída (−1), sempre com validação no banco.
 * `opcoes.simulado` marca os registros do simulador; `opcoes.agora` permite o relógio acelerado da simulação.
 */
import { recomendar } from '@parkvision/core';
import { mapaCapimDourado, type AvaliacaoRegiao, type Categoria, type NovaEntrada, type Pesos, type Recomendacao, type Regiao, type Rota, type Ticket } from '@parkvision/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { vazaoReferencia, type Config } from '../config.ts';
import { ErroApi } from '../erros.ts';
import type { Emissor } from '../tempo-real.ts';
import { buscarRegiao, calcularIndicadores, fluxoPorRegiao, JANELA_FLUXO_MS, listarRegioes } from './regioes.ts';

type Db = PrismaClient | Prisma.TransactionClient;
type TicketDb = Prisma.TicketGetPayload<object>;
type RecomendacaoDb = Prisma.RecomendacaoGetPayload<{ include: { ticket: true } }>;

export interface Dependencias { db: PrismaClient; emissor: Emissor; config: Config }
export interface Opcoes { simulado?: boolean; agora?: Date; origem?: string; janelaFluxoMs?: number }

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

/** Roda o algoritmo com o estado atual do banco (ocupação, fluxo e sensores). */
async function calcularRecomendacao(db: Db, config: Config, categoria: Categoria, acessoNo: string, agora: Date, janelaMs: number) {
  const regioes = await listarRegioes(db, agora);
  return recomendar({
    categoria,
    acessoNo,
    regioes,
    fluxoRecente: await fluxoPorRegiao(db, agora, janelaMs),
    vazaoReferencia: Object.fromEntries(regioes.map((r) => [r.id, vazaoReferencia(r.capacidade)])),
    mapa: mapaCapimDourado,
    agora,
    validadeDadosMs: config.validadeDadosMs,
  });
}

/** Totem (ou simulador): registra a entrada, recomenda a região e emite o ticket. A ocupação não muda. */
export async function registrarEntrada({ db, emissor, config }: Dependencias, entrada: NovaEntrada, opcoes: Opcoes = {}) {
  const agora = opcoes.agora ?? new Date(), simulado = opcoes.simulado ?? false;
  const acesso = await db.acesso.findUnique({ where: { id: entrada.acessoId } });
  if (!acesso) throw new ErroApi('ACESSO_NAO_ENCONTRADO', `Acesso ${entrada.acessoId} não existe`);

  const resultado = await calcularRecomendacao(db, config, entrada.categoria, acesso.noMapa, agora, opcoes.janelaFluxoMs ?? JANELA_FLUXO_MS);
  if (resultado.tipo === 'SEM_REGIAO') throw new ErroApi('SEM_REGIAO_ELEGIVEL', resultado.justificativa, { avaliacoes: resultado.avaliacoes });

  const token = randomBytes(16).toString('base64url');
  const criado = await db.$transaction(async (tx) => {
    const provisorio = await tx.ticket.create({
      data: {
        codigo: `TMP-${token}`, tokenHash: hashToken(token), categoria: entrada.categoria, acessoId: acesso.id,
        placa: entrada.placa ?? null, regiaoRecomendadaId: resultado.regiaoId, entradaEm: agora, simulado,
      },
    });
    const ticket = await tx.ticket.update({ where: { numero: provisorio.numero }, data: { codigo: codigoTicket(provisorio.numero) } });
    const rec = await tx.recomendacao.create({ data: dadosRecomendacao(ticket.numero, resultado, agora), include: { ticket: true } });
    return { ticket, rec };
  });

  const ticket = ticketDto(criado.ticket), recomendacao = recomendacaoDto(criado.rec);
  emissor.emitir('veiculo:entrou', ticket.codigo, { ticket, recomendacao }, simulado);
  emissor.emitir('indicadores:atualizados', 'indicadores', await calcularIndicadores(db, agora), simulado);
  return { ticket, recomendacao, qrUrl: `${config.webUrl}/t/${token}` };
}

function dadosRecomendacao(ticketNumero: number, r: Extract<Awaited<ReturnType<typeof calcularRecomendacao>>, { tipo: 'RECOMENDADA' }>, agora: Date) {
  return {
    ticketNumero, regiaoId: r.regiaoId, score: r.score, justificativa: r.justificativa, criadaEm: agora,
    pesos: r.pesos as unknown as Prisma.InputJsonValue,
    avaliacoes: r.avaliacoes as unknown as Prisma.InputJsonValue,
    rota: r.rota as unknown as Prisma.InputJsonValue,
  };
}

async function buscarTicket(db: Db, codigo: string) {
  const t = await db.ticket.findUnique({ where: { codigo } });
  if (!t) throw new ErroApi('TICKET_NAO_ENCONTRADO', `Ticket ${codigo} não encontrado`);
  return t;
}

/** Nova recomendação para um ticket que ainda não estacionou (ex.: a região recomendada lotou antes da confirmação). */
export async function novaRecomendacao({ db, emissor, config }: Dependencias, codigo: string, motivo: string, opcoes: Opcoes = {}) {
  const agora = opcoes.agora ?? new Date();
  const t = await buscarTicket(db, codigo);
  if (t.status !== 'AGUARDANDO') throw new ErroApi('TRANSICAO_INVALIDA', `Ticket ${codigo} está ${t.status}; só tickets AGUARDANDO recebem nova recomendação`);
  const acesso = await db.acesso.findUniqueOrThrow({ where: { id: t.acessoId } });
  const resultado = await calcularRecomendacao(db, config, t.categoria as Categoria, acesso.noMapa, agora, opcoes.janelaFluxoMs ?? JANELA_FLUXO_MS);
  if (resultado.tipo === 'SEM_REGIAO') throw new ErroApi('SEM_REGIAO_ELEGIVEL', resultado.justificativa, { avaliacoes: resultado.avaliacoes });
  const { ticket, rec } = await db.$transaction(async (tx) => ({
    ticket: await tx.ticket.update({ where: { numero: t.numero }, data: { regiaoRecomendadaId: resultado.regiaoId } }),
    rec: await tx.recomendacao.create({ data: dadosRecomendacao(t.numero, resultado, agora), include: { ticket: true } }),
  }));
  const dto = { ticket: ticketDto(ticket), recomendacao: recomendacaoDto(rec), motivo };
  emissor.emitir('veiculo:recomendado', ticket.codigo, dto, t.simulado);
  return dto;
}

/** Confirmação de estacionamento: a ocupação só sobe aqui, validando de novo a capacidade no banco. */
export async function estacionar({ db, emissor }: Dependencias, codigo: string, regiaoId?: string, opcoes: Opcoes = {}) {
  const agora = opcoes.agora ?? new Date();
  const resultado = await db.$transaction(async (tx) => {
    const t = await buscarTicket(tx, codigo);
    if (t.status !== 'AGUARDANDO') throw new ErroApi('TRANSICAO_INVALIDA', `Ticket ${codigo} está ${t.status}; só tickets AGUARDANDO podem ser estacionados`);
    const destino = regiaoId ?? t.regiaoRecomendadaId;
    const regiao = await buscarRegiao(tx, destino, agora);
    if (!regiao.categorias.includes(t.categoria as Categoria)) throw new ErroApi('CATEGORIA_INCOMPATIVEL', `Região ${destino} não aceita ${t.categoria}`);
    // revalida a disponibilidade no momento da confirmação (a região pode ter sido fechada depois da recomendação)
    if (!regiao.operacional) throw new ErroApi('REGIAO_INDISPONIVEL', `Região ${destino} está indisponível no momento`, { regiaoId: destino });
    // incremento atômico condicionado: nunca passa da capacidade, mesmo com confirmações simultâneas
    const r = await tx.$executeRaw`UPDATE regiao SET ocupadas = ocupadas + 1, "atualizadoEm" = now() WHERE id = ${destino} AND ocupadas < capacidade`;
    if (r === 0) throw new ErroApi('REGIAO_LOTADA', `Região ${destino} está lotada`, { regiaoId: destino });
    await tx.eventoOcupacao.create({ data: { regiaoId: destino, tipo: 'ENTRADA_VAGA', origem: opcoes.origem ?? 'operador', ticketNumero: t.numero, simulado: t.simulado, ocorridoEm: agora } });
    const ticket = await tx.ticket.update({ where: { numero: t.numero }, data: { status: 'ESTACIONADO', regiaoEstacionadaId: destino, estacionadoEm: agora } });
    return { ticket: ticketDto(ticket), regiao: await buscarRegiao(tx, destino, agora), simulado: t.simulado };
  });
  const { simulado, ...dto } = resultado;
  emissor.emitir('veiculo:estacionou', dto.ticket.codigo, dto, simulado);
  emissor.emitir('regiao:ocupacao', dto.regiao.id, dto.regiao, simulado);
  emissor.emitir('indicadores:atualizados', 'indicadores', await calcularIndicadores(db, agora), simulado);
  return dto;
}

/**
 * Saída: libera a vaga na região onde o veículo está registrado.
 * Só para veículos ESTACIONADOS (saída duplicada ou de veículo não estacionado é recusada; para quem desistiu, use cancelar).
 * `regiaoEsperada` (opcional, vinda de sensor) precisa bater com a região registrada.
 */
export async function registrarSaida({ db, emissor }: Dependencias, codigo: string, opcoes: Opcoes & { regiaoEsperada?: string } = {}) {
  const agora = opcoes.agora ?? new Date();
  const resultado = await db.$transaction(async (tx) => {
    const t = await buscarTicket(tx, codigo);
    if (t.status !== 'ESTACIONADO' || !t.regiaoEstacionadaId) {
      throw new ErroApi('TRANSICAO_INVALIDA', t.status === 'SAIU' ? `Ticket ${codigo} já registrou saída` : `Ticket ${codigo} está ${t.status}; só veículos estacionados registram saída`);
    }
    if (opcoes.regiaoEsperada && opcoes.regiaoEsperada !== t.regiaoEstacionadaId) {
      throw new ErroApi('TRANSICAO_INVALIDA', `Ticket ${codigo} está registrado em ${t.regiaoEstacionadaId}, não em ${opcoes.regiaoEsperada}`, { regiaoRegistrada: t.regiaoEstacionadaId });
    }
    const r = await tx.$executeRaw`UPDATE regiao SET ocupadas = ocupadas - 1, "atualizadoEm" = now() WHERE id = ${t.regiaoEstacionadaId} AND ocupadas > 0`;
    if (r === 0) throw new ErroApi('DADOS_INVALIDOS', `Região ${t.regiaoEstacionadaId} já está com ocupação zero`);
    await tx.eventoOcupacao.create({ data: { regiaoId: t.regiaoEstacionadaId, tipo: 'SAIDA_VAGA', origem: opcoes.origem ?? 'operador', ticketNumero: t.numero, simulado: t.simulado, ocorridoEm: agora } });
    const ticket = await tx.ticket.update({ where: { numero: t.numero }, data: { status: 'SAIU', saidaEm: agora } });
    return { ticket: ticketDto(ticket), regiao: await buscarRegiao(tx, t.regiaoEstacionadaId, agora) as Regiao | null, simulado: t.simulado };
  });
  const { simulado, ...dto } = resultado;
  emissor.emitir('veiculo:saiu', dto.ticket.codigo, dto, simulado);
  if (dto.regiao) emissor.emitir('regiao:ocupacao', dto.regiao.id, dto.regiao, simulado);
  emissor.emitir('indicadores:atualizados', 'indicadores', await calcularIndicadores(db, agora), simulado);
  return dto;
}

/** Desistência antes de estacionar: AGUARDANDO → CANCELADO (não mexe na ocupação). */
export async function cancelar({ db, emissor }: Dependencias, codigo: string, opcoes: Opcoes = {}) {
  const t = await buscarTicket(db, codigo);
  if (t.status !== 'AGUARDANDO') throw new ErroApi('TRANSICAO_INVALIDA', `Ticket ${codigo} está ${t.status}; só tickets AGUARDANDO podem ser cancelados`);
  const ticket = ticketDto(await db.ticket.update({ where: { numero: t.numero }, data: { status: 'CANCELADO', saidaEm: opcoes.agora ?? new Date() } }));
  emissor.emitir('veiculo:saiu', ticket.codigo, { ticket, regiao: null }, t.simulado);
  return { ticket };
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
    ticket: {
      codigo: t.codigo, entradaEm: t.entradaEm.toISOString(), status: t.status, categoria: t.categoria,
      estacionadoEm: t.estacionadoEm?.toISOString() ?? null, saidaEm: t.saidaEm?.toISOString() ?? null,
    },
    regiao, recomendada, orientacao: orientacao.filter(Boolean),
  };
}
