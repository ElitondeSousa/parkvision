/**
 * Apoio aos testes do core: monta regiões e entradas a partir do mapa real do Capim Dourado
 * e oferece um mapa sintético pequeno para os desempates que a planta não permite reproduzir.
 * Não é exportado pelo pacote.
 */
import { mapaCapimDourado } from '@parkvision/shared';
import type { Categoria, MapaDigital, Regiao } from '@parkvision/shared';
import type { EntradaRecomendacao } from '../index.ts';

export const AGORA = new Date('2026-11-13T12:00:00.000Z');
export const ACESSO_NE = 'n_A_NE';
export const REGIOES_CARRO = ['N1', 'N2', 'N3', 'S1', 'S2', 'SS1', 'SS2O', 'SS2C', 'SS2L'] as const;

/** Cópia profunda do mapa real (para testes que precisam alterá-lo). */
export function copiaDoMapa(): MapaDigital {
  return structuredClone(mapaCapimDourado);
}

export interface OpcoesRegiao {
  /** Vagas livres (padrão: todas). Ignorado se `ocupadas` for informado. */
  livres?: number;
  ocupadas?: number;
  operacional?: boolean;
  capacidade?: number;
  atualizadoEm?: string;
  /** Sobrescreve o campo `livres` enviado (para testar que o core recalcula). */
  livresInformado?: number;
}

/** Região no formato da API, a partir da região do mapa real. */
export function regiao(id: string, opcoes: OpcoesRegiao = {}, mapa: MapaDigital = mapaCapimDourado): Regiao {
  const doMapa = mapa.regioes.find((r) => r.id === id);
  const capacidade = opcoes.capacidade ?? doMapa?.capacidade.valor ?? 100;
  const ocupadas = opcoes.ocupadas ?? capacidade - (opcoes.livres ?? capacidade);
  return {
    id,
    nome: doMapa?.nome ?? id,
    nivel: doMapa?.nivel ?? 'terreo',
    categorias: doMapa ? [...doMapa.categorias] : ['CARRO_PEQUENO', 'CARRO_GRANDE'],
    capacidade,
    ocupadas,
    livres: opcoes.livresInformado ?? capacidade - ocupadas,
    operacional: opcoes.operacional ?? true,
    fonteCapacidade: 'desenho',
    atualizadoEm: opcoes.atualizadoEm ?? AGORA.toISOString(),
  };
}

/** Todas as regiões do mapa real, livres, com ajustes por id. */
export function todasAsRegioes(ajustes: Record<string, OpcoesRegiao> = {}): Regiao[] {
  return mapaCapimDourado.regioes.map((r) => regiao(r.id, ajustes[r.id]));
}

export function entrada(parcial: Partial<EntradaRecomendacao> = {}): EntradaRecomendacao {
  return {
    categoria: 'CARRO_PEQUENO' as Categoria,
    acessoNo: ACESSO_NE,
    regioes: todasAsRegioes(),
    fluxoRecente: {},
    vazaoReferencia: {},
    mapa: mapaCapimDourado,
    agora: AGORA,
    ...parcial,
  };
}

/** Lotada = ocupadas igual à capacidade. */
export const lotada: OpcoesRegiao = { livres: 0 };

/**
 * Mapa sintético: entrada `o` no centro e regiões R1, R2, R3 a 100, 200 e 300 unidades;
 * RA e RB ficam à mesma distância (100) para testar os desempates por vagas e por código.
 */
export const mapaSintetico: MapaDigital = {
  versao: 'teste',
  status: 'teste',
  niveis: [],
  categorias: [],
  acessos: [],
  ligacoesEntreNiveis: [],
  nos: [
    { id: 'o', nivel: 'terreo', xy: [0, 0] },
    { id: 'a', nivel: 'terreo', xy: [100, 0] },
    { id: 'b', nivel: 'terreo', xy: [-100, 0] },
    { id: 'r1', nivel: 'terreo', xy: [0, 100] },
    { id: 'r2', nivel: 'terreo', xy: [0, 200] },
    { id: 'r3', nivel: 'terreo', xy: [0, 300] },
  ],
  arestas: [
    { de: 'o', para: 'a', sentido: 'duplo' },
    { de: 'o', para: 'b', sentido: 'duplo' },
    { de: 'o', para: 'r1', sentido: 'duplo' },
    { de: 'r1', para: 'r2', sentido: 'duplo' },
    { de: 'r2', para: 'r3', sentido: 'duplo' },
  ],
  regioes: (
    [['RA', 'a'], ['RB', 'b'], ['R1', 'r1'], ['R2', 'r2'], ['R3', 'r3']] as const
  ).map(([id, no]) => ({
    id,
    nome: id,
    nivel: 'terreo' as const,
    coberta: false,
    referencia: 'teste',
    categorias: ['CARRO_PEQUENO', 'CARRO_GRANDE'] as Categoria[],
    capacidade: { valor: 100, fonte: 'simulada' as const, observacao: 'teste' },
    poligono: [],
    noAcesso: no,
  })),
};

/** Todas as permutações de uma lista (para provar que a ordem de entrada não muda o resultado). */
export function permutacoes<T>(lista: T[]): T[][] {
  if (lista.length <= 1) return [lista];
  return lista.flatMap((item, i) =>
    permutacoes([...lista.slice(0, i), ...lista.slice(i + 1)]).map((resto) => [item, ...resto]),
  );
}

/** Congela recursivamente (qualquer escrita lança erro em módulo ES, que é estrito). */
export function congelarProfundo<T>(valor: T): T {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const filho of Object.values(valor)) congelarProfundo(filho);
  }
  return valor;
}
