/**
 * Testes da navegação no mapa: caminho suave pelos nós do grafo, posição ao longo da rota, enquadramento da câmera
 * (o painel inferior não cobre o destino), zoom com limites, janelas por nível, gestos e carrinhos da simulação.
 */
import { menorCaminho } from '@parkvision/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { acessoPorId, mapa, NIVEIS, nosPorId, regiaoDoMapa, trechosDaRota } from './dados.ts';
import { MapaEstacionamento } from './MapaEstacionamento.tsx';
import {
  caixa, caixaDaNavegacao, caminhoSuave, comprimento, enquadrar, janelasPorNivel, pontoNaRota, rotaDeSaida, setasDaRota, zoomEm, type Camera, type Ponto,
} from './navegacao.ts';
import { DURACAO_MAX_MS, DURACAO_MIN_MS, MAX_VEICULOS_ANIMADOS, acrescentarVeiculo, duracaoDoTrajeto, veiculoDeEntrada, veiculoDeSaida } from './veiculos.ts';

const L: Ponto[] = [[0, 0], [100, 0], [100, 100]];
const rota = (de: string, regiao: string) => menorCaminho(mapa, acessoPorId[de]!.no, regiaoDoMapa[regiao]!.noAcesso)!.nos;

describe('caminho da rota', () => {
  it('passa só pelos vértices do grafo e arredonda as quinas', () => {
    const d = caminhoSuave(L, 20);
    expect(d.startsWith('M0 0')).toBe(true);
    expect(d).toContain('Q100 0');      // a quina vira curva com controle no vértice
    expect(d.endsWith('L100 100')).toBe(true);
    expect(caminhoSuave([[0, 0]], 10)).toBe('');
  });

  it('o raio da curva nunca passa da metade do segmento (não sai do corredor)', () => {
    const d = caminhoSuave([[0, 0], [10, 0], [10, 10]], 50);
    expect(d).toContain('L5 0 Q10 0 10 5');
  });

  it('posição e direção ao longo do trajeto', () => {
    expect(comprimento(L)).toBe(200);
    expect(pontoNaRota(L, 0)).toMatchObject({ x: 0, y: 0, angulo: 0 });
    expect(pontoNaRota(L, 0.25)).toMatchObject({ x: 50, y: 0 });
    expect(pontoNaRota(L, 0.75)).toMatchObject({ x: 100, y: 50, angulo: 90 });
    expect(pontoNaRota(L, 2)).toMatchObject({ x: 100, y: 100 }); // limita em 1
  });

  it('setas de sentido só em segmentos longos', () => {
    expect(setasDaRota(L, 50)).toHaveLength(2);
    expect(setasDaRota(L, 150)).toHaveLength(0);
  });
});

describe('câmera', () => {
  it('enquadrar mostra a caixa inteira acima do painel inferior, sem distorcer', () => {
    const cam = enquadrar([0, 0, 200, 100], 400, 800, 300);
    expect(cam[2] / cam[3]).toBeCloseTo(400 / 800);                 // proporção do contêiner
    const escala = cam[2] / 400, visivelMapa = (800 - 300) * escala;
    expect(cam[0]).toBeLessThanOrEqual(0); expect(cam[0] + cam[2]).toBeGreaterThanOrEqual(200);
    expect(cam[1]).toBeLessThanOrEqual(0); expect(cam[1] + visivelMapa).toBeGreaterThanOrEqual(100); // destino acima do painel
  });

  it('zoom em torno do ponto, dentro dos limites do nível', () => {
    const vb = NIVEIS.find((n) => n.id === 'terreo')!.viewBox as Camera;
    const perto = zoomEm(vb, 2, [vb[0], vb[1]], 'terreo');
    expect(perto[2]).toBeCloseTo(vb[2] / 2);
    expect(perto[0]).toBeCloseTo(vb[0]);                           // o ponto de foco não se move
    expect(zoomEm(vb, 1000, [0, 0], 'terreo')[2]).toBeGreaterThan(vb[2] * 0.05);
    expect(zoomEm(vb, 0.0001, [0, 0], 'terreo')[2]).toBeLessThan(Math.max(vb[2], vb[3]) * 1.7);
  });

  it('caixa da navegação inclui a rota do nível e o polígono do destino', () => {
    const nos = rota('A_ROT', 'N2');
    const bx = caixaDaNavegacao(nos, 'N2', 'terreo');
    const doDestino = caixa(regiaoDoMapa['N2']!.poligono);
    expect(bx[0]).toBeLessThanOrEqual(doDestino[0]); expect(bx[2]).toBeGreaterThanOrEqual(doDestino[2]);
    for (const id of nos) { const [x, y] = nosPorId[id]!.xy; expect(x).toBeGreaterThanOrEqual(bx[0]); expect(y).toBeLessThanOrEqual(bx[3]); }
    expect(caixaDaNavegacao(null, null, 'ss1')).toHaveLength(4);   // sem nada: nível inteiro
  });
});

