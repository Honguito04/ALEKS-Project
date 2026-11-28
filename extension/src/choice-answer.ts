import type { AssistChoice, AssistContext, AssistView } from './shared';

export function choiceIdentity(choice: AssistChoice) {
  return JSON.stringify([choice.mode, choice.options.map(option => option.label).sort()]);
}

export function choiceAvailable(context: AssistContext) {
  return Boolean(context.choice && context.can_select_options && !context.diagram_required && !context.fill_blockers.length);
}

/** Los identificadores son ordinales de la lectura, nunca selectores de la página. */
export function proposedChoiceKeys(view: AssistView | undefined): string[] | undefined {
  if (!view?.context.choice || view.result.fingerprint !== view.context.fingerprint) return;
  const { choice } = view.context;
  const { proposal } = view.result;
  if (proposal.status !== 'proposed' || proposal.answers.length !== 1) return;
  const [answer] = proposal.answers;
  if (answer.field_key !== 'answer' || answer.unit) return;
  const requested = new Set(answer.value.split(','));
  const keys = choice.options.filter(option => requested.has(option.key)).map(option => option.key);
  if (!keys.length || keys.join(',') !== answer.value || (choice.mode === 'single' && keys.length !== 1)) return;
  return keys;
}

export function selectedChoiceKeys(view: AssistView | undefined) {
  return view && choiceAvailable(view.context) ? proposedChoiceKeys(view) : undefined;
}
