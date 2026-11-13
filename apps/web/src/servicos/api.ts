/**
 * Camada de serviços: única porta de entrada da web para a API (docs/mvp/02-contratos.md e 08-simulador.md).
 * Componentes não chamam fetch direto — usam estas funções, que padronizam erros (ErroServico).
 */
import type { Categoria, CenarioId, Indicadores, Recomendacao, Regiao, StatusTicket, Ticket } from '@parkvision/shared';

/** Erro padronizado: `codigo` vem da API ({ erro: { codigo } }) ou é SEM_CONEXAO quando a API não respondeu. */
export class ErroServico extends Error {
  constructor(public codigo: string, mensagem: string, public status = 0, public detalhes?: unknown) {
    super(mensagem);
  }
}

const TOKEN_CHAVE = 'pv-token-operador';
/** Token do operador para as rotas do simulador (guardado só nesta aba). */
export const tokenOperador = {
  ler: (): string => { try { return sessionStorage.getItem(TOKEN_CHAVE) ?? ''; } catch { return ''; } },
  gravar: (t: string) => { try { sessionStorage.setItem(TOKEN_CHAVE, t); } catch { /* sem storage: vale só em memória */ } },
};

async function pedir<T>(caminho: string, init: RequestInit & { operador?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body) headers['content-type'] = 'application/json';
  if (init.operador) headers['x-simulador-token'] = tokenOperador.ler();
  let resposta: Response;
  try {
    resposta = await fetch(`/api${caminho}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  } catch {
    throw new ErroServico('SEM_CONEXAO', 'Não foi possível falar com o servidor do ParkVision.');
  }
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const erro = (corpo as { erro?: { codigo?: string; mensagem?: string; detalhes?: unknown } } | null)?.erro;
    throw new ErroServico(erro?.codigo ?? 'ERRO_INTERNO', erro?.mensagem ?? `Erro ${resposta.status}`, resposta.status, erro?.detalhes);
  }
  return corpo as T;
}

const json = (corpo: unknown) => JSON.stringify(corpo);

// ── tipos de resposta ──
export interface RespostaEntrada { ticket: Ticket; recomendacao: Recomendacao; qrUrl: string }
export interface RespostaLocalizador {
  ticket: { codigo: string; entradaEm: string; status: StatusTicket; categoria: Categoria; estacionadoEm: string | null; saidaEm: string | null };
  regiao: Regiao | null;
  recomendada: Regiao;
  orientacao: string[];
}
export interface EstadoSimulacao {
  status: 'parado' | 'rodando' | 'pausado';
  modo: 'automatico' | 'manual';
  cenario: CenarioId | null;
  descricaoCenario: string | null;
  velocidade: number;
  relogioSimuladoIso: string;
  decorridoSimuladoSeg: number;
  estatisticas: Record<string, number>;
  veiculos: { aguardando: number; estacionados: number; gerados: number };
  veiculosSimuladosAtivos: number;
}
export interface CenarioResumo { id: CenarioId; nome: string; descricao: string; ocupacaoInicial: number; entradasPorMinuto: number | null }

// ── endpoints ──
export const api = {
  regioes: () => pedir<Regiao[]>('/regioes'),
  indicadores: () => pedir<Indicadores>('/indicadores'),
  recomendacoes: (limite = 20) => pedir<Recomendacao[]>(`/recomendacoes?limite=${limite}`),
  /** Totem: registra a entrada e recebe a recomendação + ticket (não ocupa vaga). */
  registrarEntrada: (acessoId: string, categoria: Categoria) =>
    pedir<RespostaEntrada>('/entradas', { method: 'POST', body: json({ acessoId, categoria }) }),
  localizar: (token: string) => pedir<RespostaLocalizador>(`/localizador/${encodeURIComponent(token)}`),

  simulacao: {
    estado: () => pedir<EstadoSimulacao>('/simulacao'),
    cenarios: () => pedir<CenarioResumo[]>('/simulacao/cenarios'),
    acao: (acao: 'iniciar' | 'pausar' | 'retomar' | 'encerrar' | 'reiniciar') =>
      pedir<unknown>(`/simulacao/${acao}`, { method: 'POST', operador: true, body: json({}) }),
    cenario: (cenario: CenarioId) => pedir<EstadoSimulacao>('/simulacao/cenario', { method: 'POST', operador: true, body: json({ cenario }) }),
    velocidade: (velocidade: number) => pedir<EstadoSimulacao>('/simulacao/config', { method: 'PATCH', operador: true, body: json({ velocidade }) }),
  },
};

/** Mensagem curta para a interface, a partir do erro. */
export function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroServico) {
    if (e.codigo === 'SEM_CONEXAO') return 'Sem conexão com o servidor. Verifique se a API está no ar.';
    if (e.codigo === 'NAO_AUTORIZADO') return 'Token do operador inválido. Confira o token do simulador.';
    return e.message;
  }
  return 'Erro inesperado.';
}
