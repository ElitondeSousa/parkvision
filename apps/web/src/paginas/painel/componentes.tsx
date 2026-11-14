/**
 * Blocos do painel de operações (usam só componentes base do Design System).
 * Linguagem dos wireframes aprovados: poucos cartões, divisórias finas, status com ponto + texto, bronze só em ações.
 */
import { NOME_TIPO_VAGA, resumoVagasReservadas, vagasDaRegiao, type Indicadores, type Recomendacao, type Regiao, type Ticket, type TipoVaga } from '@parkvision/shared';
import {
  Activity, Ban, CarFront, CircleParking, KeyRound, LogIn, LogOut, MousePointerClick, Pause, Play, Plus, RotateCcw, Route, Square, Sun, TriangleAlert, Waves, WifiOff, X, Zap, type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Aviso, Botao, EstadoVazio, Esqueleto, Indicador, Medidor, Placa, Selo, Status, type TomStatus } from '../../componentes/base.tsx';
import { IconeTipoVaga } from '../../componentes/IconeTipoVaga.tsx';
import { nomeDoNivel, regiaoDoMapa } from '../../mapa/dados.ts';
import { congestionada, NOME_CATEGORIA, ROTULO_FAIXA, ROTULO_FLUXO, ROTULO_FONTE, faixaDaRegiao, hora, percentual, type FaixaRegiao } from '../../mapa/estado.ts';
import { api, mensagemDeErro, type CenarioResumo, type ConsultaTicket, type EstadoSimulacao } from '../../servicos/api.ts';
import type { EstadoConexao } from '../../servicos/tempo-real.ts';
import type { ItemMovimentacao, TipoItem } from './eventos.ts';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
/** Números no formato brasileiro (1.269). */
export const numero = (v: number) => v.toLocaleString('pt-BR');
/** Campo de formulário: 44 px de altura (alvo de toque) e tokens do tema. */
const CAMPO = 'h-11 px-3 rounded-md border border-line-strong bg-surface text-ink text-sm';

/** Estado da região → tom do status (ponto + texto; a cor nunca é o único sinal). */
export const TOM_FAIXA: Record<FaixaRegiao, TomStatus> = { livre: 'normal', alta: 'atencao', critica: 'perigo', lotada: 'perigo', indisponivel: 'offline', 'sem-dados': 'perigo' };
export const COR_FAIXA_CSS: Record<FaixaRegiao, string> = {
  livre: 'var(--pv-faixa-livre)', alta: 'var(--pv-faixa-alta)', critica: 'var(--pv-faixa-critica)', lotada: 'var(--pv-faixa-lotada)', indisponivel: 'var(--pv-faixa-indisponivel)', 'sem-dados': 'var(--pv-faixa-sem-dados)',
};

export function StatusRegiao({ regiao }: { regiao: Regiao }) {
  const f = faixaDaRegiao(regiao);
  return <Status tom={TOM_FAIXA[f]}>{ROTULO_FAIXA[f]}</Status>;
}

/**
 * Número que acende em bronze por um instante quando o valor muda em tempo real (só cor, sem movimento).
 * Web Animations em vez de transição CSS: a troca de tema continua instantânea.
 */
