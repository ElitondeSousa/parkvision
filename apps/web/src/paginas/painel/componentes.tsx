/** Blocos do dashboard administrativo (usam só componentes base do Design System). */
import { NOME_TIPO_VAGA, resumoVagasReservadas, vagasDaRegiao, type Indicadores, type Recomendacao, type Regiao, type Ticket, type TipoVaga } from '@parkvision/shared';
import {
  Activity, Ban, CarFront, CircleCheck, CircleParking, KeyRound, LogIn, LogOut, Pause, Play, Plus, RotateCcw, Route, Square, Sun, TriangleAlert, Waves, WifiOff, X, Zap, type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Aviso, Botao, Cartao, EstadoVazio, Esqueleto, Medidor, Placa, Selo, type TomSelo } from '../../componentes/base.tsx';
import { nomeDoNivel, regiaoDoMapa } from '../../mapa/dados.ts';
import { NOME_CATEGORIA, ROTULO_FAIXA, ROTULO_FLUXO, ROTULO_FONTE, faixaDaRegiao, hora, percentual, type FaixaRegiao } from '../../mapa/estado.ts';
import { api, mensagemDeErro, type CenarioResumo, type ConsultaTicket, type EstadoSimulacao } from '../../servicos/api.ts';
import type { EstadoConexao } from '../../servicos/tempo-real.ts';
import { IconeTipoVaga } from '../../componentes/IconeTipoVaga.tsx';
import type { ItemMovimentacao, TipoItem } from './eventos.ts';

export const TOM_FAIXA: Record<FaixaRegiao, TomSelo> = { livre: 'sucesso', alta: 'atencao', critica: 'perigo', lotada: 'perigo', indisponivel: 'neutro', 'sem-dados': 'erro' };
const ICONE_FAIXA: Record<FaixaRegiao, LucideIcon> = { livre: CircleCheck, alta: Activity, critica: TriangleAlert, lotada: CarFront, indisponivel: Ban, 'sem-dados': WifiOff };
export const COR_FAIXA_CSS: Record<FaixaRegiao, string> = {
  livre: 'var(--pv-faixa-livre)', alta: 'var(--pv-faixa-alta)', critica: 'var(--pv-faixa-critica)', lotada: 'var(--pv-faixa-lotada)', indisponivel: 'var(--pv-faixa-indisponivel)', 'sem-dados': 'var(--pv-faixa-sem-dados)',
};

export function SeloFaixa({ regiao }: { regiao: Regiao }) {
  const f = faixaDaRegiao(regiao);
  return <Selo tom={TOM_FAIXA[f]} icone={ICONE_FAIXA[f]}>{ROTULO_FAIXA[f]}</Selo>;
}

// ── Indicadores ──
export function FaixaIndicadores({ indicadores: i, congestionadas, indisponiveis }: { indicadores: Indicadores | null; congestionadas: string[]; indisponiveis: string[] }) {
  const celula = (rotulo: string, valor: string | number, contexto: string, testid: string, alerta = false) => (
    <div className="px-4 py-3 min-w-0" data-testid={testid}>
      <p className="m-0 text-sm text-ink-2">{rotulo}</p>
      <p className="m-0 font-display text-3xl font-semibold num leading-tight" style={{ color: alerta ? 'var(--pv-feedback-warning-fg)' : undefined }}>{valor}</p>
      <p className="m-0 text-xs text-ink-3 truncate" title={contexto}>{contexto}</p>
    </div>
  );
  return (
    <section aria-label="Indicadores gerais" className="bg-surface border border-line rounded-lg grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 divide-x divide-y xl:divide-y-0 divide-[var(--pv-border-subtle)] overflow-hidden">
      {!i ? (
        Array.from({ length: 6 }, (_, k) => <div key={k} className="p-4"><Esqueleto className="h-4 w-24" /><Esqueleto className="h-8 w-16 mt-2" /></div>)
      ) : (
        <>
          {celula('Capacidade total', i.capacidadeTotal, 'vagas nas 10 regiões', 'kpi-capacidade')}
          <div className="px-4 py-3 min-w-0" data-testid="kpi-ocupadas">
            <p className="m-0 text-sm text-ink-2">Veículos estacionados</p>
            <p className="m-0 font-display text-3xl font-semibold num leading-tight">{i.ocupadas} <span className="text-lg text-ink-2">{i.taxaOcupacao.toLocaleString('pt-BR')}%</span></p>
            <div className="mt-1.5"><Medidor valor={i.ocupadas} total={i.capacidadeTotal} cor={i.taxaOcupacao >= 90 ? 'var(--pv-faixa-critica)' : i.taxaOcupacao >= 70 ? 'var(--pv-faixa-alta)' : 'var(--pv-faixa-livre)'} rotulo="Taxa de ocupação geral" /></div>
          </div>
          {celula('Vagas livres', i.livres, 'disponíveis agora', 'kpi-livres')}
          {celula('Veículos entrando', i.veiculosAguardando, 'com ticket, a caminho da vaga', 'kpi-entrando')}
          {celula('Regiões congestionadas', congestionadas.length, congestionadas.length ? congestionadas.join(', ') : 'nenhuma com fluxo elevado', 'kpi-congestionadas', congestionadas.length > 0)}
          {celula('Regiões indisponíveis', indisponiveis.length, indisponiveis.length ? indisponiveis.join(', ') : 'todas operando', 'kpi-indisponiveis', indisponiveis.length > 0)}
        </>
      )}
    </section>
  );
}

