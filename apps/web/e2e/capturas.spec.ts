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
  await expect(painel.getByTestId('kpi-capacidade')).toContainText('1.269');
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
  await totem.getByRole('button', { name: /^Vaga comum/ }).click();
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
    await expect(painel.getByTestId('kpi-capacidade')).toContainText('1.269');
    await painel.waitForTimeout(800);
    await painel.screenshot({ path: `${DESTINO}/golden-painel-${tema}.png` });
    const totem = await ctx.newPage();
    await totem.setViewportSize({ width: 1366, height: 900 });
    await totem.goto('/totem?acesso=A_NE');
    await totem.waitForTimeout(400);
    await totem.screenshot({ path: `${DESTINO}/golden-totem-inicio-${tema}.png` });
    await totem.getByRole('button', { name: 'Começar' }).click();
    await totem.getByRole('button', { name: /Carro grande/ }).click();
    await totem.getByRole('button', { name: /^Vaga comum/ }).click();
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

test('capturas da evolução do mapa: navegação mobile e simulação visual', async ({ browser }) => {
  test.setTimeout(120_000);
  const api = await apiTeste();
  await api.post('/api/simulacao/reiniciar');
  const { token } = await entrar(api, 'CARRO_PEQUENO', 'A_ROT');
  for (const tema of ['claro', 'escuro'] as const) {
    const cel = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await cel.addInitScript((t) => localStorage.setItem('gp-tema', t), tema);
    await cel.goto(`/t/${token}`);
    await expect(cel.getByTestId('pino-destino')).toBeVisible();
    await cel.waitForTimeout(1400); // a rota termina de ser desenhada
    await cel.screenshot({ path: `${DESTINO}/mapa-nav-${tema}.png` });
    if (tema === 'claro') {
      await cel.getByRole('button', { name: 'Mostrar detalhes' }).tap();
      await cel.waitForTimeout(500);
      await cel.screenshot({ path: `${DESTINO}/mapa-nav-detalhes.png` });
      await cel.getByRole('button', { name: 'Ver trajeto em demonstração' }).tap();
      await cel.waitForTimeout(1500);
      await cel.screenshot({ path: `${DESTINO}/mapa-nav-demonstracao.png` });
    }
    await cel.close();
  }
  const painel = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await painel.goto('/painel');
  await painel.getByLabel(/Token do operador/).fill('troque-este-token');
  await painel.getByRole('button', { name: 'Salvar' }).click();
  await painel.getByRole('button', { name: 'Simular horário de pico' }).click();
  await expect(painel.getByTestId('status-simulacao')).toHaveText('Rodando', { timeout: 15_000 });
  await painel.waitForTimeout(6000);
  await painel.getByTestId('mapa-estacionamento').screenshot({ path: `${DESTINO}/mapa-sim-veiculos.png` });
  await painel.getByText('Simulação', { exact: true }).locator('xpath=ancestor::section[1]').screenshot({ path: `${DESTINO}/mapa-sim-controles.png` }).catch(() => {});
  await api.post('/api/simulacao/reiniciar');
  await painel.close();
});

test('capturas das vagas reservadas: totem, QR Code e painel', async ({ browser }) => {
  test.setTimeout(120_000);
  const api = await apiTeste();
  await api.post('/api/simulacao/reiniciar');
  const totem = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await totem.addInitScript(() => localStorage.setItem('gp-tema', 'claro'));
  await totem.goto('/totem?acesso=A_ROT');
  await totem.getByRole('button', { name: 'Começar' }).click();
  await totem.getByRole('button', { name: /Carro pequeno/ }).click();
  await totem.screenshot({ path: `${DESTINO}/vagas-totem-tipo.png` });
  await totem.getByRole('button', { name: /^Vaga PcD/ }).click();
  await expect(totem.getByTestId('justificativa')).toBeVisible({ timeout: 10_000 });
  await totem.waitForTimeout(1300);
  await totem.screenshot({ path: `${DESTINO}/vagas-totem-pcd.png` });
  await totem.getByRole('button', { name: 'Emitir ticket' }).click();
  const token = (await totem.getByTestId('qr-code').getAttribute('data-conteudo'))!.split('/t/')[1]!;
  await totem.close();
  for (const tema of ['claro', 'escuro'] as const) {
    const cel = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await cel.addInitScript((t) => localStorage.setItem('gp-tema', t), tema);
    await cel.goto(`/t/${token}`);
    await expect(cel.getByTestId('selo-tipo-vaga')).toBeVisible();
    await cel.waitForTimeout(1400);
    await cel.screenshot({ path: `${DESTINO}/vagas-qr-${tema}.png` });
    await cel.close();
  }
  const painel = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await painel.addInitScript(() => localStorage.setItem('gp-tema', 'claro'));
  await painel.goto('/painel');
  await expect(painel.getByTestId('vagas-reservadas')).toBeVisible();
  await painel.getByTestId('mapa-estacionamento').screenshot({ path: `${DESTINO}/vagas-mapa.png` });
  await painel.getByTestId('vagas-reservadas').screenshot({ path: `${DESTINO}/vagas-painel-resumo.png` });
  await painel.locator('tr[data-regiao="N1"]').locator('xpath=ancestor::table[1]').screenshot({ path: `${DESTINO}/vagas-painel-tabela.png` });
  await painel.close();
});

