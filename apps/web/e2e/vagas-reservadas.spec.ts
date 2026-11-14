/**
 * Vagas reservadas ponta a ponta (API real + banco de teste): totem pedindo vaga PcD / pessoa idosa, QR Code no celular,
 * indisponibilidade sem troca automática de tipo, painel com disponibilidade por tipo, alerta e ajuste, nos dois temas.
 */
import { expect, test, type Page } from '@playwright/test';
import { apiTeste, TOKEN } from './apoio.ts';

type RegiaoApi = { id: string; capacidade: number; ocupadas: number; vagas: Record<'COMUM' | 'PCD' | 'IDOSO', { capacidade: number; ocupadas: number; livres: number }> };
const regioes = async () => (await (await apiTeste()).get('/api/regioes')).json() as Promise<RegiaoApi[]>;
const semRolagemHorizontal = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function totemAteRecomendacao(page: Page, tipo: RegExp, acesso = 'A_ROT') {
  await page.goto(`/totem?acesso=${acesso}`);
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Carro pequeno' }).click();
  await expect(page.getByText('Que tipo de vaga você precisa?')).toBeVisible();
  await page.getByRole('button', { name: tipo }).click();
}

test.beforeEach(async () => { await (await apiTeste()).post('/api/simulacao/reiniciar'); });

test('totem → vaga PcD → ticket → QR Code no celular com a categoria; a vaga só é ocupada na confirmação', async ({ page, browser }) => {
  const antes = await regioes();
  await totemAteRecomendacao(page, /^Vaga PcD/);
  await expect(page.getByTestId('justificativa')).toContainText('recomendada para vaga PcD');
  await expect(page.getByTestId('justificativa')).not.toContainText(/rota acessível|caminho acessível/i);
  await expect(page.getByTestId('selo-tipo-vaga')).toHaveAttribute('data-tipo', 'PCD');
  await expect(page.getByTestId('disponibilidade')).toContainText('vagas PcD livres');
  const regiao = (await page.getByTestId('mapa-estacionamento').locator('[data-destino="true"]').getAttribute('data-regiao'))!;
  expect(antes.find((r) => r.id === regiao)!.vagas.PCD.capacidade).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Emitir ticket' }).click();
  await expect(page.getByTestId('ticket-tipo-vaga')).toContainText('Vaga PcD');
  const codigo = (await page.getByTestId('codigo-ticket').textContent())!.trim();
  const token = (await page.getByTestId('qr-code').getAttribute('data-conteudo'))!.split('/t/')[1]!;
  // recomendação não reserva
  expect((await regioes()).find((r) => r.id === regiao)!.vagas.PCD.ocupadas).toBe(antes.find((r) => r.id === regiao)!.vagas.PCD.ocupadas);

  for (const tema of ['claro', 'escuro'] as const) {
    const cel = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await cel.addInitScript((t) => localStorage.setItem('gp-tema', t), tema);
    await cel.goto(`/t/${token}`);
    await expect(cel.getByTestId('selo-tipo-vaga')).toHaveAttribute('data-tipo', 'PCD');
    await expect(cel.getByTestId('info-vaga-reservada')).toContainText('credencial');
    await expect(cel.getByTestId('pino-destino')).toContainText('Vaga PcD');
    await expect(cel.getByTestId('mapa-estacionamento').locator('[data-camada="rota"]').first()).toBeAttached();
    expect(await semRolagemHorizontal(cel)).toBe(true);
    const pino = (await cel.getByTestId('pino-destino').boundingBox())!, painel = (await cel.getByTestId('painel-navegacao').boundingBox())!;
    expect(pino.y + pino.height).toBeLessThanOrEqual(painel.y);
    await cel.getByRole('button', { name: 'Mostrar detalhes' }).tap();
    await expect(cel.getByTestId('caminho-pedestre')).toContainText('ainda não foi validada');
    await cel.close();
  }

  // confirmação ocupa a vaga PcD; saída libera
  const api = await apiTeste();
  await api.post(`/api/tickets/${codigo}/estacionar`);
  expect((await regioes()).find((r) => r.id === regiao)!.vagas.PCD.ocupadas).toBe(1);
  await api.post(`/api/tickets/${codigo}/saida`);
  expect((await regioes()).find((r) => r.id === regiao)!.vagas.PCD.ocupadas).toBe(0);
});

test('vaga para pessoa idosa recebe vaga do próprio tipo', async ({ page }) => {
  await totemAteRecomendacao(page, /^Vaga para pessoa idosa/, 'A_S1');
  await expect(page.getByTestId('justificativa')).toContainText('vaga para pessoa idosa');
  await expect(page.getByTestId('disponibilidade')).toContainText('vagas para pessoa idosa livres');
});

