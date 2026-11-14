/**
 * Interface 2 — Painel de operações.
 * Hierarquia dos wireframes aprovados: 1) visão geral (vagas livres como número dominante), 2) mapa grande e interativo,
 * 3) operação (tabela de regiões, tickets, movimentações, simulador e vagas reservadas). Navegação horizontal por âncoras:
 * todas as seções ficam na página (nada escondido atrás de estado).
 * Dados: REST no carregamento + Socket.IO (/painel) para atualizar em tempo real. Simulador pelos endpoints da Etapa 2.
 *
 * Integração (Etapa 4): o backend é a fonte da verdade.
 *  - ao abrir, a cada reconexão e a cada 30 s o painel recarrega o estado (regiões, indicadores, histórico, simulador);
 *  - eventos de região mais antigos que a versão já aplicada são ignorados (eventos fora de ordem);
 *  - indicadores com sequência menor que a última aplicada são ignorados;
 *  - eventos repetidos são descartados na camada de tempo real e na lista de movimentações (id estável por fato).
 */
import type { EventoTempoReal, Indicadores, Recomendacao, Regiao, Ticket } from '@parkvision/shared';
import { Menu, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Aviso, Botao, Esqueleto, SeloDemonstracao } from '../../componentes/base.tsx';
import { MapaEstacionamento, type VeiculoAnimado } from '../../mapa/MapaEstacionamento.tsx';
import { acrescentarVeiculo, veiculoDeEntrada, veiculoDeSaida } from '../../mapa/veiculos.ts';
import { congestionada } from '../../mapa/estado.ts';
import { api, mensagemDeErro, tokenOperador, type CenarioResumo, type EstadoSimulacao } from '../../servicos/api.ts';
import { useTempoReal, type EstadoConexao } from '../../servicos/tempo-real.ts';
import { BrandLogo } from '../../tema/BrandLogo.tsx';
import { ControlesTema } from '../../tema/ControlesTema.tsx';
import { AcessoOperador, ControleSimulador, DetalheRegiao, ListaMovimentacoes, OperacaoTicket, RecomendacaoAtual, TabelaRegioes, VagasReservadas, VisaoGeral } from './componentes.tsx';
import { itemDoEvento, itemDoHistorico, juntarMovimentacoes, TIPOS_DO_HISTORICO, type ItemMovimentacao } from './eventos.ts';

const MAX_MOVIMENTACOES = 60;
const RESSINCRONIZAR_MS = 30_000;
/** Aplica a região do evento só se ela não for mais antiga que a já exibida. */
export const regiaoMaisNova = (nova: Regiao, atual?: Regiao) => (nova.versao ?? 0) >= (atual?.versao ?? 0);

