/**
 * Navegação do motorista (aberta pelo QR Code do ticket) — mapa em tela cheia + painel inferior, estilo app de navegação.
 *
 *  - A caminho (ticket AGUARDANDO): destino = região RECOMENDADA, rota pelo grafo de vias a partir do acesso de entrada.
 *    A indicação não reserva vaga e não confirma onde o carro vai ficar.
 *  - Estacionado: destino = região REGISTRADA na confirmação; sem rota (não sabemos de onde a pessoa está vindo).
 *  - Saiu / cancelado: ticket encerrado, sem localização ativa.
 *
 * Sem GPS: nada aqui acompanha a posição real. O "trajeto em demonstração" anima um carrinho e é rotulado como tal.
 * Consulta só os dados deste ticket (GET /localizador/:token) e assina só ele no tempo real (/localizador).
 */
import type { Nivel } from '@parkvision/shared';
import { ArrowLeft, ChevronRight, ChevronUp, Clock, Crosshair, LogOut, Play, QrCode, RefreshCw, Route, SearchX, TicketX, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Botao, Esqueleto, Placa, Selo } from '../../componentes/base.tsx';
import { IconeCategoria } from '../../componentes/IconeCategoria.tsx';
import { SeloTipoVaga } from '../../componentes/IconeTipoVaga.tsx';
import { nomeCurto, nomeDoNivel, orientacaoDaRota, regiaoDoMapa, trechosDaRota } from '../../mapa/dados.ts';
import { NOME_CATEGORIA, dataHora, hora } from '../../mapa/estado.ts';
import { MapaEstacionamento, type VeiculoAnimado } from '../../mapa/MapaEstacionamento.tsx';
import { caixa, caixaDaNavegacao, comprimento, enquadrar, pontosNoNivel, type Camera } from '../../mapa/navegacao.ts';
import { ErroServico, api, type RespostaLocalizador } from '../../servicos/api.ts';
import { useTicketAoVivo } from '../../servicos/tempo-real.ts';
import { BrandLogo } from '../../tema/BrandLogo.tsx';
import { ControlesTema } from '../../tema/ControlesTema.tsx';

/** O token do QR é base64url (16 bytes = 22 caracteres). Formato estranho nem chega a consultar a API. */
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{16,64}$/;

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; dados: RespostaLocalizador }
  | { tipo: 'invalido' }
  | { tipo: 'inexistente' }
  | { tipo: 'sem-conexao' };

const movimentoReduzido = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Localizador() {
  const { token = '' } = useParams();
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });

  const consultar = useCallback(async (silencioso = false) => {
    if (!TOKEN_VALIDO.test(token)) { setEstado({ tipo: 'invalido' }); return; }
    if (!silencioso) setEstado({ tipo: 'carregando' });
    try {
      setEstado({ tipo: 'ok', dados: await api.localizar(token) });
    } catch (e) {
      if (silencioso && !(e instanceof ErroServico && e.codigo === 'TICKET_NAO_ENCONTRADO')) return; // mantém o que já estava na tela
      setEstado(e instanceof ErroServico && e.codigo === 'TICKET_NAO_ENCONTRADO' ? { tipo: 'inexistente' } : { tipo: 'sem-conexao' });
    }
  }, [token]);
  useEffect(() => { void consultar(); }, [consultar]);
  // atualização ao vivo só para o próprio ticket (e só depois de ele existir)
  const aoVivo = useTicketAoVivo(estado.tipo === 'ok' ? token : null, () => void consultar(true));

  const ativo = estado.tipo === 'ok' && (estado.dados.ticket.status === 'AGUARDANDO' || (estado.dados.ticket.status === 'ESTACIONADO' && estado.dados.regiao));
  return (
    <div className="h-[100dvh] flex flex-col bg-canvas text-ink overflow-hidden">
      <Cabecalho subtitulo={estado.tipo === 'ok' ? (estado.dados.ticket.status === 'AGUARDANDO' ? 'Navegação até a região' : estado.dados.ticket.status === 'ESTACIONADO' ? 'Encontre seu veículo' : 'Ticket encerrado') : 'Localizador'} />
      {estado.tipo === 'carregando' ? (
        <div role="status" aria-label="Consultando o ticket" className="flex-1 relative"><Esqueleto className="absolute inset-0 rounded-none" /></div>
      ) : estado.tipo === 'invalido' ? (
        <Mensagem icone={QrCode} titulo="QR Code inválido">Este endereço não corresponde a um ticket do Golden Park. Escaneie de novo o QR Code impresso no ticket.</Mensagem>
      ) : estado.tipo === 'inexistente' ? (
        <Mensagem icone={SearchX} titulo="Ticket não encontrado">Confira se escaneou o QR Code do seu ticket. Se o problema continuar, procure o atendimento do estacionamento.</Mensagem>
      ) : estado.tipo === 'sem-conexao' ? (
        <Mensagem icone={WifiOff} titulo="Sem conexão com o Golden Park" acao={<Botao icone={RefreshCw} onClick={() => void consultar()}>Tentar de novo</Botao>}>Verifique a internet do celular e tente de novo.</Mensagem>
      ) : ativo ? (
        <Navegacao dados={estado.dados} aoVivo={aoVivo === 'conectado'} />
      ) : (
        <Encerrado dados={estado.dados} />
      )}
    </div>
  );
}

