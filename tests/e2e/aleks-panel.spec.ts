import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';

const local = 'http://127.0.0.1:8000';
const cloud = 'https://aleks-project.example';
let html: string;

test.beforeAll(async () => {
  html = (await readFile('extension/panel.html', 'utf8')).replace('src="/src/panel.ts"', 'src="/__connector.js"');
});

async function openPanel(page: Page, origin: string, granted = false, allow = true) {
  const { outputFiles } = await build({
    entryPoints: ['extension/src/panel.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    define: { __BRIDGE_WEB_ORIGIN__: JSON.stringify(origin) },
  });
  await page.addInitScript(({ granted, allow }) => {
    const permissionChange = { addListener() {} };
    const requests: chrome.permissions.Permissions[] = [];
    let access = granted;
    Reflect.set(window, 'requestedOrigins', requests);
    Reflect.set(window, 'chrome', {
      permissions: {
        contains: async () => access,
        request: async (permissions: chrome.permissions.Permissions) => {
          requests.push(permissions);
          access = allow;
          return allow;
        },
        onAdded: permissionChange,
        onRemoved: permissionChange,
      },
    });
  }, { granted, allow });
  await page.route('**/__connector.js', route => route.fulfill({ contentType: 'application/javascript', body: outputFiles[0].text }));
  await page.route('**/connector-panel', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('/connector-panel');
}

test('el panel presenta la marca y permite autorizar el puente solo tras el clic', async ({ page }) => {
  await openPanel(page, local);
  await expect(page.getByRole('heading', { name: 'Aleks Project' })).toBeVisible();
  const grant = page.getByRole('button', { name: 'Autorizar acceso' });
  const open = page.getByRole('link', { name: 'Abrir Aleks Project' });
  await expect(grant).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Acceso pendiente');
  await expect(open).toHaveAttribute('href', local + '/app/');
  expect(await page.evaluate(() => Reflect.get(window, 'requestedOrigins'))).toEqual([]);
  await grant.click();
  await expect(page.getByRole('status')).toContainText('Acceso concedido');
  await expect(grant).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(await page.evaluate(() => Reflect.get(window, 'requestedOrigins'))).toEqual([
    { origins: [local + '/*', 'https://latam.aleks.com/*', 'https://latam-awu.aleks.com/*'] },
  ]);
  await expect(page.getByText(/Ollama|iniciar recorrido|resolver ejercicio/i)).toHaveCount(0);
});

test('el panel respeta una denegación y conserva el origen web configurado', async ({ page }) => {
  await openPanel(page, cloud, false, false);
  await expect(page.getByRole('link', { name: 'Abrir Aleks Project' })).toHaveAttribute('href', cloud + '/app/');
  const grant = page.getByRole('button', { name: 'Autorizar acceso' });
  await grant.click();
  await expect(page.getByRole('status')).toContainText('Puedes volver a solicitarlo');
  await expect(grant).toBeEnabled();
  const [permission] = await page.evaluate(() => Reflect.get(window, 'requestedOrigins'));
  expect(permission.origins).toHaveLength(3);
  expect(permission.origins).toContain(cloud + '/*');
  expect(permission.origins).not.toContain(local + '/*');
});

test('una compilación sin origen explica cómo configurar el puente', async ({ page }) => {
  await openPanel(page, '');
  await expect(page.getByRole('status')).toContainText('El puente web no está configurado');
  await expect(page.getByRole('link', { name: 'Abrir Aleks Project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Autorizar acceso' })).toHaveCount(0);
});