// ── Recomendação atual ──
export function RecomendacaoAtual({ dados, aoSelecionar }: { dados: { recomendacao: Recomendacao; ticket?: Ticket } | null; aoSelecionar: (id: string) => void }) {
  if (!dados) return <p className="m-0 text-sm text-ink-2" data-testid="recomendacao-atual">Nenhuma recomendação ainda. Elas aparecem aqui assim que um veículo entra.</p>;
  const { recomendacao: r, ticket } = dados;
  return (
    <div data-testid="recomendacao-atual" className="flex items-start gap-3 rounded-md p-3" style={{ background: 'var(--pv-wayfinding-subtle)' }}>
      <button onClick={() => aoSelecionar(r.regiaoId)} className="cursor-pointer" aria-label={`Selecionar região ${r.regiaoId}`}><Placa codigo={r.regiaoId} /></button>
      <div className="min-w-0 text-sm">
        <p className="m-0 font-semibold">
          Última recomendação{ticket ? <> para <span className="font-mono">{ticket.codigo}</span> ({NOME_CATEGORIA[ticket.categoria].toLowerCase()})</> : <> para <span className="font-mono">{r.ticketCodigo}</span></>}
          <span className="font-normal text-ink-2"> às {hora(r.criadaEm)}</span>
        </p>
        <p className="m-0 text-ink-2 line-clamp-2" title={r.justificativa}>{r.justificativa}</p>
      </div>
    </div>
  );
}