test('capturas das telas MVP definitivas (comparação com os wireframes)', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await apiTeste();
  await api.post('/api/simulacao/reiniciar');
  await api.post('/api/simulacao/cenario', { data: { cenario: 'A', config: { velocidade: 1, entradasPorMinuto: 0 } } }); // ocupação de demonstração parada
  const { token } = await entrar(api, 'CARRO_PEQUENO', 'A_ROT');
  const foto = async (largura: number, altura: number, tema: 'claro' | 'escuro', url: string, nome: string, antes?: (p: import('@playwright/test').Page) => Promise<void>) => {
    const p = await browser.newPage({ viewport: { width: largura, height: altura }, isMobile: largura < 768, hasTouch: largura < 768, deviceScaleFactor: largura < 768 ? 2 : 1 });
    await p.addInitScript((t) => localStorage.setItem('gp-tema', t), tema);
    await p.goto(url);
    await p.waitForTimeout(1600);
    if (antes) await antes(p);
    await p.screenshot({ path: `${DESTINO}/mvp-${nome}.png` });
    await p.close();
  };
  await foto(375, 812, 'claro', `/t/${token}`, 'localizador-375-claro');
  await foto(375, 812, 'claro', `/t/${token}`, 'localizador-375-detalhes', async (p) => { await p.getByRole('button', { name: 'Mostrar detalhes' }).tap(); await p.waitForTimeout(500); });
  await foto(320, 640, 'escuro', `/t/${token}`, 'localizador-320-escuro');
  await foto(430, 932, 'escuro', `/t/${token}`, 'localizador-430-escuro');
  await foto(1440, 900, 'claro', `/t/${token}`, 'localizador-1440-claro');
  await foto(1440, 900, 'claro', '/t/token-que-nao-existe-123456', 'localizador-nao-encontrado');
  const totemAte = (etapa: 'categoria' | 'tipo' | 'rec') => async (p: import('@playwright/test').Page) => {
    await p.getByRole('button', { name: 'Começar' }).click();
    if (etapa === 'categoria') return;
    await p.getByRole('button', { name: 'Carro pequeno' }).click();
    if (etapa === 'tipo') { await p.waitForTimeout(500); return; } // espera a transição da etapa (200 ms)
    await p.getByRole('button', { name: /^Vaga comum/ }).click();
    await p.getByTestId('justificativa').waitFor({ timeout: 10_000 });
    await p.waitForTimeout(1300);
  };
  await foto(1440, 900, 'claro', '/totem?acesso=A_ROT', 'totem-1440-inicio');
  await foto(1440, 900, 'claro', '/totem?acesso=A_ROT', 'totem-1440-tipo', totemAte('tipo'));
  await foto(1440, 900, 'claro', '/totem?acesso=A_ROT', 'totem-1440-recomendacao', totemAte('rec'));
  await foto(1080, 1920, 'escuro', '/totem?acesso=A_ROT', 'totem-1080-escuro', totemAte('rec'));
  await foto(375, 812, 'claro', '/totem?acesso=A_ROT', 'totem-375-recomendacao', totemAte('rec'));
  await foto(1440, 900, 'claro', '/painel', 'painel-1440-claro');
  await foto(1440, 900, 'escuro', '/painel', 'painel-1440-escuro');
  await foto(375, 812, 'claro', '/painel', 'painel-375-claro');
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await pg.addInitScript(() => localStorage.setItem('gp-tema', 'claro'));
  await pg.goto('/painel');
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: `${DESTINO}/mvp-painel-1440-completo.png`, fullPage: true });
  await pg.close();
  await api.post('/api/simulacao/reiniciar');
});
