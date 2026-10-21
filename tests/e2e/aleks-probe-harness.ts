/** Solo para pruebas con los fragmentos aportados, nunca incluido en dist/. */
import { inspectAleksEditor } from '../../extension/src/aleks-editor';
import { PendingAleksAdapter } from '../../extension/src/adapters';
import { readAleksPrompt,parsePromptMath,promptMathText } from '../../extension/src/aleks-prompt';
import { assistContext,fillAssistInteger } from '../../extension/src/aleks-assist';
declare global { interface Window { assistContext:typeof assistContext;fillAssistInteger:typeof fillAssistInteger;aleksProbe:typeof inspectAleksEditor;pendingAdapter:PendingAleksAdapter;aleksPrompt:typeof readAleksPrompt;promptMath:typeof parsePromptMath;promptMathText:typeof promptMathText } }
window.aleksProbe=inspectAleksEditor;
window.pendingAdapter=new PendingAleksAdapter();
window.aleksPrompt=readAleksPrompt;window.promptMath=parsePromptMath;window.promptMathText=promptMathText;
window.assistContext=assistContext;window.fillAssistInteger=fillAssistInteger;
