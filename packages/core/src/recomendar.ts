/**
 * Algoritmo de distribuição do ParkVision (docs/mvp/01-arquitetura-mvp.md §6).
 *
 * Função pura e determinística: sem banco, sem relógio global (usa `entrada.agora`), sem aleatoriedade
 * e sem efeito colateral. Uma recomendação NÃO altera a ocupação de nenhuma região.
 */
import { PESOS_PADRAO } from '@parkvision/shared';
import type { AvaliacaoRegiao, Categoria, MotivoInelegivel, Pesos, Regiao, Rota } from '@parkvision/shared';
import type { EntradaRecomendacao, ResultadoRecomendacao } from './index.ts';
import { menorCaminho } from './rotas.ts';

/** Vazão de referência usada quando a região não tem uma definida (veículos por 5 minutos). */
export const VAZAO_REFERENCIA_PADRAO = 6;

/** Diferença de score abaixo da qual duas regiões são consideradas empatadas. */
export const LIMIAR_EMPATE = 0.01;

const NOME_CATEGORIA: Record<Categoria, string> = {
  CARRO_PEQUENO: 'carro pequeno',
  CARRO_GRANDE: 'carro grande',
  MOTO: 'moto',
};

const VEICULOS_CATEGORIA: Record<Categoria, string> = {
  CARRO_PEQUENO: 'carros',
  CARRO_GRANDE: 'carros',
  MOTO: 'motos',
};

/* ---------------- Pesos ---------------- */

/**
 * PESOS_PADRAO sobrescrito pelos pesos informados; normaliza para somar 1.
 * Lança RangeError se algum peso for negativo/não finito ou se todos forem zero.
 */
export function resolverPesos(parciais?: Partial<Pesos>): Pesos {
  const pesos: Pesos = { ...PESOS_PADRAO };
  for (const chave of ['disponibilidade', 'distancia', 'fluxo'] as const) {
    const valor = parciais?.[chave];
    if (valor !== undefined) pesos[chave] = valor;
  }
  for (const [chave, valor] of Object.entries(pesos)) {
    if (!Number.isFinite(valor) || valor < 0) {
      throw new RangeError(`Peso inválido para "${chave}": ${valor}. Os pesos devem ser números maiores ou iguais a zero.`);
    }
  }
  const soma = pesos.disponibilidade + pesos.distancia + pesos.fluxo;
  if (soma === 0) throw new RangeError('Pelo menos um peso deve ser maior que zero.');
  if (Math.abs(soma - 1) < 1e-9) return pesos;
  return {
    disponibilidade: pesos.disponibilidade / soma,
    distancia: pesos.distancia / soma,
    fluxo: pesos.fluxo / soma,
  };
}

/* ---------------- Filtros ---------------- */

function dadosInvalidos(regiao: Regiao, agora: Date, validadeDadosMs: number | null | undefined): boolean {
  const { capacidade, ocupadas } = regiao;
  if (!Number.isFinite(capacidade) || !Number.isFinite(ocupadas)) return true;
  if (capacidade <= 0 || ocupadas < 0 || ocupadas > capacidade) return true;
  if (validadeDadosMs !== undefined && validadeDadosMs !== null) {
    const atualizado = Date.parse(regiao.atualizadoEm);
    if (Number.isNaN(atualizado)) return true;
    if (agora.getTime() - atualizado > validadeDadosMs) return true;
  }
  return false;
}

/* ---------------- Candidatas ---------------- */

interface Candidata {
  regiao: Regiao;
  livres: number;
  rota: Rota;
  disponibilidade: number;
  /** Fluxo normalizado (0 a 1). */
  fluxo: number;
  /** Distância normalizada (0 a 1), preenchida depois de conhecer o maior custo. */
  distancia: number;
  score: number;
}