describe('trajeto entre níveis', () => {
  it('janelas por nível em ordem, cobrindo de 0 a 1', () => {
    const nos = rota('A_NE', 'SS2L');
    const j = janelasPorNivel(nos);
    expect(j.map((x) => x.nivel)).toEqual(trechosDaRota(nos).map((t) => t.nivel));
    expect(j[0]!.a).toBe(0);
    expect(j[j.length - 1]!.b).toBeCloseTo(1);
    for (let i = 1; i < j.length; i++) expect(j[i]!.a).toBeGreaterThanOrEqual(j[i - 1]!.b); // a rampa fica entre as janelas
  });

  it('rota de saída volta da região ao acesso por onde o veículo entrou', () => {
    const nos = rotaDeSaida('N3', 'A_NE')!;
    expect(nos[0]).toBe(regiaoDoMapa['N3']!.noAcesso);
    expect(nos[nos.length - 1]).toBe(acessoPorId['A_NE']!.no);
    expect(rotaDeSaida('XX', 'A_NE')).toBeNull();
  });
});

describe('carrinhos da simulação (só visual)', () => {
  const ticket = { codigo: 'PV-1', categoria: 'CARRO_PEQUENO', acessoId: 'A_NE' } as never;
  const nos = rota('A_NE', 'N3');

  it('ritmo: tempo de manobra ÷ velocidade do relógio, dentro de limites', () => {
    expect(duracaoDoTrajeto(nos, { tempoManobraSeg: 60, velocidade: 10 })).toBe(6000);
    expect(duracaoDoTrajeto(nos, { tempoManobraSeg: 90, velocidade: 1 })).toBe(DURACAO_MAX_MS);
    expect(duracaoDoTrajeto(nos, { tempoManobraSeg: 1, velocidade: 600 })).toBe(DURACAO_MIN_MS);
    const semRitmo = duracaoDoTrajeto(nos);
    expect(semRitmo).toBeGreaterThanOrEqual(DURACAO_MIN_MS); expect(semRitmo).toBeLessThanOrEqual(DURACAO_MAX_MS);
  });

  it('entrada usa a rota recomendada; saída faz o caminho de volta', () => {
    const e = veiculoDeEntrada({ ticket, recomendacao: { rota: { nos, custo: 1 } } as never }, 0)!;
    expect(e.nos).toEqual(nos);
    expect(veiculoDeEntrada({ ticket, recomendacao: { rota: { nos: ['x'], custo: 0 } } as never }, 0)).toBeNull();
    const s = veiculoDeSaida({ ticket, regiao: { id: 'N3' } }, 0)!;
    expect(s.nos[0]).toBe(regiaoDoMapa['N3']!.noAcesso);
    expect(veiculoDeSaida({ ticket, regiao: null }, 0)).toBeNull();
  });

  it('limite de carrinhos simultâneos e sem duplicar', () => {
    let lista = [] as ReturnType<typeof acrescentarVeiculo>;
    for (let i = 0; i < MAX_VEICULOS_ANIMADOS + 5; i++) lista = acrescentarVeiculo(lista, { id: `v${i}`, nos, categoria: 'MOTO', inicio: 0, duracao: 1000 });
    expect(lista).toHaveLength(MAX_VEICULOS_ANIMADOS);
    expect(acrescentarVeiculo(lista, { ...lista[0]!, inicio: 5 }).filter((v) => v.id === lista[0]!.id)).toHaveLength(1);
  });

  it('o mapa desenha o carrinho no nível em que ele está', () => {
    const v = { id: 'v', nos, categoria: 'CARRO_GRANDE' as const, inicio: performance.now(), duracao: 5000 };
    const { rerender } = render(<MapaEstacionamento nivel="terreo" veiculos={[v]} />);
    expect(screen.getByTestId('veiculo-simulado')).toHaveAttribute('data-categoria', 'CARRO_GRANDE');
    rerender(<MapaEstacionamento nivel="ss2" veiculos={[v]} />);
    expect(screen.queryByTestId('veiculo-simulado')).not.toBeInTheDocument();
  });
});

describe('gestos do mapa', () => {
  const svgEm = () => {
    const svg = screen.getByTestId('mapa-estacionamento');
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON() {} });
    return svg;
  };

  it('arrastar move a câmera e não seleciona a região', () => {
    const cams: Camera[] = [];
    let selecionou = false;
    render(<MapaEstacionamento nivel="terreo" interativo camera={[405, 50, 1645, 1331]} aoMudarCamera={(c) => cams.push(c)} aoSelecionar={() => { selecionou = true; }} />);
    const svg = svgEm();
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 160, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 160, clientY: 100 });
    return new Promise<void>((ok) => requestAnimationFrame(() => {
      expect(cams.length).toBeGreaterThan(0);
      expect(cams[cams.length - 1]![0]).toBeLessThan(405);           // arrastou para a direita: a câmera vai para a esquerda
      fireEvent.click(svg.querySelector('[data-regiao="N1"]')!);
      expect(selecionou).toBe(false);
      ok();
    }));
  });

  it('roda do mouse aproxima (no localizador basta a roda; no painel pede Ctrl)', () => {
    const cams: Camera[] = [];
    render(<MapaEstacionamento nivel="terreo" interativo zoomComCtrl camera={[405, 50, 1645, 1331]} aoMudarCamera={(c) => cams.push(c)} />);
    const svg = svgEm();
    fireEvent.wheel(svg, { deltaY: -200, clientX: 200, clientY: 200 });
    return new Promise<void>((ok) => requestAnimationFrame(() => {
      expect(cams).toHaveLength(0);                                  // sem Ctrl: a página rola normalmente
      fireEvent.wheel(svg, { deltaY: -200, clientX: 200, clientY: 200, ctrlKey: true });
      requestAnimationFrame(() => { expect(cams[0]![2]).toBeLessThan(1645); ok(); });
    }));
  });
});
