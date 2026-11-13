/**
 * Interface 2 — Dashboard administrativo.
 * O mapa é o centro: ocupação por região, recomendação atual com a rota, seleção de região.
 * Dados: REST no carregamento + Socket.IO (/painel) para atualizar em tempo real. Simulador pelos endpoints da Etapa 2.
 */
import type { EventoTempoReal, Indicadores, Recomendacao, Regiao, Ticket } from '@parkvision/shared';
import { CircleParking, LayoutDashboard, RefreshCw, ScanLine, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { Aviso, Botao, Cartao, Esqueleto, Marca, SeloDemonstracao } from '../../componentes/base.tsx';
import { MapaEstacionamento } from '../../mapa/MapaEstacionamento.tsx';
import { congestionada } from '../../mapa/estado.ts';
import { api, mensagemDeErro, type CenarioResumo, type EstadoSimulacao } from '../../servicos/api.ts';
import { useTempoReal, type EstadoConexao } from '../../servicos/tempo-real.ts';
import { ControleSimulador, DetalheRegiao, FaixaIndicadores, ListaMovimentacoes, RecomendacaoAtual, TabelaRegioes } from './componentes.tsx';
import { itemDoEvento, type ItemMovimentacao } from './eventos.ts';

const MAX_MOVIMENTACOES = 60;

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
  const regioesRef = useRef<Record<string, Regiao>>({});

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [rs, ind, recs, est, cens] = await Promise.all([
        api.regioes(), api.indicadores(), api.recomendacoes(1), api.simulacao.estado(), api.simulacao.cenarios(),
      ]);
      regioesRef.current = Object.fromEntries(rs.map((r) => [r.id, r]));
      setRegioes(rs); setIndicadores(ind); setSimulacao(est); setCenarios(cens);
      setRecomendacao(recs[0] ? { recomendacao: recs[0] } : null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

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
    const anterior = e.tipo.startsWith('regiao:') ? regioesRef.current[dados.id] : undefined;
    const item = itemDoEvento(e, anterior);
    if (item) setMovimentacoes((lista) => (lista.some((x) => x.id === item.id) ? lista : [item, ...lista].slice(0, MAX_MOVIMENTACOES)));

    if (e.tipo.startsWith('regiao:')) {
      regioesRef.current = { ...regioesRef.current, [dados.id]: dados };
      setRegioes((lista) => lista?.map((r) => (r.id === dados.id ? dados : r)) ?? lista);
    } else if (e.tipo === 'indicadores:atualizados') {
      setIndicadores(e.dados as Indicadores);
    } else if (e.tipo === 'veiculo:entrou' || e.tipo === 'veiculo:recomendado') {
      setRecomendacao(e.dados as { recomendacao: Recomendacao; ticket: Ticket });
    } else if (e.tipo === 'simulador:estado' || e.tipo === 'simulador:cenario') {
      void atualizarSimulacao();
      if (e.tipo === 'simulador:estado' && (e.dados as { acao: string }).acao === 'reiniciado') { setEventoSimulado(false); void carregar(); }
    }
  }, [atualizarSimulacao, carregar]);
  const conexao = useTempoReal(aoEvento);

  const regiaoSelecionada = useMemo(() => regioes?.find((r) => r.id === selecionada) ?? null, [regioes, selecionada]);
  const demonstracao = eventoSimulado || (simulacao ? simulacao.status !== 'parado' || simulacao.veiculosSimuladosAtivos > 0 : false);
  const congestionadas = regioes?.filter(congestionada).map((r) => r.id) ?? [];
  const indisponiveis = regioes?.filter((r) => !r.operacional).map((r) => r.id) ?? [];

  return (
    <div className="min-h-full lg:grid lg:grid-cols-[var(--pv-sidebar-width-collapsed)_minmax(0,1fr)] xl:grid-cols-[208px_minmax(0,1fr)]">
      <a href="#conteudo" className="pular-conteudo">Pular para o conteúdo</a>
      <div style={{ background: 'var(--pv-sidebar-bg)' }}><Navegacao conexao={conexao} /></div>
      <div className="min-w-0 flex flex-col">
        <header className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-b border-line bg-surface">
          <div className="min-w-0 mr-auto">
            <h1 className="text-2xl font-semibold">Estacionamento</h1>
            <p className="m-0 text-sm text-ink-2">Capim Dourado Shopping — três níveis, {regioes?.length ?? 10} regiões</p>
          </div>
          {demonstracao && <SeloDemonstracao />}
          <StatusConexao conexao={conexao} />
        </header>

        <main id="conteudo" className="flex-1 p-4 sm:p-6 grid gap-5 content-start">
          {erro && (
            <Aviso tom="erro" titulo="Não foi possível carregar o painel" acao={<Botao variante="secundario" tamanho="sm" icone={RefreshCw} onClick={carregar}>Tentar de novo</Botao>}>
              {erro}
            </Aviso>
          )}
          {conexao === 'desconectado' && !erro && (
            <Aviso tom="atencao" titulo="Atualização em tempo real interrompida">Tentando reconectar. Os números podem estar desatualizados até a conexão voltar.</Aviso>
          )}

          <FaixaIndicadores indicadores={indicadores} congestionadas={congestionadas} indisponiveis={indisponiveis} />

          <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_360px]">
            <Cartao titulo="Mapa do estacionamento" acao={
              <label className="inline-flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
                <input type="checkbox" checked={mostrarRota} onChange={(e) => setMostrarRota(e.target.checked)} className="size-4 accent-[var(--pv-brand-primary)]" />
                Mostrar rota da última recomendação
              </label>
            }>
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
                />
              ) : !erro && <Esqueleto className="h-[480px] mt-3" />}
            </Cartao>

            <div className="grid gap-5 content-start">
              <DetalheRegiao regiao={regiaoSelecionada} aoFechar={() => setSelecionada(null)} />
              <ControleSimulador estado={simulacao} cenarios={cenarios} aoAtualizar={atualizarSimulacao} />
              <ListaMovimentacoes itens={movimentacoes} conexao={conexao} aoSelecionar={setSelecionada} />
            </div>
          </div>

          <TabelaRegioes regioes={regioes} selecionada={selecionada} aoSelecionar={setSelecionada} />
        </main>
      </div>
    </div>
  );
}