const arredondar4 = (valor: number): number => Math.round(valor * 1e4) / 1e4;
/** Score em décimos de milésimo (inteiro), para comparar sem erro de ponto flutuante. */
const emUnidades = (score: number): number => Math.round(score * 1e4);
const UNIDADES_EMPATE = Math.round(LIMIAR_EMPATE * 1e4);

/** Critérios de desempate: menor distância → mais vagas livres → código da região. */
function compararDesempate(a: Candidata, b: Candidata): number {
  if (a.rota.custo !== b.rota.custo) return a.rota.custo - b.rota.custo;
  if (a.livres !== b.livres) return b.livres - a.livres;
  if (a.regiao.id === b.regiao.id) return 0;
  return a.regiao.id < b.regiao.id ? -1 : 1;
}

/**
 * Ordena por score com a regra de empate. "Empate" é transitivo apenas em relação ao líder:
 * a cada passo, pega as regiões a menos de 0,01 do maior score restante e escolhe entre elas
 * pelos critérios de desempate. Assim o resultado não depende da ordem de entrada.
 */
function ordenar(candidatas: Candidata[]): Candidata[] {
  const restantes = [...candidatas];
  const ordem: Candidata[] = [];
  while (restantes.length > 0) {
    const maior = Math.max(...restantes.map((c) => emUnidades(c.score)));
    const empatadas = restantes.filter((c) => maior - emUnidades(c.score) < UNIDADES_EMPATE);
    const escolhida = [...empatadas].sort(compararDesempate)[0]!;
    ordem.push(escolhida);
    restantes.splice(restantes.indexOf(escolhida), 1);
  }
  return ordem;
}

/* ---------------- Justificativa ---------------- */

const pct = (valor: number): number => Math.round(valor * 100);
/** Score com 3 casas e vírgula decimal (ex.: 0,955). */
const formatarScore = (score: number): string => score.toFixed(3).replace('.', ',');

