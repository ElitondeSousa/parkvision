/**
 * Vagas reservadas na web: selos no mapa (ícone + número, não só cor), colunas e detalhe no painel, resumo com mínimos
 * e alertas, ajuste administrativo, simulador pedindo vaga PcD e a página do QR Code com o tipo da vaga.
 */
import { menorCaminho } from '@parkvision/core';
import type { Regiao } from '@parkvision/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acessoPorId, mapa, regiaoDoMapa } from '../mapa/dados.ts';
import { MapaEstacionamento } from '../mapa/MapaEstacionamento.tsx';
import { indicadoresDe, recomendacaoDeTeste, regioesDeTeste, renderizarEm, simularApi, socketFalso } from '../testes/apoio.tsx';
import { Localizador } from './localizador/Localizador.tsx';
import { Painel } from './painel/Painel.tsx';

vi.mock('socket.io-client', async () => {
  const { socketFalso: s } = await import('../testes/apoio.tsx');
  return { io: () => s };
});

/** Mesma proposta da API: N2 2 PcD / 6 idoso, N3 8 / 20, SS1 3 / 11 (planta)... (aqui só as usadas nos testes). */
const RESERVADAS: Record<string, [number, number]> = { N1: [4, 9], N2: [2, 6], N3: [8, 20], S1: [2, 5], S2: [2, 5], SS1: [3, 11], SS2C: [5, 8] };
function comVagas(ocupadasPcd: Record<string, number> = {}): Regiao[] {
  return regioesDeTeste().map((r) => {
    const [pcd, idoso] = RESERVADAS[r.id] ?? [0, 0];
    const ocPcd = ocupadasPcd[r.id] ?? 0;
    return {
      ...r, ocupadas: ocPcd, livres: r.capacidade - ocPcd, fonteVagasReservadas: pcd ? (r.id === 'SS1' || r.id === 'SS2C' ? 'planta' : 'proposta') : 'sem-reserva',
      vagas: {
        COMUM: { capacidade: r.capacidade - pcd - idoso, ocupadas: 0, livres: r.capacidade - pcd - idoso },
        PCD: { capacidade: pcd, ocupadas: ocPcd, livres: pcd - ocPcd },
        IDOSO: { capacidade: idoso, ocupadas: 0, livres: idoso },
      },
    };
  });
}
const estadoParado = { status: 'parado', modo: 'automatico', cenario: null, descricaoCenario: null, velocidade: 60, relogioSimuladoIso: '', decorridoSimuladoSeg: 0, estatisticas: {}, veiculos: { aguardando: 0, estacionados: 0, gerados: 0 }, veiculosSimuladosAtivos: 0, modoDemonstracao: false };
function apiPainel(regioes: Regiao[], extra: Record<string, unknown> = {}) {
  return simularApi({
    '/regioes': { corpo: regioes }, '/indicadores': { corpo: indicadoresDe(regioes) }, '/recomendacoes': { corpo: [recomendacaoDeTeste('N3')] },
    '/simulacao': { corpo: estadoParado }, '/simulacao/cenarios': { corpo: [] }, '/historico': { corpo: [] },
    ...(extra as Record<string, { corpo: unknown }>),
  });
}
const abrirPainel = async () => {
  renderizarEm('/painel', '/painel', <Painel />);
  await screen.findByTestId('kpi-capacidade');
  act(() => socketFalso.disparar('connect'));
};

