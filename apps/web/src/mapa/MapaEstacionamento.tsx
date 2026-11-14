/**
 * Mapa interativo do estacionamento do Capim Dourado Shopping — componente único, usado no painel, no totem e no localizador.
 *
 * Camadas (de baixo para cima):
 *  1. traçado vetorial da própria planta (PDF), em tinta clara — mantém a organização espacial reconhecível;
 *  2. áreas desenhadas fora da distribuição;
 *  3. vias do grafo (as mesmas que a API usa para calcular rotas);
 *  4. regiões (polígonos aprovados na Etapa 0), coloridas pela ocupação, com padrão e rótulo (cor nunca é o único sinal);
 *  5. rota (âmbar = orientação), sempre sobre as vias do grafo — nunca em linha reta;
 *  6. acessos.
 */
import { vagasDaRegiao, type Categoria, type Nivel, type Regiao, type VagasDoTipo } from '@parkvision/shared';
import { Accessibility } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as EventoPonteiro } from 'react';
import { caminhoSuave, janelasPorNivel, pontoNaRota, setasDaRota, zoomEm, type Camera, type Ponto } from './navegacao.ts';
import {
  NIVEIS, acessoPorNo, areasForaDaDistribuicao, centro, ehLigacaoEntreNiveis, enquadramento, escalaDaArea, escalaDoNivel, mapa, nomeCurto, nomeDoNivel, nosPorId,
  regiaoDoMapa, tracadoPlanta, trechosDaRota,
} from './dados.ts';
import { ROTULO_FAIXA, congestionada, faixaDaRegiao, type FaixaRegiao } from './estado.ts';

export interface MapaEstacionamentoProps {
  /** Dados ao vivo das regiões (API). Sem eles, o mapa mostra só o desenho. */
  regioes?: Regiao[];
  /** Nível exibido (controlado). Se omitido, o mapa controla sozinho e abre no nível do destino. */
  nivel?: Nivel;
  aoTrocarNivel?: (nivel: Nivel) => void;
  selecionada?: string | null;
  aoSelecionar?: (regiaoId: string) => void;
  /** Região destacada: recomendação atual (painel/totem) ou região onde o veículo foi registrado (localizador). */
  destino?: string | null;
  /** Nós da rota devolvidos pela API (recomendacao.rota.nos). */
  rota?: string[] | null;
  /** Localizador: realça só o destino e apaga as demais regiões. */
  apagarOutras?: boolean;
  rotuloDestino?: string;
  /** Abre/acompanha o nível do destino quando ele muda (padrão: sim). O painel desliga para não trocar de nível sozinho. */
  seguirDestino?: boolean;
  /** Abre aproximado na região de destino, com botão para ver o nível inteiro (localizador). */
  enquadrarDestino?: boolean;
  mostrarLegenda?: boolean;
  className?: string;
  /** Câmera controlada (viewBox). Sem ela, o mapa usa o enquadramento do nível (ou o zoom interno, se interativo). */
  camera?: Camera | null;
  aoMudarCamera?: (c: Camera) => void;
  /** Gestos: arrastar (mouse/dedo), pinça e roda do mouse. */
  interativo?: boolean;
  /** Roda do mouse só com Ctrl/⌘ (para não brigar com a rolagem da página). */
  zoomComCtrl?: boolean;
  /** O SVG ocupa toda a altura do contêiner (tela de navegação). */
  preencher?: boolean;
  /** Abas de nível sobrepostas ao mapa (tela de navegação). */
  abasSobrepostas?: boolean;
  /** Pino de destino sobre a região de destino. */
  pinoDestino?: boolean;
  /** Veículos simulados percorrendo rotas (representação visual da simulação, nunca posição real). */
  veiculos?: VeiculoAnimado[];
}

export interface VeiculoAnimado { id: string; nos: string[]; categoria: Categoria; inicio: number; duracao: number }

const COR_FAIXA: Record<FaixaRegiao, string> = {
  livre: 'var(--pv-faixa-livre)',
  alta: 'var(--pv-faixa-alta)',
  critica: 'var(--pv-faixa-critica)',
  lotada: 'var(--pv-faixa-lotada)',
  indisponivel: 'var(--pv-faixa-indisponivel)',
  'sem-dados': 'var(--pv-faixa-sem-dados)',
};
const PADRAO_FAIXA: Partial<Record<FaixaRegiao, string>> = { lotada: 'xadrez', indisponivel: 'hachura', 'sem-dados': 'pontos' };

/**
 * Linguagem visual do mapa (wireframes aprovados): papel, traços finos e neutros, ocupação lida sem gritar.
 * As misturas usam tokens semânticos, então acompanham o tema claro/escuro sem CSS extra:
 *  - contorno: a cor da faixa puxada para a tinta do texto — escurece no claro (verde ≈ #0E6B37, 3:1 ou mais sobre o papel)
 *    e clareia no escuro;
 *  - preenchimento: um véu da cor sobre o papel (sólido, sem opacidade empilhada).
 */
const contornoDa = (cor: string) => `color-mix(in srgb, ${cor} 62%, var(--pv-text-primary))`;
const veuDa = (cor: string, pct = 16) => `color-mix(in srgb, ${cor} ${pct}%, var(--pv-mapa-papel))`;
/** Rota: âmbar de orientação com contorno bronze (contraste não textual no claro; bronze claro no escuro). */
const COR_ROTA = 'var(--pv-wayfinding-route)';
const CONTORNO_ROTA = 'var(--pv-brand-primary)';
/** Destino / seleção: fundo quente claro + contorno bronze. */
const FUNDO_DESTINO = 'var(--pv-brand-subtle)';
/** Piso do tamanho-base dos textos do mapa, em px de tela (o código da região sai com ≈ 0,92 disso). */
const FS_MIN_PX = 14;
const FONTE = { fontFamily: 'var(--pv-font-family-sans)' } as const;
const FONTE_TITULO = { fontFamily: 'var(--pv-font-family-display)' } as const;
/** Texto sobre o mapa: halo da cor do papel para ler por cima de vias e contornos. */
const HALO = (fs: number, estilo: { fontFamily: string } = FONTE) => ({
  stroke: 'var(--pv-mapa-papel)', strokeWidth: fs / 4.5, strokeLinejoin: 'round' as const, style: { paintOrder: 'stroke', ...estilo },
});

