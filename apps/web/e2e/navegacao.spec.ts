/**
 * Navegação mobile pelo QR Code e simulação visual (Edge com viewport e toque de celular).
 * Observação: o WebKit (Safari/iOS) não está instalado neste ambiente — os testes cobrem o motor Chromium.
 */
import { expect, test, type Page } from '@playwright/test';
import { apiTeste, entrar, TOKEN } from './apoio.ts';

const CELULARES = [
  { nome: 'iPhone SE', width: 375, height: 667 },
  { nome: 'Pixel 7', width: 412, height: 915 },
];
const semRolagemHorizontal = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const somaOcupadas = async () => {
  const api = await apiTeste();
  return ((await (await api.get('/api/regioes')).json()) as { ocupadas: number }[]).reduce((s, r) => s + r.ocupadas, 0);
};

test.beforeEach(async () => { await (await apiTeste()).post('/api/simulacao/reiniciar'); });

for (const cel of CELULARES) {
  test(`a caminho (${cel.nome}): rota, pino de destino acima do painel e painel expansível`, async ({ browser }) => {
    const api = await apiTeste();
    const antes = await somaOcupadas();
    const { token, recomendacao } = await entrar(api, 'CARRO_PEQUENO', 'A_ROT');
    const page = await browser.newPage({ viewport: { width: cel.width, height: cel.height }, isMobile: true, hasTouch: true });
    await page.goto(`/t/${token}`);
    await expect(page.getByTestId('regiao-destino')).toBeVisible();
    await expect(page.getByText('Navegação até a região')).toBeVisible();
    expect(await semRolagemHorizontal(page)).toBe(true);

    const mapa = page.getByTestId('mapa-estacionamento');
    await expect(mapa.locator('[data-destino="true"]')).toHaveAttribute('data-regiao', recomendacao.regiaoId);
    await expect(mapa.locator('[data-camada="rota"]').first()).toBeAttached();
    // o pino do destino fica na parte visível do mapa, acima do painel inferior
    const pino = (await page.getByTestId('pino-destino').boundingBox())!;
    const painel = (await page.getByTestId('painel-navegacao').boundingBox())!;
    expect(pino.y + pino.height).toBeLessThanOrEqual(painel.y);
    expect(pino.y).toBeGreaterThan(0);
    // nada de distância/tempo inventado nem promessa de GPS
    await expect(page.getByText(/\b\d+\s?(m|min|km)\b/)).toHaveCount(0);
    await expect(page.getByText(/GPS|localização em tempo real/i)).toHaveCount(0);

    // painel inferior: tocar na alça expande e mostra passos + ticket
    await page.getByRole('button', { name: 'Mostrar detalhes' }).tap();
    await expect(page.getByRole('heading', { name: 'Como chegar' })).toBeVisible();
    await expect(page.getByTestId('orientacao').locator('li').first()).toBeVisible();
    await page.getByRole('button', { name: 'Recolher detalhes' }).tap();
    await expect(page.getByRole('heading', { name: 'Como chegar' })).toBeHidden();

    // botões do mapa com alvo de toque ≥ 44 px
    for (const nome of ['Ver rota inteira', 'Centralizar no destino']) {
      const b = (await page.getByRole('button', { name: nome }).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.y + b.height).toBeLessThanOrEqual(painel.y);
    }
    // arrastar move o mapa; "ver rota inteira" volta ao enquadramento
    const vb0 = await mapa.getAttribute('viewBox');
    const m = (await mapa.boundingBox())!;
    await page.mouse.move(m.x + m.width / 2, m.y + 150);
    await page.mouse.down();
    await page.mouse.move(m.x + m.width / 2 - 80, m.y + 190, { steps: 6 });
    await page.mouse.up();
    await expect(mapa).not.toHaveAttribute('viewBox', vb0!);
    await page.getByRole('button', { name: 'Ver rota inteira' }).tap();
    await expect(mapa).toHaveAttribute('viewBox', vb0!);

    expect(await somaOcupadas()).toBe(antes); // ver a rota não ocupa nem reserva vaga
    await page.close();
  });
}

test('demonstração do trajeto é rotulada e o veículo percorre a rota', async ({ browser }) => {
  const api = await apiTeste();
  const { token } = await entrar(api, 'CARRO_PEQUENO', 'A_ROT');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(`/t/${token}`);
  await page.getByRole('button', { name: 'Mostrar detalhes' }).tap();
  await page.getByRole('button', { name: 'Ver trajeto em demonstração' }).tap();
  await expect(page.getByText('Demonstração do trajeto — não é a sua localização')).toBeVisible();
  const carro = page.getByTestId('veiculo-simulado');
  await expect(carro).toBeAttached();
  const t1 = await carro.getAttribute('transform');
  await page.waitForTimeout(800);
  expect(await carro.getAttribute('transform')).not.toBe(t1); // está andando
  await expect(page.getByText(/Demonstração do trajeto/)).toBeHidden({ timeout: 20_000 }); // termina sozinho
  await page.close();
});