/** Seções da página, na ordem em que aparecem (links da navegação superior). */
const SECOES = [
  ['visao-geral', 'Visão geral'],
  ['mapa', 'Mapa'],
  ['regioes', 'Regiões'],
  ['tickets', 'Tickets'],
  ['simulador', 'Simulador'],
  ['reservadas', 'Vagas reservadas'],
] as const;
type IdSecao = (typeof SECOES)[number][0];

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const fmtHora = (d: Date, segundos = false) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', ...(segundos ? { second: '2-digit' } : {}) });
const movimentoReduzido = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export function Painel() {
  const [regioes, setRegioes] = useState<Regiao[] | null>(null);
  const [indicadores, setIndicadores] = useState<Indicadores | null>(null);
  const [recomendacao, setRecomendacao] = useState<{ recomendacao: Recomendacao; ticket?: Ticket } | null>(null);
  const [simulacao, setSimulacao] = useState<EstadoSimulacao | null>(null);
  const [cenarios, setCenarios] = useState<CenarioResumo[]>([]);
  const [movimentacoes, setMovimentacoes] = useState<ItemMovimentacao[]>([]);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [mostrarRota, setMostrarRota] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [eventoSimulado, setEventoSimulado] = useState(false);
  const [sincronizadoEm, setSincronizadoEm] = useState<Date | null>(null);
  const [pedindoToken, setPedindoToken] = useState(() => !tokenOperador.ler());
  const pedirToken = useCallback(() => setPedindoToken(true), []);
  const regioesRef = useRef<Record<string, Regiao>>({});
  // carrinhos da simulação no mapa (só visual: a ocupação vem do backend na confirmação e na saída)
  const [veiculos, setVeiculos] = useState<VeiculoAnimado[]>([]);
  const simulacaoRef = useRef<EstadoSimulacao | null>(null); simulacaoRef.current = simulacao;
  const timersVeiculos = useRef<number[]>([]);
  useEffect(() => () => timersVeiculos.current.forEach((t) => window.clearTimeout(t)), []);
  const animar = useCallback((v: VeiculoAnimado | null) => {
    if (!v || movimentoReduzido()) return; // movimento reduzido: sem animação
    setVeiculos((lista) => acrescentarVeiculo(lista, v));
    timersVeiculos.current.push(window.setTimeout(() => setVeiculos((lista) => lista.filter((x) => x.id !== v.id || x.inicio !== v.inicio)), v.duracao * 1.15 + 600));
  }, []);
  const seqIndicadores = useRef(0);

  /** Estado atual a partir do backend (ao abrir, ao reconectar e periodicamente). */
  const carregar = useCallback(async () => {
    try {
      const [rs, ind, recs, est, cens, hist] = await Promise.all([
        api.regioes(), api.indicadores(), api.recomendacoes(1), api.simulacao.estado(), api.simulacao.cenarios(), api.historico(MAX_MOVIMENTACOES),
      ]);
      regioesRef.current = Object.fromEntries(rs.map((r) => [r.id, r]));
      seqIndicadores.current = 0;
      setRegioes(rs); setIndicadores(ind); setSimulacao(est); setCenarios(cens);
      setRecomendacao((atual) => (recs[0] && atual?.recomendacao.id !== recs[0].id ? { recomendacao: recs[0] } : atual ?? (recs[0] ? { recomendacao: recs[0] } : null)));
      setMovimentacoes((atuais) => juntarMovimentacoes(hist.map(itemDoHistorico), atuais.filter((i) => !TIPOS_DO_HISTORICO.includes(i.tipo)), MAX_MOVIMENTACOES));
      setErro(null);
      setSincronizadoEm(new Date());
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    const t = setInterval(() => void carregar(), RESSINCRONIZAR_MS);
    return () => clearInterval(t);
  }, [carregar]);

  const atualizarSimulacao = useCallback(() => api.simulacao.estado().then(setSimulacao).catch(() => {}), []);
  // o relógio e as estatísticas da simulação mudam sem evento: consulta leve enquanto ela existe
  useEffect(() => {
    if (!simulacao || simulacao.status === 'parado') return;
    const t = setInterval(atualizarSimulacao, 4000);
    return () => clearInterval(t);
  }, [simulacao?.status, atualizarSimulacao]);

  const aoEvento = useCallback((e: EventoTempoReal) => {
    if (e.simulado) setEventoSimulado(true);
    const dados = e.dados as Regiao;
    const ehRegiao = e.tipo.startsWith('regiao:');
    const anterior = ehRegiao ? regioesRef.current[dados.id] : undefined;
    if (ehRegiao && !regiaoMaisNova(dados, anterior)) return; // evento atrasado: o painel já mostra um estado mais novo
    const item = itemDoEvento(e, anterior);
    if (item) setMovimentacoes((lista) => juntarMovimentacoes([], [item, ...lista], MAX_MOVIMENTACOES));

    if (ehRegiao) {
      regioesRef.current = { ...regioesRef.current, [dados.id]: dados };
      setRegioes((lista) => lista?.map((r) => (r.id === dados.id ? dados : r)) ?? lista);
    } else if (e.tipo === 'indicadores:atualizados') {
      if (e.sequencia < seqIndicadores.current) return;
      seqIndicadores.current = e.sequencia;
      setIndicadores(e.dados as Indicadores);
    } else if (e.tipo === 'veiculo:entrou' || e.tipo === 'veiculo:recomendado') {
      setRecomendacao(e.dados as { recomendacao: Recomendacao; ticket: Ticket });
      if (e.tipo === 'veiculo:entrou' && e.simulado) {
        const sim = simulacaoRef.current;
        animar(veiculoDeEntrada(e.dados as { recomendacao: Recomendacao; ticket: Ticket }, performance.now(), { tempoManobraSeg: sim?.config?.tempoManobraSeg, velocidade: sim?.velocidade }));
      }
    } else if (e.tipo === 'veiculo:saiu' && e.simulado) {
      animar(veiculoDeSaida(e.dados as { ticket: Ticket; regiao: { id: string } | null }, performance.now()));
    } else if (e.tipo === 'simulador:estado' || e.tipo === 'simulador:cenario') {
      void atualizarSimulacao();
      if (e.tipo === 'simulador:estado' && (e.dados as { acao: string }).acao === 'reiniciado') { setEventoSimulado(false); setVeiculos([]); void carregar(); }
    }
  }, [atualizarSimulacao, carregar, animar]);
  // reconectou: busca o estado atual no backend em vez de confiar só nos eventos (os da queda se perderam)
  const conexao = useTempoReal(aoEvento, carregar);

  const regiaoSelecionada = useMemo(() => regioes?.find((r) => r.id === selecionada) ?? null, [regioes, selecionada]);
  const demonstracao = eventoSimulado || (simulacao ? simulacao.modoDemonstracao || simulacao.status !== 'parado' || simulacao.veiculosSimuladosAtivos > 0 : false);
  const congestionadas = regioes?.filter(congestionada).map((r) => r.id) ?? [];
  const indisponiveis = regioes?.filter((r) => !r.operacional).map((r) => r.id) ?? [];
  const ativa = useSecaoAtiva();

  return (
    <div className="min-h-full flex flex-col bg-canvas">
      <a href="#conteudo" className="pular-conteudo">Pular para o conteúdo</a>
      <Cabecalho conexao={conexao} ativa={ativa} />

      <main id="conteudo" className="flex-1">
        {/* faixa superior em superfície (como nos wireframes): título, visão geral e mapa */}
        <div className="bg-surface border-b border-line">
          <div className={`${CONTEINER} pt-8 sm:pt-10 pb-10 sm:pb-12`}>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <h1 className="text-[32px] sm:text-[40px] font-semibold tracking-tight">Estacionamento</h1>
                <p className="m-0 mt-1 text-sm text-ink-2 num">
                  Capim Dourado Shopping{sincronizadoEm ? ` · ${sincronizadoEm.getDate()} ${MESES[sincronizadoEm.getMonth()]} ${sincronizadoEm.getFullYear()} · ${fmtHora(sincronizadoEm)}` : ''}
                </p>
              </div>
              {demonstracao && <SeloDemonstracao />}
            </div>

            {(erro || conexao === 'desconectado') && (
              <div className="mt-6 grid gap-3 max-w-3xl">
                {erro && (
                  <Aviso tom="erro" titulo="Não foi possível carregar o painel" acao={<Botao variante="secundario" tamanho="sm" icone={RefreshCw} onClick={carregar}>Tentar de novo</Botao>}>
                    {erro}{indicadores ? ' Os números abaixo são os últimos recebidos.' : ''}
                  </Aviso>
                )}
                {conexao === 'desconectado' && !erro && (
                  <Aviso tom="atencao" titulo="Atualização em tempo real interrompida">
                    Tentando reconectar. Os números abaixo são de {sincronizadoEm ? fmtHora(sincronizadoEm, true) : 'antes da queda'} e serão recarregados do servidor quando a conexão voltar.
                  </Aviso>
                )}
              </div>
            )}

            {/* celular: visão geral → mapa → região; desktop: mapa à esquerda, visão geral e região à direita */}
            <div className="mt-8 grid gap-10 lg:gap-x-10 lg:gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] [&>*]:min-w-0">
              <VisaoGeral className="lg:col-start-2 lg:row-start-1" indicadores={indicadores} regioes={regioes} congestionadas={congestionadas} indisponiveis={indisponiveis} falhou={Boolean(erro)} />

              <section id="mapa" tabIndex={-1} aria-labelledby="titulo-mapa" className="scroll-mt-20 focus:outline-none lg:col-start-1 lg:row-start-1 lg:row-span-2">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-2">
                  <h2 id="titulo-mapa" className="text-xl font-semibold">Mapa do estacionamento</h2>
                  <label className="inline-flex items-center gap-2 min-h-11 text-sm text-ink-2 cursor-pointer">
                    <input type="checkbox" checked={mostrarRota} onChange={(e) => setMostrarRota(e.target.checked)} className="size-4 accent-[var(--pv-brand-primary)]" />
                    Mostrar rota da última recomendação
                  </label>
                </div>
                <RecomendacaoAtual dados={recomendacao} aoSelecionar={setSelecionada} />
                {regioes ? (
                  <MapaEstacionamento
                    className="mt-3"
                    regioes={regioes}
                    selecionada={selecionada}
                    aoSelecionar={setSelecionada}
                    destino={mostrarRota ? recomendacao?.recomendacao.regiaoId : null}
                    rota={mostrarRota ? recomendacao?.recomendacao.rota.nos : null}
                    rotuloDestino="Última recomendação"
                    seguirDestino={false}
                    interativo
                    zoomComCtrl
                    veiculos={veiculos}
                  />
                ) : !erro && <Esqueleto className="mt-3 w-full aspect-[1645/1331] rounded-lg" />}
              </section>

              <DetalheRegiao className="lg:col-start-2 lg:row-start-2 lg:self-start" regiao={regiaoSelecionada} aoFechar={() => setSelecionada(null)} />
            </div>
          </div>
        </div>

        {/* operação: seções sobre o fundo da página, separadas por divisórias finas */}
        <div className={`${CONTEINER} py-10 sm:py-12 grid gap-12 sm:gap-14`}>
          <Secao id="regioes" titulo="Ocupação por região" semDivisoria
            descricao={regioes ? `${regioes.length} regiões em três níveis${sincronizadoEm ? `, atualizado às ${fmtHora(sincronizadoEm, true)}` : ''}. Selecione uma linha para ver a região no mapa.` : undefined}>
            <TabelaRegioes regioes={regioes} selecionada={selecionada} aoSelecionar={setSelecionada} />
          </Secao>

          <Secao id="tickets" titulo="Tickets e movimentações">
            <div className="mb-8">
              <AcessoOperador pedindo={pedindoToken} aoSalvar={(t) => { tokenOperador.gravar(t); setPedindoToken(false); }} aoTrocar={pedirToken} />
            </div>
            <div className="grid gap-12 lg:grid-cols-2 lg:gap-12 [&>*]:min-w-0">
              <div>
                <h3 className="text-lg font-semibold mb-3">Consultar ticket</h3>
                <OperacaoTicket regioes={regioes} aoSelecionar={setSelecionada} aoNaoAutorizado={pedirToken} />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-3">Movimentações recentes</h3>
                <ListaMovimentacoes itens={movimentacoes} conexao={conexao} aoSelecionar={setSelecionada} />
              </div>
            </div>
          </Secao>

          <Secao id="simulador" titulo="Simulação" descricao="Gera dados simulados pelas mesmas regras do backend. Tudo o que vem daqui fica marcado como simulado.">
            <ControleSimulador estado={simulacao} cenarios={cenarios} aoAtualizar={atualizarSimulacao} aoNaoAutorizado={pedirToken} />
          </Secao>

          <Secao id="reservadas" titulo="Vagas reservadas" descricao="Vagas PcD e para pessoa idosa: disponibilidade agora, mínimos legais e ajuste por região.">
            <VagasReservadas regioes={regioes} aoNaoAutorizado={pedirToken} />
          </Secao>
        </div>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className={`${CONTEINER} py-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-ink-3`}>
          <span>Golden Park, Capim Dourado Shopping</span>
          <Link to="/totem" className="inline-flex items-center min-h-11 font-medium underline underline-offset-2" style={{ color: 'var(--pv-text-link)' }}>Abrir o totem de entrada</Link>
        </div>
      </footer>
    </div>
  );
}

const CONTEINER = 'w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10';

/** Seção da área de operação: título, descrição opcional e divisória fina no topo (sem cartão). */
function Secao({ id, titulo, descricao, semDivisoria, children }: { id: IdSecao; titulo: string; descricao?: string; semDivisoria?: boolean; children: ReactNode }) {
  return (
    <section id={id} tabIndex={-1} aria-labelledby={`titulo-${id}`} className={`scroll-mt-20 min-w-0 focus:outline-none ${semDivisoria ? '' : 'border-t border-line pt-10 sm:pt-12'}`}>
      <header className="mb-6">
        <h2 id={`titulo-${id}`} className="text-2xl font-semibold">{titulo}</h2>
        {descricao && <p className="m-0 mt-1 text-sm text-ink-2 max-w-prose">{descricao}</p>}
      </header>
      {children}
    </section>
  );
}

/** Seção visível no topo da tela (destaca o link da navegação). Sem IntersectionObserver, fica em "Visão geral". */
function useSecaoAtiva(): IdSecao {
  const [ativa, setAtiva] = useState<IdSecao>('visao-geral');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visiveis = new Map<string, number>();
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) e.isIntersecting ? visiveis.set(e.target.id, e.boundingClientRect.top) : visiveis.delete(e.target.id);
      const ordem = SECOES.map(([id]) => id).filter((id) => visiveis.has(id));
      if (ordem[0]) setAtiva(ordem[0]);
    }, { rootMargin: '-72px 0px -55% 0px' });
    SECOES.forEach(([id]) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);
  return ativa;
}

