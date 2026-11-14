import { nivelFluxo, NOME_TIPO_VAGA, TIPOS_VAGA, type Categoria, type FonteCapacidade, type FonteVagasReservadas, type Indicadores, type Nivel, type Regiao, type StatusSensores, type TipoVaga, type VagasDoTipo } from '@parkvision/shared';
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

/** Vagas por tipo a partir das colunas da região (comuns = total − reservadas). */
export function vagasDto(r: Pick<RegiaoDb, 'capacidade' | 'ocupadas' | 'capacidadePcd' | 'capacidadeIdoso' | 'ocupadasPcd' | 'ocupadasIdoso'>): Record<TipoVaga, VagasDoTipo> {
  const tipo = (capacidade: number, ocupadas: number): VagasDoTipo => ({ capacidade, ocupadas, livres: Math.max(0, capacidade - ocupadas) });
  return {
    COMUM: tipo(r.capacidade - r.capacidadePcd - r.capacidadeIdoso, r.ocupadas - r.ocupadasPcd - r.ocupadasIdoso),
    PCD: tipo(r.capacidadePcd, r.ocupadasPcd),
    IDOSO: tipo(r.capacidadeIdoso, r.ocupadasIdoso),
  };
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
    vagas: vagasDto(r),
    fonteVagasReservadas: r.fonteVagasReservadas as FonteVagasReservadas,
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
  // vagas reservadas: capacidade e ocupação totais mexem só nas COMUNS, que não podem ficar negativas nem acima do limite
  const { PCD, IDOSO } = atual.vagas!;
  const capacidadeComum = capacidade - PCD.capacidade - IDOSO.capacidade;
  const ocupadasComum = ocupadas - PCD.ocupadas - IDOSO.ocupadas;
  if (capacidadeComum < 0) throw new ErroApi('TIPO_VAGA_INCOMPATIVEL', `A capacidade (${capacidade}) não comporta as ${PCD.capacidade + IDOSO.capacidade} vagas reservadas da região ${id}. Ajuste as vagas reservadas antes.`);
  if (ocupadasComum < 0) throw new ErroApi('DADOS_INVALIDOS', `A ocupação (${ocupadas}) é menor que as vagas reservadas ocupadas (${PCD.ocupadas + IDOSO.ocupadas}) na região ${id}`);
  if (ocupadasComum > capacidadeComum) throw new ErroApi('DADOS_INVALIDOS', `Ocupação das vagas comuns (${ocupadasComum}) maior que a capacidade comum (${capacidadeComum}) na região ${id}`);
  // condicionado ao estado lido: se uma confirmação/saída mexeu nas reservadas no meio do caminho, o ajuste não passa
  const mudou = await db.regiao.updateMany({
    where: { id, ocupadasPcd: PCD.ocupadas, ocupadasIdoso: IDOSO.ocupadas, capacidadePcd: PCD.capacidade, capacidadeIdoso: IDOSO.capacidade, ...(dados.ocupadas === undefined ? {} : { ocupadas: atual.ocupadas }) },
    data: { ...dados, versao: { increment: 1 } },
  });
  if (mudou.count === 0) throw new ErroApi('TRANSICAO_INVALIDA', `A região ${id} mudou enquanto o ajuste era feito; confira os números e tente de novo`);
  await db.$transaction([
    ...(dados.ocupadas !== undefined && dados.ocupadas !== atual.ocupadas
      ? [db.eventoOcupacao.create({ data: { regiaoId: id, tipo: 'AJUSTE', origem } })]
      : []),
  ]);
  const regiao = await buscarRegiao(db, id);
  emissor.emitir(dados.ocupadas !== undefined ? 'regiao:ocupacao' : 'regiao:status', id, regiao);
  emissor.emitir('indicadores:atualizados', 'indicadores', await calcularIndicadores(db));
  return regiao;
}

/**
 * Ajuste administrativo das vagas reservadas de uma região (as comuns são o restante).
 * Recusa o que deixaria a região inconsistente com a ocupação ATUAL — o UPDATE é condicionado no próprio banco,
 * então uma confirmação simultânea não consegue "furar" a validação.
 */
export async function configurarVagasReservadas(db: PrismaClient, emissor: Emissor, id: string, dados: { capacidadePcd: number; capacidadeIdoso: number }): Promise<Regiao> {
  const atual = await buscarRegiao(db, id);
  if (!atual.categorias.some((c) => c !== 'MOTO')) throw new ErroApi('TIPO_VAGA_INCOMPATIVEL', `A região ${id} é só de motos e não recebe vagas PcD ou para pessoa idosa`);
  const { capacidadePcd: pcd, capacidadeIdoso: idoso } = dados;
  const v = atual.vagas!;
  const motivo =
    pcd + idoso > atual.capacidade ? `As vagas reservadas (${pcd + idoso}) passam da capacidade da região (${atual.capacidade})`
    : pcd < v.PCD.ocupadas ? `Há ${v.PCD.ocupadas} ${v.PCD.ocupadas === 1 ? 'vaga PcD ocupada' : 'vagas PcD ocupadas'} agora; não dá para reduzir para ${pcd}`
    : idoso < v.IDOSO.ocupadas ? `Há ${v.IDOSO.ocupadas} vagas para pessoa idosa ocupadas agora; não dá para reduzir para ${idoso}`
    : atual.capacidade - pcd - idoso < v.COMUM.ocupadas ? `Sobrariam ${atual.capacidade - pcd - idoso} vagas comuns, mas ${v.COMUM.ocupadas} estão ocupadas agora`
    : null;
  if (motivo) throw new ErroApi('TIPO_VAGA_INCOMPATIVEL', motivo, { regiaoId: id });
  const linhas = await db.$executeRaw`UPDATE regiao SET "capacidadePcd" = ${pcd}::int, "capacidadeIdoso" = ${idoso}::int, "fonteVagasReservadas" = 'operador', versao = versao + 1, "atualizadoEm" = clock_timestamp()
    WHERE id = ${id} AND ${pcd}::int + ${idoso}::int <= capacidade AND ${pcd}::int >= "ocupadasPcd" AND ${idoso}::int >= "ocupadasIdoso"
      AND capacidade - ${pcd}::int - ${idoso}::int >= ocupadas - "ocupadasPcd" - "ocupadasIdoso"`;
  if (linhas === 0) throw new ErroApi('TIPO_VAGA_INCOMPATIVEL', `A ocupação da região ${id} mudou e o ajuste ficaria inconsistente; confira e tente de novo`, { regiaoId: id });
  const regiao = await buscarRegiao(db, id);
  emissor.emitir('regiao:status', id, regiao);
  emissor.emitir('indicadores:atualizados', 'indicadores', await calcularIndicadores(db));
  return regiao;
}

/** Texto curto do tipo de vaga para mensagens ("vagas PcD", "vagas para pessoa idosa", "vagas comuns"). */
export const vagasDoTipoTexto = (t: TipoVaga) => ({ COMUM: 'vagas comuns', PCD: 'vagas PcD', IDOSO: 'vagas para pessoa idosa' })[t];
export { NOME_TIPO_VAGA };

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
    porTipoVaga: Object.fromEntries(TIPOS_VAGA.map((t) => {
      const capacidade = regioes.reduce((s, r) => s + r.vagas![t].capacidade, 0), ocupadasT = regioes.reduce((s, r) => s + r.vagas![t].ocupadas, 0);
      return [t, { capacidade, ocupadas: ocupadasT, livres: capacidade - ocupadasT }];
    })) as Record<TipoVaga, VagasDoTipo>,
  };
}
