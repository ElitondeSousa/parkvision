/**
 * Carrinhos da simulação no mapa do painel — só visual.
 * A ocupação NÃO muda por causa deles: continua vindo do backend na confirmação e na saída.
 *  - veiculo:entrou (simulado) → o carrinho percorre a rota recomendada, do acesso até a região;
 *    o ritmo segue o tempo de manobra do simulador, então ele chega mais ou menos quando a confirmação acontece;
 *  - veiculo:saiu (simulado) → o carrinho faz o caminho de volta, da região até o acesso por onde entrou.
 */
import type { Categoria, Recomendacao, Ticket } from '@parkvision/shared';
import type { VeiculoAnimado } from './MapaEstacionamento.tsx';
import { comprimentoDoTrajeto, rotaDeSaida } from './navegacao.ts';

/** Velocidade visual de referência (unidades do mapa por segundo de tela) quando não há tempo de manobra conhecido. */
export const VELOCIDADE_VISUAL = 90;
export const DURACAO_MIN_MS = 2500;
export const DURACAO_MAX_MS = 12000;
export const MAX_VEICULOS_ANIMADOS = 30;

const limitar = (ms: number) => Math.min(DURACAO_MAX_MS, Math.max(DURACAO_MIN_MS, ms));

/** Duração da animação: tempo de manobra simulado ÷ velocidade do relógio, ou o comprimento ÷ velocidade visual. */
export function duracaoDoTrajeto(nos: string[], ritmo?: { tempoManobraSeg?: number; velocidade?: number }) {
  if (ritmo?.tempoManobraSeg && ritmo.velocidade) return limitar((ritmo.tempoManobraSeg * 1000) / ritmo.velocidade);
  return limitar((comprimentoDoTrajeto(nos) / VELOCIDADE_VISUAL) * 1000);
}

export function veiculoDeEntrada(dados: { ticket: Ticket; recomendacao: Recomendacao }, inicio: number, ritmo?: { tempoManobraSeg?: number; velocidade?: number }): VeiculoAnimado | null {
  const nos = dados.recomendacao?.rota?.nos;
  if (!nos || nos.length < 2) return null;
  return { id: `entrada-${dados.ticket.codigo}`, nos, categoria: dados.ticket.categoria as Categoria, inicio, duracao: duracaoDoTrajeto(nos, ritmo) };
}

export function veiculoDeSaida(dados: { ticket: Ticket; regiao: { id: string } | null }, inicio: number): VeiculoAnimado | null {
  if (!dados.regiao) return null;
  const nos = rotaDeSaida(dados.regiao.id, dados.ticket.acessoId);
  if (!nos || nos.length < 2) return null;
  return { id: `saida-${dados.ticket.codigo}`, nos, categoria: dados.ticket.categoria as Categoria, inicio, duracao: duracaoDoTrajeto(nos) };
}

/** Acrescenta respeitando o limite (descarta os mais antigos) e sem duplicar o mesmo carrinho. */
export function acrescentarVeiculo(lista: VeiculoAnimado[], v: VeiculoAnimado, max = MAX_VEICULOS_ANIMADOS) {
  return [...lista.filter((x) => x.id !== v.id), v].slice(-max);
}
