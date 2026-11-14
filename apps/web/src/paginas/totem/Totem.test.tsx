/** Testes do totem: categorias, recomendação, dados exibidos, ticket com QR Code real e indisponibilidade. */
import { fireEvent, screen } from '@testing-library/react';
import QRCode from 'qrcode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recomendacaoDeTeste, regioesDeTeste, renderizarEm, simularApi } from '../../testes/apoio.tsx';
import { Totem } from './Totem.tsx';

const QR_URL = 'http://localhost:5173/t/AbCdEfGhIjKlMnOpQrStUv';
const ticket = { codigo: 'PV-0042', categoria: 'CARRO_PEQUENO', acessoId: 'A_NE', placa: null, entradaEm: '2026-11-13T15:00:00.000Z', regiaoRecomendadaId: 'N3', regiaoEstacionadaId: null, estacionadoEm: null, saidaEm: null, status: 'AGUARDANDO' };
const entradaOk = (corpo = {}) => ({ status: 201, corpo: { ticket, recomendacao: recomendacaoDeTeste('N3'), qrUrl: QR_URL, ...corpo } });
const abrir = (acesso = 'A_NE') => renderizarEm(`/totem?acesso=${acesso}`, '/totem', <Totem />);
const espera = { timeout: 4000 };

afterEach(() => vi.unstubAllGlobals());

async function chegarNaRecomendacao(categoria = /Carro pequeno/, tipo = /^Vaga comum/) {
  fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
  fireEvent.click(screen.getByRole('button', { name: categoria }));
  fireEvent.click(screen.getByRole('button', { name: tipo }));
  await screen.findByTestId('justificativa', {}, espera);
}
/** N3 com 8 vagas PcD (3 ocupadas) e 20 para pessoa idosa, como no resto da API. */
const regioesComReservadas = () => regioesDeTeste().map((r) => (r.id !== 'N3' ? r : {
  ...r, ocupadas: 3, livres: r.capacidade - 3,
  vagas: { COMUM: { capacidade: r.capacidade - 28, ocupadas: 0, livres: r.capacidade - 28 }, PCD: { capacidade: 8, ocupadas: 3, livres: 5 }, IDOSO: { capacidade: 20, ocupadas: 0, livres: 20 } },
}));

