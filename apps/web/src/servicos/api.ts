/**
 * Camada de serviços: única porta de entrada da web para a API (docs/mvp/02-contratos.md e 08-simulador.md).
 * Componentes não chamam fetch direto — usam estas funções, que padronizam erros (ErroServico).
 */
import type { Categoria, CenarioId, Indicadores, Recomendacao, Regiao, StatusTicket, Ticket } from '@parkvision/shared';

/** Cabeçalho do token do operador (operações restritas desde a Etapa 4). */
export const CABECALHO_OPERADOR = 'x-operador-token';

/** Erro padronizado: `codigo` vem da API ({ erro: { codigo } }) ou é SEM_CONEXAO quando a API não respondeu. */
export class ErroServico extends Error {
  constructor(public codigo: string, mensagem: string, public status = 0, public detalhes?: unknown) {
    super(mensagem);
  }
}

const TOKEN_CHAVE = 'pv-token-operador';
/** Token do operador para as operações restritas (guardado só nesta aba). */
export const tokenOperador = {
  ler: (): string => { try { return sessionStorage.getItem(TOKEN_CHAVE) ?? ''; } catch { return ''; } },
  gravar: (t: string) => { try { sessionStorage.setItem(TOKEN_CHAVE, t); } catch { /* sem storage: vale só em memória */ } },
};

async function pedir<T>(caminho: string, init: RequestInit & { operador?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body) headers['content-type'] = 'application/json';
  if (init.operador) headers[CABECALHO_OPERADOR] = tokenOperador.ler();
  let resposta: Response;
  try {
    resposta = await fetch(`/api${caminho}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  } catch {
    throw new ErroServico('SEM_CONEXAO', 'Não foi possível falar com o servidor do Golden Park.');
  }
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const erro = (corpo as { erro?: { codigo?: string; mensagem?: string; detalhes?: unknown } } | null)?.erro;
    // sem corpo padronizado e erro de gateway (ex.: proxy sem API): trata como servidor fora do ar
    if (!erro && resposta.status >= 502) throw new ErroServico('SEM_CONEXAO', 'O servidor do Golden Park não respondeu.', resposta.status);
    throw new ErroServico(erro?.codigo ?? 'ERRO_INTERNO', erro?.mensagem ?? `Erro ${resposta.status}`, resposta.status, erro?.detalhes);
  }
  return corpo as T;
}

const json = (corpo: unknown) => JSON.stringify(corpo);

// ── tipos de resposta ──
export interface RespostaEntrada { ticket: Ticket; recomendacao: Recomendacao; qrUrl: string }
export interface RespostaLocalizador {
  ticket: { codigo: string; entradaEm: string; status: StatusTicket; categoria: Categoria; estacionadoEm: string | null; saidaEm: string | null; simulado: boolean };
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
  modoDemonstracao: boolean;
}
export interface Saude { ok: boolean; banco: 'ok' | 'indisponivel'; modoDemonstracao: boolean }
export interface ItemHistorico {
  id: string;
  tipo: 'ENTRADA' | 'ESTACIONOU' | 'SAIU' | 'AJUSTE';
  quando: string;
  ticketCodigo: string | null;
  regiaoId: string;
  categoria: Categoria | null;
  simulado: boolean;
}
export interface ConsultaTicket { ticket: Ticket; simulado: boolean; recomendacoes: Recomendacao[] }
export interface CenarioResumo { id: CenarioId; nome: string; descricao: string; ocupacaoInicial: number; entradasPorMinuto: number | null }

// ── endpoints ──
export const api = {
  saude: () => pedir<Saude>('/saude'),
  regioes: () => pedir<Regiao[]>('/regioes'),
  historico: (limite = 30) => pedir<ItemHistorico[]>(`/historico?limite=${limite}`),
  indicadores: () => pedir<Indicadores>('/indicadores'),
  recomendacoes: (limite = 20) => pedir<Recomendacao[]>(`/recomendacoes?limite=${limite}`),
  /** Totem: registra a entrada e recebe a recomendação + ticket (não ocupa vaga). */
  registrarEntrada: (acessoId: string, categoria: Categoria) =>
    pedir<RespostaEntrada>('/entradas', { method: 'POST', body: json({ acessoId, categoria }) }),
  localizar: (token: string) => pedir<RespostaLocalizador>(`/localizador/${encodeURIComponent(token)}`),

  /** Operação do estacionamento (painel, com o token do operador). Equivale à leitura do ticket na região ou na cancela. */
  tickets: {
    consultar: (codigo: string) => pedir<ConsultaTicket>(`/tickets/${encodeURIComponent(codigo)}`, { operador: true }),
    estacionar: (codigo: string, regiaoId?: string) =>
      pedir<{ ticket: Ticket; regiao: Regiao }>(`/tickets/${encodeURIComponent(codigo)}/estacionar`, { method: 'POST', operador: true, body: json(regiaoId ? { regiaoId } : {}) }),
    saida: (codigo: string) => pedir<{ ticket: Ticket; regiao: Regiao | null }>(`/tickets/${encodeURIComponent(codigo)}/saida`, { method: 'POST', operador: true, body: json({}) }),
    cancelar: (codigo: string) => pedir<{ ticket: Ticket }>(`/tickets/${encodeURIComponent(codigo)}/cancelar`, { method: 'POST', operador: true, body: json({}) }),
    novaRecomendacao: (codigo: string) =>
      pedir<{ ticket: Ticket; recomendacao: Recomendacao; motivo: string }>(`/tickets/${encodeURIComponent(codigo)}/recomendacao`, { method: 'POST', operador: true, body: json({}) }),
  },

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
    if (e.codigo === 'NAO_AUTORIZADO') return 'Token do operador inválido. Confira o token configurado na API.';
    if (e.codigo === 'BANCO_INDISPONIVEL') return 'O banco de dados está indisponível. Os dados não foram alterados; tente de novo em instantes.';
    return e.message;
  }
  return 'Erro inesperado.';
}