function Cabecalho({ subtitulo }: { subtitulo: string }) {
  const podeVoltar = typeof window !== 'undefined' && window.history.length > 1;
  return (
    <header className="flex items-center gap-2 px-3 h-14 shrink-0 border-b border-line bg-surface" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {podeVoltar && (
        <button type="button" onClick={() => window.history.back()} aria-label="Voltar" className="grid place-items-center size-10 rounded-full cursor-pointer hover:bg-subtle"><ArrowLeft size={20} aria-hidden /></button>
      )}
      <BrandLogo variante="simbolo" altura={30} />
      <div className="min-w-0 mr-auto leading-tight">
        <p className="m-0 font-display font-semibold text-base">Golden Park</p>
        <p className="m-0 text-xs text-ink-2 truncate">{subtitulo}</p>
      </div>
      <ControlesTema />
    </header>
  );
}

function Navegacao({ dados, aoVivo }: { dados: RespostaLocalizador; aoVivo: boolean }) {
  const { ticket, regiao, recomendada, orientacao, rota, acesso, caminhoPedestre } = dados;
  // vaga reservada (PcD / pessoa idosa): o tipo aparece no painel e no pino; nada de afirmar rota acessível não validada
  const tipoVaga = ticket.tipoVaga ?? 'COMUM';
  const reservada = tipoVaga !== 'COMUM';
  const sinalizacao = reservada ? `Procure as vagas sinalizadas ${tipoVaga === 'PCD' ? 'para PcD' : 'para pessoa idosa'} e use-as só com a credencial válida à vista.` : null;
  const chegando = ticket.status === 'AGUARDANDO';
  const destino = chegando ? recomendada.id : regiao!.id;
  const nos = chegando ? rota?.nos ?? null : null;
  const doMapa = regiaoDoMapa[destino];
  // níveis por onde a rota passa, na ordem (ex.: Térreo → Subsolo 2); a caminho, o mapa abre no nível da entrada
  const trechos = useMemo(() => (nos ? trechosDaRota(nos).filter((t) => t.nos.length > 1) : []), [nos]);
  const [nivel, setNivel] = useState<Nivel>(trechos[0]?.nivel ?? doMapa?.nivel ?? 'terreo');
  const iTrecho = trechos.findIndex((t) => t.nivel === nivel);
  const proximo = iTrecho >= 0 ? trechos[iTrecho + 1] : undefined;
  // o destino mudou ao vivo (ex.: estacionamento confirmado em outra região): o mapa vai para o nível dele
  const nivelInicial = trechos[0]?.nivel ?? doMapa?.nivel ?? 'terreo';
  const ultimoDestino = useRef(destino);
  useEffect(() => {
    if (ultimoDestino.current === destino) return;
    ultimoDestino.current = destino;
    setNivel(nivelInicial);
  }, [destino, nivelInicial]);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [expandido, setExpandido] = useState(false);
  const [demo, setDemo] = useState<VeiculoAnimado | null>(null);
  const mapaRef = useRef<HTMLDivElement>(null), painelRef = useRef<HTMLDivElement>(null);
  const passos = useMemo(() => {
    const base = nos ? orientacaoDaRota(nos, destino) : [...orientacao, ...(doMapa?.coberta ? [`Fica em área coberta (${nomeDoNivel(doMapa.nivel).toLowerCase()}).`] : [])];
    return sinalizacao && !base.includes(sinalizacao) && !base.some((p) => p.includes('credencial')) ? [...base, sinalizacao] : base;
  }, [nos, destino, orientacao, doMapa, sinalizacao]);

  /** enquadra a rota inteira ou só o destino na parte do mapa que o painel não cobre */
  const ajustar = useCallback((tipo: 'rota' | 'destino', n: Nivel = nivel) => {
    const el = mapaRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    const painel = painelRef.current?.getBoundingClientRect().height ?? 0;
    const r = regiaoDoMapa[destino];
    const bbox = tipo === 'destino' && r?.nivel === n ? caixa(r.poligono) : caixaDaNavegacao(nos, destino, n);
    setCamera(enquadrar(bbox, width, height, Math.min(painel, height * 0.6) + 16, tipo === 'destino' ? 2.2 : 1.4));
  }, [nivel, destino, nos]);
  useEffect(() => {
    ajustar('rota');
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => ajustar('rota')) : null;
    if (mapaRef.current) ro?.observe(mapaRef.current);
    return () => ro?.disconnect();
    // reenquadra quando o destino/rota mudam (ex.: ticket confirmado ao vivo)
  }, [destino, nos?.join(','), ajustar]);

  // ao abrir/fechar o painel, reenquadra para o destino continuar visível acima dele
  useEffect(() => { const id = window.requestAnimationFrame?.(() => ajustar('rota')); return () => { if (id) window.cancelAnimationFrame(id); }; }, [expandido]); // eslint-disable-line react-hooks/exhaustive-deps
  const trocarNivel = (n: Nivel) => { setNivel(n); ajustar('rota', n); };
  const centralizar = () => { const n = doMapa?.nivel ?? nivel; setNivel(n); ajustar('destino', n); };
  // demonstração: um carrinho percorre cada trecho da rota, nível a nível (ritmo fixo, não é a posição real)
  const timers = useRef<number[]>([]);
  const pararDemo = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; setDemo(null); };
  useEffect(() => pararDemo, []);
  const verDemonstracao = () => {
    if (!trechos.length) return;
    pararDemo();
    setExpandido(false); // recolhe o painel para o trajeto ficar à vista
    const durs = trechos.map((t) => Math.min(9000, Math.max(2500, (comprimento(pontosNoNivel(t.nos, t.nivel)) / 90) * 1000)));
    let atraso = 0;
    trechos.forEach((t, i) => {
      timers.current.push(window.setTimeout(() => {
        setNivel(t.nivel); ajustar('rota', t.nivel);
        setDemo({ id: `demo-${i}-${Date.now()}`, nos: t.nos, categoria: ticket.categoria, inicio: performance.now(), duracao: durs[i]! });
      }, atraso));
      atraso += durs[i]! + 400;
    });
    timers.current.push(window.setTimeout(() => setDemo(null), atraso + 500));
  };

  return (
    <div className="flex-1 relative min-h-0">
      <div ref={mapaRef} className="absolute inset-0">
        <MapaEstacionamento
          className="h-full"
          preencher
          abasSobrepostas
          interativo
          pinoDestino
          mostrarLegenda={false}
          nivel={nivel}
          aoTrocarNivel={trocarNivel}
          camera={camera}
          aoMudarCamera={setCamera}
          destino={destino}
          rota={nos}
          apagarOutras={!chegando}
          rotuloDestino={chegando ? (reservada ? (tipoVaga === 'PCD' ? 'Vaga PcD' : 'Vaga 60+') : 'Seu destino') : 'Seu veículo'}
          veiculos={demo ? [demo] : undefined}
        />
      </div>
      {proximo && !demo && (
        <button type="button" onClick={() => trocarNivel(proximo.nivel)} className="absolute top-16 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 h-10 px-4 rounded-full text-sm font-semibold shadow-[var(--pv-shadow-md)] cursor-pointer" style={{ background: 'var(--pv-wayfinding-route)', color: 'var(--pv-wayfinding-on)' }}>
          A rota continua no {nomeDoNivel(proximo.nivel)} <ChevronRight size={16} aria-hidden />
        </button>
      )}
      {demo && (
        <p role="status" className="absolute top-16 left-1/2 -translate-x-1/2 z-10 m-0 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shadow-[var(--pv-shadow-md)]" style={{ background: 'var(--pv-wayfinding-subtle)', border: '1px solid var(--pv-wayfinding-route)' }}>
          Demonstração do trajeto — não é a sua localização
        </p>
      )}
      {/* botões do mapa, acima do painel */}
      <div className="absolute right-3 z-10 flex flex-col gap-2" style={{ bottom: 'calc(var(--gp-painel, 168px) + 12px)' }}>
        {nos && <BotaoMapa rotulo="Ver rota inteira" icone={Route} onClick={() => ajustar('rota')} />}
        <BotaoMapa rotulo={chegando ? 'Centralizar no destino' : 'Centralizar no veículo'} icone={Crosshair} onClick={centralizar} />
      </div>
      <Painel ref={painelRef} expandido={expandido} aoAlternar={() => setExpandido((x) => !x)} aoArrastar={setExpandido}>
        <div className="flex items-start gap-3">
          <Placa codigo={destino} tamanho="lg" />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-xs text-ink-2">{chegando ? 'Seu destino' : 'Seu veículo está em'}</p>
            <h1 className="text-2xl font-bold leading-tight" data-testid={chegando ? 'regiao-destino' : 'regiao-registrada'}>{chegando ? recomendada.nome : regiao!.nome}</h1>
            <p className="m-0 text-sm text-ink-2">{doMapa ? nomeDoNivel(doMapa.nivel) : ''}{ticket.simulado ? <> · <Selo tom="atencao">Demonstração</Selo></> : null}</p>
            {reservada && <div className="mt-1.5"><SeloTipoVaga tipo={tipoVaga} /></div>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-testid="estado-navegacao">
          {chegando ? (
            <>
              <Selo tom="info" icone={Route}>Estacionamento ainda não confirmado</Selo>
              <span className="text-ink-2">{acesso ? `Partida: ${nomeCurto(acesso.nome)}` : 'Siga as orientações'}</span>
            </>
          ) : (
            <>
              <Selo tom="sucesso" icone={Clock}>Estacionado{ticket.estacionadoEm ? ` às ${hora(ticket.estacionadoEm)}` : ''}</Selo>
              <span className="text-ink-2">Estacionamento confirmado às {ticket.estacionadoEm ? hora(ticket.estacionadoEm) : '—'}</span>
            </>
          )}
        </div>
        {chegando && <p className="m-0 mt-2 text-xs text-ink-3">A indicação considera a ocupação do momento da entrada e não reserva vaga.</p>}
        {reservada && <p className="m-0 mt-1 text-xs text-ink-2" data-testid="info-vaga-reservada">Vaga reservada: use só com a credencial válida à vista no veículo.</p>}

        <div id="detalhes-navegacao" hidden={!expandido} className="mt-4 grid gap-4">
          <section aria-labelledby="titulo-orientacao">
            <h2 id="titulo-orientacao" className="text-base font-semibold">{chegando ? 'Como chegar' : 'Como encontrar'}</h2>
            {!nos && chegando && <p className="m-0 mt-1 text-sm text-ink-2">Rota indisponível no momento — siga as orientações abaixo.</p>}
            <ol className="mt-2 m-0 p-0 list-none grid gap-2" data-testid="orientacao">
              {passos.map((p, i) => (
                <li key={p} className="flex gap-3 text-sm">
                  <span className="grid place-items-center size-6 shrink-0 rounded-full text-xs font-bold num" style={{ background: 'var(--pv-wayfinding-route)', color: 'var(--pv-wayfinding-on)' }}>{i + 1}</span>
                  <span className="pt-0.5">{p}</span>
                </li>
              ))}
            </ol>
          </section>
          {reservada && (
            <section aria-labelledby="titulo-reservada" className="rounded-lg border border-line-subtle p-3 text-sm grid gap-1">
              <h2 id="titulo-reservada" className="text-base font-semibold">Vaga reservada</h2>
              <p className="m-0 text-ink-2">O Golden Park não verifica a credencial: a indicação segue o tipo de vaga escolhido no totem.</p>
              {caminhoPedestre && <p className="m-0 text-ink-2" data-testid="caminho-pedestre">Caminho a pé: {caminhoPedestre.texto}</p>}
            </section>
          )}
          {chegando && nos && !movimentoReduzido() && (
            <Botao variante="secundario" icone={Play} onClick={verDemonstracao} disabled={Boolean(demo)}>Ver trajeto em demonstração</Botao>
          )}
          <section aria-labelledby="titulo-ticket" className="rounded-lg border border-line-subtle p-3 text-sm">
            <h2 id="titulo-ticket" className="text-base font-semibold mb-2">Ticket</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 m-0">
              <dt className="text-ink-2">Código</dt><dd className="m-0 font-mono" data-testid="codigo-ticket">{ticket.codigo}</dd>
              <dt className="text-ink-2">Veículo</dt><dd className="m-0 flex items-center gap-2"><IconeCategoria categoria={ticket.categoria} tamanho={26} className="text-ink-2" />{NOME_CATEGORIA[ticket.categoria]}</dd>
              <dt className="text-ink-2">Entrada</dt><dd className="m-0 num">{dataHora(ticket.entradaEm)}</dd>
            </dl>
          </section>
          <p className="m-0 text-xs text-ink-3">O Golden Park não rastreia o veículo: {chegando ? 'o mapa mostra a região indicada na entrada e o caminho pelas vias do estacionamento.' : 'esta é a região registrada quando o estacionamento foi confirmado.'}</p>
          <p className="m-0 text-xs text-ink-3" role="status" data-testid="ao-vivo">
            {aoVivo ? 'Esta página se atualiza sozinha quando o ticket muda.' : 'Sem atualização automática no momento — recarregue a página para ver mudanças.'}
          </p>
        </div>
      </Painel>
    </div>
  );
}

