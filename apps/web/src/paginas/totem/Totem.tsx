/**
 * Interface 1 — Totem de entrada (tela de toque, autoatendimento).
 * Fluxo: início → categoria → tipo de vaga (carros) → processamento → recomendação → ticket.
 * Tipo de vaga: declaração do motorista (sem pergunta médica); o totem lembra da credencial e não diz que a verificou.
 * Sem vaga do tipo pedido: mostra a indisponibilidade e deixa o motorista decidir — nada de mandar para outro tipo.
 * A entrada é registrada na API (POST /entradas), que devolve a recomendação do algoritmo e o ticket com o QR Code.
 * Nada aqui reserva vaga: a ocupação só muda quando o estacionamento é confirmado.
 *
 * Direção visual (wireframes aprovados): coluna central, uma ação principal por etapa (bronze), botões grandes
 * legíveis à distância, indicador de etapa discreto e o código da região enorme como elemento memorável.
 */
import type { Categoria, Regiao, TipoVaga } from '@parkvision/shared';
import { CATEGORIAS, NOME_TIPO_VAGA, TIPOS_VAGA, vagasDaRegiao } from '@parkvision/shared';
import { ArrowLeft, Check, ChevronRight, CircleCheck, CircleParkingOff, LoaderCircle, MapPinOff, QrCode, RefreshCw, TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Botao, Marca, Medidor, SeloDemonstracao, Status } from '../../componentes/base.tsx';
import { ControlesTema } from '../../tema/ControlesTema.tsx';
import { IconeCategoria } from '../../componentes/IconeCategoria.tsx';
import { IconeTipoVaga, SeloTipoVaga } from '../../componentes/IconeTipoVaga.tsx';
import { acessoPorId, nomeCurto, nomeDoNivel, orientacaoDaRota, regiaoDoMapa } from '../../mapa/dados.ts';
import { NOME_CATEGORIA, ROTULO_FAIXA, dataHora, faixaDaRegiao } from '../../mapa/estado.ts';
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
  | { tipo: 'erro'; categoria: Categoria | null; tipoVaga: TipoVaga; mensagem: string; offline: boolean };

const PASSOS_PROCESSAMENTO = ['Consultando a ocupação das regiões', 'Comparando distância e fluxo de veículos', 'Escolhendo a região para você'];
const INATIVIDADE_MS = 120_000;
const RETORNO_TICKET_S = 60;

/** Etapas reais do atendimento (o indicador de progresso só aparece nelas). Moto: o tipo de vaga já fica decidido (comum). */
const ETAPAS = ['Veículo', 'Vaga', 'Região', 'Ticket'] as const;
const POSICAO_ETAPA: Partial<Record<Etapa['tipo'], number>> = { categoria: 0, 'tipo-vaga': 1, processando: 2, recomendacao: 2, ticket: 3 };

/** Entrada de cada etapa: opacidade + 8 px, 200 ms ease-out (sem movimento com prefers-reduced-motion). */
const TRANSICAO = 'transition-[opacity,translate] duration-200 ease-out starting:opacity-0 starting:translate-y-2 motion-reduce:transition-none';

