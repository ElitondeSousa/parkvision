/**
 * Vagas reservadas (PcD e pessoa idosa): mínimos legais e arredondamento, distribuição por região, soma das capacidades,
 * separação dos tipos e recomendação conforme elegibilidade (sem trocar de tipo automaticamente).
 */
import { caminhosPedestres, mapaCapimDourado as M, minimosLegais, vagasDaRegiao, type Regiao, type TipoVaga } from '@parkvision/shared';
import { describe, expect, it } from 'vitest';
import { distribuirVagasReservadas, dividirProporcional, FRACAO_MAXIMA_RESERVADA, recomendar } from './index.ts';
import { entrada, regiao } from './testes/apoio.ts';

const distribuicao = distribuirVagasReservadas(M.regioes.map((r) => ({ id: r.id, capacidade: r.capacidade.valor ?? 0, categorias: r.categorias })));
const soma = (campo: 'pcd' | 'idoso') => Object.values(distribuicao).reduce((s, v) => s + v[campo], 0);
const TOTAL = M.regioes.reduce((s, r) => s + (r.capacidade.valor ?? 0), 0);

/** Região com vagas por tipo: ocupação comum/PcD/idoso informada separadamente. */
function regiaoComVagas(id: string, reservadas: { pcd: number; idoso: number }, ocupadas: Partial<Record<TipoVaga, number>> = {}, extra: Partial<Regiao> = {}): Regiao {
  const base = regiao(id);
  const cap: Record<TipoVaga, number> = { COMUM: base.capacidade - reservadas.pcd - reservadas.idoso, PCD: reservadas.pcd, IDOSO: reservadas.idoso };
  const oc: Record<TipoVaga, number> = { COMUM: ocupadas.COMUM ?? 0, PCD: ocupadas.PCD ?? 0, IDOSO: ocupadas.IDOSO ?? 0 };
  const vagas = Object.fromEntries((['COMUM', 'PCD', 'IDOSO'] as const).map((t) => [t, { capacidade: cap[t], ocupadas: oc[t], livres: cap[t] - oc[t] }])) as Regiao['vagas'];
  const totalOc = oc.COMUM + oc.PCD + oc.IDOSO;
  return { ...base, ocupadas: totalOc, livres: base.capacidade - totalOc, vagas, ...extra };
}
const regioesComReserva = (ajustes: Record<string, Partial<Record<TipoVaga, number>>> = {}) =>
  M.regioes.map((r) => regiaoComVagas(r.id, distribuicao[r.id]!, ajustes[r.id]));
const pedir = (tipoVaga: TipoVaga, regioes = regioesComReserva(), acessoNo = 'n_ROT', categoria: 'CARRO_PEQUENO' | 'MOTO' = 'CARRO_PEQUENO') =>
  recomendar(entrada({ regioes, tipoVaga, acessoNo, categoria, caminhosPedestres: caminhosPedestres() }));

describe('mínimos legais', () => {
  it('2% PcD (mínimo 1) e 5% pessoa idosa, arredondados para cima', () => {
    expect(minimosLegais(1269)).toEqual({ PCD: 26, IDOSO: 64 });   // 25,38 → 26; 63,45 → 64
    expect(minimosLegais(100)).toEqual({ PCD: 2, IDOSO: 5 });      // exatos não sobem
    expect(minimosLegais(10)).toEqual({ PCD: 1, IDOSO: 1 });       // 0,2 → mínimo de 1; 0,5 → 1
    expect(minimosLegais(1)).toEqual({ PCD: 1, IDOSO: 1 });
    expect(minimosLegais(0)).toEqual({ PCD: 0, IDOSO: 0 });
  });
});

describe('distribuição por região (proposta simulada)', () => {
  it('atinge os mínimos legais sobre o total do estacionamento', () => {
    expect(TOTAL).toBe(1269);
    expect(soma('pcd')).toBe(26);
    expect(soma('idoso')).toBe(64);
  });

  it('mantém as vagas lidas na planta (SS1: 3 PcD e 11 idoso; SS2C: 5 PcD e 8 idoso)', () => {
    expect(distribuicao.SS1).toEqual({ pcd: 3, idoso: 11, fonte: 'planta' });
    expect(distribuicao.SS2C).toEqual({ pcd: 5, idoso: 8, fonte: 'planta' });
  });

  it('não coloca vaga reservada em região de motos nem em regiões sem dado de caminho a pé', () => {
    expect(distribuicao.SS1M).toMatchObject({ pcd: 0, idoso: 0, fonte: 'sem-reserva' });
    expect(distribuicao.SS2O).toMatchObject({ pcd: 0, idoso: 0 });
    expect(distribuicao.SS2L).toMatchObject({ pcd: 0, idoso: 0 });
  });

  it('o restante fica no térreo, sem passar de 25% de cada região, e a soma das categorias bate com a capacidade', () => {
    for (const r of M.regioes) {
      const d = distribuicao[r.id]!, cap = r.capacidade.valor ?? 0;
      if (d.fonte === 'proposta') expect(r.nivel).toBe('terreo');
      if (d.fonte === 'proposta') expect(d.pcd + d.idoso).toBeLessThanOrEqual(Math.floor(cap * FRACAO_MAXIMA_RESERVADA));
      const comum = cap - d.pcd - d.idoso;
      expect(comum).toBeGreaterThanOrEqual(0);
      expect(comum + d.pcd + d.idoso).toBe(cap);
    }
  });

  it('regiões maiores e mais perto da entrada de pedestres recebem mais', () => {
    expect(distribuicao.N3!.pcd).toBeGreaterThan(distribuicao.S1!.pcd);
    expect(distribuicao.N3!.idoso).toBeGreaterThan(distribuicao.N2!.idoso);
  });

  it('divisão proporcional determinística, respeitando limites', () => {
    expect(dividirProporcional(10, [{ id: 'a', peso: 3, limite: 100 }, { id: 'b', peso: 1, limite: 100 }])).toEqual({ a: 8, b: 2 });
    expect(dividirProporcional(10, [{ id: 'a', peso: 3, limite: 4 }, { id: 'b', peso: 1, limite: 100 }])).toEqual({ a: 4, b: 6 });
    expect(dividirProporcional(5, [{ id: 'a', peso: 1, limite: 1 }, { id: 'b', peso: 1, limite: 1 }])).toEqual({ a: 1, b: 1 }); // não inventa vaga
  });
});