// ── Detalhe da região ──
export function DetalheRegiao({ regiao, aoFechar }: { regiao: Regiao | null; aoFechar: () => void }) {
  if (!regiao) {
    return <Cartao titulo="Região"><EstadoVazio icone={CircleParking} titulo="Selecione uma região">Toque numa região do mapa ou da tabela para ver capacidade, ocupação e estado.</EstadoVazio></Cartao>;
  }
  const doMapa = regiaoDoMapa[regiao.id];
  const f = faixaDaRegiao(regiao);
  const linha = (t: string, v: ReactNode) => (<><dt className="text-ink-2">{t}</dt><dd className="m-0 font-medium text-right num">{v}</dd></>);
  return (
    <Cartao titulo="Região selecionada" acao={<Botao variante="fantasma" tamanho="sm" onClick={aoFechar} aria-label="Fechar detalhes da região"><X size={16} aria-hidden /></Botao>}>
      <div data-testid="detalhe-regiao" className="grid gap-3">
        <div className="flex items-center gap-3">
          <Placa codigo={regiao.id} tamanho="lg" />
          <div className="min-w-0">
            <p className="m-0 font-display text-xl font-semibold">{regiao.nome}</p>
            <p className="m-0 text-sm text-ink-2">{nomeDoNivel(regiao.nivel)}{doMapa?.coberta ? ' · coberto' : ' · descoberto'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5"><SeloFaixa regiao={regiao} />{regiao.fluxo && <Selo tom={regiao.fluxo.nivel === 'elevado' ? 'atencao' : 'neutro'} icone={Waves}>{ROTULO_FLUXO[regiao.fluxo.nivel]}</Selo>}</div>
        <div>
          <div className="flex justify-between text-sm mb-1"><span className="text-ink-2">Ocupação</span><span className="font-semibold num">{percentual(regiao)}%</span></div>
          <Medidor valor={regiao.ocupadas} total={regiao.capacidade} cor={COR_FAIXA_CSS[f]} rotulo={`Ocupação da região ${regiao.id}`} />
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-sm m-0">
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
    </Cartao>
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
  if (!regioes) return <Cartao titulo="Vagas reservadas"><Esqueleto className="h-32" /></Cartao>;
  const resumo = resumoVagasReservadas(regioes);
  const invalido = !atual || !/^\d+$/.test(pcd) || !/^\d+$/.test(idoso);
  return (
    <Cartao titulo="Vagas reservadas" acao={<Selo tom="atencao">Proposta simulada</Selo>}>
      <div className="grid gap-3 text-sm" data-testid="vagas-reservadas">
        <ul className="list-none m-0 p-0 grid gap-2">
          {(['PCD', 'IDOSO'] as const).map((t) => {
            const tot = resumo.totais[t], abaixo = tot.capacidade < resumo.minimos[t];
            return (
              <li key={t} className="flex items-center gap-3" data-testid={`total-${t}`}>
                <IconeTipoVaga tipo={t} tamanho={22} className="text-[var(--pv-vaga-reservada)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="m-0 font-medium">{NOME_TIPO_VAGA[t]}</p>
                  <p className="m-0 text-ink-2 num">{tot.livres} livres de {tot.capacidade} · mínimo legal {resumo.minimos[t]}</p>
                </div>
                <Selo tom={abaixo ? 'erro' : 'sucesso'}>{abaixo ? 'Abaixo do mínimo' : 'Mínimo atendido'}</Selo>
              </li>
            );
          })}
        </ul>
        {resumo.alertas.map((a) => <Aviso key={a.tipo} tom="atencao" titulo="Distribuição abaixo do mínimo">{a.mensagem}</Aviso>)}
        <p className="m-0 text-xs text-ink-3">
          Mínimos sobre o total de {resumo.base} vagas (Lei 13.146/2015, art. 47: 2%, mínimo 1; Lei 10.741/2003, art. 41: 5%), arredondados para cima.
          A planta informa as vagas do SS1 e do Subsolo 2; as do térreo são uma proposta simulada até a localização física ser confirmada com a operação.
        </p>
        <details className="border-t border-line-subtle pt-3">
          <summary className="cursor-pointer font-medium text-ink-2 select-none">Ajustar vagas de uma região</summary>
          <div className="grid gap-2 mt-3">
            <label htmlFor="regiao-reservadas" className="font-medium">Região</label>
            <select id="regiao-reservadas" value={regiaoId} onChange={(e) => selecionar(e.target.value)} className="h-10 px-2 rounded-md border border-line-strong bg-surface">
              <option value="">Escolha a região</option>
              {carros.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.nome}</option>)}
            </select>
            {atual && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1"><span className="font-medium">Vagas PcD</span>
                    <input inputMode="numeric" value={pcd} onChange={(e) => setPcd(e.target.value.trim())} className="h-10 px-2 rounded-md border border-line-strong bg-surface num" /></label>
                  <label className="grid gap-1"><span className="font-medium">Vagas pessoa idosa</span>
                    <input inputMode="numeric" value={idoso} onChange={(e) => setIdoso(e.target.value.trim())} className="h-10 px-2 rounded-md border border-line-strong bg-surface num" /></label>
                </div>
                <p className="m-0 text-xs text-ink-2 num">
                  Capacidade {atual.capacidade}: ficariam {Math.max(0, atual.capacidade - (Number(pcd) || 0) - (Number(idoso) || 0))} vagas comuns.
                  Ocupadas agora: {vagasDaRegiao(atual).COMUM.ocupadas} comuns, {vagasDaRegiao(atual).PCD.ocupadas} PcD, {vagasDaRegiao(atual).IDOSO.ocupadas} pessoa idosa.
                </p>
                <Botao variante="secundario" carregando={ocupado} disabled={invalido} onClick={salvar}>Salvar vagas reservadas</Botao>
              </>
            )}
            {retorno && <Aviso tom={retorno.tom === 'sucesso' ? 'sucesso' : 'erro'} titulo={retorno.tom === 'sucesso' ? 'Ajuste salvo' : 'Ajuste recusado'}>{retorno.texto}</Aviso>}
            <p className="m-0 text-xs text-ink-3">O sistema recusa valores que deixariam a ocupação atual inconsistente (ex.: menos vagas PcD do que as ocupadas agora).</p>
          </div>
        </details>
      </div>
    </Cartao>
  );
}

