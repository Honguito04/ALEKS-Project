import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import type { inspectAleksChoice, aleksChoiceDiagnostics, markAleksChoice } from '../../extension/src/aleks-choice';
import type { readAleksPrompt } from '../../extension/src/aleks-prompt';

declare global {
  interface Window {
    choiceTest: { inspectAleksChoice: typeof inspectAleksChoice; aleksChoiceDiagnostics: typeof aleksChoiceDiagnostics;
      markAleksChoice: typeof markAleksChoice; readAleksPrompt: typeof readAleksPrompt };
  }
}

let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import { inspectAleksChoice, aleksChoiceDiagnostics, markAleksChoice } from './extension/src/aleks-choice';
        import { readAleksPrompt } from './extension/src/aleks-prompt';
        window.choiceTest = { inspectAleksChoice, aleksChoiceDiagnostics, markAleksChoice, readAleksPrompt };
      `,
      resolveDir: process.cwd(),
    },
    bundle: true, write: false, format: 'iife', target: 'es2022',
  });
  bundle = result.outputFiles[0].text;
});

const nativeChoices = `<table><tbody>
  <tr><td><input type="checkbox"></td><td>En la geometría esférica, no hay rectas paralelas a la recta dada que atraviesen un punto que no se encuentre en una recta determinada.</td></tr>
  <tr><td><input type="checkbox"></td><td>En la geometría euclidiana, la suma de las medidas de los ángulos de un triángulo es igual a
    <span mathml="&lt;math&gt;&lt;mn&gt;180&lt;/mn&gt;&lt;/math&gt;">180</span>°.</td></tr>
  <tr><td><input type="checkbox"></td><td>En la geometría esférica, un triángulo puede tener dos ángulos rectos.</td></tr>
  <tr><td><input type="checkbox"></td><td>Tanto en la geometría euclidiana como en la esférica, cada par de rectas debe intersecarse.</td></tr>
  <tr><td><input type="checkbox"></td><td>En la geometría esférica, si los tres ángulos de un triángulo tienen la misma medida, entonces todos deben medir
    <span mathml="&lt;math&gt;&lt;mn&gt;60&lt;/mn&gt;&lt;/math&gt;">60</span>°.</td></tr>
  <tr><td><input type="checkbox"></td><td>Ninguna de las proposiciones es verdadera.</td></tr>
</tbody></table>`;
const customChoices = `<div role="group" aria-labelledby="algoPrompt">
  <div><span role="checkbox" tabindex="0" aria-checked="false" aria-labelledby="private-id-1">□</span><span id="private-id-1">Primera proposición</span></div>
  <div><span role="checkbox" tabindex="0" aria-checked="false" aria-labelledby="private-id-2">□</span><span id="private-id-2">Segunda proposición</span></div>
</div>`;

async function exercise(page: Page, options: string) {
  await page.route('**/choice-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="es"><meta charset="utf-8"><style>label {display:block} [role=checkbox] {display:inline-block;min-width:15px}</style>
      <main><section><p id="algoPrompt">Marcar cada proposición que sea verdadera.</p>${options}<button>Verificar</button></section></main>
      <nav><label><input type="checkbox"> Ajuste ajeno</label></nav></html>`,
  }));
  await page.goto('/choice-fixture');
  await page.addScriptTag({ content: bundle });
}

test('lee etiquetas nativas y MathML, marca solo las opciones propuestas y conserva la selección hasta verificar', async ({ page }) => {
  await exercise(page, nativeChoices);
  const result = await page.evaluate(async () => {
    const { inspectAleksChoice, markAleksChoice, readAleksPrompt } = window.choiceTest;
    const observed = inspectAleksChoice(document)!;
    const prompt = await readAleksPrompt(document);
    let authorizations = 0;
    let submissions = 0;
    document.querySelector('button')!.addEventListener('click', () => submissions++);
    const confirm = await markAleksChoice(document, prompt.fingerprint!, observed.choice,
      ['option_1', 'option_2', 'option_3'], new AbortController().signal, async () => { authorizations++; });
    confirm();
    const checked = [...document.querySelectorAll<HTMLInputElement>('input')].map(input => input.checked);
    document.querySelectorAll<HTMLInputElement>('input')[3].checked = true;
    let changed = '';
    try { confirm(); } catch (error) { changed = (error as Error).message; }
    return { observed: observed.choice, checked, authorizations, submissions, changed };
  });
  expect(result.observed.mode).toBe('multiple');
  expect(result.observed.options[1]).toEqual({
    key: 'option_2', label: 'En la geometría euclidiana, la suma de las medidas de los ángulos de un triángulo es igual a 180°.',
  });
  expect(result).toMatchObject({ checked: [true, true, true, false, false, false, false], authorizations: 3, submissions: 0,
    changed: expect.stringContaining('opciones esperadas') });
});

