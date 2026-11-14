/**
 * Cálculos de navegação sobre o mapa digital (puros, sem React):
 *  - caminho suave (curvas arredondadas) passando SÓ pelos nós do grafo de vias;
 *  - posição ao longo da rota (para o veículo de demonstração);
 *  - enquadramento da câmera (ver a rota inteira / centralizar no destino) sem esconder o destino atrás do painel.
 */
import { menorCaminho } from '@parkvision/core';
import type { Nivel } from '@parkvision/shared';
import { NIVEIS, acessoPorId, mapa, nosPorId, regiaoDoMapa, trechosDaRota } from './dados.ts';

export type Ponto = [number, number];
export type Camera = [number, number, number, number]; // x, y, largura, altura (viewBox)

/** Pontos (xy) do trecho da rota que está no nível pedido. */
export function pontosNoNivel(nos: string[], nivel: Nivel): Ponto[] {
  const t = trechosDaRota(nos).find((x) => x.nivel === nivel);
  return t ? t.nos.map((id) => nosPorId[id]!.xy) : [];
}

/**
 * Path SVG contínuo pelos vértices, com as quinas arredondadas (raio limitado à metade de cada segmento),
 * para destacar as curvas sem sair do corredor.
 */
export function caminhoSuave(pts: Ponto[], raio: number): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!, [cx, cy] = pts[i + 1]!;
    const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
    const r = Math.min(raio, l1 / 2, l2 / 2);
    const p1: Ponto = [bx - ((bx - ax) / l1) * r, by - ((by - ay) / l1) * r];
    const p2: Ponto = [bx + ((cx - bx) / l2) * r, by + ((cy - by) / l2) * r];
    d += ` L${p1[0]} ${p1[1]} Q${bx} ${by} ${p2[0]} ${p2[1]}`;
  }
  const u = pts[pts.length - 1]!;
  return `${d} L${u[0]} ${u[1]}`;
}

export const comprimento = (pts: Ponto[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);

/** Posição e direção (graus) em uma fração t (0–1) do percurso. */
export function pontoNaRota(pts: Ponto[], t: number): { x: number; y: number; angulo: number } {
  if (pts.length === 0) return { x: 0, y: 0, angulo: 0 };
  if (pts.length === 1) return { x: pts[0]![0], y: pts[0]![1], angulo: 0 };
  let alvo = Math.max(0, Math.min(1, t)) * comprimento(pts);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!, l = Math.hypot(bx - ax, by - ay);
    if (alvo <= l || i === pts.length - 1) {
      const k = l ? Math.min(1, alvo / l) : 0;
      return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, angulo: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI };
    }
    alvo -= l;
  }
  const u = pts[pts.length - 1]!;
  return { x: u[0], y: u[1], angulo: 0 };
}

/** Pontos médios de cada segmento, com a direção — setas de sentido ao longo da rota. */
export function setasDaRota(pts: Ponto[], minimo: number) {
  return pts.slice(1).flatMap((p, i) => {
    const a = pts[i]!, l = Math.hypot(p[0] - a[0], p[1] - a[1]);
    return l < minimo ? [] : [{ x: (a[0] + p[0]) / 2, y: (a[1] + p[1]) / 2, angulo: (Math.atan2(p[1] - a[1], p[0] - a[0]) * 180) / Math.PI }];
  });
}

