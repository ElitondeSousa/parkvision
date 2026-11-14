/**
 * Gera as capturas de tela do relatório da Etapa 3 (docs/mvp/capturas/).
 * Só roda com CAPTURAS=1:  CAPTURAS=1 pnpm --filter @parkvision/web e2e capturas
 */
import { expect, test } from '@playwright/test';
import { apiTeste, entrar } from './apoio.ts';

const DESTINO = '../../docs/mvp/capturas';
test.skip(!process.env.CAPTURAS, 'capturas só com CAPTURAS=1');

test('capturas das três interfaces e do mapa', async ({ browser }) => {
  test.setTimeout(120_000);
  const api = await apiTeste();
  await api.post('/api/simulacao/reiniciar');

  // painel (aberto antes da simulação, para as movimentações chegarem em tempo real)
  const painel = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await painel.goto('/painel');
  await expect(painel.getByTestId('kpi-capacidade')).toContainText('1269');
  await expect(painel.getByText('Ao vivo')).toBeVisible();
  await api.post('/api/simulacao/cenario', { data: { cenario: 'D' } });
  await painel.waitForTimeout(6000);
  await api.post('/api/simulacao/pausar');
  await painel.waitForTimeout(800);
  await painel.screenshot({ path: `${DESTINO}/etapa3-painel.png`, fullPage: true });
  await painel.locator('[data-regiao="N3"][role="button"]').click();
  await painel.waitForTimeout(300);
  await painel.screenshot({ path: `${DESTINO}/etapa3-painel-regiao.png` });
  for (const [nivel, nome] of [['terreo', 'Térreo'], ['ss1', 'Subsolo 1'], ['ss2', 'Subsolo 2']] as const) {
    await painel.getByRole('tab', { name: new RegExp(`^${nome}`) }).click();
    await painel.waitForTimeout(250);
    await painel.getByTestId('mapa-estacionamento').screenshot({ path: `${DESTINO}/etapa3-mapa-${nivel}.png` });
  }
  await painel.close();

  // totem
  const totem = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await totem.goto('/totem?acesso=A_NE');
  await totem.screenshot({ path: `${DESTINO}/etapa3-totem-inicio.png` });
  await totem.getByRole('button', { name: 'Começar' }).click();
  await totem.screenshot({ path: `${DESTINO}/etapa3-totem-categoria.png` });
  await totem.getByRole('button', { name: /Carro pequeno/ }).click();
  await expect(totem.getByTestId('justificativa')).toBeVisible({ timeout: 10_000 });
  await totem.waitForTimeout(400);
  await totem.screenshot({ path: `${DESTINO}/etapa3-totem-recomendacao.png`, fullPage: true });
  await totem.getByRole('button', { name: 'Emitir ticket' }).click();
  await expect(totem.getByTestId('qr-code').locator('svg')).toBeVisible();
  await totem.screenshot({ path: `${DESTINO}/etapa3-totem-ticket.png`, fullPage: true });
  await totem.close();

  // localizador (celular)
  const { ticket, recomendacao, token } = await entrar(api, 'CARRO_GRANDE', 'A_S1');
  const celular = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await celular.goto(`/t/${token}`);
  await expect(celular.getByText('Estacionamento ainda não confirmado')).toBeVisible();
  await celular.screenshot({ path: `${DESTINO}/etapa3-localizador-aguardando.png` });
  await api.post(`/api/tickets/${ticket.codigo}/estacionar`, { data: { regiaoId: recomendacao.regiaoId } });
  await celular.reload();
  await expect(celular.getByTestId('regiao-registrada')).toBeVisible();
  await celular.waitForTimeout(300);
  await celular.screenshot({ path: `${DESTINO}/etapa3-localizador.png`, fullPage: true });
  await celular.close();

  await api.post('/api/simulacao/reiniciar');
});