const corTexto = { primario: 'var(--pv-text-primary)', secundario: 'var(--pv-text-secondary)', apagado: 'var(--pv-text-muted)' } as const;

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
      else if (e instanceof ErroServico && e.codigo === 'SEM_CONEXAO') setEtapa({ tipo: 'erro', categoria, tipoVaga, mensagem: 'O totem perdeu a conexão com o sistema.', offline: true });
      else setEtapa({ tipo: 'erro', categoria, tipoVaga, mensagem: e instanceof Error ? e.message : 'Erro inesperado.', offline: false });
    }
  };

  const acessoValido = !!acesso && acesso.nivel === 'terreo';
  const posicao = acessoValido ? POSICAO_ETAPA[etapa.tipo] : undefined;

  return (
    <div className="min-h-full flex flex-col" style={{ background: 'var(--pv-bg-canvas)', color: corTexto.primario }}>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 sm:px-10 py-4 min-h-20 border-b" style={{ borderColor: 'var(--pv-border-subtle)' }}>
        <Marca tamanho={40} />
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {demonstracao && <span data-testid="totem-demonstracao"><SeloDemonstracao /></span>}
          <p className="m-0 text-sm sm:text-base" style={{ color: corTexto.secundario }}>{acesso ? nomeCurto(acesso.nome) : 'Acesso não configurado'}</p>
          <ControlesTema />
        </div>
      </header>

      <main className="flex-1 flex flex-col px-4 sm:px-10 py-8 sm:py-12" aria-live="polite">
        {posicao !== undefined && <Progresso atual={posicao} />}
        <div key={acessoValido ? etapa.tipo : 'sem-acesso'} className={`flex-1 flex flex-col ${TRANSICAO}`}>
          {!acessoValido ? (
            <TelaAviso
              icone={MapPinOff}
              titulo="Totem sem acesso configurado"
              mensagem={`O acesso "${acessoId}" não existe no mapa. Use /totem?acesso=A_NE, A_ROT, A_S1 ou A_S2.`}
              rodape="A configuração do acesso é feita pela equipe de operação."
            />
          ) : etapa.tipo === 'inicio' ? (
            <TelaInicio acesso={nomeCurto(acesso.nome)} aoComecar={() => setEtapa({ tipo: 'categoria' })} />
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
              <TelaAviso
                icone={CircleParkingOff}
                titulo={`Sem vagas para ${NOME_CATEGORIA[etapa.categoria].toLowerCase()} agora`}
                mensagem={etapa.mensagem}
                acoes={<Botao tamanho="xl" onClick={() => setEtapa({ tipo: 'categoria' })} icone={ArrowLeft} className="w-full sm:w-auto">Escolher outra categoria</Botao>}
                rodape="Se precisar, procure o atendimento do estacionamento."
              />
            ) : (
              // indisponibilidade de vaga reservada: informa e deixa o motorista decidir (o totem não troca o tipo sozinho)
              <TelaAviso
                icone={CircleParkingOff}
                titulo={`Sem ${etapa.tipoVaga === 'PCD' ? 'vaga PcD' : 'vaga para pessoa idosa'} disponível agora`}
                mensagem={etapa.mensagem}
                acoes={<Botao tamanho="xl" onClick={() => setEtapa({ tipo: 'tipo-vaga', categoria: etapa.categoria })} icone={ArrowLeft} className="w-full sm:w-auto">Voltar às opções de vaga</Botao>}
                rodape="A equipe do estacionamento pode ajudar. Nenhuma vaga foi indicada para você."
                voltar={reiniciar}
              />
            )
          ) : (
            <TelaAviso
              icone={etapa.offline ? WifiOff : TriangleAlert}
              titulo="Não foi possível gerar sua recomendação"
              mensagem={`${etapa.mensagem} Procure o atendimento do estacionamento para retirar seu ticket.`}
              acoes={etapa.categoria && <Botao tamanho="xl" icone={RefreshCw} onClick={() => escolher(etapa.categoria!, etapa.tipoVaga)} className="w-full sm:w-auto">Tentar de novo</Botao>}
              voltar={reiniciar}
            />
          )}
        </div>
      </main>
    </div>
  );
}

/** Indicador discreto: "Etapa 2 de 4" + pontos (concluída com marca, atual mais larga). A cor nunca é o único sinal. */
function Progresso({ atual }: { atual: number }) {
  return (
    <nav aria-label="Progresso do atendimento" className="w-full max-w-3xl mx-auto mb-8 sm:mb-12 flex items-center gap-4">
      <ol className="list-none m-0 p-0 flex items-center gap-2" aria-hidden>
        {ETAPAS.map((nome, i) => (
          <li
            key={nome}
            className="h-2 rounded-full transition-[width,background-color] duration-200 ease-out"
            style={{
              width: i === atual ? 28 : 8,
              background: i <= atual ? corTexto.primario : 'transparent',
              boxShadow: i <= atual ? undefined : `inset 0 0 0 1.5px var(--pv-border-strong)`,
            }}
          />
        ))}
      </ol>
      <p className="m-0 flex items-baseline gap-3 text-sm sm:text-base num" style={{ color: corTexto.secundario }}>
        <span>Etapa {atual + 1} de {ETAPAS.length}<span className="sr-only-texto">:</span></span>
        <span className="font-semibold" style={{ color: corTexto.primario }}>{ETAPAS[atual]}</span>
      </p>
    </nav>
  );
}

/** Coluna central comum às etapas de escolha e aos avisos. */
function Coluna({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`w-full max-w-3xl mx-auto flex flex-col ${className}`}>{children}</div>;
}

