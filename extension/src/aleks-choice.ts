import { disabled, visible } from './aleks-dom';
import { currentAleksPromptGuard, parsePromptMath, promptMathText, readAleksPrompt } from './aleks-prompt';
import { assistChoiceSchema, type AssistChoice } from './shared';

const controlSelector = 'input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"]';
const groupSelector = 'fieldset,[role="group"],[role="radiogroup"],table,ul,ol';
const outsideActivity = 'nav,header,footer,aside,dialog,[role="dialog"],[role="navigation"],[inert],[aria-hidden="true"],#result_feedback_alert';
const instructions = /^(?:[¿¡]\s*)?(?:marc(?:a|ar|e)|seleccion(?:a|ar|e)|el(?:ige|egir|ija)|escog(?:e|er|a)|check|select|choose)\b/iu;
const choiceQuestion = /^(?:¿\s*)?(?:cu[aá]l(?:es)?|which)\b/iu;
const normalize = (text: string) => text.replace(/https?:\/\/[^\s<>]+/giu, '[enlace]').replace(/\s+/gu, ' ').replace(/\s+([,.;:!?°])/gu, '$1').trim();

type Option = {
  node: HTMLElement;
  target: HTMLElement;
  selected: boolean;
  disabled: boolean;
};
type ChoiceGroup = {
  choice: AssistChoice;
  enabled: boolean;
  empty: boolean;
  signature: string;
  prompt: HTMLElement;
  group: HTMLElement;
  options: Option[];
};
type Diagnostic = {
  status: 'missing' | 'unsupported' | 'observed';
  intent: boolean;
  candidateCount: number;
  nativeCount: number;
  ariaCount: number;
  reason: string;
};

