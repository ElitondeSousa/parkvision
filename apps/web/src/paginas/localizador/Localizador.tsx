/**
 * Navegação do motorista (aberta pelo QR Code do ticket) — mapa em tela cheia + painel inferior, estilo app de navegação.
 *
 *  - A caminho (ticket AGUARDANDO): destino = região RECOMENDADA, rota pelo grafo de vias a partir do acesso de entrada.
 *    A indicação não reserva vaga e não confirma onde o carro vai ficar.
 *  - Estacionado: destino = região REGISTRADA na confirmação; sem rota (não sabemos de onde a pessoa está vindo).
 *  - Saiu / cancelado: ticket encerrado, sem localização ativa.
 *
 * Layout: no celular, o painel inferior recolhido mostra só o código da região (o elemento-herói, em Barlow), o nome,
 * o estado e uma instrução; expandido, mostra passos, vaga, ticket e avisos. A partir de 1024 px o painel vira coluna
 * à esquerda e o mapa ocupa o resto (wireframe Localizador 1440).
 *
 * Sem GPS: nada aqui acompanha a posição real. O "trajeto em demonstração" anima um carrinho e é rotulado como tal.
 * Consulta só os dados deste ticket (GET /localizador/:token) e assina só ele no tempo real (/localizador).
 */
import { NOME_TIPO_VAGA, type Nivel } from '@parkvision/shared';
import { ArrowLeft, ChevronDown, ChevronRight, Crosshair, Headset, LogOut, Play, QrCode, RefreshCw, Route, SearchX, TicketX, WifiOff, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Botao, Esqueleto, Selo, Status } from '../../componentes/base.tsx';
import { IconeCategoria } from '../../componentes/IconeCategoria.tsx';
import { COR_TIPO_VAGA, IconeTipoVaga, SeloTipoVaga } from '../../componentes/IconeTipoVaga.tsx';
import { doAcesso, nomeCurto, nomeDoNivel, orientacaoDaRota, regiaoDoMapa, trechosDaRota } from '../../mapa/dados.ts';
import { NOME_CATEGORIA, dataHora, hora } from '../../mapa/estado.ts';
import { MapaEstacionamento, type VeiculoAnimado } from '../../mapa/MapaEstacionamento.tsx';
import { caixa, caixaDaNavegacao, comprimento, enquadrar, pontosNoNivel, type Camera } from '../../mapa/navegacao.ts';
import { ErroServico, api, type RespostaLocalizador } from '../../servicos/api.ts';
import { useTicketAoVivo } from '../../servicos/tempo-real.ts';
import { BrandLogo } from '../../tema/BrandLogo.tsx';
import { ControlesTema } from '../../tema/ControlesTema.tsx';

/** O token do QR é base64url (16 bytes = 22 caracteres). Formato estranho nem chega a consultar a API. */
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{16,64}$/;

/** Duração da abertura/fechamento do painel (ms). O mapa se reenquadra logo depois que o painel assenta. */
const DURACAO_PAINEL = 240;

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; dados: RespostaLocalizador }
  | { tipo: 'invalido' }
  | { tipo: 'inexistente' }
  | { tipo: 'sem-conexao' };

const movimentoReduzido = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Tablet deitado e desktop: painel lateral à esquerda, mapa à direita. */
const CONSULTA_LARGA = '(min-width: 1024px)';
function useTelaLarga() {
  const [larga, setLarga] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(CONSULTA_LARGA).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(CONSULTA_LARGA);
    if (!mq) return;
    const mudar = () => setLarga(mq.matches);
    mudar();
    mq.addEventListener?.('change', mudar);
    return () => mq.removeEventListener?.('change', mudar);
  }, []);
  return larga;
}