function NumeroVivo({ valor }: { valor: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const anterior = useRef(valor);
  useEffect(() => {
    if (anterior.current === valor) return;
    anterior.current = valor;
    const el = ref.current;
    if (!el?.animate) return;
    const estilo = getComputedStyle(el);
    const destaque = estilo.getPropertyValue('--pv-text-link').trim();
    if (destaque) el.animate([{ color: destaque }, { color: estilo.color }], { duration: 900, easing: 'ease-out' });
  }, [valor]);
  return <span ref={ref}>{numero(valor)}</span>;
}

// ── Visão geral: vagas livres como número dominante, barra de ocupação e linhas de contexto ──
export function VisaoGeral({ indicadores: i, regioes, congestionadas, indisponiveis, falhou, className }: {
  indicadores: Indicadores | null; regioes: Regiao[] | null; congestionadas: string[]; indisponiveis: string[]; falhou?: boolean; className?: string;
}) {
  const linha = (testid: string, rotulo: string, valor: number, contexto?: string, alerta = false) => (
    <div className="flex items-baseline justify-between gap-4 py-3 border-b border-line" data-testid={testid}>
      <dt className="min-w-0">
        <span className="block text-sm text-ink-2">{rotulo}</span>
        {contexto && <span className="block text-xs text-ink-3 truncate" title={contexto}>{contexto}</span>}
      </dt>
      <dd className="m-0 inline-flex items-center gap-1.5 font-display text-2xl font-semibold num leading-none" style={{ color: alerta ? 'var(--pv-feedback-warning-fg)' : undefined }}>
        {alerta && <TriangleAlert size={16} aria-hidden strokeWidth={2.25} />}
        <NumeroVivo valor={valor} />
      </dd>
    </div>
  );
  return (
    // fundo de superfície explícito: a coluna fica sobre a faixa branca e acompanha o tema
    <section id="visao-geral" tabIndex={-1} aria-labelledby="titulo-visao-geral" className={cx('scroll-mt-20 bg-surface focus:outline-none', className)}>
      <h2 id="titulo-visao-geral" className="sr-only-texto">Visão geral</h2>
      {!i && falhou ? (
        <div className="grid gap-2">
          <p className="m-0 text-sm text-ink-2">Vagas livres</p>
          <p className="m-0 font-display text-[64px] font-bold leading-none text-ink-3" aria-hidden>—</p>
          <p className="m-0 text-sm text-ink-2">Os números aparecem assim que o sistema responder.</p>
        </div>
      ) : !i ? (
        <div className="grid gap-3">
          <p className="m-0 text-sm text-ink-2" role="status">Carregando dados do estacionamento</p>
          <Esqueleto className="h-20 w-48" />
          <Esqueleto className="h-2 w-full" />
          {Array.from({ length: 4 }, (_, k) => <Esqueleto key={k} className="h-9 w-full" />)}
        </div>
      ) : (
        <>
          <div data-testid="kpi-capacidade">
            <Indicador testId="kpi-livres" rotulo="Vagas livres" valor={<NumeroVivo valor={i.livres} />} complemento={`de ${numero(i.capacidadeTotal)}`} />
            <div className="mt-5">
              <Medidor valor={i.ocupadas} total={i.capacidadeTotal} cor="var(--pv-brand-primary)" rotulo="Taxa de ocupação geral" />
            </div>
            <p className="m-0 mt-2 flex justify-between text-xs text-ink-2 num">
              <span>{Math.round(i.taxaOcupacao)}% ocupado</span>
              <span>{100 - Math.round(i.taxaOcupacao)}% livre</span>
            </p>
          </div>
          <dl className="m-0 mt-6 border-t border-line">
            {linha('kpi-ocupadas', 'Estacionados', i.ocupadas)}
            {linha('kpi-entrando', 'A caminho', i.veiculosAguardando, 'com ticket, indo para a vaga')}
            {linha('kpi-congestionadas', 'Regiões congestionadas', congestionadas.length, congestionadas.length ? congestionadas.join(', ') : 'nenhuma com fluxo elevado', congestionadas.length > 0)}
            {linha('kpi-indisponiveis', 'Regiões indisponíveis', indisponiveis.length, indisponiveis.length ? indisponiveis.join(', ') : 'todas operando', indisponiveis.length > 0)}
          </dl>
          <StatusOperacional regioes={regioes} recomendacoesUltimaHora={i.recomendacoesUltimaHora} />
        </>
      )}
    </section>
  );
}

function StatusOperacional({ regioes, recomendacoesUltimaHora }: { regioes: Regiao[] | null; recomendacoesUltimaHora: number }) {
  if (!regioes) return null;
  const emAtencao = regioes.filter((r) => ['alta', 'critica', 'lotada'].includes(faixaDaRegiao(r))).map((r) => r.id);
  const sensores = regioes.filter((r) => r.statusSensores && r.statusSensores !== 'ok').map((r) => r.id);
  return (
    <ul className="list-none m-0 mt-4 p-0 grid gap-1.5 text-sm" aria-label="Estado da operação">
      <li>
        {emAtencao.length
          ? <Status tom="atencao">{emAtencao.length === 1 ? '1 região em atenção' : `${emAtencao.length} regiões em atenção`}: {emAtencao.join(', ')}</Status>
          : <Status tom="normal">Ocupação dentro do normal</Status>}
      </li>
      <li>
        {sensores.length
          ? <Status tom="perigo">Sensores com falha: {sensores.join(', ')}</Status>
          : <Status tom="offline">Sensores sem falhas nas {regioes.length} regiões</Status>}
      </li>
      <li className="text-xs text-ink-3 num pl-3.5">{recomendacoesUltimaHora === 1 ? '1 recomendação na última hora' : `${numero(recomendacoesUltimaHora)} recomendações na última hora`}</li>
    </ul>
  );
}

// ── Recomendação atual (acima do mapa) ──
export function RecomendacaoAtual({ dados, aoSelecionar }: { dados: { recomendacao: Recomendacao; ticket?: Ticket } | null; aoSelecionar: (id: string) => void }) {
  if (!dados) return <p className="m-0 text-sm text-ink-2" data-testid="recomendacao-atual">Nenhuma recomendação ainda. A última aparece aqui assim que um veículo entra.</p>;
  const { recomendacao: r, ticket } = dados;
  return (
    <div data-testid="recomendacao-atual" className="flex items-center gap-2 min-w-0">
      <button onClick={() => aoSelecionar(r.regiaoId)} className="shrink-0 inline-flex items-center justify-center min-h-11 min-w-11 rounded-md cursor-pointer" aria-label={`Selecionar região ${r.regiaoId}`}>
        <Placa codigo={r.regiaoId} tamanho="sm" />
      </button>
      <div className="min-w-0 text-sm">
        <p className="m-0">
          <span className="font-medium">Última recomendação</span>
          {ticket ? <> para <span className="font-mono">{ticket.codigo}</span> ({NOME_CATEGORIA[ticket.categoria].toLowerCase()})</> : <> para <span className="font-mono">{r.ticketCodigo}</span></>}
          <span className="text-ink-3 num"> às {hora(r.criadaEm)}</span>
        </p>
        {/* line-clamp em vez de truncate: a regra global de <p> (text-wrap) vence utilitários de white-space */}
        <p className="m-0 text-ink-2 line-clamp-2" title={r.justificativa}>{r.justificativa}</p>
      </div>
    </div>
  );
}

// ── Detalhe da região ──
export function DetalheRegiao({ regiao, aoFechar, className }: { regiao: Regiao | null; aoFechar: () => void; className?: string }) {
  if (!regiao) {
    return (
      <section aria-label="Região selecionada" className={cx('border-t border-line pt-5', className)}>
        <p className="m-0 flex items-start gap-2.5 text-sm text-ink-2">
          <MousePointerClick size={18} aria-hidden className="shrink-0 mt-0.5" />
          Selecione uma região no mapa ou na tabela para ver capacidade, vagas por tipo e estado.
        </p>
      </section>
    );
  }
  const doMapa = regiaoDoMapa[regiao.id];
  const f = faixaDaRegiao(regiao);
  const linha = (t: string, v: ReactNode) => (<><dt className="text-ink-2">{t}</dt><dd className="m-0 font-medium text-right num">{v}</dd></>);
  return (
    <section aria-label="Região selecionada" className={cx('border-t border-line pt-5', className)}>
      <div data-testid="detalhe-regiao" className="grid gap-4">
        <div className="flex items-start gap-3">
          <Placa codigo={regiao.id} />
          <div className="min-w-0 flex-1">
            <p className="m-0 font-display text-xl font-semibold leading-tight">{regiao.nome}</p>
            <p className="m-0 text-sm text-ink-2">{nomeDoNivel(regiao.nivel)}{doMapa?.coberta ? ' · coberto' : ' · descoberto'}</p>
          </div>
          <Botao variante="fantasma" icone={X} onClick={aoFechar} aria-label="Fechar detalhes da região" className="w-11 px-0 -mr-2 -mt-1 shrink-0" />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <StatusRegiao regiao={regiao} />
          {regiao.fluxo && <Status tom={regiao.fluxo.nivel === 'elevado' ? 'atencao' : 'offline'}>{ROTULO_FLUXO[regiao.fluxo.nivel]}</Status>}
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1.5"><span className="text-ink-2">Ocupação</span><span className="font-semibold num">{percentual(regiao)}%</span></div>
          <Medidor valor={regiao.ocupadas} total={regiao.capacidade} cor={COR_FAIXA_CSS[f]} rotulo={`Ocupação da região ${regiao.id}`} />
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm m-0">
          {linha('Capacidade', regiao.capacidade)}
          {linha('Ocupadas', regiao.ocupadas)}
          {linha('Livres', regiao.livres)}
          {(['COMUM', 'PCD', 'IDOSO'] as const).filter((t) => t === 'COMUM' || vagasDaRegiao(regiao)[t].capacidade > 0).map((t) => {
            const v = vagasDaRegiao(regiao)[t];
            return <span key={t} className="contents" data-testid={`detalhe-vagas-${t}`}>{linha(ROTULO_LIVRES[t], `${v.livres} / ${v.capacidade}`)}</span>;
          })}
          {linha('Veículos permitidos', regiao.categorias.map((c) => NOME_CATEGORIA[c]).join(', '))}
          {linha('Estado operacional', regiao.operacional ? 'Operando' : 'Indisponível')}
          {linha('Sensores', regiao.statusSensores === 'ok' || !regiao.statusSensores ? 'Normais' : regiao.statusSensores === 'sem-comunicacao' ? 'Sem comunicação' : 'Leitura inconsistente')}
          {regiao.fluxo && linha('Fluxo (últimos 5 min)', `${regiao.fluxo.recente} de referência ${regiao.fluxo.vazaoReferencia}`)}
        </dl>
        {doMapa && <p className="m-0 text-sm text-ink-2">{doMapa.referencia}.</p>}
        <p className="m-0 text-xs text-ink-3">{ROTULO_FONTE[regiao.fonteCapacidade] ?? regiao.fonteCapacidade}.{regiao.fonteVagasReservadas && regiao.fonteVagasReservadas !== 'sem-reserva' ? ` ${FONTE_RESERVADAS[regiao.fonteVagasReservadas]}.` : ''}</p>
      </div>
    </section>
  );
}

const ROTULO_LIVRES: Record<TipoVaga, string> = { COMUM: 'Vagas comuns livres', PCD: 'Vagas PcD livres', IDOSO: 'Vagas pessoa idosa livres' };
const FONTE_RESERVADAS: Record<string, string> = {
  planta: 'Vagas reservadas lidas na planta',
  proposta: 'Vagas reservadas: proposta simulada (localização física a confirmar)',
  operador: 'Vagas reservadas ajustadas pelo operador',
};

// ── Vagas reservadas: disponibilidade por tipo, mínimos legais, alertas e ajuste administrativo ──
export function VagasReservadas({ regioes, aoNaoAutorizado }: { regioes: Regiao[] | null; aoNaoAutorizado: () => void }) {
  const carros = (regioes ?? []).filter((r) => r.categorias.some((c) => c !== 'MOTO'));
  const [regiaoId, setRegiaoId] = useState<string>('');
  const atual = carros.find((r) => r.id === regiaoId) ?? null;
  const [pcd, setPcd] = useState('');
  const [idoso, setIdoso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [retorno, setRetorno] = useState<{ tom: 'sucesso' | 'erro'; texto: string } | null>(null);
  const selecionar = (id: string) => {
    setRegiaoId(id); setRetorno(null);
    const r = carros.find((x) => x.id === id);
    setPcd(r ? String(vagasDaRegiao(r).PCD.capacidade) : ''); setIdoso(r ? String(vagasDaRegiao(r).IDOSO.capacidade) : '');
  };
  const salvar = async () => {
    if (!atual) return;
    setOcupado(true); setRetorno(null);
    try {
      await api.configurarVagasReservadas(atual.id, Number(pcd), Number(idoso));
      setRetorno({ tom: 'sucesso', texto: `Vagas reservadas da região ${atual.id} atualizadas.` });
    } catch (e) {
      setRetorno({ tom: 'erro', texto: mensagemDeErro(e) });
      if ((e as { codigo?: string }).codigo === 'NAO_AUTORIZADO') aoNaoAutorizado();
    } finally { setOcupado(false); }
  };
  if (!regioes) return <Esqueleto className="h-32" />;
  const resumo = resumoVagasReservadas(regioes);
  const invalido = !atual || !/^\d+$/.test(pcd) || !/^\d+$/.test(idoso);
  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 text-sm [&>*]:min-w-0" data-testid="vagas-reservadas">
      <div className="grid gap-4 content-start">
        <div><Selo tom="atencao">Proposta simulada</Selo></div>
        <ul className="list-none m-0 p-0 border-t border-line">
          {(['PCD', 'IDOSO'] as const).map((t) => {
            const tot = resumo.totais[t], abaixo = tot.capacidade < resumo.minimos[t];
            return (
              <li key={t} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 border-b border-line" data-testid={`total-${t}`}>
                <IconeTipoVaga tipo={t} tamanho={22} className="text-[var(--pv-vaga-reservada)] shrink-0" />
                <div className="flex-1 min-w-[12rem]">
                  <p className="m-0 font-medium">{NOME_TIPO_VAGA[t]}</p>
                  <p className="m-0 text-ink-2 num">{tot.livres} livres de {tot.capacidade} · mínimo legal {resumo.minimos[t]}</p>
                </div>
                <Status tom={abaixo ? 'perigo' : 'normal'}>{abaixo ? 'Abaixo do mínimo' : 'Mínimo atendido'}</Status>
              </li>
            );
          })}
        </ul>
        {resumo.alertas.map((a) => <Aviso key={a.tipo} tom="atencao" titulo="Distribuição abaixo do mínimo">{a.mensagem}</Aviso>)}
        <p className="m-0 text-xs text-ink-3 max-w-prose">
          Mínimos sobre o total de {resumo.base} vagas (Lei 13.146/2015, art. 47: 2%, mínimo 1; Lei 10.741/2003, art. 41: 5%), arredondados para cima.
          A planta informa as vagas do SS1 e do Subsolo 2; as do térreo são uma proposta simulada até a localização física ser confirmada com a operação.
        </p>
      </div>
      <details className="border-t border-line pt-3 self-start group">
        <summary className="cursor-pointer font-medium min-h-11 flex items-center select-none">Ajustar vagas de uma região</summary>
        <div className="grid gap-3 mt-2">
          <label htmlFor="regiao-reservadas" className="font-medium">Região</label>
          <select id="regiao-reservadas" value={regiaoId} onChange={(e) => selecionar(e.target.value)} className={CAMPO}>
            <option value="">Escolha a região</option>
            {carros.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.nome}</option>)}
          </select>
          {atual && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="font-medium">Vagas PcD</span>
                  <input inputMode="numeric" value={pcd} onChange={(e) => setPcd(e.target.value.trim())} className={cx(CAMPO, 'num')} /></label>
                <label className="grid gap-1"><span className="font-medium">Vagas pessoa idosa</span>
                  <input inputMode="numeric" value={idoso} onChange={(e) => setIdoso(e.target.value.trim())} className={cx(CAMPO, 'num')} /></label>
              </div>
              <p className="m-0 text-xs text-ink-2 num">
                Capacidade {atual.capacidade}: ficariam {Math.max(0, atual.capacidade - (Number(pcd) || 0) - (Number(idoso) || 0))} vagas comuns.
                Ocupadas agora: {vagasDaRegiao(atual).COMUM.ocupadas} comuns, {vagasDaRegiao(atual).PCD.ocupadas} PcD, {vagasDaRegiao(atual).IDOSO.ocupadas} pessoa idosa.
              </p>
              <div><Botao carregando={ocupado} disabled={invalido} onClick={salvar}>Salvar vagas reservadas</Botao></div>
            </>
          )}
          {retorno && <Aviso tom={retorno.tom === 'sucesso' ? 'sucesso' : 'erro'} titulo={retorno.tom === 'sucesso' ? 'Ajuste salvo' : 'Ajuste recusado'}>{retorno.texto}</Aviso>}
          <p className="m-0 text-xs text-ink-3">O sistema recusa valores que deixariam a ocupação atual inconsistente (ex.: menos vagas PcD do que as ocupadas agora).</p>
        </div>
      </details>
    </div>
  );
}

