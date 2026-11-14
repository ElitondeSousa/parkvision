/**
 * Ponta a ponta com API real (banco de teste) + web: o mesmo caminho que a demonstração vai usar.
 */
import { expect, test, type Page } from '@playwright/test';
import { apiTeste, entrar } from './apoio.ts';

const somaOcupadas = async () => {
  const api = await apiTeste();
  const rs = (await (await api.get('/api/regioes')).json()) as { ocupadas: number }[];
  return rs.reduce((s, r) => s + r.ocupadas, 0);
};
const semRolagemHorizontal = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.beforeEach(async () => {
  const api = await apiTeste();
  await api.post('/api/simulacao/reiniciar');
});

test('totem → ticket → localizador: QR real, sem reserva, e a região registrada no mapa', async ({ page }) => {
  const antes = await somaOcupadas();
  await page.goto('/totem?acesso=A_NE');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Carro pequeno' }).click();
  await page.getByRole('button', { name: /^Vaga comum/ }).click();
  await expect(page.getByTestId('justificativa')).toBeVisible({ timeout: 10_000 });
  const regiaoIndicada = await page.getByTestId('mapa-estacionamento').locator('[data-destino="true"]').getAttribute('data-regiao');
  await page.getByRole('button', { name: 'Emitir ticket' }).click();
  const codigo = (await page.getByTestId('codigo-ticket').textContent())!.trim();
  const qrUrl = (await page.getByTestId('qr-code').getAttribute('data-conteudo'))!;
  await expect(page.getByTestId('qr-code').locator('svg')).toBeVisible();
  expect(qrUrl).toMatch(/\/t\/[\w-]{20,}$/);
  expect(await somaOcupadas()).toBe(antes); // ticket e recomendação não ocupam vaga

  const token = qrUrl.split('/t/')[1]!;
  await page.goto(`/t/${token}`);
  await expect(page.getByText('Estacionamento ainda não confirmado')).toBeVisible();
  // a caminho: o mapa mostra a região INDICADA e a rota pelo grafo, sem ocupar vaga
  await expect(page.getByTestId('regiao-destino')).toBeVisible();
  const destinoNoMapa = page.getByTestId('mapa-estacionamento').locator('[data-destino="true"]');
  if (await destinoNoMapa.count()) await expect(destinoNoMapa).toHaveAttribute('data-regiao', regiaoIndicada!);
  expect(await somaOcupadas()).toBe(antes);

  const api = await apiTeste();
  await api.post(`/api/tickets/${codigo}/estacionar`, { data: { regiaoId: 'S2' } }); // motorista parou em outra região
  expect(await somaOcupadas()).toBe(antes + 1);
  await page.reload();
  await expect(page.getByTestId('regiao-registrada')).toHaveText('Sul Leste');
  await expect(page.getByTestId('mapa-estacionamento').locator('[data-destino="true"]')).toHaveAttribute('data-regiao', 'S2');
  expect(regiaoIndicada).not.toBeNull();

  await page.goto('/t/token-que-nao-existe-123456');
  await expect(page.getByText('Ticket não encontrado')).toBeVisible();
});

test('painel recebe entradas, confirmações e ocupação em tempo real', async ({ page }) => {
  await page.goto('/painel');
  await expect(page.getByText('Ao vivo')).toBeVisible();
  const api = await apiTeste();
  const { ticket, recomendacao } = await entrar(api, 'MOTO');
  await expect(page.getByTestId('movimentacoes')).toContainText(`${ticket.codigo} entrou (motocicleta)`);
  await expect(page.getByTestId('recomendacao-atual')).toContainText(ticket.codigo);
  const linha = page.locator(`tr[data-regiao="${recomendacao.regiaoId}"]`);
  const livresAntes = await linha.locator('td').nth(3).textContent();
  await api.post(`/api/tickets/${ticket.codigo}/estacionar`);
  await expect(page.getByTestId('movimentacoes')).toContainText(`${ticket.codigo} estacionou em ${recomendacao.regiaoId}`);
  await expect(linha.locator('td').nth(3)).not.toHaveText(livresAntes!);

  await page.getByRole('tab', { name: /^Subsolo 1/ }).click();
  await page.locator('[data-regiao="SS1M"][role="button"]').click();
  await expect(page.getByTestId('detalhe-regiao')).toContainText('Subsolo 1 Motos');
  await expect(page.getByTestId('detalhe-regiao')).toContainText('Motocicleta');
});