describe('totem de entrada', () => {
  it('mostra as três categorias com ilustração e nome', () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    for (const nome of ['Carro pequeno', 'Carro grande, SUV ou picape', 'Motocicleta']) expect(screen.getByRole('button', { name: nome })).toBeInTheDocument();
  });

  it('pede a recomendação ao backend com a categoria escolhida e o acesso do totem', async () => {
    const { chamadas } = simularApi({ 'POST /entradas': entradaOk(), '/regioes': { corpo: regioesDeTeste() } });
    abrir('A_S1');
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Motocicleta' }));
    expect(screen.getByText('Procurando a melhor região')).toBeInTheDocument();
    await screen.findByTestId('justificativa', {}, espera);
    expect(chamadas.find((c) => c.metodo === 'POST')!.corpo).toEqual({ acessoId: 'A_S1', categoria: 'MOTO' });
  });

  it('exibe região, disponibilidade, justificativa e orientação retornadas pelo backend', async () => {
    simularApi({ 'POST /entradas': entradaOk(), '/regioes': { corpo: regioesDeTeste({ N3: { ocupadas: 120, livres: 83 } }) } });
    abrir();
    await chegarNaRecomendacao();
    expect(screen.getByRole('heading', { name: 'Norte Leste' })).toBeInTheDocument();
    expect(screen.getByText('83 vagas livres')).toBeInTheDocument();
    expect(screen.getByTestId('justificativa')).toHaveTextContent(recomendacaoDeTeste('N3').justificativa);
    expect(screen.getByTestId('orientacao')).toHaveTextContent('Entre pelo acesso nordeste.');
    expect(screen.getByTestId('mapa-estacionamento').querySelector('[data-destino="true"]')).toHaveAttribute('data-regiao', 'N3');
  });

  it('emite o ticket com código, região, categoria, horário e o QR Code do identificador real', async () => {
    simularApi({ 'POST /entradas': entradaOk(), '/regioes': { corpo: regioesDeTeste() } });
    abrir();
    await chegarNaRecomendacao();
    fireEvent.click(screen.getByRole('button', { name: 'Emitir ticket' }));
    expect(screen.getByTestId('codigo-ticket')).toHaveTextContent('PV-0042');
    const ticketEl = screen.getByRole('article', { name: 'Ticket PV-0042' });
    expect(ticketEl).toHaveTextContent('Carro pequeno');
    expect(ticketEl).toHaveTextContent('13/11/2026');
    const qr = screen.getByTestId('qr-code');
    expect(qr).toHaveAttribute('data-conteudo', QR_URL);
    const esperado = await QRCode.toString(QR_URL, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0C111C', light: '#FFFFFF' } });
    const modulos = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('path[stroke]')?.getAttribute('d');
    await vi.waitFor(() => expect(qr.querySelector('path[stroke]')?.getAttribute('d')).toBe(modulos(esperado)));
  });

  it('sem vagas para a categoria: explica com a mensagem do backend e oferece outra categoria', async () => {
    simularApi({ 'POST /entradas': { status: 409, corpo: { erro: { codigo: 'SEM_REGIAO_ELEGIVEL', mensagem: 'Nenhuma região disponível para motocicleta: SS1M está lotada.' } } } });
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Motocicleta' }));
    expect(await screen.findByText('Sem vagas para motocicleta agora', {}, espera)).toBeInTheDocument();
    expect(screen.getByText(/SS1M está lotada/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Escolher outra categoria' }));
    expect(screen.getByText('Qual é o seu veículo?')).toBeInTheDocument();
  });

  it('sistema fora do ar: orienta procurar o atendimento e permite tentar de novo', async () => {
    simularApi({});
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Carro pequeno' }));
    fireEvent.click(screen.getByRole('button', { name: /^Vaga comum/ }));
    expect(await screen.findByText('Não foi possível gerar sua recomendação', {}, espera)).toBeInTheDocument();
    expect(screen.getByText(/perdeu a conexão/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('tipo de vaga: três opções para carros, aviso de credencial e nenhuma pergunta médica', () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Carro grande, SUV ou picape' }));
    expect(screen.getByText('Que tipo de vaga você precisa?')).toBeInTheDocument();
    for (const nome of [/^Vaga comum/, /^Vaga PcD/, /^Vaga para pessoa idosa/]) expect(screen.getByRole('button', { name: nome })).toBeInTheDocument();
    expect(screen.getByText(/credencial válida/)).toBeInTheDocument();
    expect(screen.getByText(/não verifica a credencial/)).toBeInTheDocument();
    expect(screen.queryByText(/diagn[óo]stico|defici[êe]ncia você tem|laudo|CID/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('motocicleta não passa pela escolha de vaga reservada', async () => {
    const { chamadas } = simularApi({ 'POST /entradas': entradaOk(), '/regioes': { corpo: regioesDeTeste() } });
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Motocicleta' }));
    expect(screen.queryByText('Que tipo de vaga você precisa?')).not.toBeInTheDocument();
    await screen.findByTestId('justificativa', {}, espera);
    expect(chamadas.find((c) => c.metodo === 'POST')!.corpo).not.toHaveProperty('tipoVaga');
  });

  it('vaga PcD: pede ao backend com o tipo, mostra o selo, as vagas PcD livres e o aviso de credencial; o ticket leva o tipo', async () => {
    const pcd = { ...ticket, tipoVaga: 'PCD' };
    const { chamadas } = simularApi({ 'POST /entradas': entradaOk({ ticket: pcd }), '/regioes': { corpo: regioesComReservadas() } });
    abrir();
    await chegarNaRecomendacao(/Carro pequeno/, /^Vaga PcD/);
    expect(chamadas.find((c) => c.metodo === 'POST')!.corpo).toEqual({ acessoId: 'A_NE', categoria: 'CARRO_PEQUENO', tipoVaga: 'PCD' });
    expect(screen.getByTestId('selo-tipo-vaga')).toHaveAttribute('data-tipo', 'PCD');
    expect(screen.getByTestId('disponibilidade')).toHaveTextContent('5 vagas PcD livres');
    expect(screen.getByTestId('disponibilidade')).toHaveTextContent('de 8');
    expect(screen.getByTestId('aviso-credencial')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Emitir ticket' }));
    expect(screen.getByTestId('ticket-tipo-vaga')).toHaveTextContent('Vaga PcD');
  });

  it('sem vaga PcD: mostra a indisponibilidade e NÃO pede outro tipo automaticamente', async () => {
    const { chamadas } = simularApi({ 'POST /entradas': { status: 409, corpo: { erro: { codigo: 'SEM_REGIAO_ELEGIVEL', mensagem: 'Nenhuma vaga PcD disponível agora para carro pequeno: N2 e N3 sem vagas. O sistema não indica vaga de outro tipo automaticamente.' } } } });
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Carro pequeno' }));
    fireEvent.click(screen.getByRole('button', { name: /^Vaga PcD/ }));
    expect(await screen.findByText('Sem vaga PcD disponível agora', {}, espera)).toBeInTheDocument();
    expect(screen.getByText(/não indica vaga de outro tipo/)).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma vaga foi indicada para você/)).toBeInTheDocument();
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(1); // nenhuma segunda tentativa com outro tipo
    fireEvent.click(screen.getByRole('button', { name: 'Voltar às opções de vaga' }));
    expect(screen.getByText('Que tipo de vaga você precisa?')).toBeInTheDocument();
  });

  it('indicador de etapa discreto acompanha o fluxo real (moto já tem o tipo de vaga decidido)', async () => {
    simularApi({ 'POST /entradas': entradaOk(), '/regioes': { corpo: regioesDeTeste() } });
    abrir();
    expect(screen.queryByRole('navigation', { name: 'Progresso do atendimento' })).not.toBeInTheDocument(); // tela inicial sem indicador
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    expect(screen.getByRole('navigation', { name: 'Progresso do atendimento' })).toHaveTextContent('Etapa 1 de 4');
    fireEvent.click(screen.getByRole('button', { name: 'Carro pequeno' }));
    expect(screen.getByRole('navigation', { name: 'Progresso do atendimento' })).toHaveTextContent('Etapa 2 de 4');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Motocicleta' }));
    await screen.findByTestId('justificativa', {}, espera);
    expect(screen.getByRole('navigation', { name: 'Progresso do atendimento' })).toHaveTextContent('Etapa 3 de 4');
    fireEvent.click(screen.getByRole('button', { name: 'Emitir ticket' }));
    expect(screen.getByRole('navigation', { name: 'Progresso do atendimento' })).toHaveTextContent('Etapa 4 de 4');
  });

  it('recomendação: código da região em destaque, aviso de que não reserva vaga e nenhum tempo de caminhada inventado', async () => {
    simularApi({ 'POST /entradas': entradaOk(), '/regioes': { corpo: regioesDeTeste() } });
    abrir();
    await chegarNaRecomendacao();
    expect(screen.getByText('N3', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/A indicação não reserva vaga/)).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: /Ocupação da região N3/ })).toBeInTheDocument();
    expect(screen.queryByText(/a pé|min|metros/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Emitir ticket' })).toHaveLength(1);
  });

  it('acesso inexistente na URL não abre o atendimento', () => {
    abrir('A_XYZ');
    expect(screen.getByText('Totem sem acesso configurado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Começar' })).not.toBeInTheDocument();
  });
});
