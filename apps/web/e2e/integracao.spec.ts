/**
 * Etapa 4 — testes de integração ponta a ponta: totem + painel + localizador + API + banco + algoritmo + simulador + Socket.IO.
 * Os comentários [n] indicam o caso obrigatório coberto (enunciado da Etapa 4, §13).
 */
import { expect, test, type APIRequestContext, type Page, type WebSocketRoute } from '@playwright/test';
import { apiTeste, TOKEN } from './apoio.ts';
import preparar from './preparar.ts';

type RegiaoApi = { id: string; nome: string; nivel: string; capacidade: number; ocupadas: number; livres: number; categorias: string[]; vagas: Record<'COMUM' | 'PCD' | 'IDOSO', { capacidade: number; ocupadas: number; livres: number }> };
const regioes = async (api: APIRequestContext) => (await (await api.get('/api/regioes')).json()) as RegiaoApi[];
const ocupadas = async (api: APIRequestContext, id: string) => (await regioes(api)).find((r) => r.id === id)!.ocupadas;
const total = async (api: APIRequestContext) => (await regioes(api)).reduce((s, r) => s + r.ocupadas, 0);
const NOME_NIVEL: Record<string, string> = { terreo: 'Térreo', ss1: 'Subsolo 1', ss2: 'Subsolo 2' };

async function abrirPainel(page: Page) {
  await page.goto('/painel');
  await page.getByLabel(/Token do operador/).fill(TOKEN);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Ao vivo')).toBeVisible();
}
async function operar(painel: Page, codigo: string) {
  const caixa = painel.getByTestId('operacao-ticket');
  await caixa.getByLabel('Código do ticket').fill(codigo);
  await caixa.getByRole('button', { name: 'Consultar' }).click();
  await expect(caixa.getByText(codigo, { exact: true })).toBeVisible();
  return caixa;
}
async function emitirNoTotem(totem: Page, categoria: RegExp, acesso = 'A_NE') {
  await totem.goto(`/totem?acesso=${acesso}`);
  await totem.getByRole('button', { name: 'Começar' }).click();
  await totem.getByRole('button', { name: categoria }).click();
  await totem.getByRole('button', { name: /^Vaga comum/ }).click();
  await expect(totem.getByTestId('justificativa')).toBeVisible({ timeout: 10_000 });
  const regiao = (await totem.getByTestId('mapa-estacionamento').locator('[data-destino="true"]').getAttribute('data-regiao'))!;
  await totem.getByRole('button', { name: 'Emitir ticket' }).click();
  const codigo = (await totem.getByTestId('codigo-ticket').textContent())!.trim();
  const qrUrl = (await totem.getByTestId('qr-code').getAttribute('data-conteudo'))!;
  return { regiao, codigo, token: qrUrl.split('/t/')[1]! };
}

// cada caso começa do mesmo estado: simulação parada e banco de TESTE recarregado (ocupação zerada)
test.beforeEach(async () => {
  const api = await apiTeste();
  await api.post('/api/simulacao/reiniciar');
  preparar();
});