/** Leva até a seção sem perder o foco do teclado (e opcionalmente foca um campo dela). */
function irPara(id: string, campo?: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    const alvo = document.getElementById(id);
    if (!alvo) return;
    e.preventDefault();
    window.history.replaceState(null, '', `#${id}`);
    // no quadro seguinte: o menu do celular já fechou e o cabeçalho voltou à altura normal
    requestAnimationFrame(() => {
      alvo.scrollIntoView?.({ behavior: movimentoReduzido() ? 'auto' : 'smooth', block: 'start' });
      (document.getElementById(campo ?? '') ?? alvo).focus({ preventScroll: true });
    });
  };
}

function Cabecalho({ conexao, ativa }: { conexao: EstadoConexao; ativa: IdSecao }) {
  const [menu, setMenu] = useState(false);
  const link = (id: IdSecao, rotulo: string, movel = false) => {
    const atual = ativa === id;
    return (
      <a key={id} href={`#${id}`} aria-current={atual ? 'location' : undefined} onClick={(e) => { setMenu(false); irPara(id)(e); }}
        className={movel
          ? 'flex items-center h-12 px-4 text-base font-medium border-l-2'
          : 'inline-flex items-center h-16 px-3 text-sm font-medium border-b-2 transition-colors duration-150 motion-reduce:transition-none hover:text-ink'}
        style={{ color: atual ? 'var(--pv-text-link)' : 'var(--pv-text-secondary)', borderColor: atual ? 'var(--pv-brand-primary)' : 'transparent' }}>
        {rotulo}
      </a>
    );
  };
  return (
    <header className="sticky top-0 z-30 border-b border-line" style={{ background: 'var(--pv-header-bg)' }} onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false); }}>
      <div className={`${CONTEINER} h-16 flex items-center gap-3`}>
        <Link to="/painel" className="mr-auto xl:mr-0 shrink-0 inline-flex items-center min-h-11 rounded-md" aria-label="Golden Park — painel">
          <span className="hidden sm:inline-flex"><BrandLogo variante="horizontal" altura={30} /></span>
          <span className="sm:hidden"><BrandLogo variante="simbolo" altura={34} /></span>
        </Link>
        <nav aria-label="Seções do painel" className="hidden xl:flex flex-1 justify-center gap-1">
          {SECOES.map(([id, rotulo]) => link(id, rotulo))}
        </nav>
        <StatusConexao conexao={conexao} />
        <a href="#tickets" onClick={irPara('tickets', 'codigo-ticket')} className="hidden sm:inline-flex items-center min-h-11 px-2 text-sm font-semibold rounded-md hover:underline underline-offset-2" style={{ color: 'var(--pv-text-link)' }}>
          Consultar ticket
        </a>
        <ControlesTema />
        <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-controls="menu-painel" aria-label={menu ? 'Fechar menu' : 'Abrir menu'}
          className="xl:hidden inline-grid place-items-center size-11 -mr-2 rounded-md cursor-pointer text-ink hover:bg-subtle">
          {menu ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
        </button>
      </div>
      {menu && (
        <nav id="menu-painel" aria-label="Seções do painel" className="xl:hidden border-t border-line pb-2" style={{ background: 'var(--pv-header-bg)' }}>
          <div className={`${CONTEINER} grid`}>
            {SECOES.map(([id, rotulo]) => link(id, rotulo, true))}
            <a href="#tickets" onClick={(e) => { setMenu(false); irPara('tickets', 'codigo-ticket')(e); }} className="sm:hidden flex items-center h-12 px-4 text-base font-semibold" style={{ color: 'var(--pv-text-link)' }}>
              Consultar ticket
            </a>
          </div>
        </nav>
      )}
    </header>
  );
}

function StatusConexao({ conexao }: { conexao: EstadoConexao }) {
  const cfg = {
    conectado: ['Ao vivo', 'var(--pv-feedback-success-solid)'],
    conectando: ['Conectando…', 'var(--pv-text-muted)'],
    desconectado: ['Sem conexão', 'var(--pv-feedback-danger-solid)'],
  }[conexao];
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm font-medium text-ink-2 whitespace-nowrap" data-conexao={conexao}>
      <span className="size-2 rounded-full" style={{ background: cfg[1] }} aria-hidden /> {cfg[0]}
    </span>
  );
}
