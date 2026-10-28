import { assistContext,fillAssistAnswer } from '../../extension/src/aleks-assist';
import { inspectSingleEditor } from '../../extension/src/aleks-single-editor';
import { parseSupportedAnswer } from '../../extension/src/answer-format';
declare global {interface Window {fractionTest:{assistContext:typeof assistContext;fillAssistAnswer:typeof fillAssistAnswer;inspectSingleEditor:typeof inspectSingleEditor;parseSupportedAnswer:typeof parseSupportedAnswer}}}
window.fractionTest={assistContext,fillAssistAnswer,inspectSingleEditor,parseSupportedAnswer};