test('fluxo completo do motorista com as três interfaces abertas ao mesmo tempo [1–13]', async ({ browser }) => {
  const api = await apiTeste();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const [painel, totem] = [await ctx.newPage(), await ctx.newPage()];
  await abrirPainel(painel);
  const antes = await total(api);

  // [1][3][4] entrada pelo totem, recomendação do algoritmo e ticket com QR
  const { regiao: recomendada, codigo, token } = await emitirNoTotem(totem, /Carro grande/);
  await expect(totem.getByTestId('qr-code').locator('svg')).toBeVisible();

  // [2] o backend registrou o veículo e vinculou a recomendação ao ticket
  const consulta = await (await api.get(`/api/tickets/${codigo}`)).json();
  expect(consulta.ticket).toMatchObject({ codigo, categoria: 'CARRO_GRANDE', status: 'AGUARDANDO', regiaoRecomendadaId: recomendada });
  expect(consulta.recomendacoes.at(-1).regiaoId).toBe(recomendada);
  // [6] recomendação + ticket não mexem na ocupação (sem reserva)
  expect(await total(api)).toBe(antes);

  // [8][13] o painel recebeu a entrada em tempo real, sem recarregar
  await expect(painel.getByTestId('movimentacoes')).toContainText(`${codigo} entrou (carro grande, suv ou picape)`);
  await expect(painel.getByTestId('recomendacao-atual')).toContainText(codigo);
  // [9] o mapa do painel destaca a região recomendada
  const mapa = await (await api.get('/api/mapa')).json() as { regioes: { id: string; nivel: string }[] };
  await painel.getByRole('tab', { name: new RegExp(`^${NOME_NIVEL[mapa.regioes.find((r) => r.id === recomendada)!.nivel]}`) }).click();
  await expect(painel.getByTestId('mapa-estacionamento').locator('[data-destino="true"]')).toHaveAttribute('data-regiao', recomendada);

  // [5] o QR Code abre o localizador do ticket
  const localizador = await ctx.newPage();
  await localizador.goto(`/t/${token}`);
  await expect(localizador.getByText('Estacionamento ainda não confirmado')).toBeVisible();
  await expect(localizador.getByTestId('ao-vivo')).toContainText('se atualiza sozinha');

  // [7] confirmação pelo painel (o motorista parou em outra região compatível) modifica a ocupação
  const destino = recomendada === 'S2' ? 'S1' : 'S2';
  const antesDestino = await ocupadas(api, destino);
  const caixa = await operar(painel, codigo);
  await caixa.getByLabel('Região onde o veículo estacionou').selectOption(destino);
  await caixa.getByRole('button', { name: 'Confirmar estacionamento' }).click();
  await expect(caixa.getByText(`Estacionamento confirmado em ${destino}`)).toBeVisible();
  expect(await ocupadas(api, destino)).toBe(antesDestino + 1);
  // [8] painel atualizado sem recarregar: tabela, mapa e movimentações
  await expect(painel.locator(`tr[data-regiao="${destino}"] td`).nth(3)).toContainText(String((await regioes(api)).find((r) => r.id === destino)!.livres));
  await expect(painel.getByTestId('movimentacoes')).toContainText(`${codigo} estacionou em ${destino}`);
  // [10][12] o localizador (aberto antes) mostra sozinho a região EFETIVAMENTE ocupada, não a recomendada
  await expect(localizador.getByTestId('regiao-registrada')).toHaveText(destino === 'S2' ? 'Sul Leste' : 'Sul Oeste', { timeout: 10_000 });
  await expect(localizador.getByTestId('mapa-estacionamento').locator('[data-destino="true"]')).toHaveAttribute('data-regiao', destino);

  // [11] saída pelo painel reduz a ocupação; [12] o ticket muda para SAIU e o localizador acompanha
  await caixa.getByRole('button', { name: 'Registrar saída' }).click();
  await expect(caixa.getByText('Saída registrada')).toBeVisible();
  expect(await ocupadas(api, destino)).toBe(antesDestino);
  expect((await (await api.get(`/api/tickets/${codigo}`)).json()).ticket.status).toBe('SAIU');
  await expect(localizador.getByText('Este veículo já saiu')).toBeVisible({ timeout: 10_000 });
  await expect(painel.getByTestId('movimentacoes')).toContainText(`${codigo} saiu de ${destino}`);
  // saída duplicada é recusada
  expect((await api.post(`/api/tickets/${codigo}/saida`)).status()).toBe(409);
  await ctx.close();
});

test('reconexão: o painel recupera o estado atual do backend depois de ficar sem rede [14]', async ({ browser }) => {
  const api = await apiTeste();
  const ctx = await browser.newContext();
  // queda de rede de verdade: corta o WebSocket do Socket.IO e bloqueia novas conexões (e o fallback por HTTP) até "voltar a rede"
  let semRede = false;
  const conexoes: WebSocketRoute[] = [];
  await ctx.routeWebSocket(/socket\.io/, (ws) => {
    if (semRede) { ws.close(); return; }
    ws.connectToServer();
    conexoes.push(ws);
  });
  const painel = await ctx.newPage();
  await abrirPainel(painel);
  semRede = true;
  await ctx.setOffline(true);
  await Promise.all(conexoes.map((ws) => ws.close()));
  await expect(painel.getByText('Atualização em tempo real interrompida')).toBeVisible({ timeout: 15_000 });
  // enquanto o painel está fora do ar: um carro entra e estaciona em S1 (eventos que ele não recebe)
  const { ticket } = await (await api.post('/api/entradas', { data: { acessoId: 'A_S1', categoria: 'CARRO_PEQUENO' } })).json();
  await api.post(`/api/tickets/${ticket.codigo}/estacionar`, { data: { regiaoId: 'S1' } });
  const livresS1 = (await regioes(api)).find((r) => r.id === 'S1')!.livres;
  semRede = false;
  await ctx.setOffline(false);
  await expect(painel.getByText('Atualização em tempo real interrompida')).toBeHidden({ timeout: 20_000 });
  await expect(painel.locator('tr[data-regiao="S1"] td').nth(3)).toContainText(String(livresS1));
  await expect(painel.getByTestId('movimentacoes')).toContainText(`${ticket.codigo} estacionou em S1`);
  await ctx.close();
});

