import { painted,visible,disabled } from './aleks-dom';

const INPUT='input.ansed_input[aria-label="Answer Editor"][type="text"]';
const knownClasses=['ansed_root','ansed_tree','AnsedObject','ansed_canvas','ansed_caret','ansed_input'];
const knownTags=new Set(['DIV','SPAN','INPUT','CANVAS','SVG','I','B','SUP','SUB','MATH','MROW','MN','MO','MFRAC']);
const numeric=(value:number)=>Number.isFinite(value)?Math.round(Math.max(-10000,Math.min(10000,value))*10)/10:0;
const bounds=(element:Element,root:DOMRect)=>{
  const rect=element.getBoundingClientRect();
  return {left:numeric(rect.left-root.left),top:numeric(rect.top-root.top),width:numeric(rect.width),height:numeric(rect.height)};
};
function visibility(element:HTMLElement) {
  const style=element.ownerDocument.defaultView?.getComputedStyle(element);
  return {painted:painted(element),accessible:visible(element),hidden:Boolean(element.closest('[hidden]')),
    ariaHidden:Boolean(element.closest('[aria-hidden="true"]')),displayNone:style?.display==='none',
    visibilityHidden:style?.visibility==='hidden' || style?.visibility==='collapse',
    opacity:style?numeric(Number(style.opacity)):null,disabled:disabled(element)};
}
interface DiagnosticNode {
  tag:string;classes:string[];box:ReturnType<typeof bounds>;visibility:ReturnType<typeof visibility>;
  token?:string;redactedText?:boolean;children?:DiagnosticNode[];
}

/** Informe de lectura acotado. No serializa HTML, atributos libres, input.value,
 * nombres de cuenta, enlaces de sesión, cookies ni contenidos de los marcos.
 * Las coordenadas son relativas al editor; no se envía el informe a un servidor.
 */
export function editorDiagnostics(document:Document) {
  const inputs=[...document.querySelectorAll<HTMLInputElement>(INPUT)].filter(input=>!input.closest('#algoPrompt'));
  const roots=[...new Set(inputs.map(input=>input.closest<HTMLElement>('.ansed_root')).filter((root):root is HTMLElement=>root!==null))];
  let truncated=roots.length>12,nodeBudget=60;
  const node=(element:HTMLElement,root:DOMRect,depth:number):DiagnosticNode|undefined=>{
    if(nodeBudget<=0 || depth>5){truncated=true;return;}
    nodeBudget--;
    const result:DiagnosticNode={tag:knownTags.has(element.tagName)?element.tagName.toLowerCase():'other',
      classes:knownClasses.filter(name=>element.classList.contains(name)),box:bounds(element,root),visibility:visibility(element)};
    // Nunca usar textContent del contenedor: podría incluir datos ajenos al
    // editor. Solo tokens matemáticos en nodos de texto directos del árbol.
    if(['SPAN','I','B','SUP','SUB','MN','MO'].includes(element.tagName)) {
      const direct=[...element.childNodes].filter(child=>child.nodeType===3).map(child=>child.textContent || '').join('').trim();
      if(direct && direct.length<=40 && /^[\dπ+\-−*/()²³.,^=\s]+$/u.test(direct))result.token=direct;
      else if(direct)result.redactedText=true;
    }
    // No inspeccionar estructuras SVG, canvas, ni atributos MathML ocultos.
    if(!['CANVAS','SVG','INPUT'].includes(element.tagName)) {
      const children:DiagnosticNode[]=[];
      for(const child of element.children) {
        if(nodeBudget<=0 || depth>=5){truncated=true;break;}
        const value=node(child as HTMLElement,root,depth+1);if(value)children.push(value);
      }
      if(children.length)result.children=children;
    }
    return result;
  };
  const editors=roots.slice(0,12).map((root,index)=>{
    const rect=root.getBoundingClientRect(),trees=[...root.querySelectorAll<HTMLElement>(':scope > .ansed_tree')];
    const editorInputs=[...root.querySelectorAll<HTMLInputElement>(INPUT)];
    return {index:index+1,box:{width:numeric(rect.width),height:numeric(rect.height)},visibility:visibility(root),
      inputCount:editorInputs.length,treeCount:trees.length,
      inputs:editorInputs.slice(0,4).map(input=>({visibility:visibility(input),readOnly:input.readOnly,box:bounds(input,rect)})),
      trees:trees.slice(0,2).map(tree=>node(tree,rect,0)).filter(item=>item!==undefined)};
  });
  const controls=[
    ...['Fraction','π','Centímetros','Centímetros cuadrados','Centímetros cúbicos','Undo','Start over'].map(label=>{
      const buttons=[...document.querySelectorAll<HTMLButtonElement>('.aleks-editor-menu button')].filter(button=>button.getAttribute('aria-label')===label);
      return {label,count:buttons.length,visible:buttons.filter(visible).length,enabled:buttons.filter(button=>visible(button) && !disabled(button)).length};
    }),
    ...[
      ['smt_bottomnav_button_input_checkAnswer','checkAnswer','Verificar'],
      ['smt_bottomnav_button_input_nextItemAssess','nextItemAssess','Entregar'],
      ['smt_bottomnav_button_input_learningCorrect','learningCorrect','Siguiente'],
      ['smt_bottomnav_button_input_learningCorrect','learningCorrect','Siguiente tema']
    ].map(([id,className,label])=>{
      const buttons=[...document.querySelectorAll<HTMLButtonElement>(`button#${id}.${className}[type="button"]`)]
        .filter(button=>button.querySelectorAll('div.textContent').length===1 && button.querySelector('div.textContent')?.textContent?.trim()===label);
      return {label,count:buttons.length,visible:buttons.filter(visible).length,enabled:buttons.filter(button=>visible(button) && !disabled(button)).length};
    })
  ];
  if(roots.slice(0,12).some(root=>root.querySelectorAll(INPUT).length>4 || root.querySelectorAll(':scope > .ansed_tree').length>2))truncated=true;
  return {version:1,title:'Diagnóstico del editor ALEKS',status:roots.length?'observed':'missing',rootCount:roots.length,
    visibleRootCount:roots.filter(visible).length,inputCount:inputs.length,frameCount:document.querySelectorAll('iframe,frame').length,
    truncated,editors,controls};
}
