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
import type { Nivel, Regiao } from '@parkvision/shared';
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
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
}

const COR_FAIXA: Record<FaixaRegiao, string> = {
  livre: 'var(--pv-faixa-livre)',
  alta: 'var(--pv-faixa-alta)',
  critica: 'var(--pv-faixa-critica)',
  lotada: 'var(--pv-faixa-lotada)',
  indisponivel: 'var(--pv-faixa-indisponivel)',
  'sem-dados': 'var(--pv-faixa-sem-dados)',
};
const PADRAO_FAIXA: Partial<Record<FaixaRegiao, string>> = { lotada: 'xadrez', indisponivel: 'hachura', 'sem-dados': 'pontos' };

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
  const [vx, vy, vw, vh] = zoom ?? nv.viewBox;
  const fs = zoom ? escalaDaArea(zoom) : escalaDoNivel(nivel);

  return (
    <div className={className}>
      <AbasDeNivel nivel={nivel} aoTrocar={trocarNivel} regioes={regioes} destino={destino} trechos={trechos.map((t) => t.nivel)} />
      <div className="relative rounded-lg border border-line overflow-hidden" style={{ background: 'var(--pv-mapa-papel)' }}>
        {enquadrarDestino && destino && nivelDoDestino === nivel && (
          <button onClick={() => setAproximado((a) => !a)} className="absolute top-2 right-2 z-10 h-9 px-3 rounded-md text-sm font-semibold border border-line bg-surface cursor-pointer" aria-pressed={!aproximado}>
            {aproximado ? 'Ver nível inteiro' : 'Aproximar da região'}
          </button>
        )}
        <svg
          data-testid="mapa-estacionamento"
          data-nivel={nivel}
          viewBox={`${vx} ${vy} ${vw} ${vh}`}
          preserveAspectRatio="xMidYMid meet"
          className="block w-full h-auto"
          role="group"
          aria-label={`Mapa do estacionamento — ${nv.nome}`}
        >
          <Padroes id={idBase} fs={fs} />
          {/* 1. planta */}
          <path data-camada="planta" d={tracadoPlanta[nivel].d} fill="none" stroke="var(--pv-mapa-tinta)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" aria-hidden="true" />

          {/* 2. fora da distribuição */}
          {areasForaDaDistribuicao.filter((a) => a.nivel === nivel).map((a) => {
            const [cx, cy] = centro(a.poligono);
            return (
              <g key={a.id} aria-hidden="true">
                <polygon points={a.poligono.map((p) => p.join(',')).join(' ')} fill={`url(#${idBase}-hachura)`} stroke="var(--pv-border-strong)" strokeDasharray={`${fs / 3} ${fs / 4}`} strokeWidth={fs / 12} />
                <text x={cx} y={cy} textAnchor="middle" fontSize={fs * 0.62} fill="var(--pv-text-secondary)" style={{ paintOrder: 'stroke' }} stroke="var(--pv-mapa-papel)" strokeWidth={fs / 5}>Fora da distribuição</text>
              </g>
            );
          })}

          {/* 3. vias */}
          <g data-camada="vias" aria-hidden="true">
            {mapa.arestas.filter((a) => nosPorId[a.de]?.nivel === nivel).map((a) => {
              const p = nosPorId[a.de]!.xy, q = nosPorId[a.para]!.xy;
              return <line key={`${a.de}-${a.para}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="var(--pv-mapa-via)" strokeWidth={fs * 0.55} strokeLinecap="round" />;
            })}
          </g>

          {/* 4. regiões */}
          {mapa.regioes.filter((r) => r.nivel === nivel).map((r) => {
            const vivo = porId[r.id];
            const faixa = vivo ? faixaDaRegiao(vivo) : null;
            const cor = faixa ? COR_FAIXA[faixa] : 'var(--pv-color-asfalto-400)';
            const ehDestino = destino === r.id;
            const apagada = apagarOutras && destino && !ehDestino;
            const pontos = r.poligono.map((p) => p.join(',')).join(' ');
            const [cx, cy] = centro(r.poligono);
            const padrao = faixa && PADRAO_FAIXA[faixa];
            const cong = vivo && congestionada(vivo);
            const interativa = Boolean(aoSelecionar);
            const descricao = vivo
              ? `Região ${r.id}, ${r.nome}: ${vivo.livres} de ${vivo.capacidade} vagas livres, ${ROTULO_FAIXA[faixa!].toLowerCase()}${cong ? ', fluxo elevado' : ''}`
              : `Região ${r.id}, ${r.nome}`;
            const selecionar = () => aoSelecionar?.(r.id);
            const teclado = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selecionar(); } };
            return (
              <g
                key={r.id}
                data-regiao={r.id}
                data-faixa={faixa ?? 'sem-informacao'}
                data-destino={ehDestino || undefined}
                {...(interativa
                  ? { role: 'button', tabIndex: 0, 'aria-pressed': selecionada === r.id, onClick: selecionar, onKeyDown: teclado, style: { cursor: 'pointer' } }
                  : { role: 'img' })}
                aria-label={descricao + (ehDestino && rotuloDestino ? ` — ${rotuloDestino}` : '')}
                opacity={apagada ? 0.35 : 1}
              >
                <title>{descricao}</title>
                <polygon points={pontos} fill={apagada ? 'var(--pv-bg-muted)' : cor} fillOpacity={apagada ? 0.6 : 0.26} stroke={apagada ? 'var(--pv-border-strong)' : cor} strokeWidth={fs / 8} strokeLinejoin="round" />
                {padrao && !apagada && <polygon points={pontos} fill={`url(#${idBase}-${padrao})`} stroke="none" />}
                {selecionada === r.id && <polygon points={pontos} fill="none" stroke="var(--pv-brand-primary)" strokeWidth={fs / 3.2} strokeLinejoin="round" />}
                {ehDestino && (
                  <>
                    <polygon className="mapa-pulso" points={pontos} fill="none" stroke="var(--pv-wayfinding-route)" style={{ ['--pv-pulso-de' as string]: `${fs / 3}px`, ['--pv-pulso-ate' as string]: `${fs * 1.4}px` }} />
                    <polygon points={pontos} fill="none" stroke="var(--pv-wayfinding-route)" strokeWidth={fs / 3} strokeLinejoin="round" />
                  </>
                )}
                <RotuloRegiao id={r.id} x={cx} y={cy} fs={fs} linha2={rotuloLinha2(vivo, faixa)} congestionada={Boolean(cong)} destaque={ehDestino ? rotuloDestino : undefined} apagada={Boolean(apagada)} />
              </g>
            );
          })}

          {/* 5. rota */}
          {trechos.filter((t) => t.nivel === nivel).map((t, i) => <TrechoDeRota key={i} nos={t.nos} rotaCompleta={rota ?? []} fs={fs} idBase={idBase} />)}

          {/* 6. acessos */}
          <g data-camada="acessos" pointerEvents="none">
            {mapa.acessos.filter((a) => a.nivel === nivel).map((a) => {
              const [x, y] = nosPorId[a.no]!.xy;
              return (
                <g key={a.id} data-acesso={a.id} role="img" aria-label={`${a.nome}${a.confianca === 'baixa' ? ' (posição a confirmar)' : ''}`}>
                  <circle cx={x} cy={y} r={fs * 0.42} fill={a.confianca === 'baixa' ? 'var(--pv-mapa-papel)' : 'var(--pv-wayfinding-route)'} stroke="var(--pv-color-asfalto-950)" strokeWidth={fs / 10} strokeDasharray={a.confianca === 'baixa' ? `${fs / 6} ${fs / 8}` : undefined} />
                  <path d={`M${x - fs * 0.18} ${y - fs * 0.16}l${fs * 0.18} ${fs * 0.2} ${fs * 0.18} -${fs * 0.2}`} fill="none" stroke="var(--pv-color-asfalto-950)" strokeWidth={fs / 10} strokeLinecap="round" />
                  <text x={x + fs * 0.6} y={y + fs * 0.25} fontSize={fs * 0.62} fontWeight={600} fill="var(--pv-text-primary)" stroke="var(--pv-mapa-papel)" strokeWidth={fs / 5} style={{ paintOrder: 'stroke', fontFamily: 'var(--pv-font-family-sans)' }}>{nomeCurto(a.nome)}</text>
                </g>
              );
            })}
          </g>
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

function RotuloRegiao({ id, x, y, fs, linha2, congestionada: cong, destaque, apagada }: { id: string; x: number; y: number; fs: number; linha2: string; congestionada: boolean; destaque?: string; apagada: boolean }) {
  const w = fs * (0.62 * id.length + 0.9), h = fs * 1.15;
  return (
    <g pointerEvents="none" aria-hidden="true">
      {destaque && (
        <g>
          <rect x={x - fs * 3} y={y - h / 2 - fs * 1.35} width={fs * 6} height={fs * 0.95} rx={fs * 0.47} fill="var(--pv-wayfinding-route)" />
          <text x={x} y={y - h / 2 - fs * 0.66} textAnchor="middle" fontSize={fs * 0.58} fontWeight={700} fill="var(--pv-wayfinding-on)" style={{ fontFamily: 'var(--pv-font-family-sans)' }}>{destaque}</text>
        </g>
      )}
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={fs * 0.22} fill={apagada ? 'var(--pv-color-asfalto-400)' : 'var(--pv-color-vision-600)'} stroke="#fff" strokeWidth={fs * 0.08} />
      <text x={x} y={y + fs * 0.33} textAnchor="middle" fontSize={fs * 0.9} fontWeight={700} fill="#fff" style={{ fontFamily: 'var(--pv-font-family-display)' }}>{id}</text>
      {linha2 && (
        <text x={x} y={y + h / 2 + fs * 0.82} textAnchor="middle" fontSize={fs * 0.62} fontWeight={600} fill="var(--pv-text-primary)" stroke="var(--pv-mapa-papel)" strokeWidth={fs / 5} style={{ paintOrder: 'stroke', fontFamily: 'var(--pv-font-family-sans)' }} className="num">{linha2}</text>
      )}
      {cong && (
        <g transform={`translate(${x + w / 2 + fs * 0.2} ${y - fs * 0.45})`}>
          <rect width={fs * 0.95} height={fs * 0.9} rx={fs * 0.2} fill="var(--pv-feedback-warning-solid)" stroke="#fff" strokeWidth={fs * 0.06} />
          {[0.25, 0.47, 0.69].map((k) => (
            <path key={k} d={`M${fs * 0.15} ${fs * k}q${fs * 0.16} -${fs * 0.12} ${fs * 0.32} 0t${fs * 0.32} 0`} fill="none" stroke="#fff" strokeWidth={fs * 0.07} strokeLinecap="round" />
          ))}
        </g>
      )}
    </g>
  );
}

function TrechoDeRota({ nos, rotaCompleta, fs, idBase }: { nos: string[]; rotaCompleta: string[]; fs: number; idBase: string }) {
  const pts = nos.map((id) => nosPorId[id]!.xy);
  const d = 'M' + pts.map((p) => p.join(' ')).join('L');
  const primeiro = nos[0]!, ultimo = nos[nos.length - 1]!;
  const idx = rotaCompleta.indexOf(primeiro);
  const veioDeOutroNivel = idx > 0 && ehLigacaoEntreNiveis(rotaCompleta[idx - 1]!, primeiro);
  const prox = rotaCompleta[rotaCompleta.indexOf(ultimo) + 1];
  const vaiParaOutroNivel = prox && ehLigacaoEntreNiveis(ultimo, prox) ? nosPorId[prox]?.nivel : undefined;
  return (
    <g data-camada="rota" data-nos={nos.join(' ')} aria-label="Rota recomendada" role="img" pointerEvents="none">
      {pts.length > 1 && (
        <>
          <path d={d} fill="none" stroke="var(--pv-color-asfalto-950)" strokeOpacity={0.55} strokeWidth={fs * 0.62} strokeLinecap="round" strokeLinejoin="round" />
          <path d={d} fill="none" stroke="var(--pv-wayfinding-route)" strokeWidth={fs * 0.36} strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#${idBase}-seta)`} />
        </>
      )}
      {veioDeOutroNivel && <Chip x={pts[0]![0]} y={pts[0]![1]} fs={fs} texto="Chegada pela rampa" />}
      {vaiParaOutroNivel && <Chip x={pts[pts.length - 1]![0]} y={pts[pts.length - 1]![1]} fs={fs} texto={`Rampa para o ${nomeDoNivel(vaiParaOutroNivel).toLowerCase()}`} />}
      {!veioDeOutroNivel && acessoPorNo[primeiro] && <circle cx={pts[0]![0]} cy={pts[0]![1]} r={fs * 0.55} fill="none" stroke="var(--pv-wayfinding-route)" strokeWidth={fs * 0.16} />}
    </g>
  );
}

function Chip({ x, y, fs, texto }: { x: number; y: number; fs: number; texto: string }) {
  const w = fs * 0.36 * texto.length + fs;
  return (
    <g pointerEvents="none">
      <rect x={x - w / 2} y={y - fs * 1.9} width={w} height={fs} rx={fs / 2} fill="var(--pv-color-asfalto-950)" />
      <text x={x} y={y - fs * 1.2} textAnchor="middle" fontSize={fs * 0.6} fontWeight={600} fill="var(--pv-color-faixa-300)" style={{ fontFamily: 'var(--pv-font-family-sans)' }}>{texto}</text>
    </g>
  );
}

function Padroes({ id, fs }: { id: string; fs: number }) {
  const s = fs * 0.7;
  return (
    <defs>
      <pattern id={`${id}-hachura`} width={s} height={s} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2={s} stroke="var(--pv-color-asfalto-500)" strokeWidth={s / 5} strokeOpacity={0.55} />
      </pattern>
      <pattern id={`${id}-xadrez`} width={s} height={s} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d={`M0 0V${s}M0 0H${s}`} stroke="var(--pv-faixa-lotada)" strokeWidth={s / 6} strokeOpacity={0.6} />
      </pattern>
      <pattern id={`${id}-pontos`} width={s} height={s} patternUnits="userSpaceOnUse">
        <circle cx={s / 2} cy={s / 2} r={s / 6} fill="var(--pv-faixa-sem-dados)" fillOpacity={0.7} />
      </pattern>
      <marker id={`${id}-seta`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="var(--pv-wayfinding-route)" stroke="var(--pv-color-asfalto-950)" strokeWidth="1" />
      </marker>
    </defs>
  );
}

function AbasDeNivel({ nivel, aoTrocar, regioes, destino, trechos }: { nivel: Nivel; aoTrocar: (n: Nivel) => void; regioes?: Regiao[]; destino?: string | null; trechos: Nivel[] }) {
  return (
    <div role="tablist" aria-label="Nível do estacionamento" className="flex gap-1 mb-2 overflow-x-auto">
      {NIVEIS.map((n) => {
        const doNivel = (regioes ?? []).filter((r) => r.nivel === n.id);
        const livres = doNivel.reduce((s, r) => s + (r.operacional ? r.livres : 0), 0);
        const temDestino = destino && regiaoDoMapa[destino]?.nivel === n.id;
        const ativo = n.id === nivel;
        return (
          <button
            key={n.id}
            role="tab"
            aria-selected={ativo}
            onClick={() => aoTrocar(n.id)}
            className="flex items-center gap-2 h-10 px-3 rounded-md text-sm font-semibold whitespace-nowrap cursor-pointer transition-colors"
            style={{
              background: ativo ? 'var(--pv-text-primary)' : 'var(--pv-bg-subtle)',
              color: ativo ? 'var(--pv-bg-surface)' : 'var(--pv-text-secondary)',
            }}
          >
            {nomeDoNivel(n.id)}
            {regioes && <span className="num font-normal opacity-80">{livres} livres</span>}
            {(temDestino || trechos.includes(n.id)) && <span className="size-2 rounded-full" style={{ background: 'var(--pv-wayfinding-route)' }} aria-label={temDestino ? 'destino neste nível' : 'rota passa neste nível'} />}
          </button>
        );
      })}
    </div>
  );
}

export function LegendaMapa() {
  const itens: [FaixaRegiao, string][] = [['livre', '< 70%'], ['alta', '70–89%'], ['critica', '≥ 90%'], ['lotada', 'sem vagas'], ['indisponivel', ''], ['sem-dados', '']];
  return (
    <ul aria-label="Legenda do mapa" className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 text-xs text-ink-2 list-none p-0 m-0">
      {itens.map(([f, extra]) => (
        <li key={f} className="inline-flex items-center gap-1.5">
          <svg width="18" height="12" aria-hidden="true">
            <rect x="1" y="1" width="16" height="10" rx="2" fill={COR_FAIXA[f]} fillOpacity={0.3} stroke={COR_FAIXA[f]} strokeWidth="1.5" />
            {f === 'lotada' && <path d="M3 3l12 6M15 3L3 9" stroke={COR_FAIXA[f]} strokeWidth="1.2" />}
            {f === 'indisponivel' && <path d="M2 10l6-8M8 10l6-8M14 10l2-3" stroke="var(--pv-color-asfalto-500)" strokeWidth="1.2" />}
            {f === 'sem-dados' && <><circle cx="6" cy="6" r="1.4" fill={COR_FAIXA[f]} /><circle cx="12" cy="6" r="1.4" fill={COR_FAIXA[f]} /></>}
          </svg>
          {ROTULO_FAIXA[f]}{extra && <span className="opacity-75">({extra})</span>}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block w-4 h-3 rounded-sm" style={{ background: 'var(--pv-feedback-warning-solid)' }} aria-hidden="true" /> Fluxo elevado
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block w-5 h-1.5 rounded-full" style={{ background: 'var(--pv-wayfinding-route)' }} aria-hidden="true" /> Rota e destino
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block size-3 rounded-full border-2" style={{ background: 'var(--pv-wayfinding-route)', borderColor: 'var(--pv-color-asfalto-950)' }} aria-hidden="true" /> Acesso
      </li>
    </ul>
  );
}
