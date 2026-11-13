/** Configuração lida das variáveis de ambiente (ver .env.example na raiz). */
export interface Config {
  porta: number;
  webUrl: string;
  simuladorToken: string;
  /** Janela usada no critério de fluxo (ms). */
  janelaFluxoMs: number;
  /** Se definido, regiões sem atualização há mais tempo que isso ficam com dados inválidos. Desligado no MVP. */
  validadeDadosMs: number | null;
}

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    porta: Number(env.PORTA ?? 3333),
    webUrl: env.WEB_URL ?? 'http://localhost:5173',
    simuladorToken: env.SIMULADOR_TOKEN ?? 'troque-este-token',
    janelaFluxoMs: 5 * 60 * 1000,
    validadeDadosMs: env.VALIDADE_DADOS_MS ? Number(env.VALIDADE_DADOS_MS) : null,
  };
}

/** Vazão de referência por região (veículos a cada 5 min): proporcional à capacidade, mínimo 6. */
export const vazaoReferencia = (capacidade: number) => Math.max(6, Math.round(capacidade * 0.06));
