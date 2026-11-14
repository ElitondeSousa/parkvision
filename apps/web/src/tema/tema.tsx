/**
 * Tema claro/escuro do Golden Park.
 *  - Claro é o padrão para novos acessos (não segue o tema do sistema operacional).
 *  - A escolha fica salva no navegador (localStorage) e vale para as três interfaces.
 *  - Trocar o tema só muda o atributo data-theme do <html>: os tokens --pv-* do Design System fazem o resto, sem recarregar.
 * O index.html aplica o tema salvo antes do React montar (evita piscar no tema errado).
 */
import { Moon, Sun } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Tema = 'claro' | 'escuro';
export const CHAVE_TEMA = 'gp-tema';

export function temaSalvo(): Tema {
  try { return localStorage.getItem(CHAVE_TEMA) === 'escuro' ? 'escuro' : 'claro'; } catch { return 'claro'; }
}

export function aplicarTema(tema: Tema) {
  const raiz = document.documentElement;
  raiz.dataset.theme = tema === 'escuro' ? 'dark' : 'light';
  raiz.style.colorScheme = tema === 'escuro' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tema === 'escuro' ? '#0C111C' : '#F7F9FC');
}

interface ContextoTema { tema: Tema; definir: (t: Tema) => void; alternar: () => void }
const Contexto = createContext<ContextoTema>({ tema: 'claro', definir: () => {}, alternar: () => {} });

export function ProvedorTema({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(temaSalvo);
  useEffect(() => { aplicarTema(tema); }, [tema]);
  const definir = useCallback((t: Tema) => {
    setTema(t);
    try { localStorage.setItem(CHAVE_TEMA, t); } catch { /* sem storage: vale só nesta visita */ }
  }, []);
  const valor = useMemo(() => ({ tema, definir, alternar: () => definir(tema === 'claro' ? 'escuro' : 'claro') }), [tema, definir]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export const useTema = () => useContext(Contexto);

/** Botão de alternância de tema (sol/lua). */
export function BotaoTema({ className }: { className?: string }) {
  const { tema, alternar } = useTema();
  const escuro = tema === 'escuro';
  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={escuro}
      aria-label={escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
      title={escuro ? 'Modo claro' : 'Modo escuro'}
      data-testid="botao-tema"
      className={`inline-grid place-items-center size-11 rounded-full border border-line bg-surface text-ink cursor-pointer transition-colors hover:border-[var(--pv-brand-primary)] ${className ?? ''}`}
    >
      {escuro ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
