/**
 * Menor caminho no grafo do mapa digital (Dijkstra).
 *
 * - Custo de uma aresta = distância euclidiana entre os `xy` dos nós (unidades relativas da planta).
 * - Arestas `unico` valem só no sentido `de → para`; `duplo` e `a-confirmar` valem nos dois sentidos.
 * - `ligacoesEntreNiveis` entram como arestas de mão dupla com custo = `custoEstimado`
 *   (são suposições até a equipe confirmar as rampas); ligações sem custo são ignoradas.
 *
 * Função pura: não altera o mapa e sempre devolve o mesmo resultado para a mesma entrada.
 */
import type { MapaDigital, Rota } from '@parkvision/shared';

interface Vizinho {
  para: string;
  custo: number;
}

type Grafo = Map<string, Vizinho[]>;

function distanciaEuclidiana(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function adicionar(grafo: Grafo, de: string, para: string, custo: number): void {
  grafo.get(de)?.push({ para, custo });
}

/** Monta a lista de adjacência a partir do mapa. Arestas com nó inexistente são ignoradas. */
function montarGrafo(mapa: MapaDigital): Grafo {
  const posicao = new Map<string, [number, number]>();
  const grafo: Grafo = new Map();
  for (const no of mapa.nos) {
    posicao.set(no.id, no.xy);
    grafo.set(no.id, []);
  }

  for (const aresta of mapa.arestas) {
    const a = posicao.get(aresta.de);
    const b = posicao.get(aresta.para);
    if (!a || !b) continue;
    const custo = distanciaEuclidiana(a, b);
    adicionar(grafo, aresta.de, aresta.para, custo);
    if (aresta.sentido !== 'unico') adicionar(grafo, aresta.para, aresta.de, custo);
  }

  for (const ligacao of mapa.ligacoesEntreNiveis ?? []) {
    const custo = ligacao.custoEstimado;
    if (typeof custo !== 'number' || !Number.isFinite(custo) || custo < 0) continue;
    if (!grafo.has(ligacao.de) || !grafo.has(ligacao.para)) continue;
    adicionar(grafo, ligacao.de, ligacao.para, custo);
    adicionar(grafo, ligacao.para, ligacao.de, custo);
  }

  return grafo;
}

const arredondar1 = (valor: number): number => Math.round(valor * 10) / 10;

/**
 * Menor caminho entre dois nós do mapa.
 * @returns `{ nos, custo }` com o custo arredondado a 1 casa, ou `null` se não houver rota
 *          (ou se algum dos nós não existir no mapa).
 */
export function menorCaminho(mapa: MapaDigital, origem: string, destino: string): Rota | null {
  const grafo = montarGrafo(mapa);
  if (!grafo.has(origem) || !grafo.has(destino)) return null;
  if (origem === destino) return { nos: [origem], custo: 0 };

  const distancia = new Map<string, number>([[origem, 0]]);
  const anterior = new Map<string, string>();
  const visitados = new Set<string>();

  // O grafo é pequeno (dezenas de nós): a seleção linear do próximo nó basta e é determinística
  // (empate de distância resolvido pelo id do nó).
  for (;;) {
    let atual: string | null = null;
    let menor = Infinity;
    for (const [no, d] of distancia) {
      if (visitados.has(no)) continue;
      if (d < menor || (d === menor && atual !== null && no < atual)) {
        atual = no;
        menor = d;
      }
    }
    if (atual === null) return null;
    if (atual === destino) break;
    visitados.add(atual);

    for (const { para, custo } of grafo.get(atual) ?? []) {
      if (visitados.has(para)) continue;
      const candidata = menor + custo;
      const conhecida = distancia.get(para);
      if (conhecida === undefined || candidata < conhecida) {
        distancia.set(para, candidata);
        anterior.set(para, atual);
      }
    }
  }

  const nos: string[] = [destino];
  let passo = destino;
  while (passo !== origem) {
    const ant = anterior.get(passo);
    if (ant === undefined) return null; // não deve acontecer: destino foi alcançado
    nos.push(ant);
    passo = ant;
  }
  nos.reverse();

  return { nos, custo: arredondar1(distancia.get(destino) ?? 0) };
}