beforeEach(() => { socketFalso.limpar(); sessionStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('mapa', () => {
  it('mostra selos de vagas PcD e pessoa idosa livres por região, com ícone e número', () => {
    render(<MapaEstacionamento regioes={comVagas({ N2: 2 })} nivel="terreo" />);
    const svg = screen.getByTestId('mapa-estacionamento');
    const n3 = svg.querySelector('[data-regiao="N3"]')!;
    expect(n3).toHaveAttribute('data-vagas-pcd', '8/8');
    expect(n3).toHaveAttribute('data-vagas-idoso', '20/20');
    expect(n3.querySelector('[data-selo-reservada="PCD"]')).toHaveTextContent('8');
    expect(n3.querySelector('[data-selo-reservada="IDOSO"]')).toHaveTextContent('60+20');
    // PcD esgotada em N2: o número aparece (0) riscado, e a descrição acessível diz por extenso
    const n2 = svg.querySelector('[data-regiao="N2"]')!;
    expect(n2.querySelector('[data-selo-reservada="PCD"] text[text-decoration="line-through"]')).toHaveTextContent('0');
    expect(n2.getAttribute('aria-label')).toContain('0 de 2 vagas PcD livres');
    // região sem reservadas não ganha selo
    expect(svg.querySelector('[data-regiao="SS2L"]')).toBeNull(); // (outro nível)
    expect(screen.getByRole('list', { name: 'Legenda do mapa' })).toHaveTextContent('Vagas PcD livres');
    expect(screen.getByRole('list', { name: 'Legenda do mapa' })).toHaveTextContent('Vagas para pessoa idosa livres');
  });

  it('sem dados de ocupação (QR Code) não desenha selos', () => {
    render(<MapaEstacionamento nivel="terreo" />);
    expect(screen.getByTestId('mapa-estacionamento').querySelector('[data-camada="vagas-reservadas"]')).toBeNull();
  });
});

describe('painel administrativo', () => {
  it('tabela com disponibilidade por tipo e detalhe da região com comuns, PcD e pessoa idosa', async () => {
    apiPainel(comVagas({ N2: 1 }));
    await abrirPainel();
    const linha = screen.getByRole('row', { name: /Norte Centro/ });
    expect(within(linha).getAllByRole('cell')[4]).toHaveTextContent('1 / 2');
    expect(within(linha).getAllByRole('cell')[5]).toHaveTextContent('6 / 6');
    expect(within(screen.getByRole('row', { name: /Subsolo 1 Motos/ })).getAllByRole('cell')[4]).toHaveTextContent('—');
    fireEvent.click(within(linha).getByRole('button'));
    expect(screen.getByTestId('detalhe-vagas-PCD')).toHaveTextContent('1 / 2');
    expect(screen.getByTestId('detalhe-vagas-COMUM')).toHaveTextContent('40 / 40');
    expect(screen.getByTestId('detalhe-regiao')).toHaveTextContent('proposta simulada');
  });

  it('resumo: mínimos legais atendidos; abaixo do mínimo mostra alerta', async () => {
    apiPainel(comVagas());
    await abrirPainel();
    const card = screen.getByTestId('vagas-reservadas');
    expect(within(card).getByTestId('total-PCD')).toHaveTextContent('26 livres de 26 · mínimo legal 26');
    expect(within(card).getByTestId('total-IDOSO')).toHaveTextContent('mínimo legal 64');
    expect(within(card).queryByText('Distribuição abaixo do mínimo')).not.toBeInTheDocument();
    // um ajuste (via evento em tempo real) que derruba o total abaixo do mínimo dispara o alerta
    const n3 = comVagas().find((r) => r.id === 'N3')!;
    const reduzida = { ...n3, versao: 9, vagas: { ...n3.vagas!, PCD: { capacidade: 1, ocupadas: 0, livres: 1 }, COMUM: { ...n3.vagas!.COMUM, capacidade: n3.vagas!.COMUM.capacidade + 7 } } };
    act(() => socketFalso.disparar('evento', { id: 'e1', tipo: 'regiao:status', ocorridoEm: new Date().toISOString(), entidadeId: 'N3', simulado: false, sequencia: 1, dados: reduzida }));
    expect(within(card).getByText('Distribuição abaixo do mínimo')).toBeInTheDocument();
    expect(within(card).getByTestId('total-PCD')).toHaveTextContent('Abaixo do mínimo');
    expect(screen.getByTestId('movimentacoes')).toHaveTextContent('Vagas reservadas da região N3 ajustadas');
  });

  it('ajuste administrativo envia ao backend com o token e mostra a recusa quando inconsistente', async () => {
    const { chamadas } = apiPainel(comVagas({ N2: 2 }), {
      'PATCH /regioes/:id/vagas-reservadas': { status: 409, corpo: { erro: { codigo: 'TIPO_VAGA_INCOMPATIVEL', mensagem: 'Há 2 vagas PcD ocupadas agora; não dá para reduzir para 0' } } },
    });
    sessionStorage.setItem('pv-token-operador', 'segredo');
    await abrirPainel();
    const card = screen.getByTestId('vagas-reservadas');
    fireEvent.click(within(card).getByText('Ajustar vagas de uma região'));
    fireEvent.change(within(card).getByLabelText('Região'), { target: { value: 'N2' } });
    expect(within(card).getByLabelText('Vagas PcD')).toHaveValue('2');
    fireEvent.change(within(card).getByLabelText('Vagas PcD'), { target: { value: '0' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Salvar vagas reservadas' }));
    expect(await within(card).findByText('Ajuste recusado')).toBeInTheDocument();
    expect(within(card).getByText(/2 vagas PcD ocupadas/)).toBeInTheDocument();
    const pedido = chamadas.find((c) => c.metodo === 'PATCH')!;
    expect(pedido.url).toBe('/api/regioes/N2/vagas-reservadas');
    expect(pedido.corpo).toEqual({ capacidadePcd: 0, capacidadeIdoso: 6 });
    expect(pedido.headers['x-operador-token']).toBe('segredo');
  });

  it('simulador: adicionar veículo pedindo vaga PcD', async () => {
    const { chamadas } = apiPainel(comVagas(), { 'POST /simulacao/iniciar': { corpo: { ...estadoParado, status: 'rodando' } }, 'POST /simulacao/eventos': { corpo: {} } });
    sessionStorage.setItem('pv-token-operador', 'segredo');
    await abrirPainel();
    fireEvent.change(screen.getByLabelText('Tipo de vaga do veículo adicionado'), { target: { value: 'PCD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar veículo' }));
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/simulacao/eventos')).toBe(true));
    expect(chamadas.find((c) => c.url === '/api/simulacao/eventos')!.corpo).toEqual({ acao: 'entrada', categoria: 'CARRO_PEQUENO', tipoVaga: 'PCD' });
  });
});

describe('QR Code com vaga reservada', () => {
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
  const rota = menorCaminho(mapa, acessoPorId['A_ROT']!.no, regiaoDoMapa['N2']!.noAcesso)!;
  const n2 = comVagas().find((r) => r.id === 'N2')!;
  const resposta = {
    ticket: { codigo: 'PV-0077', entradaEm: '2026-11-14T15:00:00.000Z', status: 'AGUARDANDO', categoria: 'CARRO_PEQUENO', estacionadoEm: null, saidaEm: null, simulado: false, tipoVaga: 'PCD' },
    regiao: null, recomendada: n2,
    orientacao: ['O estacionamento ainda não foi confirmado. A região recomendada foi N2 (Norte Centro).', 'Procure as vagas sinalizadas: vaga pcd (credencial válida obrigatória no veículo).'],
    acesso: { id: 'A_ROT', nome: 'Entrada do pátio norte (rotatória)' },
    rota: { nos: rota.nos, custo: rota.custo },
    caminhoPedestre: { situacao: 'mesmo-nivel', entrada: 'Entrada da C&A (lado norte)', distancia: 70, validado: false, texto: 'Entrada de pedestres mais próxima: Entrada da C&A (lado norte), no mesmo nível. A acessibilidade do caminho ainda não foi validada na planta.' },
  };

  it('mostra a categoria da vaga, a credencial, o caminho a pé sem afirmar acessibilidade e o pino com o tipo', async () => {
    simularApi({ '/localizador/:token': { corpo: resposta } });
    renderizarEm(`/t/${TOKEN}`, '/t/:token', <Localizador />);
    expect(await screen.findByTestId('regiao-destino')).toHaveTextContent('Norte Centro');
    expect(screen.getByTestId('selo-tipo-vaga')).toHaveAttribute('data-tipo', 'PCD');
    expect(screen.getByTestId('info-vaga-reservada')).toHaveTextContent('credencial');
    expect(screen.getByTestId('caminho-pedestre')).toHaveTextContent('ainda não foi validada');
    expect(screen.getByTestId('info-vaga-reservada')).not.toHaveTextContent(/rota acessível|caminho acessível/i);
    expect(screen.getByTestId('pino-destino')).toHaveTextContent('Vaga PcD');
    expect(screen.getByTestId('mapa-estacionamento').querySelector('[data-camada="rota"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar detalhes' }));
    expect(screen.getByTestId('orientacao')).toHaveTextContent(/vagas sinalizadas para PcD/);
  });

  it('ticket comum não mostra nada de vaga reservada', async () => {
    simularApi({ '/localizador/:token': { corpo: { ...resposta, ticket: { ...resposta.ticket, tipoVaga: 'COMUM' }, caminhoPedestre: null } } });
    renderizarEm(`/t/${TOKEN}`, '/t/:token', <Localizador />);
    await screen.findByTestId('regiao-destino');
    expect(screen.queryByTestId('selo-tipo-vaga')).not.toBeInTheDocument();
    expect(screen.queryByTestId('info-vaga-reservada')).not.toBeInTheDocument();
  });
});
