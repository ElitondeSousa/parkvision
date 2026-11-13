/** Testes do mapa: fidelidade à planta, seleção, ocupação, rotas válidas, redimensionamento. */
import { mapaCapimDourado } from '@parkvision/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { regioesDeTeste } from '../testes/apoio.tsx';
import { NIVEIS, enquadramento, orientacaoDaRota, tracadoPlanta, trechoExiste, trechosDaRota } from './dados.ts';
import { MapaEstacionamento } from './MapaEstacionamento.tsx';

const svg = () => screen.getByTestId('mapa-estacionamento');
const regiao = (id: string) => svg().querySelector(`[data-regiao="${id}"]`) as unknown as HTMLElement;
const trocarNivel = (nome: string) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${nome}`) }));

describe('correspondência com a planta', () => {
  it.each(NIVEIS.map((n) => [n.id, n.nome] as const))('nível %s usa o enquadramento, o traçado e os polígonos do mapa aprovado', (id, nome) => {
    render(<MapaEstacionamento />);
    trocarNivel(nome.replace(/\s*\(.*\)/, ''));
    const nv = mapaCapimDourado.niveis.find((n) => n.id === id)!;
    expect(svg().getAttribute('viewBox')).toBe(nv.viewBox.join(' '));
    // traçado vetorial extraído da própria planta (PDF), sem redesenho
    expect(svg().querySelector('[data-camada="planta"]')!.getAttribute('d')).toBe(tracadoPlanta[id].d);
    expect(tracadoPlanta[id].viewBox).toEqual(nv.viewBox);
    // cada região do nível com exatamente os vértices aprovados na Etapa 0
    const doNivel = mapaCapimDourado.regioes.filter((r) => r.nivel === id);
    expect(svg().querySelectorAll('[data-regiao]')).toHaveLength(doNivel.length);
    for (const r of doNivel) expect(regiao(r.id).querySelector('polygon')!.getAttribute('points')).toBe(r.poligono.map((p) => p.join(',')).join(' '));
    // acessos e vias do grafo (as mesmas usadas pela API)
    expect([...svg().querySelectorAll('[data-acesso]')].map((a) => a.getAttribute('data-acesso')).sort()).toEqual(mapaCapimDourado.acessos.filter((a) => a.nivel === id).map((a) => a.id).sort());
    const arestas = mapaCapimDourado.arestas.filter((a) => mapaCapimDourado.nos.find((n) => n.id === a.de)!.nivel === id);
    expect(svg().querySelectorAll('[data-camada="vias"] line')).toHaveLength(arestas.length);
  });

  it('nenhuma região é inventada: as 10 regiões do mapa aparecem uma vez cada', () => {
    render(<MapaEstacionamento />);
    const vistas: string[] = [];
    for (const n of ['Térreo', 'Subsolo 1', 'Subsolo 2']) { trocarNivel(n); vistas.push(...[...svg().querySelectorAll('[data-regiao]')].map((g) => g.getAttribute('data-regiao')!)); }
    expect(vistas.sort()).toEqual(mapaCapimDourado.regioes.map((r) => r.id).sort());
  });
});

describe('seleção de regiões', () => {
  it('clique e teclado selecionam a região e marcam aria-pressed', () => {
    const aoSelecionar = vi.fn();
    const { rerender } = render(<MapaEstacionamento regioes={regioesDeTeste()} aoSelecionar={aoSelecionar} />);
    fireEvent.click(regiao('N3'));
    expect(aoSelecionar).toHaveBeenCalledWith('N3');
    fireEvent.keyDown(regiao('S1'), { key: 'Enter' });
    expect(aoSelecionar).toHaveBeenCalledWith('S1');
    rerender(<MapaEstacionamento regioes={regioesDeTeste()} aoSelecionar={aoSelecionar} selecionada="N3" />);
    expect(regiao('N3')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Região N3, Norte Leste: \d+ de 203 vagas livres/ })).toBeInTheDocument();
  });

  it('sem aoSelecionar o mapa é só leitura (localizador)', () => {
    render(<MapaEstacionamento regioes={regioesDeTeste()} />);
    expect(regiao('N3')).toHaveAttribute('role', 'img');
  });
});

describe('atualização visual da ocupação', () => {
  it('cor, padrão e rótulo mudam com os dados (cor nunca é o único sinal)', () => {
    const { rerender } = render(<MapaEstacionamento regioes={regioesDeTeste()} />);
    expect(regiao('N3')).toHaveAttribute('data-faixa', 'livre');
    rerender(<MapaEstacionamento regioes={regioesDeTeste({
      N3: { ocupadas: 203, livres: 0 }, N2: { ocupadas: 40, livres: 8 }, N1: { operacional: false }, S1: { statusSensores: 'sem-comunicacao' },
      S2: { fluxo: { recente: 12, vazaoReferencia: 6, nivel: 'elevado' } },
    })} />);
    expect(regiao('N3')).toHaveAttribute('data-faixa', 'lotada');
    expect(within(regiao('N3')).getByText('Lotada')).toBeInTheDocument();
    expect(regiao('N3').querySelectorAll('polygon')[1]!.getAttribute('fill')).toMatch(/xadrez/);
    expect(regiao('N2')).toHaveAttribute('data-faixa', 'alta');
    expect(regiao('N1')).toHaveAttribute('data-faixa', 'indisponivel');
    expect(regiao('S1')).toHaveAttribute('data-faixa', 'sem-dados');
    expect(regiao('S2').getAttribute('aria-label')).toMatch(/fluxo elevado/);
  });
});

describe('rotas', () => {
  const rotaSS2 = ['n_A_NE', 'n_A_SS2', 'n_ss2NE', 'n_SS2L'];

  it('a rota só usa trechos existentes no grafo e é dividida por nível', () => {
    expect(trechosDaRota(rotaSS2)).toEqual([{ nivel: 'terreo', nos: ['n_A_NE'] }, { nivel: 'ss2', nos: ['n_A_SS2', 'n_ss2NE', 'n_SS2L'] }]);
    // um salto inexistente (linha reta atravessando o prédio) é descartado
    expect(trechosDaRota(['n_A_NE', 'n_S1'])).toEqual([{ nivel: 'terreo', nos: ['n_A_NE'] }]);
  });

  it('desenha a rota sobre as vias e indica a troca de nível', () => {
    render(<MapaEstacionamento destino="N3" rota={['n_A_NE', 'n_rodNE', 'n_ROT', 'n_N3']} />);
    const desenhada = svg().querySelector('[data-camada="rota"]')!.getAttribute('data-nos')!.split(' ');
    for (let i = 1; i < desenhada.length; i++) expect(trechoExiste(desenhada[i - 1]!, desenhada[i]!)).toBe(true);
    expect(regiao('N3')).toHaveAttribute('data-destino', 'true');

    render(<MapaEstacionamento destino="SS2L" rota={rotaSS2} />);
    expect(screen.getAllByTestId('mapa-estacionamento')[1]).toHaveAttribute('data-nivel', 'ss2'); // abre no nível do destino
    expect(screen.getByText('Chegada pela rampa')).toBeInTheDocument();
  });

  it('orientação em texto vem só do mapa (acesso, nós rotulados, níveis e referência)', () => {
    expect(orientacaoDaRota(['n_A_NE', 'n_rodNE', 'n_ROT', 'n_N3'], 'N3')).toEqual([
      'Entre pelo acesso nordeste.',
      'Passe pela rotatória.',
      'Estacione na região N3 (Norte Leste): fileiras longas entre a rotatória e o bloco Big / Wow Park.',
    ]);
    expect(orientacaoDaRota(rotaSS2, 'SS2L')).toContain('Desça ao subsolo 2 pela rampa.');
  });
});

describe('redimensionamento', () => {
  it('o SVG escala com o contêiner preservando a proporção da planta', () => {
    render(<MapaEstacionamento />);
    expect(svg()).toHaveClass('w-full', 'h-auto');
    expect(svg()).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  });

  it('o localizador aproxima a região e permite ver o nível inteiro', () => {
    render(<MapaEstacionamento destino="S1" enquadrarDestino apagarOutras />);
    const caixa = enquadramento('S1')!;
    expect(svg().getAttribute('viewBox')).toBe(caixa.join(' '));
    const nv = mapaCapimDourado.niveis.find((n) => n.id === 'terreo')!.viewBox;
    expect(caixa[0]).toBeGreaterThanOrEqual(nv[0]); expect(caixa[0] + caixa[2]).toBeLessThanOrEqual(nv[0] + nv[2] + 0.001);
    fireEvent.click(screen.getByRole('button', { name: 'Ver nível inteiro' }));
    expect(svg().getAttribute('viewBox')).toBe(nv.join(' '));
  });
});