test('controles do simulador usam os endpoints reais', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/painel');
  await page.getByLabel(/Token do operador/).fill('troque-este-token');
  await page.getByRole('button', { name: 'Salvar' }).click();
  // controles simplificados
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await expect(page.getByTestId('status-simulacao')).toHaveText('Rodando', { timeout: 15_000 });
  await expect(page.getByText(/Ambiente de demonstração/)).toBeVisible();
  await page.getByRole('button', { name: 'Pausar' }).click();
  await expect(page.getByTestId('status-simulacao')).toHaveText('Pausada');
  await page.getByRole('button', { name: 'Retomar' }).click();
  await expect(page.getByTestId('status-simulacao')).toHaveText('Rodando');
  await page.getByRole('button', { name: 'Adicionar veículo' }).click();
  await expect(page.getByTestId('movimentacoes')).toContainText('entrou');
  // opções avançadas continuam disponíveis (cenários A–E, velocidade, encerrar)
  await page.getByText('Mais opções').click();
  await page.getByLabel('Cenário').selectOption('A');
  await page.getByRole('button', { name: 'Iniciar cenário A' }).click();
  await expect(page.getByTestId('resumo-simulacao')).toContainText('Movimento tranquilo', { timeout: 15_000 });
  await page.getByRole('button', { name: /^Encerrar/ }).click();
  await expect(page.getByTestId('status-simulacao')).toHaveText('Parada');
  await page.getByRole('button', { name: 'Reiniciar', exact: true }).click();
  await page.getByRole('button', { name: 'Apagar dados simulados' }).click();
  await expect(page.getByTestId('movimentacoes')).toContainText('Dados simulados reiniciados');
  const api = await apiTeste();
  expect((await (await api.get('/api/simulacao')).json()).veiculosSimuladosAtivos).toBe(0);
});

test('localizador no celular: mapa em tela cheia, painel inferior e alvos de toque confortáveis', async ({ browser }) => {
  const api = await apiTeste();
  const { ticket, token } = await entrar(api, 'CARRO_GRANDE', 'A_S1');
  await api.post(`/api/tickets/${ticket.codigo}/estacionar`, { data: { regiaoId: 'S1' } });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await page.goto(`/t/${token}`);
  await expect(page.getByTestId('regiao-registrada')).toHaveText('Sul Oeste');
  expect(await semRolagemHorizontal(page)).toBe(true);
  const mapa = page.getByTestId('mapa-estacionamento');
  const caixa = (await mapa.boundingBox())!;
  expect(caixa.width).toBeLessThanOrEqual(375);
  expect(caixa.width).toBeGreaterThan(300);
  expect(caixa.height).toBeGreaterThan(812 * 0.6);                    // o mapa ocupa a maior parte da tela
  const centralizar = page.getByRole('button', { name: 'Centralizar no veículo' });
  const botao = (await centralizar.boundingBox())!;
  expect(botao.height).toBeGreaterThanOrEqual(44);
  const antes = await mapa.getAttribute('viewBox');
  await page.getByRole('tab', { name: /^Subsolo 1/ }).tap();
  await centralizar.tap();                                            // volta para o nível e a região do veículo
  await expect(mapa).toHaveAttribute('data-nivel', 'terreo');
  await expect(mapa).toHaveAttribute('viewBox', antes!);
  await page.close();
});

test('o mapa se ajusta ao tamanho da tela e é o mesmo componente no painel e no localizador', async ({ browser }) => {
  for (const [w, h] of [[1024, 768], [1920, 1080], [768, 1024]] as const) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto('/painel');
    const mapa = page.getByTestId('mapa-estacionamento');
    await expect(mapa).toBeVisible();
    const m = (await mapa.boundingBox())!;
    const contêiner = (await mapa.locator('xpath=..').boundingBox())!;
    expect(Math.abs(m.width - contêiner.width)).toBeLessThan(3);           // ocupa a largura disponível
    expect(m.height / m.width).toBeCloseTo(1331 / 1645, 1);                // mantém a proporção da planta
    expect(await semRolagemHorizontal(page)).toBe(true);
    await page.close();
  }
  const totem = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await totem.goto('/totem?acesso=A_ROT');
  await expect(totem.getByRole('button', { name: 'Começar' })).toBeVisible();
  expect(await semRolagemHorizontal(totem)).toBe(true);
  await totem.close();
});
