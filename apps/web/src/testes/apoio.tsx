/**
 * Apoio aos testes de interface: respostas da API simuladas no fetch (a camada de serviços roda de verdade)
 * e um Socket.IO falso para disparar eventos em tempo real.
 * Os dados das regiões partem do mapa digital oficial; ocupação e tickets são valores de teste.
 */
import { mapaCapimDourado, type EventoTempoReal, type Indicadores, type Recomendacao, type Regiao, type TipoEvento } from '@parkvision/shared';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';

export function regioesDeTeste(ajustes: Record<string, Partial<Regiao>> = {}): Regiao[] {
  return mapaCapimDourado.regioes.map((r) => {
    const capacidade = r.capacidade.valor ?? 0;
    const ocupadas = ajustes[r.id]?.ocupadas ?? Math.round(capacidade * 0.4);
    return {
      id: r.id, nome: r.nome, nivel: r.nivel, categorias: r.categorias, capacidade, ocupadas, livres: capacidade - ocupadas,
      operacional: true, fonteCapacidade: r.capacidade.fonte === 'a-contar' ? 'simulada' : r.capacidade.fonte, atualizadoEm: '2026-11-13T12:00:00.000Z',
      statusSensores: 'ok', fluxo: { recente: 1, vazaoReferencia: 8, nivel: 'baixo' },
      ...ajustes[r.id],
    } as Regiao;
  });
}

export function indicadoresDe(regioes: Regiao[], extra: Partial<Indicadores> = {}): Indicadores {
  const capacidadeTotal = regioes.reduce((s, r) => s + r.capacidade, 0), ocupadas = regioes.reduce((s, r) => s + r.ocupadas, 0);
  return { capacidadeTotal, ocupadas, livres: capacidadeTotal - ocupadas, taxaOcupacao: Math.round((ocupadas / capacidadeTotal) * 1000) / 10, veiculosAguardando: 0, recomendacoesUltimaHora: 0, regioesAltaOcupacao: [], ...extra };
}

export function recomendacaoDeTeste(regiaoId = 'N3', nos = ['n_A_NE', 'n_rodNE', 'n_ROT', 'n_N3']): Recomendacao {
  return {
    id: 'rec-1', ticketCodigo: 'PV-0042', regiaoId, score: 0.71, pesos: { disponibilidade: 0.5, distancia: 0.3, fluxo: 0.2 }, avaliacoes: [],
    justificativa: `Região ${regiaoId} recomendada: tem mais vagas livres e fica perto da entrada.`, rota: { nos, custo: 477 }, criadaEm: '2026-11-13T15:00:00.000Z',
  };
}

// ── fetch simulado ──
type Resposta = { status?: number; corpo: unknown } | ((init?: RequestInit) => { status?: number; corpo: unknown });
export function simularApi(rotas: Record<string, Resposta>) {
  const chamadas: { metodo: string; url: string; corpo?: unknown; headers: Record<string, string> }[] = [];
  const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const caminho = String(url).replace(/^\/api/, '').split('?')[0]!;
    chamadas.push({ metodo, url: String(url), corpo: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
    const chave = Object.keys(rotas).find((k) => {
      const [m, padrao] = k.includes(' ') ? k.split(' ') : ['GET', k];
      return m === metodo && new RegExp(`^${padrao!.replace(/:\w+/g, '[^/]+')}$`).test(caminho);
    });
    if (!chave) throw new TypeError('Failed to fetch'); // sem rota = sem conexão
    const r = rotas[chave]!;
    const { status = 200, corpo } = typeof r === 'function' ? r(init) : r;
    return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchFalso);
  return { chamadas, fetchFalso };
}

// ── Socket.IO falso ──
type Ouvinte = (...args: unknown[]) => void;
export const socketFalso = {
  ouvintes: new Map<string, Ouvinte[]>(),
  on(evento: string, fn: Ouvinte) { this.ouvintes.set(evento, [...(this.ouvintes.get(evento) ?? []), fn]); return this; },
  close: vi.fn(),
  disparar(evento: string, ...args: unknown[]) { for (const fn of this.ouvintes.get(evento) ?? []) fn(...args); },
  limpar() { this.ouvintes.clear(); this.close.mockClear(); },
};
let seq = 0;
export function evento<T extends TipoEvento>(tipo: T, dados: unknown, entidadeId = 'x', simulado = true): EventoTempoReal {
  ++seq;
  return { id: `ev-${seq}`, sequencia: seq, tipo, ocorridoEm: '2026-11-13T15:30:00.000Z', entidadeId, simulado, dados };
}

export function renderizarEm(caminho: string, rota: string, elemento: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes><Route path={rota} element={elemento} /></Routes>
    </MemoryRouter>,
  );
}