// ── Acesso do operador (um token para operação de tickets e simulador) ──
export function AcessoOperador({ pedindo, aoSalvar, aoTrocar }: { pedindo: boolean; aoSalvar: (token: string) => void; aoTrocar: () => void }) {
  const [token, setToken] = useState('');
  if (!pedindo) {
    return (
      <p className="m-0 flex items-center gap-2 text-sm text-ink-2">
        <KeyRound size={15} aria-hidden /> Operador identificado nesta aba.
        <button className="underline cursor-pointer" onClick={aoTrocar}>Trocar token</button>
      </p>
    );
  }
  return (
    <Cartao titulo="Acesso do operador">
      <form className="grid gap-1.5 text-sm" onSubmit={(e) => { e.preventDefault(); aoSalvar(token); setToken(''); }}>
        <label htmlFor="token-operador" className="font-medium inline-flex items-center gap-1.5"><KeyRound size={14} aria-hidden /> Token do operador</label>
        <div className="flex gap-2">
          <input id="token-operador" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="flex-1 min-w-0 h-10 px-3 rounded-md border border-line-strong bg-surface" placeholder="Token configurado na API" />
          <Botao type="submit" variante="secundario">Salvar</Botao>
        </div>
        <p className="m-0 text-xs text-ink-3">Confirmar estacionamentos, registrar saídas e controlar o simulador exigem o token configurado na API. Ele fica guardado só nesta aba.</p>
      </form>
    </Cartao>
  );
}

