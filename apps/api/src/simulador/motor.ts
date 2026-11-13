/**
 * Motor do simulador do ParkVision (Etapa 2).
 *
 * - Roda dentro da API e usa a MESMA camada de serviços das rotas REST (entrada, confirmação, saída, sensores),
 *   então todas as regras valem igualmente para veículos simulados e reais.
 * - Simulação de eventos discretos com relógio simulado próprio: o tempo avança em `processarAte(alvo)`,
 *   executando em ordem cada evento devido (chegada, confirmação, saída, eventos agendados, falhas de sensor).
 * - Gerador pseudoaleatório com semente (mulberry32): mesma semente + mesmos passos = mesmo resultado.
 * - Modo automático (timer de 250 ms × velocidade) ou passo a passo (`avancar`), usado nos testes.
 * - Tudo o que ele grava leva `simulado = true`; o reinício só apaga isso (dados reais ficam intactos).
 */
import { CATEGORIAS, type Categoria, type CenarioId, type ConfigSimulacao, type EventoManual, type EventoSensor, type Regiao } from '@parkvision/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { ErroApi } from '../erros.ts';
import { calcularIndicadores, listarRegioes } from '../servicos/regioes.ts';
import { processarEventoSensor, type RespostaSensor } from '../servicos/sensores.ts';
import { cancelar, hashToken, novaRecomendacao, registrarEntrada, type Dependencias } from '../servicos/tickets.ts';
import { CENARIOS_DEF, type DefinicaoCenario, type EventoCenario } from './cenarios.ts';

export type StatusSimulacao = 'parado' | 'rodando' | 'pausado';
export type ConfigResolvida = Required<ConfigSimulacao>;

export const CONFIG_PADRAO: ConfigResolvida = {
  modo: 'automatico',
  velocidade: 60,
  entradasPorMinuto: 6,
  permanenciaMediaMin: 90,
  maxVeiculos: 0,
  proporcaoCategorias: { CARRO_PEQUENO: 0.6, CARRO_GRANDE: 0.25, MOTO: 0.15 },
  chanceIgnorarRecomendacao: 0.1,
  tempoManobraSeg: 90,
  chanceFalhaSensorPorMin: 0,
  chanceEventoDuplicado: 0,
  semente: 42,
};

