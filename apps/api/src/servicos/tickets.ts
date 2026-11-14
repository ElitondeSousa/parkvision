/**
 * Entradas, recomendações, confirmação de estacionamento, saída e cancelamento.
 * Regras: a recomendação NÃO altera a ocupação; só a confirmação (+1) e a saída (−1), sempre com validação no banco.
 * `opcoes.simulado` marca os registros do simulador; `opcoes.agora` permite o relógio acelerado da simulação.
 *
 * Concorrência (Etapa 4): toda troca de status é um UPDATE condicionado ao status atual (`WHERE status = ...`),
 * dentro da mesma transação que mexe na ocupação. Duas confirmações (ou saídas) simultâneas do mesmo ticket:
 * só uma passa; a outra recebe TRANSICAO_INVALIDA e a transação inteira é desfeita.
 * Ordem das travas sempre ticket → região, nas três operações (evita deadlock).
 */
import { recomendar } from '@parkvision/core';
import { mapaCapimDourado, type AvaliacaoRegiao, type Categoria, type NovaEntrada, type Pesos, type Recomendacao, type Regiao, type Rota, type Ticket, type TicketAtualizado } from '@parkvision/shared';
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

/** Versão do ticket para eventos públicos: sem placa (eventos do painel são abertos). */
const semPlaca = (t: Ticket): Ticket => ({ ...t, placa: null });
const resumoTicket = (t: Ticket): TicketAtualizado => ({ codigo: t.codigo, status: t.status, regiaoRecomendadaId: t.regiaoRecomendadaId, regiaoEstacionadaId: t.regiaoEstacionadaId });

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
  emissor.emitir('veiculo:entrou', ticket.codigo, { ticket: semPlaca(ticket), recomendacao: { ...recomendacao } }, simulado);
  emissor.emitir('ticket:atualizado', ticket.codigo, resumoTicket(ticket), simulado);
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
  const { ticket, rec } = await db.$transaction(async (tx) => {
    const mudou = await tx.ticket.updateMany({ where: { numero: t.numero, status: 'AGUARDANDO' }, data: { regiaoRecomendadaId: resultado.regiaoId } });
    if (mudou.count === 0) throw new ErroApi('TRANSICAO_INVALIDA', `Ticket ${codigo} mudou de estado; só tickets AGUARDANDO recebem nova recomendação`);
    return {
      ticket: await tx.ticket.findUniqueOrThrow({ where: { numero: t.numero } }),
      rec: await tx.recomendacao.create({ data: dadosRecomendacao(t.numero, resultado, agora), include: { ticket: true } }),
    };
  });
  const dto = { ticket: ticketDto(ticket), recomendacao: recomendacaoDto(rec), motivo };
  emissor.emitir('veiculo:recomendado', ticket.codigo, { ...dto, ticket: semPlaca(dto.ticket) }, t.simulado);
  emissor.emitir('ticket:atualizado', ticket.codigo, resumoTicket(dto.ticket), t.simulado);
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
    // 1) troca de status condicionada: confirmação duplicada (mesmo simultânea) não passa daqui
    const mudou = await tx.ticket.updateMany({ where: { numero: t.numero, status: 'AGUARDANDO' }, data: { status: 'ESTACIONADO', regiaoEstacionadaId: destino, estacionadoEm: agora } });
    if (mudou.count === 0) throw new ErroApi('TRANSICAO_INVALIDA', `Ticket ${codigo} já foi confirmado ou mudou de estado`);
    // 2) incremento atômico condicionado: nunca passa da capacidade, mesmo com confirmações simultâneas
    const r = await tx.$executeRaw`UPDATE regiao SET ocupadas = ocupadas + 1, versao = versao + 1, "atualizadoEm" = clock_timestamp() WHERE id = ${destino} AND ocupadas < capacidade`;
    if (r === 0) throw new ErroApi('REGIAO_LOTADA', `Região ${destino} está lotada`, { regiaoId: destino });
    await tx.eventoOcupacao.create({ data: { regiaoId: destino, tipo: 'ENTRADA_VAGA', origem: opcoes.origem ?? 'operador', ticketNumero: t.numero, simulado: t.simulado, ocorridoEm: agora } });
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { numero: t.numero } });
    return { ticket: ticketDto(ticket), regiao: await buscarRegiao(tx, destino, agora), simulado: t.simulado };
  });
  const { simulado, ...dto } = resultado;
  emissor.emitir('veiculo:estacionou', dto.ticket.codigo, { ...dto, ticket: semPlaca(dto.ticket) }, simulado);
  emissor.emitir('ticket:atualizado', dto.ticket.codigo, resumoTicket(dto.ticket), simulado);
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
    // troca de status condicionada: saída duplicada (mesmo simultânea) não passa daqui
    const mudou = await tx.ticket.updateMany({ where: { numero: t.numero, status: 'ESTACIONADO', regiaoEstacionadaId: t.regiaoEstacionadaId }, data: { status: 'SAIU', saidaEm: agora } });
    if (mudou.count === 0) throw new ErroApi('TRANSICAO_INVALIDA', `Ticket ${codigo} já registrou saída ou mudou de estado`);
    const r = await tx.$executeRaw`UPDATE regiao SET ocupadas = ocupadas - 1, versao = versao + 1, "atualizadoEm" = clock_timestamp() WHERE id = ${t.regiaoEstacionadaId} AND ocupadas > 0`;
    if (r === 0) throw new ErroApi('DADOS_INVALIDOS', `Região ${t.regiaoEstacionadaId} já está com ocupação zero`);
    await tx.eventoOcupacao.create({ data: { regiaoId: t.regiaoEstacionadaId, tipo: 'SAIDA_VAGA', origem: opcoes.origem ?? 'operador', ticketNumero: t.numero, simulado: t.simulado, ocorridoEm: agora } });
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { numero: t.numero } });
    return { ticket: ticketDto(ticket), regiao: await buscarRegiao(tx, t.regiaoEstacionadaId, agora) as Regiao | null, simulado: t.simulado };
  });
  const { simulado, ...dto } = resultado;
  emissor.emitir('veiculo:saiu', dto.ticket.codigo, { ...dto, ticket: semPlaca(dto.ticket) }, simulado);
  emissor.emitir('ticket:atualizado', dto.ticket.codigo, resumoTicket(dto.ticket), simulado);
  if (dto.regiao) emissor.emitir('regiao:ocupacao', dto.regiao.id, dto.regiao, simulado);
  emissor.emitir('indicadores:atualizados', 'indicadores', await calcularIndicadores(db, agora), simulado);
  return dto;
}