test('região lotada recusa a confirmação e o painel pede uma nova recomendação [15]', async ({ page }) => {
  const api = await apiTeste();
  await abrirPainel(page);
  const { ticket } = await (await api.post('/api/entradas', { data: { acessoId: 'A_S1', categoria: 'CARRO_PEQUENO' } })).json();
  const s1 = (await regioes(api)).find((r) => r.id === 'S1')!;
  const comunsS1 = s1.vagas.COMUM.capacidade;
  await api.patch('/api/regioes/S1', { data: { ocupadas: comunsS1 } }); // vagas comuns de S1 lotaram depois da recomendação
  const caixa = await operar(page, ticket.codigo);
  await caixa.getByLabel('Região onde o veículo estacionou').selectOption('S1');
  await caixa.getByRole('button', { name: 'Confirmar estacionamento' }).click();
  await expect(caixa.getByText('Região S1 está lotada')).toBeVisible();
  expect(await ocupadas(api, 'S1')).toBe(comunsS1);
  await caixa.getByRole('button', { name: 'Solicitar nova recomendação' }).click();
  await expect(caixa.getByText(/Nova recomendação: região /)).toBeVisible();
  await caixa.getByRole('button', { name: 'Confirmar estacionamento' }).click();
  await expect(caixa.getByText(/Estacionamento confirmado em /)).toBeVisible();
  await expect(caixa.getByText('Estacionado', { exact: true })).toBeVisible();
});

test('confirmações simultâneas não passam da capacidade e o painel mostra a região lotada [16]', async ({ page }) => {
  const api = await apiTeste();
  await abrirPainel(page);
  const s2 = (await regioes(api)).find((r) => r.id === 'S2')!;
  // sem vagas reservadas em S2 durante o teste: "lotada" = todas as vagas da região ocupadas
  const reservadas = (pcd: number, idoso: number) => api.patch('/api/regioes/S2/vagas-reservadas', { data: { capacidadePcd: pcd, capacidadeIdoso: idoso } });
  await reservadas(0, 0);
  try {
    await api.patch('/api/regioes/S2', { data: { ocupadas: s2.capacidade - 2 } });
    const tickets = await Promise.all(Array.from({ length: 6 }, async () => (await (await api.post('/api/entradas', { data: { acessoId: 'A_S2', categoria: 'CARRO_PEQUENO' } })).json()).ticket.codigo as string));
    const res = await Promise.all(tickets.map((c) => api.post(`/api/tickets/${c}/estacionar`, { data: { regiaoId: 'S2' } })));
    expect(res.filter((r) => r.status() === 200)).toHaveLength(2);
    expect(await ocupadas(api, 'S2')).toBe(s2.capacidade);
    await expect(page.getByTestId('mapa-estacionamento').locator('[data-regiao="S2"]')).toHaveAttribute('data-faixa', 'lotada');
    await expect(page.getByTestId('movimentacoes')).toContainText('Região S2 lotou');
  } finally {
    await api.patch('/api/regioes/S2', { data: { ocupadas: 0 } });
    await reservadas(s2.vagas.PCD.capacidade, s2.vagas.IDOSO.capacidade);
  }
});

