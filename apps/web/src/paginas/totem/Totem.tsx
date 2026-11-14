/**
 * Interface 1 — Totem de entrada (tela de toque).
 * Fluxo: início → categoria → tipo de vaga (carros) → processamento → recomendação → ticket.
 * Tipo de vaga: declaração do motorista (sem pergunta médica); o totem lembra da credencial e não diz que a verificou.
 * Sem vaga do tipo pedido: mostra a indisponibilidade e deixa o motorista decidir — nada de mandar para outro tipo.
 * A entrada é registrada na API (POST /entradas), que devolve a recomendação do algoritmo e o ticket com o QR Code.
 * Nada aqui reserva vaga: a ocupação só muda quando o estacionamento é confirmado.
 */
import type { Categoria, Regiao, TipoVaga } from '@parkvision/shared';
import { CATEGORIAS, NOME_TIPO_VAGA, TIPOS_VAGA, vagasDaRegiao } from '@parkvision/shared';
import { ArrowLeft, CircleCheck, LoaderCircle, QrCode, RefreshCw, TriangleAlert } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Botao, Marca, Medidor, Placa } from '../../componentes/base.tsx';
import { ControlesTema } from '../../tema/ControlesTema.tsx';
import { IconeCategoria } from '../../componentes/IconeCategoria.tsx';
import { IconeTipoVaga, SeloTipoVaga } from '../../componentes/IconeTipoVaga.tsx';
import { acessoPorId, nomeCurto, nomeDoNivel, orientacaoDaRota, regiaoDoMapa } from '../../mapa/dados.ts';
import { NOME_CATEGORIA, dataHora, faixaDaRegiao } from '../../mapa/estado.ts';
import { MapaEstacionamento } from '../../mapa/MapaEstacionamento.tsx';
import { ErroServico, api, type RespostaEntrada } from '../../servicos/api.ts';

type Etapa =
  | { tipo: 'inicio' }
  | { tipo: 'categoria' }
  | { tipo: 'tipo-vaga'; categoria: Categoria }
  | { tipo: 'processando'; categoria: Categoria; tipoVaga: TipoVaga }
  | { tipo: 'recomendacao'; dados: RespostaEntrada; regioes: Regiao[]; tipoVaga: TipoVaga }
  | { tipo: 'ticket'; dados: RespostaEntrada; tipoVaga: TipoVaga }
  | { tipo: 'sem-vagas'; categoria: Categoria; tipoVaga: TipoVaga; mensagem: string }
  | { tipo: 'erro'; categoria: Categoria | null; tipoVaga: TipoVaga; mensagem: string };

const PASSOS_PROCESSAMENTO = ['Consultando a ocupação das regiões', 'Comparando distância e fluxo de veículos', 'Escolhendo a região para você'];
const INATIVIDADE_MS = 120_000;
const RETORNO_TICKET_S = 60;

