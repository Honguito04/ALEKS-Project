import type { PromptMath, PromptObservation } from './shared';

class Unreadable extends Error {}
const MAX_TEXT=4000, MAX_MATH=64, MAX_DOM_NODES=2000;
const normalize=(text:string)=>text.replace(/\s+/gu,' ').replace(/\s+([,.;:!?])/gu,'$1').trim();
const redactURLs=(text:string)=>text.replace(/https?:\/\/[^\s<>]+/giu,'[enlace]');
function operatorCodes(value:string) {
  const points=Array.from(value);
  return points.slice(0,8).map(char=>`U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4,'0')}`).join(' ')+(points.length>8?' …':'');
}

/** Convierte XML inerte en un AST cerrado. No inserta HTML ni conserva atributos,
 * URLs, identificadores, handlers o anotaciones alternativas del renderizador. */
export function parsePromptMath(xml:string):PromptMath {
  if(xml.length>4096 || /<!\s*(DOCTYPE|ENTITY)/iu.test(xml))throw new Unreadable('MathML demasiado largo o con declaraciones no admitidas.');
  const parsed=new DOMParser().parseFromString(xml,'application/xml');
  if(parsed.querySelector('parsererror') || parsed.documentElement.localName!=='math')throw new Unreadable('MathML inválido: no se puede leer la expresión completa.');
  let count=0;
  function visit(element:Element,depth:number):PromptMath {
    if(++count>128 || depth>12)throw new Unreadable('La expresión MathML supera los límites de complejidad.');
    if(element.namespaceURI && element.namespaceURI!=='http://www.w3.org/1998/Math/MathML')throw new Unreadable('Espacio de nombres MathML no admitido.');
    const tag=element.localName,children=[...element.children];
    if(['mn','mi','mo','mtext'].includes(tag)) {
      const raw=element.textContent || '',value=normalize(raw);
      // ALEKS usa <mn> </mn> como separación en m∠AOB = 160°.
      // Se conserva como espacio, nunca como un número ni un cero implícito.
      if(tag==='mn' && !children.length && raw.length>0 && !value)return {kind:'space'};
      if(children.length || !value || value.length>80)throw new Unreadable('Token matemático vacío o no admitido.');
      if(tag==='mn' && !/^[+−-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(value))throw new Unreadable('No se puede interpretar el número MathML sin ambigüedad.');
      if(tag==='mi' && !/^\p{L}{1,16}$/u.test(value))throw new Unreadable('Identificador matemático no admitido.');
      if(tag==='mo' && !['+','-','−','×','÷','*','/','=','<','>','≤','≥','≠','±','%','(',')','[',']','{','}',',',';',':','|','⋅','∞','∈','∉','∩','∪','∠','°','π','︵'].includes(value))throw new Unreadable(`Operador MathML no admitido (${operatorCodes(value)}).`);
      return {kind:tag==='mn'?'number':tag==='mi'?'identifier':tag==='mo'?'operator':'text',value:redactURLs(value)};
    }
    if([...element.childNodes].some(n=>n.nodeType===3 && n.textContent?.trim()))throw new Unreadable('Texto matemático fuera de un token reconocido.');
    if(tag==='semantics') {
      if(!children.length || children.slice(1).some(c=>!['annotation','annotation-xml'].includes(c.localName)))throw new Unreadable('Alternativas MathML ambiguas.');
      return visit(children[0],depth+1);
    }
    // mstyle agrupa como mrow. Se conserva cada hijo en orden; sus atributos
    // de presentación no se trasladan al AST ni se ejecutan.
    if(['math','mrow','mstyle','msqrt'].includes(tag)) {
      if(!children.length)throw new Unreadable('Representación matemática vacía.');
      return {kind:tag==='msqrt'?'sqrt':'row',items:children.map(c=>visit(c,depth+1))};
    }
    if(['mfrac','msup','mroot','msub','mover'].includes(tag) && children.length===2) {
      const left=visit(children[0],depth+1),right=visit(children[1],depth+1);
      if(tag==='mfrac')return {kind:'fraction',numerator:left,denominator:right};
      if(tag==='msup')return {kind:'power',base:left,exponent:right};
      if(tag==='mroot')return {kind:'root',radicand:left,index:right};
      if(tag==='mover')return {kind:'over',base:left,mark:right};
      return {kind:'subscript',base:left,index:right};
    }
    throw new Unreadable(`Estructura MathML no admitida: ${tag}.`);
  }
  return visit(parsed.documentElement,0);
}

export function promptMathText(math:PromptMath):string {
  if('value' in math)return math.value;
  if(math.kind==='space')return ' ';
  if(math.kind==='row')return math.items.map(promptMathText).join(' ');
  if(math.kind==='sqrt')return `sqrt(${math.items.map(promptMathText).join(' ')})`;
  if(math.kind==='fraction')return `(${promptMathText(math.numerator)})/(${promptMathText(math.denominator)})`;
  if(math.kind==='power')return `(${promptMathText(math.base)})^(${promptMathText(math.exponent)})`;
  if(math.kind==='root')return `root(${promptMathText(math.radicand)}; ${promptMathText(math.index)})`;
  if(math.kind==='over')return math.mark.kind==='operator' && math.mark.value==='︵' ? `arco(${promptMathText(math.base)})`:`over(${promptMathText(math.base)}; ${promptMathText(math.mark)})`;
  return `(${promptMathText(math.base)})_(${promptMathText(math.index)})`;
}

function hidden(element:Element) {
  const view=element.ownerDocument.defaultView;
  if(!view || element.closest('[hidden],[aria-hidden="true"],.visually-hidden,.never_read'))return true;
  for(let node:Element|null=element;node;node=node.parentElement) {
    const style=view.getComputedStyle(node);
    if(style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || style.opacity==='0')return true;
  }
  return false;
}

type PromptSnapshot={statement:string;mathematics:PromptMath[];multiplePartsDetected:boolean;diagramReferenceDetected:boolean};
function snapshot(document:Document):PromptSnapshot|{error:'missing'|'ambiguous'} {
  const roots=[...document.querySelectorAll<HTMLElement>('#algoPrompt')].filter(root=>!hidden(root));
  if(roots.length!==1)return {error:roots.length?'ambiguous' as const:'missing' as const};
  const root=roots[0],mathematics:PromptMath[]=[],chunks:string[]=[];
  let nodes=0,textLength=0;
  function add(text:string) {
    textLength+=text.length;
    if(textLength>MAX_TEXT)throw new Unreadable('El enunciado supera el tamaño admitido.');
    chunks.push(text);
  }
  function walk(node:Node,depth:number) {
    if(++nodes>MAX_DOM_NODES || depth>32)throw new Unreadable('El enunciado supera los límites de estructura.');
    if(node.nodeType===3) {add(node.textContent || '');return;}
    if(node.nodeType!==1)return;
    const element=node as HTMLElement,tag=element.tagName.toUpperCase();
    if(['STYLE','SCRIPT','NOSCRIPT','TEMPLATE'].includes(tag) || hidden(element))return;
    const xml=element.getAttribute('mathml');
    if(xml!==null || element.localName==='math') {
      if(mathematics.length>=MAX_MATH)throw new Unreadable('Demasiadas expresiones en el enunciado.');
      const math=parsePromptMath(xml ?? new XMLSerializer().serializeToString(element));
      mathematics.push(math);add(` ${promptMathText(math)} `);
      return; // No se recorre el duplicado accesible/visual ni su canvas/svg.
    }
    if(element.matches('.ansed_root,.ansed_tree'))throw new Unreadable('Hay matemáticas sin MathML verificable; no se leerá un duplicado parcial.');
    if(['IMG','SVG','CANVAS','IFRAME','OBJECT','EMBED'].includes(tag))throw new Unreadable('El enunciado incluye una imagen o gráfico que todavía no se interpreta.');
    if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(tag))throw new Unreadable('El enunciado incluye controles interactivos que requieren un adaptador específico.');
    if(tag==='BR'){add(' ');return;}
    const block=['P','DIV','BLOCKQUOTE','LI','UL','OL','TABLE','TR','TD','TH'].includes(tag);
    if(block)add(' ');
    for(const child of element.childNodes)walk(child,depth+1);
    if(block)add(' ');
    // A conserva solo su texto visible: href, IDs y parámetros no se leen.
  }
  walk(root,0);
  const statement=normalize(redactURLs(chunks.join('')));
  if(!statement)throw new Unreadable('No hay texto de enunciado legible.');
  // El contenedor de figuras se observó fuera de #algoPrompt. Solo se registra
  // su presencia: no se deducen medidas ni se leen URLs/canvas del dibujo.
  const figurePresent=[...document.querySelectorAll('.figed_top_container')].some(node=>!hidden(node));
  return {statement,mathematics,multiplePartsDetected:[...statement.matchAll(/\bSuceso\s+[A-Z]\s*:/gu)].length>1,
    diagramReferenceDetected:figurePresent || /\b(?:regi[oó]n\s+sombreada|figura|imagen|diagrama|gr[aá]fic[oa]|dibujo)\b/iu.test(statement) ||
      /\b(?:c[ií]rculo|tri[aá]ngulo|rect[aá]ngulo|pol[ií]gono)\s+(?:que\s+se\s+muestra|a\s+continuaci[oó]n)\b/iu.test(statement)};
}

