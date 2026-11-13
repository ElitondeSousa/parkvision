/**
 * Componentes base do Design System ParkVision (contratos em design-system/components/README.md).
 * Todos usam tokens --pv-*; telas só cuidam de layout.
 */
import { CircleCheck, Info, LoaderCircle, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ── Marca ──
export function Simbolo({ tamanho = 32, titulo = 'ParkVision' }: { tamanho?: number; titulo?: string }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 64 64" role="img" aria-label={titulo}>
      <rect width="64" height="64" rx="14" fill="var(--pv-color-vision-600)" />
      <rect x="17" y="13" width="8" height="38" rx="2" fill="#fff" />
      <path fill="#fff" fillRule="evenodd" d="M21 13h14a14 14 0 0 1 0 28H21zM35 20.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z" />
      <circle cx="35" cy="27" r="3" fill="var(--pv-color-faixa-500)" />
    </svg>
  );
}

export function Marca({ claro = false, tamanho = 28 }: { claro?: boolean; tamanho?: number }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label="ParkVision">
      <Simbolo tamanho={tamanho} titulo="" />
      <span className="font-display text-xl leading-none" aria-hidden="true">
        <span className="font-semibold" style={{ color: claro ? '#fff' : 'var(--pv-text-primary)' }}>Park</span>
        <span className="font-bold" style={{ color: claro ? 'var(--pv-color-vision-300)' : 'var(--pv-brand-primary)' }}>Vision</span>
      </span>
    </span>
  );
}

/**
 * Placa da região — o elemento de identidade do ParkVision: o código da região numa placa azul
 * de cantos arredondados, como a placa indicativa de estacionamento. Aparece no totem, no painel e no localizador.
 */
export function Placa({ codigo, tamanho = 'md', apagada = false }: { codigo: string; tamanho?: 'sm' | 'md' | 'lg' | 'xl'; apagada?: boolean }) {
  const t = { sm: 'h-7 min-w-9 px-1.5 text-sm rounded-[6px]', md: 'h-10 min-w-12 px-2 text-xl rounded-[8px]', lg: 'h-16 min-w-20 px-3 text-4xl rounded-[12px]', xl: 'h-28 min-w-32 px-5 text-7xl rounded-[18px]' }[tamanho];
  return (
    <span
      className={cx('inline-flex items-center justify-center font-display font-bold leading-none tracking-tight num', t)}
      style={{
        background: apagada ? 'var(--pv-bg-muted)' : 'var(--pv-color-vision-600)',
        color: apagada ? 'var(--pv-text-secondary)' : '#fff',
        boxShadow: apagada ? 'none' : 'inset 0 0 0 2px rgba(255,255,255,.85), inset 0 0 0 4px var(--pv-color-vision-600)',
      }}
    >
      {codigo}
    </span>
  );
}

// ── Botão ──
type VarianteBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';
export interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  tamanho?: 'sm' | 'md' | 'lg' | 'xl';
  carregando?: boolean;
  icone?: LucideIcon;
}
export function Botao({ variante = 'primario', tamanho = 'md', carregando, icone: Icone, children, className, disabled, ...resto }: BotaoProps) {
  const estilos: Record<VarianteBotao, string> = {
    primario: 'bg-[var(--pv-button-primary-bg)] text-[var(--pv-button-primary-fg)] hover:bg-[var(--pv-button-primary-bg-hover)] active:bg-[var(--pv-button-primary-bg-active)]',
    secundario: 'bg-[var(--pv-button-secondary-bg)] text-[var(--pv-button-secondary-fg)] border border-[var(--pv-button-secondary-border)] hover:bg-[var(--pv-bg-subtle)]',
    fantasma: 'bg-transparent text-ink hover:bg-[var(--pv-button-ghost-bg-hover)]',
    perigo: 'bg-[var(--pv-button-danger-bg)] text-[var(--pv-button-danger-fg)] hover:brightness-95',
  };
  const alturas = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-base', xl: 'h-20 px-8 text-2xl font-display' }[tamanho];
  const inativo = disabled || carregando;
  return (
    <button
      {...resto}
      disabled={inativo}
      aria-busy={carregando || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--pv-button-radius)] font-semibold transition-colors duration-100 select-none',
        'disabled:opacity-[var(--pv-button-disabled-opacity)] disabled:cursor-not-allowed cursor-pointer',
        estilos[variante], alturas, className,
      )}
    >
      {carregando ? <LoaderCircle className="gira" size={tamanho === 'xl' ? 28 : 18} aria-hidden /> : Icone && <Icone size={tamanho === 'xl' ? 28 : 18} aria-hidden />}
      {carregando ? 'Processando…' : children}
    </button>
  );
}