// ── Acesso do operador (um token para operação de tickets, simulador e vagas reservadas) ──
export function AcessoOperador({ pedindo, aoSalvar, aoTrocar }: { pedindo: boolean; aoSalvar: (token: string) => void; aoTrocar: () => void }) {
  const [token, setToken] = useState('');
  if (!pedindo) {
    return (
      <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
        <KeyRound size={15} aria-hidden /> Operador identificado nesta aba.
        <button className="underline underline-offset-2 min-h-11 cursor-pointer text-[var(--pv-text-link)]" onClick={aoTrocar}>Trocar token</button>
      </p>
    );
  }
  return (
    <form className="grid gap-2 text-sm rounded-lg border border-line bg-surface p-4 max-w-2xl" onSubmit={(e) => { e.preventDefault(); aoSalvar(token); setToken(''); }}>
      <label htmlFor="token-operador" className="font-medium inline-flex items-center gap-1.5"><KeyRound size={14} aria-hidden /> Token do operador</label>
      <div className="flex gap-2">
        <input id="token-operador" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className={cx(CAMPO, 'flex-1 min-w-0')} placeholder="Token configurado na API" />
        <Botao type="submit" variante="secundario">Salvar</Botao>
      </div>
      <p className="m-0 text-xs text-ink-3">Confirmar estacionamentos, registrar saídas, controlar o simulador e ajustar vagas exigem o token configurado na API. Ele fica guardado só nesta aba.</p>
    </form>
  );
}