// ── Operação de tickets (confirmação e saída) ──
const ROTULO_STATUS: Record<Ticket['status'], [string, TomSelo]> = {
  AGUARDANDO: ['Aguardando confirmação', 'info'], ESTACIONADO: ['Estacionado', 'sucesso'], SAIU: ['Saiu', 'neutro'], CANCELADO: ['Cancelado', 'neutro'],
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
  return (
    <Cartao titulo="Operação de tickets">
      <div className="grid gap-3 text-sm" data-testid="operacao-ticket">
        <p className="m-0 text-ink-2">Confirme o estacionamento e registre a saída pelo código do ticket. Equivale à leitura do ticket na região e na cancela.</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void consultar(); }}>
          <label htmlFor="codigo-ticket" className="sr-only-texto">Código do ticket</label>
          <input id="codigo-ticket" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="PV-0001" autoComplete="off" className="flex-1 min-w-0 h-10 px-3 rounded-md border border-line-strong bg-surface font-mono uppercase" />
          <Botao type="submit" variante="secundario" carregando={ocupado === 'consultar'}>Consultar</Botao>
        </form>
        {t && (
          <div className="grid gap-2 rounded-md border border-line-subtle p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-base font-semibold">{t.codigo}</span>
              <span className="flex gap-1.5">{consulta?.simulado && <Selo tom="atencao">Simulado</Selo>}<Selo tom={ROTULO_STATUS[t.status][1]}>{ROTULO_STATUS[t.status][0]}</Selo></span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 m-0">
              <dt className="text-ink-2">Veículo</dt><dd className="m-0">{NOME_CATEGORIA[t.categoria]}</dd>
              <dt className="text-ink-2">Recomendada</dt><dd className="m-0"><button className="cursor-pointer" onClick={() => aoSelecionar(t.regiaoRecomendadaId)}><Placa codigo={t.regiaoRecomendadaId} tamanho="sm" /></button></dd>
              {t.regiaoEstacionadaId && <><dt className="text-ink-2">Estacionado em</dt><dd className="m-0"><button className="cursor-pointer" onClick={() => aoSelecionar(t.regiaoEstacionadaId!)}><Placa codigo={t.regiaoEstacionadaId} tamanho="sm" /></button></dd></>}
            </dl>
            {t.status === 'AGUARDANDO' && (
              <div className="grid gap-2">
                <label className="grid gap-1">
                  <span className="font-medium">Região onde o veículo estacionou</span>
                  <select value={destino} onChange={(e) => setDestino(e.target.value)} className="h-10 px-2 rounded-md border border-line-strong bg-surface">
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
              <Botao variante="secundario" icone={LogOut} carregando={ocupado === 'saida'} onClick={() => executar('saida', () => api.tickets.saida(t.codigo), 'Saída registrada')}>Registrar saída</Botao>
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
    </Cartao>
  );
}

// ── Simulador ──
/**
 * Ritmos prontos da simulação (tudo marcado como dado simulado). O relógio é acelerado, mas o tempo de manobra é escolhido
 * para o carrinho animado chegar à região mais ou menos quando a confirmação acontece no backend.
 */
/** Nas demonstrações, parte dos carros pede vaga reservada (só para mostrar o fluxo; não é estatística real). */
const TIPOS_DEMONSTRACAO = { COMUM: 0.9, PCD: 0.04, IDOSO: 0.06 };

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
  const tomStatus: TomSelo = status === 'rodando' ? 'sucesso' : status === 'pausado' ? 'atencao' : 'neutro';
  const descricao = cenarios.find((c) => c.id === cenario)?.descricao;
  const nomeCenario = estado?.cenario ? cenarios.find((c) => c.id === estado.cenario)?.nome ?? `Cenário ${estado.cenario}` : null;

  const iniciar = () => executar('iniciar', () => (status === 'pausado' ? api.simulacao.acao('retomar') : api.simulacao.iniciar(RITMOS.livre)));
  const adicionar = () => executar('adicionar', async () => {
    if (status === 'parado') await api.simulacao.iniciar(RITMOS.vazio); // sem chegadas automáticas: só o veículo pedido
    // vaga reservada só faz sentido para carro; o veículo comum continua sorteando a categoria
    await api.simulacao.evento(tipoNovo === 'COMUM' ? { acao: 'entrada' } : { acao: 'entrada', categoria: 'CARRO_PEQUENO', tipoVaga: tipoNovo });
  });

  return (
    <Cartao titulo="Simulação" acao={<span data-testid="status-simulacao"><Selo tom={tomStatus} icone={status === 'rodando' ? Play : status === 'pausado' ? Pause : Square}>{rotuloStatus}</Selo></span>}>
      <div className="grid gap-3 text-sm">
        {!estado ? <Esqueleto className="h-24" /> : (
          <>
            <p className="m-0 text-ink-2" data-testid="resumo-simulacao">
              {status === 'parado'
                ? 'Veículos simulados entram pelo totem virtual, seguem a rota no mapa e só ocupam vaga quando o estacionamento é confirmado.'
                : <>{nomeCenario ? <><strong className="text-ink">{nomeCenario}</strong> · </> : null}{Math.floor(estado.decorridoSimuladoSeg / 60)} min simulados · {estado.veiculos.estacionados} estacionados · {estado.veiculos.aguardando} a caminho</>}
            </p>
            <div className="grid gap-2">
              {status === 'rodando'
                ? <Botao variante="secundario" icone={Pause} carregando={ocupado === 'pausar'} onClick={() => executar('pausar', () => api.simulacao.acao('pausar'))}>Pausar</Botao>
                : <Botao icone={Play} carregando={ocupado === 'iniciar'} onClick={iniciar}>{status === 'pausado' ? 'Retomar' : 'Iniciar'}</Botao>}
              <div className="grid grid-cols-[1fr_auto] gap-2 items-stretch">
                <Botao variante="secundario" icone={Plus} carregando={ocupado === 'adicionar'} onClick={adicionar}>Adicionar veículo</Botao>
                <select aria-label="Tipo de vaga do veículo adicionado" value={tipoNovo} onChange={(e) => setTipoNovo(e.target.value as TipoVaga)} className="h-10 px-2 rounded-md border border-line-strong bg-surface text-sm">
                  <option value="COMUM">Vaga comum</option>
                  <option value="PCD">Vaga PcD</option>
                  <option value="IDOSO">Pessoa idosa</option>
                </select>
              </div>
              <Botao variante="secundario" icone={Zap} carregando={ocupado === 'pico'} onClick={() => executar('pico', () => api.simulacao.cenario(RITMOS.pico.cenario, RITMOS.pico.config))}>Simular horário de pico</Botao>
              <Botao variante="secundario" icone={Sun} carregando={ocupado === 'tranquilo'} onClick={() => executar('tranquilo', () => api.simulacao.cenario(RITMOS.tranquilo.cenario, RITMOS.tranquilo.config))}>Simular estacionamento tranquilo</Botao>
            </div>
            <p className="m-0 text-xs text-ink-3">Os ritmos prontos começam do zero: apagam só os dados simulados anteriores (dados reais ficam).</p>
            <div className="border-t border-line-subtle pt-3">
              {confirmarReinicio ? (
                <div className="grid gap-2">
                  <p className="m-0">Reiniciar apaga todos os dados simulados e para a simulação. Dados reais e ajustes do operador são mantidos.</p>
                  <div className="flex gap-2">
                    <Botao variante="perigo" tamanho="sm" carregando={ocupado === 'reiniciar'} onClick={() => executar('reiniciar', () => api.simulacao.acao('reiniciar'))}>Apagar dados simulados</Botao>
                    <Botao variante="fantasma" tamanho="sm" onClick={() => setConfirmarReinicio(false)}>Cancelar</Botao>
                  </div>
                </div>
              ) : (
                <Botao variante="fantasma" tamanho="sm" icone={RotateCcw} onClick={() => setConfirmarReinicio(true)} disabled={!estado.veiculosSimuladosAtivos && status === 'parado'}>Reiniciar</Botao>
              )}
            </div>
            <details className="border-t border-line-subtle pt-3">
              <summary className="cursor-pointer font-medium text-ink-2 select-none">Mais opções</summary>
              <div className="grid gap-2 mt-3">
                <label htmlFor="cenario" className="font-medium">Cenário</label>
                <select id="cenario" value={cenario} onChange={(e) => setCenario(e.target.value)} className="h-10 px-2 rounded-md border border-line-strong bg-surface">
                  {cenarios.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.nome}</option>)}
                </select>
                {descricao && <p className="m-0 text-ink-2">{descricao}</p>}
                <Botao variante="secundario" icone={Play} carregando={ocupado === 'cenario'} onClick={() => executar('cenario', () => api.simulacao.cenario(cenario as CenarioResumo['id']))}>Iniciar cenário {cenario}</Botao>
                {status !== 'parado' && (
                  <>
                    <label className="flex items-center justify-between gap-2">
                      <span className="font-medium">Velocidade do relógio</span>
                      <select aria-label="Velocidade da simulação" value={estado.velocidade} onChange={(e) => executar('velocidade', () => api.simulacao.velocidade(Number(e.target.value)))} className="h-9 px-2 rounded-md border border-line-strong bg-surface">
                        {[...new Set([1, 3, 10, 30, 60, 120, estado.velocidade])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v}× {v === 1 ? '(tempo real)' : ''}</option>)}
                      </select>
                    </label>
                    <Botao variante="fantasma" tamanho="sm" icone={Square} carregando={ocupado === 'encerrar'} onClick={() => executar('encerrar', () => api.simulacao.acao('encerrar'))}>Encerrar (mantém os dados simulados)</Botao>
                  </>
                )}
              </div>
            </details>
          </>
        )}
        {erro && <Aviso tom="erro" titulo="Ação não executada">{erro}</Aviso>}
      </div>
    </Cartao>
  );
}