/** Gerador pseudoaleatório determinístico (mulberry32). Retorna números em [0, 1). */
export function mulberry32(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const zerarEstatisticas = () => ({
  entradas: 0, semRegiao: 0, confirmacoes: 0, rejeicoesLotada: 0, rejeicoesIndisponivel: 0, novasRecomendacoes: 0,
  recomendacoesIgnoradas: 0, cancelamentos: 0, saidas: 0, eventosSensor: 0, duplicadosIgnorados: 0, falhasSensor: 0, erros: 0,
});
export type Estatisticas = ReturnType<typeof zerarEstatisticas>;

interface Pendente { codigo: string; categoria: Categoria; regiaoAlvo: string; confirmarEm: number; tentativas: number }
interface Estacionado { codigo: string; regiaoId: string; sairEm: number }
interface Agendado { em: number; rotulo: string; executar: () => Promise<unknown> }
interface Alerta { codigo: string; mensagem: string; ticketCodigo?: string; regiaoId?: string; em: string }

const MAX_TENTATIVAS = 3;
const ACESSOS_COM_TOTEM = ['A_NE', 'A_ROT', 'A_S1', 'A_S2'];

export class MotorSimulacao {
  status: StatusSimulacao = 'parado';
  cenario: CenarioId | null = null;
  config: ConfigResolvida = structuredClone(CONFIG_PADRAO);
  estatisticas: Estatisticas = zerarEstatisticas();

  private relogio = Date.now();
  private inicio = Date.now();
  private rng = mulberry32(CONFIG_PADRAO.semente);
  private pendentes = new Map<string, Pendente>();
  private estacionados = new Map<string, Estacionado>();
  private agenda: Agendado[] = [];
  private proximaChegada = Infinity;
  private proximaVerificacaoSensores = Infinity;
  private gerados = 0;
  private alertas: Alerta[] = [];
  private fila: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickOcupado = false;
  private dtAcumulado = 0;

  constructor(private deps: Dependencias, private opcoes: { automatico?: boolean; tickMs?: number } = {}) {}

  /** Relógio usado pela API: simulado enquanto a simulação existe; real quando parada. */
  agora(): Date {
    return new Date(this.status === 'parado' ? Date.now() : this.relogio);
  }

  // ───────────────────────────── controle ─────────────────────────────

  iniciar(pedido: { cenario?: CenarioId; config?: ConfigSimulacao } = {}) {
    return this.exclusivo(async () => {
      if (this.status !== 'parado') throw new ErroApi('SIMULACAO_ESTADO_INVALIDO', `A simulação já está ${this.status}. Use pausar/retomar/encerrar.`);
      await this.iniciarInterno(pedido);
      this.emitirEstado('iniciado');
      return this.estadoAtual();
    });
  }

  /** Ativa um cenário: encerra o que estiver rodando, reinicia os dados simulados e começa o cenário. */
  aplicarCenario(cenario: CenarioId, config?: ConfigSimulacao) {
    return this.exclusivo(async () => {
      this.pararInterno();
      await this.iniciarInterno({ cenario, config });
      this.emitirEstado('iniciado');
      return this.estadoAtual();
    });
  }

  pausar() {
    return this.exclusivo(async () => {
      if (this.status !== 'rodando') throw new ErroApi('SIMULACAO_ESTADO_INVALIDO', `Só é possível pausar uma simulação rodando (está ${this.status}).`);
      this.status = 'pausado';
      this.desligarTimer();
      this.emitirEstado('pausado');
      return this.estadoAtual();
    });
  }

  retomar() {
    return this.exclusivo(async () => {
      if (this.status !== 'pausado') throw new ErroApi('SIMULACAO_ESTADO_INVALIDO', `Só é possível retomar uma simulação pausada (está ${this.status}).`);
      this.status = 'rodando';
      this.ligarTimer();
      this.emitirEstado('retomado');
      return this.estadoAtual();
    });
  }

  /** Para a simulação e mantém os dados simulados no banco (para análise). */
  encerrar() {
    return this.exclusivo(async () => {
      if (this.status === 'parado') throw new ErroApi('SIMULACAO_ESTADO_INVALIDO', 'A simulação já está parada.');
      const estado = this.estadoAtual();
      this.pararInterno();
      this.emitirEstado('encerrado');
      return { ...estado, status: this.status };
    });
  }

  /** Reinício seguro: para a simulação e remove SOMENTE os dados simulados, devolvendo as vagas que eles ocupavam. */
  reiniciar() {
    return this.exclusivo(async () => {
      this.pararInterno();
      const removidos = await this.limparDadosSimulados();
      this.cenario = null;
      this.estatisticas = zerarEstatisticas();
      this.alertas = [];
      this.emitirEstado('reiniciado');
      return { removidos, estado: this.estadoAtual() };
    });
  }

  configurar(parcial: ConfigSimulacao) {
    return this.exclusivo(async () => {
      const anterior = this.config;
      this.config = resolverConfig(this.config, parcial);
      if (parcial.semente !== undefined && parcial.semente !== anterior.semente) this.rng = mulberry32(this.config.semente);
      if (this.status !== 'parado') {
        if (anterior.entradasPorMinuto !== this.config.entradasPorMinuto) this.agendarChegada();
        this.agendarVerificacaoSensores();
      }
      this.emitirEstado('configurado');
      return this.estadoAtual();
    });
  }

  /** Avança o relógio simulado (modo passo a passo; também funciona com a simulação pausada). */
  avancar(segundos: number) {
    return this.exclusivo(async () => {
      if (this.status === 'parado') throw new ErroApi('SIMULACAO_ESTADO_INVALIDO', 'Inicie a simulação antes de avançar o relógio.');
      await this.processarAte(this.relogio + segundos * 1000);
      return this.estadoAtual();
    });
  }

  /** Eventos manuais (modo manual, testes e apresentações). */
  executarManual(ev: EventoManual) {
    if (ev.acao === 'avancar') return this.avancar(ev.segundos);
    return this.exclusivo(async () => {
      switch (ev.acao) {
        case 'entrada': {
          const categoria = ev.categoria ?? this.sortearCategoria(CATEGORIAS);
          const acessoId = ev.acessoId ?? this.sortear(ACESSOS_COM_TOTEM)!;
          const r = await registrarEntrada(this.deps, { categoria, acessoId }, { simulado: true, agora: this.agora(), origem: 'simulador' });
          this.estatisticas.entradas++;
          const automatico = this.status !== 'parado' && this.config.modo === 'automatico';
          this.pendentes.set(r.ticket.codigo, {
            codigo: r.ticket.codigo, categoria, regiaoAlvo: r.recomendacao.regiaoId, tentativas: 0,
            confirmarEm: automatico ? this.relogio + this.tempoManobra() : Infinity,
          });
          return r;
        }
        case 'confirmar': {
          const t = await this.ticketSimulado(ev.codigo);
          const destino = ev.regiaoId ?? t.regiaoRecomendadaId;
          const p = this.pendentes.get(t.codigo) ?? { codigo: t.codigo, categoria: t.categoria as Categoria, regiaoAlvo: t.regiaoRecomendadaId, confirmarEm: Infinity, tentativas: 0 };
          return this.confirmar(p, destino, false);
        }
        case 'saida': {
          const codigo = ev.codigo ?? this.sortear([...this.estacionados.keys()].sort());
          if (!codigo) throw new ErroApi('TRANSICAO_INVALIDA', 'Nenhum veículo simulado estacionado para sair.');
          const t = await this.ticketSimulado(codigo);
          const regiaoId = t.regiaoEstacionadaId ?? t.regiaoRecomendadaId;
          return this.sair({ codigo, regiaoId, sairEm: this.relogio });
        }
        case 'fluxo':
          return this.enviarSensor({ tipo: 'FLUXO', regiaoId: ev.regiaoId, veiculosEmCirculacao: ev.veiculosEmCirculacao, duracaoMin: ev.duracaoMin });
        case 'disponibilidade':
          return this.enviarSensor({ tipo: 'DISPONIBILIDADE', regiaoId: ev.regiaoId, disponivel: ev.disponivel });
        case 'sensor':
          return this.enviarSensor({
            tipo: ev.status === 'ok' ? 'SENSOR_NORMALIZADO' : ev.status === 'sem-comunicacao' ? 'SEM_COMUNICACAO' : 'LEITURA_INCONSISTENTE',
            regiaoId: ev.regiaoId,
          });
      }
    });
  }

  estadoAtual() {
    return {
      status: this.status,
      modo: this.config.modo,
      cenario: this.cenario,
      descricaoCenario: this.cenario ? CENARIOS_DEF[this.cenario].descricao : null,
      velocidade: this.config.velocidade,
      relogioSimulado: this.relogio,
      relogioSimuladoIso: new Date(this.relogio).toISOString(),
      decorridoSimuladoSeg: Math.round((this.relogio - this.inicio) / 1000),
      config: this.config,
      estatisticas: { ...this.estatisticas },
      veiculos: { aguardando: this.pendentes.size, estacionados: this.estacionados.size, gerados: this.gerados },
      agendados: [...this.agenda].sort((a, b) => a.em - b.em).map((a) => ({ em: new Date(a.em).toISOString(), rotulo: a.rotulo })),
      ultimosAlertas: this.alertas.slice(-20),
      dadosSimulados: true,
    };
  }

  /** Libera o timer (ao fechar a API). */
  desligar() {
    this.desligarTimer();
  }

  // ───────────────────────────── núcleo ─────────────────────────────

  private exclusivo<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.fila.then(fn);
    this.fila = p.catch(() => {});
    return p;
  }

  private async iniciarInterno({ cenario, config }: { cenario?: CenarioId; config?: ConfigSimulacao }) {
    const def = cenario ? CENARIOS_DEF[cenario] : null;
    this.config = resolverConfig(resolverConfig(CONFIG_PADRAO, def?.config ?? {}), config ?? {});
    this.rng = mulberry32(this.config.semente);
    this.relogio = this.inicio = Date.now();
    this.estatisticas = zerarEstatisticas();
    this.alertas = [];
    this.gerados = 0;
    this.agenda = [];
    this.pendentes.clear();
    this.estacionados.clear();

    if (def) {
      await this.limparDadosSimulados();
      await this.preencher(def);
      this.cenario = def.id;
      for (const { aposMin, evento } of def.eventos) {
        this.agenda.push({ em: this.inicio + aposMin * 60_000, rotulo: `${evento.tipo} ${evento.regiaoId}`, executar: () => this.enviarSensor(evento) });
      }
      this.deps.emissor.emitir('simulador:cenario', 'simulador', { cenario: def.id, descricao: `${def.nome}: ${def.descricao}` }, true);
    } else {
      this.cenario = null;
      await this.carregarVeiculosDoBanco();
    }

    this.status = 'rodando';
    this.agendarChegada();
    this.agendarVerificacaoSensores();
    await this.processarAte(this.relogio); // eventos do instante zero
    this.ligarTimer();
  }

  private pararInterno() {
    this.desligarTimer();
    this.status = 'parado';
    this.pendentes.clear();
    this.estacionados.clear();
    this.agenda = [];
    this.proximaChegada = this.proximaVerificacaoSensores = Infinity;
  }

  /** Executa, em ordem cronológica, todos os eventos devidos até `alvo` (ms do relógio simulado). */
  private async processarAte(alvo: number) {
    for (let guarda = 0; guarda < 200_000; guarda++) {
      const prox = this.proximoEvento();
      if (!prox || prox.em > alvo) break;
      this.relogio = Math.max(this.relogio, prox.em);
      try {
        await prox.executar();
      } catch (e) {
        this.estatisticas.erros++;
        this.alertar(e instanceof ErroApi ? e.codigo : 'ERRO_INTERNO', e instanceof Error ? e.message : String(e));
      }
    }
    this.relogio = Math.max(this.relogio, alvo);
  }

  private proximoEvento(): { em: number; executar: () => Promise<unknown> } | null {
    let melhor: { em: number; executar: () => Promise<unknown> } | null = null;
    const considerar = (em: number, executar: () => Promise<unknown>) => {
      if (Number.isFinite(em) && (!melhor || em < melhor.em)) melhor = { em, executar };
    };
    for (const a of this.agenda) considerar(a.em, () => { this.agenda.splice(this.agenda.indexOf(a), 1); return a.executar(); });
    considerar(this.proximaVerificacaoSensores, () => this.verificarSensores());
    if (this.config.modo === 'automatico') {
      considerar(this.proximaChegada, () => this.chegada());
      for (const p of this.pendentes.values()) considerar(p.confirmarEm, () => this.confirmar(p, null, true));
      for (const e of this.estacionados.values()) considerar(e.sairEm, () => this.sair(e));
    }
    return melhor;
  }

  // ───────────────────────────── ações dos veículos ─────────────────────────────

  private async chegada() {
    this.agendarChegada();
    if (this.config.maxVeiculos && this.gerados >= this.config.maxVeiculos) {
      this.proximaChegada = Infinity;
      return;
    }
    this.gerados++;
    const categoria = this.sortearCategoria(CATEGORIAS);
    const acessoId = this.sortear(ACESSOS_COM_TOTEM)!;
    try {
      const r = await registrarEntrada(this.deps, { categoria, acessoId }, { simulado: true, agora: this.agora(), origem: 'simulador' });
      this.estatisticas.entradas++;
      this.pendentes.set(r.ticket.codigo, { codigo: r.ticket.codigo, categoria, regiaoAlvo: r.recomendacao.regiaoId, confirmarEm: this.relogio + this.tempoManobra(), tentativas: 0 });
    } catch (e) {
      if (!(e instanceof ErroApi) || e.codigo !== 'SEM_REGIAO_ELEGIVEL') throw e;
      this.estatisticas.semRegiao++;
      this.alertar('SEM_REGIAO_ELEGIVEL', `Nenhuma região elegível para ${categoria} no acesso ${acessoId}; o veículo não recebeu ticket.`);
    }
  }

  /**
   * Confirmação de estacionamento (via evento de sensor de vaga, com o mesmo id de idempotência).
   * Região cheia/indisponível ⇒ a confirmação é rejeitada e o motorista recebe uma nova recomendação.
   */
  private async confirmar(p: Pendente, destinoManual: string | null, automatico: boolean) {
    let destino = destinoManual ?? p.regiaoAlvo;
    if (automatico && p.tentativas === 0) {
      const ignorar = this.rng() < this.config.chanceIgnorarRecomendacao;
      if (ignorar) {
        const alternativa = await this.regiaoAlternativa(p.categoria, destino);
        if (alternativa) { destino = alternativa; this.estatisticas.recomendacoesIgnoradas++; }
      }
    }
    const r = await this.enviarSensor({ tipo: 'VAGA_OCUPADA', regiaoId: destino, ticketCodigo: p.codigo });
    if (r.resultado === 'APLICADO') {
      this.pendentes.delete(p.codigo);
      this.estacionados.set(p.codigo, { codigo: p.codigo, regiaoId: destino, sairEm: this.relogio + this.exponencial(this.config.permanenciaMediaMin * 60_000) });
      this.estatisticas.confirmacoes++;
      return { ...r, ticketCodigo: p.codigo, regiaoId: destino };
    }
    if (r.resultado === 'REJEITADO_REGIAO_LOTADA' || r.resultado === 'REJEITADO_REGIAO_INDISPONIVEL') {
      const lotada = r.resultado === 'REJEITADO_REGIAO_LOTADA';
      if (lotada) this.estatisticas.rejeicoesLotada++; else this.estatisticas.rejeicoesIndisponivel++;
      this.alertar(lotada ? 'REGIAO_LOTADA' : 'REGIAO_INDISPONIVEL', `Confirmação do ${p.codigo} em ${destino} rejeitada (${lotada ? 'região cheia' : 'região indisponível'}); pedindo nova recomendação.`, p.codigo, destino);
      const nova = await this.reRecomendar(p, `Região ${destino} ${lotada ? 'lotou' : 'ficou indisponível'} antes da confirmação`, automatico);
      return { ...r, ticketCodigo: p.codigo, regiaoId: destino, novaRecomendacao: nova };
    }
    // outra rejeição (ex.: ticket já não está aguardando): sai do controle do motor
    this.pendentes.delete(p.codigo);
    this.estatisticas.erros++;
    this.alertar(r.resultado, r.mensagem ?? `Confirmação do ${p.codigo} rejeitada`, p.codigo, destino);
    return { ...r, ticketCodigo: p.codigo, regiaoId: destino };
  }

  private async reRecomendar(p: Pendente, motivo: string, automatico: boolean) {
    p.tentativas++;
    if (automatico && p.tentativas > MAX_TENTATIVAS) {
      await this.desistir(p, `${p.codigo} desistiu após ${MAX_TENTATIVAS} tentativas.`);
      return null;
    }
    try {
      const n = await novaRecomendacao(this.deps, p.codigo, motivo, { agora: this.agora() });
      this.estatisticas.novasRecomendacoes++;
      p.regiaoAlvo = n.recomendacao.regiaoId;
      p.confirmarEm = automatico ? this.relogio + this.tempoManobra() : Infinity;
      this.pendentes.set(p.codigo, p);
      return n.recomendacao;
    } catch (e) {
      if (!(e instanceof ErroApi) || e.codigo !== 'SEM_REGIAO_ELEGIVEL') throw e;
      this.estatisticas.semRegiao++;
      await this.desistir(p, `Sem região elegível para o ${p.codigo}; ticket cancelado.`);
      return null;
    }
  }

  private async desistir(p: Pendente, mensagem: string) {
    await cancelar(this.deps, p.codigo, { agora: this.agora() });
    this.pendentes.delete(p.codigo);
    this.estatisticas.cancelamentos++;
    this.alertar('DESISTENCIA', mensagem, p.codigo);
  }

  private async sair(e: Estacionado) {
    this.estacionados.delete(e.codigo);
    const r = await this.enviarSensor({ tipo: 'VAGA_LIBERADA', regiaoId: e.regiaoId, ticketCodigo: e.codigo });
    if (r.resultado === 'APLICADO') this.estatisticas.saidas++;
    else { this.estatisticas.erros++; this.alertar(r.resultado, r.mensagem ?? `Saída do ${e.codigo} rejeitada`, e.codigo, e.regiaoId); }
    return { ...r, ticketCodigo: e.codigo, regiaoId: e.regiaoId };
  }

  private async verificarSensores() {
    this.proximaVerificacaoSensores = this.relogio + 60_000;
    if (this.rng() >= this.config.chanceFalhaSensorPorMin) return;
    const candidatas = (await listarRegioes(this.deps.db, this.agora())).filter((r) => r.statusSensores === 'ok');
    const regiao = this.sortear(candidatas);
    if (!regiao) return;
    const tipo = this.rng() < 0.5 ? 'SEM_COMUNICACAO' : 'LEITURA_INCONSISTENTE';
    await this.enviarSensor({ tipo, regiaoId: regiao.id });
    this.estatisticas.falhasSensor++;
    this.alertar('FALHA_SENSOR', `Sensores da região ${regiao.id}: ${tipo === 'SEM_COMUNICACAO' ? 'sem comunicação' : 'leitura inconsistente'}.`, undefined, regiao.id);
    const volta = this.relogio + (2 + this.rng() * 8) * 60_000;
    this.agenda.push({ em: volta, rotulo: `SENSOR_NORMALIZADO ${regiao.id}`, executar: () => this.enviarSensor({ tipo: 'SENSOR_NORMALIZADO', regiaoId: regiao.id }) });
  }

  /** Envia um evento de sensor virtual (e, às vezes, a mesma leitura de novo para exercitar a idempotência). */
  private async enviarSensor(parcial: EventoCenario | { tipo: 'VAGA_OCUPADA' | 'VAGA_LIBERADA'; regiaoId: string; ticketCodigo: string }): Promise<RespostaSensor> {
    const evento = { ...parcial, eventoId: randomUUID(), sensorId: `SIM-${parcial.regiaoId}` } as EventoSensor;
    const r = await processarEventoSensor(this.deps, evento, { simulado: true, agora: this.agora() });
    this.estatisticas.eventosSensor++;
    if (this.config.chanceEventoDuplicado > 0 && this.rng() < this.config.chanceEventoDuplicado) {
      const dup = await processarEventoSensor(this.deps, evento, { simulado: true, agora: this.agora() });
      if (dup.resultado === 'DUPLICADO') this.estatisticas.duplicadosIgnorados++;
    }
    return r;
  }

  // ───────────────────────────── dados ─────────────────────────────

  /** Completa a ocupação de cada região até o alvo do cenário com veículos simulados já estacionados. */
  private async preencher(def: DefinicaoCenario) {
    const regioes = await listarRegioes(this.deps.db, this.agora());
    for (const r of regioes) {
      const espec = def.ocupacaoPorRegiao?.[r.id];
      const alvo = espec?.livres !== undefined ? r.capacidade - espec.livres : Math.round(r.capacidade * (espec?.fracao ?? def.ocupacaoInicial));
      const n = Math.min(r.capacidade, Math.max(0, alvo)) - r.ocupadas;
      if (n > 0) await this.criarEstacionados(r, n);
    }
  }

  private async criarEstacionados(r: Regiao, n: number) {
    const permanencia = this.config.permanenciaMediaMin * 60_000;
    const dados = Array.from({ length: n }, () => {
      const entradaEm = this.relogio - this.rng() * permanencia;
      return {
        codigo: `PVS-${randomBytes(5).toString('hex').toUpperCase()}`,
        tokenHash: hashToken(randomBytes(16).toString('base64url')),
        categoria: this.sortearCategoria(r.categorias),
        acessoId: this.sortear(ACESSOS_COM_TOTEM)!,
        regiaoRecomendadaId: r.id,
        regiaoEstacionadaId: r.id,
        status: 'ESTACIONADO' as const,
        entradaEm: new Date(entradaEm),
        estacionadoEm: new Date(entradaEm + 60_000),
        simulado: true,
      };
    });
    const criados = await this.deps.db.$transaction(async (tx) => {
      // incremento condicionado: o preenchimento também nunca passa da capacidade
      const linhas = await tx.$executeRaw`UPDATE regiao SET ocupadas = ocupadas + ${n}::int, "atualizadoEm" = now() WHERE id = ${r.id} AND ocupadas + ${n}::int <= capacidade`;
      if (linhas === 0) throw new ErroApi('REGIAO_LOTADA', `Não cabem mais ${n} veículos em ${r.id}`);
      await tx.eventoOcupacao.create({ data: { regiaoId: r.id, tipo: 'AJUSTE', origem: 'simulador:preenchimento', simulado: true, ocorridoEm: new Date(this.relogio) } });
      return tx.ticket.createManyAndReturn({ data: dados, select: { codigo: true } });
    }, { timeout: 30_000 });
    for (const c of criados) {
      this.estacionados.set(c.codigo, { codigo: c.codigo, regiaoId: r.id, sairEm: this.relogio + this.exponencial(permanencia) });
    }
  }

  /** Retoma o controle dos veículos simulados que já estão no banco (iniciar sem cenário). */
  private async carregarVeiculosDoBanco() {
    const tickets = await this.deps.db.ticket.findMany({ where: { simulado: true, status: { in: ['AGUARDANDO', 'ESTACIONADO'] } }, orderBy: { numero: 'asc' } });
    for (const t of tickets) {
      if (t.status === 'ESTACIONADO' && t.regiaoEstacionadaId) {
        this.estacionados.set(t.codigo, { codigo: t.codigo, regiaoId: t.regiaoEstacionadaId, sairEm: this.relogio + this.exponencial(this.config.permanenciaMediaMin * 60_000) });
      } else {
        this.pendentes.set(t.codigo, { codigo: t.codigo, categoria: t.categoria as Categoria, regiaoAlvo: t.regiaoRecomendadaId, confirmarEm: this.relogio + this.tempoManobra(), tentativas: 0 });
      }
    }
  }

  /**
   * Remove apenas o que é simulado: tickets (e, em cascata, recomendações e eventos de ocupação), eventos de sensor,
   * bloqueios, falhas e fluxo simulados. A ocupação é DECREMENTADA pelo número de veículos simulados estacionados
   * em cada região (não é recalculada), preservando a ocupação real e os ajustes do operador.
   */
  private async limparDadosSimulados() {
    const resumo = await this.deps.db.$transaction(async (tx) => {
      const porRegiao = await tx.ticket.groupBy({ by: ['regiaoEstacionadaId'], where: { simulado: true, status: 'ESTACIONADO' }, _count: true });
      let vagasLiberadas = 0;
      for (const g of porRegiao) {
        if (!g.regiaoEstacionadaId) continue;
        await tx.$executeRaw`UPDATE regiao SET ocupadas = GREATEST(0, ocupadas - ${g._count}::int), "atualizadoEm" = now() WHERE id = ${g.regiaoEstacionadaId}`;
        vagasLiberadas += g._count;
      }
      const sensores = await tx.eventoSensor.deleteMany({ where: { simulado: true } });
      await tx.eventoOcupacao.deleteMany({ where: { simulado: true } });
      const tickets = await tx.ticket.deleteMany({ where: { simulado: true } });
      await tx.regiao.updateMany({ where: { bloqueioSimulado: true }, data: { bloqueioSimulado: false } });
      await tx.regiao.updateMany({ where: { statusSensoresSimulado: true }, data: { statusSensores: 'ok', statusSensoresSimulado: false } });
      await tx.regiao.updateMany({ where: { fluxoSimulado: true }, data: { fluxoSensor: 0, fluxoSensorAte: null, fluxoSimulado: false } });
      return { tickets: tickets.count, eventosSensor: sensores.count, vagasLiberadas };
    }, { timeout: 30_000 });
    const agora = new Date();
    for (const r of await listarRegioes(this.deps.db, agora)) this.deps.emissor.emitir('regiao:ocupacao', r.id, r, true);
    this.deps.emissor.emitir('indicadores:atualizados', 'indicadores', await calcularIndicadores(this.deps.db, agora), true);
    return resumo;
  }

  private async ticketSimulado(codigo: string) {
    const t = await this.deps.db.ticket.findUnique({ where: { codigo } });
    if (!t) throw new ErroApi('TICKET_NAO_ENCONTRADO', `Ticket ${codigo} não encontrado`);
    if (!t.simulado) throw new ErroApi('DADOS_INVALIDOS', `O simulador só opera veículos simulados (${codigo} é real).`);
    return t;
  }

  private async regiaoAlternativa(categoria: Categoria, evitar: string) {
    const opcoes = (await listarRegioes(this.deps.db, this.agora())).filter((r) => r.id !== evitar && r.operacional && r.categorias.includes(categoria));
    return this.sortear(opcoes)?.id ?? null;
  }

  // ───────────────────────────── utilitários ─────────────────────────────

  private agendarChegada() {
    const taxa = this.config.entradasPorMinuto;
    this.proximaChegada = this.status === 'parado' || taxa <= 0 ? Infinity : this.relogio + this.exponencial(60_000 / taxa);
  }

  private agendarVerificacaoSensores() {
    this.proximaVerificacaoSensores = this.status !== 'parado' && this.config.chanceFalhaSensorPorMin > 0 ? this.relogio + 60_000 : Infinity;
  }

  private tempoManobra() {
    return this.config.tempoManobraSeg * 1000 * (0.6 + this.rng() * 0.8);
  }

  private exponencial(media: number) {
    return -Math.log(1 - this.rng()) * media;
  }

  private sortear<T>(lista: readonly T[]): T | undefined {
    return lista.length ? lista[Math.floor(this.rng() * lista.length)] : undefined;
  }

  private sortearCategoria(permitidas: readonly Categoria[]): Categoria {
    const pesos = permitidas.map((c) => this.config.proporcaoCategorias[c]);
    const total = pesos.reduce((s, p) => s + p, 0);
    if (total <= 0) return permitidas[0]!;
    let x = this.rng() * total;
    for (let i = 0; i < permitidas.length; i++) { x -= pesos[i]!; if (x < 0) return permitidas[i]!; }
    return permitidas[permitidas.length - 1]!;
  }

  private alertar(codigo: string, mensagem: string, ticketCodigo?: string, regiaoId?: string) {
    this.alertas.push({ codigo, mensagem, ticketCodigo, regiaoId, em: new Date(this.relogio).toISOString() });
    if (this.alertas.length > 100) this.alertas.shift();
    this.deps.emissor.emitir('simulador:alerta', ticketCodigo ?? regiaoId ?? 'simulador', { codigo, mensagem, ...(ticketCodigo ? { ticketCodigo } : {}), ...(regiaoId ? { regiaoId } : {}) }, true);
  }

  private emitirEstado(acao: 'iniciado' | 'pausado' | 'retomado' | 'encerrado' | 'reiniciado' | 'configurado') {
    this.deps.emissor.emitir('simulador:estado', 'simulador', { status: this.status, cenario: this.cenario, relogioSimulado: this.relogio, velocidade: this.config.velocidade, acao }, true);
  }

  private ligarTimer() {
    if (!this.opcoes.automatico || this.timer || this.status !== 'rodando') return;
    const tickMs = this.opcoes.tickMs ?? 250;
    this.timer = setInterval(() => this.tick(tickMs), tickMs);
    this.timer.unref?.();
  }

  private desligarTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.dtAcumulado = 0;
  }

  /** Um tique do modo automático: avança tickMs × velocidade de tempo simulado (acumula se o tique anterior atrasou). */
  private tick(tickMs: number) {
    this.dtAcumulado = Math.min(this.dtAcumulado + tickMs * this.config.velocidade, 5 * 60_000);
    if (this.tickOcupado) return;
    this.tickOcupado = true;
    const dt = this.dtAcumulado;
    this.dtAcumulado = 0;
    this.exclusivo(async () => { if (this.status === 'rodando') await this.processarAte(this.relogio + dt); })
      .catch((e) => this.alertar('ERRO_INTERNO', e instanceof Error ? e.message : String(e)))
      .finally(() => { this.tickOcupado = false; });
  }
}

/** Junta uma configuração parcial na atual e normaliza as proporções de categoria. */
export function resolverConfig(base: ConfigResolvida, parcial: ConfigSimulacao): ConfigResolvida {
  const definidos = Object.fromEntries(Object.entries(parcial).filter(([, v]) => v !== undefined)) as ConfigSimulacao;
  const config = { ...base, ...definidos, proporcaoCategorias: { ...base.proporcaoCategorias, ...(definidos.proporcaoCategorias ?? {}) } };
  const soma = CATEGORIAS.reduce((s, c) => s + config.proporcaoCategorias[c], 0);
  if (soma <= 0) throw new ErroApi('DADOS_INVALIDOS', 'As proporções de categoria não podem ser todas zero');
  config.proporcaoCategorias = Object.fromEntries(CATEGORIAS.map((c) => [c, config.proporcaoCategorias[c] / soma])) as ConfigResolvida['proporcaoCategorias'];
  return config;
}
