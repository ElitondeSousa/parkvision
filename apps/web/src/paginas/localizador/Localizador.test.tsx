/**
 * Testes da navegação do motorista (QR Code): ticket a caminho (rota até a região recomendada), estacionado (região
 * REGISTRADA, sem rota), já saiu, inexistente, inválido, sem conexão; painel inferior e botões do mapa.
 */
import { menorCaminho } from '@parkvision/core';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acessoPorId, mapa, regiaoDoMapa } from '../../mapa/dados.ts';
import { regioesDeTeste, renderizarEm, simularApi } from '../../testes/apoio.tsx';
import { Localizador } from './Localizador.tsx';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const regioes = regioesDeTeste();
const reg = (id: string) => regioes.find((r) => r.id === id)!;
const rotaN3 = menorCaminho(mapa, acessoPorId['A_NE']!.no, regiaoDoMapa['N3']!.noAcesso)!;
const resposta = (status: string, extra: object = {}) => ({
  ticket: { codigo: 'PV-0042', entradaEm: '2026-11-13T15:00:00.000Z', status, categoria: 'CARRO_GRANDE', estacionadoEm: status === 'AGUARDANDO' ? null : '2026-11-13T15:04:00.000Z', saidaEm: status === 'SAIU' ? '2026-11-13T17:30:00.000Z' : null, simulado: false },
  regiao: status === 'AGUARDANDO' ? null : reg('S1'),
  recomendada: reg('N3'), // recomendada ≠ registrada de propósito
  orientacao: ['Seu carro está na região S1 (Sul Oeste).', 'Bolsões a oeste do retorno de embarque (frente Renner / Centauro)'],
  acesso: { id: 'A_NE', nome: 'Acesso nordeste' },
  rota: status === 'AGUARDANDO' ? { nos: rotaN3.nos, custo: rotaN3.custo } : null,
  ...extra,
});
const abrir = (token = TOKEN) => renderizarEm(`/t/${token}`, '/t/:token', <Localizador />);

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('navegação do motorista — estacionado', () => {
  it('mostra código, categoria, horário e a região registrada na confirmação', async () => {
    const { chamadas } = simularApi({ '/localizador/:token': { corpo: resposta('ESTACIONADO') } });
    abrir();
    expect(await screen.findByTestId('regiao-registrada')).toHaveTextContent('Sul Oeste');
    expect(chamadas[0]!.url).toBe(`/api/localizador/${TOKEN}`);
    expect(screen.getByText('Encontre seu veículo')).toBeInTheDocument();
    expect(screen.getAllByTestId('codigo-ticket')[0]).toHaveTextContent('PV-0042');
    expect(screen.getByText(/Carro grande, SUV ou picape/)).toBeInTheDocument();
    expect(screen.getByText(/Estacionamento confirmado às/)).toBeInTheDocument();
    expect(screen.getByTestId('orientacao')).toHaveTextContent('Seu carro está na região S1');
  });

  it('o mapa destaca a região efetivamente ocupada (não a recomendada) e não desenha rota', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('ESTACIONADO') } });
    abrir();
    await screen.findByTestId('regiao-registrada');
    const mapaSvg = screen.getByTestId('mapa-estacionamento');
    expect(mapaSvg.querySelector('[data-destino="true"]')).toHaveAttribute('data-regiao', 'S1');
    expect(mapaSvg.querySelector('[data-regiao="N3"]')).not.toHaveAttribute('data-destino');
    expect(mapaSvg.querySelector('[data-regiao="N3"]')).toHaveAttribute('opacity', '0.35');
    expect(mapaSvg.querySelector('[data-camada="rota"]')).toBeNull();
    expect(screen.getByTestId('pino-destino')).toHaveTextContent('S1');
    expect(screen.queryByRole('button', { name: 'Ver rota inteira' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Centralizar no veículo' })).toBeInTheDocument();
  });
});