export function Totem() {
  const [params] = useSearchParams();
  const acessoId = params.get('acesso') ?? 'A_NE';
  const acesso = acessoPorId[acessoId];
  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'inicio' });
  const [demonstracao, setDemonstracao] = useState(false);
  const reiniciar = useCallback(() => setEtapa({ tipo: 'inicio' }), []);
  useEffect(() => { api.saude().then((s) => setDemonstracao(s.modoDemonstracao)).catch(() => {}); }, []);

  // volta ao início depois de um tempo sem toque (outro motorista vai usar o totem)
  useEffect(() => {
    if (etapa.tipo === 'inicio') return;
    let t = setTimeout(reiniciar, INATIVIDADE_MS);
    const tocar = () => { clearTimeout(t); t = setTimeout(reiniciar, INATIVIDADE_MS); };
    window.addEventListener('pointerdown', tocar);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', tocar); };
  }, [etapa.tipo, reiniciar]);

  // motos não têm vaga reservada no estacionamento: seguem direto com vaga comum
  const escolherCategoria = (categoria: Categoria) => (categoria === 'MOTO' ? escolher(categoria, 'COMUM') : setEtapa({ tipo: 'tipo-vaga', categoria }));
  const escolher = async (categoria: Categoria, tipoVaga: TipoVaga) => {
    setEtapa({ tipo: 'processando', categoria, tipoVaga });
    const inicio = Date.now();
    try {
      const dados = await api.registrarEntrada(acessoId, categoria, tipoVaga);
      const regioes = await api.regioes().catch(() => [] as Regiao[]);
      await new Promise((ok) => setTimeout(ok, Math.max(0, 1400 - (Date.now() - inicio)))); // tempo mínimo para a animação ser lida
      setEtapa({ tipo: 'recomendacao', dados, regioes, tipoVaga });
    } catch (e) {
      if (e instanceof ErroServico && e.codigo === 'SEM_REGIAO_ELEGIVEL') setEtapa({ tipo: 'sem-vagas', categoria, tipoVaga, mensagem: e.message });
      else if (e instanceof ErroServico && e.codigo === 'SEM_CONEXAO') setEtapa({ tipo: 'erro', categoria, tipoVaga, mensagem: 'O totem perdeu a conexão com o sistema.' });
      else setEtapa({ tipo: 'erro', categoria, tipoVaga, mensagem: e instanceof Error ? e.message : 'Erro inesperado.' });
    }
  };

  return (
    <div className="min-h-full flex flex-col" style={{ background: 'var(--pv-bg-canvas)', color: 'var(--pv-text-primary)' }}>
      <header className="flex items-center justify-between gap-4 px-6 sm:px-10 h-20 border-b" style={{ borderColor: 'var(--pv-border-default)' }}>
        <Marca tamanho={44} />
        <div className="flex items-center gap-4">
        <div className="text-right text-sm" style={{ color: 'var(--pv-text-secondary)' }}>
          <p className="m-0 font-semibold" style={{ color: 'var(--pv-text-primary)' }}>Capim Dourado Shopping</p>
          <p className="m-0">{acesso ? nomeCurto(acesso.nome) : 'Acesso não configurado'}</p>
          {demonstracao && <p className="m-0 mt-1 font-semibold" style={{ color: 'var(--pv-brand-on-subtle)' }} data-testid="totem-demonstracao">Ambiente de demonstração</p>}
        </div>
        <ControlesTema />
        </div>
      </header>

      <main className="flex-1 flex flex-col px-6 sm:px-10 py-8" aria-live="polite">
        {!acesso || acesso.nivel !== 'terreo' ? (
          <TelaErro titulo="Totem sem acesso configurado" mensagem={`O acesso "${acessoId}" não existe no mapa. Use /totem?acesso=A_NE, A_ROT, A_S1 ou A_S2.`} />
        ) : etapa.tipo === 'inicio' ? (
          <TelaInicio aoComecar={() => setEtapa({ tipo: 'categoria' })} />
        ) : etapa.tipo === 'categoria' ? (
          <TelaCategoria aoEscolher={escolherCategoria} aoVoltar={reiniciar} />
        ) : etapa.tipo === 'tipo-vaga' ? (
          <TelaTipoVaga aoEscolher={(t) => escolher(etapa.categoria, t)} aoVoltar={() => setEtapa({ tipo: 'categoria' })} />
        ) : etapa.tipo === 'processando' ? (
          <TelaProcessando categoria={etapa.categoria} />
        ) : etapa.tipo === 'recomendacao' ? (
          <TelaRecomendacao dados={etapa.dados} regioes={etapa.regioes} tipoVaga={etapa.tipoVaga} aoEmitir={() => setEtapa({ tipo: 'ticket', dados: etapa.dados, tipoVaga: etapa.tipoVaga })} />
        ) : etapa.tipo === 'ticket' ? (
          <TelaTicket dados={etapa.dados} tipoVaga={etapa.tipoVaga} aoConcluir={reiniciar} demonstracao={demonstracao} />
        ) : etapa.tipo === 'sem-vagas' ? (
          etapa.tipoVaga === 'COMUM' ? (
            <TelaErro
              titulo={`Sem vagas para ${NOME_CATEGORIA[etapa.categoria].toLowerCase()} agora`}
              mensagem={etapa.mensagem}
              acoes={<><Botao tamanho="xl" onClick={() => setEtapa({ tipo: 'categoria' })} icone={ArrowLeft}>Escolher outra categoria</Botao></>}
              rodape="Se precisar, procure o atendimento do estacionamento."
            />
          ) : (
            // indisponibilidade de vaga reservada: informa e deixa o motorista decidir (o totem não troca o tipo sozinho)
            <TelaErro
              titulo={`Sem ${etapa.tipoVaga === 'PCD' ? 'vaga PcD' : 'vaga para pessoa idosa'} disponível agora`}
              mensagem={etapa.mensagem}
              acoes={<Botao tamanho="xl" onClick={() => setEtapa({ tipo: 'tipo-vaga', categoria: etapa.categoria })} icone={ArrowLeft}>Voltar às opções de vaga</Botao>}
              rodape="A equipe do estacionamento pode ajudar. Nenhuma vaga foi indicada para você."
              voltar={reiniciar}
            />
          )
        ) : (
          <TelaErro
            titulo="Não foi possível gerar sua recomendação"
            mensagem={`${etapa.mensagem} Procure o atendimento do estacionamento para retirar seu ticket.`}
            acoes={etapa.categoria && <Botao tamanho="xl" icone={RefreshCw} onClick={() => escolher(etapa.categoria!, etapa.tipoVaga)}>Tentar de novo</Botao>}
            voltar={reiniciar}
          />
        )}
      </main>
    </div>
  );
}

