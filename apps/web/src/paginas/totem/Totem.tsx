/**
 * Interface 1 — Totem de entrada (tela de toque).
 * Fluxo: início → categoria → processamento → recomendação → ticket.
 * A entrada é registrada na API (POST /entradas), que devolve a recomendação do algoritmo e o ticket com o QR Code.
 * Nada aqui reserva vaga: a ocupação só muda quando o estacionamento é confirmado.
 */
import type { Categoria, Regiao } from '@parkvision/shared';
import { CATEGORIAS } from '@parkvision/shared';
import { ArrowLeft, CircleCheck, LoaderCircle, QrCode, RefreshCw, TriangleAlert } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Botao, Marca, Medidor, Placa } from '../../componentes/base.tsx';
import { IconeCategoria } from '../../componentes/IconeCategoria.tsx';
import { acessoPorId, nomeCurto, nomeDoNivel, orientacaoDaRota, regiaoDoMapa } from '../../mapa/dados.ts';
import { NOME_CATEGORIA, dataHora, faixaDaRegiao } from '../../mapa/estado.ts';
import { MapaEstacionamento } from '../../mapa/MapaEstacionamento.tsx';
import { ErroServico, api, type RespostaEntrada } from '../../servicos/api.ts';

type Etapa =
  | { tipo: 'inicio' }
  | { tipo: 'categoria' }
  | { tipo: 'processando'; categoria: Categoria }
  | { tipo: 'recomendacao'; dados: RespostaEntrada; regioes: Regiao[] }
  | { tipo: 'ticket'; dados: RespostaEntrada }
  | { tipo: 'sem-vagas'; categoria: Categoria; mensagem: string }
  | { tipo: 'erro'; categoria: Categoria | null; mensagem: string };

const PASSOS_PROCESSAMENTO = ['Consultando a ocupação das regiões', 'Comparando distância e fluxo de veículos', 'Escolhendo a região para você'];
const INATIVIDADE_MS = 120_000;
const RETORNO_TICKET_S = 60;

