import { afterAll, describe, expect, it } from 'vitest';
import { PESOS_PADRAO, mapaCapimDourado as M } from '@parkvision/shared';
import type { AvaliacaoRegiao, Categoria, MotivoInelegivel } from '@parkvision/shared';
import { menorCaminho, recomendar as recomendarOriginal } from './index.ts';
import type { EntradaRecomendacao, ResultadoRecomendacao } from './index.ts';
import {
  AGORA, REGIOES_CARRO, congelarProfundo, copiaDoMapa, entrada, lotada, mapaSintetico, permutacoes, regiao,
  todasAsRegioes,
} from './testes/apoio.ts';

/** Guarda todas as justificativas geradas para verificar regras gerais de texto no fim. */
const justificativas: string[] = [];
function recomendar(e: EntradaRecomendacao): ResultadoRecomendacao {
  const r = recomendarOriginal(e);
  justificativas.push(r.justificativa);
  return r;
}

const avaliacao = (r: ResultadoRecomendacao, id: string): AvaliacaoRegiao => {
  const a = r.avaliacoes.find((x) => x.regiaoId === id);
  if (!a) throw new Error(`avaliação de ${id} ausente`);
  return a;
};
const regiaoEscolhida = (r: ResultadoRecomendacao): string | null => (r.tipo === 'RECOMENDADA' ? r.regiaoId : null);
const segundosAtras = (s: number): string => new Date(AGORA.getTime() - s * 1000).toISOString();

describe('recomendar — cenário base', () => {
  it('com tudo livre, carro vai para a região mais próxima do acesso nordeste (SS1)', () => {
    const r = recomendar(entrada());
    expect(r.tipo).toBe('RECOMENDADA');
    expect(regiaoEscolhida(r)).toBe('SS1');
  });

  it('avalia todas as regiões na ordem de entrada e guarda critérios, custo e score das elegíveis', () => {
    const regioes = [...todasAsRegioes()].reverse();
    const r = recomendar(entrada({ regioes }));
    expect(r.avaliacoes.map((a) => a.regiaoId)).toEqual(regioes.map((x) => x.id));
    const n3 = avaliacao(r, 'N3');
    expect(n3).toMatchObject({ elegivel: true, custoRota: 477.1 });
    expect(n3.criterios).toEqual({ disponibilidade: 1, distancia: 0.1692, fluxo: 0 });
    expect(n3.score).toBe(0.9493);
    expect(avaliacao(r, 'S2').criterios?.distancia).toBe(1); // a mais distante normaliza em 1
  });

  it('retorna a rota até a região escolhida', () => {
    const r = recomendar(entrada({ regioes: ['N1', 'N2', 'N3'].map((id) => regiao(id)) }));
    expect(r.tipo).toBe('RECOMENDADA');
    if (r.tipo !== 'RECOMENDADA') return;
    expect(r.regiaoId).toBe('N3');
    expect(r.rota).toEqual(menorCaminho(M, 'n_A_NE', 'n_N3'));
    expect(r.score).toBe(avaliacao(r, 'N3').score);
    expect(r.pesos).toEqual(PESOS_PADRAO);
  });
});

