import { test, expect, type Page } from '@playwright/test';

const statement = 'Hay 4 nadadores en una carrera. Hay premios para un primer lugar y un segundo lugar. ¿De cuántas maneras distintas se pueden otorgar los 2 premios?';
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

test('registro, cálculo comprobado, sesión persistente y cierre real', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const address = email();
  await register(page, address);
  await page.getByLabel('Enunciado').fill(statement);
  const created = page.waitForResponse(r => r.url().endsWith('/web-api/jobs') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  expect((await created).status()).toBe(202);
  await expect(page.getByText('Resultado comprobado', { exact: true })).toBeVisible();
  await expect(page.getByTestId('answer-value')).toHaveText('12');
  await page.screenshot({ path: '/tmp/aleks-web-desktop.png', fullPage: true });
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

test('cancelar mientras se crea una consulta descarta su resultado tardío', async ({ page }) => {
  await register(page, email());
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/web-api/jobs', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    await paused;
    await route.fulfill({ response });
  });
  await page.getByLabel('Enunciado').fill(statement);
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar consulta' }).click();
  await expect(page.getByRole('button', { name: 'Consultar', exact: true })).toBeEnabled();
  release();
  await expect(page.getByRole('status')).toContainText('cancelada');
  await expect(page.getByTestId('answer-value')).toHaveCount(0);
});

test('móvil: sin desbordamiento horizontal y formulario accesible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page, email());
  await expect(page.getByLabel('Enunciado')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Consultar', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Enunciado').focus();
  await expect(page.getByLabel('Enunciado')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  await page.screenshot({ path: '/tmp/aleks-web-mobile.png', fullPage: true });
});

test('sesión vencida real devuelve al acceso sin conservar el enunciado', async ({ page }) => {
  await register(page, email());
  await page.getByLabel('Enunciado').fill(statement);
  await page.context().clearCookies();
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/sesión venció/);
  await expect(page.getByLabel('Enunciado')).toHaveCount(0);
});

test('error de cuota simulado se muestra completo y no reenvía la consulta', async ({ page }) => {
  await register(page, email());
  let calls = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/web-api/jobs')) calls++; });
  await page.route('**/web-api/jobs/*', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ json: { status: 'error', error: { code: 'quota', message: 'Cuota diaria agotada; vuelve mañana (UTC).' } } });
  });
  await page.getByLabel('Enunciado').fill(statement);
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Cuota diaria agotada; vuelve mañana (UTC).');
  await expect(page.getByRole('button', { name: 'Consultar', exact: true })).toBeEnabled();
  expect(calls).toBe(1);
});

test('imagen real se convierte a JPEG; diagrama sin imagen no envía solicitudes', async ({ page }) => {
  await register(page, email());
  let calls = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/web-api/jobs')) calls++; });
  await page.getByLabel('Enunciado').fill('Calcula el área de la figura.');
  await page.getByLabel('El ejercicio depende de un diagrama o imagen').check();
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Adjunta el diagrama');
  expect(calls).toBe(0);
  const image = await page.screenshot();
  await page.getByLabel('Adjuntar imagen').setInputFiles({ name: 'figura.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('img', { name: 'Imagen del ejercicio adjunta' })).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.getByRole('button', { name: 'Quitar imagen' }).click();
  await expect(page.getByRole('img', { name: 'Imagen del ejercicio adjunta' })).toHaveCount(0);
});