// ── Cartão ──
export function Cartao({ titulo, acao, children, className, id }: { titulo?: ReactNode; acao?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-label={typeof titulo === 'string' ? titulo : undefined} className={cx('bg-[var(--pv-card-bg)] border border-[var(--pv-card-border)] rounded-[var(--pv-card-radius)]', className)}>
      {titulo && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <h2 className="text-base font-semibold">{titulo}</h2>
          {acao}
        </header>
      )}
      <div className={titulo ? 'px-4 pb-4' : 'p-4'}>{children}</div>
    </section>
  );
}

// ── Selo (StatusBadge) ──
export type TomSelo = 'sucesso' | 'atencao' | 'perigo' | 'info' | 'neutro' | 'erro';
const TONS: Record<TomSelo, [string, string]> = {
  sucesso: ['var(--pv-feedback-success-bg)', 'var(--pv-feedback-success-fg)'],
  atencao: ['var(--pv-feedback-warning-bg)', 'var(--pv-feedback-warning-fg)'],
  perigo: ['var(--pv-feedback-danger-bg)', 'var(--pv-feedback-danger-fg)'],
  info: ['var(--pv-feedback-info-bg)', 'var(--pv-feedback-info-fg)'],
  neutro: ['var(--pv-status-indisponivel-bg)', 'var(--pv-status-indisponivel-fg)'],
  erro: ['var(--pv-status-erro-bg)', 'var(--pv-status-erro-fg)'],
};
export function Selo({ tom = 'neutro', icone: Icone, children }: { tom?: TomSelo; icone?: LucideIcon; children: ReactNode }) {
  const [bg, fg] = TONS[tom];
  return (
    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-semibold whitespace-nowrap" style={{ background: bg, color: fg }}>
      {Icone && <Icone size={13} aria-hidden strokeWidth={2.25} />}
      {children}
    </span>
  );
}

// ── Medidor de ocupação ──
export function Medidor({ valor, total, cor, rotulo }: { valor: number; total: number; cor: string; rotulo: string }) {
  const pct = total ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={valor} aria-label={rotulo} className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--pv-meter-track)' }}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: cor }} />
    </div>
  );
}

// ── Aviso (Alert) ──
export type TomAviso = 'info' | 'sucesso' | 'atencao' | 'erro';
const ICONE_AVISO: Record<TomAviso, LucideIcon> = { info: Info, sucesso: CircleCheck, atencao: TriangleAlert, erro: OctagonAlert };
const COR_AVISO: Record<TomAviso, [string, string, string]> = {
  info: ['var(--pv-feedback-info-bg)', 'var(--pv-feedback-info-fg)', 'var(--pv-feedback-info-solid)'],
  sucesso: ['var(--pv-feedback-success-bg)', 'var(--pv-feedback-success-fg)', 'var(--pv-feedback-success-solid)'],
  atencao: ['var(--pv-feedback-warning-bg)', 'var(--pv-feedback-warning-fg)', 'var(--pv-feedback-warning-solid)'],
  erro: ['var(--pv-feedback-danger-bg)', 'var(--pv-feedback-danger-fg)', 'var(--pv-feedback-danger-solid)'],
};
export function Aviso({ tom = 'info', titulo, children, acao }: { tom?: TomAviso; titulo: ReactNode; children?: ReactNode; acao?: ReactNode }) {
  const Icone = ICONE_AVISO[tom];
  const [bg, fg, solido] = COR_AVISO[tom];
  return (
    <div role={tom === 'erro' ? 'alert' : 'status'} className="flex gap-3 rounded-md p-3.5" style={{ background: bg, color: fg, borderLeft: `4px solid ${solido}` }}>
      <Icone size={20} aria-hidden className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold m-0">{titulo}</p>
        {children && <div className="text-sm mt-0.5">{children}</div>}
      </div>
      {acao && <div className="shrink-0 self-center">{acao}</div>}
    </div>
  );
}

// ── Estados vazio / carregando ──
export function EstadoVazio({ icone: Icone, titulo, children }: { icone: LucideIcon; titulo: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-8 px-4 text-ink-2">
      <Icone size={28} aria-hidden strokeWidth={1.75} />
      <p className="font-semibold text-ink m-0">{titulo}</p>
      {children && <p className="text-sm m-0 max-w-xs">{children}</p>}
    </div>
  );
}

export function Esqueleto({ className }: { className?: string }) {
  return <div className={cx('esqueleto', className)} aria-hidden="true" />;
}

export function Carregando({ rotulo = 'Carregando…' }: { rotulo?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-ink-2 text-sm">
      <LoaderCircle size={18} className="gira" aria-hidden /> {rotulo}
    </div>
  );
}

/** Selo de dados de demonstração: obrigatório onde houver números do simulador. */
export function SeloDemonstracao() {
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold" style={{ background: 'var(--pv-wayfinding-subtle)', color: 'var(--pv-text-primary)', border: '1px solid var(--pv-wayfinding-route)' }}>
      Ambiente de demonstração · dados simulados
    </span>
  );
}