// ── Operação de tickets (confirmação e saída) ──
const ROTULO_STATUS: Record<Ticket['status'], [string, TomStatus]> = {
  AGUARDANDO: ['Aguardando confirmação', 'info'], ESTACIONADO: ['Estacionado', 'normal'], SAIU: ['Saiu', 'offline'], CANCELADO: ['Cancelado', 'offline'],
};
/**
 * Registra a confirmação de estacionamento e a saída pelo código impresso no ticket.
 * Equivale à leitura do ticket na região (confirmação) e na cancela de saída — as regras são as do backend:
 * a confirmação revalida a disponibilidade; região cheia é recusada e o operador pede uma nova recomendação.
 */
export function OperacaoTicket({ regioes, aoSelecionar, aoNaoAutorizado }: { regioes: Regiao[] | null; aoSelecionar: (id: string) => void; aoNaoAutorizado: () => void }) {
  const [codigo, setCodigo] = useState('');
  const [consulta, setConsulta] = useState<ConsultaTicket | null>(null);
  const [destino, setDestino] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'sucesso' | 'erro'; titulo: string; texto?: string; lotada?: boolean } | null>(null);

  const tratar = (e: unknown, titulo: string) => {
    const err = e as { codigo?: string };
    if (err.codigo === 'NAO_AUTORIZADO') aoNaoAutorizado();
    setAviso({ tom: 'erro', titulo, texto: mensagemDeErro(e), lotada: err.codigo === 'REGIAO_LOTADA' || err.codigo === 'REGIAO_INDISPONIVEL' });
  };
  const consultar = async (c = codigo) => {
    const cod = c.trim().toUpperCase();
    if (!cod) return;
    setOcupado('consultar');
    try {
      const r = await api.tickets.consultar(cod);
      setConsulta(r); setCodigo(cod);
      setDestino(r.ticket.regiaoRecomendadaId);
    } catch (e) { setConsulta(null); tratar(e, 'Ticket não consultado'); }
    finally { setOcupado(null); }
  };
  const executar = async (rotulo: string, acao: () => Promise<unknown>, sucesso: string) => {
    if (!consulta) return;
    setOcupado(rotulo); setAviso(null);
    try {
      await acao();
      setAviso({ tom: 'sucesso', titulo: sucesso });
      await consultar(consulta.ticket.codigo);
    } catch (e) { tratar(e, 'Operação recusada'); }
    finally { setOcupado(null); }
  };
  const pedirNovaRecomendacao = async () => {
    if (!consulta) return;
    setOcupado('recomendacao');
    try {
      const r = await api.tickets.novaRecomendacao(consulta.ticket.codigo);
      setAviso({ tom: 'sucesso', titulo: `Nova recomendação: região ${r.recomendacao.regiaoId}`, texto: r.recomendacao.justificativa });
      await consultar(consulta.ticket.codigo);
      setDestino(r.recomendacao.regiaoId);
    } catch (e) { tratar(e, 'Sem nova recomendação'); }
    finally { setOcupado(null); }
  };

  const t = consulta?.ticket;
  const compativeis = t && regioes ? regioes.filter((r) => r.categorias.includes(t.categoria)) : [];
  const placa = (id: string) => (
    <button className="inline-flex items-center min-h-11 cursor-pointer rounded-md" onClick={() => aoSelecionar(id)} aria-label={`Ver região ${id}`}><Placa codigo={id} tamanho="sm" /></button>
  );
  return (
    <div className="grid gap-4 text-sm" data-testid="operacao-ticket">
      <p className="m-0 text-ink-2 max-w-prose">Confirme o estacionamento e registre a saída pelo código do ticket. Equivale à leitura do ticket na região e na cancela.</p>
      <form className="grid gap-1.5" onSubmit={(e) => { e.preventDefault(); void consultar(); }}>
        <label htmlFor="codigo-ticket" className="font-medium">Código do ticket</label>
        <div className="flex gap-2">
          <input id="codigo-ticket" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="PV-0001" autoComplete="off" className={cx(CAMPO, 'flex-1 min-w-0 font-mono uppercase')} />
          <Botao type="submit" variante="secundario" carregando={ocupado === 'consultar'}>Consultar</Botao>
        </div>
      </form>
      {t && (
        <div className="grid gap-3 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-base font-semibold">{t.codigo}</span>
            <span className="flex items-center gap-3">{consulta?.simulado && <Selo tom="atencao">Simulado</Selo>}<Status tom={ROTULO_STATUS[t.status][1]}>{ROTULO_STATUS[t.status][0]}</Status></span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 m-0">
            <dt className="text-ink-2">Veículo</dt><dd className="m-0 py-2">{NOME_CATEGORIA[t.categoria]}</dd>
            <dt className="text-ink-2">Recomendada</dt><dd className="m-0">{placa(t.regiaoRecomendadaId)}</dd>
            {t.regiaoEstacionadaId && <><dt className="text-ink-2">Estacionado em</dt><dd className="m-0">{placa(t.regiaoEstacionadaId)}</dd></>}
          </dl>
          {t.status === 'AGUARDANDO' && (
            <div className="grid gap-3 border-t border-line pt-3">
              <label className="grid gap-1">
                <span className="font-medium">Região onde o veículo estacionou</span>
                <select value={destino} onChange={(e) => setDestino(e.target.value)} className={CAMPO}>
                  {compativeis.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.nome} ({r.livres} livres){r.id === t.regiaoRecomendadaId ? ' · recomendada' : ''}</option>)}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <Botao icone={CircleParking} carregando={ocupado === 'estacionar'} onClick={() => executar('estacionar', () => api.tickets.estacionar(t.codigo, destino || undefined), `Estacionamento confirmado em ${destino}`)}>Confirmar estacionamento</Botao>
                <Botao variante="fantasma" carregando={ocupado === 'cancelar'} onClick={() => executar('cancelar', () => api.tickets.cancelar(t.codigo), 'Ticket cancelado')}>Cancelar ticket</Botao>
              </div>
            </div>
          )}
          {t.status === 'ESTACIONADO' && (
            <div className="border-t border-line pt-3">
              <Botao variante="secundario" icone={LogOut} carregando={ocupado === 'saida'} onClick={() => executar('saida', () => api.tickets.saida(t.codigo), 'Saída registrada')}>Registrar saída</Botao>
            </div>
          )}
        </div>
      )}
      {aviso && (
        <Aviso tom={aviso.tom} titulo={aviso.titulo}
          acao={aviso.lotada && t?.status === 'AGUARDANDO' ? <Botao tamanho="sm" variante="secundario" icone={Route} carregando={ocupado === 'recomendacao'} onClick={pedirNovaRecomendacao}>Solicitar nova recomendação</Botao> : undefined}>
          {aviso.texto}
        </Aviso>
      )}
    </div>
  );
}

