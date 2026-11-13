/**
 * Dados do mapa digital (aprovado na Etapa 0) e cálculos de geometria/rota usados pelo componente de mapa.
 * Fonte única: packages/shared/src/mapa/capim-dourado.json (o mesmo arquivo que a API usa para calcular rotas).
 * Traçado de fundo: linhas vetoriais extraídas da própria planta (docs/planta/2026_11_CDS_MIX.pdf) na Etapa 0.
 */
import { mapaCapimDourado, type MapaAcesso, type MapaNo, type MapaRegiao, type Nivel } from '@parkvision/shared';
import planta from './planta-base.json';

export const mapa = mapaCapimDourado;
export const NIVEIS = mapa.niveis;
export const tracadoPlanta = planta as unknown as Record<Nivel, { pagina: number; viewBox: [number, number, number, number]; d: string }>;

export const nosPorId: Record<string, MapaNo> = Object.fromEntries(mapa.nos.map((n) => [n.id, n]));
export const regiaoDoMapa: Record<string, MapaRegiao> = Object.fromEntries(mapa.regioes.map((r) => [r.id, r]));
export const acessoPorNo: Record<string, MapaAcesso> = Object.fromEntries(mapa.acessos.map((a) => [a.no, a]));
export const acessoPorId: Record<string, MapaAcesso> = Object.fromEntries(mapa.acessos.map((a) => [a.id, a]));

/** Áreas desenhadas na planta que ficam fora da distribuição (ex.: pátio de serviço leste). */
export const areasForaDaDistribuicao = ((mapaCapimDourado as unknown as { areasNaoDistribuidas?: { id: string; nome: string; nivel: Nivel; poligono: [number, number][] }[] })
  .areasNaoDistribuidas ?? []);

/** "Térreo (pátios descobertos)" → "Térreo". */
export const nomeDoNivel = (n: Nivel) => (NIVEIS.find((x) => x.id === n)?.nome ?? n).replace(/\s*\(.*\)\s*$/, '');
/** "Acesso nordeste (Av. LO 2A)" → "Acesso nordeste". */
export const nomeCurto = (nome: string) => nome.replace(/\s*\(.*\)\s*$/, '');

/** Centro visual do polígono (média dos vértices — suficiente para os polígonos simples das regiões). */
export function centro(poligono: [number, number][]): [number, number] {
  const s = poligono.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return [s[0] / poligono.length, s[1] / poligono.length];
}

/** Escala de texto/traço para uma área de desenho (os níveis têm tamanhos muito diferentes). */
export const escalaDaArea = (vb: readonly number[]) => Math.max(vb[2]!, vb[3]!) / 56;
export function escalaDoNivel(nivel: Nivel) {
  return escalaDaArea(NIVEIS.find((n) => n.id === nivel)!.viewBox);
}

/**
 * Enquadramento aproximado numa região (localizador no celular): caixa da região com folga,
 * sem sair do desenho do nível e sem ficar pequena demais para dar contexto.
 */
export function enquadramento(regiaoId: string): [number, number, number, number] | null {
  const r = regiaoDoMapa[regiaoId];
  if (!r) return null;
  const nv = NIVEIS.find((n) => n.id === r.nivel)!.viewBox;
  const xs = r.poligono.map((p) => p[0]), ys = r.poligono.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const lado = Math.max(x1 - x0, y1 - y0, Math.max(nv[2], nv[3]) * 0.4) * 1.6;
  const w = Math.min(lado, nv[2]), h = Math.min(lado * 0.85, nv[3]);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const x = Math.min(Math.max(cx - w / 2, nv[0]), nv[0] + nv[2] - w);
  const y = Math.min(Math.max(cy - h / 2, nv[1]), nv[1] + nv[3] - h);
  return [x, y, w, h];
}

const chaveAresta = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const ARESTAS = new Set(mapa.arestas.map((a) => chaveAresta(a.de, a.para)));
const LIGACOES = new Set(mapa.ligacoesEntreNiveis.map((l) => chaveAresta(l.de, l.para)));

/** true se o trecho a→b existe no grafo de vias (aresta) ou é uma ligação entre níveis. */
export const trechoExiste = (a: string, b: string) => ARESTAS.has(chaveAresta(a, b)) || LIGACOES.has(chaveAresta(a, b));
export const ehLigacaoEntreNiveis = (a: string, b: string) => LIGACOES.has(chaveAresta(a, b));

export interface TrechoRota { nivel: Nivel; nos: string[] }
/** Divide a rota (lista de nós devolvida pela API) em trechos por nível. Trechos inexistentes no grafo são descartados. */
export function trechosDaRota(nos: string[]): TrechoRota[] {
  const trechos: TrechoRota[] = [];
  for (let i = 0; i < nos.length; i++) {
    const no = nosPorId[nos[i]!];
    if (!no) continue;
    const anterior = nos[i - 1];
    if (anterior && !trechoExiste(anterior, no.id)) continue; // nunca desenha linha fora das vias
    const atual = trechos[trechos.length - 1];
    if (atual && atual.nivel === no.nivel) atual.nos.push(no.id);
    else trechos.push({ nivel: no.nivel, nos: [no.id] });
  }
  return trechos;
}

/**
 * Orientação em texto a partir da rota e do mapa (sem inventar: usa só nomes de acessos, nós rotulados,
 * níveis e a referência da região registrados no mapa digital).
 */
export function orientacaoDaRota(nos: string[], regiaoId: string): string[] {
  const passos: string[] = [];
  const acesso = acessoPorNo[nos[0] ?? ''];
  if (acesso) passos.push(`Entre pelo ${nomeCurto(acesso.nome).toLowerCase()}.`);
  for (let i = 1; i < nos.length; i++) {
    const a = nosPorId[nos[i - 1]!], b = nosPorId[nos[i]!];
    if (!a || !b) continue;
    if (b.rotulo) passos.push(`Passe ${/^(retorno|acesso)/i.test(b.rotulo) ? 'pelo' : 'pela'} ${b.rotulo.toLowerCase()}.`);
    if (a.nivel !== b.nivel) passos.push(`Desça ao ${nomeDoNivel(b.nivel).toLowerCase()} pela rampa.`);
  }
  const r = regiaoDoMapa[regiaoId];
  if (r) passos.push(`Estacione na região ${r.id} (${r.nome}): ${r.referencia.charAt(0).toLowerCase()}${r.referencia.slice(1)}.`);
  return passos.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
}
