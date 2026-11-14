/**
 * Easter egg "Sexta-Feira 13": no modo escuro aparece uma pequena abóbora ao lado do botão de tema.
 * Ao tocar nela, uma chuva de abóboras atravessa a tela por alguns segundos.
 *
 * Garantias:
 *  - camada própria (portal no <body>), `pointer-events: none`: nunca bloqueia cliques, formulários, mapa ou tickets;
 *  - nada de dados: não chama a API, não mexe em estado do estacionamento;
 *  - uma chuva por vez; termina sozinha; pode ser dispensada (botão "Parar" ou Esc); nada fica preso na tela;
 *  - só CSS (transform/opacity, aceleradas pela GPU) e ~26 elementos; com `prefers-reduced-motion`,
 *    vira um aparecer/sumir suave, sem queda nem rotação.
 */
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTema } from './tema.tsx';

/** Abóbora de Halloween (desenho próprio; caule no dourado da marca). */
export function Abobora({ tamanho = 32 }: { tamanho?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={tamanho} height={tamanho} aria-hidden="true">
      <path d="M33 13c0-5 3-8 8-9" fill="none" stroke="var(--pv-color-ouro-600)" strokeWidth="4" strokeLinecap="round" />
      <path d="M36 12c6-4 13-2 15 3-6 2-11 1-15-3z" fill="#5E8C2F" />
      <ellipse cx="32" cy="38" rx="28" ry="22" fill="#F07A1A" />
      <ellipse cx="20" cy="38" rx="11" ry="21" fill="#E2660F" />
      <ellipse cx="44" cy="38" rx="11" ry="21" fill="#E2660F" />
      <ellipse cx="32" cy="38" rx="10" ry="22" fill="#F7902E" />
      <path d="M18 33l7-6 6 6zM46 33l-7-6-6 6z" fill="#3A1A04" />
      <path d="M19 44c4 6 22 6 26 0l-4 1-3 3-3-3-3 3-3-3-3 3-3-3z" fill="#3A1A04" />
    </svg>
  );
}

export interface Gota { id: number; esquerda: number; tamanho: number; duracao: number; atraso: number; giroIni: number; giroFim: number; desvio: number; balanco: number }

/** Sorteia as abóboras da chuva (posição, tamanho, velocidade, rotação e trajetória variados, bem distribuídas). */
export function sortearGotas(quantidade: number, aleatorio: () => number = Math.random): Gota[] {
  return Array.from({ length: quantidade }, (_, i) => {
    const faixa = 100 / quantidade;
    return {
      id: i,
      esquerda: Math.min(96, i * faixa + aleatorio() * faixa),     // uma por faixa: espalha sem amontoar
      tamanho: Math.round(18 + aleatorio() * 30),                    // 18–48 px
      duracao: +(3.2 + aleatorio() * 3).toFixed(2),                  // 3,2–6,2 s
      atraso: +(aleatorio() * 1.6).toFixed(2),                       // 0–1,6 s
      giroIni: Math.round(-40 + aleatorio() * 80),
      giroFim: Math.round((aleatorio() < 0.5 ? -1 : 1) * (180 + aleatorio() * 360)),
      desvio: Math.round(-60 + aleatorio() * 120),                   // deriva lateral total (px)
      balanco: Math.round(8 + aleatorio() * 22),                     // balanço lateral (px)
    };
  });
}

const movimentoReduzido = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A chuva em si: camada fixa por cima de tudo, sem capturar cliques. */
export function ChuvaDeAboboras({ aoTerminar }: { aoTerminar: () => void }) {
  const reduzido = useMemo(movimentoReduzido, []);
  const gotas = useMemo(() => sortearGotas(reduzido ? 8 : window.innerWidth < 640 ? 16 : 26), [reduzido]);
  const duracaoTotal = reduzido ? 2200 : Math.max(...gotas.map((g) => (g.atraso + g.duracao) * 1000)) + 150;
  const fim = useRef(aoTerminar);
  fim.current = aoTerminar;
  useEffect(() => {
    const t = setTimeout(() => fim.current(), duracaoTotal);
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fim.current(); };
    window.addEventListener('keydown', tecla);
    return () => { clearTimeout(t); window.removeEventListener('keydown', tecla); };
  }, [duracaoTotal]);

  return createPortal(
    <div className="gp-chuva" data-testid="chuva-aboboras" data-reduzido={reduzido || undefined} aria-hidden="true">
      {gotas.map((g) => (
        <span
          key={g.id}
          className={reduzido ? 'gp-gota gp-gota-suave' : 'gp-gota'}
          data-testid="abobora-caindo"
          style={{
            left: `${g.esquerda}%`,
            top: reduzido ? `${10 + ((g.id * 37) % 70)}%` : undefined,
            animationDuration: reduzido ? '2s' : `${g.duracao}s`,
            animationDelay: reduzido ? `${(g.id % 4) * 0.08}s` : `${g.atraso}s`,
            ['--gp-desvio' as string]: `${g.desvio}px`,
          } as CSSProperties}
        >
          <span
            className="gp-gota-giro"
            style={{
              animationDuration: reduzido ? '0s' : `${g.duracao}s, ${(g.duracao / 3).toFixed(2)}s`,
              animationDelay: reduzido ? '0s' : `${g.atraso}s`,
              ['--gp-giro-ini' as string]: `${g.giroIni}deg`,
              ['--gp-giro-fim' as string]: `${g.giroFim}deg`,
              ['--gp-balanco' as string]: `${g.balanco}px`,
            } as CSSProperties}
          >
            <Abobora tamanho={g.tamanho} />
          </span>
        </span>
      ))}
      {/* único ponto clicável da camada: dispensar o efeito */}
      <button type="button" className="gp-parar" onClick={() => fim.current()} aria-hidden="false" aria-label="Parar a chuva de abóboras" data-testid="parar-chuva">
        <X size={14} aria-hidden /> Parar
      </button>
    </div>,
    document.body,
  );
}

/** Abóbora clicável (só no modo escuro) + controle da chuva. */
export function AboboraEasterEgg() {
  const { tema } = useTema();
  const [chovendo, setChovendo] = useState(false);
  const [mexendo, setMexendo] = useState(false);
  const terminar = useCallback(() => setChovendo(false), []);
  // voltou ao modo claro: some a abóbora e qualquer chuva em andamento
  useEffect(() => { if (tema !== 'escuro') setChovendo(false); }, [tema]);
  if (tema !== 'escuro') return null;
  return (
    <>
      <button
        type="button"
        className={`gp-abobora ${mexendo ? 'gp-abobora-mexe' : ''}`}
        onClick={() => {
          if (chovendo) return; // uma chuva por vez
          setMexendo(true);
          setChovendo(true);
        }}
        onAnimationEnd={(e) => { if (e.animationName === 'gp-abobora-mexe') setMexendo(false); }}
        aria-label="Abóbora de Halloween: toque para uma surpresa"
        title="Sexta-feira 13…"
        data-testid="abobora"
        data-chovendo={chovendo || undefined}
      >
        <Abobora tamanho={30} />
      </button>
      {chovendo && <ChuvaDeAboboras aoTerminar={terminar} />}
    </>
  );
}