describe('recomendar — filtros', () => {
  it.each(REGIOES_CARRO)('região lotada nunca é recomendada (%s lotada)', (id) => {
    const r = recomendar(entrada({ regioes: todasAsRegioes({ [id]: lotada }) }));
    expect(regiaoEscolhida(r)).not.toBe(id);
    expect(avaliacao(r, id)).toEqual({ regiaoId: id, elegivel: false, motivo: 'SEM_VAGAS' });
  });

  it('quando só uma região de carro tem vaga, ela é a recomendada (mesmo sendo a mais longe)', () => {
    const ajustes = Object.fromEntries(REGIOES_CARRO.filter((id) => id !== 'S2').map((id) => [id, lotada]));
    const r = recomendar(entrada({ regioes: todasAsRegioes({ ...ajustes, S2: { livres: 1 } }) }));
    expect(regiaoEscolhida(r)).toBe('S2');
    expect(r.justificativa).toContain('única opção compatível');
    expect(r.justificativa).toContain('As demais estão indisponíveis');
  });

  it('recalcula as vagas livres em vez de confiar no campo recebido', () => {
    const r = recomendar(entrada({ regioes: todasAsRegioes({ SS1: { livres: 0, livresInformado: 50 } }) }));
    expect(avaliacao(r, 'SS1').motivo).toBe('SEM_VAGAS');
    const r2 = recomendar(entrada({ regioes: todasAsRegioes({ SS1: { livres: 140, livresInformado: 0 } }) }));
    expect(regiaoEscolhida(r2)).toBe('SS1');
  });

  it('moto só vai para SS1M; as demais ficam como categoria incompatível', () => {
    const r = recomendar(entrada({ categoria: 'MOTO' }));
    expect(regiaoEscolhida(r)).toBe('SS1M');
    for (const id of REGIOES_CARRO) expect(avaliacao(r, id).motivo).toBe('CATEGORIA_INCOMPATIVEL');
    expect(r.justificativa).toBe(
      'Região SS1M recomendada: é a única opção compatível para moto agora, com 100% das vagas livres.',
    );
    if (r.tipo === 'RECOMENDADA') expect(r.rota.nos).toEqual(['n_A_NE', 'n_A_SS1M', 'n_SS1M']);
  });

  it.each(['CARRO_PEQUENO', 'CARRO_GRANDE'] as Categoria[])(
    'carro (%s) nunca vai para SS1M, mesmo com as regiões de carro quase cheias',
    (categoria) => {
      const quaseCheias = Object.fromEntries(REGIOES_CARRO.map((id) => [id, { livres: 1 }]));
      const r = recomendar(entrada({ categoria, regioes: todasAsRegioes(quaseCheias) }));
      expect(r.tipo).toBe('RECOMENDADA');
      expect(regiaoEscolhida(r)).not.toBe('SS1M');
      expect(avaliacao(r, 'SS1M').motivo).toBe('CATEGORIA_INCOMPATIVEL');
    },
  );

  it('região fora de operação é excluída', () => {
    const r = recomendar(entrada({ regioes: todasAsRegioes({ SS1: { operacional: false } }) }));
    expect(avaliacao(r, 'SS1')).toEqual({ regiaoId: 'SS1', elegivel: false, motivo: 'FORA_DE_OPERACAO' });
    expect(regiaoEscolhida(r)).toBe('N3');
  });

  it.each([
    ['ocupadas maior que a capacidade', { ocupadas: 141 }],
    ['ocupadas negativa', { ocupadas: -1 }],
    ['capacidade zero', { capacidade: 0, ocupadas: 0 }],
    ['capacidade negativa', { capacidade: -10, ocupadas: 0 }],
    ['ocupação não numérica', { ocupadas: Number.NaN }],
  ])('dados inválidos (%s) excluem a região', (_caso, opcoes) => {
    const r = recomendar(entrada({ regioes: todasAsRegioes({ SS1: opcoes }) }));
    expect(avaliacao(r, 'SS1').motivo).toBe('DADOS_INVALIDOS');
    expect(regiaoEscolhida(r)).not.toBe('SS1');
  });

  it.each([
    // idade dos dados, validadeDadosMs, motivo esperado (undefined = elegível)
    ['30 s', segundosAtras(30), 60_000, undefined],
    ['60 s (no limite)', segundosAtras(60), 60_000, undefined],
    ['120 s', segundosAtras(120), 60_000, 'DADOS_INVALIDOS'],
    ['120 s sem validade (null)', segundosAtras(120), null, undefined],
    ['120 s sem validade (undefined)', segundosAtras(120), undefined, undefined],
    ['data ilegível', 'ontem', 60_000, 'DADOS_INVALIDOS'],
  ] as const)('validadeDadosMs: dados de %s', (_caso, atualizadoEm, validadeDadosMs, motivo) => {
    const r = recomendar(entrada({ regioes: todasAsRegioes({ SS1: { atualizadoEm } }), validadeDadosMs }));
    expect(avaliacao(r, 'SS1').motivo).toBe(motivo);
    expect(avaliacao(r, 'SS1').elegivel).toBe(motivo === undefined);
  });

  it('região sem rota a partir do acesso fica com SEM_ROTA', () => {
    const mapa = copiaDoMapa();
    delete mapa.ligacoesEntreNiveis.find((l) => l.para === 'n_A_SS1')!.custoEstimado;
    const r = recomendar(entrada({ mapa }));
    expect(avaliacao(r, 'SS1')).toEqual({ regiaoId: 'SS1', elegivel: false, motivo: 'SEM_ROTA' });
    expect(regiaoEscolhida(r)).toBe('N3');
  });

  it('região que não existe no mapa fica com SEM_ROTA', () => {
    const r = recomendar(entrada({ regioes: [...todasAsRegioes(), regiao('X9', { capacidade: 10 })] }));
    expect(avaliacao(r, 'X9').motivo).toBe('SEM_ROTA');
  });

  it.each([
    ['categoria antes de operação', 'SS1M', { operacional: false }, 'CATEGORIA_INCOMPATIVEL'],
    ['operação antes de dados', 'SS1', { operacional: false, ocupadas: 999 }, 'FORA_DE_OPERACAO'],
    ['operação antes de vagas', 'SS1', { operacional: false, livres: 0 }, 'FORA_DE_OPERACAO'],
    ['dados antes de vagas', 'SS1', { ocupadas: 200 }, 'DADOS_INVALIDOS'],
  ] as const)('ordem dos filtros: %s', (_caso, id, opcoes, motivo: MotivoInelegivel) => {
    const r = recomendar(entrada({ regioes: todasAsRegioes({ [id]: opcoes }) }));
    expect(avaliacao(r, id).motivo).toBe(motivo);
  });
});

