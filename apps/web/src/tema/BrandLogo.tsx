/**
 * Logo oficial do Golden Park, escolhida pelo tema:
 *   modo claro  → logo dourada e preta
 *   modo escuro → logo dourada e bege
 * As imagens são as logos fornecidas pela equipe, só recortadas e com o fundo creme removido
 * (design-system/scripts/preparar-logos.py) — sem redesenho. A proporção é sempre a natural da imagem (só a altura é definida).
 */
import { useTema, type Tema } from './tema.tsx';

export type VarianteLogo = 'completo' | 'simbolo' | 'nome' | 'horizontal';

/** Proporção (largura/altura) de cada recorte, para reservar o espaço e evitar salto de layout. */
const PROPORCAO: Record<Tema, Record<'completo' | 'simbolo' | 'nome', number>> = {
  claro: { completo: 1088 / 828, simbolo: 658 / 578, nome: 1055 / 171 },
  escuro: { completo: 1089 / 829, simbolo: 651 / 579, nome: 1057 / 181 },
};

export const srcDaLogo = (tema: Tema, parte: 'completo' | 'simbolo' | 'nome') => `/marca/golden-park-${tema}-${parte}.png`;

export interface BrandLogoProps {
  variante?: VarianteLogo;
  /** Altura em px (a largura segue a proporção original). */
  altura?: number;
  /** Força uma versão independente do tema (ex.: ticket impresso, que é sempre papel claro). */
  tema?: Tema;
  className?: string;
}

export function BrandLogo({ variante = 'horizontal', altura = 32, tema: temaForcado, className }: BrandLogoProps) {
  const { tema: temaAtual } = useTema();
  const tema = temaForcado ?? temaAtual;
  const img = (parte: 'completo' | 'simbolo' | 'nome', h: number, alt: string) => (
    <img
      src={srcDaLogo(tema, parte)}
      alt={alt}
      height={h}
      width={Math.round(h * PROPORCAO[tema][parte])}
      data-logo={`${tema}-${parte}`}
      style={{ height: h, width: 'auto' }}
      draggable={false}
    />
  );
  if (variante === 'horizontal') {
    // símbolo + nome lado a lado (cabeçalhos); os dois recortes vêm da mesma logo
    return (
      <span className={`inline-flex items-center gap-2 ${className ?? ''}`} role="img" aria-label="Golden Park" data-testid="brand-logo" data-tema-logo={tema}>
        {img('simbolo', altura, '')}
        {img('nome', Math.round(altura * 0.56), '')}
      </span>
    );
  }
  return (
    <span className={`inline-flex ${className ?? ''}`} data-testid="brand-logo" data-tema-logo={tema}>
      {img(variante, altura, 'Golden Park — sistema inteligente de estacionamento')}
    </span>
  );
}