function labelText(root: HTMLElement, limit = 600): string | undefined {
  let remaining = 250;
  const chunks: string[] = [];
  function visit(node: Node) {
    if (--remaining < 0) throw Error();
    if (node.nodeType === 3) {
      chunks.push((node.textContent || '').slice(0, limit + 1));
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (element.matches('script,style,template,.visually-hidden,.never_read') || !visible(element)) return;
    const mathml = element.getAttribute('mathml');
    if (mathml || element.localName === 'math') {
      const xml = mathml || new XMLSerializer().serializeToString(element);
      chunks.push(' ', promptMathText(parsePromptMath(xml)), ' ');
      return;
    }
    if (element.matches('img,svg,canvas,iframe,object,embed')) throw Error();
    if (element.matches('input,[role="checkbox"],[role="radio"]') && element !== root) return;
    if (element.localName === 'br') chunks.push(' ');
    element.childNodes.forEach(visit);
  }
  try {
    visit(root);
    const label = normalize(chunks.join(''));
    if (label.length >= 1 && label.length <= limit) return label;
  } catch { /* Una etiqueta ilegible no puede autorizar clics. */ }
}

function native(element: HTMLElement): element is HTMLInputElement {
  return element.localName === 'input' &&
    ((element as HTMLInputElement).type === 'checkbox' || (element as HTMLInputElement).type === 'radio');
}

function associatedLabels(element: HTMLElement): HTMLLabelElement[] {
  return native(element) ? [...(element.labels || [])].filter(label =>
    label.control === element && visible(label) && !label.closest(outsideActivity) &&
    (!label.hasAttribute('for') || (element.id &&
      element.ownerDocument.querySelectorAll('#' + CSS.escape(element.id)).length === 1))
  ) : [];
}

function optionLabel(element: HTMLElement, group: HTMLElement, labels: HTMLLabelElement[]) {
  const references = element.getAttribute('aria-labelledby')?.trim().split(/\s+/u);
  if (references?.length) {
    if (references.length > 6 || new Set(references).size !== references.length) return;
    const texts: string[] = [];
    for (const id of references) {
      const matches = element.ownerDocument.querySelectorAll<HTMLElement>('#' + CSS.escape(id));
      if (matches.length !== 1 || !group.contains(matches[0])) return;
      const text = labelText(matches[0]);
      if (!text) return;
      texts.push(text);
    }
    return normalize(texts.join(' '));
  }
  if (labels.length > 1 || labels.some(label => !group.contains(label))) return;
  const text = labels[0] ? labelText(labels[0]) : native(element) ? undefined : labelText(element);
  if (text) return text;

  // Las tablas y listas pueden asociar el control a su única fila aunque el
  // texto esté en una celda vecina y no tenga su propio <label>.
  const row = element.closest<HTMLElement>('tr,[role="row"],li,[role="listitem"]') || element.parentElement;
  if (row && row !== group && group.contains(row) && row.querySelectorAll(controlSelector).length === 1 &&
      !row.querySelector('button:not([role="checkbox"]):not([role="radio"]),select,textarea')) {
    return labelText(row);
  }
}

function commonContainer(nodes: HTMLElement[], scope: HTMLElement) {
  let group = nodes[0].parentElement;
  while (group && scope.contains(group) && !nodes.every(node => group!.contains(node))) group = group.parentElement;
  return group;
}

function scan(document: Document): { diagnostic: Diagnostic; observed?: ChoiceGroup } {
  const prompts = [...document.querySelectorAll<HTMLElement>('#algoPrompt')].filter(node => visible(node) && !node.closest(outsideActivity));
  const prompt = prompts[0];
  const statement = prompts.length === 1 ? labelText(prompt, 8000) ?? '' : '';
  const intent = instructions.test(statement);
  const finish = (status: Diagnostic['status'], reason: string, nodes: HTMLElement[] = []) => {
    const nativeCount = nodes.filter(native).length;
    return { diagnostic: { status, intent, candidateCount: nodes.length, nativeCount,
      ariaCount: nodes.length - nativeCount, reason } };
  };
  if (prompts.length !== 1) return finish('missing', 'No se encontró un enunciado visible único para asociar las opciones.');
  let branch: HTMLElement | null = prompt;
  for (let depth = 0; branch?.parentElement && depth < 8; depth++, branch = branch.parentElement) {
    const scope: HTMLElement = branch.parentElement;
    const candidates = [...scope.querySelectorAll<HTMLElement>(controlSelector)].filter(node =>
      !node.closest(outsideActivity) && !branch!.contains(node) &&
      Boolean(branch!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      (visible(node) || associatedLabels(node).length > 0)
    );
    if (!candidates.length) {
      if (scope === document.body) break;
      continue;
    }
    const unavailable = (reason: string) => finish('unsupported', reason, candidates);
    if (candidates.length < 2 || candidates.length > 12) return unavailable('El ejercicio requiere un grupo único de dos a doce opciones.');
    const group = commonContainer(candidates, scope);
    if (!group || group.contains(prompt) || !scope.contains(group)) return unavailable('Las opciones visibles no forman un solo grupo asociado al enunciado.');
    const semanticGroups = new Set(candidates.map(node => {
      const container = node.parentElement?.closest(groupSelector);
      return container && group.contains(container) ? container : group;
    }));
    if (semanticGroups.size !== 1) return unavailable('Se encontraron grupos de opciones separados.');
    const associated = group.getAttribute('aria-labelledby')?.trim() === prompt.id;
    const recognizableQuestion = choiceQuestion.test(statement) && group.matches(groupSelector);
    if (!associated && ((!intent && !recognizableQuestion) || (scope === document.body && branch !== prompt && !group.matches(groupSelector)))) {
      return unavailable('El enunciado y el grupo de opciones no tienen una asociación reconocible.');
    }
    const mode = (node: HTMLElement) => (native(node) ? node.type : node.getAttribute('role')) === 'radio' ? 'single' : 'multiple';
    const kind = mode(candidates[0]);
    if (candidates.some(node => mode(node) !== kind)) return unavailable('Se mezclaron controles de selección única y múltiple.');
    const radios = candidates.filter(native);
    if (kind === 'single') {
      if (radios.length !== 0 && radios.length !== candidates.length) return unavailable('Se mezclaron dos implementaciones de selección única.');
      if (radios.length) {
        const [first] = radios;
        if (!first.name || radios.some(node => node.name !== first.name || node.form !== first.form) ||
            [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].some(node =>
              node.name === first.name && node.form === first.form && !candidates.includes(node))) {
          return unavailable('Los botones de selección única no pertenecen exclusivamente al mismo grupo.');
        }
      } else if (![...semanticGroups][0].matches('[role="radiogroup"]')) {
        return unavailable('Los botones de selección única requieren un grupo de radio accesible.');
      }
    }

    const options: Option[] = [];
    const descriptors: AssistChoice['options'] = [];
    for (const [index, node] of candidates.entries()) {
      const labels = associatedLabels(node);
      const label = optionLabel(node, group, labels);
      const named = node.getAttribute('aria-label')?.trim();
      const target = visible(node) ? node : labels[0];
      const role = node.getAttribute('role');
      if (!label || !target || (named && normalize(named) !== label) ||
          node.closest('a[href]') || (native(node) ? (role !== null && role !== node.type) : !node.matches('div,span,button')) ||
          (node.localName === 'button' && (node as HTMLButtonElement).type !== 'button') ||
          candidates.some(other => other !== node && (node.contains(other) || target.contains(other)))) {
        return unavailable('Alguna opción no tiene una etiqueta visible y un control propios.');
      }
      const ariaChecked = node.getAttribute('aria-checked');
      const selected = native(node) ? node.checked : ariaChecked === 'true';
      if ((native(node) && node.indeterminate) || (!native(node) && ariaChecked !== 'true' && ariaChecked !== 'false') ||
          (ariaChecked !== null && ariaChecked !== String(selected))) {
        return unavailable('No se puede comprobar qué opciones están marcadas.');
      }
      descriptors.push({ key: `option_${index + 1}`, label });
      options.push({ node, target, selected, disabled: disabled(node) || disabled(target) || Boolean(node.closest('fieldset:disabled')) });
    }
    const parsed = assistChoiceSchema.safeParse({ mode: kind, options: descriptors });
    if (!parsed.success) return unavailable('Las etiquetas de las opciones son ambiguas o exceden el límite de lectura.');
    const enabled = options.every(option => !option.disabled);
    const empty = options.every(option => !option.selected);
    const reason = !enabled ? 'Hay opciones deshabilitadas.' : !empty ? 'Ya hay opciones seleccionadas.' : 'Las opciones forman un grupo reconocible.';
    return { ...finish('observed', reason, candidates), observed: { choice: parsed.data, enabled, empty,
      signature: JSON.stringify(parsed.data), options, prompt, group } };
  }
  return finish('missing', 'No se encontraron casillas o botones de selección reconocibles junto al enunciado.');
}

export function inspectAleksChoice(document: Document) {
  return scan(document).observed;
}

/** Solo publica cantidades y una razón fija del diagnóstico. */
export function aleksChoiceDiagnostics(document: Document): Diagnostic {
  return scan(document).diagnostic;
}

function reachable(target: HTMLElement) {
  const box = target.getBoundingClientRect();
  const hit = target.ownerDocument.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  const interactive = hit?.closest('a[href],button,input,select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="radio"]');
  return Boolean(hit && target.contains(hit) && (!interactive || interactive === target ||
    (target.localName === 'label' && (target as HTMLLabelElement).control === interactive)));
}

export async function markAleksChoice(
  document: Document,
  promptFingerprint: string,
  choice: AssistChoice,
  keys: string[],
  signal: AbortSignal,
  authorize?: () => Promise<void>,
): Promise<() => void> {
  signal.throwIfAborted();
  const prompt = await readAleksPrompt(document);
  const before = inspectAleksChoice(document);
  const parsedChoice = assistChoiceSchema.safeParse(choice);
  if (prompt.fingerprint !== promptFingerprint || !parsedChoice.success ||
      !before?.empty || !before.enabled || before.signature !== JSON.stringify(parsedChoice.data)) {
    throw Error('Cambiaron las opciones del ejercicio o ya hay una selección. Lee de nuevo la actividad.');
  }
  const selected = new Set(keys);
  if (!keys.length || keys.length !== selected.size || (choice.mode === 'single' && keys.length !== 1) ||
      keys.some(key => !choice.options.some(option => option.key === key))) {
    throw Error('La selección propuesta no corresponde a las opciones del ejercicio.');
  }
  const samePrompt = currentAleksPromptGuard(document);
  const checked = new Set<number>();
  function confirmNodes() {
    signal.throwIfAborted();
    if (!document.hasFocus()) throw Error('ALEKS perdió el foco. Revisa las opciones antes de continuar.');
    const current = inspectAleksChoice(document);
    if (!before || !current?.enabled || current.prompt !== before.prompt || current.group !== before.group ||
        current.signature !== before.signature || !samePrompt() ||
        current.options.some((option, index) => option.node !== before.options[index].node || option.target !== before.options[index].target)) {
      throw Error('Cambiaron el ejercicio o sus opciones. No se entregó la selección.');
    }
    return current;
  }
  function confirmSelection() {
    if (confirmNodes().options.some((option, index) => option.selected !== checked.has(index))) {
      throw Error('ALEKS no refleja las opciones esperadas. No se entregó la selección.');
    }
  }

  for (const [index, option] of choice.options.entries()) {
    if (!selected.has(option.key)) continue;
    confirmSelection();
    const target = before.options[index].target;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    await authorize?.();
    confirmSelection();
    if (!reachable(target)) throw Error('La opción está fuera de vista o cubierta. No se hizo clic.');
    target.click();
    const deadline = performance.now() + 500;
    for (;;) {
      const options = confirmNodes().options;
      if (options.some((value, other) => other !== index && value.selected !== checked.has(other))) {
        throw Error('ALEKS modificó otra opción distinta de la propuesta. No se entregó la selección.');
      }
      if (options[index].selected) break;
      if (performance.now() >= deadline) throw Error('ALEKS no confirmó la opción marcada. No se entregó la selección.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    checked.add(index);
    confirmSelection();
  }
  return confirmSelection;
}
