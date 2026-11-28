import { test, expect, type Page } from '@playwright/test';

const password = 'Cuenta-prueba-12345!';
const email = () => `web-${crypto.randomUUID()}@example.com`;

async function register(page: Page, address: string) {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Crear una cuenta' }).click();
  await page.getByLabel('Correo electrónico').fill(address);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

test('registro, panel de automatización, sesión persistente y cierre real', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const address = email();
  await register(page, address);
  await expect(page.getByRole('heading', { name: 'Automatización de ALEKS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar extensión ALEKS' })).toBeVisible();
  await expect(page.getByLabel('Enunciado')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Consultar', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  expect((await page.request.get('/web-api/session')).status()).toBe(200);
  expect((await (await page.request.get('/web-api/session')).json()).user).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('contraseña incorrecta al eliminar conserva la sesión; eliminar revoca la cuenta', async ({ page }) => {
  const address = email();
  await register(page, address);
  await page.getByRole('button', { name: 'Mi cuenta' }).click();
  await page.getByLabel('Contraseña actual').fill('incorrecta-12345');
  await page.getByLabel('Confirmo que quiero eliminar mi cuenta').check();
  await page.getByRole('button', { name: 'Eliminar mi cuenta', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/contraseña/i);
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await page.getByLabel('Contraseña actual').fill(password);
  await page.getByRole('button', { name: 'Eliminar mi cuenta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(address);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/credenciales|correo|contraseña/i);
});

test('una cuenta existente permite reintentar una contraseña corta y volver a entrar sin registrarse', async ({ page }) => {
  const address = email();
  await register(page, address);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByText(/este formulario no inicia sesión con Google/)).toBeVisible();
  await page.getByText('¿Tu cuenta dejó de funcionar después de actualizar?', { exact: true }).click();
  await expect(page.getByText(/No hace falta crear otra cuenta/)).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(address);
  await page.getByLabel('Contraseña', { exact: true }).fill('x');
  const rejected = page.waitForResponse(r => r.url().endsWith('/web-api/login'));
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  expect((await rejected).status()).toBe(401);
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos');
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
});

test('móvil: sin desbordamiento y con indicaciones para conectar en escritorio', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page, email());
  const connect = page.getByRole('button', { name: 'Conectar extensión ALEKS' });
  await expect(connect).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await connect.focus();
  await expect(connect).toBeFocused();
  await connect.click();
  await expect(page.getByRole('alert')).toContainText('Chrome de escritorio');
});

test('sesión vencida real vuelve al acceso al intentar conectar', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { runtime: { connect() { throw Error('La sesión vencida no debe abrir un puerto de Chrome.'); } } },
    });
  });
  await register(page, email());
  await page.context().clearCookies();
  const rejected = page.waitForResponse(response => response.url().endsWith('/web-api/bridge-token'));
  await page.getByRole('button', { name: 'Conectar extensión ALEKS' }).click();
  expect((await rejected).status()).toBe(401);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/sesión venció/);
  await expect(page.getByRole('button', { name: 'Conectar extensión ALEKS' })).toHaveCount(0);
});