describe('recomendar — pontuação e desempate', () => {
  const n2n3 = (livresN3: number) => [regiao('N2'), regiao('N3', { livres: livresN3 })];

  it.each([
    // N2 toda livre; N3 com X livres. Diferença < 0,01 → empate → a mais próxima (N3) vence.
    [165, 'N3', true],
    [160, 'N2', false],
  ])('N3 com %d livres → %s (empate: %s)', (livresN3, esperada, empate) => {
    const r = recomendar(entrada({ regioes: n2n3(livresN3) }));
    const s2 = avaliacao(r, 'N2').score!;
    const s3 = avaliacao(r, 'N3').score!;
    expect(s2).toBeGreaterThan(s3);
    expect(s2 - s3 < 0.01).toBe(empate);
    expect(regiaoEscolhida(r)).toBe(esperada);
    if (empate) expect(r.justificativa).toContain('praticamente empatada com N2');
  });

  it('empate de score e distância é resolvido por mais vagas livres', () => {
    const regioes = [
      regiao('RA', { capacidade: 100, livres: 50 }, mapaSintetico),
      regiao('RB', { capacidade: 120, livres: 60 }, mapaSintetico),
    ];
    const r = recomendar(entrada({ mapa: mapaSintetico, acessoNo: 'o', regioes }));
    expect(avaliacao(r, 'RA').score).toBe(avaliacao(r, 'RB').score);
    expect(regiaoEscolhida(r)).toBe('RB');
    expect(r.justificativa).toContain('tem mais vagas livres (60 contra 50 em RA)');
  });

  it.each(permutacoes(['RB', 'RA']))('empate total é resolvido pelo código da região (ordem %s, %s)', (...ids) => {
    const regioes = ids.map((id) => regiao(id, {}, mapaSintetico));
    const r = recomendar(entrada({ mapa: mapaSintetico, acessoNo: 'o', regioes }));
    expect(regiaoEscolhida(r)).toBe('RA');
    expect(r.justificativa).toContain('vem antes de RB na ordem dos códigos');
  });

  it.each(permutacoes(['R1', 'R2', 'R3']))(
    'empate é medido contra a líder, sem depender da ordem de entrada (%s, %s, %s)',
    (...ids) => {
      // Só disponibilidade conta: R3 = 0,716 (líder, mais longe), R2 = 0,708, R1 = 0,700 (mais perto).
      // R2 empata com a líder e é mais próxima → vence. R1 está a 0,016 da líder → não entra no empate.
      const livres: Record<string, number> = { R1: 700, R2: 708, R3: 716 };
      const regioes = ids.map((id) => regiao(id, { capacidade: 1000, livres: livres[id]! }, mapaSintetico));
      const r = recomendar(entrada({
        mapa: mapaSintetico, acessoNo: 'o', regioes, pesos: { disponibilidade: 1, distancia: 0, fluxo: 0 },
      }));
      expect(regiaoEscolhida(r)).toBe('R2');
    },
  );

  it.each([
    // fluxo recente de N3, vazão de referência de N3, região esperada
    [0, undefined, 'N3'],
    [12, undefined, 'N2'], // 12 / 6 (padrão) → fluxo 1: N3 perde 0,2 e cai para trás de N2
    [12, 24, 'N2'],        // fluxo 0,5
    [12, 60, 'N3'],        // fluxo 0,2: ainda compensa a distância
  ])('fluxo alto troca de região: N3 com fluxo %d e vazão %s → %s', (fluxoN3, vazaoN3, esperada) => {
    const r = recomendar(entrada({
      regioes: ['N1', 'N2', 'N3'].map((id) => regiao(id)),
      fluxoRecente: { N3: fluxoN3 },
      vazaoReferencia: vazaoN3 === undefined ? {} : { N3: vazaoN3 },
    }));
    expect(regiaoEscolhida(r)).toBe(esperada);
  });

  it('justificativa compara com a segunda colocada (disponibilidade, fluxo e distância)', () => {
    const r = recomendar(entrada({
      regioes: [regiao('N1', lotada), regiao('N2', { livres: 20 }), regiao('N3', { livres: 24 })],
      fluxoRecente: { N3: 3 },
    }));
    expect(regiaoEscolhida(r)).toBe('N2');
    expect(r.justificativa).toBe(
      'Região N2 recomendada: tem 42% das vagas livres (N3 tem 12%) e recebeu menos carros nos últimos 5 minutos. ' +
      'Fica mais longe que N3, mas a disponibilidade pesa mais.',
    );
  });

  it('justificativa diz "um pouco mais longe" quando a diferença de distância é pequena', () => {
    const r = recomendar(entrada({ regioes: [regiao('SS1', { livres: 14 }), regiao('N3')] }));
    expect(regiaoEscolhida(r)).toBe('N3');
    expect(r.justificativa).toBe(
      'Região N3 recomendada: tem 100% das vagas livres (SS1 tem 10%). Fica um pouco mais longe que SS1, mas a disponibilidade pesa mais.',
    );
  });

  it('justificativa cita a distância quando a vencedora é a mais próxima', () => {
    const r = recomendar(entrada({ regioes: [regiao('N1'), regiao('N3')] }));
    expect(regiaoEscolhida(r)).toBe('N3');
    expect(r.justificativa).toBe('Região N3 recomendada: fica mais perto da entrada que N1.');
  });
});

