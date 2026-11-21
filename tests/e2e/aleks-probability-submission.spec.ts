import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

let fixture: string, bundle: string;
test.beforeAll(async () => {
  const [prompt, rows, verify] = await Promise.all(
    ['aleks-prompt-fragment', 'aleks-probability-rows', 'aleks-verify-button']
      .map(name => readFile('tests/fixtures/' + name + '.html', 'utf8'))
  );
  fixture = prompt.replaceAll('7', '5').replace('</body>', rows + verify + '</body>');
  bundle = (await build({ entryPoints: ['tests/e2e/aleks-submission-harness.ts'], bundle: true,
    write: false, format: 'iife', target: 'es2022' })).outputFiles[0].text;
});

for (const mode of ['correct', 'reversed', 'conflicting-label', 'duplicate', 'focus', 'cancel', 'changed-label', 'swapped-identities', 'changed-first'] as const) {
  test('entrega de ambas probabilidades: ' + mode, async ({page}) => {
    await page.route('**/probability-rows', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await page.goto('/probability-rows');
    await page.addScriptTag({content: bundle});
    const actual = await page.evaluate(async mode => {
      const table = document.querySelector<HTMLTableElement>('.probability-exercise')!;
      const [rowA, rowB] = table.rows;
      if (mode === 'reversed') rowA.before(rowB);
      const inputs = [...table.querySelectorAll('input')];
      if (mode === 'conflicting-label') rowA.cells[1].querySelector('span')!.setAttribute('mathml',
        '<math><mi>P</mi><mo>(</mo><mi>B</mi><mo>)</mo></math>');
      if (mode === 'duplicate') inputs[1].setAttribute('aria-label', 'P(A) = ');
      const abort = new AbortController();
      let writes = 0, clicks = 0, error = '', duplicateRejected = false;
      const observed: Record<string,string[]> = {};
      const submit = document.querySelector<HTMLButtonElement>('button.checkAnswer')!;
      inputs.forEach((input, index) => input.addEventListener('input', () => {
        writes++;
        const root = input.closest<HTMLElement>('.ansed_root')!, tree = root.querySelector('.ansed_tree')!;
        const parts = input.value.split('/');
        // Public events stand in for the ALEKS renderer, which expands the
        // original 17x32 root to contain the two vertical glyph rows.
        root.style.width='48px'; root.style.height='60px';
        parts.forEach((part, i) => {
          const token = document.createElement('span');
          token.className = 'AnsedObject'; token.textContent = part;
          token.style.cssText = 'position:absolute;left:6px;top:' + (4+i*25) + 'px;height:19px';
          tree.append(token);
        });
        input.value = '';
        if (mode === 'focus') submit.focus();
        if (mode === 'cancel') abort.abort();
        if (index === 1 && mode === 'changed-label') inputs[0].setAttribute('aria-label','P(B) = ');
        if (index === 1 && mode === 'swapped-identities') {
          // The DOM nodes stay in place and both labels remain valid. Their
          // meaning has changed, so a comparison of node identity alone fails.
          const mathA=rowA.cells[1].querySelector('span[mathml]')!;
          const mathB=rowB.cells[1].querySelector('span[mathml]')!;
          const previous=mathA.getAttribute('mathml')!;
          mathA.setAttribute('mathml',mathB.getAttribute('mathml')!);
          mathB.setAttribute('mathml',previous);
          inputs[0].setAttribute('aria-label','P(B) = ');
          inputs[1].setAttribute('aria-label','P(A) = ');
        }
        if (index === 1 && mode === 'changed-first') rowA.cells[3].querySelector('.AnsedObject')!.textContent='7';
      }));
      submit.addEventListener('click', () => {
        clicks++;
        for (const input of inputs) {
          observed[input.getAttribute('aria-label')!.trim()] = [...input.closest('.ansed_root')!
            .querySelectorAll('.ansed_tree > span')].map(token => token.textContent!);
        }
        submit.remove();
        document.body.insertAdjacentHTML('beforeend','<div id="result_feedback_alert" aria-live="polite"><div style="display:inline-block;color:rgb(57,108,41)">Correcta</div></div><button type="button" id="smt_bottomnav_button_input_learningCorrect" class="learningCorrect"><div class="textContent">Siguiente</div></button>');
      });
      const context = await window.assistContext(document);
      const answers = context.fields.map(field => ({field_key:field.key,
        value:field.label.startsWith('P(A)')?'13/18':'1/2'})).reverse();
      const driver = new window.AleksSubmission(document, 400);
      try {
        await driver.submit(context.fingerprint, answers, abort.signal);
        try { await driver.submit(context.fingerprint, answers, abort.signal); }
        catch { duplicateRejected = true; }
      } catch (e) { error = (e as Error).message; }
      return { authorized:context.can_fill_fraction, writes, clicks, observed, error, duplicateRejected };
    }, mode);
    if (mode === 'correct' || mode === 'reversed') {
      expect(actual).toMatchObject({ authorized:true, writes:2, clicks:1, duplicateRejected:true,
        observed:{'P(A) =':['13','18'],'P(B) =':['1','2']}, error:'' });
    } else {
      expect(actual.clicks).toBe(0); expect(actual.error).not.toBe('');
      if (mode === 'duplicate' || mode === 'conflicting-label') {
        expect(actual.authorized).toBe(false); expect(actual.writes).toBe(0);
      } else {
        expect(actual.authorized).toBe(true);
        expect(actual.writes).toBe(mode === 'focus' || mode === 'cancel' ? 1 : 2);
      }
    }
  });
}