function juntar(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

const TEXTO_MOTIVO: Record<Exclude<MotivoInelegivel, 'CATEGORIA_INCOMPATIVEL'>, string> = {
  SEM_VAGAS: 'sem vagas',
  FORA_DE_OPERACAO: 'fora de operação',
  DADOS_INVALIDOS: 'com dados inválidos ou desatualizados',
  SEM_ROTA: 'sem rota a partir desta entrada',
};

/** "N1 e N2 sem vagas; S1 fora de operação" — ignora regiões de outra categoria. */
function descreverInelegiveis(avaliacoes: AvaliacaoRegiao[]): string {
  const grupos = new Map<string, string[]>();
  for (const a of avaliacoes) {
    if (a.elegivel || !a.motivo || a.motivo === 'CATEGORIA_INCOMPATIVEL') continue;
    const texto = TEXTO_MOTIVO[a.motivo];
    const lista = grupos.get(texto) ?? [];
    lista.push(a.regiaoId);
    grupos.set(texto, lista);
  }
  return [...grupos].map(([texto, ids]) => `${juntar(ids)} ${texto}`).join('; ');
}

function justificarSemRegiao(categoria: Categoria, avaliacoes: AvaliacaoRegiao[]): string {
  const nome = NOME_CATEGORIA[categoria];
  const motivos = descreverInelegiveis(avaliacoes);
  if (!motivos) return `Nenhuma região disponível para ${nome} agora: nenhuma região aceita ${nome}.`;
  return `Nenhuma região disponível para ${nome} agora: ${motivos}.`;
}

function justificarUnica(categoria: Categoria, vencedora: Candidata, avaliacoes: AvaliacaoRegiao[]): string {
  const id = vencedora.regiao.id;
  let texto =
    `Região ${id} recomendada: é a única opção compatível para ${NOME_CATEGORIA[categoria]} agora, ` +
    `com ${pct(vencedora.disponibilidade)}% das vagas livres.`;
  const demais = descreverInelegiveis(avaliacoes);
  if (demais) texto += ` As demais estão indisponíveis: ${demais}.`;
  return texto;
}

type Criterio = 'disponibilidade' | 'distancia' | 'fluxo';

function justificarComparando(categoria: Categoria, v: Candidata, s: Candidata, pesos: Pesos): string {
  const idV = v.regiao.id;
  const idS = s.regiao.id;
  const veiculos = VEICULOS_CATEGORIA[categoria];
  const pctV = pct(v.disponibilidade);
  const pctS = pct(s.disponibilidade);

  const empatadas = emUnidades(v.score) - emUnidades(s.score) < UNIDADES_EMPATE;
  if (empatadas) {
    let motivo: string;
    if (v.rota.custo !== s.rota.custo) motivo = `fica mais perto da entrada que ${idS}`;
    else if (v.livres !== s.livres) motivo = `tem mais vagas livres (${v.livres} contra ${s.livres} em ${idS})`;
    else motivo = `vem antes de ${idS} na ordem dos códigos`;
    return (
      `Região ${idV} recomendada: está praticamente empatada com ${idS} na pontuação ` +
      `(${formatarScore(v.score)} contra ${formatarScore(s.score)}) e foi escolhida porque ${motivo}.`
    );
  }

  // Sinal de cada critério: > 0 favorece a vencedora, < 0 favorece a segunda.
  const diferenca: Record<Criterio, number> = {
    disponibilidade: pctV === pctS ? 0 : v.disponibilidade - s.disponibilidade,
    distancia: v.rota.custo === s.rota.custo ? 0 : s.distancia - v.distancia,
    fluxo: Math.abs(v.fluxo - s.fluxo) < 1e-9 ? 0 : s.fluxo - v.fluxo,
  };
  const peso = (c: Criterio): number => pesos[c] * Math.abs(diferenca[c]);
  const criterios: Criterio[] = ['disponibilidade', 'distancia', 'fluxo'];
  const vantagens = criterios.filter((c) => diferenca[c] > 0 && pesos[c] > 0).sort((a, b) => peso(b) - peso(a));
  const desvantagens = criterios.filter((c) => diferenca[c] < 0 && pesos[c] > 0).sort((a, b) => peso(b) - peso(a));

  const razaoS = s.rota.custo > 0 ? v.rota.custo / s.rota.custo : Infinity;
  const textoVantagem: Record<Criterio, string> = {
    disponibilidade: `tem ${pctV}% das vagas livres (${idS} tem ${pctS}%)`,
    distancia: `fica mais perto da entrada que ${idS}`,
    fluxo: `recebeu menos ${veiculos} nos últimos 5 minutos`,
  };
  const textoDesvantagem: Record<Criterio, string> = {
    disponibilidade: `tem menos vagas livres que ${idS} (${pctV}% contra ${pctS}%)`,
    distancia: `fica ${razaoS <= 1.3 ? 'um pouco ' : ''}mais longe que ${idS}`,
    fluxo: `recebeu mais ${veiculos} que ${idS} nos últimos 5 minutos`,
  };
  const textoRazao: Record<Criterio, string> = {
    disponibilidade: 'a disponibilidade pesa mais',
    distancia: 'a distância menor pesa mais',
    fluxo: 'o menor movimento recente pesa mais',
  };

  const principal = vantagens.length > 0
    ? juntar(vantagens.map((c) => textoVantagem[c]))
    : `tem a melhor pontuação combinada (${formatarScore(v.score)} contra ${formatarScore(s.score)} de ${idS})`;
  let texto = `Região ${idV} recomendada: ${principal}.`;

  if (desvantagens.length > 0) {
    const frase = juntar(desvantagens.map((c) => textoDesvantagem[c]));
    const razao = vantagens[0] ? textoRazao[vantagens[0]] : 'o conjunto dos critérios pesa mais';
    texto += ` ${frase.charAt(0).toUpperCase()}${frase.slice(1)}, mas ${razao}.`;
  }
  return texto;
}

/* ---------------- Recomendação ---------------- */

/**
 * Escolhe a melhor região para um veículo que está entrando.
 * A ordem de `avaliacoes` segue a ordem de `entrada.regioes`.
 */
export function recomendar(entrada: EntradaRecomendacao): ResultadoRecomendacao {
  const pesos = resolverPesos(entrada.pesos);
  const { categoria, acessoNo, mapa, agora } = entrada;
  const noAcessoPorRegiao = new Map(mapa.regioes.map((r) => [r.id, r.noAcesso]));

  const avaliacoes: AvaliacaoRegiao[] = [];
  const candidatas: Candidata[] = [];
  const avaliacaoDe = new Map<Candidata, AvaliacaoRegiao>();

  for (const regiao of entrada.regioes) {
    const inelegivel = (motivo: MotivoInelegivel): void => {
      avaliacoes.push({ regiaoId: regiao.id, elegivel: false, motivo });
    };

    if (!regiao.categorias.includes(categoria)) { inelegivel('CATEGORIA_INCOMPATIVEL'); continue; }
    if (!regiao.operacional) { inelegivel('FORA_DE_OPERACAO'); continue; }
    if (dadosInvalidos(regiao, agora, entrada.validadeDadosMs)) { inelegivel('DADOS_INVALIDOS'); continue; }

    // Não confia no campo `livres` recebido: recalcula a partir da capacidade e da ocupação.
    const livres = regiao.capacidade - regiao.ocupadas;
    if (livres <= 0) { inelegivel('SEM_VAGAS'); continue; }

    const noAcesso = noAcessoPorRegiao.get(regiao.id);
    const rota = noAcesso === undefined ? null : menorCaminho(mapa, acessoNo, noAcesso);
    if (!rota) { inelegivel('SEM_ROTA'); continue; }

    const recente = Math.max(0, entrada.fluxoRecente[regiao.id] ?? 0);
    const vazao = Math.max(1, entrada.vazaoReferencia[regiao.id] ?? VAZAO_REFERENCIA_PADRAO);
    const candidata: Candidata = {
      regiao,
      livres,
      rota,
      disponibilidade: livres / regiao.capacidade,
      fluxo: Math.min(1, recente / vazao),
      distancia: 0,
      score: 0,
    };
    const avaliacao: AvaliacaoRegiao = { regiaoId: regiao.id, elegivel: true };
    avaliacoes.push(avaliacao);
    candidatas.push(candidata);
    avaliacaoDe.set(candidata, avaliacao);
  }

  if (candidatas.length === 0) {
    return { tipo: 'SEM_REGIAO', pesos, avaliacoes, justificativa: justificarSemRegiao(categoria, avaliacoes) };
  }

  const maiorCusto = Math.max(...candidatas.map((c) => c.rota.custo));
  for (const c of candidatas) {
    c.distancia = maiorCusto > 0 ? c.rota.custo / maiorCusto : 0;
    c.score = arredondar4(
      pesos.disponibilidade * c.disponibilidade +
      pesos.distancia * (1 - c.distancia) +
      pesos.fluxo * (1 - c.fluxo),
    );
    const avaliacao = avaliacaoDe.get(c)!;
    avaliacao.criterios = {
      disponibilidade: arredondar4(c.disponibilidade),
      distancia: arredondar4(c.distancia),
      fluxo: arredondar4(c.fluxo),
    };
    avaliacao.custoRota = c.rota.custo;
    avaliacao.score = c.score;
  }

  const [vencedora, segunda] = ordenar(candidatas) as [Candidata, ...Candidata[]];
  const justificativa = segunda
    ? justificarComparando(categoria, vencedora, segunda, pesos)
    : justificarUnica(categoria, vencedora, avaliacoes);

  return {
    tipo: 'RECOMENDADA',
    regiaoId: vencedora.regiao.id,
    score: vencedora.score,
    pesos,
    avaliacoes,
    justificativa,
    rota: { nos: [...vencedora.rota.nos], custo: vencedora.rota.custo },
  };
}