test('estacionado: região registrada sem rota; saiu: encerrado sem mapa', async ({ browser }) => {
  const api = await apiTeste();
  const { ticket, token } = await entrar(api, 'MOTO', 'A_NE');
  await api.post(`/api/tickets/${ticket.codigo}/estacionar`, { data: { regiaoId: 'SS1M' } });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await page.goto(`/t/${token}`);
  await expect(page.getByText('Encontre seu veículo')).toBeVisible();
  await expect(page.getByTestId('regiao-registrada')).toContainText('Subsolo 1');
  await expect(page.getByTestId('mapa-estacionamento')).toHaveAttribute('data-nivel', 'ss1');
  await expect(page.getByTestId('mapa-estacionamento').locator('[data-camada="rota"]')).toHaveCount(0);
  await api.post(`/api/tickets/${ticket.codigo}/saida`);
  await expect(page.getByText('Este veículo já saiu')).toBeVisible({ timeout: 10_000 }); // atualiza ao vivo
  await expect(page.getByTestId('mapa-estacionamento')).toHaveCount(0);
  await page.close();
});

test('tema escuro: a rota continua visível e o easter egg não cobre o mapa', async ({ browser }) => {
  const api = await apiTeste();
  const { token } = await entrar(api, 'CARRO_PEQUENO', 'A_ROT');
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('gp-tema', 'escuro'));
  await page.goto(`/t/${token}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const traco = page.locator('.gp-rota-traco').first();
  await expect(traco).toBeAttached();
  const [cor, papel] = await page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('.gp-rota-traco')!).stroke;
    const p = getComputedStyle(document.querySelector('[data-testid="mapa-estacionamento"]')!.parentElement!).backgroundColor;
    return [t, p];
  });
  expect(cor).not.toBe(papel);
  // a abóbora fica no cabeçalho; tocar nela não impede usar o mapa depois
  await page.getByRole('button', { name: /Abóbora de Halloween/ }).tap();
  await page.getByRole('button', { name: 'Ver rota inteira' }).tap();
  await expect(page.getByTestId('pino-destino')).toBeVisible();
  await page.close();
});

test('sem conexão: mensagem em texto e botão para tentar de novo', async ({ browser }) => {
  const api = await apiTeste();
  const { token } = await entrar(api, 'CARRO_PEQUENO', 'A_ROT');
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await page.route('**/api/localizador/**', (r) => r.abort());
  await page.goto(`/t/${token}`);
  await expect(page.getByText('Sem conexão com o Golden Park')).toBeVisible();
  await page.unroute('**/api/localizador/**');
  await page.getByRole('button', { name: 'Tentar de novo' }).tap();
  await expect(page.getByTestId('regiao-destino')).toBeVisible();
  await page.close();
});

test('simulador: adicionar veículo anima um carrinho no mapa; a ocupação só muda na confirmação', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/painel');
  await page.getByLabel(/Token do operador/).fill(TOKEN);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Ao vivo')).toBeVisible();
  const antes = await somaOcupadas();
  await page.getByRole('button', { name: 'Adicionar veículo' }).click();
  await expect(page.getByTestId('status-simulacao')).toHaveText('Rodando', { timeout: 15_000 });
  // o carrinho aparece no nível por onde está passando
  const abas = ['Térreo', 'Subsolo 1', 'Subsolo 2'];
  let i = 0;
  await expect.poll(async () => {
    await page.getByRole('tab', { name: new RegExp(`^${abas[i++ % 3]}`) }).click();
    return page.getByTestId('veiculo-simulado').count();
  }, { timeout: 8_000, intervals: [200] }).toBeGreaterThan(0);
  // confirmação automática pelo backend (tempo de manobra simulado) → +1 ocupada
  await expect.poll(somaOcupadas, { timeout: 20_000 }).toBe(antes + 1);
  await page.getByRole('button', { name: 'Pausar' }).click();
});

test('movimento reduzido: sem carrinhos animados e rota sem animação de desenho', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/painel');
  await page.getByLabel(/Token do operador/).fill(TOKEN);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByRole('button', { name: 'Simular estacionamento tranquilo' }).click();
  await expect(page.getByTestId('status-simulacao')).toHaveText('Rodando', { timeout: 15_000 });
  await expect(page.getByTestId('movimentacoes')).toContainText('entrou', { timeout: 15_000 });
  await expect(page.getByTestId('veiculo-simulado')).toHaveCount(0);
  const animacao = await page.locator('.gp-rota-traco').first().evaluate((e) => getComputedStyle(e).animationName).catch(() => 'none');
  expect(animacao).toBe('none');
  await page.getByRole('button', { name: 'Pausar' }).click();
  await ctx.close();
});
