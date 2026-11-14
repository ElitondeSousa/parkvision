/**
 * Interface 3 — Localizador de veículo (aberto pelo QR Code do ticket, pensado para o celular).
 * Consulta GET /localizador/:token: só os dados deste ticket, sem placa nem dados pessoais.
 * Sem GPS: mostra a região REGISTRADA na confirmação do estacionamento — nunca a recomendada como se fosse a ocupada.
 * Etapa 4: assina o próprio ticket no Socket.IO (/localizador) e recarrega sozinho quando ele muda (confirmação, saída)
 * ou quando a conexão volta.
 */
import { Clock, LogOut, MapPin, QrCode, RefreshCw, SearchX, TicketX, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Botao, Esqueleto, Marca, Placa, Selo } from '../../componentes/base.tsx';
import { IconeCategoria } from '../../componentes/IconeCategoria.tsx';
import { nomeDoNivel, regiaoDoMapa } from '../../mapa/dados.ts';
import { NOME_CATEGORIA, dataHora, hora } from '../../mapa/estado.ts';
import { MapaEstacionamento } from '../../mapa/MapaEstacionamento.tsx';
import { ErroServico, api, type RespostaLocalizador } from '../../servicos/api.ts';
import { useTicketAoVivo } from '../../servicos/tempo-real.ts';