export function MapaEstacionamento(props: MapaEstacionamentoProps) {
  const { regioes, selecionada, aoSelecionar, destino, rota, apagarOutras, rotuloDestino, seguirDestino = true, enquadrarDestino = false, mostrarLegenda = true, className } = props;
  const nivelDoDestino = destino ? regiaoDoMapa[destino]?.nivel : undefined;
  const [nivelInterno, setNivelInterno] = useState<Nivel>(props.nivel ?? (seguirDestino ? nivelDoDestino : undefined) ?? 'terreo');
  const nivel = props.nivel ?? nivelInterno;
  useEffect(() => { if (seguirDestino && !props.nivel && nivelDoDestino) setNivelInterno(nivelDoDestino); }, [nivelDoDestino, props.nivel, seguirDestino]);
  const trocarNivel = (n: Nivel) => { setNivelInterno(n); props.aoTrocarNivel?.(n); };

  const idBase = useId().replace(/:/g, '');
  const porId = useMemo(() => Object.fromEntries((regioes ?? []).map((r) => [r.id, r])), [regioes]);
  const trechos = useMemo(() => (rota?.length ? trechosDaRota(rota) : []), [rota]);
  const [aproximado, setAproximado] = useState(true);
  const nv = NIVEIS.find((n) => n.id === nivel)!;
  const zoom = enquadrarDestino && aproximado && destino && nivelDoDestino === nivel ? enquadramento(destino) : null;
  // câmera: controlada > zoom interno (gestos) > aproximação do destino > nível inteiro
  const [camInterna, setCamInterna] = useState<Camera | null>(null);
  useEffect(() => { setCamInterna(null); }, [nivel]);
  const cam: Camera = props.camera ?? camInterna ?? (zoom as Camera | null) ?? (nv.viewBox as Camera);
  const mudarCamera = props.aoMudarCamera ?? setCamInterna;
  const [vx, vy, vw, vh] = cam;
  const base = escalaDoNivel(nivel);
  // gestos (arrastar, pinça, roda) e tamanho do SVG na tela
  const svgRef = useRef<SVGSVGElement>(null);
  const [tela, setTela] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(([e]) => { const r = e!.contentRect; setTela((t) => (t[0] === Math.round(r.width) && t[1] === Math.round(r.height) ? t : [Math.round(r.width), Math.round(r.height)])); });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  // textos e traços com tamanho estável na tela; no celular, piso de legibilidade (≈ 13 px no código da região)
  const pxPorUnidade = tela[0] && tela[1] ? Math.min(tela[0] / vw, tela[1] / vh) : 0;
  const fsBase = Math.min(base * 1.2, Math.max(base * 0.12, escalaDaArea(cam)));
  const fs = pxPorUnidade ? Math.min(Math.max(fsBase, FS_MIN_PX / pxPorUnidade), Math.max(vw, vh) / 14) : fsBase;
  const camRef = useRef(cam); camRef.current = cam;
  const ponteiros = useRef(new Map<number, Ponto>());
  const inicioGesto = useRef<{ cam: Camera; pts: Map<number, Ponto> } | null>(null);
  const arrastou = useRef(false);
  const quadro = useRef(0);
  const escalaTela = (c: Camera) => { const r = svgRef.current!.getBoundingClientRect(); return Math.max(c[2] / (r.width || 1), c[3] / (r.height || 1)); };
  const paraMapa = (x: number, y: number, c: Camera): Ponto => {
    const r = svgRef.current!.getBoundingClientRect(), k = escalaTela(c);
    return [c[0] + (c[2] - r.width * k) / 2 + (x - r.left) * k, c[1] + (c[3] - r.height * k) / 2 + (y - r.top) * k];
  };
  const aplicar = (c: Camera) => { cancelAnimationFrame(quadro.current); quadro.current = requestAnimationFrame(() => mudarCamera(c)); };
  const reiniciarGesto = () => { inicioGesto.current = ponteiros.current.size ? { cam: camRef.current, pts: new Map(ponteiros.current) } : null; };
  const aoApertar = (e: EventoPonteiro<SVGSVGElement>) => {
    if (!props.interativo) return;
    if (ponteiros.current.size === 0) arrastou.current = false;
    ponteiros.current.set(e.pointerId, [e.clientX, e.clientY]); reiniciarGesto();
  };
  const aoMover = (e: EventoPonteiro<SVGSVGElement>) => {
    if (!props.interativo || !ponteiros.current.has(e.pointerId) || !inicioGesto.current) return;
    ponteiros.current.set(e.pointerId, [e.clientX, e.clientY]);
    const { cam: c0, pts: p0 } = inicioGesto.current, ids = [...ponteiros.current.keys()].filter((id) => p0.has(id));
    const k = escalaTela(c0);
    if (ids.length === 1) {
      const [a0, a1] = [p0.get(ids[0]!)!, ponteiros.current.get(ids[0]!)!];
      const dx = a1[0] - a0[0], dy = a1[1] - a0[1];
      if (Math.hypot(dx, dy) > 6) arrastou.current = true;
      if (arrastou.current) aplicar([c0[0] - dx * k, c0[1] - dy * k, c0[2], c0[3]]);
    } else if (ids.length >= 2) {
      const [i, j] = ids as [number, number];
      const d0 = Math.hypot(p0.get(i)![0] - p0.get(j)![0], p0.get(i)![1] - p0.get(j)![1]) || 1;
      const a = ponteiros.current.get(i)!, b = ponteiros.current.get(j)!;
      const m0: Ponto = [(p0.get(i)![0] + p0.get(j)![0]) / 2, (p0.get(i)![1] + p0.get(j)![1]) / 2];
      const m1: Ponto = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      arrastou.current = true;
      const z = zoomEm(c0, Math.hypot(a[0] - b[0], a[1] - b[1]) / d0, paraMapa(m0[0], m0[1], c0), nivel);
      const kz = escalaTela(z);
      aplicar([z[0] - (m1[0] - m0[0]) * kz, z[1] - (m1[1] - m0[1]) * kz, z[2], z[3]]);
    }
  };
  const aoSoltar = (e: EventoPonteiro<SVGSVGElement>) => { ponteiros.current.delete(e.pointerId); reiniciarGesto(); };
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !props.interativo) return;
    const roda = (e: WheelEvent) => {
      if (props.zoomComCtrl && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      aplicar(zoomEm(camRef.current, Math.exp(-e.deltaY * 0.0015), paraMapa(e.clientX, e.clientY, camRef.current), nivel));
    };
    el.addEventListener('wheel', roda, { passive: false });
    return () => el.removeEventListener('wheel', roda);
  });

  return (
    <div className={className}>
      {!props.abasSobrepostas && <AbasDeNivel nivel={nivel} aoTrocar={trocarNivel} regioes={regioes} destino={destino} trechos={trechos.map((t) => t.nivel)} />}
      <div className={props.preencher ? 'relative h-full overflow-hidden' : 'relative rounded-lg border border-line overflow-hidden'} style={{ background: 'var(--pv-mapa-papel)' }}>
        {props.abasSobrepostas && (
          <div className="absolute top-2 left-2 right-2 z-10 pointer-events-none [&>*]:pointer-events-auto">
            <AbasDeNivel nivel={nivel} aoTrocar={trocarNivel} regioes={regioes} destino={destino} trechos={trechos.map((t) => t.nivel)} compactas />
          </div>
        )}
        {props.interativo && camInterna && !props.camera && (
          <button onClick={() => setCamInterna(null)} className="absolute bottom-2 right-2 z-10 h-9 px-3 rounded-md text-sm font-semibold border border-line bg-surface text-ink shadow-[var(--pv-shadow-sm)] cursor-pointer">Reenquadrar</button>
        )}
        {enquadrarDestino && destino && nivelDoDestino === nivel && (
          <button onClick={() => setAproximado((a) => !a)} className="absolute top-2 right-2 z-10 h-9 px-3 rounded-md text-sm font-semibold border border-line bg-surface text-ink shadow-[var(--pv-shadow-sm)] cursor-pointer" aria-pressed={!aproximado}>
            {aproximado ? 'Ver nível inteiro' : 'Aproximar da região'}
          </button>
        )}
        <svg
          data-testid="mapa-estacionamento"
          data-nivel={nivel}
          ref={svgRef}
          viewBox={`${vx} ${vy} ${vw} ${vh}`}
          preserveAspectRatio="xMidYMid meet"
          className={props.preencher ? 'block w-full h-full' : 'block w-full h-auto'}
          role="group"
          aria-label={`Mapa do estacionamento — ${nv.nome}${props.interativo ? '. Arraste para mover e use pinça ou a roda do mouse para aproximar.' : ''}`}
          style={props.interativo ? { touchAction: 'none', cursor: 'grab' } : undefined}
          onPointerDown={aoApertar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerCancel={aoSoltar}
          onPointerLeave={aoSoltar}
        >
          <Padroes id={idBase} fs={fs} />
          {/* 1. planta */}
          <path data-camada="planta" d={tracadoPlanta[nivel].d} fill="none" stroke="var(--pv-mapa-tinta)" strokeWidth={0.7} strokeLinejoin="round" vectorEffect="non-scaling-stroke" aria-hidden="true" />

          {/* 2. fora da distribuição */}
          {areasForaDaDistribuicao.filter((a) => a.nivel === nivel).map((a) => {
            const [cx, cy] = centro(a.poligono);
            return (
              <g key={a.id} aria-hidden="true">
                <polygon points={a.poligono.map((p) => p.join(',')).join(' ')} fill={`url(#${idBase}-hachura)`} stroke="var(--pv-mapa-tinta)" strokeDasharray={`${fs / 3} ${fs / 4}`} strokeWidth={fs / 14} />
                <text x={cx} y={cy} textAnchor="middle" fontSize={fs * 0.56} fontWeight={500} fill="var(--pv-text-muted)" {...HALO(fs)}>Fora da distribuição</text>
              </g>
            );
          })}

          {/* 3. vias: faixa larga e clara, só para dar o desenho da circulação (a rota é que chama a atenção) */}
          <g data-camada="vias" aria-hidden="true" stroke="var(--pv-mapa-via)" strokeWidth={fs * 0.42} strokeLinecap="round">
            {mapa.arestas.filter((a) => nosPorId[a.de]?.nivel === nivel).map((a) => {
              const p = nosPorId[a.de]!.xy, q = nosPorId[a.para]!.xy;
              return <line key={`${a.de}-${a.para}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} />;
            })}
          </g>

          {/* 4. regiões */}
          {mapa.regioes.filter((r) => r.nivel === nivel).map((r) => {
            const vivo = porId[r.id];
            const faixa = vivo ? faixaDaRegiao(vivo) : null;
            const cor = faixa ? COR_FAIXA[faixa] : 'var(--pv-text-muted)';
            const ehDestino = destino === r.id;
            const ehSelecionada = selecionada === r.id;
            const apagada = apagarOutras && destino && !ehDestino;
            const pontos = r.poligono.map((p) => p.join(',')).join(' ');
            const [cx, cy] = centro(r.poligono);
            const padrao = faixa && PADRAO_FAIXA[faixa];
            const cong = vivo && congestionada(vivo);
            const interativa = Boolean(aoSelecionar);
            const reservadas = vivo ? vagasDaRegiao(vivo) : null;
            const textoReservadas = reservadas
              ? [reservadas.PCD.capacidade ? `${reservadas.PCD.livres} de ${reservadas.PCD.capacidade} vagas PcD livres` : '', reservadas.IDOSO.capacidade ? `${reservadas.IDOSO.livres} de ${reservadas.IDOSO.capacidade} vagas para pessoa idosa livres` : ''].filter(Boolean).join(', ')
              : '';
            const descricao = vivo
              ? `Região ${r.id}, ${r.nome}: ${vivo.livres} de ${vivo.capacidade} vagas livres, ${ROTULO_FAIXA[faixa!].toLowerCase()}${cong ? ', fluxo elevado' : ''}${textoReservadas ? `; ${textoReservadas}` : ''}`
              : `Região ${r.id}, ${r.nome}`;
            const selecionar = () => { if (!arrastou.current) aoSelecionar?.(r.id); }; // arrastar o mapa não seleciona
            const teclado = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selecionar(); } };
            return (
              <g
                key={r.id}
                data-regiao={r.id}
                data-faixa={faixa ?? 'sem-informacao'}
                data-destino={ehDestino || undefined}
                data-vagas-pcd={reservadas?.PCD.capacidade ? `${reservadas.PCD.livres}/${reservadas.PCD.capacidade}` : undefined}
                data-vagas-idoso={reservadas?.IDOSO.capacidade ? `${reservadas.IDOSO.livres}/${reservadas.IDOSO.capacidade}` : undefined}
                {...(interativa
                  ? { role: 'button', tabIndex: 0, 'aria-pressed': ehSelecionada, onClick: selecionar, onKeyDown: teclado, style: { cursor: 'pointer' } }
                  : { role: 'img' })}
                aria-label={descricao + (ehDestino && rotuloDestino ? ` — ${rotuloDestino}` : '')}
                opacity={apagada ? 0.5 : 1}
              >
                <title>{descricao}</title>
                {/* base: véu da faixa (ou fundo quente no destino) + contorno escurecido da faixa */}
                <polygon
                  points={pontos}
                  fill={apagada ? 'var(--pv-mapa-via)' : ehDestino ? FUNDO_DESTINO : veuDa(cor, faixa ? 13 : 7)}
                  stroke={apagada ? 'var(--pv-mapa-tinta)' : ehDestino ? CONTORNO_ROTA : faixa ? contornoDa(cor) : 'var(--pv-border-strong)'}
                  strokeWidth={ehDestino ? fs / 5 : fs / 10}
                  strokeLinejoin="round"
                />
                {padrao && !apagada && <polygon points={pontos} fill={`url(#${idBase}-${padrao})`} stroke="none" />}
                {/* seleção (painel): contorno bronze espesso; o destino se distingue pelo pulso, pela rota e pelo rótulo */}
                {ehSelecionada && <polygon data-selecionada points={pontos} fill="none" stroke={CONTORNO_ROTA} strokeWidth={fs / 3.2} strokeLinejoin="round" />}
                {ehDestino && (
                  <polygon className="mapa-pulso" points={pontos} fill="none" stroke={CONTORNO_ROTA} strokeLinejoin="round" style={{ ['--pv-pulso-de' as string]: `${fs / 5}px`, ['--pv-pulso-ate' as string]: `${fs * 1.1}px` }} />
                )}
                <RotuloRegiao id={r.id} x={cx} y={cy} fs={fs} linha2={rotuloLinha2(vivo, faixa)} congestionada={Boolean(cong)} destaque={ehDestino && !props.pinoDestino ? rotuloDestino : undefined} apagada={Boolean(apagada)} semCodigo={ehDestino && props.pinoDestino} ativa={ehDestino || ehSelecionada} />
                {reservadas && !apagada && (reservadas.PCD.capacidade > 0 || reservadas.IDOSO.capacidade > 0) && (
                  <SelosReservadas x={cx} y={cy + fs * (rotuloLinha2(vivo, faixa) ? Y_SELOS.comLinha2 : Y_SELOS.semLinha2)} fs={fs} pcd={reservadas.PCD} idoso={reservadas.IDOSO} />
                )}
              </g>
            );
          })}

          {/* 5. rota */}
          {trechos.filter((t) => t.nivel === nivel).map((t) => <TrechoDeRota key={`${nivel}-${t.nos.join('-')}`} nos={t.nos} rotaCompleta={rota ?? []} fs={fs} idBase={idBase} />)}

          {/* 5b. veículos simulados (demonstração) */}
          {props.veiculos && props.veiculos.length > 0 && <CamadaVeiculos veiculos={props.veiculos} nivel={nivel} fs={fs} />}

          {/* 6. acessos */}
          <g data-camada="acessos" pointerEvents="none">
            {mapa.acessos.filter((a) => a.nivel === nivel).map((a) => {
              const [x, y] = nosPorId[a.no]!.xy;
              const incerto = a.confianca === 'baixa';
              // acesso: disco em tinta com seta de entrada; posição a confirmar = disco vazado e tracejado
              return (
                <g key={a.id} data-acesso={a.id} role="img" aria-label={`${a.nome}${incerto ? ' (posição a confirmar)' : ''}`}>
                  <circle cx={x} cy={y} r={fs * 0.4} fill={incerto ? 'var(--pv-mapa-papel)' : 'var(--pv-text-primary)'} stroke="var(--pv-text-primary)" strokeWidth={fs / 12} strokeDasharray={incerto ? `${fs / 7} ${fs / 9}` : undefined} />
                  <path d={`M${x - fs * 0.16} ${y - fs * 0.08}l${fs * 0.16} ${fs * 0.17} ${fs * 0.16} -${fs * 0.17}`} fill="none" stroke={incerto ? 'var(--pv-text-primary)' : 'var(--pv-mapa-papel)'} strokeWidth={fs / 11} strokeLinecap="round" strokeLinejoin="round" />
                  <text x={x + fs * 0.62} y={y + fs * 0.22} fontSize={fs * 0.56} fontWeight={600} fill="var(--pv-text-secondary)" {...HALO(fs)}>{nomeCurto(a.nome)}</text>
                </g>
              );
            })}
          </g>

          {/* 7. pino de destino: por cima da rota e dos acessos, para a placa nunca ficar coberta */}
          {props.pinoDestino && destino && nivelDoDestino === nivel && regiaoDoMapa[destino] && (() => {
            const [px, py] = centro(regiaoDoMapa[destino]!.poligono);
            return <PinoDestino x={px} y={py} fs={fs} codigo={destino} rotulo={rotuloDestino} />;
          })()}
        </svg>
      </div>
      {mostrarLegenda && <LegendaMapa />}
    </div>
  );
}

function rotuloLinha2(vivo: Regiao | undefined, faixa: FaixaRegiao | null) {
  if (!vivo || !faixa) return '';
  if (faixa === 'indisponivel' || faixa === 'sem-dados' || faixa === 'lotada') return ROTULO_FAIXA[faixa];
  return `${vivo.livres} livres`;
}

/** Deslocamento vertical dos selos de vagas reservadas abaixo do rótulo (com e sem a 2ª linha). */
const Y_SELOS = { comLinha2: 2.05, semLinha2: 1.3 };

/**
 * Rótulo da região: código em texto (sem placa, como nos wireframes) + 2ª linha discreta ("N livres" ou o estado).
 * A placa azul fica reservada ao pino de destino, que repete a sinalização física.
 */
function RotuloRegiao({ id, x, y, fs, linha2, congestionada: cong, destaque, apagada, semCodigo, ativa }: { id: string; x: number; y: number; fs: number; linha2: string; congestionada: boolean; destaque?: string; apagada: boolean; semCodigo?: boolean; ativa?: boolean }) {
  const w = fs * 0.6 * id.length;
  const corCodigo = apagada ? 'var(--pv-text-muted)' : ativa ? 'var(--pv-brand-on-subtle)' : 'var(--pv-text-primary)';
  const larguraDestaque = destaque ? fs * (0.32 * destaque.length + 0.9) : 0;
  return (
    <g pointerEvents="none" aria-hidden="true">
      {destaque && (
        <g>
          <rect x={x - larguraDestaque / 2} y={y - fs * 1.75} width={larguraDestaque} height={fs * 0.92} rx={fs * 0.46} fill={CONTORNO_ROTA} />
          <text x={x} y={y - fs * 1.1} textAnchor="middle" fontSize={fs * 0.56} fontWeight={600} fill="var(--pv-text-on-brand)" style={FONTE}>{destaque}</text>
        </g>
      )}
      {!semCodigo && (
        <text x={x} y={y + fs * 0.32} textAnchor="middle" fontSize={fs * 0.92} fontWeight={700} fill={corCodigo} {...HALO(fs, FONTE_TITULO)}>{id}</text>
      )}
      {linha2 && (
        <text x={x} y={y + fs * 1.22} textAnchor="middle" fontSize={fs * 0.58} fontWeight={500} fill={apagada ? 'var(--pv-text-muted)' : 'var(--pv-text-secondary)'} {...HALO(fs)} className="num">{linha2}</text>
      )}
      {cong && (
        <g transform={`translate(${x + w / 2 + fs * 0.25} ${y - fs * 0.5})`}>
          <rect width={fs * 0.9} height={fs * 0.84} rx={fs * 0.2} fill="var(--pv-feedback-warning-solid)" stroke="var(--pv-mapa-papel)" strokeWidth={fs * 0.06} />
          {[0.23, 0.43, 0.63].map((k) => (
            <path key={k} d={`M${fs * 0.14} ${fs * k}q${fs * 0.155} -${fs * 0.11} ${fs * 0.31} 0t${fs * 0.31} 0`} fill="none" stroke="var(--pv-mapa-papel)" strokeWidth={fs * 0.07} strokeLinecap="round" />
          ))}
        </g>
      )}
    </g>
  );
}

/**
 * Selos de vagas reservadas da região: símbolo de acesso (PcD) e "60+" (pessoa idosa) com as vagas livres do tipo.
 * Ícone + número + contorno: a informação não depende só da cor. Sem vaga livre do tipo, o número fica riscado.
 */
function SelosReservadas({ x, y, fs, pcd, idoso }: { x: number; y: number; fs: number; pcd: VagasDoTipo; idoso: VagasDoTipo }) {
  const k = fs * 0.62;
  const itens = [pcd.capacidade ? { tipo: 'PCD' as const, v: pcd } : null, idoso.capacidade ? { tipo: 'IDOSO' as const, v: idoso } : null].filter(Boolean) as { tipo: 'PCD' | 'IDOSO'; v: VagasDoTipo }[];
  const larg = (v: VagasDoTipo) => k * (1.9 + 0.62 * String(v.livres).length);
  const total = itens.reduce((s, i) => s + larg(i.v), 0) + k * 0.3 * (itens.length - 1);
  let cursor = x - total / 2;
  return (
    <g pointerEvents="none" aria-hidden="true" data-camada="vagas-reservadas">
      {itens.map(({ tipo, v }) => {
        const w = larg(v), x0 = cursor;
        cursor += w + k * 0.3;
        const esgotada = v.livres === 0;
        return (
          <g key={tipo} data-selo-reservada={tipo}>
            <rect x={x0} y={y - k * 0.62} width={w} height={k * 1.24} rx={k * 0.32} fill="var(--pv-mapa-papel)" stroke="var(--pv-vaga-reservada)" strokeWidth={k * 0.1} />
            {tipo === 'PCD'
              ? <Accessibility x={x0 + k * 0.14} y={y - k * 0.5} width={k} height={k} color="var(--pv-vaga-reservada)" strokeWidth={2.6} />
              : <text x={x0 + k * 0.64} y={y + k * 0.27} textAnchor="middle" fontSize={k * 0.62} fontWeight={800} fill="var(--pv-vaga-reservada)" style={{ fontFamily: 'var(--pv-font-family-sans)' }}>60+</text>}
            <text x={x0 + k * 1.35} y={y + k * 0.34} fontSize={k * 0.9} fontWeight={700} fill="var(--pv-text-primary)" textDecoration={esgotada ? 'line-through' : undefined} className="num" style={{ fontFamily: 'var(--pv-font-family-sans)' }}>{v.livres}</text>
          </g>
        );
      })}
    </g>
  );
}

function TrechoDeRota({ nos, rotaCompleta, fs, idBase }: { nos: string[]; rotaCompleta: string[]; fs: number; idBase: string }) {
  const pts = nos.map((id) => nosPorId[id]!.xy);
  const d = caminhoSuave(pts, fs * 1.6);   // só os nós do grafo de vias, com as quinas arredondadas
  const primeiro = nos[0]!, ultimo = nos[nos.length - 1]!;
  const idx = rotaCompleta.indexOf(primeiro);
  const veioDeOutroNivel = idx > 0 && ehLigacaoEntreNiveis(rotaCompleta[idx - 1]!, primeiro);
  const prox = rotaCompleta[rotaCompleta.indexOf(ultimo) + 1];
  const vaiParaOutroNivel = prox && ehLigacaoEntreNiveis(ultimo, prox) ? nosPorId[prox]?.nivel : undefined;
  return (
    <g data-camada="rota" data-nos={nos.join(' ')} aria-label="Rota recomendada" role="img" pointerEvents="none">
      {pts.length > 1 && (
        <>
          {/* contorno bronze (contraste não textual do âmbar sobre o papel) + traço âmbar desenhado ao carregar */}
          <path className="gp-rota-traco" pathLength={1} d={d} fill="none" stroke={CONTORNO_ROTA} strokeWidth={fs * 0.6} strokeLinecap="round" strokeLinejoin="round" />
          <path className="gp-rota-traco" pathLength={1} d={d} fill="none" stroke={COR_ROTA} strokeWidth={fs * 0.34} strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#${idBase}-seta)`} />
          {setasDaRota(pts, fs * 4).map((s, i) => (
            <path key={i} data-seta-rota d={`M${-fs * 0.14} ${-fs * 0.12}L${fs * 0.1} 0L${-fs * 0.14} ${fs * 0.12}`} transform={`translate(${s.x} ${s.y}) rotate(${s.angulo})`} fill="none" stroke="var(--pv-wayfinding-on)" strokeWidth={fs * 0.075} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </>
      )}
      {veioDeOutroNivel && <Chip x={pts[0]![0]} y={pts[0]![1]} fs={fs} texto="Chegada pela rampa" />}
      {vaiParaOutroNivel && <Chip x={pts[pts.length - 1]![0]} y={pts[pts.length - 1]![1]} fs={fs} texto={`Rampa para o ${nomeDoNivel(vaiParaOutroNivel).toLowerCase()}`} />}
      {!veioDeOutroNivel && acessoPorNo[primeiro] && (
        <g data-testid="partida-rota">
          {/* partida: anel bronze sobre o papel com miolo bronze — lê como "início" e não se confunde com o pino */}
          <circle cx={pts[0]![0]} cy={pts[0]![1]} r={fs * 0.58} fill="var(--pv-mapa-papel)" stroke={CONTORNO_ROTA} strokeWidth={fs * 0.16} />
          <circle cx={pts[0]![0]} cy={pts[0]![1]} r={fs * 0.24} fill={CONTORNO_ROTA} />
        </g>
      )}
    </g>
  );
}

function PinoDestino({ x, y, fs: fsBase, codigo, rotulo }: { x: number; y: number; fs: number; codigo: string; rotulo?: string }) {
  const fs = fsBase * 1.45; // o pino é o elemento principal da navegação: maior que os rótulos comuns
  const r = fs * 0.95, w = fs * (0.62 * codigo.length + 0.9);
  return (
    <g data-testid="pino-destino" pointerEvents="none" aria-hidden="true">
      {/* sombra de contato no chão: marca o ponto exato sem filtro */}
      <ellipse cx={x} cy={y} rx={r * 0.42} ry={r * 0.16} fill="var(--pv-text-primary)" fillOpacity={0.18} />
      <path d={`M${x} ${y}c${-r * 0.55} ${-r * 0.9} ${-r * 1.05} ${-r * 1.4} ${-r * 1.05} ${-r * 2.1}a${r * 1.05} ${r * 1.05} 0 1 1 ${r * 2.1} 0c0 ${r * 0.7} ${-r * 0.5} ${r * 1.2} ${-r * 1.05} ${r * 2.1}z`}
        fill={COR_ROTA} stroke={CONTORNO_ROTA} strokeWidth={fs * 0.1} strokeLinejoin="round" />
      {/* placa azul: repete a sinalização física da região */}
      <rect x={x - w / 2} y={y - r * 2.62} width={w} height={fs * 1.05} rx={fs * 0.2} fill="var(--pv-color-vision-600)" stroke="var(--pv-mapa-papel)" strokeWidth={fs * 0.07} />
      <text x={x} y={y - r * 2.62 + fs * 0.82} textAnchor="middle" fontSize={fs * 0.82} fontWeight={700} fill="#fff" style={FONTE_TITULO}>{codigo}</text>
      {rotulo && <text x={x} y={y - r * 3.3} textAnchor="middle" fontSize={fs * 0.6} fontWeight={600} fill="var(--pv-text-primary)" {...HALO(fs)}>{rotulo}</text>}
    </g>
  );
}

const COR_VEICULO: Record<Categoria, string> = { CARRO_PEQUENO: '#F7F4EE', CARRO_GRANDE: '#9AA3AE', MOTO: '#F5A800' };
/** Carrinho visto de cima, apontando para +x (o grupo é girado na direção do trajeto). */
function Carrinho({ categoria, fs }: { categoria: Categoria; fs: number }) {
  if (categoria === 'MOTO') return <ellipse rx={fs * 0.42} ry={fs * 0.17} fill={COR_VEICULO.MOTO} stroke="#0C111C" strokeWidth={fs * 0.06} />;
  const L = categoria === 'CARRO_GRANDE' ? fs * 1.35 : fs * 1.1, W = categoria === 'CARRO_GRANDE' ? fs * 0.62 : fs * 0.55;
  return (
    <g>
      <rect x={-L / 2} y={-W / 2} width={L} height={W} rx={W * 0.32} fill={COR_VEICULO[categoria]} stroke="#0C111C" strokeWidth={fs * 0.06} />
      <rect x={L * 0.06} y={-W * 0.36} width={L * 0.2} height={W * 0.72} rx={W * 0.12} fill="#1B2330" />
    </g>
  );
}

/**
 * Veículos da simulação percorrendo a rota (animação por requestAnimationFrame, sem re-renderizar o React).
 * Em trajetos com rampa, cada nível só mostra o carrinho na sua janela de tempo (ex.: no Térreo até a rampa, depois no Subsolo).
 */
function CamadaVeiculos({ veiculos, nivel, fs }: { veiculos: VeiculoAnimado[]; nivel: Nivel; fs: number }) {
  const refs = useRef(new Map<string, SVGGElement>());
  const percursos = useMemo(() => veiculos.flatMap((v) => {
    const janelas = janelasPorNivel(v.nos);
    const ultima = janelas[janelas.length - 1];
    return janelas.filter((j) => j.nivel === nivel && j.pts.length > 1).map((j) => ({ v, j, final: j === ultima }));
  }), [veiculos, nivel]);
  const posicao = (v: VeiculoAnimado, j: { pts: Ponto[]; a: number; b: number }, final: boolean, agora: number) => {
    const t = (agora - v.inicio) / v.duracao;
    const local = j.b > j.a ? (t - j.a) / (j.b - j.a) : 1;
    // antes da janela: invisível; depois: some (ou, no destino, fica parado um instante e some)
    const visivel = local >= 0 && (local <= 1 || (final && t <= 1.15));
    return { ...pontoNaRota(j.pts, local), visivel };
  };
  useEffect(() => {
    const raf = window.requestAnimationFrame?.bind(window) ?? ((f: FrameRequestCallback) => window.setTimeout(() => f(performance.now()), 16));
    const cancelar = window.cancelAnimationFrame?.bind(window) ?? window.clearTimeout;
    let id = 0;
    const passo = () => {
      const agora = performance.now();
      for (const { v, j, final } of percursos) {
        const g = refs.current.get(`${v.id}-${j.a}`);
        if (!g) continue;
        const p = posicao(v, j, final, agora);
        g.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${p.angulo})`);
        g.style.opacity = p.visivel ? '1' : '0';
      }
      id = raf(passo);
    };
    id = raf(passo);
    return () => cancelar(id);
  }, [percursos]);
  return (
    <g data-camada="veiculos" pointerEvents="none" aria-hidden="true">
      {percursos.map(({ v, j, final }) => {
        const p = posicao(v, j, final, performance.now());
        const chave = `${v.id}-${j.a}`;
        return (
          <g key={chave} ref={(el) => { if (el) refs.current.set(chave, el); else refs.current.delete(chave); }} data-testid="veiculo-simulado" data-categoria={v.categoria}
            transform={`translate(${p.x} ${p.y}) rotate(${p.angulo})`} style={{ opacity: p.visivel ? 1 : 0, transition: 'opacity 250ms' }}>
            <Carrinho categoria={v.categoria} fs={fs} />
          </g>
        );
      })}
    </g>
  );
}

function Chip({ x, y, fs, texto }: { x: number; y: number; fs: number; texto: string }) {
  // troca de nível: etiqueta em tinta invertida (escura no claro, clara no escuro), presa ao ponto por uma haste curta
  const w = fs * 0.33 * texto.length + fs;
  return (
    <g pointerEvents="none">
      <line x1={x} y1={y - fs * 0.5} x2={x} y2={y - fs * 0.95} stroke="var(--pv-text-primary)" strokeWidth={fs * 0.07} strokeLinecap="round" />
      <rect x={x - w / 2} y={y - fs * 1.9} width={w} height={fs * 0.95} rx={fs * 0.24} fill="var(--pv-text-primary)" />
      <text x={x} y={y - fs * 1.25} textAnchor="middle" fontSize={fs * 0.56} fontWeight={600} fill="var(--pv-mapa-papel)" style={FONTE}>{texto}</text>
    </g>
  );
}

function Padroes({ id, fs }: { id: string; fs: number }) {
  const s = fs * 0.7;
  return (
    <defs>
      <pattern id={`${id}-hachura`} width={s} height={s} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2={s} stroke="var(--pv-text-muted)" strokeWidth={s / 6} strokeOpacity={0.4} />
      </pattern>
      <pattern id={`${id}-xadrez`} width={s} height={s} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d={`M0 0V${s}M0 0H${s}`} stroke={contornoDa('var(--pv-faixa-lotada)')} strokeWidth={s / 7} strokeOpacity={0.5} />
      </pattern>
      <pattern id={`${id}-pontos`} width={s} height={s} patternUnits="userSpaceOnUse">
        <circle cx={s / 2} cy={s / 2} r={s / 7} fill={contornoDa('var(--pv-faixa-sem-dados)')} fillOpacity={0.6} />
      </pattern>
      <marker id={`${id}-seta`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill={COR_ROTA} stroke={CONTORNO_ROTA} strokeWidth="1.2" strokeLinejoin="round" />
      </marker>
    </defs>
  );
}

function AbasDeNivel({ nivel, aoTrocar, regioes, destino, trechos, compactas }: { nivel: Nivel; aoTrocar: (n: Nivel) => void; regioes?: Regiao[]; destino?: string | null; trechos: Nivel[]; compactas?: boolean }) {
  return (
    // padrão: abas sublinhadas (bronze) como nos wireframes; compactas (sobre o mapa): segmento com fundo quente na ativa
    <div role="tablist" aria-label="Nível do estacionamento" className={compactas ? 'inline-flex max-w-full overflow-x-auto gap-0.5 p-1 rounded-lg bg-surface border border-line shadow-[var(--pv-shadow-sm)]' : 'flex gap-1 mb-2 overflow-x-auto border-b border-line'}>
      {NIVEIS.map((n) => {
        const doNivel = (regioes ?? []).filter((r) => r.nivel === n.id);
        const livres = doNivel.reduce((s, r) => s + (r.operacional ? r.livres : 0), 0);
        const temDestino = destino && regiaoDoMapa[destino]?.nivel === n.id;
        const ativo = n.id === nivel;
        const estilo = compactas
          ? { background: ativo ? 'var(--pv-brand-subtle)' : 'transparent', color: ativo ? 'var(--pv-brand-on-subtle)' : 'var(--pv-text-secondary)' }
          : { color: ativo ? 'var(--pv-text-primary)' : 'var(--pv-text-secondary)', boxShadow: ativo ? 'inset 0 -2px 0 var(--pv-brand-primary)' : undefined };
        return (
          <button
            key={n.id}
            role="tab"
            aria-selected={ativo}
            onClick={() => aoTrocar(n.id)}
            className={`flex items-center gap-1.5 h-11 ${compactas ? 'px-2.5 rounded-md max-[360px]:px-2' : 'px-3 rounded-t-md'} text-sm whitespace-nowrap cursor-pointer transition-colors ${ativo ? 'font-semibold' : 'font-medium'}`}
            style={estilo}
          >
            {nomeDoNivel(n.id)}
            {regioes && <span className="num font-normal opacity-80">{livres} livres</span>}
            {(temDestino || trechos.includes(n.id)) && <span className="size-2 rounded-full" style={{ background: COR_ROTA, boxShadow: `0 0 0 1.5px ${CONTORNO_ROTA}` }} aria-label={temDestino ? 'destino neste nível' : 'rota passa neste nível'} />}
          </button>
        );
      })}
    </div>
  );
}

/** Legenda compacta, em caixa normal: cada amostra repete o desenho do mapa (véu + contorno + padrão), não só a cor. */
export function LegendaMapa() {
  const itens: [FaixaRegiao, string][] = [['livre', '< 70%'], ['alta', '70–89%'], ['critica', '≥ 90%'], ['lotada', 'sem vagas'], ['indisponivel', ''], ['sem-dados', '']];
  const item = 'inline-flex items-center gap-1.5';
  return (
    <ul aria-label="Legenda do mapa" className="flex flex-wrap gap-x-3.5 gap-y-1 mt-2 text-xs leading-5 text-ink-2 list-none p-0 m-0">
      {itens.map(([f, extra]) => (
        <li key={f} className={item}>
          <svg width="16" height="12" aria-hidden="true" className="shrink-0">
            <rect x="0.75" y="0.75" width="14.5" height="10.5" rx="2" fill={veuDa(COR_FAIXA[f], 22)} stroke={contornoDa(COR_FAIXA[f])} strokeWidth="1.25" />
            {f === 'lotada' && <path d="M3 3l10 6M13 3L3 9" stroke={contornoDa(COR_FAIXA[f])} strokeWidth="1" />}
            {f === 'indisponivel' && <path d="M2 10l6-8M7 10l6-8M12 10l2.5-3.3" stroke="var(--pv-text-muted)" strokeWidth="1" />}
            {f === 'sem-dados' && <><circle cx="5.5" cy="6" r="1.3" fill={contornoDa(COR_FAIXA[f])} /><circle cx="10.5" cy="6" r="1.3" fill={contornoDa(COR_FAIXA[f])} /></>}
          </svg>
          <span>{ROTULO_FAIXA[f]}{extra && <span className="text-ink-3"> {extra}</span>}</span>
        </li>
      ))}
      <li className={item}>
        <span className="inline-block w-3.5 h-3 rounded-[3px] shrink-0" style={{ background: 'var(--pv-feedback-warning-solid)' }} aria-hidden="true" />Fluxo elevado
      </li>
      <li className={item}>
        <span className="inline-block w-5 h-1.5 rounded-full shrink-0" style={{ background: COR_ROTA, boxShadow: `0 0 0 1.5px ${CONTORNO_ROTA}` }} aria-hidden="true" />Rota
      </li>
      <li className={item}>
        <span className="inline-block w-4 h-3 rounded-[3px] shrink-0" style={{ background: FUNDO_DESTINO, boxShadow: `inset 0 0 0 1.5px ${CONTORNO_ROTA}` }} aria-hidden="true" />Destino
      </li>
      <li className={item}>
        <span className="inline-block size-3 rounded-full shrink-0" style={{ background: 'var(--pv-text-primary)' }} aria-hidden="true" />Acesso
      </li>
      <li className={item}>
        <span className="inline-grid place-items-center h-4 px-1 rounded border shrink-0" style={{ borderColor: 'var(--pv-vaga-reservada)', color: 'var(--pv-vaga-reservada)' }} aria-hidden="true"><Accessibility size={11} strokeWidth={2.6} /></span>
        Vagas PcD livres
      </li>
      <li className={item}>
        <span className="inline-grid place-items-center h-4 px-1 rounded border text-[9px] font-bold shrink-0" style={{ borderColor: 'var(--pv-vaga-reservada)', color: 'var(--pv-vaga-reservada)' }} aria-hidden="true">60+</span>
        Vagas para pessoa idosa livres
      </li>
    </ul>
  );
}
