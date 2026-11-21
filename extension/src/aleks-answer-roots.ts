import { painted, visible } from './aleks-dom';
import { parsePromptMath, promptMathText } from './aleks-prompt';

export const TEXT_EDITOR_INPUT = 'input.ansed_input[type="text"]';
const GENERIC_EDITOR = TEXT_EDITOR_INPUT + '[aria-label="Answer Editor"]';
type EventLetter = 'A' | 'B';

function probabilityLabel(input: HTMLInputElement): EventLetter | undefined {
  const label = input.getAttribute('aria-label')?.replace(/\s/gu, '');
  if (label === 'P(A)=') return 'A';
  if (label === 'P(B)=') return 'B';
}

function formula(cell: HTMLTableCellElement): string | undefined {
  const nodes = cell.querySelectorAll<HTMLElement>('span[mathml]');
  if (nodes.length !== 1 || !painted(cell) || !painted(nodes[0])) return;
  try {
    return promptMathText(parsePromptMath(nodes[0].getAttribute('mathml')!)).replace(/\s/gu, '');
  } catch {
    return;
  }
}

// Each input names its probability. Cross-check it against the two math cells
// in its own row, since their operators can be drawn on canvas without DOM text.
export function probabilityRowOrder(roots: HTMLElement[]): EventLetter[] | undefined {
  if (roots.length !== 2) return;
  const table = roots[0].closest('table');
  if (!table || table.getAttribute('role') !== 'presentation' || !visible(table) ||
      table.closest('#algoPrompt,[inert]') || table.rows.length !== 2 ||
      table.querySelectorAll('input,textarea,select').length !== 2) return;
  const events: EventLetter[] = [];
  for (const root of roots) {
    const row = root.closest('tr'), input = root.querySelector<HTMLInputElement>(TEXT_EDITOR_INPUT);
    if (!row || row.closest('table') !== table || row.cells.length !== 4 || root.closest('td') !== row.cells[3] ||
        !visible(root) || !input || input.closest('[aria-hidden="true"],[hidden],[inert]')) return;
    const event = probabilityLabel(input);
    if (!event || events.includes(event) || formula(row.cells[1]) !== 'P(' + event + ')' || formula(row.cells[2]) !== '=') return;
    events.push(event);
  }
  return events;
}

// The diagnostic includes English-labelled buffers without roots as before.
// Only the writer requires a complete visible association.
export function knownAnswerInputs(document: Document): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(TEXT_EDITOR_INPUT)]
    .filter(input => input.matches(GENERIC_EDITOR) || probabilityLabel(input));
}

export function answerRoots(document: Document): HTMLElement[] {
  const inputs = knownAnswerInputs(document);
  const roots = new Set<HTMLElement>();
  let hasProbability = false;
  for (const input of inputs) {
    const root = input.closest<HTMLElement>('.ansed_root');
    if (!root || !visible(root) || root.closest('#algoPrompt,[inert]')) continue;
    roots.add(root);
    if (probabilityLabel(input)) hasProbability = true;
  }
  const ordered = [...roots].sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top ||
    a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  return hasProbability && !probabilityRowOrder(ordered) ? [] : ordered;
}