/** Desistência antes de estacionar: AGUARDANDO → CANCELADO (não mexe na ocupação). */
export async function cancelar({ db, emissor }: Dependencias, codigo: string, opcoes: Opcoes = {}) {
  const t = await buscarTicket(db, codigo);
  const mudou = await db.ticket.updateMany({ where: { numero: t.numero, status: 'AGUARDANDO' }, data: { status: 'CANCELADO', saidaEm: opcoes.agora ?? new Date() } });
  if (mudou.count === 0) throw new ErroApi('TRANSICAO_INVALIDA', `Ticket ${codigo} está ${t.status}; só tickets AGUARDANDO podem ser cancelados`);
  const ticket = ticketDto(await db.ticket.findUniqueOrThrow({ where: { numero: t.numero } }));
  emissor.emitir('veiculo:saiu', ticket.codigo, { ticket: semPlaca(ticket), regiao: null }, t.simulado);
  emissor.emitir('ticket:atualizado', ticket.codigo, resumoTicket(ticket), t.simulado);
  return { ticket };
}

export async function listarTickets(db: PrismaClient, filtro: { status?: Ticket['status']; limite: number }) {
  const lista = await db.ticket.findMany({ where: filtro.status ? { status: filtro.status } : {}, orderBy: { numero: 'desc' }, take: filtro.limite });
  return lista.map(ticketDto);
}