/** Caixa [x0, y0, x1, y1] que contém os pontos. */
export function caixa(pontos: Ponto[]): [number, number, number, number] {
  const xs = pontos.map((p) => p[0]), ys = pontos.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Câmera que mostra a caixa inteira na área VISÍVEL do mapa (descontando o painel inferior),
 * com folga e sem distorcer (a proporção da câmera é a do contêiner).
 */
export function enquadrar(cx: [number, number, number, number], largura: number, altura: number, painelPx = 0, folga = 1.25, ladoMinimo = 120): Camera {
  const visivel = Math.max(80, altura - painelPx);
  const bw = Math.max(cx[2] - cx[0], ladoMinimo), bh = Math.max(cx[3] - cx[1], ladoMinimo);
  const escala = Math.max(bw / largura, bh / visivel) * folga;        // unidades do mapa por pixel
  const w = largura * escala, h = altura * escala;
  const centroX = (cx[0] + cx[2]) / 2, centroY = (cx[1] + cx[3]) / 2;
  return [centroX - w / 2, centroY - (visivel * escala) / 2, w, h];
}

/** Zoom em torno de um ponto do mapa (fator > 1 aproxima), dentro de limites por nível. */
export function zoomEm(cam: Camera, fator: number, foco: Ponto, nivel: Nivel): Camera {
  const vb = NIVEIS.find((n) => n.id === nivel)!.viewBox;
  const maxW = Math.max(vb[2], vb[3]) * 1.6, minW = Math.max(vb[2], vb[3]) * 0.06;
  const w = Math.min(maxW, Math.max(minW, cam[2] / fator));
  const k = w / cam[2];
  return [foco[0] - (foco[0] - cam[0]) * k, foco[1] - (foco[1] - cam[1]) * k, w, cam[3] * k];
}

/** Caixa do destino (polígono da região) + trecho da rota no nível — o que "ver rota inteira" deve mostrar. */
export function caixaDaNavegacao(nos: string[] | null | undefined, destino: string | null | undefined, nivel: Nivel) {
  const pts: Ponto[] = [...(nos ? pontosNoNivel(nos, nivel) : [])];
  const r = destino ? regiaoDoMapa[destino] : undefined;
  if (r && r.nivel === nivel) pts.push(...r.poligono);
  if (!pts.length) { const vb = NIVEIS.find((n) => n.id === nivel)!.viewBox; return [vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3]] as [number, number, number, number]; }
  return caixa(pts);
}

/** Caminho de saída (região → acesso de entrada) pelo grafo, para animar a saída de um veículo simulado. */
export function rotaDeSaida(regiaoId: string, acessoId: string): string[] | null {
  const r = regiaoDoMapa[regiaoId], a = acessoPorId[acessoId];
  if (!r || !a) return null;
  const rota = menorCaminho(mapa, r.noAcesso, a.no);
  return rota?.nos ?? null;
}

/** Comprimento visual de uma rampa entre níveis (unidades do mapa): o carrinho "some" nesse intervalo. */
export const COMPRIMENTO_RAMPA = 120;

/**
 * Janelas de tempo (frações 0–1 do trajeto) em que o veículo está em cada nível.
 * Ex.: Térreo [0, 0.4], rampa, Subsolo 2 [0.55, 1]. Trechos de um só ponto viram janelas de largura zero.
 */
export function janelasPorNivel(nos: string[]): { nivel: Nivel; nos: string[]; pts: Ponto[]; a: number; b: number }[] {
  const trechos = trechosDaRota(nos).map((t) => ({ ...t, pts: t.nos.map((id) => nosPorId[id]!.xy) }));
  const comps = trechos.map((t) => comprimento(t.pts));
  const total = comps.reduce((s, c) => s + c, 0) + COMPRIMENTO_RAMPA * Math.max(0, trechos.length - 1);
  let acumulado = 0;
  return trechos.map((t, i) => {
    const a = total ? acumulado / total : 0;
    acumulado += comps[i]!;
    const b = total ? acumulado / total : 1;
    acumulado += COMPRIMENTO_RAMPA;
    return { ...t, a, b };
  });
}

/** Comprimento total do trajeto (com as rampas), em unidades do mapa. */
export const comprimentoDoTrajeto = (nos: string[]) => {
  const j = trechosDaRota(nos);
  return j.reduce((s, t) => s + comprimento(t.nos.map((id) => nosPorId[id]!.xy)), 0) + COMPRIMENTO_RAMPA * Math.max(0, j.length - 1);
};
