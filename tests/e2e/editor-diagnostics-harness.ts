import { editorDiagnostics } from '../../extension/src/editor-diagnostics';
declare global {interface Window {editorDiagnostics:typeof editorDiagnostics}}
window.editorDiagnostics=editorDiagnostics;
