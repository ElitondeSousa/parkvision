/** Blocos do dashboard administrativo (usam só componentes base do Design System). */
import type { Indicadores, Recomendacao, Regiao, Ticket } from '@parkvision/shared';
import {
  Activity, Ban, CarFront, CircleCheck, CircleParking, KeyRound, LogIn, LogOut, Pause, Play, RotateCcw, Route, Square, TriangleAlert, Waves, WifiOff, X, type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Aviso, Botao, Cartao, EstadoVazio, Esqueleto, Medidor, Placa, Selo, type TomSelo } from '../../componentes/base.tsx';
import { nomeDoNivel, regiaoDoMapa } from '../../mapa/dados.ts';
import { NOME_CATEGORIA, ROTULO_FAIXA, ROTULO_FLUXO, ROTULO_FONTE, faixaDaRegiao, hora, percentual, type FaixaRegiao } from '../../mapa/estado.ts';
import { api, mensagemDeErro, tokenOperador, type CenarioResumo, type EstadoSimulacao } from '../../servicos/api.ts';
import type { EstadoConexao } from '../../servicos/tempo-real.ts';
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
          {linha('Veículos permitidos', regiao.categorias.map((c) => NOME_CATEGORIA[c]).join(', '))}
          {linha('Estado operacional', regiao.operacional ? 'Operando' : 'Indisponível')}
          {linha('Sensores', regiao.statusSensores === 'ok' || !regiao.statusSensores ? 'Normais' : regiao.statusSensores === 'sem-comunicacao' ? 'Sem comunicação' : 'Leitura inconsistente')}
          {regiao.fluxo && linha('Fluxo (últimos 5 min)', `${regiao.fluxo.recente} de referência ${regiao.fluxo.vazaoReferencia}`)}
        </dl>
        {doMapa && <p className="m-0 text-sm text-ink-2">{doMapa.referencia}.</p>}
        <p className="m-0 text-xs text-ink-3">{ROTULO_FONTE[regiao.fonteCapacidade] ?? regiao.fonteCapacidade}.</p>
      </div>
    </Cartao>
  );
}