describe('recomendação por tipo de vaga', () => {
  it('pedido comum nunca usa vaga reservada: região só com reservadas livres não é elegível', () => {
    const regioes = M.regioes.map((r) => {
      const d = distribuicao[r.id]!, cap = r.capacidade.valor ?? 0;
      return regiaoComVagas(r.id, d, { COMUM: cap - d.pcd - d.idoso }); // comuns lotadas, reservadas livres
    });
    const r = pedir('COMUM', regioes);
    expect(r.tipo).toBe('SEM_REGIAO');
  });

  it('PcD recebe região com vaga PcD livre e a explicação fala do tipo, da credencial e do caminho sem afirmar acessibilidade', () => {
    const r = pedir('PCD');
    expect(r.tipo).toBe('RECOMENDADA');
    if (r.tipo !== 'RECOMENDADA') return;
    expect(distribuicao[r.regiaoId]!.pcd).toBeGreaterThan(0);
    expect(r.justificativa).toContain('recomendada para vaga PcD');
    expect(r.justificativa).toContain('credencial');
    expect(r.justificativa).toMatch(/ainda não foi validada/);
    expect(r.justificativa).not.toMatch(/rota acessível|caminho acessível/i);
  });

  it('PcD prioriza regiões com caminho a pé no mesmo nível da entrada (térreo) antes dos subsolos', () => {
    const r = pedir('PCD', regioesComReserva(), 'n_A_NE');
    expect(r.tipo).toBe('RECOMENDADA');
    if (r.tipo === 'RECOMENDADA') expect(M.regioes.find((x) => x.id === r.regiaoId)!.nivel).toBe('terreo');
  });

  it('pessoa idosa recebe vaga do próprio tipo', () => {
    const r = pedir('IDOSO');
    expect(r.tipo).toBe('RECOMENDADA');
    if (r.tipo === 'RECOMENDADA') {
      expect(distribuicao[r.regiaoId]!.idoso).toBeGreaterThan(0);
      expect(r.justificativa).toContain('vaga para pessoa idosa');
    }
  });

  it('regiões sem vaga do tipo ficam inelegíveis com motivo próprio', () => {
    const r = pedir('PCD');
    const ss2l = r.avaliacoes.find((a) => a.regiaoId === 'SS2L')!;
    expect(ss2l).toMatchObject({ elegivel: false, motivo: 'SEM_VAGA_DO_TIPO' });
  });

  it('sem vaga PcD livre: indisponibilidade clara, sem mandar para vaga comum ou de idoso', () => {
    const tudoPcdOcupado = Object.fromEntries(Object.entries(distribuicao).map(([id, d]) => [id, { PCD: d.pcd }]));
    const r = pedir('PCD', regioesComReserva(tudoPcdOcupado));
    expect(r.tipo).toBe('SEM_REGIAO');
    expect(r.justificativa).toContain('Nenhuma vaga PcD disponível');
    expect(r.justificativa).toContain('não indica vaga de outro tipo');
    // o pedido comum continua sendo atendido normalmente
    expect(pedir('COMUM', regioesComReserva(tudoPcdOcupado)).tipo).toBe('RECOMENDADA');
  });

  it('moto não tem vaga reservada: pedido PcD de moto informa a indisponibilidade', () => {
    const r = pedir('PCD', regioesComReserva(), 'n_A_NE', 'MOTO');
    expect(r.tipo).toBe('SEM_REGIAO');
  });

  it('disponibilidade usa só as vagas do tipo (comuns não interferem)', () => {
    const regioes = regioesComReserva({ N3: { COMUM: 150 } });
    const r = pedir('PCD', regioes);
    if (r.tipo !== 'RECOMENDADA') throw new Error('esperava recomendação');
    const n3 = r.avaliacoes.find((a) => a.regiaoId === 'N3')!;
    expect(n3.criterios!.disponibilidade).toBe(1); // todas as PcD de N3 livres, mesmo com as comuns quase cheias
  });

  it('vagas por tipo inconsistentes (soma diferente do total) tornam os dados inválidos', () => {
    const quebrada = regiaoComVagas('N3', distribuicao.N3!, {}, {});
    quebrada.vagas = { ...quebrada.vagas!, PCD: { capacidade: 50, ocupadas: 0, livres: 50 } };
    const regioes = regioesComReserva().map((r) => (r.id === 'N3' ? quebrada : r));
    const r = pedir('PCD', regioes);
    expect(r.avaliacoes.find((a) => a.regiaoId === 'N3')).toMatchObject({ elegivel: false, motivo: 'DADOS_INVALIDOS' });
  });

  it('sem informação de vagas, a região é toda comum (compatível com os dados antigos)', () => {
    expect(vagasDaRegiao(regiao('N1'))).toMatchObject({ COMUM: { capacidade: 127 }, PCD: { capacidade: 0 }, IDOSO: { capacidade: 0 } });
  });
});