function TelaInicio({ aoComecar }: { aoComecar: () => void }) {
  return (
    <div className="flex-1 grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center max-w-6xl mx-auto w-full">
      <div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight" style={{ color: 'var(--pv-text-primary)' }}>Boas-vindas ao estacionamento</h1>
        <p className="mt-5 text-xl max-w-[34ch]" style={{ color: 'var(--pv-text-secondary)' }}>
          Informe o tipo do seu veículo e o Golden Park indica a região com melhor acesso agora — com o caminho até lá.
        </p>
        <Botao tamanho="xl" className="mt-10 w-full sm:w-auto min-w-80" onClick={aoComecar}>Começar</Botao>
      </div>
      <ol className="list-none m-0 p-0 grid gap-4" aria-label="Como funciona">
        {['Toque em Começar e escolha o tipo do veículo.', 'Veja a região indicada e o caminho até ela.', 'Leve o ticket: o QR Code mostra onde você estacionou.'].map((t, i) => (
          <li key={t} className="flex items-center gap-4 rounded-xl p-5" style={{ background: 'var(--pv-bg-surface)', border: '1px solid var(--pv-border-default)' }}>
            <span className="grid place-items-center size-11 shrink-0 rounded-full font-display text-xl font-bold num" style={{ background: 'var(--pv-wayfinding-route)', color: 'var(--pv-wayfinding-on)' }}>{i + 1}</span>
            <span className="text-lg" style={{ color: 'var(--pv-text-primary)' }}>{t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TelaCategoria({ aoEscolher, aoVoltar }: { aoEscolher: (c: Categoria) => void; aoVoltar: () => void }) {
  return (
    <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full">
      <h1 className="text-4xl sm:text-5xl font-bold" style={{ color: 'var(--pv-text-primary)' }}>Qual é o seu veículo?</h1>
      <p className="mt-3 text-lg" style={{ color: 'var(--pv-text-secondary)' }}>Toque na opção correspondente.</p>
      <div className="grid sm:grid-cols-3 gap-5 mt-8 flex-1 sm:max-h-[420px]">
        {CATEGORIAS.map((c) => (
          <button
            key={c}
            onClick={() => aoEscolher(c)}
            className="group flex flex-col items-center justify-center gap-5 rounded-2xl p-8 min-h-44 cursor-pointer transition-colors border-2"
            style={{ background: 'var(--pv-bg-surface)', borderColor: 'var(--pv-border-default)', color: 'var(--pv-text-primary)' }}
          >
            <IconeCategoria categoria={c} tamanho={c === 'MOTO' ? 120 : 140} className="text-[var(--pv-brand-primary)] group-hover:text-[var(--pv-brand-primary-hover)] group-hover:scale-105 transition-colors" />
            <span className="font-display text-3xl font-semibold text-center leading-tight">{NOME_CATEGORIA[c]}</span>
          </button>
        ))}
      </div>
      <div className="mt-8"><Botao variante="secundario" tamanho="lg" icone={ArrowLeft} onClick={aoVoltar}>Voltar</Botao></div>
    </div>
  );
}

const DESCRICAO_TIPO: Record<TipoVaga, string> = {
  COMUM: 'Qualquer vaga comum do estacionamento.',
  PCD: 'Para veículo com credencial de pessoa com deficiência.',
  IDOSO: 'Para veículo com credencial de pessoa idosa.',
};

function TelaTipoVaga({ aoEscolher, aoVoltar }: { aoEscolher: (t: TipoVaga) => void; aoVoltar: () => void }) {
  return (
    <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full">
      <h1 className="text-4xl sm:text-5xl font-bold" style={{ color: 'var(--pv-text-primary)' }}>Que tipo de vaga você precisa?</h1>
      <p className="mt-3 text-lg max-w-[60ch]" style={{ color: 'var(--pv-text-secondary)' }}>
        As vagas PcD e para pessoa idosa são reservadas e exigem <strong style={{ color: 'var(--pv-text-primary)' }}>credencial válida</strong> à vista no veículo.
        O Golden Park não verifica a credencial: a sua escolha serve só para indicar a vaga.
      </p>
      <div className="grid sm:grid-cols-3 gap-5 mt-8 flex-1 sm:max-h-[380px]" role="group" aria-label="Tipo de vaga">
        {TIPOS_VAGA.map((t) => (
          <button
            key={t}
            onClick={() => aoEscolher(t)}
            className="group flex flex-col items-center justify-center gap-4 rounded-2xl p-8 min-h-44 cursor-pointer transition-colors border-2 text-center"
            style={{ background: 'var(--pv-bg-surface)', borderColor: 'var(--pv-border-default)', color: 'var(--pv-text-primary)' }}
          >
            <IconeTipoVaga tipo={t} tamanho={96} className="text-[var(--pv-brand-primary)] group-hover:scale-105 transition-transform" />
            <span className="font-display text-3xl font-semibold leading-tight">{NOME_TIPO_VAGA[t]}</span>
            <span className="text-base" style={{ color: 'var(--pv-text-secondary)' }}>{DESCRICAO_TIPO[t]}</span>
          </button>
        ))}
      </div>
      <div className="mt-8"><Botao variante="secundario" tamanho="lg" icone={ArrowLeft} onClick={aoVoltar}>Voltar</Botao></div>
    </div>
  );
}

function TelaProcessando({ categoria }: { categoria: Categoria }) {
  const [passo, setPasso] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPasso((p) => Math.min(p + 1, PASSOS_PROCESSAMENTO.length - 1)), 450);
    return () => clearInterval(t);
  }, []);
  return (
    <div role="status" className="flex-1 flex flex-col items-center justify-center gap-8 text-center">
      <IconeCategoria categoria={categoria} tamanho={120} className="text-[var(--pv-brand-primary)]" />
      <h1 className="text-4xl font-bold" style={{ color: 'var(--pv-text-primary)' }}>Procurando a melhor região</h1>
      <ol className="list-none p-0 m-0 grid gap-3 text-left text-lg" aria-label="Etapas da recomendação">
        {PASSOS_PROCESSAMENTO.map((t, i) => (
          <li key={t} className="flex items-center gap-3" style={{ color: i <= passo ? 'var(--pv-text-primary)' : 'var(--pv-text-muted)' }}>
            {i < passo ? <CircleCheck size={24} style={{ color: 'var(--pv-feedback-success-solid)' }} aria-hidden /> : i === passo ? <LoaderCircle size={24} className="gira" aria-hidden /> : <span className="inline-block size-6" aria-hidden />}
            {t}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Disponibilidade({ regiao, tipoVaga }: { regiao: Regiao | null; tipoVaga: TipoVaga }) {
  if (!regiao) return <p className="m-0" style={{ color: 'var(--pv-text-secondary)' }}>Disponibilidade indisponível no momento.</p>;
  const faixa = faixaDaRegiao(regiao);
  // vaga reservada: mostra só as vagas do tipo pedido (as comuns não servem para quem pediu PcD/idoso e vice-versa)
  const v = tipoVaga === 'COMUM' ? { livres: regiao.livres, capacidade: regiao.capacidade, ocupadas: regiao.ocupadas } : vagasDaRegiao(regiao)[tipoVaga];
  const rotulo = tipoVaga === 'COMUM' ? 'vagas livres' : `${tipoVaga === 'PCD' ? 'vagas PcD' : 'vagas para pessoa idosa'} livres`;
  return (
    <div data-testid="disponibilidade">
      <p className="m-0 text-2xl font-display font-semibold num" style={{ color: 'var(--pv-text-primary)' }}>{v.livres} {rotulo} <span className="text-lg font-sans font-normal" style={{ color: 'var(--pv-text-secondary)' }}>de {v.capacidade}</span></p>
      <div className="mt-2 max-w-sm"><Medidor valor={v.ocupadas} total={v.capacidade} cor={faixa === 'livre' ? 'var(--pv-faixa-livre)' : faixa === 'alta' ? 'var(--pv-faixa-alta)' : 'var(--pv-faixa-critica)'} rotulo={`Ocupação ${tipoVaga === 'COMUM' ? '' : 'das vagas reservadas '}da região ${regiao.id}`} /></div>
    </div>
  );
}

function TelaRecomendacao({ dados, regioes, tipoVaga, aoEmitir }: { dados: RespostaEntrada; regioes: Regiao[]; tipoVaga: TipoVaga; aoEmitir: () => void }) {
  const { recomendacao } = dados;
  const regiao = regioes.find((r) => r.id === recomendacao.regiaoId) ?? null;
  const doMapa = regiaoDoMapa[recomendacao.regiaoId];
  const passos = orientacaoDaRota(recomendacao.rota.nos, recomendacao.regiaoId);
  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-8 max-w-7xl mx-auto w-full">
      <section aria-labelledby="titulo-rec" className="flex flex-col gap-6">
        <div className="flex items-center gap-6">
          <Placa codigo={recomendacao.regiaoId} tamanho="xl" />
          <div>
            <p className="m-0 text-lg" style={{ color: 'var(--pv-text-secondary)' }}>Região indicada para você</p>
            <h1 id="titulo-rec" className="text-4xl font-bold mt-1" style={{ color: 'var(--pv-text-primary)' }}>{doMapa?.nome ?? recomendacao.regiaoId}</h1>
            {doMapa && <p className="m-0 mt-1 text-lg" style={{ color: 'var(--pv-text-secondary)' }}>{nomeDoNivel(doMapa.nivel)}</p>}
            {tipoVaga !== 'COMUM' && <div className="mt-2"><SeloTipoVaga tipo={tipoVaga} /></div>}
          </div>
        </div>
        <Disponibilidade regiao={regiao} tipoVaga={tipoVaga} />
        {tipoVaga !== 'COMUM' && <p className="m-0 text-base" style={{ color: 'var(--pv-text-secondary)' }} data-testid="aviso-credencial">Use a vaga reservada só com a credencial válida à vista no veículo.</p>}
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--pv-text-primary)' }}>Por que esta região</h2>
          <p className="mt-2 text-lg leading-snug" style={{ color: 'var(--pv-text-primary)' }} data-testid="justificativa">{recomendacao.justificativa}</p>
        </div>
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--pv-text-primary)' }}>Como chegar</h2>
          <ol className="mt-2 p-0 list-none grid gap-2" data-testid="orientacao">
            {passos.map((p, i) => (
              <li key={p} className="flex gap-3 text-lg" style={{ color: 'var(--pv-text-primary)' }}>
                <span className="grid place-items-center size-8 shrink-0 rounded-full font-display font-bold num" style={{ background: 'var(--pv-wayfinding-route)', color: 'var(--pv-wayfinding-on)' }}>{i + 1}</span>
                <span className="pt-0.5">{p}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="m-0 text-base" style={{ color: 'var(--pv-text-muted)' }}>A indicação não reserva vaga: ela considera a ocupação deste momento.</p>
        <Botao tamanho="xl" icone={QrCode} onClick={aoEmitir} className="w-full sm:w-auto self-start min-w-80">Emitir ticket</Botao>
      </section>
      <MapaEstacionamento regioes={regioes.length ? regioes : undefined} destino={recomendacao.regiaoId} rota={recomendacao.rota.nos} rotuloDestino="Sua região" mostrarLegenda={false} className="min-w-0" />
    </div>
  );
}

function TelaTicket({ dados, tipoVaga, aoConcluir, demonstracao }: { dados: RespostaEntrada; tipoVaga: TipoVaga; aoConcluir: () => void; demonstracao: boolean }) {
  const { ticket, recomendacao, qrUrl } = dados;
  const [svg, setSvg] = useState<string | null>('');
  const [restante, setRestante] = useState(RETORNO_TICKET_S);
  const concluirRef = useRef(aoConcluir);
  concluirRef.current = aoConcluir;
  useEffect(() => {
    QRCode.toString(qrUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0C111C', light: '#FFFFFF' } }).then(setSvg).catch(() => setSvg(null));
  }, [qrUrl]);
  useEffect(() => {
    const t = setInterval(() => setRestante((s) => { if (s <= 1) { concluirRef.current(); return 0; } return s - 1; }), 1000);
    return () => clearInterval(t);
  }, []);
  const doMapa = regiaoDoMapa[recomendacao.regiaoId];
  const passos = orientacaoDaRota(recomendacao.rota.nos, recomendacao.regiaoId);
  return (
    <div className="flex-1 flex flex-col lg:flex-row items-center lg:items-start justify-center gap-10 max-w-6xl mx-auto w-full">
      {/* o ticket: papel térmico em fundo claro, mesmo no totem escuro */}
      <article data-theme="light" aria-label={`Ticket ${ticket.codigo}`} className="w-full max-w-[380px] rounded-lg p-6 shadow-[var(--pv-shadow-lg)]" style={{ background: '#fff', color: 'var(--pv-color-asfalto-900)' }}>
        <div className="flex items-center justify-between">
          <Marca tamanho={30} tema="claro" />
          <span className="text-xs text-right leading-tight" style={{ color: 'var(--pv-color-asfalto-600)' }}>Capim Dourado<br />Shopping</span>
        </div>
        <div className="my-4 border-t-2 border-dashed" style={{ borderColor: 'var(--pv-color-asfalto-200)' }} />
        {demonstracao && <p className="m-0 mb-2 text-xs font-semibold text-center rounded py-1" style={{ background: 'var(--pv-color-faixa-100)', color: 'var(--pv-color-asfalto-900)' }}>Demonstração: ticket sem validade</p>}
        <p className="m-0 text-xs" style={{ color: 'var(--pv-color-asfalto-600)' }}>Ticket</p>
        <p className="m-0 font-mono text-3xl tracking-wider" data-testid="codigo-ticket">{ticket.codigo}</p>
        <div className="flex items-center gap-4 mt-4">
          <Placa codigo={recomendacao.regiaoId} tamanho="lg" />
          <div className="text-sm leading-snug">
            <p className="m-0 font-semibold">{doMapa?.nome}</p>
            <p className="m-0" style={{ color: 'var(--pv-color-asfalto-600)' }}>{doMapa && nomeDoNivel(doMapa.nivel)}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-4 text-sm">
          <dt style={{ color: 'var(--pv-color-asfalto-600)' }}>Veículo</dt><dd className="m-0 font-medium">{NOME_CATEGORIA[ticket.categoria]}</dd>
          <dt style={{ color: 'var(--pv-color-asfalto-600)' }}>Entrada</dt><dd className="m-0 font-medium num">{dataHora(ticket.entradaEm)}</dd>
          {tipoVaga !== 'COMUM' && <><dt style={{ color: 'var(--pv-color-asfalto-600)' }}>Vaga</dt><dd className="m-0 font-medium flex items-center gap-1.5" data-testid="ticket-tipo-vaga"><IconeTipoVaga tipo={tipoVaga} tamanho={16} />{NOME_TIPO_VAGA[tipoVaga]}</dd></>}
        </dl>
        <ol className="mt-4 pl-5 m-0 text-sm grid gap-1 list-decimal">{passos.map((p) => <li key={p}>{p}</li>)}</ol>
        <div className="my-4 border-t-2 border-dashed" style={{ borderColor: 'var(--pv-color-asfalto-200)' }} />
        <div className="flex items-center gap-4">
          {svg === null ? (
            <div data-testid="qr-falha" role="alert" className="size-32 shrink-0 grid place-items-center text-center text-xs p-2 rounded border-2 border-dashed" style={{ borderColor: 'var(--pv-color-asfalto-300)' }}>
              QR Code indisponível
            </div>
          ) : (
            <div data-testid="qr-code" data-conteudo={qrUrl} role="img" aria-label="QR Code para localizar o veículo" className="size-32 shrink-0 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />
          )}
          <p className="m-0 text-sm leading-snug">{svg === null ? `Para localizar o veículo, informe o código ${ticket.codigo} no atendimento.` : 'Ao voltar, escaneie o QR Code para ver a região onde você estacionou.'}</p>
        </div>
      </article>
      <div className="flex flex-col gap-5 max-w-md text-center lg:text-left items-center lg:items-start">
        <CircleCheck size={56} style={{ color: 'var(--pv-feedback-success-solid)' }} aria-hidden />
        <h1 className="text-4xl font-bold" style={{ color: 'var(--pv-text-primary)' }}>Ticket emitido</h1>
        <p className="m-0 text-lg" style={{ color: 'var(--pv-text-secondary)' }}>Retire o ticket e siga para a região <strong style={{ color: 'var(--pv-text-primary)' }}>{recomendacao.regiaoId}</strong>. Guarde-o para localizar o veículo e para a saída.</p>
        <Botao tamanho="xl" onClick={aoConcluir} className="min-w-72">Concluir</Botao>
        <p className="m-0 text-sm num" style={{ color: 'var(--pv-text-muted)' }}>A tela volta ao início em {restante} s.</p>
      </div>
    </div>
  );
}

function TelaErro({ titulo, mensagem, acoes, rodape, voltar }: { titulo: string; mensagem: string; acoes?: ReactNode; rodape?: string; voltar?: () => void }) {
  return (
    <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-6 text-center max-w-2xl mx-auto">
      <TriangleAlert size={64} style={{ color: 'var(--pv-feedback-warning-solid)' }} aria-hidden />
      <h1 className="text-4xl font-bold" style={{ color: 'var(--pv-text-primary)' }}>{titulo}</h1>
      <p className="m-0 text-xl" style={{ color: 'var(--pv-text-secondary)' }}>{mensagem}</p>
      <div className="flex flex-wrap gap-4 justify-center">
        {acoes}
        {voltar && <Botao tamanho="xl" variante="secundario" onClick={voltar}>Voltar ao início</Botao>}
      </div>
      {rodape && <p className="m-0" style={{ color: 'var(--pv-text-muted)' }}>{rodape}</p>}
    </div>
  );
}
