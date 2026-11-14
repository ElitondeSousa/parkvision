/** Golden Park: tema claro/escuro, logos por tema e o easter egg da chuva de abóboras. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sortearGotas } from './AboboraEasterEgg.tsx';
import { BrandLogo } from './BrandLogo.tsx';
import { ControlesTema } from './ControlesTema.tsx';
import { CHAVE_TEMA, ProvedorTema } from './tema.tsx';

const montar = (extra?: React.ReactNode) => render(
  <ProvedorTema>
    <BrandLogo variante="horizontal" />
    <BrandLogo variante="completo" altura={200} />
    <ControlesTema />
    {extra}
  </ProvedorTema>,
);
const logos = () => [...document.querySelectorAll('img[data-logo]')].map((i) => i.getAttribute('src')!);
const alternar = () => fireEvent.click(screen.getByTestId('botao-tema'));
const chuvas = () => document.querySelectorAll('[data-testid="chuva-aboboras"]');

beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.theme; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('temas e logos', () => {
  it('modo claro é o padrão e usa a logo dourada e preta', () => {
    montar();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(logos().length).toBe(3);
    expect(logos().every((s) => s.startsWith('/marca/golden-park-claro-'))).toBe(true);
    expect(screen.getByTestId('botao-tema')).toHaveAttribute('aria-pressed', 'false');
  });

  it('alterna para o escuro sem recarregar, troca a logo para dourada e bege e guarda a preferência', () => {
    montar();
    alternar();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(logos().every((s) => s.startsWith('/marca/golden-park-escuro-'))).toBe(true);
    expect(localStorage.getItem(CHAVE_TEMA)).toBe('escuro');
    alternar();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(CHAVE_TEMA)).toBe('claro');
  });

  it('a preferência salva vale na próxima visita', () => {
    localStorage.setItem(CHAVE_TEMA, 'escuro');
    montar();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(logos()[0]).toContain('-escuro-');
  });

  it('as logos mantêm a proporção original (só a altura é definida) e o ticket pode forçar a versão clara', () => {
    localStorage.setItem(CHAVE_TEMA, 'escuro');
    render(<ProvedorTema><BrandLogo variante="completo" altura={200} /><BrandLogo variante="simbolo" altura={50} tema="claro" /></ProvedorTema>);
    const [completo, simbolo] = [...document.querySelectorAll('img[data-logo]')] as HTMLImageElement[];
    expect(Number(completo!.getAttribute('width')) / Number(completo!.getAttribute('height'))).toBeCloseTo(1089 / 829, 2);
    expect(completo!.style.width).toBe('auto');
    expect(simbolo!.getAttribute('src')).toBe('/marca/golden-park-claro-simbolo.png');
  });
});

describe('easter egg: abóbora e chuva de abóboras', () => {
  it('a abóbora só existe no modo escuro', () => {
    montar();
    expect(screen.queryByTestId('abobora')).not.toBeInTheDocument();
    alternar();
    expect(screen.getByTestId('abobora')).toHaveAccessibleName(/Abóbora de Halloween/);
    alternar();
    expect(screen.queryByTestId('abobora')).not.toBeInTheDocument();
  });

  it('o clique faz chover abóboras variadas numa camada que não bloqueia o resto da interface', () => {
    const outro = vi.fn();
    localStorage.setItem(CHAVE_TEMA, 'escuro');
    montar(<button onClick={outro}>Confirmar estacionamento</button>);
    fireEvent.click(screen.getByTestId('abobora'));
    expect(chuvas()).toHaveLength(1);
    const camada = chuvas()[0]!;
    expect(camada.parentElement).toBe(document.body);        // portal: camada independente
    expect(camada).toHaveClass('gp-chuva');                   // .gp-chuva { pointer-events: none }
    expect(camada).toHaveAttribute('aria-hidden', 'true');
    const gotas = [...camada.querySelectorAll<HTMLElement>('[data-testid="abobora-caindo"]')];
    expect(gotas.length).toBe(26);
    expect(new Set(gotas.map((g) => g.style.animationDuration)).size).toBeGreaterThan(15);   // velocidades diferentes
    const giros = gotas.map((g) => (g.firstElementChild as HTMLElement).style.getPropertyValue('--gp-giro-fim'));
    expect(new Set(giros).size).toBeGreaterThan(15);                                         // rotações diferentes
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar estacionamento' }));
    expect(outro).toHaveBeenCalled();                                                        // resto da tela segue funcionando
  });

  it('uma chuva por vez, que termina sozinha e não deixa nada na tela', () => {
    vi.useFakeTimers();
    localStorage.setItem(CHAVE_TEMA, 'escuro');
    montar();
    fireEvent.click(screen.getByTestId('abobora'));
    fireEvent.click(screen.getByTestId('abobora'));
    expect(chuvas()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(8100); });
    expect(chuvas()).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="abobora-caindo"]')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('abobora'));             // pode ser ativada de novo
    expect(chuvas()).toHaveLength(1);
  });

  it('pode ser dispensada pelo botão Parar ou pela tecla Esc; voltar ao modo claro também encerra', () => {
    localStorage.setItem(CHAVE_TEMA, 'escuro');
    montar();
    fireEvent.click(screen.getByTestId('abobora'));
    fireEvent.click(screen.getByTestId('parar-chuva'));
    expect(chuvas()).toHaveLength(0);
    fireEvent.click(screen.getByTestId('abobora'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(chuvas()).toHaveLength(0);
    fireEvent.click(screen.getByTestId('abobora'));
    alternar();
    expect(chuvas()).toHaveLength(0);
  });

  it('com movimento reduzido, as abóboras só aparecem e somem (sem queda nem giro)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    localStorage.setItem(CHAVE_TEMA, 'escuro');
    montar();
    fireEvent.click(screen.getByTestId('abobora'));
    const gotas = document.querySelectorAll('.gp-gota-suave');
    expect(gotas.length).toBe(8);
    expect(chuvas()[0]).toHaveAttribute('data-reduzido', 'true');
    act(() => { vi.advanceTimersByTime(2300); });
    expect(chuvas()).toHaveLength(0);
  });

  it('em telas pequenas cai menos abóboras; o sorteio espalha posições, tamanhos e velocidades', () => {
    vi.stubGlobal('innerWidth', 375);
    localStorage.setItem(CHAVE_TEMA, 'escuro');
    montar();
    fireEvent.click(screen.getByTestId('abobora'));
    expect(document.querySelectorAll('[data-testid="abobora-caindo"]')).toHaveLength(16);
    const gotas = sortearGotas(20);
    gotas.forEach((g, i) => {
      expect(g.esquerda).toBeGreaterThanOrEqual(i * 5);          // uma por faixa: distribuição equilibrada
      expect(g.esquerda).toBeLessThanOrEqual(Math.min(96, (i + 1) * 5));
      expect(g.tamanho).toBeGreaterThanOrEqual(18); expect(g.tamanho).toBeLessThanOrEqual(48);
      expect(g.duracao).toBeGreaterThanOrEqual(3.2); expect(g.duracao).toBeLessThanOrEqual(6.2);
    });
  });
});