test('sem vaga PcD: o totem informa e não manda para outro tipo; o painel alerta abaixo do mínimo', async ({ page }) => {
  const api = await apiTeste();
  const originais = (await regioes()).filter((r) => r.vagas.PCD.capacidade > 0).map((r) => ({ id: r.id, pcd: r.vagas.PCD.capacidade, idoso: r.vagas.IDOSO.capacidade }));
  const zerar = (id: string, pcd: number, idoso: number) => api.patch(`/api/regioes/${id}/vagas-reservadas`, { data: { capacidadePcd: pcd, capacidadeIdoso: idoso }, headers: { 'x-operador-token': TOKEN } });
  try {
    for (const r of originais) expect((await zerar(r.id, 0, r.idoso)).status()).toBe(200);
    let entradas = 0;
    page.on('request', (req) => { if (req.method() === 'POST' && req.url().endsWith('/api/entradas')) entradas++; });
    await totemAteRecomendacao(page, /^Vaga PcD/);
    await expect(page.getByText('Sem vaga PcD disponível agora')).toBeVisible();
    await expect(page.getByText(/não indica vaga de outro tipo/)).toBeVisible();
    expect(entradas).toBe(1);
    await page.getByRole('button', { name: 'Voltar às opções de vaga' }).click();
    await expect(page.getByText('Que tipo de vaga você precisa?')).toBeVisible();

    // painel: alerta de distribuição abaixo do mínimo e colunas por tipo
    await page.goto('/painel');
    const card = page.getByTestId('vagas-reservadas');
    await expect(card.getByText('Distribuição abaixo do mínimo')).toBeVisible();
    await expect(card.getByTestId('total-PCD')).toContainText('Abaixo do mínimo');
  } finally {
    for (const r of originais) await zerar(r.id, r.pcd, r.idoso);
  }
});

test('painel: disponibilidade por tipo, selos no mapa e ajuste administrativo recusando inconsistência', async ({ page }) => {
  const api = await apiTeste();
  await page.goto('/painel');
  await page.getByLabel(/Token do operador/).fill(TOKEN);
  await page.getByRole('button', { name: 'Salvar' }).click();
  const card = page.getByTestId('vagas-reservadas');
  await expect(card.getByTestId('total-PCD')).toContainText('mínimo legal 26');
  await expect(card.getByTestId('total-PCD')).toContainText('Mínimo atendido');
  await expect(page.locator('tr[data-regiao="N3"] td[data-tipo="PCD"]')).toContainText('/ 8');
  await expect(page.getByTestId('mapa-estacionamento').locator('[data-regiao="N3"]')).toHaveAttribute('data-vagas-pcd', '8/8');

  // ocupa 2 vagas PcD de N2 e tenta reduzir para 1: recusado
  for (let i = 0; i < 2; i++) {
    const t = (await (await api.post('/api/entradas', { data: { acessoId: 'A_ROT', categoria: 'CARRO_PEQUENO', tipoVaga: 'PCD' } })).json()).ticket.codigo;
    expect((await api.post(`/api/tickets/${t}/estacionar`, { data: { regiaoId: 'N2' } })).status()).toBe(200);
  }
  await expect(page.locator('tr[data-regiao="N2"] td[data-tipo="PCD"]')).toContainText('0 / 2');
  await card.getByText('Ajustar vagas de uma região').click();
  await card.getByLabel('Região').selectOption('N2');
  await card.getByLabel('Vagas PcD').fill('1');
  await card.getByRole('button', { name: 'Salvar vagas reservadas' }).click();
  await expect(card.getByText('Ajuste recusado')).toBeVisible();
  await expect(card.getByText(/vagas PcD ocupadas/)).toBeVisible();
});

test('simulador: veículo pedindo vaga PcD aparece nas movimentações com o tipo', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/painel');
  await page.getByLabel(/Token do operador/).fill(TOKEN);
  await page.getByRole('button', { name: 'Salvar' }).click();
  const pcdOcupadas = async () => (await regioes()).reduce((s, r) => s + r.vagas.PCD.ocupadas, 0);
  const antes = await pcdOcupadas(); // tickets reais de outros casos continuam no banco (o reinício só apaga os simulados)
  await page.getByLabel('Tipo de vaga do veículo adicionado').selectOption('PCD');
  await page.getByRole('button', { name: 'Adicionar veículo' }).click();
  await expect(page.getByTestId('movimentacoes')).toContainText('vaga PcD', { timeout: 15_000 });
  // confirmação automática pelo simulador ocupa uma vaga PcD
  await expect.poll(pcdOcupadas, { timeout: 20_000 }).toBe(antes + 1);
  await page.getByRole('button', { name: 'Pausar' }).click();
});