export function Localizador() {
  const { token = '' } = useParams();
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [expandido, setExpandido] = useState(false);
  const larga = useTelaLarga();

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

  const dados = estado.tipo === 'ok' ? estado.dados : null;
  const ativo = !!dados && (dados.ticket.status === 'AGUARDANDO' || (dados.ticket.status === 'ESTACIONADO' && !!dados.regiao));
  const subtitulo = dados ? (dados.ticket.status === 'AGUARDANDO' ? 'Navegação até a região' : dados.ticket.status === 'ESTACIONADO' ? 'Encontre seu veículo' : 'Ticket encerrado') : 'Localizador';
  return (
    <div className="h-[100dvh] flex flex-col bg-canvas text-ink overflow-hidden">
      <Cabecalho
        subtitulo={subtitulo}
        codigo={dados?.ticket.codigo}
        detalhes={ativo && !larga ? { aberto: expandido, alternar: () => setExpandido((x) => !x) } : undefined}
      />
      {estado.tipo === 'carregando' ? (
        <div role="status" aria-label="Consultando o ticket" className="flex-1 relative">
          <Esqueleto className="absolute inset-0 rounded-none" />
        </div>
      ) : estado.tipo === 'invalido' ? (
        <Mensagem icone={QrCode} titulo="QR Code inválido">Este endereço não corresponde a um ticket do Golden Park. Escaneie de novo o QR Code impresso no ticket.</Mensagem>
      ) : estado.tipo === 'inexistente' ? (
        <Mensagem icone={SearchX} titulo="Ticket não encontrado">Confira se escaneou o QR Code do seu ticket. O endereço pode estar incompleto ou o ticket pode ter sido removido.</Mensagem>
      ) : estado.tipo === 'sem-conexao' ? (
        <Mensagem icone={WifiOff} titulo="Sem conexão com o Golden Park" acao={<Botao icone={RefreshCw} onClick={() => void consultar()}>Tentar de novo</Botao>}>Verifique a internet do celular e tente de novo.</Mensagem>
      ) : ativo ? (
        <Navegacao dados={estado.dados} aoVivo={aoVivo === 'conectado'} larga={larga} expandido={expandido} setExpandido={setExpandido} />
      ) : (
        <Encerrado dados={estado.dados} />
      )}
    </div>
  );
}

/** Cabeçalho compacto: marca, o que a página faz, o ticket (discreto, abre os detalhes) e o tema. Sem menus. */
function Cabecalho({ subtitulo, codigo, detalhes }: { subtitulo: string; codigo?: string; detalhes?: { aberto: boolean; alternar: () => void } }) {
  const podeVoltar = typeof window !== 'undefined' && window.history.length > 1;
  return (
    <header className="shrink-0 border-b border-line bg-surface" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center gap-2.5 h-14" style={{ paddingLeft: 'max(12px, env(safe-area-inset-left))', paddingRight: 'max(8px, env(safe-area-inset-right))' }}>
        {podeVoltar && (
          <button type="button" onClick={() => window.history.back()} aria-label="Voltar" className="grid place-items-center size-11 -ml-1.5 rounded-full text-ink-2 cursor-pointer hover:bg-subtle hover:text-ink">
            <ArrowLeft size={20} aria-hidden />
          </button>
        )}
        <BrandLogo variante="simbolo" altura={28} className="shrink-0" />
        <div className="min-w-0 mr-auto leading-tight">
          <p className="m-0 text-sm font-medium text-ink truncate">{subtitulo}</p>
          {codigo && (detalhes ? (
            <button
              type="button"
              onClick={detalhes.alternar}
              aria-expanded={detalhes.aberto}
              aria-controls="detalhes-navegacao"
              data-alvo-estendido="44"
              className="relative -mx-1 px-1 inline-flex items-center gap-1 text-xs text-ink-2 rounded-sm cursor-pointer hover:text-ink before:absolute before:inset-x-0 before:-inset-y-[14px] before:content-['']"
            >
              Ticket <span className="font-mono">{codigo}</span>
              <ChevronDown size={14} aria-hidden className="transition-transform duration-200 ease-out" style={{ transform: detalhes.aberto ? 'rotate(180deg)' : undefined }} />
            </button>
          ) : (
            <p className="m-0 text-xs text-ink-2">Ticket <span className="font-mono">{codigo}</span></p>
          ))}
        </div>
        <ControlesTema />
      </div>
    </header>
  );
}

interface PropsNavegacao {
  dados: RespostaLocalizador;
  aoVivo: boolean;
  larga: boolean;
  expandido: boolean;
  setExpandido: (v: boolean | ((x: boolean) => boolean)) => void;
}