test('asocia filas de tabla sin atributo for y marca la radio del mismo grupo', async ({ page }) => {
  await exercise(page, `<table><tbody>
    <tr><td><input type="radio" name="answer"></td><td>Opción uno</td></tr>
    <tr><td><input type="radio" name="answer"></td><td>Opción dos</td></tr>
  </tbody></table>`);
  const result = await page.evaluate(async () => {
    const { inspectAleksChoice, markAleksChoice, readAleksPrompt } = window.choiceTest;
    const observed = inspectAleksChoice(document)!;
    const prompt = await readAleksPrompt(document);
    const signal = new AbortController().signal;
    let invalid = '';
    try { await markAleksChoice(document, prompt.fingerprint!, observed.choice, ['option_1', 'option_2'], signal); }
    catch (error) { invalid = (error as Error).message; }
    await markAleksChoice(document, prompt.fingerprint!, observed.choice, ['option_2'], signal);
    return { observed: observed.choice, invalid,
      selected: [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')].map(node => node.checked) };
  });
  expect(result).toMatchObject({ observed: { mode: 'single', options: [{ label: 'Opción uno' }, { label: 'Opción dos' }] },
    invalid: expect.stringContaining('selección propuesta'), selected: [false, true] });
});

test('una casilla transparente se activa por su etiqueta visible vinculada', async ({ page }) => {
  await exercise(page, `<fieldset>
    <input id="choice-first" type="checkbox" style="opacity:0;position:absolute"><label for="choice-first">Primera opción</label>
    <input id="choice-second" type="checkbox" style="opacity:0;position:absolute"><label for="choice-second">Segunda opción</label>
  </fieldset>`);
  await page.evaluate(async () => {
    const { inspectAleksChoice, markAleksChoice, readAleksPrompt } = window.choiceTest;
    const observed = inspectAleksChoice(document)!;
    const prompt = await readAleksPrompt(document);
    await markAleksChoice(document, prompt.fingerprint!, observed.choice, ['option_2'], new AbortController().signal);
  });
  await expect(page.locator('#choice-first')).not.toBeChecked();
  await expect(page.locator('#choice-second')).toBeChecked();
});

test('espera la confirmación ARIA y no emite otro clic si ALEKS marca una opción distinta', async ({ page }) => {
  await exercise(page, customChoices);
  const result = await page.evaluate(async () => {
    const { inspectAleksChoice, markAleksChoice, readAleksPrompt } = window.choiceTest;
    const observed = inspectAleksChoice(document)!;
    const prompt = await readAleksPrompt(document);
    const controls = [...document.querySelectorAll('[role=checkbox]')];
    let clicks = 0;
    controls[0].addEventListener('click', () => {
      clicks++;
      setTimeout(() => controls[1].setAttribute('aria-checked', 'true'), 30);
    });
    controls[1].addEventListener('click', () => clicks++);
    let failure = '';
    try { await markAleksChoice(document, prompt.fingerprint!, observed.choice,
      ['option_1', 'option_2'], new AbortController().signal); }
    catch (error) { failure = (error as Error).message; }
    return { clicks, failure, diagnostic: window.choiceTest.aleksChoiceDiagnostics(document) };
  });
  expect(result).toMatchObject({ clicks: 1, failure: expect.stringContaining('modificó otra opción'), diagnostic: {
    status: 'observed', nativeCount: 0, ariaCount: 2, reason: 'Ya hay opciones seleccionadas.',
  } });
  expect(JSON.stringify(result.diagnostic)).not.toMatch(/private-id|proposición/);
});

test('revalida el grupo después de la autorización asíncrona y antes de pulsar', async ({ page }) => {
  await exercise(page, nativeChoices);
  const result = await page.evaluate(async () => {
    const { inspectAleksChoice, markAleksChoice, readAleksPrompt } = window.choiceTest;
    const observed = inspectAleksChoice(document)!;
    const prompt = await readAleksPrompt(document);
    let failure = '';
    try { await markAleksChoice(document, prompt.fingerprint!, observed.choice,
      ['option_1'], new AbortController().signal, async () => {
        const original = document.querySelector('input')!;
        original.replaceWith(original.cloneNode());
      }); }
    catch (error) { failure = (error as Error).message; }
    return { failure, selected: Boolean(document.querySelector('input:checked')) };
  });
  expect(result).toEqual({ failure: expect.stringContaining('Cambiaron el ejercicio o sus opciones'), selected: false });
});

test('rechaza grupos ambiguos, estados mixtos y opciones preseleccionadas', async ({ page }) => {
  await exercise(page, customChoices);
  const result = await page.evaluate(async () => {
    const { inspectAleksChoice, aleksChoiceDiagnostics, markAleksChoice, readAleksPrompt } = window.choiceTest;
    const group = document.querySelector('[role=group]')!;
    const another = group.cloneNode(true) as HTMLElement;
    group.after(another);
    const ambiguous = aleksChoiceDiagnostics(document);
    another.remove();
    const control = group.querySelector('[role=checkbox]')!;
    control.setAttribute('aria-checked', 'mixed');
    const mixed = aleksChoiceDiagnostics(document);
    control.setAttribute('aria-checked', 'true');
    const observed = inspectAleksChoice(document)!;
    const prompt = await readAleksPrompt(document);
    let occupied = '';
    try { await markAleksChoice(document, prompt.fingerprint!, observed.choice,
      ['option_2'], new AbortController().signal); }
    catch (error) { occupied = (error as Error).message; }
    return { ambiguous, mixed, occupied, selected: [...group.querySelectorAll('[aria-checked=true]')].length };
  });
  expect(result).toMatchObject({ ambiguous: { status: 'unsupported', candidateCount: 4 },
    mixed: { status: 'unsupported', candidateCount: 2 }, occupied: expect.stringContaining('ya hay una selección'), selected: 1 });
});
