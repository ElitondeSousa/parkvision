/** Etapa 4 — localizador ao vivo, falha do QR Code e identificação do ambiente de demonstração no totem. */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import QRCode from 'qrcode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evento, recomendacaoDeTeste, regioesDeTeste, renderizarEm, simularApi, socketFalso } from '../testes/apoio.tsx';
import { Localizador } from './localizador/Localizador.tsx';
import { Totem } from './totem/Totem.tsx';

vi.mock('socket.io-client', async () => {
  const { socketFalso: s } = await import('../testes/apoio.tsx');
  return { io: () => s };
});

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const regioes = regioesDeTeste();
const localizador = (status: string) => ({
  ticket: { codigo: 'PV-0042', entradaEm: '2026-11-13T15:00:00.000Z', status, categoria: 'CARRO_PEQUENO', estacionadoEm: status === 'ESTACIONADO' ? '2026-11-13T15:05:00.000Z' : null, saidaEm: null, simulado: true },
  regiao: status === 'ESTACIONADO' ? regioes.find((r) => r.id === 'S2') : null,
  recomendada: regioes.find((r) => r.id === 'N3'),
  orientacao: ['Seu carro está na região S2 (Sul Leste).'],
});

beforeEach(() => socketFalso.limpar());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('localizador ao vivo', () => {
  it('quando o estacionamento é confirmado, a página mostra a região sem recarregar', async () => {
    let status = 'AGUARDANDO';
    simularApi({ '/localizador/:token': () => ({ corpo: localizador(status) }) });
    renderizarEm(`/t/${TOKEN}`, '/t/:token', <Localizador />);
    expect(await screen.findByText('Estacionamento ainda não confirmado')).toBeInTheDocument();
    await waitFor(() => expect(socketFalso.ouvintes.get('ticket:atualizado')?.length).toBeGreaterThan(0)); // assinou o próprio ticket
    act(() => socketFalso.disparar('connect'));
    expect(screen.getByTestId('ao-vivo')).toHaveTextContent('se atualiza sozinha');
    expect(screen.getByText('Demonstração')).toBeInTheDocument();
    status = 'ESTACIONADO';
    act(() => socketFalso.disparar('ticket:atualizado', evento('ticket:atualizado', { codigo: 'PV-0042', status: 'ESTACIONADO', regiaoRecomendadaId: 'N3', regiaoEstacionadaId: 'S2' }, 'PV-0042')));
    expect(await screen.findByTestId('regiao-registrada')).toHaveTextContent('Sul Leste');
    expect(screen.getByTestId('mapa-estacionamento').querySelector('[data-destino="true"]')).toHaveAttribute('data-regiao', 'S2');
  });
});

describe('totem', () => {
  const entrada = { status: 201, corpo: { ticket: { codigo: 'PV-0042', categoria: 'CARRO_PEQUENO', entradaEm: '2026-11-13T15:00:00.000Z', status: 'AGUARDANDO', regiaoRecomendadaId: 'N3' }, recomendacao: recomendacaoDeTeste('N3'), qrUrl: `http://localhost:5173/t/${TOKEN}` } };

  it('no modo demonstração identifica o ambiente na tela e no ticket', async () => {
    simularApi({ '/saude': { corpo: { ok: true, banco: 'ok', modoDemonstracao: true } }, 'POST /entradas': entrada, '/regioes': { corpo: regioes } });
    renderizarEm('/totem?acesso=A_NE', '/totem', <Totem />);
    expect(await screen.findByTestId('totem-demonstracao')).toHaveTextContent('Ambiente de demonstração');
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Carro pequeno' }));
    fireEvent.click(screen.getByRole('button', { name: /^Vaga comum/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir ticket' }, { timeout: 4000 }));
    expect(screen.getByText('Demonstração: ticket sem validade')).toBeInTheDocument();
  });

  it('se o QR Code não puder ser gerado, o ticket orienta usar o código no atendimento', async () => {
    vi.spyOn(QRCode, 'toString').mockRejectedValue(new Error('falha'));
    simularApi({ 'POST /entradas': entrada, '/regioes': { corpo: regioes } });
    renderizarEm('/totem?acesso=A_NE', '/totem', <Totem />);
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Carro pequeno' }));
    fireEvent.click(screen.getByRole('button', { name: /^Vaga comum/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir ticket' }, { timeout: 4000 }));
    expect(await screen.findByTestId('qr-falha')).toHaveTextContent('QR Code indisponível');
    expect(screen.getByText(/informe o código PV-0042 no atendimento/)).toBeInTheDocument();
  });
});
