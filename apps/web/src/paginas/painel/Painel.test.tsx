/** Testes do dashboard: indicadores, regiões, tempo real, seleção, simulador e falhas de conexão. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evento, indicadoresDe, recomendacaoDeTeste, regioesDeTeste, renderizarEm, simularApi, socketFalso } from '../../testes/apoio.tsx';
import { Painel } from './Painel.tsx';

vi.mock('socket.io-client', async () => {
  const { socketFalso: s } = await import('../../testes/apoio.tsx');
  return { io: () => s };
});

const estadoParado = { status: 'parado', modo: 'automatico', cenario: null, descricaoCenario: null, velocidade: 60, relogioSimuladoIso: '', decorridoSimuladoSeg: 0, estatisticas: {}, veiculos: { aguardando: 0, estacionados: 0, gerados: 0 }, veiculosSimuladosAtivos: 0, modoDemonstracao: false };
const cenarios = ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, nome: `Cenário ${id}`, descricao: `Descrição do cenário ${id}.`, ocupacaoInicial: 0.3, entradasPorMinuto: 2 }));

function api(extra: Record<string, unknown> = {}, estado: object = estadoParado) {
  const regioes = regioesDeTeste();
  return simularApi({
    '/regioes': { corpo: regioes },
    '/indicadores': { corpo: indicadoresDe(regioes, { veiculosAguardando: 4 }) },
    '/recomendacoes': { corpo: [recomendacaoDeTeste('N3')] },
    '/simulacao': { corpo: estado },
    '/simulacao/cenarios': { corpo: cenarios },
    '/historico': { corpo: [] },
    ...(extra as Record<string, { corpo: unknown }>),
  });
}
const abrir = async () => {
  renderizarEm('/painel', '/painel', <Painel />);
  await screen.findByTestId('kpi-capacidade');
  act(() => socketFalso.disparar('connect'));
};
const emitir = (ev: ReturnType<typeof evento>) => act(() => socketFalso.disparar('evento', ev));
const regiaoNoMapa = (id: string) => screen.getByTestId('mapa-estacionamento').querySelector(`[data-regiao="${id}"]`)!;

beforeEach(() => { socketFalso.limpar(); sessionStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('dashboard administrativo', () => {
  it('carrega os indicadores do backend', async () => {
    api();
    await abrir();
    expect(screen.getByTestId('kpi-capacidade')).toHaveTextContent('1269');
    expect(screen.getByTestId('kpi-entrando')).toHaveTextContent('4');
    expect(screen.getByTestId('kpi-indisponiveis')).toHaveTextContent('0');
    expect(screen.getByTestId('kpi-indisponiveis')).toHaveTextContent('todas operando');
  });

  it('exibe as 10 regiões no mapa e na tabela, e a recomendação mais recente', async () => {
    api();
    await abrir();
    expect(screen.getAllByRole('row')).toHaveLength(11);
    expect(screen.getByTestId('mapa-estacionamento').querySelectorAll('[data-regiao]')).toHaveLength(5); // térreo
    expect(screen.getByTestId('recomendacao-atual')).toHaveTextContent('PV-0042');
    expect(regiaoNoMapa('N3')).toHaveAttribute('data-destino', 'true');
  });

  it('atualiza a ocupação e as movimentações quando chegam eventos em tempo real', async () => {
    api();
    await abrir();
    const n3 = regioesDeTeste().find((r) => r.id === 'N3')!;
    emitir(evento('regiao:ocupacao', { ...n3, ocupadas: 203, livres: 0 }, 'N3'));
    expect(regiaoNoMapa('N3')).toHaveAttribute('data-faixa', 'lotada');
    expect(screen.getByTestId('movimentacoes')).toHaveTextContent('Região N3 lotou');
    expect(within(screen.getByRole('row', { name: /Norte Leste/ })).getByText('Lotada')).toBeInTheDocument();
    emitir(evento('indicadores:atualizados', indicadoresDe(regioesDeTeste(), { capacidadeTotal: 1269, livres: 500, veiculosAguardando: 9 })));
    expect(screen.getByTestId('kpi-entrando')).toHaveTextContent('9');
  });

  it('mostra entradas e recomendações em tempo real e identifica o ambiente de demonstração', async () => {
    api();
    await abrir();
    expect(screen.queryByText(/Ambiente de demonstração/)).not.toBeInTheDocument();
    const ticket = { codigo: 'PV-0100', categoria: 'MOTO', status: 'AGUARDANDO' };
    emitir(evento('veiculo:entrou', { ticket, recomendacao: { ...recomendacaoDeTeste('SS1M', ['n_A_NE', 'n_A_SS1M', 'n_SS1M']), ticketCodigo: 'PV-0100' } }, 'PV-0100', true));
    expect(screen.getByTestId('movimentacoes')).toHaveTextContent('PV-0100 entrou (motocicleta) e foi orientado para SS1M');
    expect(screen.getByTestId('recomendacao-atual')).toHaveTextContent('PV-0100');
    expect(screen.getByText(/Ambiente de demonstração/)).toBeInTheDocument();
    emitir(evento('regiao:fluxo', { ...regioesDeTeste().find((r) => r.id === 'SS1')!, fluxo: { recente: 40, vazaoReferencia: 8, nivel: 'elevado' } }, 'SS1'));
    expect(screen.getByTestId('movimentacoes')).toHaveTextContent('Congestionamento detectado em SS1');
    expect(screen.getByTestId('kpi-congestionadas')).toHaveTextContent('SS1');
  });

  it('seleciona uma região pelo mapa e mostra os detalhes', async () => {
    api();
    await abrir();
    fireEvent.click(regiaoNoMapa('N1'));
    const det = screen.getByTestId('detalhe-regiao');
    expect(det).toHaveTextContent('Norte Oeste');
    expect(det).toHaveTextContent('Capacidade127');
    expect(det).toHaveTextContent('Carro pequeno, Carro grande, SUV ou picape');
    expect(det).toHaveTextContent('Operando');
    expect(det).toHaveTextContent('Fluxo baixo');
  });

  it('controla o simulador pelos endpoints reais, com o token do operador', async () => {
    const { chamadas } = api({ 'POST /simulacao/cenario': { corpo: { ...estadoParado, status: 'rodando', cenario: 'C' } } });
    await abrir();
    fireEvent.change(screen.getByLabelText(/Token do operador/), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    fireEvent.change(screen.getByLabelText('Cenário'), { target: { value: 'C' } });
    expect(screen.getByText('Descrição do cenário C.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar cenário C' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'POST' && c.url === '/api/simulacao/cenario')).toBe(true));
    const pedido = chamadas.find((c) => c.url === '/api/simulacao/cenario')!;
    expect(pedido.corpo).toEqual({ cenario: 'C' });
    expect(pedido.headers['x-operador-token']).toBe('segredo');
  });

  it('com a simulação rodando oferece pausar e encerrar; token errado mostra o erro', async () => {
    const { chamadas } = api({ 'POST /simulacao/pausar': { status: 401, corpo: { erro: { codigo: 'NAO_AUTORIZADO', mensagem: 'x' } } } }, { ...estadoParado, status: 'rodando', cenario: 'B', veiculosSimuladosAtivos: 10 });
    await abrir();
    expect(screen.getByTestId('status-simulacao')).toHaveTextContent('Rodando');
    expect(screen.getByText(/Ambiente de demonstração/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    expect(await screen.findByText(/Token do operador inválido/)).toBeInTheDocument();
    expect(chamadas.some((c) => c.url === '/api/simulacao/pausar')).toBe(true);
    expect(screen.getByRole('button', { name: 'Encerrar' })).toBeInTheDocument();
  });

  it('trata falha de conexão com a API e com o tempo real', async () => {
    simularApi({});
    renderizarEm('/painel', '/painel', <Painel />);
    expect(await screen.findByText('Não foi possível carregar o painel')).toBeInTheDocument();
    expect(screen.getByText(/Sem conexão com o servidor/)).toBeInTheDocument();
    api();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await screen.findByTestId('kpi-capacidade');
    act(() => socketFalso.disparar('disconnect'));
    expect(screen.getByText('Atualização em tempo real interrompida')).toBeInTheDocument();
    expect(screen.getByText('Sem conexão', { selector: 'span' })).toBeInTheDocument();
  });
});