const TITULO = 'font-display font-bold tracking-tight leading-[1.05] text-4xl sm:text-5xl lg:text-6xl';

function TelaInicio({ acesso, aoComecar }: { acesso: string; aoComecar: () => void }) {
  return (
    <Coluna className="flex-1 justify-center">
      <p className="m-0 text-lg sm:text-xl" style={{ color: corTexto.secundario }}>{acesso}</p>
      <h1 className="mt-3 font-display font-bold tracking-tight leading-[1.02] text-5xl sm:text-6xl lg:text-7xl" style={{ color: corTexto.primario }}>Boas-vindas ao estacionamento</h1>
      <p className="mt-6 text-xl sm:text-2xl leading-snug max-w-[36ch]" style={{ color: corTexto.secundario }}>
        Informe o tipo do seu veículo e o Golden Park indica a região com melhor acesso agora.
      </p>
      <Botao tamanho="xl" className="mt-12 w-full sm:w-auto sm:min-w-80 self-start" onClick={aoComecar}>Começar</Botao>
      <p className="mt-5 text-base" style={{ color: corTexto.apagado }}>O ticket impresso mostra a região e o caminho.</p>
    </Coluna>
  );
}

/** Opção de toque grande (linha inteira), sem grade de cartões. O nome acessível é o texto visível. */
function Opcao({ icone, titulo, descricao, aoTocar }: { icone: ReactNode; titulo: string; descricao?: string; aoTocar: () => void }) {
  return (
    <button
      onClick={aoTocar}
      className="group w-full flex items-center gap-5 sm:gap-7 text-left rounded-xl border-2 px-5 sm:px-7 py-4 min-h-24 sm:min-h-28 cursor-pointer select-none
        transition-[border-color,background-color,transform] duration-150 ease-out active:scale-[0.99]
        border-[var(--pv-border-default)] bg-[var(--pv-bg-surface)] hover:border-[var(--pv-brand-primary)] active:bg-[var(--pv-brand-subtle)]"
      style={{ color: corTexto.primario }}
    >
      <span className="shrink-0 grid place-items-center w-16 sm:w-24" style={{ color: corTexto.secundario }}>{icone}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-display text-2xl sm:text-3xl font-semibold leading-tight">{titulo}</span>
        {descricao && <span className="block mt-1 text-base sm:text-lg leading-snug" style={{ color: corTexto.secundario }}>{descricao}</span>}
      </span>
      <ChevronRight size={32} aria-hidden className="shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" style={{ color: 'var(--pv-brand-primary)' }} />
    </button>
  );
}

function Voltar({ aoVoltar }: { aoVoltar: () => void }) {
  return <Botao variante="fantasma" tamanho="lg" icone={ArrowLeft} onClick={aoVoltar} className="self-start mt-8 -ml-2">Voltar</Botao>;
}

function TelaCategoria({ aoEscolher, aoVoltar }: { aoEscolher: (c: Categoria) => void; aoVoltar: () => void }) {
  return (
    <Coluna>
      <h1 className={TITULO} style={{ color: corTexto.primario }}>Qual é o seu veículo?</h1>
      <p className="mt-4 text-lg sm:text-xl" style={{ color: corTexto.secundario }}>Toque na opção correspondente.</p>
      <div className="grid gap-4 mt-10" role="group" aria-label="Tipo de veículo">
        {CATEGORIAS.map((c) => (
          <Opcao key={c} titulo={NOME_CATEGORIA[c]} aoTocar={() => aoEscolher(c)} icone={<IconeCategoria categoria={c} tamanho={c === 'MOTO' ? 64 : 80} />} />
        ))}
      </div>
      <Voltar aoVoltar={aoVoltar} />
    </Coluna>
  );
}

const DESCRICAO_TIPO: Record<TipoVaga, string> = {
  COMUM: 'Qualquer vaga comum do estacionamento.',
  PCD: 'Para veículo com credencial de pessoa com deficiência.',
  IDOSO: 'Para veículo com credencial de pessoa idosa.',
};