export function Totem() {
  const [params] = useSearchParams();
  const acessoId = params.get('acesso') ?? 'A_NE';
  const acesso = acessoPorId[acessoId];
  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'inicio' });
  const reiniciar = useCallback(() => setEtapa({ tipo: 'inicio' }), []);

  // volta ao início depois de um tempo sem toque (outro motorista vai usar o totem)
  useEffect(() => {
    if (etapa.tipo === 'inicio') return;
    let t = setTimeout(reiniciar, INATIVIDADE_MS);
    const tocar = () => { clearTimeout(t); t = setTimeout(reiniciar, INATIVIDADE_MS); };
    window.addEventListener('pointerdown', tocar);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', tocar); };
  }, [etapa.tipo, reiniciar]);

  const escolher = async (categoria: Categoria) => {
    setEtapa({ tipo: 'processando', categoria });
    const inicio = Date.now();
    try {
      const dados = await api.registrarEntrada(acessoId, categoria);
      const regioes = await api.regioes().catch(() => [] as Regiao[]);
      await new Promise((ok) => setTimeout(ok, Math.max(0, 1400 - (Date.now() - inicio)))); // tempo mínimo para a animação ser lida
      setEtapa({ tipo: 'recomendacao', dados, regioes });
    } catch (e) {
      if (e instanceof ErroServico && e.codigo === 'SEM_REGIAO_ELEGIVEL') setEtapa({ tipo: 'sem-vagas', categoria, mensagem: e.message });
      else if (e instanceof ErroServico && e.codigo === 'SEM_CONEXAO') setEtapa({ tipo: 'erro', categoria, mensagem: 'O totem perdeu a conexão com o sistema.' });
      else setEtapa({ tipo: 'erro', categoria, mensagem: e instanceof Error ? e.message : 'Erro inesperado.' });
    }
  };

  return (
    <div data-theme="dark" className="min-h-full flex flex-col" style={{ background: 'var(--pv-color-asfalto-950)', color: 'var(--pv-text-primary)' }}>
      <header className="flex items-center justify-between gap-4 px-6 sm:px-10 h-20 border-b" style={{ borderColor: 'var(--pv-color-asfalto-800)' }}>
        <Marca claro tamanho={36} />
        <div className="text-right text-sm" style={{ color: 'var(--pv-color-asfalto-300)' }}>
          <p className="m-0 font-semibold" style={{ color: '#fff' }}>Capim Dourado Shopping</p>
          <p className="m-0">{acesso ? nomeCurto(acesso.nome) : 'Acesso não configurado'}</p>
        </div>
      </header>

      <main className="flex-1 flex flex-col px-6 sm:px-10 py-8" aria-live="polite">
        {!acesso || acesso.nivel !== 'terreo' ? (
          <TelaErro titulo="Totem sem acesso configurado" mensagem={`O acesso "${acessoId}" não existe no mapa. Use /totem?acesso=A_NE, A_ROT, A_S1 ou A_S2.`} />
        ) : etapa.tipo === 'inicio' ? (
          <TelaInicio aoComecar={() => setEtapa({ tipo: 'categoria' })} />
        ) : etapa.tipo === 'categoria' ? (
          <TelaCategoria aoEscolher={escolher} aoVoltar={reiniciar} />
        ) : etapa.tipo === 'processando' ? (
          <TelaProcessando categoria={etapa.categoria} />
        ) : etapa.tipo === 'recomendacao' ? (
          <TelaRecomendacao dados={etapa.dados} regioes={etapa.regioes} aoEmitir={() => setEtapa({ tipo: 'ticket', dados: etapa.dados })} />
        ) : etapa.tipo === 'ticket' ? (
          <TelaTicket dados={etapa.dados} aoConcluir={reiniciar} />
        ) : etapa.tipo === 'sem-vagas' ? (
          <TelaErro
            titulo={`Sem vagas para ${NOME_CATEGORIA[etapa.categoria].toLowerCase()} agora`}
            mensagem={etapa.mensagem}
            acoes={<><Botao tamanho="xl" onClick={() => setEtapa({ tipo: 'categoria' })} icone={ArrowLeft}>Escolher outra categoria</Botao></>}
            rodape="Se precisar, procure o atendimento do estacionamento."
          />
        ) : (
          <TelaErro
            titulo="Não foi possível gerar sua recomendação"
            mensagem={`${etapa.mensagem} Procure o atendimento do estacionamento para retirar seu ticket.`}
            acoes={etapa.categoria && <Botao tamanho="xl" icone={RefreshCw} onClick={() => escolher(etapa.categoria!)}>Tentar de novo</Botao>}
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
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight" style={{ color: '#fff' }}>Boas-vindas ao estacionamento</h1>
        <p className="mt-5 text-xl max-w-[34ch]" style={{ color: 'var(--pv-color-asfalto-300)' }}>
          Informe o tipo do seu veículo e o ParkVision indica a região com melhor acesso agora — com o caminho até lá.
        </p>
        <Botao tamanho="xl" className="mt-10 w-full sm:w-auto min-w-80" onClick={aoComecar}>Começar</Botao>
      </div>
      <ol className="list-none m-0 p-0 grid gap-4" aria-label="Como funciona">
        {['Toque em Começar e escolha o tipo do veículo.', 'Veja a região indicada e o caminho até ela.', 'Leve o ticket: o QR Code mostra onde você estacionou.'].map((t, i) => (
          <li key={t} className="flex items-center gap-4 rounded-xl p-5" style={{ background: 'var(--pv-color-asfalto-900)' }}>
            <span className="grid place-items-center size-11 shrink-0 rounded-full font-display text-xl font-bold num" style={{ background: 'var(--pv-wayfinding-route)', color: 'var(--pv-wayfinding-on)' }}>{i + 1}</span>
            <span className="text-lg" style={{ color: 'var(--pv-color-asfalto-100)' }}>{t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TelaCategoria({ aoEscolher, aoVoltar }: { aoEscolher: (c: Categoria) => void; aoVoltar: () => void }) {
  return (
    <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full">
      <h1 className="text-4xl sm:text-5xl font-bold" style={{ color: '#fff' }}>Qual é o seu veículo?</h1>
      <p className="mt-3 text-lg" style={{ color: 'var(--pv-color-asfalto-300)' }}>Toque na opção correspondente.</p>
      <div className="grid sm:grid-cols-3 gap-5 mt-8 flex-1 sm:max-h-[420px]">
        {CATEGORIAS.map((c) => (
          <button
            key={c}
            onClick={() => aoEscolher(c)}
            className="group flex flex-col items-center justify-center gap-5 rounded-2xl p-8 min-h-44 cursor-pointer transition-colors border-2"
            style={{ background: 'var(--pv-color-asfalto-900)', borderColor: 'var(--pv-color-asfalto-700)', color: '#fff' }}
          >
            <IconeCategoria categoria={c} tamanho={c === 'MOTO' ? 120 : 140} className="text-[var(--pv-color-vision-300)] group-hover:text-[var(--pv-wayfinding-route)] transition-colors" />
            <span className="font-display text-3xl font-semibold text-center leading-tight">{NOME_CATEGORIA[c]}</span>
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
      <IconeCategoria categoria={categoria} tamanho={120} className="text-[var(--pv-color-vision-300)]" />
      <h1 className="text-4xl font-bold" style={{ color: '#fff' }}>Procurando a melhor região</h1>
      <ol className="list-none p-0 m-0 grid gap-3 text-left text-lg" aria-label="Etapas da recomendação">
        {PASSOS_PROCESSAMENTO.map((t, i) => (
          <li key={t} className="flex items-center gap-3" style={{ color: i <= passo ? '#fff' : 'var(--pv-color-asfalto-500)' }}>
            {i < passo ? <CircleCheck size={24} style={{ color: 'var(--pv-feedback-success-solid)' }} aria-hidden /> : i === passo ? <LoaderCircle size={24} className="gira" aria-hidden /> : <span className="inline-block size-6" aria-hidden />}
            {t}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Disponibilidade({ regiao }: { regiao: Regiao | null }) {
  if (!regiao) return <p className="m-0" style={{ color: 'var(--pv-color-asfalto-300)' }}>Disponibilidade indisponível no momento.</p>;
  const faixa = faixaDaRegiao(regiao);
  return (
    <div>
      <p className="m-0 text-2xl font-display font-semibold num" style={{ color: '#fff' }}>{regiao.livres} vagas livres <span className="text-lg font-sans font-normal" style={{ color: 'var(--pv-color-asfalto-300)' }}>de {regiao.capacidade}</span></p>
      <div className="mt-2 max-w-sm"><Medidor valor={regiao.ocupadas} total={regiao.capacidade} cor={faixa === 'livre' ? 'var(--pv-faixa-livre)' : faixa === 'alta' ? 'var(--pv-faixa-alta)' : 'var(--pv-faixa-critica)'} rotulo={`Ocupação da região ${regiao.id}`} /></div>
    </div>
  );
}

function TelaRecomendacao({ dados, regioes, aoEmitir }: { dados: RespostaEntrada; regioes: Regiao[]; aoEmitir: () => void }) {
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
            <p className="m-0 text-lg" style={{ color: 'var(--pv-color-asfalto-300)' }}>Região indicada para você</p>
            <h1 id="titulo-rec" className="text-4xl font-bold mt-1" style={{ color: '#fff' }}>{doMapa?.nome ?? recomendacao.regiaoId}</h1>
            {doMapa && <p className="m-0 mt-1 text-lg" style={{ color: 'var(--pv-color-asfalto-300)' }}>{nomeDoNivel(doMapa.nivel)}</p>}
          </div>
        </div>
        <Disponibilidade regiao={regiao} />
        <div>
          <h2 className="text-xl font-semibold" style={{ color: '#fff' }}>Por que esta região</h2>
          <p className="mt-2 text-lg leading-snug" style={{ color: 'var(--pv-color-asfalto-100)' }} data-testid="justificativa">{recomendacao.justificativa}</p>
        </div>
        <div>
          <h2 className="text-xl font-semibold" style={{ color: '#fff' }}>Como chegar</h2>
          <ol className="mt-2 p-0 list-none grid gap-2" data-testid="orientacao">
            {passos.map((p, i) => (
              <li key={p} className="flex gap-3 text-lg" style={{ color: 'var(--pv-color-asfalto-100)' }}>
                <span className="grid place-items-center size-8 shrink-0 rounded-full font-display font-bold num" style={{ background: 'var(--pv-wayfinding-route)', color: 'var(--pv-wayfinding-on)' }}>{i + 1}</span>
                <span className="pt-0.5">{p}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="m-0 text-base" style={{ color: 'var(--pv-color-asfalto-400)' }}>A indicação não reserva vaga: ela considera a ocupação deste momento.</p>
        <Botao tamanho="xl" icone={QrCode} onClick={aoEmitir} className="w-full sm:w-auto self-start min-w-80">Emitir ticket</Botao>
      </section>
      <MapaEstacionamento regioes={regioes.length ? regioes : undefined} destino={recomendacao.regiaoId} rota={recomendacao.rota.nos} rotuloDestino="Sua região" mostrarLegenda={false} className="min-w-0" />
    </div>
  );
}

function TelaTicket({ dados, aoConcluir }: { dados: RespostaEntrada; aoConcluir: () => void }) {
  const { ticket, recomendacao, qrUrl } = dados;
  const [svg, setSvg] = useState('');
  const [restante, setRestante] = useState(RETORNO_TICKET_S);
  const concluirRef = useRef(aoConcluir);
  concluirRef.current = aoConcluir;
  useEffect(() => {
    QRCode.toString(qrUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0C111C', light: '#FFFFFF' } }).then(setSvg).catch(() => setSvg(''));
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
          <Marca tamanho={26} />
          <span className="text-xs text-right leading-tight" style={{ color: 'var(--pv-color-asfalto-600)' }}>Capim Dourado<br />Shopping</span>
        </div>
        <div className="my-4 border-t-2 border-dashed" style={{ borderColor: 'var(--pv-color-asfalto-200)' }} />
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
        </dl>
        <ol className="mt-4 pl-5 m-0 text-sm grid gap-1 list-decimal">{passos.map((p) => <li key={p}>{p}</li>)}</ol>
        <div className="my-4 border-t-2 border-dashed" style={{ borderColor: 'var(--pv-color-asfalto-200)' }} />
        <div className="flex items-center gap-4">
          <div data-testid="qr-code" data-conteudo={qrUrl} role="img" aria-label="QR Code para localizar o veículo" className="size-32 shrink-0 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="m-0 text-sm leading-snug">Ao voltar, escaneie o QR Code para ver a região onde você estacionou.</p>
        </div>
      </article>
      <div className="flex flex-col gap-5 max-w-md text-center lg:text-left items-center lg:items-start">
        <CircleCheck size={56} style={{ color: 'var(--pv-feedback-success-solid)' }} aria-hidden />
        <h1 className="text-4xl font-bold" style={{ color: '#fff' }}>Ticket emitido</h1>
        <p className="m-0 text-lg" style={{ color: 'var(--pv-color-asfalto-200)' }}>Retire o ticket e siga para a região <strong style={{ color: '#fff' }}>{recomendacao.regiaoId}</strong>. Guarde-o para localizar o veículo e para a saída.</p>
        <Botao tamanho="xl" onClick={aoConcluir} className="min-w-72">Concluir</Botao>
        <p className="m-0 text-sm num" style={{ color: 'var(--pv-color-asfalto-400)' }}>A tela volta ao início em {restante} s.</p>
      </div>
    </div>
  );
}

function TelaErro({ titulo, mensagem, acoes, rodape, voltar }: { titulo: string; mensagem: string; acoes?: ReactNode; rodape?: string; voltar?: () => void }) {
  return (
    <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-6 text-center max-w-2xl mx-auto">
      <TriangleAlert size={64} style={{ color: 'var(--pv-feedback-warning-solid)' }} aria-hidden />
      <h1 className="text-4xl font-bold" style={{ color: '#fff' }}>{titulo}</h1>
      <p className="m-0 text-xl" style={{ color: 'var(--pv-color-asfalto-200)' }}>{mensagem}</p>
      <div className="flex flex-wrap gap-4 justify-center">
        {acoes}
        {voltar && <Botao tamanho="xl" variante="secundario" onClick={voltar}>Voltar ao início</Botao>}
      </div>
      {rodape && <p className="m-0" style={{ color: 'var(--pv-color-asfalto-400)' }}>{rodape}</p>}
    </div>
  );
}