describe('recomendar — pesos', () => {
  const n1n3 = () => [regiao('N1'), regiao('N3', { livres: 20 })];

  it.each([
    ['padrão (disponibilidade pesa mais)', undefined, 'N1'],
    ['só distância', { disponibilidade: 0, distancia: 1, fluxo: 0 }, 'N3'],
  ])('pesos %s → %s', (_caso, pesos, esperada) => {
    const r = recomendar(entrada({ regioes: n1n3(), pesos }));
    expect(regiaoEscolhida(r)).toBe(esperada);
  });

  it('normaliza pesos que não somam 1 (5/3/2 equivale ao padrão)', () => {
    const padrao = recomendar(entrada());
    const r = recomendar(entrada({ pesos: { disponibilidade: 5, distancia: 3, fluxo: 2 } }));
    expect(r.pesos.disponibilidade).toBeCloseTo(0.5, 12);
    expect(r.pesos.distancia).toBeCloseTo(0.3, 12);
    expect(r.pesos.fluxo).toBeCloseTo(0.2, 12);
    expect(regiaoEscolhida(r)).toBe(regiaoEscolhida(padrao));
    if (r.tipo === 'RECOMENDADA' && padrao.tipo === 'RECOMENDADA') expect(r.score).toBe(padrao.score);
  });

  it('sobrescreve só o peso informado e normaliza o total', () => {
    const r = recomendar(entrada({ pesos: { distancia: 0.6 } }));
    expect(r.pesos.disponibilidade).toBeCloseTo(0.5 / 1.3, 12);
    expect(r.pesos.distancia).toBeCloseTo(0.6 / 1.3, 12);
    expect(r.pesos.fluxo).toBeCloseTo(0.2 / 1.3, 12);
  });

  it.each([
    ['negativo', { distancia: -1 }],
    ['não numérico', { fluxo: Number.NaN }],
    ['todos zero', { disponibilidade: 0, distancia: 0, fluxo: 0 }],
  ])('rejeita pesos inválidos (%s)', (_caso, pesos) => {
    expect(() => recomendarOriginal(entrada({ pesos }))).toThrow(RangeError);
  });
});

