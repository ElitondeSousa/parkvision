/**
 * Etapa 4 — integração do painel: reconexão recupera o estado do backend, eventos fora de ordem e repetidos,
 * operação de tickets (confirmação, região lotada → nova recomendação, saída).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evento, indicadoresDe, recomendacaoDeTeste, regioesDeTeste, renderizarEm, simularApi, socketFalso } from '../../testes/apoio.tsx';
import { Painel } from './Painel.tsx';

vi.mock('socket.io-client', async () => {
  const { socketFalso: s } = await import('../../testes/apoio.tsx');
  return { io: () => s };
});

const estado = { status: 'parado', modo: 'automatico', cenario: null, descricaoCenario: null, velocidade: 60, relogioSimuladoIso: '', decorridoSimuladoSeg: 0, estatisticas: {}, veiculos: { aguardando: 0, estacionados: 0, gerados: 0 }, veiculosSimuladosAtivos: 0, modoDemonstracao: false };
const ticketBase = { codigo: 'PV-0042', categoria: 'CARRO_PEQUENO', acessoId: 'A_NE', placa: null, entradaEm: '2026-11-13T15:00:00.000Z', regiaoRecomendadaId: 'N3', regiaoEstacionadaId: null, estacionadoEm: null, saidaEm: null, status: 'AGUARDANDO' };

function rotas(regioes = regioesDeTeste(), extra: Record<string, unknown> = {}, historico: unknown[] = []) {
  return simularApi({
    '/regioes': { corpo: regioes },
    '/indicadores': { corpo: indicadoresDe(regioes) },
    '/recomendacoes': { corpo: [recomendacaoDeTeste('N3')] },
    '/simulacao': { corpo: estado },
    '/simulacao/cenarios': { corpo: [] },
    '/historico': { corpo: historico },
    ...(extra as Record<string, { corpo: unknown }>),
  });
}
const abrir = async () => {
  renderizarEm('/painel', '/painel', <Painel />);
  await screen.findByTestId('kpi-capacidade');
  act(() => socketFalso.disparar('connect'));
};
const noMapa = (id: string) => screen.getByTestId('mapa-estacionamento').querySelector(`[data-regiao="${id}"]`)!;
const emitir = (ev: ReturnType<typeof evento>) => act(() => socketFalso.disparar('evento', ev));

beforeEach(() => { socketFalso.limpar(); sessionStorage.clear(); sessionStorage.setItem('pv-token-operador', 'segredo'); });
afterEach(() => vi.unstubAllGlobals());

describe('sincronização com o backend', () => {
  it('ao reconectar, busca o estado atual no backend (não depende dos eventos perdidos)', async () => {
    rotas();
    await abrir();
    act(() => socketFalso.disparar('disconnect'));
    expect(screen.getByText('Atualização em tempo real interrompida')).toBeInTheDocument();
    // durante a queda: N3 lotou e um carro estacionou (eventos perdidos)
    const lotada = regioesDeTeste({ N3: { ocupadas: 203, livres: 0, versao: 9 } });
    rotas(lotada, {}, [{ id: 'estacionou-PV-0099', tipo: 'ESTACIONOU', quando: '2026-11-13T15:40:00.000Z', ticketCodigo: 'PV-0099', regiaoId: 'N3', categoria: 'CARRO_PEQUENO', simulado: false }]);
    act(() => socketFalso.disparar('connect'));
    await waitFor(() => expect(noMapa('N3')).toHaveAttribute('data-faixa', 'lotada'));
    expect(screen.getByTestId('movimentacoes')).toHaveTextContent('PV-0099 estacionou em N3');
    expect(screen.queryByText('Atualização em tempo real interrompida')).not.toBeInTheDocument();
  });

  it('ignora evento de região mais antigo que o já aplicado (fora de ordem)', async () => {
    rotas();
    await abrir();
    const n3 = regioesDeTeste().find((r) => r.id === 'N3')!;
    emitir(evento('regiao:ocupacao', { ...n3, ocupadas: 203, livres: 0, versao: 5 }, 'N3'));
    emitir(evento('regiao:ocupacao', { ...n3, ocupadas: 150, livres: 53, versao: 4 }, 'N3')); // chegou atrasado
    expect(noMapa('N3')).toHaveAttribute('data-faixa', 'lotada');
  });

  it('evento repetido (mesmo id) e indicadores atrasados não alteram a tela duas vezes', async () => {
    rotas();
    await abrir();
    const ticket = { ...ticketBase, codigo: 'PV-0100' };
    const ev = evento('veiculo:entrou', { ticket, recomendacao: { ...recomendacaoDeTeste('N3'), ticketCodigo: 'PV-0100' } }, 'PV-0100', false);
    emitir(ev); emitir(ev);
    expect(within(screen.getByTestId('movimentacoes')).getAllByText(/PV-0100 entrou/)).toHaveLength(1);
    const novo = evento('indicadores:atualizados', indicadoresDe(regioesDeTeste(), { veiculosAguardando: 7 }));
    const velho = { ...evento('indicadores:atualizados', indicadoresDe(regioesDeTeste(), { veiculosAguardando: 2 })), sequencia: novo.sequencia - 1 };
    emitir(novo); emitir(velho);
    expect(screen.getByTestId('kpi-entrando')).toHaveTextContent('7');
  });
});

describe('operação de tickets', () => {
  it('região lotou antes da confirmação: recusa, pede nova recomendação e confirma na nova região', async () => {
    let status = 'AGUARDANDO', recomendada = 'N3', estacionada: string | null = null;
    const { chamadas } = rotas(regioesDeTeste(), {
      'GET /tickets/:codigo': () => ({ corpo: { ticket: { ...ticketBase, status, regiaoRecomendadaId: recomendada, regiaoEstacionadaId: estacionada }, simulado: false, recomendacoes: [] } }),
      'POST /tickets/:codigo/estacionar': (init?: RequestInit) => {
        const { regiaoId } = JSON.parse(String(init!.body));
        if (regiaoId === 'N3') return { status: 409, corpo: { erro: { codigo: 'REGIAO_LOTADA', mensagem: 'Região N3 está lotada' } } };
        status = 'ESTACIONADO'; estacionada = regiaoId;
        return { corpo: { ticket: {}, regiao: {} } };
      },
      'POST /tickets/:codigo/recomendacao': () => { recomendada = 'N2'; return { corpo: { ticket: {}, recomendacao: recomendacaoDeTeste('N2'), motivo: 'x' } }; },
      'POST /tickets/:codigo/saida': () => { status = 'SAIU'; return { corpo: { ticket: {}, regiao: {} } }; },
    });
    await abrir();
    const caixa = screen.getByTestId('operacao-ticket');
    fireEvent.change(within(caixa).getByLabelText('Código do ticket'), { target: { value: 'pv-0042' } });
    fireEvent.click(within(caixa).getByRole('button', { name: 'Consultar' }));
    expect(await within(caixa).findByText('Aguardando confirmação')).toBeInTheDocument();

    fireEvent.click(within(caixa).getByRole('button', { name: 'Confirmar estacionamento' }));
    expect(await within(caixa).findByText('Região N3 está lotada')).toBeInTheDocument();
    fireEvent.click(within(caixa).getByRole('button', { name: 'Solicitar nova recomendação' }));
    expect(await within(caixa).findByText('Nova recomendação: região N2')).toBeInTheDocument();

    fireEvent.click(within(caixa).getByRole('button', { name: 'Confirmar estacionamento' }));
    expect(await within(caixa).findByText('Estacionamento confirmado em N2')).toBeInTheDocument();
    const confirmacoes = chamadas.filter((c) => c.url.endsWith('/estacionar'));
    expect(confirmacoes.map((c) => c.corpo)).toEqual([{ regiaoId: 'N3' }, { regiaoId: 'N2' }]);
    expect(confirmacoes.every((c) => c.headers['x-operador-token'] === 'segredo')).toBe(true);

    fireEvent.click(await within(caixa).findByRole('button', { name: 'Registrar saída' }));
    expect(await within(caixa).findByText('Saída registrada')).toBeInTheDocument();
    expect(await within(caixa).findByText('Saiu')).toBeInTheDocument();
  });

  it('sem token válido, pede o token do operador', async () => {
    sessionStorage.clear();
    rotas(regioesDeTeste(), { 'GET /tickets/:codigo': { status: 401, corpo: { erro: { codigo: 'NAO_AUTORIZADO', mensagem: 'x' } } } });
    await abrir();
    expect(screen.getByLabelText(/Token do operador/)).toBeInTheDocument();
    const caixa = screen.getByTestId('operacao-ticket');
    fireEvent.change(within(caixa).getByLabelText('Código do ticket'), { target: { value: 'PV-0001' } });
    fireEvent.click(within(caixa).getByRole('button', { name: 'Consultar' }));
    expect(await within(caixa).findByText(/Token do operador inválido/)).toBeInTheDocument();
  });
});