// ── Simulador ──
export function ControleSimulador({ estado, cenarios, aoAtualizar }: { estado: EstadoSimulacao | null; cenarios: CenarioResumo[]; aoAtualizar: () => Promise<unknown> }) {
  const [cenario, setCenario] = useState<string>('A');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [token, setToken] = useState(tokenOperador.ler());
  const [pedirToken, setPedirToken] = useState(!tokenOperador.ler());
  const [confirmarReinicio, setConfirmarReinicio] = useState(false);

  const executar = async (rotulo: string, acao: () => Promise<unknown>) => {
    setOcupado(rotulo); setErro(null);
    try { await acao(); await aoAtualizar(); }
    catch (e) {
      setErro(mensagemDeErro(e));
      if ((e as { codigo?: string }).codigo === 'NAO_AUTORIZADO') setPedirToken(true);
    } finally { setOcupado(null); setConfirmarReinicio(false); }
  };

  const status = estado?.status ?? 'parado';
  const rotuloStatus = { parado: 'Parada', rodando: 'Rodando', pausado: 'Pausada' }[status];
  const tomStatus: TomSelo = status === 'rodando' ? 'sucesso' : status === 'pausado' ? 'atencao' : 'neutro';
  const descricao = cenarios.find((c) => c.id === cenario)?.descricao;

  return (
    <Cartao titulo="Simulação" acao={<span data-testid="status-simulacao"><Selo tom={tomStatus} icone={status === 'rodando' ? Play : status === 'pausado' ? Pause : Square}>{rotuloStatus}</Selo></span>}>
      <div className="grid gap-3 text-sm">
        {!estado ? <Esqueleto className="h-24" /> : (
          <>
            {status !== 'parado' && (
              <p className="m-0 text-ink-2">
                {estado.cenario ? <>Cenário <strong className="text-ink">{estado.cenario}</strong> · </> : null}
                {Math.floor(estado.decorridoSimuladoSeg / 60)} min simulados · {estado.veiculos.estacionados} estacionados · {estado.veiculos.aguardando} a caminho
              </p>
            )}
            {pedirToken && (
              <form className="grid gap-1.5" onSubmit={(e) => { e.preventDefault(); tokenOperador.gravar(token); setPedirToken(false); setErro(null); }}>
                <label htmlFor="token-operador" className="font-medium inline-flex items-center gap-1.5"><KeyRound size={14} aria-hidden /> Token do operador</label>
                <div className="flex gap-2">
                  <input id="token-operador" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="flex-1 min-w-0 h-10 px-3 rounded-md border border-line-strong bg-surface" placeholder="SIMULADOR_TOKEN da API" />
                  <Botao type="submit" variante="secundario">Salvar</Botao>
                </div>
                <p className="m-0 text-xs text-ink-3">Os controles exigem o token configurado na API. Ele fica guardado só nesta aba.</p>
              </form>
            )}
            {status === 'parado' ? (
              <>
                <label htmlFor="cenario" className="font-medium">Cenário</label>
                <select id="cenario" value={cenario} onChange={(e) => setCenario(e.target.value)} className="h-10 px-2 rounded-md border border-line-strong bg-surface">
                  {cenarios.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.nome}</option>)}
                </select>
                {descricao && <p className="m-0 text-ink-2">{descricao}</p>}
                <Botao icone={Play} carregando={ocupado === 'iniciar'} onClick={() => executar('iniciar', () => api.simulacao.cenario(cenario as CenarioResumo['id']))}>Iniciar cenário {cenario}</Botao>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {status === 'rodando'
                  ? <Botao variante="secundario" icone={Pause} carregando={ocupado === 'pausar'} onClick={() => executar('pausar', () => api.simulacao.acao('pausar'))}>Pausar</Botao>
                  : <Botao icone={Play} carregando={ocupado === 'retomar'} onClick={() => executar('retomar', () => api.simulacao.acao('retomar'))}>Retomar</Botao>}
                <Botao variante="secundario" icone={Square} carregando={ocupado === 'encerrar'} onClick={() => executar('encerrar', () => api.simulacao.acao('encerrar'))}>Encerrar</Botao>
                <label className="col-span-2 flex items-center justify-between gap-2">
                  <span className="font-medium">Velocidade</span>
                  <select aria-label="Velocidade da simulação" value={estado.velocidade} onChange={(e) => executar('velocidade', () => api.simulacao.velocidade(Number(e.target.value)))} className="h-9 px-2 rounded-md border border-line-strong bg-surface">
                    {[...new Set([1, 10, 30, 60, 120, estado.velocidade])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v}× {v === 1 ? '(tempo real)' : ''}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="border-t border-line-subtle pt-3">
              {confirmarReinicio ? (
                <div className="grid gap-2">
                  <p className="m-0">Apagar todos os dados simulados? Dados reais e ajustes do operador são mantidos.</p>
                  <div className="flex gap-2">
                    <Botao variante="perigo" tamanho="sm" carregando={ocupado === 'reiniciar'} onClick={() => executar('reiniciar', () => api.simulacao.acao('reiniciar'))}>Apagar dados simulados</Botao>
                    <Botao variante="fantasma" tamanho="sm" onClick={() => setConfirmarReinicio(false)}>Cancelar</Botao>
                  </div>
                </div>
              ) : (
                <Botao variante="fantasma" tamanho="sm" icone={RotateCcw} onClick={() => setConfirmarReinicio(true)} disabled={!estado.veiculosSimuladosAtivos && status === 'parado'}>Reiniciar dados simulados</Botao>
              )}
            </div>
          </>
        )}
        {erro && <Aviso tom="erro" titulo="Ação não executada">{erro}</Aviso>}
        {!pedirToken && <button className="justify-self-start text-xs text-ink-3 underline cursor-pointer" onClick={() => setPedirToken(true)}>Trocar token do operador</button>}
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
export function TabelaRegioes({ regioes, selecionada, aoSelecionar }: { regioes: Regiao[] | null; selecionada: string | null; aoSelecionar: (id: string) => void }) {
  return (
    <Cartao titulo="Regiões">
      {!regioes ? <Esqueleto className="h-40" /> : (
        <div className="overflow-x-auto -mx-4">
          <table className="w-full text-sm border-collapse min-w-[640px]">
            <thead>
              <tr className="text-left text-ink-2" style={{ background: 'var(--pv-table-header-bg)' }}>
                {['Região', 'Nível', 'Ocupação', 'Livres', 'Estado', 'Fluxo'].map((h) => <th key={h} scope="col" className="font-medium px-4 py-2">{h}</th>)}
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