/** O token do QR é base64url (16 bytes = 22 caracteres). Formato estranho nem chega a consultar a API. */
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{16,64}$/;

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; dados: RespostaLocalizador }
  | { tipo: 'invalido' }
  | { tipo: 'inexistente' }
  | { tipo: 'sem-conexao' };

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

  return (
    <div className="min-h-full bg-canvas">
      <header className="flex items-center justify-between px-4 h-14 border-b border-line bg-surface">
        <Marca tamanho={26} />
        <span className="text-sm text-ink-2">Localizador</span>
      </header>
      <main className="max-w-xl mx-auto px-4 py-5 grid gap-5" aria-live="polite">
        {estado.tipo === 'carregando' ? (
          <div role="status" aria-label="Consultando o ticket" className="grid gap-4"><Esqueleto className="h-28" /><Esqueleto className="h-72" /></div>
        ) : estado.tipo === 'invalido' ? (
          <Mensagem icone={QrCode} titulo="QR Code inválido">Este endereço não corresponde a um ticket do ParkVision. Escaneie de novo o QR Code impresso no ticket.</Mensagem>
        ) : estado.tipo === 'inexistente' ? (
          <Mensagem icone={SearchX} titulo="Ticket não encontrado">Confira se escaneou o QR Code do seu ticket. Se o problema continuar, procure o atendimento do estacionamento.</Mensagem>
        ) : estado.tipo === 'sem-conexao' ? (
          <Mensagem icone={WifiOff} titulo="Sem conexão com o ParkVision" acao={<Botao icone={RefreshCw} onClick={() => void consultar()}>Tentar de novo</Botao>}>Verifique a internet do celular e tente de novo.</Mensagem>
        ) : (
          <>
            <Resultado dados={estado.dados} />
            <p className="m-0 text-xs text-ink-3" role="status" data-testid="ao-vivo">
              {aoVivo === 'conectado' ? 'Esta página se atualiza sozinha quando o ticket muda.' : 'Sem atualização automática no momento — recarregue a página para ver mudanças.'}
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Resultado({ dados }: { dados: RespostaLocalizador }) {
  const { ticket, regiao, recomendada, orientacao } = dados;
  const cabecalho = (
    <div className="flex items-center gap-3 text-sm text-ink-2">
      <IconeCategoria categoria={ticket.categoria} tamanho={40} className="text-ink-2" />
      <div>
        <p className="m-0">Ticket <span className="font-mono text-ink" data-testid="codigo-ticket">{ticket.codigo}</span>{ticket.simulado && <> <Selo tom="atencao">Demonstração</Selo></>}</p>
        <p className="m-0">{NOME_CATEGORIA[ticket.categoria]}, entrada às {hora(ticket.entradaEm)}</p>
      </div>
    </div>
  );

  if (ticket.status === 'AGUARDANDO') {
    return (
      <>
        {cabecalho}
        <Mensagem icone={Clock} titulo="Estacionamento ainda não confirmado">
          Ainda não há registro de onde o veículo estacionou, então não dá para mostrar a localização.
          Na entrada, a região indicada foi a <strong>{recomendada.id}</strong> ({recomendada.nome}) — mas a indicação não confirma onde o carro ficou.
        </Mensagem>
      </>
    );
  }
  if (ticket.status === 'SAIU') {
    return (
      <>
        {cabecalho}
        <Mensagem icone={LogOut} titulo="Este veículo já saiu">A saída foi registrada {ticket.saidaEm ? `em ${dataHora(ticket.saidaEm)}` : ''}{regiao ? `, da região ${regiao.id}` : ''}. O ticket não está mais ativo.</Mensagem>
      </>
    );
  }
  if (ticket.status === 'CANCELADO' || !regiao) {
    return (
      <>
        {cabecalho}
        <Mensagem icone={TicketX} titulo="Ticket cancelado">Este ticket foi cancelado antes do estacionamento ser confirmado.</Mensagem>
      </>
    );
  }

  const doMapa = regiaoDoMapa[regiao.id];
  return (
    <>
      <section aria-labelledby="titulo-local" className="rounded-xl p-5 text-white" style={{ background: 'var(--pv-color-asfalto-900)' }}>
        <p className="m-0 text-sm" style={{ color: 'var(--pv-color-asfalto-300)' }}>Seu veículo está na região</p>
        <div className="flex items-center gap-4 mt-2">
          <Placa codigo={regiao.id} tamanho="xl" />
          <div className="min-w-0">
            <h1 id="titulo-local" className="text-3xl font-bold" data-testid="regiao-registrada">{regiao.nome}</h1>
            <p className="m-0 mt-1 text-lg" style={{ color: 'var(--pv-color-asfalto-200)' }}>{nomeDoNivel(regiao.nivel)}</p>
          </div>
        </div>
        {ticket.estacionadoEm && (
          <p className="m-0 mt-4 text-sm inline-flex items-center gap-1.5" style={{ color: 'var(--pv-color-asfalto-300)' }}>
            <Clock size={15} aria-hidden /> Estacionamento confirmado às <span className="num text-white font-semibold">{hora(ticket.estacionadoEm)}</span>
          </p>
        )}
      </section>

      <section aria-labelledby="titulo-orientacao">
        <h2 id="titulo-orientacao" className="text-lg font-semibold inline-flex items-center gap-2"><MapPin size={18} aria-hidden style={{ color: 'var(--pv-wayfinding-route)' }} /> Como encontrar</h2>
        <ul className="mt-2 m-0 pl-5 grid gap-1 text-ink list-disc" data-testid="orientacao">
          {orientacao.map((o) => <li key={o}>{o}</li>)}
          {doMapa?.coberta && <li>A região fica em área coberta ({nomeDoNivel(regiao.nivel).toLowerCase()}).</li>}
        </ul>
      </section>

      <MapaEstacionamento destino={regiao.id} apagarOutras rotuloDestino="Seu veículo" mostrarLegenda={false} enquadrarDestino />
      {cabecalho}
      <p className="m-0 text-xs text-ink-3">O ParkVision não rastreia o veículo: esta é a região registrada quando o estacionamento foi confirmado.</p>
    </>
  );
}

function Mensagem({ icone: Icone, titulo, children, acao }: { icone: typeof Clock; titulo: string; children: ReactNode; acao?: ReactNode }) {
  return (
    <section role="alert" className="flex flex-col items-center text-center gap-3 rounded-xl border border-line bg-surface px-5 py-8">
      <Icone size={36} aria-hidden className="text-ink-2" />
      <h1 className="text-2xl font-semibold">{titulo}</h1>
      <p className="m-0 text-ink-2 max-w-[42ch]">{children}</p>
      {acao}
    </section>
  );
}
