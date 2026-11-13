/**
 * Eventos de sensor (virtuais hoje, reais no futuro — o formato é o mesmo: esquemaEventoSensor).
 *
 * Princípios:
 * - A ocupação da REGIÃO continua sendo a fonte da verdade. Não existe modelo de vaga individual.
 * - VAGA_OCUPADA / VAGA_LIBERADA representam a leitura feita na região (ex.: QR/placa lidos na entrada da região).
 *   Elas só mexem na ocupação pelo mesmo caminho da API (estacionar / registrarSaida), com as mesmas validações.
 *   Sem ticket associado, a leitura é registrada e ignorada (não dá para saber de quem é a vaga sem contar em dobro).
 * - Idempotência: o `eventoId` é chave primária em evento_sensor. O primeiro processamento "reserva" o id;
 *   o mesmo id de novo devolve DUPLICADO sem aplicar nada (inclusive com envios simultâneos).
 */
import type { EventoSensor } from '@parkvision/shared';
import { Prisma } from '@prisma/client';
import { ErroApi } from '../erros.ts';
import { buscarRegiao, calcularIndicadores } from './regioes.ts';
import { estacionar, registrarSaida, type Dependencias } from './tickets.ts';

export type ResultadoSensor =
  | 'APLICADO'
  | 'DUPLICADO'
  | 'IGNORADO_SEM_TICKET'
  | `REJEITADO_${string}`;

export interface RespostaSensor { eventoId: string; resultado: ResultadoSensor; mensagem?: string; resultadoOriginal?: string }

const ehDuplicidade = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function processarEventoSensor(
  deps: Dependencias,
  evento: EventoSensor,
  opcoes: { simulado?: boolean; agora?: Date } = {},
): Promise<RespostaSensor> {
  const { db, emissor } = deps;
  const agora = opcoes.agora ?? new Date(), simulado = opcoes.simulado ?? false;
  await buscarRegiao(db, evento.regiaoId, agora); // 404 se a região não existe (nada é registrado)

  // 1) reserva o id do evento — é isto que garante a idempotência
  try {
    await db.eventoSensor.create({
      data: {
        eventoId: evento.eventoId, sensorId: evento.sensorId, regiaoId: evento.regiaoId, tipo: evento.tipo,
        ticketCodigo: 'ticketCodigo' in evento ? (evento.ticketCodigo ?? null) : null,
        payload: evento as unknown as Prisma.InputJsonValue, resultado: 'PROCESSANDO', simulado, recebidoEm: agora,
      },
    });
  } catch (e) {
    if (!ehDuplicidade(e)) throw e;
    const original = await db.eventoSensor.findUnique({ where: { eventoId: evento.eventoId } });
    const resposta: RespostaSensor = { eventoId: evento.eventoId, resultado: 'DUPLICADO', resultadoOriginal: original?.resultado };
    emissor.emitir('simulador:sensor', evento.regiaoId, { eventoId: evento.eventoId, tipo: evento.tipo, regiaoId: evento.regiaoId, resultado: 'DUPLICADO' }, simulado);
    return resposta;
  }

  // 2) aplica
  let resultado: ResultadoSensor = 'APLICADO', mensagem: string | undefined;
  try {
    switch (evento.tipo) {
      case 'VAGA_OCUPADA':
        if (!evento.ticketCodigo) resultado = 'IGNORADO_SEM_TICKET';
        else await estacionar(deps, evento.ticketCodigo, evento.regiaoId, { agora, origem: simulado ? 'simulador' : 'sensor' });
        break;
      case 'VAGA_LIBERADA':
        if (!evento.ticketCodigo) resultado = 'IGNORADO_SEM_TICKET';
        else await registrarSaida(deps, evento.ticketCodigo, { agora, origem: simulado ? 'simulador' : 'sensor', regiaoEsperada: evento.regiaoId });
        break;
      case 'SEM_COMUNICACAO':
      case 'LEITURA_INCONSISTENTE':
      case 'SENSOR_NORMALIZADO': {
        const status = evento.tipo === 'SEM_COMUNICACAO' ? 'sem-comunicacao' : evento.tipo === 'LEITURA_INCONSISTENTE' ? 'inconsistente' : 'ok';
        await db.regiao.update({ where: { id: evento.regiaoId }, data: { statusSensores: status, statusSensoresSimulado: status !== 'ok' && simulado } });
        await emitirRegiao(deps, 'regiao:status', evento.regiaoId, agora, simulado);
        break;
      }
      case 'FLUXO':
        await db.regiao.update({
          where: { id: evento.regiaoId },
          data: { fluxoSensor: evento.veiculosEmCirculacao, fluxoSensorAte: new Date(agora.getTime() + evento.duracaoMin * 60_000), fluxoSimulado: simulado },
        });
        await emitirRegiao(deps, 'regiao:fluxo', evento.regiaoId, agora, simulado);
        break;
      case 'DISPONIBILIDADE':
        // a simulação nunca mexe no estado definido pelo operador: usa um bloqueio próprio, desfeito no reinício
        await db.regiao.update({ where: { id: evento.regiaoId }, data: simulado ? { bloqueioSimulado: !evento.disponivel } : { operacional: evento.disponivel } });
        await emitirRegiao(deps, 'regiao:status', evento.regiaoId, agora, simulado);
        break;
    }
  } catch (e) {
    if (!(e instanceof ErroApi)) {
      await db.eventoSensor.delete({ where: { eventoId: evento.eventoId } }).catch(() => {}); // libera o id para nova tentativa
      throw e;
    }
    resultado = `REJEITADO_${e.codigo}`;
    mensagem = e.message;
  }

  await db.eventoSensor.update({ where: { eventoId: evento.eventoId }, data: { resultado } });
  emissor.emitir('simulador:sensor', evento.regiaoId, { eventoId: evento.eventoId, tipo: evento.tipo, regiaoId: evento.regiaoId, resultado }, simulado);
  return { eventoId: evento.eventoId, resultado, ...(mensagem ? { mensagem } : {}) };
}

async function emitirRegiao(deps: Dependencias, tipo: 'regiao:status' | 'regiao:fluxo', id: string, agora: Date, simulado: boolean) {
  deps.emissor.emitir(tipo, id, await buscarRegiao(deps.db, id, agora), simulado);
  deps.emissor.emitir('indicadores:atualizados', 'indicadores', await calcularIndicadores(deps.db, agora), simulado);
}