function Navegacao({ conexao }: { conexao: EstadoConexao }) {
  const item = 'flex items-center gap-3 h-11 px-3 rounded-md text-sm font-semibold transition-colors';
  return (
    <nav aria-label="Navegação principal" className="flex lg:flex-col items-center lg:items-stretch gap-2 px-4 lg:px-3 py-3 lg:py-5 lg:sticky lg:top-0 lg:h-screen" style={{ background: 'var(--pv-sidebar-bg)', color: 'var(--pv-sidebar-fg)' }}>
      <Link to="/painel" className="lg:mb-6 lg:px-1 xl:px-2 mr-auto lg:mr-0" aria-label="ParkVision — painel">
        <span className="hidden xl:inline-flex"><Marca claro /></span>
        <span className="xl:hidden"><Marca claro tamanho={30} /></span>
      </Link>
      <NavLink to="/painel" end className={({ isActive }) => `${item} ${isActive ? 'text-white' : ''}`} style={({ isActive }) => ({ background: isActive ? 'var(--pv-sidebar-item-bg-active)' : undefined, boxShadow: isActive ? 'inset 3px 0 0 var(--pv-sidebar-indicator)' : undefined })}>
        <LayoutDashboard size={20} aria-hidden /> <span className="lg:hidden xl:inline">Painel</span>
      </NavLink>
      <Link to="/totem" className={`${item} hover:text-white`} title="Abrir o totem de entrada">
        <CircleParking size={20} aria-hidden /> <span className="lg:hidden xl:inline">Totem de entrada</span>
      </Link>
      <span className={`${item} cursor-default opacity-70`} title="O localizador abre pelo QR Code do ticket">
        <ScanLine size={20} aria-hidden /> <span className="lg:hidden xl:inline">Localizador (QR Code)</span>
      </span>
      <div className="hidden lg:flex mt-auto items-center gap-2 px-3 text-xs">
        {conexao === 'conectado' ? <Wifi size={16} aria-hidden /> : <WifiOff size={16} aria-hidden />}
        <span className="xl:inline hidden">{conexao === 'conectado' ? 'Tempo real ativo' : conexao === 'conectando' ? 'Conectando…' : 'Sem tempo real'}</span>
      </div>
    </nav>
  );
}

function StatusConexao({ conexao }: { conexao: EstadoConexao }) {
  const cfg = {
    conectado: ['Ao vivo', 'var(--pv-feedback-success-solid)'],
    conectando: ['Conectando…', 'var(--pv-color-asfalto-400)'],
    desconectado: ['Sem conexão', 'var(--pv-feedback-danger-solid)'],
  }[conexao];
  return (
    <span role="status" className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-line text-sm font-semibold" data-conexao={conexao}>
      <span className="size-2.5 rounded-full" style={{ background: cfg[1] }} aria-hidden /> {cfg[0]}
    </span>
  );
}
