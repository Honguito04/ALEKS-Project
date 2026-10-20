const host = document.querySelector('#exercise');
const notice = document.querySelector('#notice');
const activityType = new URL(location.href).searchParams.get('activity') || 'basic';
const problems = await fetch(`/api/simulator/problems?activity=${encodeURIComponent(activityType)}`).then(r => {
  if (!r.ok) throw Error('Actividad del simulador no compatible');
  return r.json();
});
const indexKey = `math-index:${activityType}`, activityKey = `math-activity:${activityType}`;
let index = Number(sessionStorage.getItem(indexKey) || 0);
let activity = sessionStorage.getItem(activityKey) || crypto.randomUUID();
sessionStorage.setItem(activityKey, activity);
let session = true, human = false, busy = false;
const fingerprint = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');

async function render() {
  host.replaceChildren();
  host.dataset.session = String(session);
  host.dataset.human = String(human);
  host.dataset.activity = activity;
  host.dataset.complete = String(index >= problems.length);
  delete host.dataset.fingerprint;
  delete host.dataset.operation;
  if (!session) { host.textContent = 'Sesión simulada cerrada. Reinicia la actividad.'; return; }
  if (human) { host.textContent = 'Verificación humana simulada. Pulsa otra vez el botón para resolverla manualmente.'; return; }
  if (index >= problems.length) { host.textContent = `Actividad del simulador completada: ${problems.length} ejercicios.`; return; }
  const p = problems[index];
  const quantity = p.math.family === 'cylinder_volume';
  const fields=[{id:'answer', kind:p.choices ? 'radio':quantity ? 'quantity':'text'}];
  const fp = await fingerprint(JSON.stringify([activity,p.statement,p.math,fields,p.choices || [],'real',p.units || '',p.format || 'exact',p.decimal_places ?? 2]));
  const payload = {...p, source:'simulator', activity_id:activity, fingerprint:fp,
    fields, choices:p.choices || [], domain:'real', units:p.units || '',
    format:p.format || 'exact', decimal_places:p.decimal_places ?? 2, evidence:['simulator-v1:structured-visible-data'], ambiguities:[]};
  delete payload.id;
  host.dataset.payload = JSON.stringify(payload);
  const count = document.createElement('small'); count.textContent = `Ejercicio ${index+1} / ${problems.length}`;
  const statement = document.createElement('p'); statement.id='statement'; statement.textContent=p.statement;
  const form = document.createElement('form'); form.id='answer-form';
  if (p.choices) {
    for (const choice of p.choices) {
      const label=document.createElement('label'); const input=document.createElement('input');
      input.type='radio'; input.name='answer'; input.value=choice.id; input.required=true;
      label.append(input, ` ${choice.expression}`); form.append(label);
    }
  } else {
    const label=document.createElement('label'); label.textContent=`Respuesta${p.units && !quantity ? ` (${p.units})`:''}`;
    const input=document.createElement('input'); input.id='answer'; input.name='answer'; input.autocomplete='off'; input.required=true;
    label.append(input); form.append(label);
    if (quantity) {
      const unitLabel=document.createElement('label'); unitLabel.textContent='Unidad de volumen';
      const select=document.createElement('select'); select.id='answer-unit';select.name='unit';select.required=true;
      for (const [value,text] of [['','Selecciona una unidad'],['mm^3','mm³'],['cm^3','cm³'],['m^3','m³']]) {
        const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);
      }
      unitLabel.append(select);form.append(unitLabel);
    }
  }
  const reflected=document.createElement('output'); reflected.id='reflected';
  const reflect=()=>{
    const data=new FormData(form);
    reflected.textContent=String(data.get('answer') || '');
    reflected.dataset.unit=String(data.get('unit') || '');
  };
  form.addEventListener('input',reflect);form.addEventListener('change',reflect);
  const submit=document.createElement('button'); submit.id='submit-answer'; submit.type='submit'; submit.textContent='Comprobar respuesta';
  const feedback=document.createElement('p'); feedback.id='feedback'; feedback.setAttribute('role','status');
  const next=document.createElement('button'); next.id='next-exercise'; next.textContent='Siguiente ejercicio'; next.hidden=true;
  next.addEventListener('click', () => { index++; sessionStorage.setItem(indexKey,String(index)); void render(); });
  form.append(reflected, document.createElement('br'), submit);
  host.append(count,statement,form,feedback,next);
  const saved=JSON.parse(sessionStorage.getItem(`math-result:${fp}`) || 'null');
  function showResult(result) {
    feedback.dataset.status=result.accepted ? 'accepted':'rejected'; feedback.dataset.fingerprint=fp;
    feedback.textContent=result.accepted ? 'Respuesta aceptada por el simulador.' : 'Respuesta rechazada por el simulador.';
    next.hidden=!result.accepted; submit.disabled=true;
  }
  if(saved) showResult(saved);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if(busy || saved || feedback.dataset.status) return;
    busy=true; submit.disabled=true;
    try {
      const response=await fetch('/api/simulator/grade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        problem_id:p.id,answer:String(new FormData(form).get('answer')),unit:String(new FormData(form).get('unit') || ''),operation_id:host.dataset.operation || crypto.randomUUID()
      })});
      if(!response.ok) throw Error('No se pudo confirmar la entrega');
      const result=await response.json();
      sessionStorage.setItem(`math-result:${fp}`,JSON.stringify(result));
      if(host.dataset.fingerprint===fp) showResult(result);
    } catch { notice.textContent='Estado incierto: no reenvíes automáticamente; comprueba el resultado.'; }
    finally { busy=false; }
  });
  host.dataset.fingerprint=fp;
}
document.querySelector('#reset').addEventListener('click',()=>{ activity=crypto.randomUUID();sessionStorage.setItem(activityKey,activity);sessionStorage.setItem(indexKey,'0');index=0;session=true;human=false;notice.textContent='';void render(); });
document.querySelector('#logout').addEventListener('click',()=>{session=false;void render();});
document.querySelector('#captcha').addEventListener('click',()=>{human=!human;void render();});
await render();