function Navegacao({ dados, aoVivo, larga, expandido, setExpandido }: PropsNavegacao) {
  const { ticket, regiao, recomendada, orientacao, rota, acesso, caminhoPedestre } = dados;
  // vaga reservada (PcD / pessoa idosa): o tipo aparece no painel e no pino; nada de afirmar rota acessível não validada
  const tipoVaga = ticket.tipoVaga ?? 'COMUM';
  const reservada = tipoVaga !== 'COMUM';
  const sinalizacao = reservada ? `Procure as vagas sinalizadas ${tipoVaga === 'PCD' ? 'para PcD' : 'para pessoa idosa'} e use-as só com a credencial válida à vista.` : null;
  const chegando = ticket.status === 'AGUARDANDO';
  const destino = chegando ? recomendada.id : regiao!.id;
  const nomeRegiao = chegando ? recomendada.nome : regiao!.nome;
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
  const [demo, setDemo] = useState<VeiculoAnimado | null>(null);
  const mapaRef = useRef<HTMLDivElement>(null), painelRef = useRef<HTMLElement>(null);
  const passos = useMemo(() => {
    const base = nos ? orientacaoDaRota(nos, destino) : [...orientacao, ...(doMapa?.coberta ? [`Fica em área coberta (${nomeDoNivel(doMapa.nivel).toLowerCase()}).`] : [])];
    return sinalizacao && !base.includes(sinalizacao) && !base.some((p) => p.includes('credencial')) ? [...base, sinalizacao] : base;
  }, [nos, destino, orientacao, doMapa, sinalizacao]);
  // a instrução principal do painel recolhido: a caminho, seguir a rota; estacionado, a referência da região
  const instrucao = chegando && nos && acesso
    ? `Siga a rota destacada a partir ${doAcesso(acesso.nome)}.`
    : doMapa?.referencia ? `${doMapa.referencia}.` : passos[0] ?? '';

  const timers = useRef<number[]>([]); // passos da demonstração em andamento
  /** enquadra a rota inteira ou só o destino na parte do mapa que o painel não cobre */
  const ajustar = useCallback((tipo: 'rota' | 'destino', n: Nivel = nivel) => {
    const el = mapaRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    const painel = larga ? 0 : painelRef.current?.getBoundingClientRect().height ?? 0;
    const r = regiaoDoMapa[destino];
    const bbox = tipo === 'destino' && r?.nivel === n ? caixa(r.poligono) : caixaDaNavegacao(nos, destino, n);
    // faixa de cima ocupada pelas abas de nível (e pelo aviso "a rota continua"/demonstração, quando aparecem):
    // o enquadramento usa só a faixa livre entre elas e o painel, para a rota não nascer escondida sob as abas
    const iN = trechos.findIndex((t) => t.nivel === n);
    const topo = (iN >= 0 && trechos[iN + 1]) || timers.current.length ? 112 : 64;
    const baixo = larga ? 16 : Math.min(painel, height * 0.6) + 16;
    const c = enquadrar(bbox, width, height, topo + baixo, tipo === 'destino' ? 2.2 : 1.4);
    const k = c[2] / width; // unidades do mapa por pixel
    setCamera([c[0], c[1] - topo * k, c[2], c[3]]);
  }, [nivel, destino, nos, larga, trechos]);
  useEffect(() => {
    ajustar('rota');
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => ajustar('rota')) : null;
    if (mapaRef.current) ro?.observe(mapaRef.current);
    return () => ro?.disconnect();
    // reenquadra quando o destino/rota mudam (ex.: ticket confirmado ao vivo) e quando o layout troca (painel lateral)
  }, [destino, nos?.join(','), ajustar]); // eslint-disable-line react-hooks/exhaustive-deps

  // ao abrir/fechar o painel, reenquadra depois que ele assenta, para o destino continuar visível acima dele
  const primeiraVez = useRef(true);
  useEffect(() => {
    if (primeiraVez.current) { primeiraVez.current = false; return; }
    if (larga) return;
    const id = window.setTimeout(() => ajustar('rota'), movimentoReduzido() ? 0 : DURACAO_PAINEL + 20);
    return () => window.clearTimeout(id);
  }, [expandido]); // eslint-disable-line react-hooks/exhaustive-deps
  const trocarNivel = (n: Nivel) => { setNivel(n); ajustar('rota', n); };
  const centralizar = () => { const n = doMapa?.nivel ?? nivel; setNivel(n); ajustar('destino', n); };
  // demonstração: um carrinho percorre cada trecho da rota, nível a nível (ritmo fixo, não é a posição real)
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

  // ── conteúdo do painel ──
  const tamanhoCodigo = larga ? (destino.length > 2 ? 'text-[80px]' : 'text-[104px]') : destino.length > 2 ? 'text-[44px]' : 'text-[60px]';
  const codigo = (
    <p className={`m-0 font-display font-bold leading-[0.8] tracking-[-0.035em] num text-ink ${tamanhoCodigo}`} data-testid="codigo-regiao">
      <span className="sr-only-texto">Região </span>{destino}
    </p>
  );
  const rotulo = <p className="m-0 text-sm text-ink-2">{chegando ? 'Seu destino' : 'Seu veículo está na região'}</p>;
  const nome = (
    <h1 className={`font-semibold leading-tight text-ink ${larga ? 'text-[32px] mt-4' : 'text-xl'}`} data-testid={chegando ? 'regiao-destino' : 'regiao-registrada'}>
      {nomeRegiao}
    </h1>
  );
  const meta = (
    <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
      <span>{doMapa ? nomeDoNivel(doMapa.nivel) : ''}{doMapa?.coberta ? ', área coberta' : ''}</span>
      {ticket.simulado && <Selo tom="atencao">Ticket simulado</Selo>}
    </p>
  );
  const resumo = (
    <>
      {larga ? (
        <div>{rotulo}<div className="mt-3">{codigo}</div>{nome}{meta}</div>
      ) : (
        <div className="flex items-start gap-4">
          {codigo}
          <div className="min-w-0 flex-1">{rotulo}{nome}{meta}</div>
        </div>
      )}
      {reservada && <div className="mt-3"><SeloTipoVaga tipo={tipoVaga} /></div>}
      <div className={`grid gap-1.5 ${larga ? 'mt-6' : 'mt-4'}`} data-testid="estado-navegacao">
        {chegando ? (
          <Status tom="info">Estacionamento ainda não confirmado</Status>
        ) : (
          <Status tom="normal">Estacionamento confirmado às {ticket.estacionadoEm ? hora(ticket.estacionadoEm) : '—'}</Status>
        )}
        <p className="m-0 text-[15px] leading-snug text-ink" data-testid="instrucao-principal">{instrucao}</p>
      </div>
    </>
  );
  const sequencia = chegando && !!nos; // passos numerados só quando são mesmo uma sequência (a rota)
  const Lista = sequencia ? 'ol' : 'ul';
  const detalhes = (
    <div className="grid gap-8">
      <section aria-labelledby="titulo-orientacao">
        <h2 id="titulo-orientacao" className="text-base font-semibold text-ink">{chegando ? 'Como chegar' : 'Como encontrar'}</h2>
        {!nos && chegando && <p className="m-0 mt-1.5 text-sm text-ink-2">Rota indisponível no momento — siga as orientações abaixo.</p>}
        <Lista className="mt-3 m-0 p-0 list-none grid gap-3" data-testid="orientacao">
          {passos.map((p, i) => (
            <li key={p} className="flex gap-3 text-[15px] leading-snug text-ink">
              {sequencia ? (
                <span className="grid place-items-center size-6 shrink-0 -mt-0.5 rounded-full text-xs font-bold num" style={{ background: 'var(--pv-wayfinding-route)', color: 'var(--pv-wayfinding-on)' }}>{i + 1}</span>
              ) : (
                <span className="size-1.5 shrink-0 mt-2 rounded-full bg-ink-3" aria-hidden />
              )}
              <span>{p}</span>
            </li>
          ))}
        </Lista>
        {chegando && <p className="m-0 mt-4 text-sm text-ink-2">A indicação considera a ocupação do momento da entrada e não reserva vaga.</p>}
        {chegando && nos && !movimentoReduzido() && (
          <Botao variante="secundario" icone={Play} onClick={verDemonstracao} disabled={Boolean(demo)} className="mt-4">Ver trajeto em demonstração</Botao>
        )}
      </section>
      {reservada && (
        <section aria-labelledby="titulo-reservada" className="grid gap-1.5 text-sm text-ink-2">
          <h2 id="titulo-reservada" className="text-base font-semibold text-ink">Vaga reservada</h2>
          <p className="m-0 text-ink" data-testid="info-vaga-reservada">Use a vaga só com a credencial válida à vista no veículo.</p>
          <p className="m-0">O Golden Park não verifica a credencial: a indicação segue o tipo de vaga escolhido no totem.</p>
          {caminhoPedestre && <p className="m-0" data-testid="caminho-pedestre">Caminho a pé: {caminhoPedestre.texto}</p>}
        </section>
      )}
      <section aria-labelledby="titulo-ticket">
        <h2 id="titulo-ticket" className="text-base font-semibold text-ink">Ticket</h2>
        <dl className="mt-3 m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-[15px]">
          <dt className="text-ink-2">Código</dt>
          <dd className="m-0 font-mono text-ink" data-testid="codigo-ticket">{ticket.codigo}</dd>
          <dt className="text-ink-2">Veículo</dt>
          <dd className="m-0 flex items-center gap-2 min-w-0 text-ink"><IconeCategoria categoria={ticket.categoria} tamanho={22} className="text-ink-2 shrink-0" />{NOME_CATEGORIA[ticket.categoria]}</dd>
          <dt className="text-ink-2">Vaga</dt>
          <dd className="m-0 flex items-center gap-2 text-ink"><span className="shrink-0 inline-flex" style={{ color: COR_TIPO_VAGA[tipoVaga] }}><IconeTipoVaga tipo={tipoVaga} tamanho={18} /></span>{NOME_TIPO_VAGA[tipoVaga]}</dd>
          <dt className="text-ink-2">Entrada</dt>
          <dd className="m-0 num text-ink">{dataHora(ticket.entradaEm)}</dd>
          {chegando && acesso && (
            <>
              <dt className="text-ink-2">Partida</dt>
              <dd className="m-0 text-ink">{nomeCurto(acesso.nome)}</dd>
            </>
          )}
        </dl>
      </section>
      <div className="grid gap-2 pt-5 border-t border-line-subtle text-sm text-ink-2">
        <p className="m-0">O Golden Park não rastreia o veículo: {chegando ? 'o mapa mostra a região indicada na entrada e o caminho pelas vias do estacionamento.' : 'esta é a região registrada quando o estacionamento foi confirmado.'}</p>
        <p className="m-0 flex items-start gap-2" role="status" data-testid="ao-vivo">
          <span className="size-2 shrink-0 mt-1.5 rounded-full" style={{ background: aoVivo ? 'var(--pv-feedback-success-solid)' : 'var(--pv-text-muted)' }} aria-hidden />
          {aoVivo ? 'Esta página se atualiza sozinha quando o ticket muda.' : 'Sem atualização automática no momento — recarregue a página para ver mudanças.'}
        </p>
      </div>
    </div>
  );

  const mapa = (
    <div ref={mapaRef} className={larga ? 'relative h-full rounded-xl border border-line overflow-hidden' : 'absolute inset-0'}>
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
      {proximo && !demo && (
        <button
          type="button"
          onClick={() => trocarNivel(proximo.nivel)}
          className="absolute top-16 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 h-11 pl-4 pr-3 rounded-full text-sm font-semibold whitespace-nowrap shadow-[var(--pv-shadow-sm)] cursor-pointer"
          style={{ background: 'var(--pv-wayfinding-route)', color: 'var(--pv-wayfinding-on)' }}
        >
          A rota continua no {nomeDoNivel(proximo.nivel)} <ChevronRight size={16} aria-hidden />
        </button>
      )}
      {demo && (
        <p role="status" className="absolute top-16 left-1/2 -translate-x-1/2 z-10 m-0 max-w-[calc(100%-24px)] px-3 py-2 rounded-full text-xs font-semibold text-center text-ink" style={{ background: 'var(--pv-wayfinding-subtle)', border: '1px solid var(--pv-wayfinding-route)' }}>
          Demonstração do trajeto — não é a sua localização
        </p>
      )}
      {/* controles do mapa: um grupo só, sempre acima do painel */}
      <div
        className="absolute right-3 z-10 flex flex-col rounded-full bg-surface border border-line shadow-[var(--pv-shadow-sm)] divide-y divide-[var(--pv-border-default)]"
        style={{ bottom: larga ? 16 : 'calc(var(--gp-painel, 200px) + 12px)' }}
      >
        {nos && <BotaoMapa rotulo="Ver rota inteira" icone={Route} onClick={() => ajustar('rota')} />}
        <BotaoMapa rotulo={chegando ? 'Centralizar no destino' : 'Centralizar no veículo'} icone={Crosshair} onClick={centralizar} />
      </div>
    </div>
  );

  return larga ? (
    <div className="flex-1 min-h-0 flex bg-surface">
      <Painel ref={painelRef} lateral expandido aoAlternar={() => {}} aoArrastar={() => {}} resumo={resumo} detalhes={detalhes} />
      <div className="flex-1 min-w-0 p-6 pl-0">{mapa}</div>
    </div>
  ) : (
    <div className="flex-1 relative min-h-0">
      {mapa}
      <Painel ref={painelRef} expandido={expandido} aoAlternar={() => setExpandido((x) => !x)} aoArrastar={setExpandido} resumo={resumo} detalhes={detalhes} />
    </div>
  );
}

