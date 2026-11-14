import { nivelFluxo, type Categoria, type FonteCapacidade, type Indicadores, type Nivel, type Regiao, type StatusSensores } from '@parkvision/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { vazaoReferencia } from '../config.ts';
import { ErroApi } from '../erros.ts';
import type { Emissor } from '../tempo-real.ts';

type Db = PrismaClient | Prisma.TransactionClient;
type RegiaoDb = Prisma.RegiaoGetPayload<{ include: { categorias: true } }>;

/** Janela padrão do critério de fluxo. */
export const JANELA_FLUXO_MS = 5 * 60 * 1000;

/**
 * Fluxo recente por região = recomendações na janela + veículos em circulação medidos pelos sensores de fluxo (se vigentes).
 * É este número que entra no critério "fluxo" do algoritmo (os pesos não mudam).
 */
export async function fluxoPorRegiao(db: Db, agora: Date, janelaMs = JANELA_FLUXO_MS): Promise<Record<string, number>> {
  const [recs, sensores] = await Promise.all([
    db.recomendacao.groupBy({ by: ['regiaoId'], where: { criadaEm: { gt: new Date(agora.getTime() - janelaMs), lte: agora } }, _count: true }),
    db.regiao.findMany({ where: { fluxoSensor: { gt: 0 }, fluxoSensorAte: { gt: agora } }, select: { id: true, fluxoSensor: true } }),
  ]);
  const fluxo: Record<string, number> = {};
  for (const r of recs) fluxo[r.regiaoId] = r._count;
  for (const s of sensores) fluxo[s.id] = (fluxo[s.id] ?? 0) + s.fluxoSensor;
  return fluxo;
}

export function regiaoDto(r: RegiaoDb, fluxo?: Record<string, number>): Regiao {
  const recente = fluxo?.[r.id] ?? 0;
  const vazao = vazaoReferencia(r.capacidade);
  return {
    id: r.id,
    nome: r.nome,
    nivel: r.nivel as Nivel,
    categorias: r.categorias.map((c) => c.categoria as Categoria),
    capacidade: r.capacidade,
    ocupadas: r.ocupadas,
    livres: Math.max(0, r.capacidade - r.ocupadas),
    operacional: r.operacional && !r.bloqueioSimulado,
    fonteCapacidade: r.fonteCapacidade as FonteCapacidade,
    atualizadoEm: r.atualizadoEm.toISOString(),
    statusSensores: r.statusSensores as StatusSensores,
    fluxo: { recente, vazaoReferencia: vazao, nivel: nivelFluxo(recente, vazao) },
    versao: r.versao,
  };
}

const ORDEM = ['N1', 'N2', 'N3', 'S1', 'S2', 'SS1', 'SS1M', 'SS2O', 'SS2C', 'SS2L'];
const ordenar = (lista: Regiao[]) => lista.sort((a, b) => (ORDEM.indexOf(a.id) + 1 || 99) - (ORDEM.indexOf(b.id) + 1 || 99));

export async function listarRegioes(db: Db, agora = new Date()): Promise<Regiao[]> {
  const [regs, fluxo] = await Promise.all([db.regiao.findMany({ include: { categorias: true } }), fluxoPorRegiao(db, agora)]);
  return ordenar(regs.map((r) => regiaoDto(r, fluxo)));
}

export async function buscarRegiao(db: Db, id: string, agora = new Date()): Promise<Regiao> {
  const r = await db.regiao.findUnique({ where: { id }, include: { categorias: true } });
  if (!r) throw new ErroApi('REGIAO_NAO_ENCONTRADA', `Região ${id} não existe`);
  return regiaoDto(r, await fluxoPorRegiao(db, agora));
}

/** Ajuste feito pelo operador (operação, capacidade ou ocupação). */
export async function atualizarRegiao(
  db: PrismaClient,
  emissor: Emissor,
  id: string,
  dados: { operacional?: boolean; capacidade?: number; ocupadas?: number },
  origem: string,
): Promise<Regiao> {
  const atual = await buscarRegiao(db, id);
  const capacidade = dados.capacidade ?? atual.capacidade;
  const ocupadas = dados.ocupadas ?? atual.ocupadas;
  if (ocupadas > capacidade) throw new ErroApi('DADOS_INVALIDOS', `Ocupação (${ocupadas}) maior que a capacidade (${capacidade})`);
  await db.$transaction([
    db.regiao.update({ where: { id }, data: { ...dados, versao: { increment: 1 } } }),
    ...(dados.ocupadas !== undefined && dados.ocupadas !== atual.ocupadas
      ? [db.eventoOcupacao.create({ data: { regiaoId: id, tipo: 'AJUSTE', origem } })]
      : []),
  ]);
  const regiao = await buscarRegiao(db, id);
  emissor.emitir(dados.ocupadas !== undefined ? 'regiao:ocupacao' : 'regiao:status', id, regiao);
  emissor.emitir('indicadores:atualizados', 'indicadores', await calcularIndicadores(db));
  return regiao;
}

export async function calcularIndicadores(db: Db, agora = new Date()): Promise<Indicadores> {
  const [regioes, aguardando, recHora] = await Promise.all([
    listarRegioes(db, agora),
    db.ticket.count({ where: { status: 'AGUARDANDO' } }),
    db.recomendacao.count({ where: { criadaEm: { gt: new Date(agora.getTime() - 3600_000), lte: agora } } }),
  ]);
  const capacidadeTotal = regioes.reduce((s, r) => s + r.capacidade, 0);
  const ocupadas = regioes.reduce((s, r) => s + r.ocupadas, 0);
  return {
    capacidadeTotal,
    ocupadas,
    livres: capacidadeTotal - ocupadas,
    taxaOcupacao: capacidadeTotal ? Math.round((ocupadas / capacidadeTotal) * 1000) / 10 : 0,
    veiculosAguardando: aguardando,
    recomendacoesUltimaHora: recHora,
    regioesAltaOcupacao: regioes.filter((r) => r.capacidade && r.ocupadas / r.capacidade >= 0.9).map((r) => r.id),
  };
}
