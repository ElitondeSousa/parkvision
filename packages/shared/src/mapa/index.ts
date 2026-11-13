import type { MapaDigital } from '../tipos.ts';
import dados from './capim-dourado.json' with { type: 'json' };

/** Mapa digital oficial do Capim Dourado Shopping (aprovado na Etapa 0). */
export const mapaCapimDourado = dados as unknown as MapaDigital;
