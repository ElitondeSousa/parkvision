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

async function chegarNaRecomendacao(categoria = /Carro pequeno/) {
  fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
  fireEvent.click(screen.getByRole('button', { name: categoria }));
  await screen.findByTestId('justificativa', {}, espera);
}

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
    expect(await screen.findByText('Não foi possível gerar sua recomendação', {}, espera)).toBeInTheDocument();
    expect(screen.getByText(/perdeu a conexão/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('acesso inexistente na URL não abre o atendimento', () => {
    abrir('A_XYZ');
    expect(screen.getByText('Totem sem acesso configurado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Começar' })).not.toBeInTheDocument();
  });
});
