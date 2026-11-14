/**
 * Ícones dos tipos de vaga, sempre acompanhados de texto (a cor nunca é o único sinal):
 *  - PcD: Símbolo Internacional de Acesso (cadeira de rodas);
 *  - pessoa idosa: selo "60+" (idade de referência do Estatuto da Pessoa Idosa);
 *  - comum: "P" de estacionamento.
 */
import { NOME_TIPO_VAGA, type TipoVaga } from '@parkvision/shared';
import { Accessibility } from 'lucide-react';

export const COR_TIPO_VAGA: Record<TipoVaga, string> = {
  COMUM: 'var(--pv-text-secondary)',
  PCD: 'var(--pv-vaga-reservada)',
  IDOSO: 'var(--pv-vaga-reservada)',
};

export function IconeTipoVaga({ tipo, tamanho = 24, className }: { tipo: TipoVaga; tamanho?: number; className?: string }) {
  if (tipo === 'PCD') return <Accessibility size={tamanho} aria-hidden className={className} strokeWidth={2.25} />;
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden className={className}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <text x="12" y="16.2" textAnchor="middle" fontSize={tipo === 'IDOSO' ? 9.5 : 13} fontWeight="800" fill="currentColor" style={{ fontFamily: 'var(--pv-font-family-sans)' }}>
        {tipo === 'IDOSO' ? '60+' : 'P'}
      </text>
    </svg>
  );
}

/** Selo compacto "♿ Vaga PcD" / "60+ Vaga para pessoa idosa" para cabeçalhos, ticket e painel. */
export function SeloTipoVaga({ tipo, curto = false }: { tipo: TipoVaga; curto?: boolean }) {
  const texto = curto ? ({ COMUM: 'Comum', PCD: 'PcD', IDOSO: 'Pessoa idosa' } as const)[tipo] : NOME_TIPO_VAGA[tipo];
  return (
    <span data-testid="selo-tipo-vaga" data-tipo={tipo} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-sm font-semibold whitespace-nowrap"
      style={{ background: 'var(--pv-bg-subtle)', color: 'var(--pv-text-primary)', border: `1.5px solid ${COR_TIPO_VAGA[tipo]}` }}>
      <IconeTipoVaga tipo={tipo} tamanho={16} />
      {texto}
    </span>
  );
}