function BotaoMapa({ rotulo, icone: Icone, onClick }: { rotulo: string; icone: LucideIcon; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} className="grid place-items-center size-11 rounded-full text-ink cursor-pointer hover:bg-subtle active:bg-muted transition-colors">
      <Icone size={20} aria-hidden />
    </button>
  );
}

interface PropsPainel {
  ref: React.Ref<HTMLElement>;
  lateral?: boolean;
  expandido: boolean;
  aoAlternar: () => void;
  aoArrastar: (expandir: boolean) => void;
  resumo: ReactNode;
  detalhes: ReactNode;
}

/**
 * Painel de informações. No celular é um painel inferior (bottom sheet): toque na alça alterna, arrastar para cima
 * expande e para baixo recolhe, Esc recolhe. Os detalhes abrem com a altura animada (grid 0fr → 1fr, ~240 ms, ease-out;
 * instantâneo com movimento reduzido) e ficam fora da leitura e do foco enquanto recolhidos.
 * Em tela larga é a coluna da esquerda, sempre aberta.
 */
function Painel({ ref, lateral, expandido, aoAlternar, aoArrastar, resumo, detalhes }: PropsPainel) {
  const inicio = useRef<number | null>(null), arrastou = useRef(false);
  const local = useRef<HTMLElement>(null), rolagem = useRef<HTMLDivElement>(null), alca = useRef<HTMLButtonElement>(null);
  const juntarRef = (el: HTMLElement | null) => {
    local.current = el;
    if (typeof ref === 'function') ref(el); else if (ref) (ref as React.RefObject<HTMLElement | null>).current = el;
  };
  // a altura do painel vira uma variável CSS: os botões do mapa ficam sempre acima dele
  useEffect(() => {
    const el = local.current;
    if (lateral || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => el.parentElement?.style.setProperty('--gp-painel', `${el.getBoundingClientRect().height}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [lateral]);
  // ao recolher, volta o conteúdo para o topo (o resumo fica sempre à vista)
  useEffect(() => {
    if (!expandido) rolagem.current?.scrollTo?.({ top: 0, behavior: movimentoReduzido() ? 'auto' : 'smooth' });
  }, [expandido]);

  if (lateral) {
    return (
      <aside ref={juntarRef} data-testid="painel-navegacao" data-expandido="true" aria-label="Detalhes da navegação" className="w-[400px] xl:w-[440px] shrink-0 overflow-y-auto">
        <div className="px-10 pt-10 pb-12">
          {resumo}
          <div id="detalhes-navegacao" className="mt-10">{detalhes}</div>
        </div>
      </aside>
    );
  }
  return (
    <section
      ref={juntarRef}
      data-testid="painel-navegacao"
      data-expandido={expandido}
      aria-label="Detalhes da navegação"
      onKeyDown={(e) => { if (e.key === 'Escape' && expandido) { aoArrastar(false); alca.current?.focus(); } }}
      className="absolute bottom-0 inset-x-0 z-20 mx-auto max-w-xl flex flex-col bg-surface rounded-t-[20px] border-t border-x border-line"
      style={{ maxHeight: '62%', boxShadow: '0 -12px 32px -20px rgb(0 0 0 / 0.28)' }}
    >
      <button
        ref={alca}
        type="button"
        onClick={() => { if (arrastou.current) { arrastou.current = false; return; } aoAlternar(); }}
        onPointerDown={(e) => { inicio.current = e.clientY; arrastou.current = false; }}
        onPointerUp={(e) => {
          if (inicio.current === null) return;
          const dy = e.clientY - inicio.current;
          inicio.current = null;
          if (Math.abs(dy) > 30) { arrastou.current = true; aoArrastar(dy < 0); }
        }}
        onPointerCancel={() => { inicio.current = null; }}
        aria-expanded={expandido}
        aria-controls="detalhes-navegacao"
        aria-label={expandido ? 'Recolher detalhes' : 'Mostrar detalhes'}
        className="shrink-0 w-full h-11 flex flex-col items-center justify-center gap-0.5 rounded-t-[20px] text-ink-3 cursor-pointer touch-none hover:text-ink-2"
      >
        <span className="block w-9 h-1 rounded-full bg-line-strong" aria-hidden />
        <ChevronDown size={16} aria-hidden className="transition-transform duration-200 ease-out" style={{ transform: expandido ? undefined : 'rotate(180deg)' }} />
      </button>
      <div ref={rolagem} className="min-h-0 overflow-y-auto overscroll-contain px-5" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        {resumo}
        <div
          className="grid transition-[grid-template-rows] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
          style={{ gridTemplateRows: expandido ? '1fr' : '0fr', transitionDuration: `${DURACAO_PAINEL}ms` }}
        >
          <div
            id="detalhes-navegacao"
            className="min-h-0 overflow-hidden -mx-1 px-1"
            // recolhido: fora da tela de leitura e da ordem de foco, mas só depois que a animação de fechar termina
            style={{ visibility: expandido ? 'visible' : 'hidden', transition: `visibility 0s linear ${expandido ? 0 : DURACAO_PAINEL + 40}ms` }}
          >
            <div className="pt-6 pb-2 mt-4 border-t border-line-subtle">{detalhes}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Encerrado({ dados }: { dados: RespostaLocalizador }) {
  const { ticket, regiao } = dados;
  return ticket.status === 'SAIU' ? (
    <Mensagem icone={LogOut} titulo="Este veículo já saiu" ajuda={false}>
      A saída foi registrada {ticket.saidaEm ? `em ${dataHora(ticket.saidaEm)}` : ''}{regiao ? `, da região ${regiao.id}` : ''}. O ticket <span className="font-mono">{ticket.codigo}</span> está encerrado e não há localização ativa.
    </Mensagem>
  ) : (
    <Mensagem icone={TicketX} titulo="Ticket cancelado">O ticket <span className="font-mono">{ticket.codigo}</span> foi cancelado antes do estacionamento ser confirmado. Não há localização ativa.</Mensagem>
  );
}

/** Estados sem mapa: texto alinhado à esquerda, muito ar, uma ação quando houver e o caminho para pedir ajuda. */
function Mensagem({ icone: Icone, titulo, children, acao, ajuda = true }: { icone: LucideIcon; titulo: string; children: ReactNode; acao?: ReactNode; ajuda?: boolean }) {
  return (
    <main className="flex-1 overflow-y-auto">
      <section role="alert" className="mx-auto w-full max-w-md px-6 pt-[12vh]" style={{ paddingBottom: 'max(48px, env(safe-area-inset-bottom))' }}>
        <Icone size={28} strokeWidth={1.75} aria-hidden className="text-ink-3" />
        <h1 className="mt-5 text-[28px] font-semibold leading-tight text-ink">{titulo}</h1>
        <p className="m-0 mt-3 text-base leading-relaxed text-ink-2 max-w-[42ch]">{children}</p>
        {acao && <div className="mt-6">{acao}</div>}
        {ajuda && (
          <p className="m-0 mt-10 pt-5 border-t border-line-subtle flex gap-3 text-sm text-ink-2" data-testid="ajuda-atendimento">
            <Headset size={18} aria-hidden className="shrink-0 mt-0.5 text-ink-3" />
            <span><span className="font-medium text-ink">Precisa de ajuda?</span> Procure o atendimento do estacionamento.</span>
          </p>
        )}
      </section>
    </main>
  );
}
