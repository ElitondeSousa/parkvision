/**
 * Carga inicial: regiões, categorias e acessos a partir do mapa digital oficial.
 * Ocupação inicial = 0 (o simulador da Etapa 2 é quem movimenta o estacionamento).
 * Uso: pnpm db:seed   (opção --limpar apaga tickets, recomendações e eventos)
 */
import { mapaCapimDourado as M } from '@parkvision/shared';
import { PrismaClient } from '@prisma/client';

export async function semear(db: PrismaClient, { limpar = false } = {}) {
  if (limpar) {
    await db.eventoOcupacao.deleteMany();
    await db.recomendacao.deleteMany();
    await db.ticket.deleteMany();
    await db.$executeRawUnsafe('ALTER SEQUENCE "ticket_numero_seq" RESTART WITH 1');
  }
  for (const r of M.regioes) {
    const fonte = r.capacidade.fonte === 'a-contar' ? 'simulada' : r.capacidade.fonte;
    const capacidade = r.capacidade.valor ?? 0;
    await db.regiao.upsert({
      where: { id: r.id },
      create: { id: r.id, nome: r.nome, nivel: r.nivel, capacidade, fonteCapacidade: fonte },
      update: { nome: r.nome, nivel: r.nivel, capacidade, fonteCapacidade: fonte, ...(limpar ? { ocupadas: 0, operacional: true } : {}) },
    });
    await db.regiaoCategoria.deleteMany({ where: { regiaoId: r.id } });
    await db.regiaoCategoria.createMany({ data: r.categorias.map((categoria) => ({ regiaoId: r.id, categoria })) });
  }
  // Acessos de veículos onde há totem (térreo). Os do subsolo são internos.
  for (const a of M.acessos.filter((x) => x.nivel === 'terreo')) {
    await db.acesso.upsert({ where: { id: a.id }, create: { id: a.id, nome: a.nome, nivel: a.nivel, noMapa: a.no }, update: { nome: a.nome, noMapa: a.no } });
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('seed.ts')) {
  const db = new PrismaClient();
  semear(db, { limpar: process.argv.includes('--limpar') })
    .then(async () => { console.log(`✔ ${M.regioes.length} regiões e acessos carregados`); await db.$disconnect(); })
    .catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
}
