/** Solo para pruebas con los fragmentos aportados, nunca incluido en dist/. */
import { inspectAleksEditor } from '../../extension/src/aleks-editor';
import { PendingAleksAdapter } from '../../extension/src/adapters';
declare global { interface Window { aleksProbe:typeof inspectAleksEditor;pendingAdapter:PendingAleksAdapter } }
window.aleksProbe=inspectAleksEditor;
window.pendingAdapter=new PendingAleksAdapter();
