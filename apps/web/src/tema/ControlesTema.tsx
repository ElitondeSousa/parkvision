/** Canto dos controles de tema, presente nas três interfaces: alternância claro/escuro + abóbora (só no escuro). */
import { AboboraEasterEgg } from './AboboraEasterEgg.tsx';
import { BotaoTema } from './tema.tsx';

export function ControlesTema() {
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="controles-tema">
      <AboboraEasterEgg />
      <BotaoTema />
    </span>
  );
}
