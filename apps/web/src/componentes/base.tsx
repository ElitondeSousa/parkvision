/**
 * Componentes base do Design System Golden Park (contratos em design-system/components/README.md).
 * Todos usam tokens --pv-*; telas só cuidam de layout.
 */
import { CircleCheck, Info, LoaderCircle, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { BrandLogo } from '../tema/BrandLogo.tsx';
import type { Tema } from '../tema/tema.tsx';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ── Marca ── (Golden Park: logo oficial conforme o tema — ver tema/BrandLogo.tsx)
export function Marca({ tamanho = 28, tema }: { tamanho?: number; tema?: Tema }) {
  return <BrandLogo variante="horizontal" altura={tamanho} tema={tema} />;
}

/**
 * Placa da região — elemento de sinalização do Golden Park: o código da região numa placa azul
 * de cantos arredondados, como a placa indicativa de estacionamento. Aparece no totem, no painel e no localizador.
 */
export function Placa({ codigo, tamanho = 'md', apagada = false }: { codigo: string; tamanho?: 'sm' | 'md' | 'lg' | 'xl'; apagada?: boolean }) {
  const t = { sm: 'h-7 min-w-9 px-1.5 text-sm rounded-[6px]', md: 'h-10 min-w-12 px-2 text-xl rounded-[8px]', lg: 'h-16 min-w-20 px-3 text-4xl rounded-[12px]', xl: 'h-28 min-w-32 px-5 text-7xl rounded-[18px]' }[tamanho];
  return (
    <span
      className={cx('inline-flex items-center justify-center font-display font-bold leading-none tracking-tight num', t)}
      style={{
        // placa chapada (wireframes aprovados): azul de placa com texto branco (6,65:1), sem moldura decorativa
        background: apagada ? 'var(--pv-bg-muted)' : 'var(--pv-color-vision-600)',
        color: apagada ? 'var(--pv-text-secondary)' : '#fff',
      }}
    >
      {codigo}
    </span>
  );
}

// ── Botão ──
/**
 * Botões dos wireframes: primário bronze (única cor de ação), secundário contornado em bronze, neutro grafite,
 * fantasma e perigo. Altura mínima de 44 px a partir do tamanho md (alvo de toque). Ao pressionar, encolhe 2%.
 */
type VarianteBotao = 'primario' | 'secundario' | 'neutro' | 'fantasma' | 'perigo';
export interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  tamanho?: 'sm' | 'md' | 'lg' | 'xl';
  carregando?: boolean;
  icone?: LucideIcon;
}
export function Botao({ variante = 'primario', tamanho = 'md', carregando, icone: Icone, children, className, disabled, ...resto }: BotaoProps) {
  const estilos: Record<VarianteBotao, string> = {
    primario: 'bg-[var(--pv-button-primary-bg)] text-[var(--pv-button-primary-fg)] hover:bg-[var(--pv-button-primary-bg-hover)] active:bg-[var(--pv-button-primary-bg-active)]',
    secundario: 'bg-[var(--pv-bg-surface)] text-[var(--pv-text-link)] border border-[var(--pv-brand-primary)] hover:bg-[var(--pv-brand-subtle)]',
    neutro: 'bg-[var(--pv-color-cinza-700)] text-white hover:brightness-110',
    fantasma: 'bg-transparent text-ink hover:bg-[var(--pv-button-ghost-bg-hover)]',
    perigo: 'bg-[var(--pv-button-danger-bg)] text-[var(--pv-button-danger-fg)] hover:brightness-95',
  };
  const alturas = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-4 text-sm', lg: 'h-12 px-5 text-base', xl: 'h-[72px] px-8 text-2xl font-display' }[tamanho];
  const inativo = disabled || carregando;
  return (
    <button
      {...resto}
      disabled={inativo}
      aria-busy={carregando || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--pv-button-radius)] font-semibold transition-[background-color,color,transform,filter] duration-150 ease-out select-none enabled:active:scale-[0.98]',
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

/**
 * Status dos wireframes: ponto + texto, sem pílula (a cor nunca é o único sinal).
 */
export type TomStatus = 'normal' | 'atencao' | 'perigo' | 'info' | 'offline';
const COR_STATUS: Record<TomStatus, [string, string]> = {
  normal: ['var(--pv-feedback-success-solid)', 'var(--pv-feedback-success-fg)'],
  atencao: ['var(--pv-feedback-warning-solid)', 'var(--pv-feedback-warning-fg)'],
  perigo: ['var(--pv-feedback-danger-solid)', 'var(--pv-feedback-danger-fg)'],
  info: ['var(--pv-feedback-info-solid)', 'var(--pv-feedback-info-fg)'],
  offline: ['var(--pv-text-muted)', 'var(--pv-text-secondary)'],
};
export function Status({ tom = 'normal', tamanho = 'sm', children, className }: { tom?: TomStatus; tamanho?: 'sm' | 'md' | 'lg'; children: ReactNode; className?: string }) {
  const [ponto, texto] = COR_STATUS[tom];
  const t = { sm: 'text-sm gap-1.5', md: 'text-base gap-2', lg: 'text-xl gap-2.5' }[tamanho];
  return (
    <span className={cx('inline-flex items-center font-medium whitespace-nowrap', t, className)} style={{ color: texto }}>
      <span className={cx('rounded-full shrink-0', tamanho === 'lg' ? 'size-3' : 'size-2')} style={{ background: ponto }} aria-hidden />
      {children}
    </span>
  );
}

/** Número dominante com rótulo (ex.: "Vagas livres 685 de 1.269"). */
export function Indicador({ rotulo, valor, complemento, tamanho = 'xl', testId }: { rotulo: string; valor: ReactNode; complemento?: ReactNode; tamanho?: 'md' | 'xl'; testId?: string }) {
  return (
    <div data-testid={testId}>
      <p className="m-0 text-sm text-ink-2">{rotulo}</p>
      <p className="m-0 flex items-baseline gap-2">
        <span className={cx('font-display font-bold num leading-none tracking-tight text-ink', tamanho === 'xl' ? 'text-[64px] sm:text-[80px]' : 'text-3xl')}>{valor}</span>
        {complemento && <span className="text-sm text-ink-2 num">{complemento}</span>}
      </p>
    </div>
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
        {/* a ação fica abaixo do texto: o aviso funciona igual em colunas estreitas */}
        {acao && <div className="mt-2.5">{acao}</div>}
      </div>
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
export function SeloDemonstracao({ testId }: { testId?: string } = {}) {
  return (
    <span data-testid={testId} className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold" style={{ background: 'var(--pv-wayfinding-subtle)', color: 'var(--pv-text-primary)', border: '1px solid var(--pv-wayfinding-route)' }}>
      Ambiente de demonstração · dados simulados
    </span>
  );
}