// ── Movimentações ──
const ICONE_ITEM: Record<TipoItem, LucideIcon> = {
  entrada: LogIn, recomendacao: Route, estacionou: CircleParking, saida: LogOut, lotada: CarFront, disponibilidade: Ban, congestionamento: Waves, sensor: WifiOff, simulador: Activity, alerta: TriangleAlert,
};
const COR_ITEM: Partial<Record<TipoItem, string>> = {
  lotada: 'var(--pv-feedback-danger-solid)', alerta: 'var(--pv-feedback-warning-solid)', congestionamento: 'var(--pv-feedback-warning-solid)', sensor: 'var(--pv-status-erro-solid)', estacionou: 'var(--pv-feedback-success-solid)', recomendacao: 'var(--pv-wayfinding-route)',
};
export function ListaMovimentacoes({ itens, conexao, aoSelecionar }: { itens: ItemMovimentacao[]; conexao: EstadoConexao; aoSelecionar: (id: string) => void }) {
  return (
    <Cartao titulo="Movimentações recentes">
      {itens.length === 0 ? (
        <EstadoVazio icone={conexao === 'desconectado' ? WifiOff : Activity} titulo={conexao === 'desconectado' ? 'Sem conexão em tempo real' : 'Aguardando movimentações'}>
          {conexao === 'desconectado' ? 'As movimentações voltam a aparecer quando a conexão for restabelecida.' : 'Entradas, confirmações, saídas e alertas aparecem aqui conforme acontecem.'}
        </EstadoVazio>
      ) : (
        <ol data-testid="movimentacoes" aria-live="polite" aria-relevant="additions" className="list-none m-0 p-0 grid max-h-[360px] overflow-y-auto -mx-1">
          {itens.map((m) => {
            const Icone = ICONE_ITEM[m.tipo];
            return (
              <li key={m.id} className="flex gap-2.5 px-1 py-2 border-b border-line-subtle last:border-0 text-sm">
                <Icone size={16} aria-hidden className="shrink-0 mt-0.5" style={{ color: COR_ITEM[m.tipo] ?? 'var(--pv-text-secondary)' }} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 leading-snug">{m.texto}</p>
                  <p className="m-0 text-xs text-ink-3 num">{hora(m.quando)}{m.simulado ? ' · simulado' : ''}</p>
                </div>
                {m.regiaoId && <button onClick={() => aoSelecionar(m.regiaoId!)} className="self-start cursor-pointer" aria-label={`Ver região ${m.regiaoId}`}><Placa codigo={m.regiaoId} tamanho="sm" /></button>}
              </li>
            );
          })}
        </ol>
      )}
    </Cartao>
  );
}