describe('navegação do motorista — a caminho', () => {
  it('destaca a região recomendada e desenha a rota pelo grafo a partir do acesso de entrada', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('AGUARDANDO') } });
    abrir();
    expect(await screen.findByTestId('regiao-destino')).toHaveTextContent(reg('N3').nome);
    expect(screen.getByText('Estacionamento ainda não confirmado')).toBeInTheDocument();
    expect(screen.getByText(/não reserva vaga/)).toBeInTheDocument();
    expect(screen.getByText(/Partida: Acesso nordeste/)).toBeInTheDocument();
    const mapaSvg = screen.getByTestId('mapa-estacionamento');
    expect(mapaSvg.querySelector('[data-destino="true"]')).toHaveAttribute('data-regiao', 'N3');
    const rota = mapaSvg.querySelector('[data-camada="rota"]');
    expect(rota).not.toBeNull();
    expect(rota!.getAttribute('data-nos')!.split(' ')[0]).toBe(rotaN3.nos[0]);
    expect(screen.getByTestId('partida-rota')).toBeInTheDocument();
    expect(screen.getByTestId('pino-destino')).toHaveTextContent('N3');
    // nada de distância ou tempo inventados
    expect(screen.queryByText(/\d+\s?(m|min|km)\b/)).not.toBeInTheDocument();
  });

  it('a rota no mapa usa só nós do grafo (curvas arredondadas, sem atalhos em linha reta)', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('AGUARDANDO') } });
    abrir();
    await screen.findByTestId('regiao-destino');
    const nos = screen.getByTestId('mapa-estacionamento').querySelector('[data-camada="rota"]')!.getAttribute('data-nos')!.split(' ');
    for (const id of nos) expect(rotaN3.nos).toContain(id);
    const traco = screen.getByTestId('mapa-estacionamento').querySelector('.gp-rota-traco')!;
    if (nos.length > 2) expect(traco.getAttribute('d')).toMatch(/Q/);
  });

  it('painel inferior: começa recolhido e expande com os passos e o ticket', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('AGUARDANDO') } });
    abrir();
    await screen.findByTestId('regiao-destino');
    const alca = screen.getByRole('button', { name: 'Mostrar detalhes' });
    expect(alca).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('painel-navegacao')).toHaveAttribute('data-expandido', 'false');
    fireEvent.click(alca);
    expect(screen.getByRole('button', { name: 'Recolher detalhes' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Como chegar')).toBeVisible();
    expect(screen.getByTestId('orientacao').querySelectorAll('li').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('codigo-ticket')[0]).toHaveTextContent('PV-0042');
  });

  it('botões do mapa: ver rota inteira e centralizar no destino', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('AGUARDANDO') } });
    abrir();
    await screen.findByTestId('regiao-destino');
    expect(screen.getByRole('button', { name: 'Ver rota inteira' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Centralizar no destino' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver rota inteira' }));
    expect(screen.getByTestId('mapa-estacionamento')).toBeInTheDocument();
  });

  it('demonstração do trajeto é rotulada e some sozinha', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('AGUARDANDO') } });
    abrir();
    await screen.findByTestId('regiao-destino');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar detalhes' }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: 'Ver trajeto em demonstração' }));
    act(() => { vi.advanceTimersByTime(10); });
    expect(screen.getByText(/Demonstração do trajeto — não é a sua localização/)).toBeInTheDocument();
    expect(screen.getByTestId('veiculo-simulado')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(30000); });
    expect(screen.queryByText(/Demonstração do trajeto/)).not.toBeInTheDocument();
  });

  it('sem rota disponível: avisa e mantém as orientações em texto', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('AGUARDANDO', { rota: null }) } });
    abrir();
    await screen.findByTestId('regiao-destino');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar detalhes' }));
    expect(screen.getByText(/Rota indisponível no momento/)).toBeInTheDocument();
    expect(screen.getByTestId('orientacao')).toHaveTextContent('Seu carro está na região S1');
    expect(screen.getByTestId('mapa-estacionamento').querySelector('[data-camada="rota"]')).toBeNull();
  });
});

describe('navegação do motorista — encerrado e erros', () => {
  it('veículo que já saiu: informa a saída e não mostra o mapa', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('SAIU') } });
    abrir();
    expect(await screen.findByText('Este veículo já saiu')).toBeInTheDocument();
    expect(screen.getByText(/não há localização ativa/)).toBeInTheDocument();
    expect(screen.queryByTestId('mapa-estacionamento')).not.toBeInTheDocument();
  });

  it('ticket cancelado: sem mapa', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta('CANCELADO', { regiao: null }) } });
    abrir();
    expect(await screen.findByText('Ticket cancelado')).toBeInTheDocument();
    expect(screen.queryByTestId('mapa-estacionamento')).not.toBeInTheDocument();
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

  it('sem conexão: permite tentar de novo', async () => {
    simularApi({});
    abrir();
    expect(await screen.findByText('Sem conexão com o Golden Park')).toBeInTheDocument();
    simularApi({ '/localizador/:token': { corpo: resposta('ESTACIONADO') } });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByTestId('regiao-registrada')).toBeInTheDocument();
  });
});
