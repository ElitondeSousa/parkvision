/**
 * Carga inicial: regiões, categorias e acessos a partir do mapa digital oficial.
 * Ocupação inicial = 0 (o simulador da Etapa 2 é quem movimenta o estacionamento).
 * Uso: pnpm db:seed   (opção --limpar apaga tickets, recomendações, eventos e o estado dos sensores — base de desenvolvimento/teste)
 */
import { distribuirVagasReservadas } from '@parkvision/core';
import { mapaCapimDourado as M } from '@parkvision/shared';
import { PrismaClient } from '@prisma/client';

const ESTADO_LIMPO = {
  ocupadas: 0, ocupadasPcd: 0, ocupadasIdoso: 0, operacional: true, bloqueioSimulado: false, statusSensores: 'ok', statusSensoresSimulado: false,
  fluxoSensor: 0, fluxoSensorAte: null, fluxoSimulado: false,
};

export async function semear(db: PrismaClient, { limpar = false } = {}) {
  if (limpar) {
    await db.eventoSensor.deleteMany();
    await db.eventoOcupacao.deleteMany();
    await db.recomendacao.deleteMany();
    await db.ticket.deleteMany();
    await db.$executeRawUnsafe('ALTER SEQUENCE "ticket_numero_seq" RESTART WITH 1');
  }
  // vagas reservadas: proposta simulada (planta + distribuição do restante); ajustes do operador são preservados
  const reservadas = distribuirVagasReservadas(M.regioes.map((r) => ({ id: r.id, capacidade: r.capacidade.valor ?? 0, categorias: r.categorias })));
  for (const r of M.regioes) {
    const fonte = r.capacidade.fonte === 'a-contar' ? 'simulada' : r.capacidade.fonte;
    const capacidade = r.capacidade.valor ?? 0;
    const res = reservadas[r.id]!;
    const vagas = { capacidadePcd: res.pcd, capacidadeIdoso: res.idoso, fonteVagasReservadas: res.fonte };
    const atual = await db.regiao.findUnique({ where: { id: r.id } });
    // sem limpar, só troca as reservadas se não houver ajuste do operador e se a ocupação atual couber
    const aplicarVagas = limpar || !atual || (atual.fonteVagasReservadas !== 'operador' && atual.ocupadasPcd <= res.pcd && atual.ocupadasIdoso <= res.idoso
      && atual.ocupadas - atual.ocupadasPcd - atual.ocupadasIdoso <= capacidade - res.pcd - res.idoso);
    if (atual && !aplicarVagas && atual.fonteVagasReservadas !== 'operador') console.warn(`! ${r.id}: vagas reservadas mantidas (a ocupação atual não cabe na proposta)`);
    await db.regiao.upsert({
      where: { id: r.id },
      create: { id: r.id, nome: r.nome, nivel: r.nivel, capacidade, fonteCapacidade: fonte, ...vagas },
      update: { nome: r.nome, nivel: r.nivel, capacidade, fonteCapacidade: fonte, ...(aplicarVagas ? vagas : {}), ...(limpar ? ESTADO_LIMPO : {}) },
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
