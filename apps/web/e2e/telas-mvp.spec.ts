/**
 * Telas MVP definitivas: responsividade real nas larguras pedidas pela equipe, temas, logos, toque e teclado.
 * Larguras: 320×640, 375×812, 390×844, 430×932, 768×1024 e 1440×900.
 * (O Edge instalado é Chromium; Safari/iOS não está disponível neste ambiente.)
 */
import { expect, test, type Page } from '@playwright/test';
import { apiTeste, entrar } from './apoio.ts';

const TELAS = [
  { nome: '320', width: 320, height: 640, celular: true },
  { nome: '375', width: 375, height: 812, celular: true },
  { nome: '390', width: 390, height: 844, celular: true },
  { nome: '430', width: 430, height: 932, celular: true },
  { nome: '768', width: 768, height: 1024, celular: false },
  { nome: '1440', width: 1440, height: 900, celular: false },
] as const;

const semRolagemHorizontal = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** Elementos clicáveis visíveis menores que o mínimo de toque (ignora links de texto corrido). */
const alvosPequenos = (page: Page, minimo = 44) => page.evaluate((m) => [...document.querySelectorAll('button, [role="button"]:not(g), select, summary')]
  // data-alvo-estendido: área de toque ampliada por pseudo-elemento (o retângulo visível é menor que o alvo real)
  .filter((e) => !(e as HTMLElement).dataset.alvoEstendido)
  .filter((e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && !e.closest('[hidden]') && (r.height < m - 0.5 || r.width < m - 0.5); })
  .map((e) => `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 40)}" ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`), minimo);

test.beforeEach(async () => { await (await apiTeste()).post('/api/simulacao/reiniciar'); });

for (const t of TELAS) {
  test(`localizador ${t.nome}: cabe, sem rolagem lateral, mapa útil, alvos de toque`, async ({ browser }) => {
    const { token } = await entrar(await apiTeste(), 'CARRO_PEQUENO', 'A_ROT');
    const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, isMobile: t.celular, hasTouch: t.celular });
    await page.goto(`/t/${token}`);
    await expect(page.getByTestId('regiao-destino')).toBeVisible({ timeout: 15_000 });
    // com a ocupação acumulada pela suíte, a indicação pode cair num subsolo: a página abre no nível da entrada
    // (com "A rota continua no …") e o pino só aparece no nível do destino — "Centralizar" leva até lá
    if (!(await page.getByTestId('pino-destino').count())) await page.getByRole('button', { name: 'Centralizar no destino' }).click();
    await expect(page.getByTestId('pino-destino')).toBeVisible({ timeout: 10_000 });
    expect(await semRolagemHorizontal(page)).toBe(true);
    const mapa = (await page.getByTestId('mapa-estacionamento').boundingBox())!;
    expect(mapa.width * mapa.height).toBeGreaterThan(t.width * t.height * 0.35); // o mapa é a maior área da tela
    if (t.celular) expect(await alvosPequenos(page)).toEqual([]);
    // o destino fica visível (não coberto pelo painel)
    const pino = (await page.getByTestId('pino-destino').boundingBox())!;
    const painel = (await page.getByTestId('painel-navegacao').boundingBox())!;
    const sobrepoe = pino.x < painel.x + painel.width && pino.x + pino.width > painel.x && pino.y < painel.y + painel.height && pino.y + pino.height > painel.y;
    expect(sobrepoe).toBe(false);
    await page.close();
  });

  test(`totem ${t.nome}: sem rolagem lateral e ação principal acessível`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, isMobile: t.celular, hasTouch: t.celular });
    await page.goto('/totem?acesso=A_ROT');
    await page.getByRole('button', { name: 'Começar' }).click();
    await page.getByRole('button', { name: 'Carro pequeno' }).click();
    await page.getByRole('button', { name: /^Vaga comum/ }).click();
    await expect(page.getByTestId('justificativa')).toBeAttached({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Emitir ticket' })).toBeVisible();
    expect(await semRolagemHorizontal(page)).toBe(true);
    if (t.celular) expect(await alvosPequenos(page)).toEqual([]);
    await page.close();
  });

  test(`painel ${t.nome}: sem rolagem lateral; visão geral, mapa e tabela presentes`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, isMobile: t.celular, hasTouch: t.celular });
    await page.goto('/painel');
    await expect(page.getByTestId('kpi-capacidade')).toBeVisible();
    await expect(page.getByTestId('mapa-estacionamento')).toBeVisible();
    await expect(page.locator('tr[data-regiao="N3"]')).toBeAttached();
    expect(await semRolagemHorizontal(page)).toBe(true);
    await page.close();
  });
}

test('temas: logo dourada e preta no claro, dourada e bege no escuro; preferência mantida ao recarregar', async ({ page }) => {
  await page.goto('/painel');
  const logo = page.locator('img[src*="/marca/"]').first();
  await expect(logo).toHaveAttribute('src', /claro/);
  await page.getByTestId('botao-tema').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('img[src*="/marca/"]').first()).toHaveAttribute('src', /escuro/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(fundo).toBe('rgb(12, 17, 28)'); // grafite #0C111C
  await page.getByTestId('botao-tema').click();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(247, 249, 252)'); // canvas #F7F9FC
});

test('teclado: o totem é operável só com Tab/Enter e o foco é visível', async ({ page }) => {
  await page.goto('/totem?acesso=A_ROT');
  const comecar = page.getByRole('button', { name: 'Começar' });
  for (let i = 0; i < 12 && !(await comecar.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(comecar).toBeFocused();
  const contorno = await comecar.evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(contorno).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Carro pequeno' })).toBeVisible();
});