/** Operação (painel): situação completa de um ticket pelo código impresso. */
export async function consultarTicket(db: PrismaClient, codigo: string) {
  const t = await buscarTicket(db, codigo);
  const recs = await db.recomendacao.findMany({ where: { ticketNumero: t.numero }, orderBy: { criadaEm: 'asc' }, include: { ticket: true } });
  return { ticket: ticketDto(t), simulado: t.simulado, recomendacoes: recs.map(recomendacaoDto) };
}

export interface ItemHistorico {
  id: string;
  tipo: 'ENTRADA' | 'ESTACIONOU' | 'SAIU' | 'AJUSTE';
  quando: string;
  ticketCodigo: string | null;
  regiaoId: string;
  categoria: Categoria | null;
  simulado: boolean;
}
/**
 * Histórico recente (entradas + eventos de ocupação gravados), do mais novo para o mais antigo.
 * O painel usa para preencher as movimentações ao abrir e ao reconectar (não depende só dos eventos em tempo real).
 */
export async function historico(db: PrismaClient, limite: number): Promise<ItemHistorico[]> {
  const [entradas, ocupacao] = await Promise.all([
    db.ticket.findMany({ orderBy: { entradaEm: 'desc' }, take: limite, select: { numero: true, codigo: true, entradaEm: true, regiaoRecomendadaId: true, categoria: true, simulado: true } }),
    db.eventoOcupacao.findMany({ orderBy: { ocorridoEm: 'desc' }, take: limite, include: { ticket: { select: { codigo: true, categoria: true } } } }),
  ]);
  const itens: ItemHistorico[] = [
    // ids estáveis por fato (o mesmo do item gerado pelo evento em tempo real no painel): nunca aparece duas vezes
    ...entradas.map((t) => ({ id: `entrada-${t.codigo}`, tipo: 'ENTRADA' as const, quando: t.entradaEm.toISOString(), ticketCodigo: t.codigo, regiaoId: t.regiaoRecomendadaId, categoria: t.categoria as Categoria, simulado: t.simulado })),
    ...ocupacao.map((e) => ({
      id: e.ticket && e.tipo !== 'AJUSTE' ? `${e.tipo === 'ENTRADA_VAGA' ? 'estacionou' : 'saiu'}-${e.ticket.codigo}` : `ajuste-${e.id}`,
      tipo: e.tipo === 'ENTRADA_VAGA' ? ('ESTACIONOU' as const) : e.tipo === 'SAIDA_VAGA' ? ('SAIU' as const) : ('AJUSTE' as const),
      quando: e.ocorridoEm.toISOString(), ticketCodigo: e.ticket?.codigo ?? null, regiaoId: e.regiaoId, categoria: (e.ticket?.categoria as Categoria | undefined) ?? null, simulado: e.simulado,
    })),
  ];
  return itens.sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, limite);
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
      simulado: t.simulado,
    },
    regiao, recomendada, orientacao: orientacao.filter(Boolean),
    // navegação (Etapa Golden Park mobile): acesso de entrada e a rota da recomendação vigente, só enquanto o veículo
    // ainda está a caminho — depois de estacionar/sair não há rota ativa a mostrar
    acesso: await acessoPublico(db, t.acessoId),
    rota: t.status === 'AGUARDANDO' ? await rotaVigente(db, t.numero, t.regiaoRecomendadaId) : null,
  };
}

async function acessoPublico(db: PrismaClient, id: string) {
  const a = await db.acesso.findUnique({ where: { id } });
  return a ? { id: a.id, nome: a.nome } : null;
}

/** Rota (nós do grafo) da recomendação mais recente do ticket, se ela ainda aponta para a região recomendada. */
async function rotaVigente(db: PrismaClient, ticketNumero: number, regiaoId: string) {
  const rec = await db.recomendacao.findFirst({ where: { ticketNumero }, orderBy: { criadaEm: 'desc' } });
  if (!rec || rec.regiaoId !== regiaoId) return null;
  return rec.rota as unknown as Rota;
}