function TelaTipoVaga({ aoEscolher, aoVoltar }: { aoEscolher: (t: TipoVaga) => void; aoVoltar: () => void }) {
  return (
    <Coluna>
      <h1 className={TITULO} style={{ color: corTexto.primario }}>Que tipo de vaga você precisa?</h1>
      <p className="mt-4 text-lg sm:text-xl leading-snug max-w-[58ch]" style={{ color: corTexto.secundario }}>
        As vagas PcD e para pessoa idosa são reservadas e exigem <strong style={{ color: corTexto.primario }}>credencial válida</strong> à vista no veículo.
        O Golden Park não verifica a credencial: a sua escolha serve só para indicar a vaga.
      </p>
      <div className="grid gap-4 mt-10" role="group" aria-label="Tipo de vaga">
        {TIPOS_VAGA.map((t) => (
          <Opcao key={t} titulo={NOME_TIPO_VAGA[t]} descricao={DESCRICAO_TIPO[t]} aoTocar={() => aoEscolher(t)} icone={<IconeTipoVaga tipo={t} tamanho={56} />} />
        ))}
      </div>
      <Voltar aoVoltar={aoVoltar} />
    </Coluna>
  );
}

function TelaProcessando({ categoria }: { categoria: Categoria }) {
  const [passo, setPasso] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPasso((p) => Math.min(p + 1, PASSOS_PROCESSAMENTO.length - 1)), 450);
    return () => clearInterval(t);
  }, []);
  return (
    <Coluna className="flex-1 justify-center">
      <div role="status">
        <IconeCategoria categoria={categoria} tamanho={88} className="text-[var(--pv-text-secondary)]" />
        <h1 className={`mt-6 ${TITULO}`} style={{ color: corTexto.primario }}>Procurando a melhor região</h1>
        <ol className="list-none p-0 mt-10 grid gap-5 text-xl sm:text-2xl" aria-label="Etapas da recomendação">
          {PASSOS_PROCESSAMENTO.map((t, i) => {
            const feito = i < passo, atual = i === passo;
            return (
              <li key={t} className="flex items-center gap-4" style={{ color: i <= passo ? corTexto.primario : corTexto.apagado }}>
                <span className="grid place-items-center size-8 shrink-0" aria-hidden>
                  {feito ? <Check size={28} strokeWidth={2.5} style={{ color: 'var(--pv-feedback-success-solid)' }} />
                    : atual ? <LoaderCircle size={28} className="gira" style={{ color: 'var(--pv-brand-primary)' }} />
                      : <span className="size-2.5 rounded-full" style={{ boxShadow: 'inset 0 0 0 1.5px var(--pv-border-strong)' }} />}
                </span>
                <span>{t}{feito && <span className="sr-only-texto"> (concluído)</span>}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-10 text-base" style={{ color: corTexto.apagado }}>Isso leva alguns segundos.</p>
      </div>
    </Coluna>
  );
}

function Disponibilidade({ regiao, tipoVaga }: { regiao: Regiao | null; tipoVaga: TipoVaga }) {
  if (!regiao) return <p className="m-0 text-lg" style={{ color: corTexto.secundario }}>Disponibilidade indisponível no momento.</p>;
  const faixa = faixaDaRegiao(regiao);
  // vaga reservada: mostra só as vagas do tipo pedido (as comuns não servem para quem pediu PcD/idoso e vice-versa)
  const v = tipoVaga === 'COMUM' ? { livres: regiao.livres, capacidade: regiao.capacidade, ocupadas: regiao.ocupadas } : vagasDaRegiao(regiao)[tipoVaga];
  const rotulo = tipoVaga === 'COMUM' ? 'vagas livres' : `${tipoVaga === 'PCD' ? 'vagas PcD' : 'vagas para pessoa idosa'} livres`;
  return (
    <div data-testid="disponibilidade" className="max-w-md">
      <p className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-2xl sm:text-3xl font-semibold num" style={{ color: corTexto.primario }}>{v.livres} {rotulo}</span>
        <span className="text-lg num" style={{ color: corTexto.secundario }}>de {v.capacidade}</span>
      </p>
      <div className="mt-3">
        <Medidor valor={v.ocupadas} total={v.capacidade} cor="var(--pv-brand-primary)" rotulo={`Ocupação ${tipoVaga === 'COMUM' ? '' : 'das vagas reservadas '}da região ${regiao.id}`} />
      </div>
      {/* a barra é sempre bronze: o estado da região vai em texto quando pede atenção */}
      {(faixa === 'alta' || faixa === 'critica') && <Status tom="atencao" className="mt-2">{ROTULO_FAIXA[faixa]}</Status>}
    </div>
  );
}

function TelaRecomendacao({ dados, regioes, tipoVaga, aoEmitir }: { dados: RespostaEntrada; regioes: Regiao[]; tipoVaga: TipoVaga; aoEmitir: () => void }) {
  const { recomendacao } = dados;
  const regiao = regioes.find((r) => r.id === recomendacao.regiaoId) ?? null;
  const doMapa = regiaoDoMapa[recomendacao.regiaoId];
  const passos = orientacaoDaRota(recomendacao.rota.nos, recomendacao.regiaoId);
  return (
    <div className="grid gap-x-16 gap-y-10 w-full max-w-7xl mx-auto xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] xl:grid-rows-[auto_1fr]">
      <section aria-labelledby="titulo-rec" className="flex flex-col gap-6 min-w-0">
        <div>
          <p className="m-0 text-lg sm:text-xl" style={{ color: corTexto.secundario }}>Sua melhor opção agora</p>
          {/* o elemento memorável: o código da região, como na placa do estacionamento */}
          <p className="mt-1 font-display font-bold leading-[0.9] tracking-[-0.03em] num text-[clamp(5.5rem,12vw,9rem)] break-words" style={{ color: corTexto.primario }}>
            <span className="sr-only-texto">Região </span>{recomendacao.regiaoId}
          </p>
          <h1 id="titulo-rec" className="mt-4 font-display font-semibold tracking-tight text-3xl sm:text-4xl" style={{ color: corTexto.primario }}>{doMapa?.nome ?? recomendacao.regiaoId}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {doMapa && <p className="m-0 text-lg" style={{ color: corTexto.secundario }}>{nomeDoNivel(doMapa.nivel)}</p>}
            {tipoVaga !== 'COMUM' && <SeloTipoVaga tipo={tipoVaga} />}
          </div>
        </div>
        <Disponibilidade regiao={regiao} tipoVaga={tipoVaga} />
        {tipoVaga !== 'COMUM' && <p className="m-0 text-base sm:text-lg" style={{ color: corTexto.secundario }} data-testid="aviso-credencial">Use a vaga reservada só com a credencial válida à vista no veículo.</p>}
      </section>

      <figure className="m-0 min-w-0 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:self-start">
        <figcaption className="mb-3 text-base" style={{ color: corTexto.secundario }}>Caminho até a região {recomendacao.regiaoId}</figcaption>
        <MapaEstacionamento regioes={regioes.length ? regioes : undefined} destino={recomendacao.regiaoId} rota={recomendacao.rota.nos} rotuloDestino="Sua região" mostrarLegenda={false} className="min-w-0" />
      </figure>

      <div className="flex flex-col gap-6 min-w-0 xl:row-start-2">
        <div>
          <h2 className="text-lg font-sans font-normal" style={{ color: corTexto.secundario }}>Como chegar</h2>
          <ol className="mt-3 p-0 m-0 list-none grid gap-3" data-testid="orientacao">
            {passos.map((p, i) => (
              <li key={p} className="flex gap-4 text-xl leading-snug" style={{ color: corTexto.primario }}>
                <span className="w-5 shrink-0 pt-0.5 text-base font-semibold num" style={{ color: corTexto.secundario }}>{i + 1}</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="m-0 text-base" style={{ color: corTexto.apagado }}>A indicação não reserva vaga: ela considera a ocupação deste momento.</p>
        <Botao tamanho="xl" icone={QrCode} onClick={aoEmitir} className="w-full sm:w-auto sm:min-w-80 self-start">Emitir ticket</Botao>
        <div>
          <h2 className="text-lg font-sans font-normal" style={{ color: corTexto.secundario }}>Por que esta região</h2>
          <p className="mt-2 text-base sm:text-lg leading-snug max-w-[60ch]" style={{ color: corTexto.secundario }} data-testid="justificativa">{recomendacao.justificativa}</p>
        </div>
      </div>
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
  const papel = { tinta: 'var(--pv-color-asfalto-900)', apagada: 'var(--pv-color-asfalto-600)', linha: 'var(--pv-color-asfalto-200)' };
  return (
    <div className="flex-1 flex flex-col lg:flex-row items-stretch lg:items-center justify-center gap-10 lg:gap-16 w-full max-w-6xl mx-auto">
      <div className="flex flex-col gap-5 lg:order-2 lg:max-w-md">
        <CircleCheck size={56} style={{ color: 'var(--pv-feedback-success-solid)' }} aria-hidden />
        <h1 className={TITULO} style={{ color: corTexto.primario }}>Ticket emitido</h1>
        <p className="m-0 text-xl leading-snug" style={{ color: corTexto.secundario }}>
          Retire o ticket e siga para a região <strong style={{ color: corTexto.primario }}>{recomendacao.regiaoId}</strong>. Guarde-o para localizar o veículo e para a saída.
        </p>
        <Botao tamanho="xl" onClick={aoConcluir} className="w-full sm:w-auto sm:min-w-72 self-start mt-2">Concluir</Botao>
        <p className="m-0 text-base num" style={{ color: corTexto.apagado }}>A tela volta ao início em {restante} s.</p>
      </div>

      {/* o ticket: papel térmico em fundo claro, mesmo no tema escuro */}
      <article data-theme="light" aria-label={`Ticket ${ticket.codigo}`} className="w-full max-w-[380px] mx-auto lg:mx-0 lg:order-1 rounded-lg p-6 border" style={{ background: '#fff', color: papel.tinta, borderColor: papel.linha }}>
        <div className="flex items-center justify-between">
          <Marca tamanho={28} tema="claro" />
          <span className="text-xs text-right leading-tight" style={{ color: papel.apagada }}>Capim Dourado<br />Shopping</span>
        </div>
        <div className="my-4 border-t-2 border-dashed" style={{ borderColor: papel.linha }} />
        {demonstracao && <p className="mb-3 text-xs font-semibold text-center rounded py-1" style={{ background: 'var(--pv-color-faixa-100)', color: papel.tinta }}>Demonstração: ticket sem validade</p>}
        <p className="m-0 text-xs" style={{ color: papel.apagada }}>Ticket</p>
        <p className="m-0 font-mono text-2xl tracking-wider" data-testid="codigo-ticket">{ticket.codigo}</p>
        <p className="mt-4 font-display font-bold leading-none tracking-tight text-6xl num">{recomendacao.regiaoId}</p>
        <p className="mt-2 text-sm font-semibold">{doMapa?.nome}</p>
        {doMapa && <p className="m-0 text-sm" style={{ color: papel.apagada }}>{nomeDoNivel(doMapa.nivel)}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-4 text-sm">
          <dt style={{ color: papel.apagada }}>Veículo</dt><dd className="m-0 font-medium">{NOME_CATEGORIA[ticket.categoria]}</dd>
          <dt style={{ color: papel.apagada }}>Entrada</dt><dd className="m-0 font-medium num">{dataHora(ticket.entradaEm)}</dd>
          {tipoVaga !== 'COMUM' && <><dt style={{ color: papel.apagada }}>Vaga</dt><dd className="m-0 font-medium flex items-center gap-1.5" data-testid="ticket-tipo-vaga"><IconeTipoVaga tipo={tipoVaga} tamanho={16} />{NOME_TIPO_VAGA[tipoVaga]}</dd></>}
        </dl>
        <ol className="mt-4 pl-5 m-0 text-sm grid gap-1 list-decimal">{passos.map((p) => <li key={p}>{p}</li>)}</ol>
        <div className="my-4 border-t-2 border-dashed" style={{ borderColor: papel.linha }} />
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
    </div>
  );
}

/** Indisponibilidade, falha e acesso inválido: o que aconteceu, o que fazer e uma ação principal. */
function TelaAviso({ icone: Icone, titulo, mensagem, acoes, rodape, voltar }: { icone: LucideIcon; titulo: string; mensagem: string; acoes?: ReactNode; rodape?: string; voltar?: () => void }) {
  return (
    <Coluna className="flex-1 justify-center">
      <div role="alert" className="flex flex-col gap-6">
        <Icone size={56} strokeWidth={1.75} style={{ color: 'var(--pv-feedback-warning-solid)' }} aria-hidden />
        <h1 className={TITULO} style={{ color: corTexto.primario }}>{titulo}</h1>
        <p className="m-0 text-xl leading-snug max-w-[52ch]" style={{ color: corTexto.secundario }}>{mensagem}</p>
        {(acoes || voltar) && (
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 mt-4">
            {acoes}
            {voltar && <Botao tamanho="xl" variante="secundario" onClick={voltar} className="w-full sm:w-auto">Voltar ao início</Botao>}
          </div>
        )}
        {rodape && <p className="m-0 text-base" style={{ color: corTexto.apagado }}>{rodape}</p>}
      </div>
    </Coluna>
  );
}
