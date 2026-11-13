/** Etapa 2: falhas de sensor e congestionamento influenciando a recomendação (sem mudar os pesos). */
import { describe, expect, it } from 'vitest';
import { recomendar } from './index.ts';
import { entrada, todasAsRegioes } from './testes/apoio.ts';

describe('sensores e fluxo (Etapa 2)', () => {
  it('região com sensores sem comunicação ou inconsistentes fica com DADOS_INVALIDOS', () => {
    for (const status of ['sem-comunicacao', 'inconsistente'] as const) {
      const regioes = todasAsRegioes().map((r) => (r.id === 'SS1' ? { ...r, statusSensores: status } : r));
      const res = recomendar(entrada({ regioes }));
      expect(res.avaliacoes.find((a) => a.regiaoId === 'SS1')).toMatchObject({ elegivel: false, motivo: 'DADOS_INVALIDOS' });
      if (res.tipo === 'RECOMENDADA') expect(res.regiaoId).not.toBe('SS1');
    }
  });

  it('status "ok" mantém a região elegível', () => {
    const regioes = todasAsRegioes().map((r) => ({ ...r, statusSensores: 'ok' as const }));
    expect(recomendar(entrada({ regioes })).avaliacoes.every((a) => a.motivo !== 'DADOS_INVALIDOS')).toBe(true);
  });

  it('congestionamento (fluxo alto) tira a região do topo sem alterar os pesos', () => {
    const base = recomendar(entrada());
    expect(base.tipo).toBe('RECOMENDADA');
    const vencedora = base.tipo === 'RECOMENDADA' ? base.regiaoId : '';
    const congestionada = recomendar(entrada({ fluxoRecente: { [vencedora]: 50 }, vazaoReferencia: { [vencedora]: 8 } }));
    expect(congestionada.tipo === 'RECOMENDADA' && congestionada.regiaoId).not.toBe(vencedora);
    expect(congestionada.pesos).toEqual(base.pesos);
  });
});
