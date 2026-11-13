import type { Categoria, FonteCapacidade, Indicadores, Nivel, Regiao } from '@parkvision/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ErroApi } from '../erros.ts';
import type { Emissor } from '../tempo-real.ts';

type RegiaoDb = Prisma.RegiaoGetPayload<{ include: { categorias: true } }>;

export function regiaoDto(r: RegiaoDb): Regiao {
  return {
    id: r.id,
    nome: r.nome,
    nivel: r.nivel as Nivel,
    categorias: r.categorias.map((c) => c.categoria as Categoria),
    capacidade: r.capacidade,
    ocupadas: r.ocupadas,
    livres: Math.max(0, r.capacidade - r.ocupadas),
    operacional: r.operacional,
    fonteCapacidade: r.fonteCapacidade as FonteCapacidade,
    atualizadoEm: r.atualizadoEm.toISOString(),
  };
}

const ORDEM = ['N1', 'N2', 'N3', 'S1', 'S2', 'SS1', 'SS1M', 'SS2O', 'SS2C', 'SS2L'];
const ordenar = (lista: Regiao[]) => lista.sort((a, b) => (ORDEM.indexOf(a.id) + 1 || 99) - (ORDEM.indexOf(b.id) + 1 || 99));

export async function listarRegioes(db: PrismaClient | Prisma.TransactionClient): Promise<Regiao[]> {
  const regs = await db.regiao.findMany({ include: { categorias: true } });
  return ordenar(regs.map(regiaoDto));
}

export async function buscarRegiao(db: PrismaClient | Prisma.TransactionClient, id: string): Promise<Regiao> {
  const r = await db.regiao.findUnique({ where: { id }, include: { categorias: true } });
  if (!r) throw new ErroApi('REGIAO_NAO_ENCONTRADA', `Região ${id} não existe`);
  return regiaoDto(r);
}

/** Ajuste feito pelo operador ou pelo simulador (operação, capacidade ou ocupação). */
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
    db.regiao.update({ where: { id }, data: { ...dados } }),
    ...(dados.ocupadas !== undefined && dados.ocupadas !== atual.ocupadas
      ? [db.eventoOcupacao.create({ data: { regiaoId: id, tipo: 'AJUSTE', origem } })]
      : []),
  ]);
  const regiao = await buscarRegiao(db, id);
  emissor.emitir('regiao:atualizada', regiao);
  emissor.emitir('indicadores:atualizados', await calcularIndicadores(db));
  return regiao;
}

export async function calcularIndicadores(db: PrismaClient | Prisma.TransactionClient): Promise<Indicadores> {
  const [regioes, aguardando, recHora] = await Promise.all([
    listarRegioes(db),
    db.ticket.count({ where: { status: 'AGUARDANDO' } }),
    db.recomendacao.count({ where: { criadaEm: { gte: new Date(Date.now() - 3600_000) } } }),
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
