import { describe, expect, it } from 'vitest';
import { mapaCapimDourado as M } from '@parkvision/shared';
import { menorCaminho } from './index.ts';
import { copiaDoMapa } from './testes/apoio.ts';

describe('menorCaminho — mapa real do Capim Dourado', () => {
  it.each([
    // destino,   custo,  nós esperados
    ['n_N3', 477.1, ['n_A_NE', 'n_rodNE', 'n_ROT', 'n_N3']],
    ['n_N2', 666.3, ['n_A_NE', 'n_rodNE', 'n_ROT', 'n_rodC', 'n_N2']],
    ['n_N1', 899.1, ['n_A_NE', 'n_rodNE', 'n_ROT', 'n_rodC', 'n_rodO', 'n_N1']],
    ['n_SS1', 420.4, ['n_A_NE', 'n_A_SS1', 'n_SS1']],
    ['n_SS1M', 321, ['n_A_NE', 'n_A_SS1M', 'n_SS1M']],
    ['n_SS2L', 514, ['n_A_NE', 'n_A_SS2', 'n_ss2NE', 'n_SS2L']],
  ] as const)('do acesso nordeste até %s custa %d', (destino, custo, nos) => {
    expect(menorCaminho(M, 'n_A_NE', destino)).toEqual({ nos: [...nos], custo });
  });

  it('a rota do acesso nordeste até N3 é menor que até N1', () => {
    const n3 = menorCaminho(M, 'n_A_NE', 'n_N3')!;
    const n1 = menorCaminho(M, 'n_A_NE', 'n_N1')!;
    expect(n3.custo).toBeLessThan(n1.custo);
  });

  describe('aresta de mão única (anel anti-horário do SS2)', () => {
    it('de n_ss2NE chega em n_SS2O pela faixa norte', () => {
      expect(menorCaminho(M, 'n_ss2NE', 'n_SS2O')).toEqual({
        nos: ['n_ss2NE', 'n_SS2L', 'n_SS2C', 'n_SS2O'],
        custo: 518,
      });
    });

    it('a volta de n_SS2O até n_ss2NE passa pelo anel sul', () => {
      const volta = menorCaminho(M, 'n_SS2O', 'n_ss2NE')!;
      expect(volta.nos).toEqual(['n_SS2O', 'n_ss2SO', 'n_ss2SE', 'n_ss2NE']);
      expect(volta.nos).not.toContain('n_SS2L');
      expect(volta.custo).toBe(890.5);
      expect(volta.custo).toBeGreaterThan(518);
    });
  });

  it.each([
    ['n_SS1', 'n_A_SS1', 'serpentina do SS1 é mão única'],
    ['n_SS1M', 'n_A_SS1M', 'rampa de motos é mão única'],
    ['n_SS1', 'n_A_NE', 'nó sem saída no grafo'],
    ['n_A_NE', 'n_inexistente', 'destino fora do mapa'],
    ['n_inexistente', 'n_A_NE', 'origem fora do mapa'],
  ])('sem rota de %s até %s (%s)', (origem, destino) => {
    expect(menorCaminho(M, origem, destino)).toBeNull();
  });

  it('origem igual ao destino custa zero', () => {
    expect(menorCaminho(M, 'n_N3', 'n_N3')).toEqual({ nos: ['n_N3'], custo: 0 });
  });

  it('ligação entre níveis vale nos dois sentidos com o custo estimado', () => {
    expect(menorCaminho(M, 'n_A_SS1M', 'n_A_NE')).toEqual({ nos: ['n_A_SS1M', 'n_A_NE'], custo: 250 });
  });

  it('ignora ligação entre níveis sem custo estimado', () => {
    const mapa = copiaDoMapa();
    const ligacao = mapa.ligacoesEntreNiveis.find((l) => l.para === 'n_A_SS1')!;
    delete ligacao.custoEstimado;
    expect(menorCaminho(mapa, 'n_A_NE', 'n_SS1')).toBeNull();
  });

  it('aresta a-confirmar vale nos dois sentidos', () => {
    const ida = menorCaminho(M, 'n_A_NE', 'n_N3')!;
    const volta = menorCaminho(M, 'n_N3', 'n_A_NE')!;
    expect(volta.custo).toBe(ida.custo);
    expect(volta.nos).toEqual([...ida.nos].reverse());
  });

  it('não altera o mapa', () => {
    const antes = JSON.stringify(M);
    menorCaminho(M, 'n_A_NE', 'n_S2');
    expect(JSON.stringify(M)).toBe(antes);
  });
});
