/**
 * Silhuetas das categorias de veículo (vista lateral), desenhadas para o totem e reutilizadas nas outras telas.
 * Traço simples e cheio para ler bem de longe e em tela de toque.
 */
import type { Categoria } from '@parkvision/shared';

const SILHUETAS: Record<Categoria, string> = {
  // hatch compacto: capô curto, teto arredondado
  CARRO_PEQUENO: 'M10 34h-3a3 3 0 0 1-3-3v-5c0-2 1.2-3.4 3.2-3.9l7.5-1.9 6.6-6.2A8 8 0 0 1 26.8 12H42a7 7 0 0 1 5.6 2.8l4.6 6.2h3.3A4.5 4.5 0 0 1 60 25.5V31a3 3 0 0 1-3 3h-3M24 34h16',
  // SUV / picape: cabine alta e caçamba
  CARRO_GRANDE: 'M9 35H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 2.4-2.9L13 20.5l4.8-7.1A5 5 0 0 1 22 11h14a3 3 0 0 1 3 3v8h20a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-3M23 35h18',
  // motocicleta: garfo, tanque e banco
  MOTO: 'M13 33L21 16M16 15h8M22 22c4-3 8-3 12-1h11c3 0 5 1 5 4M37 30l13 3M21 25l6 3',
};
const RODAS: Record<Categoria, [number, number, number][]> = {
  CARRO_PEQUENO: [[17, 34, 6], [47, 34, 6]],
  CARRO_GRANDE: [[16, 35, 7], [48, 35, 7]],
  MOTO: [[13, 33, 7.5], [50, 33, 7.5]],
};

export function IconeCategoria({ categoria, tamanho = 64, className }: { categoria: Categoria; tamanho?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 44" width={tamanho} height={(tamanho * 44) / 64} className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d={SILHUETAS[categoria]} />
      {RODAS[categoria].map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} />)}
      {categoria === 'MOTO' && <rect x={27} y={24} width={10} height={8} rx={2} />}
    </svg>
  );
}