test('evento de sensor repetido não altera os dados duas vezes [17]', async ({ page }) => {
  const api = await apiTeste();
  await abrirPainel(page);
  const { ticket } = await (await api.post('/api/entradas', { data: { acessoId: 'A_NE', categoria: 'CARRO_PEQUENO' } })).json();
  const antes = await ocupadas(api, 'N1');
  const leitura = { eventoId: 'leitura-e2e-0001-n1', sensorId: 'N1-ENTRADA', tipo: 'VAGA_OCUPADA', regiaoId: 'N1', ticketCodigo: ticket.codigo };
  const [a, b] = await Promise.all([api.post('/api/sensores/eventos', { data: leitura }), api.post('/api/sensores/eventos', { data: leitura })]);
  expect([(await a.json()).resultado, (await b.json()).resultado].sort()).toEqual(['APLICADO', 'DUPLICADO']);
  expect(await ocupadas(api, 'N1')).toBe(antes + 1);
  await expect(page.getByTestId('movimentacoes')).toContainText(`${ticket.codigo} estacionou em N1`);
  await expect(page.getByTestId('movimentacoes').getByText(`${ticket.codigo} estacionou em N1`)).toHaveCount(1);
});

test('o simulador atualiza todos os módulos: painel, mapa, totem e localizador [18]', async ({ browser }) => {
  test.setTimeout(90_000);
  const api = await apiTeste();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const painel = await ctx.newPage();
  await abrirPainel(painel);
  await painel.getByText('Mais opções').click();
  await painel.getByLabel('Cenário').selectOption('C');
  await painel.getByRole('button', { name: 'Iniciar cenário C' }).click();
  await expect(painel.getByTestId('status-simulacao')).toHaveText('Rodando', { timeout: 15_000 });
  await expect(painel.getByText(/Ambiente de demonstração/)).toBeVisible();
  // painel e mapa refletem o preenchimento do cenário (N3 e N2 cheias) sem recarregar
  await expect(painel.getByTestId('mapa-estacionamento').locator('[data-regiao="N3"]')).toHaveAttribute('data-faixa', 'lotada');
  await expect(painel.getByTestId('kpi-ocupadas')).not.toContainText(/^Veículos estacionados0/);
  await expect(painel.getByTestId('movimentacoes')).toContainText('simulado');
  // o totem usa o mesmo estado: pela rotatória, N3 e N2 cheias não são recomendadas
  const totem = await ctx.newPage();
  const { regiao, token } = await emitirNoTotem(totem, /Carro pequeno/, 'A_ROT');
  expect(['N3', 'N2']).not.toContain(regiao);
  // o localizador consulta o mesmo backend
  const localizador = await ctx.newPage();
  await localizador.goto(`/t/${token}`);
  await expect(localizador.getByText('Estacionamento ainda não confirmado')).toBeVisible();
  await api.post('/api/simulacao/encerrar');
  await ctx.close();
});

test('reiniciar a demonstração não apaga dados fora do ambiente simulado [19]', async ({ browser }) => {
  test.setTimeout(90_000);
  const api = await apiTeste();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const [painel, totem] = [await ctx.newPage(), await ctx.newPage()];
  await abrirPainel(painel);
  // dado real: ticket do totem (API fora do modo demonstração) confirmado em S1
  const { codigo, token } = await emitirNoTotem(totem, /Carro pequeno/, 'A_S1');
  await api.post(`/api/tickets/${codigo}/estacionar`, { data: { regiaoId: 'S1' } });
  // demonstração por cima
  await painel.getByRole('button', { name: 'Simular estacionamento tranquilo' }).click();
  await expect(painel.getByTestId('status-simulacao')).toHaveText('Rodando', { timeout: 15_000 });
  await painel.getByRole('button', { name: 'Reiniciar', exact: true }).click();
  await painel.getByRole('button', { name: 'Apagar dados simulados' }).click();
  await expect(painel.getByTestId('movimentacoes')).toContainText('Dados simulados reiniciados');
  // o real continua: ticket estacionado, ocupação de S1 = 1, localizador funcionando
  expect((await (await api.get(`/api/tickets/${codigo}`)).json()).ticket.status).toBe('ESTACIONADO');
  expect(await ocupadas(api, 'S1')).toBe(1);
  expect(await total(api)).toBe(1);
  const localizador = await ctx.newPage();
  await localizador.goto(`/t/${token}`);
  await expect(localizador.getByTestId('regiao-registrada')).toHaveText('Sul Oeste');
  await ctx.close();
});
