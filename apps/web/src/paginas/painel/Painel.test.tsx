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
    // vagas livres como número dominante, "de 1.269" (formato brasileiro), e a barra de ocupação geral
    expect(screen.getByTestId('kpi-capacidade')).toHaveTextContent('de 1.269');
    expect(screen.getByTestId('kpi-livres')).toHaveTextContent(`Vagas livres${indicadoresDe(regioesDeTeste()).livres}`);
    expect(screen.getByRole('meter', { name: 'Taxa de ocupação geral' })).toHaveAttribute('aria-valuemax', '1269');
    expect(screen.getByTestId('kpi-entrando')).toHaveTextContent('4');
    expect(screen.getByTestId('kpi-indisponiveis')).toHaveTextContent('0');
    expect(screen.getByTestId('kpi-indisponiveis')).toHaveTextContent('todas operando');
  });

  it('navegação superior por âncoras: todas as seções ficam na página, sem barra lateral', async () => {
    api();
    await abrir();
    const nav = screen.getByRole('navigation', { name: 'Seções do painel' });
    for (const [rotulo, id] of [['Visão geral', 'visao-geral'], ['Mapa', 'mapa'], ['Regiões', 'regioes'], ['Tickets', 'tickets'], ['Simulador', 'simulador'], ['Vagas reservadas', 'reservadas']]) {
      expect(within(nav).getByRole('link', { name: rotulo })).toHaveAttribute('href', `#${id}`);
      expect(document.getElementById(id!)).not.toBeNull();
    }
    expect(screen.getByRole('link', { name: 'Consultar ticket' })).toHaveAttribute('href', '#tickets');
    // o menu do celular abre e fecha pelo mesmo botão, com estado acessível
    const botaoMenu = screen.getByRole('button', { name: 'Abrir menu' });
    fireEvent.click(botaoMenu);
    expect(botaoMenu).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('navigation', { name: 'Seções do painel' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar menu' }));
    expect(screen.getAllByRole('navigation', { name: 'Seções do painel' })).toHaveLength(1);
  });

  it('exibe as 10 regiões no mapa e na tabela, e a recomendação mais recente', async () => {
    api();
    await abrir();
    expect(screen.getAllByRole('row')).toHaveLength(11);
    expect(within(screen.getByRole('row', { name: /Norte Leste/ })).getAllByRole('cell')[3]).toHaveTextContent('122 de 203');
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
    expect(screen.getByRole('button', { name: 'Encerrar (mantém os dados simulados)' })).toBeInTheDocument();
  });

  it('controles simplificados: iniciar, adicionar veículo, pico e tranquilo usam os endpoints reais', async () => {
    const rodando = { ...estadoParado, status: 'rodando' };
    const { chamadas } = api({
      'POST /simulacao/iniciar': { corpo: rodando }, 'POST /simulacao/eventos': { corpo: {} }, 'POST /simulacao/cenario': { corpo: rodando },
    });
    sessionStorage.setItem('pv-token-operador', 'segredo');
    await abrir();
    for (const nome of ['Iniciar', 'Adicionar veículo', 'Simular horário de pico', 'Simular estacionamento tranquilo', 'Reiniciar']) {
      expect(screen.getByRole('button', { name: nome })).toBeInTheDocument();
    }
    // adicionar com a simulação parada: liga o relógio sem chegadas automáticas e registra UMA entrada
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar veículo' }));
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/simulacao/eventos')).toBe(true));
    const iniciar = chamadas.find((c) => c.url === '/api/simulacao/iniciar')!;
    expect((iniciar.corpo as { config: { entradasPorMinuto: number } }).config.entradasPorMinuto).toBe(0);
    expect(chamadas.find((c) => c.url === '/api/simulacao/eventos')!.corpo).toEqual({ acao: 'entrada' });
    fireEvent.click(screen.getByRole('button', { name: 'Simular horário de pico' }));
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/simulacao/cenario')).toBe(true));
    expect((chamadas.find((c) => c.url === '/api/simulacao/cenario')!.corpo as { cenario: string }).cenario).toBe('B');
  });

  it('reiniciar pede confirmação antes de apagar os dados simulados', async () => {
    api({}, { ...estadoParado, veiculosSimuladosAtivos: 3 });
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }));
    expect(screen.getByText(/Dados reais e ajustes do operador são mantidos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apagar dados simulados' })).toBeInTheDocument();
  });

  it('veículo simulado que entra percorre a rota no mapa (só visual); veículo real não é animado', async () => {
    api();
    await abrir();
    const mapa = () => screen.getByTestId('mapa-estacionamento');
    emitir(evento('veiculo:entrou', { ticket: { codigo: 'PV-0200', categoria: 'CARRO_GRANDE', status: 'AGUARDANDO', acessoId: 'A_NE' }, recomendacao: recomendacaoDeTeste('N3') }, 'PV-0200', false));
    expect(mapa().querySelector('[data-testid="veiculo-simulado"]')).toBeNull();
    emitir(evento('veiculo:entrou', { ticket: { codigo: 'PV-0201', categoria: 'MOTO', status: 'AGUARDANDO', acessoId: 'A_NE' }, recomendacao: recomendacaoDeTeste('N3') }, 'PV-0201', true));
    const carro = mapa().querySelector('[data-testid="veiculo-simulado"]');
    expect(carro).not.toBeNull();
    expect(carro).toHaveAttribute('data-categoria', 'MOTO');
    // a ocupação não muda por causa da animação
    expect(within(screen.getByRole('row', { name: /Norte Leste/ })).queryByText('Lotada')).not.toBeInTheDocument();
  });

  it('com movimento reduzido não anima os veículos', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    api();
    await abrir();
    emitir(evento('veiculo:entrou', { ticket: { codigo: 'PV-0202', categoria: 'MOTO', status: 'AGUARDANDO', acessoId: 'A_NE' }, recomendacao: recomendacaoDeTeste('N3') }, 'PV-0202', true));
    expect(screen.getByTestId('mapa-estacionamento').querySelector('[data-testid="veiculo-simulado"]')).toBeNull();
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