// ── Tabela de regiões (alternativa acessível ao mapa) ──
function CelulaReservada({ tipo, regiao }: { tipo: TipoVaga; regiao: Regiao }) {
  const v = vagasDaRegiao(regiao)[tipo];
  if (!v.capacidade) return <td className="px-4 py-2 text-ink-3" data-tipo={tipo}>—</td>;
  return (
    <td className="px-4 py-2 num" data-tipo={tipo}>
      <span className="inline-flex items-center gap-1.5"><IconeTipoVaga tipo={tipo} tamanho={14} className="text-[var(--pv-vaga-reservada)]" />{v.livres} <span className="text-ink-3">/ {v.capacidade}</span>{v.livres === 0 && <span className="sr-only-texto"> (esgotadas)</span>}</span>
    </td>
  );
}

export function TabelaRegioes({ regioes, selecionada, aoSelecionar }: { regioes: Regiao[] | null; selecionada: string | null; aoSelecionar: (id: string) => void }) {
  return (
    <Cartao titulo="Regiões">
      {!regioes ? <Esqueleto className="h-40" /> : (
        <div className="overflow-x-auto -mx-4">
          <table className="w-full text-sm border-collapse min-w-[820px]">
            <thead>
              <tr className="text-left text-ink-2" style={{ background: 'var(--pv-table-header-bg)' }}>
                {['Região', 'Nível', 'Ocupação', 'Livres', 'PcD livres', 'Pessoa idosa livres', 'Estado', 'Fluxo'].map((h) => <th key={h} scope="col" className="font-medium px-4 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {regioes.map((r) => {
                const f = faixaDaRegiao(r);
                return (
                  <tr key={r.id} data-regiao={r.id} onClick={() => aoSelecionar(r.id)} className="border-t border-line-subtle cursor-pointer hover:bg-subtle" style={{ background: selecionada === r.id ? 'var(--pv-brand-subtle)' : undefined }}>
                    <td className="px-4 py-2"><button className="flex items-center gap-2 cursor-pointer text-left" onClick={(e) => { e.stopPropagation(); aoSelecionar(r.id); }} aria-pressed={selecionada === r.id}><Placa codigo={r.id} tamanho="sm" /><span>{r.nome}</span></button></td>
                    <td className="px-4 py-2 text-ink-2">{nomeDoNivel(r.nivel).replace(/\s*\(.*\)/, '')}</td>
                    <td className="px-4 py-2 w-48"><div className="flex items-center gap-2"><div className="flex-1"><Medidor valor={r.ocupadas} total={r.capacidade} cor={COR_FAIXA_CSS[f]} rotulo={`Ocupação de ${r.id}`} /></div><span className="num w-10 text-right">{percentual(r)}%</span></div></td>
                    <td className="px-4 py-2 num">{r.livres} <span className="text-ink-3">/ {r.capacidade}</span></td>
                    {(['PCD', 'IDOSO'] as const).map((t) => <CelulaReservada key={t} tipo={t} regiao={r} />)}
                    <td className="px-4 py-2"><SeloFaixa regiao={r} /></td>
                    <td className="px-4 py-2 text-ink-2">{r.fluxo ? ROTULO_FLUXO[r.fluxo.nivel] : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Cartao>
  );
}
