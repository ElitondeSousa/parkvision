/** Testes do localizador: ticket válido, inexistente, inválido, sem confirmação, já saiu; destaque da região REGISTRADA. */
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { regioesDeTeste, renderizarEm, simularApi } from '../../testes/apoio.tsx';
import { Localizador } from './Localizador.tsx';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const regioes = regioesDeTeste();
const reg = (id: string) => regioes.find((r) => r.id === id)!;
const resposta = (status: string, extra: object = {}) => ({
  ticket: { codigo: 'PV-0042', entradaEm: '2026-11-13T15:00:00.000Z', status, categoria: 'CARRO_GRANDE', estacionadoEm: status === 'AGUARDANDO' ? null : '2026-11-13T15:04:00.000Z', saidaEm: status === 'SAIU' ? '2026-11-13T17:30:00.000Z' : null },
  regiao: status === 'AGUARDANDO' ? null : reg('S1'),
  recomendada: reg('N3'), // recomendada ≠ registrada de propósito
  orientacao: ['Seu carro está na região S1 (Sul Oeste).', 'Bolsões a oeste do retorno de embarque (frente Renner / Centauro)'],
  ...extra,
});
const abrir = (token = TOKEN) => renderizarEm(`/t/${token}`, '/t/:token', <Localizador />);

afterEach(() => vi.unstubAllGlobals());

describe('localizador de veículo', () => {
  it('ticket válido: mostra código, categoria, horário e a região registrada na confirmação', async () => {
    const { chamadas } = simularApi({ '/localizador/:token': { corpo: resposta('ESTACIONADO') } });
    abrir();
    expect(await screen.findByTestId('regiao-registrada')).toHaveTextContent('Sul Oeste');
    expect(chamadas[0]!.url).toBe(`/api/localizador/${TOKEN}`);
    expect(screen.getAllByTestId('codigo-ticket')[0]).toHaveTextContent('PV-0042');
    expect(screen.getByText(/Carro grande, SUV ou picape/)).toBeInTheDocument();
    expect(screen.getByText(/Estacionamento confirmado às/)).toBeInTheDocument();
    expect(screen.getByTestId('orientacao')).toHaveTextContent('Seu carro está na região S1');
  });

  it('o mapa destaca a região efetivamente ocupada, não a recomendada', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('ESTACIONADO') } });
    abrir();
    await screen.findByTestId('regiao-registrada');
    const mapa = screen.getByTestId('mapa-estacionamento');
    expect(mapa.querySelector('[data-destino="true"]')).toHaveAttribute('data-regiao', 'S1');
    fireEvent.click(screen.getByRole('button', { name: 'Ver nível inteiro' }));
    expect(mapa.querySelector('[data-regiao="N3"]')).not.toHaveAttribute('data-destino');
    expect(mapa.querySelector('[data-regiao="N3"]')).toHaveAttribute('opacity', '0.35');
  });

  it('ticket inexistente: mensagem clara, sem dados de outros tickets', async () => {
    simularApi({ '/localizador/:token': { status: 404, corpo: { erro: { codigo: 'TICKET_NAO_ENCONTRADO', mensagem: 'Ticket não encontrado.' } } } });
    abrir();
    expect(await screen.findByText('Ticket não encontrado')).toBeInTheDocument();
    expect(screen.queryByTestId('mapa-estacionamento')).not.toBeInTheDocument();
  });

  it('token com formato inválido nem consulta a API', () => {
    const { fetchFalso } = simularApi({});
    abrir('abc<script>');
    expect(screen.getByText('QR Code inválido')).toBeInTheDocument();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('ticket sem estacionamento confirmado: não mostra localização nem destaca a recomendada', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('AGUARDANDO') } });
    abrir();
    expect(await screen.findByText('Estacionamento ainda não confirmado')).toBeInTheDocument();
    expect(screen.getByText(/a indicação não confirma onde o carro ficou/)).toBeInTheDocument();
    expect(screen.queryByTestId('mapa-estacionamento')).not.toBeInTheDocument();
  });

  it('veículo que já saiu: informa a saída e não mostra o mapa', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('SAIU') } });
    abrir();
    expect(await screen.findByText('Este veículo já saiu')).toBeInTheDocument();
    expect(screen.queryByTestId('mapa-estacionamento')).not.toBeInTheDocument();
  });

  it('sem conexão: permite tentar de novo', async () => {
    simularApi({});
    abrir();
    expect(await screen.findByText('Sem conexão com o ParkVision')).toBeInTheDocument();
    simularApi({ '/localizador/:token': { corpo: resposta('ESTACIONADO') } });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByTestId('regiao-registrada')).toBeInTheDocument();
  });
});
