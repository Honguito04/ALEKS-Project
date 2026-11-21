import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

let prompt: string;
let singleEditor: string;
let bundle: string;

test.beforeAll(async () => {
  [prompt, singleEditor] = await Promise.all([
    readFile('tests/fixtures/aleks-prompt-fragment.html', 'utf8'),
    readFile('tests/fixtures/aleks-single-editor.html', 'utf8'),
  ]);
  bundle = (await build({ entryPoints: ['tests/e2e/aleks-probe-harness.ts'], bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
});

for (const count of [0, 1, 2, 3]) {
  test(`dos sucesos piden dos respuestas con ${count} editores reconocibles`, async ({ page }) => {
    await page.route('**/events', route => route.fulfill({ contentType: 'text/html', body: prompt }));
    await page.goto('/events');
    await page.addScriptTag({ content: bundle });
    const context = await page.evaluate(async ({ count, singleEditor }) => {
      const template = new DOMParser().parseFromString(singleEditor, 'text/html').querySelector('.ansed_root')!;
      for (let i = 0; i < count; i++) document.body.append(template.cloneNode(true));
      return window.assistContext(document);
    }, { count, singleEditor });
    expect(context.fields).toEqual([
      { key: 'field_1', label: 'P(A): La suma es mayor que 7.' },
      { key: 'field_2', label: 'P(B): La suma es un número impar.' },
    ]);
    expect(context.can_fill_integer).toBe(false);
    expect(context.can_fill_fraction).toBe(false);
    expect(context.fill_blockers).toContain('field_count_mismatch');
  });
}

test('definir sucesos para una sola probabilidad conjunta conserva un campo', async ({ page }) => {
  await page.route('**/events', route => route.fulfill({ contentType: 'text/html', body: singleEditor }));
  await page.goto('/events');
  await page.addScriptTag({ content: bundle });
  const context = await page.evaluate(async () => {
    document.querySelector('#algoPrompt')!.textContent = 'Suceso A: La suma es par. Suceso B: La suma es mayor que 7. Calcula la probabilidad de A y B a la vez.';
    return window.assistContext(document);
  });
  expect(context.fields.map(field => field.key)).toEqual(['answer']);
  expect(context.can_fill_fraction).toBe(true);
});

for (const mismatch of [false, true]) {
  test(`la clave de cada campo sigue la letra de la fila (letras incompatibles: ${mismatch})`, async ({ page }) => {
    await page.route('**/events', route => route.fulfill({ contentType: 'text/html', body: prompt }));
    await page.goto('/events');
    await page.addScriptTag({ content: bundle });
    const answerTable = await readFile('tests/fixtures/aleks-probability-rows.html', 'utf8');
    const context = await page.evaluate(async ({ mismatch, answerTable }) => {
      if (mismatch) {
        document.querySelector('#algoPrompt')!.textContent =
          'Calcular la probabilidad de cada uno de los siguientes sucesos: Suceso A: La suma es mayor que 7. Suceso C: La suma es un número impar.';
      }
      const table = new DOMParser().parseFromString(answerTable, 'text/html').querySelector('table')!;
      const firstRow = table.rows[0];
      firstRow.parentElement!.append(firstRow);
      document.body.append(table);
      return window.assistContext(document);
    }, { mismatch, answerTable });
    if (mismatch) {
      expect(context.fields.map(field => field.label)).toEqual(['P(A): La suma es mayor que 7.', 'P(C): La suma es un número impar.']);
      expect(context.can_fill_fraction).toBe(false);
      expect(context.fill_blockers).toContain('field_count_mismatch');
    } else {
      expect(context.fields).toEqual([
        { key: 'field_1', label: 'P(B): La suma es un número impar.' },
        { key: 'field_2', label: 'P(A): La suma es mayor que 7.' },
      ]);
      expect(context.can_fill_fraction).toBe(true);
    }
  });
}