// ── Simulador ──
/** Nas demonstrações, parte dos carros pede vaga reservada (só para mostrar o fluxo; não é estatística real). */
const TIPOS_DEMONSTRACAO = { COMUM: 0.9, PCD: 0.04, IDOSO: 0.06 };

/**
 * Ritmos prontos da simulação (tudo marcado como dado simulado). O relógio é acelerado, mas o tempo de manobra é escolhido
 * para o carrinho animado chegar à região mais ou menos quando a confirmação acontece no backend.
 */
export const RITMOS = {
  livre: { velocidade: 10, entradasPorMinuto: 3, tempoManobraSeg: 60, proporcaoTipoVaga: TIPOS_DEMONSTRACAO },     // Iniciar
  vazio: { velocidade: 10, entradasPorMinuto: 0, tempoManobraSeg: 60 },     // Adicionar veículo com a simulação parada
  tranquilo: { cenario: 'A' as const, config: { velocidade: 10, tempoManobraSeg: 60, proporcaoTipoVaga: TIPOS_DEMONSTRACAO } },
  pico: { cenario: 'B' as const, config: { velocidade: 3, tempoManobraSeg: 30, proporcaoTipoVaga: TIPOS_DEMONSTRACAO } },
};

export function ControleSimulador({ estado, cenarios, aoAtualizar, aoNaoAutorizado }: { estado: EstadoSimulacao | null; cenarios: CenarioResumo[]; aoAtualizar: () => Promise<unknown>; aoNaoAutorizado: () => void }) {
  const [cenario, setCenario] = useState<string>('C');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarReinicio, setConfirmarReinicio] = useState(false);
  const [tipoNovo, setTipoNovo] = useState<TipoVaga>('COMUM');

  const executar = async (rotulo: string, acao: () => Promise<unknown>) => {
    setOcupado(rotulo); setErro(null);
    try { await acao(); await aoAtualizar(); }
    catch (e) {
      setErro(mensagemDeErro(e));
      if ((e as { codigo?: string }).codigo === 'NAO_AUTORIZADO') aoNaoAutorizado();
    } finally { setOcupado(null); setConfirmarReinicio(false); }
  };

  const status = estado?.status ?? 'parado';
  const rotuloStatus = { parado: 'Parada', rodando: 'Rodando', pausado: 'Pausada' }[status];
  const tomStatus: TomStatus = status === 'rodando' ? 'normal' : status === 'pausado' ? 'atencao' : 'offline';
  const descricao = cenarios.find((c) => c.id === cenario)?.descricao;
  const nomeCenario = estado?.cenario ? cenarios.find((c) => c.id === estado.cenario)?.nome ?? `Cenário ${estado.cenario}` : null;

  const iniciar = () => executar('iniciar', () => (status === 'pausado' ? api.simulacao.acao('retomar') : api.simulacao.iniciar(RITMOS.livre)));
  const adicionar = () => executar('adicionar', async () => {
    if (status === 'parado') await api.simulacao.iniciar(RITMOS.vazio); // sem chegadas automáticas: só o veículo pedido
    // vaga reservada só faz sentido para carro; o veículo comum continua sorteando a categoria
    await api.simulacao.evento(tipoNovo === 'COMUM' ? { acao: 'entrada' } : { acao: 'entrada', categoria: 'CARRO_PEQUENO', tipoVaga: tipoNovo });
  });

  return (
    <div className="grid gap-5 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span data-testid="status-simulacao" className="text-base"><Status tom={tomStatus}>{rotuloStatus}</Status></span>
        {estado && (
          <p className="m-0 text-ink-2 min-w-0" data-testid="resumo-simulacao">
            {status === 'parado'
              ? 'Veículos simulados entram pelo totem virtual, seguem a rota no mapa e só ocupam vaga quando o estacionamento é confirmado.'
              : <>{nomeCenario ? <><strong className="text-ink font-semibold">{nomeCenario}</strong> · </> : null}<span className="num">{Math.floor(estado.decorridoSimuladoSeg / 60)} min simulados · {estado.veiculos.estacionados} estacionados · {estado.veiculos.aguardando} a caminho</span></>}
          </p>
        )}
      </div>
      {!estado ? <Esqueleto className="h-24" /> : (
        <>
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
            {status === 'rodando'
              ? <Botao variante="secundario" icone={Pause} carregando={ocupado === 'pausar'} onClick={() => executar('pausar', () => api.simulacao.acao('pausar'))}>Pausar</Botao>
              : <Botao icone={Play} carregando={ocupado === 'iniciar'} onClick={iniciar}>{status === 'pausado' ? 'Retomar' : 'Iniciar'}</Botao>}
            <div className="flex gap-2 min-w-0">
              <Botao variante="secundario" icone={Plus} carregando={ocupado === 'adicionar'} onClick={adicionar} className="flex-1 sm:flex-none">Adicionar veículo</Botao>
              <select aria-label="Tipo de vaga do veículo adicionado" value={tipoNovo} onChange={(e) => setTipoNovo(e.target.value as TipoVaga)} className={CAMPO}>
                <option value="COMUM">Vaga comum</option>
                <option value="PCD">Vaga PcD</option>
                <option value="IDOSO">Pessoa idosa</option>
              </select>
            </div>
            <Botao variante="secundario" icone={Zap} carregando={ocupado === 'pico'} onClick={() => executar('pico', () => api.simulacao.cenario(RITMOS.pico.cenario, RITMOS.pico.config))}>Simular horário de pico</Botao>
            <Botao variante="secundario" icone={Sun} carregando={ocupado === 'tranquilo'} onClick={() => executar('tranquilo', () => api.simulacao.cenario(RITMOS.tranquilo.cenario, RITMOS.tranquilo.config))}>Simular estacionamento tranquilo</Botao>
            {!confirmarReinicio && (
              <Botao variante="fantasma" icone={RotateCcw} onClick={() => setConfirmarReinicio(true)} disabled={!estado.veiculosSimuladosAtivos && status === 'parado'}>Reiniciar</Botao>
            )}
          </div>
          {confirmarReinicio && (
            <div className="grid gap-3 rounded-lg border border-line bg-surface p-4 max-w-2xl" role="group" aria-label="Confirmar reinício da simulação">
              <p className="m-0">Reiniciar apaga todos os dados simulados e para a simulação. Dados reais e ajustes do operador são mantidos.</p>
              <div className="flex flex-wrap gap-2">
                <Botao variante="perigo" carregando={ocupado === 'reiniciar'} onClick={() => executar('reiniciar', () => api.simulacao.acao('reiniciar'))}>Apagar dados simulados</Botao>
                <Botao variante="fantasma" onClick={() => setConfirmarReinicio(false)}>Cancelar</Botao>
              </div>
            </div>
          )}
          <p className="m-0 text-xs text-ink-3">Os ritmos prontos começam do zero: apagam só os dados simulados anteriores (dados reais ficam).</p>
          <details className="border-t border-line pt-1 max-w-2xl">
            <summary className="cursor-pointer font-medium text-ink-2 select-none min-h-11 flex items-center">Mais opções</summary>
            <div className="grid gap-3 mt-1 pb-1">
              <label htmlFor="cenario" className="font-medium">Cenário</label>
              <div className="grid gap-2 sm:flex sm:items-center">
                <select id="cenario" value={cenario} onChange={(e) => setCenario(e.target.value)} className={cx(CAMPO, 'sm:flex-1 min-w-0')}>
                  {cenarios.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.nome}</option>)}
                </select>
                <Botao variante="secundario" icone={Play} carregando={ocupado === 'cenario'} onClick={() => executar('cenario', () => api.simulacao.cenario(cenario as CenarioResumo['id']))}>Iniciar cenário {cenario}</Botao>
              </div>
              {descricao && <p className="m-0 text-ink-2">{descricao}</p>}
              {status !== 'parado' && (
                <div className="grid gap-2 border-t border-line pt-3">
                  <label className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Velocidade do relógio</span>
                    <select aria-label="Velocidade da simulação" value={estado.velocidade} onChange={(e) => executar('velocidade', () => api.simulacao.velocidade(Number(e.target.value)))} className={CAMPO}>
                      {[...new Set([1, 3, 10, 30, 60, 120, estado.velocidade])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v}× {v === 1 ? '(tempo real)' : ''}</option>)}
                    </select>
                  </label>
                  <div><Botao variante="fantasma" icone={Square} carregando={ocupado === 'encerrar'} onClick={() => executar('encerrar', () => api.simulacao.acao('encerrar'))}>Encerrar (mantém os dados simulados)</Botao></div>
                </div>
              )}
            </div>
          </details>
        </>
      )}
      {erro && <Aviso tom="erro" titulo="Ação não executada">{erro}</Aviso>}
    </div>
  );
}