/** Lectura acotada al contenedor observado. El contador/título es opcional y no
 * interviene en esta huella del enunciado, que no sustituye identidad de actividad,
 * campos o huella completa del ejercicio para autorizar operaciones. */
export async function readAleksPrompt(document:Document):Promise<PromptObservation> {
  try {
    const first=snapshot(document);
    if('error' in first)return {status:first.error,reason:first.error==='ambiguous'?'Hay varios enunciados visibles.':'No se encuentra un #algoPrompt visible.',autoSubmitSupported:false};
    const canonical=JSON.stringify(first);
    const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(canonical!==JSON.stringify(snapshot(document)))return {status:'ambiguous',reason:'El enunciado cambió durante la lectura.',autoSubmitSupported:false};
    const reason=first.diagramReferenceDetected?'Texto leído; se detecta un dibujo o una referencia visual. Incluye su imagen para consultar; no se han interpretado medidas ni regiones.':
      first.multiplePartsDetected?'Se detectan varios sucesos; falta validar sus campos de respuesta.':'Enunciado leído; interpretación y controles pendientes de validar.';
    return {status:'readable',reason,...first,fingerprint,autoSubmitSupported:false};
  } catch(error) {
    return {status:'unsupported',reason:error instanceof Unreadable?error.message:'No se pudo leer el enunciado completo.',autoSubmitSupported:false};
  }
}
