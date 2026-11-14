/**
 * Proposta de distribuição das vagas reservadas (PcD e pessoa idosa) entre as regiões — função pura e determinística.
 *
 * 1. Mínimos legais sobre o TOTAL do estacionamento (arredondados para cima; PcD com pelo menos 1).
 * 2. As vagas lidas na planta ficam onde a planta diz (SS1 e bloco central do SS2).
 * 3. O que falta vai para as regiões de carro do térreo (caminho a pé no mesmo nível da entrada — não validado em campo),
 *    na proporção capacidade × proximidade da entrada de pedestres, pelo método dos maiores restos,
 *    com no máximo 25% de cada região reservada.
 * É uma PROPOSTA SIMULADA: o painel permite ajustar cada região (fonte = operador).
 */
import { acessibilidade, caminhoPedestre, minimosLegais, type Categoria, type FonteVagasReservadas, type TipoReservado } from '@parkvision/shared';

export interface RegiaoParaDistribuir { id: string; capacidade: number; categorias: Categoria[] }
export interface VagasReservadasRegiao { pcd: number; idoso: number; fonte: FonteVagasReservadas }

/** Fração máxima da região que pode ser reservada pela proposta. */
export const FRACAO_MAXIMA_RESERVADA = 0.25;
/** Distância (unidades do mapa) em que a proximidade cai pela metade. */
export const DISTANCIA_REFERENCIA = 200;

const aceitaCarro = (r: RegiaoParaDistribuir) => r.categorias.some((c) => c !== 'MOTO');

/** Divide `quantidade` proporcionalmente aos pesos, sem passar do limite de cada item (maiores restos, determinístico). */
export function dividirProporcional(quantidade: number, itens: { id: string; peso: number; limite: number }[]): Record<string, number> {
  const resultado: Record<string, number> = Object.fromEntries(itens.map((i) => [i.id, 0]));
  let restante = quantidade;
  for (let rodada = 0; rodada < 20 && restante > 0; rodada++) {
    const abertos = itens.filter((i) => resultado[i.id]! < i.limite && i.peso > 0);
    const somaPesos = abertos.reduce((s, i) => s + i.peso, 0);
    if (!abertos.length || somaPesos <= 0) break;
    const cotas = abertos.map((i) => {
      const exata = (restante * i.peso) / somaPesos;
      const folga = i.limite - resultado[i.id]!;
      return { i, inteira: Math.min(folga, Math.floor(exata)), resto: exata - Math.floor(exata), folga };
    });
    let distribuido = 0;
    for (const c of cotas) { resultado[c.i.id]! += c.inteira; distribuido += c.inteira; }
    // maiores restos (empate: maior peso, depois código) — uma vaga a mais para cada, enquanto houver folga
    const sobra = restante - distribuido;
    const ordem = cotas.filter((c) => c.inteira < c.folga).sort((a, b) => b.resto - a.resto || b.i.peso - a.i.peso || a.i.id.localeCompare(b.i.id));
    for (const c of ordem.slice(0, sobra)) { resultado[c.i.id]! += 1; distribuido += 1; }
    restante -= distribuido;
    if (distribuido === 0) break;
  }
  return resultado;
}

export function distribuirVagasReservadas(regioes: RegiaoParaDistribuir[]): Record<string, VagasReservadasRegiao> {
  const total = regioes.reduce((s, r) => s + r.capacidade, 0);
  const minimos = minimosLegais(total);
  const saida: Record<string, VagasReservadasRegiao> = Object.fromEntries(regioes.map((r) => [r.id, { pcd: 0, idoso: 0, fonte: 'sem-reserva' as FonteVagasReservadas }]));

  // 2) planta
  for (const p of acessibilidade.vagasNaPlanta) {
    const r = regioes.find((x) => x.id === p.regiaoId);
    if (!r || !aceitaCarro(r)) continue;
    saida[r.id] = { pcd: p.pcd, idoso: p.idoso, fonte: 'planta' };
  }

  // 3) restante no térreo, perto das entradas de pedestres
  const candidatas = regioes.filter((r) => aceitaCarro(r) && saida[r.id]!.fonte !== 'planta' && caminhoPedestre(r.id).situacao === 'mesmo-nivel');
  const peso = (r: RegiaoParaDistribuir) => r.capacidade / (1 + (caminhoPedestre(r.id).distancia ?? Infinity) / DISTANCIA_REFERENCIA);
  for (const tipo of ['PCD', 'IDOSO'] as const satisfies readonly TipoReservado[]) {
    const campo = tipo === 'PCD' ? 'pcd' : 'idoso';
    const jaTem = Object.values(saida).reduce((s, v) => s + v[campo], 0);
    const falta = Math.max(0, minimos[tipo] - jaTem);
    if (!falta) continue;
    const partes = dividirProporcional(falta, candidatas.map((r) => ({
      id: r.id, peso: peso(r),
      limite: Math.max(0, Math.floor(r.capacidade * FRACAO_MAXIMA_RESERVADA) - saida[r.id]!.pcd - saida[r.id]!.idoso),
    })));
    for (const [id, n] of Object.entries(partes)) {
      if (!n) continue;
      saida[id]![campo] += n;
      saida[id]!.fonte = 'proposta';
    }
  }
  return saida;
}
