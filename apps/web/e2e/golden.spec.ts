/** Golden Park no navegador real: marca, temas (padrão, alternância, persistência) e a chuva de abóboras. */
import { expect, test, type Page } from '@playwright/test';

const semRolagemHorizontal = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const tema = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const srcLogos = (page: Page) => page.locator('img[data-logo]').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src')!));

test('marca Golden Park, modo claro por padrão, alternância sem recarregar e preferência salva', async ({ page }) => {
  await page.goto('/painel');
  await expect(page).toHaveTitle('Golden Park');
  expect(await tema(page)).toBe('light');
  expect((await srcLogos(page)).every((s) => s.includes('golden-park-claro-'))).toBe(true);
  // a logo carrega de verdade e mantém a proporção do arquivo
  const proporcao = await page.locator('img[data-logo="claro-nome"]').first().evaluate((i: HTMLImageElement) => [i.naturalWidth / i.naturalHeight, i.getBoundingClientRect().width / i.getBoundingClientRect().height]);
  expect(proporcao[0]).toBeGreaterThan(5);
  expect(proporcao[1]).toBeCloseTo(proporcao[0]!, 1);
  await expect(page.getByText(/ParkVision/)).toHaveCount(0);

  const marcador = await page.evaluate(() => ((window as unknown as { __semRecarregar: number }).__semRecarregar = 42));
  await page.getByTestId('botao-tema').click();
  expect(await tema(page)).toBe('dark');
  expect((await srcLogos(page)).every((s) => s.includes('golden-park-escuro-'))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __semRecarregar: number }).__semRecarregar)).toBe(marcador); // não recarregou
  // componentes seguem o tema (cartões, mapa), não só o fundo
  const fundoCartao = await page.getByTestId('kpi-capacidade').locator('xpath=..').evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(fundoCartao).toBe('rgb(22, 28, 41)'); // grafite #161C29 (superfície do tema escuro)
  const papelMapa = await page.getByTestId('mapa-estacionamento').locator('xpath=..').evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(papelMapa).toBe('rgb(22, 28, 41)');

  await page.reload();
  expect(await tema(page)).toBe('dark');
  await page.goto('/totem?acesso=A_NE');   // vale para as outras interfaces
  expect(await tema(page)).toBe('dark');
  await expect(page.locator('img[data-logo="escuro-simbolo"]')).toBeVisible();
});

test('abóbora só no escuro; a chuva atravessa a tela sem bloquear cliques e termina sozinha', async ({ page }) => {
  await page.goto('/painel');
  await expect(page.getByTestId('abobora')).toHaveCount(0);
  await page.getByTestId('botao-tema').click();
  const abobora = page.getByTestId('abobora');
  await expect(abobora).toBeVisible();
  await expect(abobora).toHaveCSS('cursor', 'pointer');

  await abobora.click();
  const chuva = page.getByTestId('chuva-aboboras');
  await expect(chuva).toBeVisible();
  await expect(chuva).toHaveCSS('pointer-events', 'none');
  expect(await chuva.getByTestId('abobora-caindo').count()).toBeGreaterThan(15);
  // abóboras realmente se movem (posição muda com o tempo); cada uma começa com um atraso aleatório de até 1,6 s,
  // então a verificação olha o conjunto, não uma abóbora fixa
  const tops = () => chuva.getByTestId('abobora-caindo').evaluateAll((es) => es.map((e) => e.getBoundingClientRect().top));
  const antes = await tops();
  await page.waitForTimeout(700);
  const depois = await tops();
  expect(depois.some((t, i) => t > antes[i]! + 5)).toBe(true);
  // clicar no mapa durante a chuva continua funcionando
  await page.locator('[data-regiao="N1"][role="button"]').click();
  await expect(page.getByTestId('detalhe-regiao')).toContainText('Norte Oeste');
  // segundo clique não empilha outra chuva
  await abobora.click({ force: true });
  await expect(page.getByTestId('chuva-aboboras')).toHaveCount(1);
  // termina sozinha, sem deixar nada preso
  await expect(chuva).toHaveCount(0, { timeout: 10_000 });

  // dispensar antes do fim
  await abobora.click();
  await expect(chuva).toBeVisible();
  await page.getByTestId('parar-chuva').click();
  await expect(chuva).toHaveCount(0);
  // voltar ao claro remove a abóbora
  await page.getByTestId('botao-tema').click();
  await expect(page.getByTestId('abobora')).toHaveCount(0);
});

test('no celular: abóbora no localizador, chuva funciona e a página não ganha rolagem lateral', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('gp-tema', 'escuro'));
  const page = await ctx.newPage();
  await page.goto('/t/token-que-nao-existe-123456');
  await expect(page.getByText('Ticket não encontrado')).toBeVisible();
  await page.getByTestId('abobora').tap();
  await expect(page.getByTestId('chuva-aboboras')).toBeVisible();
  expect(await page.getByTestId('abobora-caindo').count()).toBe(16);
  expect(await semRolagemHorizontal(page)).toBe(true);
  await expect(page.getByTestId('chuva-aboboras')).toHaveCount(0, { timeout: 10_000 });
  await ctx.close();
});

test('respeita prefers-reduced-motion: sem queda nem giro', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  await ctx.addInitScript(() => localStorage.setItem('gp-tema', 'escuro'));
  const page = await ctx.newPage();
  await page.goto('/totem?acesso=A_NE');
  await page.getByTestId('abobora').click();
  const chuva = page.getByTestId('chuva-aboboras');
  await expect(chuva).toHaveAttribute('data-reduzido', 'true');
  await expect(chuva.locator('.gp-gota-suave')).toHaveCount(8);
  await expect(chuva).toHaveCount(0, { timeout: 5000 });
  await ctx.close();
});