function BotaoMapa({ rotulo, icone: Icone, onClick }: { rotulo: string; icone: typeof Route; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} className="grid place-items-center size-12 rounded-full bg-surface border border-line text-ink shadow-[var(--pv-shadow-md)] cursor-pointer active:scale-95 transition-transform">
      <Icone size={20} aria-hidden />
    </button>
  );
}

/** Painel inferior (bottom sheet): toque na alça alterna; arrastar para cima expande e para baixo recolhe. */
function Painel({ ref, expandido, aoAlternar, aoArrastar, children }: { ref: React.Ref<HTMLDivElement>; expandido: boolean; aoAlternar: () => void; aoArrastar: (expandir: boolean) => void; children: ReactNode }) {
  const inicio = useRef<number | null>(null);
  const local = useRef<HTMLDivElement>(null);
  // a altura do painel vira uma variável CSS: os botões do mapa ficam sempre acima dele
  useEffect(() => {
    const el = local.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => el.parentElement?.style.setProperty('--gp-painel', `${el.getBoundingClientRect().height}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={(el) => { local.current = el; if (typeof ref === 'function') ref(el); else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
      data-testid="painel-navegacao"
      data-expandido={expandido}
      className="absolute bottom-0 inset-x-0 z-20 mx-auto max-w-xl bg-surface rounded-t-2xl border-t border-x border-line shadow-[0_-8px_24px_rgba(0,0,0,0.12)] flex flex-col"
      style={{ maxHeight: expandido ? '62%' : undefined, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <button
        type="button"
        onClick={aoAlternar}
        onPointerDown={(e) => { inicio.current = e.clientY; }}
        onPointerUp={(e) => { if (inicio.current === null) return; const dy = e.clientY - inicio.current; inicio.current = null; if (Math.abs(dy) > 30) { e.preventDefault(); aoArrastar(dy < 0); } }}
        aria-expanded={expandido}
        aria-controls="detalhes-navegacao"
        aria-label={expandido ? 'Recolher detalhes' : 'Mostrar detalhes'}
        className="w-full pt-2 pb-1 flex flex-col items-center gap-0.5 cursor-pointer touch-none"
      >
        <span className="block w-10 h-1.5 rounded-full bg-[var(--pv-border-strong)]" aria-hidden />
        <ChevronUp size={16} aria-hidden className="text-ink-3 transition-transform" style={{ transform: expandido ? 'rotate(180deg)' : undefined }} />
      </button>
      <div className="px-4 overflow-y-auto">{children}</div>
    </div>
  );
}

function Encerrado({ dados }: { dados: RespostaLocalizador }) {
  const { ticket, regiao } = dados;
  return ticket.status === 'SAIU' ? (
    <Mensagem icone={LogOut} titulo="Este veículo já saiu">
      A saída foi registrada {ticket.saidaEm ? `em ${dataHora(ticket.saidaEm)}` : ''}{regiao ? `, da região ${regiao.id}` : ''}. O ticket <span className="font-mono">{ticket.codigo}</span> está encerrado e não há localização ativa.
    </Mensagem>
  ) : (
    <Mensagem icone={TicketX} titulo="Ticket cancelado">O ticket <span className="font-mono">{ticket.codigo}</span> foi cancelado antes do estacionamento ser confirmado. Não há localização ativa.</Mensagem>
  );
}

function Mensagem({ icone: Icone, titulo, children, acao }: { icone: typeof Clock; titulo: string; children: ReactNode; acao?: ReactNode }) {
  return (
    <main className="flex-1 grid place-items-center px-4">
      <section role="alert" className="flex flex-col items-center text-center gap-3 rounded-xl border border-line bg-surface px-5 py-8 max-w-md">
        <Icone size={36} aria-hidden className="text-ink-2" />
        <h1 className="text-2xl font-semibold">{titulo}</h1>
        <p className="m-0 text-ink-2 max-w-[42ch]">{children}</p>
        {acao}
      </section>
    </main>
  );
}
