/**
 * Vagas reservadas (PcD e pessoa idosa): referências legais, mínimos, caminho a pé até o shopping e resumo com alertas.
 * Tudo puro (sem banco): usado pela API, pelo painel e pelos testes.
 *
 * Honestidade: a planta não valida rota acessível. `caminhoPedestre` diz só o que sabemos (mesmo nível da entrada
 * no térreo; ligação não identificada nos subsolos) e NUNCA afirma que o caminho é acessível.
 */
import dados from './mapa/acessibilidade.json' with { type: 'json' };
import { mapaCapimDourado } from './mapa/index.ts';
import { TIPOS_VAGA, vagasDaRegiao, type Nivel, type Regiao, type TipoVaga, type VagasDoTipo } from './tipos.ts';

export interface ReferenciaLegal { tipo: 'PCD' | 'IDOSO'; percentual: number; minimoAbsoluto: number; norma: string; observacao: string }
export interface EntradaPedestre { id: string; nome: string; nivel: Nivel; xy: [number, number]; confianca: string }
export interface DadosAcessibilidade {
  versao: string;
  status: string;
  referenciasLegais: ReferenciaLegal[];
  baseDeCalculo: { regra: 'total'; observacao: string };
  normasAVerificar: string[];
  vagasNaPlanta: { regiaoId: string; pcd: number; idoso: number; fonte: string }[];
  outrasVagasEspeciais: string;
  entradasPedestres: EntradaPedestre[];
  acessoSubsolos: { nome: string; situacao: string; observacao: string };
  criteriosDistribuicao: string[];
}
export const acessibilidade = dados as unknown as DadosAcessibilidade;

export type TipoReservado = Exclude<TipoVaga, 'COMUM'>;

/** Mínimo legal de cada tipo reservado sobre um total de vagas (arredondado para cima; PcD com pelo menos 1). */
export function minimosLegais(total: number): Record<TipoReservado, number> {
  const ref = (t: TipoReservado) => acessibilidade.referenciasLegais.find((r) => r.tipo === t)!;
  const minimo = (t: TipoReservado) => (total <= 0 ? 0 : Math.max(ref(t).minimoAbsoluto, Math.ceil(total * ref(t).percentual - 1e-9)));
  return { PCD: minimo('PCD'), IDOSO: minimo('IDOSO') };
}

/**
 * Situação do caminho a pé entre a região e a porta do shopping, segundo a planta:
 *  - 'mesmo-nivel': térreo, entrada de pedestres no mesmo nível (sem escada identificada) — NÃO validado em campo;
 *  - 'nao-identificado': subsolos, sem elevador/rampa de pedestres identificados.
 */
export type SituacaoCaminho = 'mesmo-nivel' | 'nao-identificado';
export interface CaminhoPedestre { situacao: SituacaoCaminho; entrada: string | null; distancia: number | null; validado: false; texto: string }

const centroDe = (poligono: [number, number][]): [number, number] => [
  poligono.reduce((s, p) => s + p[0], 0) / poligono.length,
  poligono.reduce((s, p) => s + p[1], 0) / poligono.length,
];

export function caminhoPedestre(regiaoId: string): CaminhoPedestre {
  const r = mapaCapimDourado.regioes.find((x) => x.id === regiaoId);
  const entradas = acessibilidade.entradasPedestres.filter((e) => e.nivel === r?.nivel);
  if (!r || !entradas.length) {
    return {
      situacao: 'nao-identificado', entrada: null, distancia: null, validado: false,
      texto: `Caminho a pé até o shopping não identificado na planta (${acessibilidade.acessoSubsolos.nome.toLowerCase()}; elevador não identificado).`,
    };
  }
  const [cx, cy] = centroDe(r.poligono);
  const maisPerto = entradas.map((e) => ({ e, d: Math.hypot(e.xy[0] - cx, e.xy[1] - cy) })).sort((a, b) => a.d - b.d)[0]!;
  return {
    situacao: 'mesmo-nivel', entrada: maisPerto.e.nome, distancia: Math.round(maisPerto.d), validado: false,
    texto: `Entrada de pedestres mais próxima: ${maisPerto.e.nome}, no mesmo nível. A acessibilidade do caminho ainda não foi validada na planta.`,
  };
}

/** Caminhos de todas as regiões (entrada do algoritmo de recomendação). */
export function caminhosPedestres(): Record<string, CaminhoPedestre> {
  return Object.fromEntries(mapaCapimDourado.regioes.map((r) => [r.id, caminhoPedestre(r.id)]));
}

export interface AlertaVagas { tipo: TipoReservado; mensagem: string }
export interface ResumoVagasReservadas {
  status: string;
  base: number;
  minimos: Record<TipoReservado, number>;
  totais: Record<TipoVaga, VagasDoTipo>;
  alertas: AlertaVagas[];
  /** Regiões com algum ajuste administrativo / proposta / planta. */
  fontes: Record<string, string | undefined>;
}

/** Totais por tipo, mínimos legais e alertas quando a distribuição configurada fica abaixo do mínimo. */
export function resumoVagasReservadas(regioes: Regiao[]): ResumoVagasReservadas {
  const base = regioes.reduce((s, r) => s + r.capacidade, 0);
  const minimos = minimosLegais(base);
  const totais = Object.fromEntries(TIPOS_VAGA.map((t) => [t, { capacidade: 0, ocupadas: 0, livres: 0 }])) as Record<TipoVaga, VagasDoTipo>;
  for (const r of regioes) {
    const v = vagasDaRegiao(r);
    for (const t of TIPOS_VAGA) {
      totais[t].capacidade += v[t].capacidade;
      totais[t].ocupadas += v[t].ocupadas;
      totais[t].livres += v[t].livres;
    }
  }
  const nome: Record<TipoReservado, string> = { PCD: 'PcD', IDOSO: 'pessoa idosa' };
  const alertas: AlertaVagas[] = (['PCD', 'IDOSO'] as const)
    .filter((t) => totais[t].capacidade < minimos[t])
    .map((t) => ({ tipo: t, mensagem: `Vagas para ${nome[t]}: ${totais[t].capacidade} configuradas, abaixo do mínimo de ${minimos[t]} (sobre ${base} vagas).` }));
  return { status: acessibilidade.status, base, minimos, totais, alertas, fontes: Object.fromEntries(regioes.map((r) => [r.id, r.fonteVagasReservadas])) };
}
