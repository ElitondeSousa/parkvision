import { describe, expect, it } from 'vitest';
import { mapaCapimDourado as M } from './index.ts';

describe('mapa digital do Capim Dourado', () => {
  const nos = new Set(M.nos.map((n) => n.id));

  it('tem as 10 regiões aprovadas com capacidade definida', () => {
    expect(M.regioes.map((r) => r.id)).toEqual(['N1', 'N2', 'N3', 'S1', 'S2', 'SS1', 'SS1M', 'SS2O', 'SS2C', 'SS2L']);
    for (const r of M.regioes) expect(r.capacidade.valor, r.id).toBeGreaterThan(0);
  });

  it('mantém os totais escritos na planta (SS1 = 140, SS2 = 216)', () => {
    const cap = (id: string) => M.regioes.find((r) => r.id === id)!.capacidade.valor!;
    expect(cap('SS1')).toBe(140);
    expect(cap('SS2O') + cap('SS2C') + cap('SS2L')).toBe(216);
  });

  it('não tem referência quebrada entre regiões, acessos, nós e arestas', () => {
    for (const r of M.regioes) expect(nos.has(r.noAcesso), r.id).toBe(true);
    for (const a of M.acessos) expect(nos.has(a.no), a.id).toBe(true);
    for (const e of M.arestas) { expect(nos.has(e.de), e.de).toBe(true); expect(nos.has(e.para), e.para).toBe(true); }
    for (const l of M.ligacoesEntreNiveis) { expect(nos.has(l.de)).toBe(true); expect(nos.has(l.para)).toBe(true); expect(l.custoEstimado).toBeGreaterThan(0); }
  });

  it('só a região de motos aceita motos', () => {
    const motos = M.regioes.filter((r) => r.categorias.includes('MOTO')).map((r) => r.id);
    expect(motos).toEqual(['SS1M']);
  });
});