test('capturas da etapa 4: operação de tickets e localizador ao vivo', async ({ browser }) => {
  test.setTimeout(120_000);
  const api = await apiTeste();
  await api.post('/api/simulacao/reiniciar');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const painel = await ctx.newPage();
  await painel.goto('/painel');
  await painel.getByLabel(/Token do operador/).fill('troque-este-token');
  await painel.getByRole('button', { name: 'Salvar' }).click();
  await expect(painel.getByText('Ao vivo')).toBeVisible();
  await api.post('/api/simulacao/cenario', { data: { cenario: 'C' } });
  await painel.waitForTimeout(5000);
  await api.post('/api/simulacao/pausar');
  // um veículo do totem: S1 lota antes da confirmação → recusa → nova recomendação
  const { ticket, token } = await entrar(api, 'CARRO_PEQUENO', 'A_S1');
  const s1 = (await (await api.get('/api/regioes')).json() as { id: string; capacidade: number }[]).find((r) => r.id === 'S1')!;
  await api.patch('/api/regioes/S1', { data: { ocupadas: s1.capacidade } });
  const caixa = painel.getByTestId('operacao-ticket');
  await caixa.getByLabel('Código do ticket').fill(ticket.codigo);
  await caixa.getByRole('button', { name: 'Consultar' }).click();
  await caixa.getByLabel('Região onde o veículo estacionou').selectOption('S1');
  await caixa.getByRole('button', { name: 'Confirmar estacionamento' }).click();
  await expect(caixa.getByRole('button', { name: 'Solicitar nova recomendação' })).toBeVisible();
  await caixa.scrollIntoViewIfNeeded();
  await painel.screenshot({ path: `${DESTINO}/etapa4-painel-lotada.png`, fullPage: true });
  await caixa.getByRole('button', { name: 'Solicitar nova recomendação' }).click();
  await expect(caixa.getByText(/Nova recomendação: região /)).toBeVisible();
  const celular = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await celular.goto(`/t/${token}`);
  await expect(celular.getByText('Estacionamento ainda não confirmado')).toBeVisible();
  await caixa.getByRole('button', { name: 'Confirmar estacionamento' }).click();
  await expect(celular.getByTestId('regiao-registrada')).toBeVisible({ timeout: 10_000 }); // atualizou sozinho
  await celular.waitForTimeout(300);
  await celular.screenshot({ path: `${DESTINO}/etapa4-localizador-ao-vivo.png`, fullPage: true });
  await caixa.screenshot({ path: `${DESTINO}/etapa4-operacao-confirmada.png` });
  await ctx.close();
  await celular.close();
  await api.post('/api/simulacao/reiniciar');
});

test('capturas golden park: temas claro e escuro e chuva de abóboras', async ({ browser }) => {
  test.setTimeout(150_000);
  const api = await apiTeste();
  await api.post('/api/simulacao/reiniciar');
  await api.post('/api/simulacao/cenario', { data: { cenario: 'D' } });
  await new Promise((ok) => setTimeout(ok, 4000));
  await api.post('/api/simulacao/pausar');
  const { ticket, token } = await entrar(api, 'CARRO_PEQUENO', 'A_S1');
  await api.post(`/api/tickets/${ticket.codigo}/estacionar`, { data: { regiaoId: 'S1' } });
  for (const tema of ['claro', 'escuro'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((t) => localStorage.setItem('gp-tema', t), tema);
    const painel = await ctx.newPage();
    await painel.goto('/painel');
    await expect(painel.getByTestId('kpi-capacidade')).toContainText('1269');
    await painel.waitForTimeout(800);
    await painel.screenshot({ path: `${DESTINO}/golden-painel-${tema}.png` });
    const totem = await ctx.newPage();
    await totem.setViewportSize({ width: 1366, height: 900 });
    await totem.goto('/totem?acesso=A_NE');
    await totem.waitForTimeout(400);
    await totem.screenshot({ path: `${DESTINO}/golden-totem-inicio-${tema}.png` });
    await totem.getByRole('button', { name: 'Começar' }).click();
    await totem.getByRole('button', { name: /Carro grande/ }).click();
    await expect(totem.getByTestId('justificativa')).toBeVisible({ timeout: 10_000 });
    await totem.waitForTimeout(300);
    await totem.screenshot({ path: `${DESTINO}/golden-totem-recomendacao-${tema}.png` });
    await totem.getByRole('button', { name: 'Emitir ticket' }).click();
    await totem.waitForTimeout(300);
    await totem.screenshot({ path: `${DESTINO}/golden-totem-ticket-${tema}.png` });
    const celular = await ctx.newPage();
    await celular.setViewportSize({ width: 390, height: 844 });
    await celular.goto(`/t/${token}`);
    await expect(celular.getByTestId('regiao-registrada')).toBeVisible();
    await celular.waitForTimeout(300);
    await celular.screenshot({ path: `${DESTINO}/golden-localizador-${tema}.png`, fullPage: true });
    if (tema === 'escuro') {
      await painel.bringToFront();
      await painel.getByTestId('abobora').click();
      await painel.waitForTimeout(2200);
      await painel.screenshot({ path: `${DESTINO}/golden-chuva-aboboras.png` });
    }
    await ctx.close();
  }
  await api.post('/api/simulacao/reiniciar');
});
