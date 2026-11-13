/** Apoio aos testes ponta a ponta: chamadas diretas à API de teste (porta 3334). */
import { request, type APIRequestContext } from '@playwright/test';

export const API = 'http://localhost:3334';
export const TOKEN = 'troque-este-token';

export async function apiTeste(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: API, extraHTTPHeaders: { 'x-simulador-token': TOKEN } });
}

/** Entrada pelo "totem" via API: devolve ticket, recomendação e o token do QR. */
export async function entrar(api: APIRequestContext, categoria = 'CARRO_PEQUENO', acessoId = 'A_NE') {
  const r = await api.post('/api/entradas', { data: { acessoId, categoria } });
  const corpo = await r.json();
  return { ...corpo, token: (corpo.qrUrl as string).split('/t/')[1]! } as { ticket: { codigo: string }; recomendacao: { regiaoId: string }; qrUrl: string; token: string };
}