// ── Movimentações ──
const ICONE_ITEM: Record<TipoItem, LucideIcon> = {
  entrada: LogIn, recomendacao: Route, estacionou: CircleParking, saida: LogOut, lotada: CarFront, disponibilidade: Ban, congestionamento: Waves, sensor: WifiOff, simulador: Activity, alerta: TriangleAlert,
};
const COR_ITEM: Partial<Record<TipoItem, string>> = {
  lotada: 'var(--pv-feedback-danger-fg)', alerta: 'var(--pv-feedback-warning-fg)', congestionamento: 'var(--pv-feedback-warning-fg)', sensor: 'var(--pv-status-erro-fg)', estacionou: 'var(--pv-feedback-success-fg)', recomendacao: 'var(--pv-text-link)',
};
export function ListaMovimentacoes({ itens, conexao, aoSelecionar }: { itens: ItemMovimentacao[]; conexao: EstadoConexao; aoSelecionar: (id: string) => void }) {
  if (itens.length === 0) {
    return (
      <EstadoVazio icone={conexao === 'desconectado' ? WifiOff : Activity} titulo={conexao === 'desconectado' ? 'Sem conexão em tempo real' : 'Aguardando movimentações'}>
        {conexao === 'desconectado' ? 'As movimentações voltam a aparecer quando a conexão for restabelecida.' : 'Entradas, confirmações, saídas e alertas aparecem aqui conforme acontecem.'}
      </EstadoVazio>
    );
  }
  return (
    <ol data-testid="movimentacoes" aria-label="Movimentações recentes" aria-live="polite" aria-relevant="additions" tabIndex={0}
      className="list-none m-0 p-0 grid max-h-[440px] overflow-y-auto border-t border-line focus-visible:outline-offset-2">
      {itens.map((m) => {
        const Icone = ICONE_ITEM[m.tipo];
        return (
          <li key={m.id} className="flex items-start gap-3 py-2.5 border-b border-line text-sm">
            <Icone size={16} aria-hidden className="shrink-0 mt-0.5" style={{ color: COR_ITEM[m.tipo] ?? 'var(--pv-text-secondary)' }} />
            <div className="min-w-0 flex-1">
              <p className="m-0 leading-snug">{m.texto}</p>
              <p className="m-0 text-xs text-ink-3 num">{hora(m.quando)}{m.simulado ? ' · simulado' : ''}</p>
            </div>
            {m.regiaoId && (
              <button onClick={() => aoSelecionar(m.regiaoId!)} className="shrink-0 -my-2 inline-flex items-center min-h-11 cursor-pointer rounded-md" aria-label={`Ver região ${m.regiaoId}`}>
                <Placa codigo={m.regiaoId} tamanho="sm" />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Tabela de regiões (operação e alternativa acessível ao mapa) ──
function CelulaReservada({ tipo, regiao }: { tipo: TipoVaga; regiao: Regiao }) {
  const v = vagasDaRegiao(regiao)[tipo];
  if (!v.capacidade) return <td className="py-2 pr-4 text-ink-3" data-tipo={tipo}>—</td>;
  return (
    <td className="py-2 pr-4 num" data-tipo={tipo}>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <IconeTipoVaga tipo={tipo} tamanho={14} className="text-[var(--pv-vaga-reservada)]" />{v.livres} <span className="text-ink-3">/ {v.capacidade}</span>
        {v.livres === 0 && <span className="sr-only-texto"> (esgotadas)</span>}
      </span>
    </td>
  );
}

export function TabelaRegioes({ regioes, selecionada, aoSelecionar }: { regioes: Regiao[] | null; selecionada: string | null; aoSelecionar: (id: string) => void }) {
  if (!regioes) return <Esqueleto className="h-64" />;
  const tot = regioes.reduce((s, r) => ({ cap: s.cap + r.capacidade, oc: s.oc + r.ocupadas, liv: s.liv + r.livres }), { cap: 0, oc: 0, liv: 0 });
  const th = 'font-medium text-xs text-ink-2 text-left py-2.5 pr-4 whitespace-nowrap';
  return (
    <>
      {/* a tabela larga rola dentro do contêiner; a página nunca ganha rolagem lateral */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0" role="region" aria-label="Tabela de ocupação por região" tabIndex={0}>
        <table className="w-full min-w-[780px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-line">
              {['Região', 'Nível', 'Ocupação', 'Livres', 'PcD livres', 'Pessoa idosa livres', 'Comuns livres', 'Estado'].map((h, k) => (
                <th key={h} scope="col" className={cx(th, k === 0 && 'pl-3')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {regioes.map((r) => {
              const sel = selecionada === r.id;
              const comuns = vagasDaRegiao(r).COMUM;
              return (
                <tr key={r.id} data-regiao={r.id} onClick={() => aoSelecionar(r.id)}
                  className="border-b border-line cursor-pointer transition-colors duration-150 motion-reduce:transition-none hover:bg-[var(--pv-table-row-hover)]"
                  style={{ background: sel ? 'var(--pv-brand-subtle)' : undefined }}>
                  <td className="py-0 pl-3 pr-4" style={{ boxShadow: sel ? 'inset 3px 0 0 var(--pv-brand-primary)' : undefined }}>
                    <button className="flex items-center gap-3 min-h-11 cursor-pointer text-left rounded-sm" onClick={(e) => { e.stopPropagation(); aoSelecionar(r.id); }} aria-pressed={sel}>
                      <span className="font-mono font-semibold w-11 shrink-0" style={{ color: 'var(--pv-text-link)' }}>{r.id}</span>
                      <span className="font-medium text-ink whitespace-nowrap">{r.nome}</span>
                    </button>
                  </td>
                  <td className="py-2 pr-4 text-ink-2 whitespace-nowrap">{nomeDoNivel(r.nivel).replace(/\s*\(.*\)/, '')}</td>
                  <td className="py-2 pr-4 num">{percentual(r)}%</td>
                  <td className="py-2 pr-4 font-mono num whitespace-nowrap">{r.livres} <span className="text-ink-3">de {r.capacidade}</span></td>
                  {(['PCD', 'IDOSO'] as const).map((t) => <CelulaReservada key={t} tipo={t} regiao={r} />)}
                  <td className="py-2 pr-4 num whitespace-nowrap">{comuns.livres} <span className="text-ink-3">/ {comuns.capacidade}</span></td>
                  <td className="py-2 pr-4">
                    <span className="flex flex-col gap-0.5">
                      <StatusRegiao regiao={r} />
                      {congestionada(r) && <span className="text-xs font-medium pl-3.5" style={{ color: 'var(--pv-feedback-warning-fg)' }}>Fluxo elevado</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="m-0 mt-3 text-xs text-ink-3 num">{numero(tot.cap)} vagas, {numero(tot.oc)} ocupadas e {numero(tot.liv)} livres nas {regioes.length} regiões.</p>
    </>
  );
}
