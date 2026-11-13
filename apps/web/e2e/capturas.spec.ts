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