describe('recomendar — sem região elegível', () => {
  it.each([
    [
      'moto com SS1M lotada',
      entrada({ categoria: 'MOTO', regioes: todasAsRegioes({ SS1M: lotada }) }),
      'Nenhuma região disponível para moto agora: SS1M sem vagas.',
    ],
    [
      'carro com tudo lotado e N1 fora de operação',
      entrada({
        regioes: todasAsRegioes({
          ...Object.fromEntries(REGIOES_CARRO.map((id) => [id, lotada])),
          N1: { operacional: false },
          S2: { ocupadas: 999 },
        }),
      }),
      'Nenhuma região disponível para carro pequeno agora: N1 fora de operação; ' +
      'N2, N3, S1, SS1, SS2O, SS2C e SS2L sem vagas; S2 com dados inválidos ou desatualizados.',
    ],
    [
      'lista de regiões vazia',
      entrada({ categoria: 'CARRO_GRANDE', regioes: [] }),
      'Nenhuma região disponível para carro grande agora: nenhuma região aceita carro grande.',
    ],
  ])('%s', (_caso, e, texto) => {
    const r = recomendar(e);
    expect(r.tipo).toBe('SEM_REGIAO');
    expect(r.justificativa).toBe(texto);
    expect(r.avaliacoes.every((a) => !a.elegivel && a.motivo)).toBe(true);
    expect('rota' in r).toBe(false);
  });
});

describe('recomendar — pureza', () => {
  const cenario = () =>
    entrada({
      regioes: todasAsRegioes({ N3: { livres: 30 }, SS1: lotada, S1: { operacional: false } }),
      fluxoRecente: { N2: 4, SS2L: 9 },
      vazaoReferencia: { SS2L: 12 },
      validadeDadosMs: 60_000,
    });

  it('mesma entrada, mesmo resultado', () => {
    expect(recomendar(cenario())).toEqual(recomendar(cenario()));
    const e = cenario();
    expect(recomendar(e)).toEqual(recomendar(e));
  });

  it('a ordem das regiões não muda a escolha nem os scores', () => {
    const base = recomendar(cenario());
    const invertida = recomendar({ ...cenario(), regioes: [...cenario().regioes].reverse() });
    expect(regiaoEscolhida(invertida)).toBe(regiaoEscolhida(base));
    expect(invertida.justificativa).toBe(base.justificativa);
    const scores = (r: ResultadoRecomendacao) => Object.fromEntries(r.avaliacoes.map((a) => [a.regiaoId, a.score]));
    expect(scores(invertida)).toEqual(scores(base));
  });

  it('não altera os objetos de entrada (nem a ocupação: sem reserva)', () => {
    const e = cenario();
    const antes = JSON.stringify(e);
    recomendar(e);
    expect(JSON.stringify(e)).toBe(antes);

    const congelada = congelarProfundo({ ...cenario(), mapa: copiaDoMapa() });
    expect(() => recomendar(congelada)).not.toThrow();
  });

  it('o resultado não compartilha referências mutáveis com a entrada', () => {
    const e = cenario();
    const r = recomendar(e);
    if (r.tipo !== 'RECOMENDADA') throw new Error('esperava recomendação');
    r.rota.nos.push('alterado');
    expect(menorCaminho(e.mapa, e.acessoNo, M.regioes.find((x) => x.id === r.regiaoId)!.noAcesso)!.nos)
      .not.toContain('alterado');
  });
});

afterAll(() => {
  // Regras de texto valem para todas as justificativas geradas nos testes acima.
  expect(justificativas.length).toBeGreaterThan(20);
  for (const texto of justificativas) {
    expect(texto).not.toMatch(/reserv|bloque/i);
    expect(texto.trim().length).toBeGreaterThan(0);
  }
});
