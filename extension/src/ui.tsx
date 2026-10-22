import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BACKEND, ALEKS_ACTIVITY, ALEKS_ORIGINS,type AssistView,type Run, type Exercise, type Solution, type Detection } from './shared';
import './ui.css';
import { proposalFillBlockers,fillBlockerMessages } from './assist-readiness';
import { prepareAssistImage } from './assist-image';

type Tab = {id:number;title:string;url:string};
type View = {tab?:Tab;detection?:Detection;run?:Run;exercise?:Exercise;solution?:Solution};
type Health = {status:string;google_configured:boolean;ai_configured:boolean;ai_provider?:string};
async function rpc(type:string,data:Record<string,unknown>={}) {
  const r=await chrome.runtime.sendMessage({scope:'ui',type,...data});
  if(!r?.ok) throw Error(r?.error || 'La extensión no respondió');return r.data;
}
function App() {
  const [health,setHealth]=useState<Health>();
  const [mode,setMode]=useState<string|null>(null);
  const [tabs,setTabs]=useState<Tab[]>([]),[selected,setSelected]=useState<number>();
  const [view,setView]=useState<View>({}),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [assist,setAssist]=useState<AssistView>(),[includeImage,setImage]=useState(false);
  const [imageFile,setImageFile]=useState<string>(),[needsImage,setNeedsImage]=useState(false);
  const [assistActive,setAssistActive]=useState(false);
  const [localStatus,setLocalStatus]=useState<{configured:boolean;online:boolean;model_installed:boolean;model:string}>();
  const [maxExercises,setMax]=useState(10),[maxMinutes,setMinutes]=useState(10),[maxAICalls,setCalls]=useState(0),[preview,setPreview]=useState(false);
  const options=location.pathname.endsWith('options.html');
  async function attempt(action:()=>Promise<void>) {
    setError('');setNotice('');setBusy(true);
    try {await action();} catch(e) {setError(e instanceof Error ? e.message:'No se pudo completar la operación');} finally {setBusy(false);}
  }
  async function refresh() {
    setHealth(await rpc('health'));setMode((await rpc('session')).mode);
    const list=await rpc('tabs');setTabs(list);if(!selected && list.length) setSelected(list[0].id);
  }
  async function connectBackend() {
    // Se llama directamente desde el gesto del usuario: no se solicitan permisos al instalar.
    const granted=await chrome.permissions.request({origins:[`${BACKEND}/*`]});
    if(!granted) {setError('No se concedió acceso al backend y simulador local');return;}
    await attempt(refresh);
  }
  useEffect(()=>{void chrome.permissions.contains({origins:[`${BACKEND}/*`]}).then(p=>{if(p) void attempt(refresh);});},[]);
  useEffect(()=>{setImageFile(undefined);setNeedsImage(false);setAssist(undefined);},[selected,view.detection?.promptObservation?.fingerprint]);
  useEffect(()=>{
    if(!selected || !view.detection) return;
    const timer=setInterval(()=>{void rpc('status',{tabId:selected}).then(setView).catch(e=>setError(e.message));},1000);
    return ()=>clearInterval(timer);
  },[selected,Boolean(view.detection)]);
  async function login(type:'google'|'demo') {await attempt(async()=>{setMode((await rpc(type)).mode);});}
  async function attach() {setAssist(undefined);await attempt(async()=>{setView(await rpc('attach',{tabId:selected}));});}
  async function command(type:string) {await attempt(async()=>{
    await rpc(type,{tabId:selected,activity:view.detection?.activity,limits:{maxExercises,maxMinutes,maxAICalls,preview}});
    setView(await rpc('status',{tabId:selected}));
  });}
  const run=view.run;
  const operations=Object.values(run?.operations || {});
  const editorDiagnostics=view.detection?.editorObservation?.inputDiagnostics;
  const circleTable=view.detection?.editorObservation?.circleTable;
  const menu=view.detection?.editorObservation?.menu;
  const singleEditor=view.detection?.editorObservation?.singleEditor;
  const showSingle=singleEditor?.status==='observed' && view.detection?.editorObservation?.renderedAnswer.status!=='readable';
  const aleks=Boolean(view.detection && ALEKS_ORIGINS.includes(view.detection.origin));
  const diagramRequired=needsImage || Boolean(view.detection?.promptObservation?.diagramReferenceDetected);
  const hasImage=includeImage || Boolean(imageFile);
  const fillBlockers=assist?proposalFillBlockers(assist):[];
  const canFill=Boolean(assist && fillBlockers.length===0);
  return <main>
    <header><span className="eyebrow">ASISTENTE MATEMÁTICO</span><h1>Comprueba.<br/><em>Después avanza.</em></h1><p>Un laboratorio de resolución exacta con controles de sesión.</p></header>
    <div className="banner">MVP · El recorrido automático está habilitado en el simulador local. ALEKS está pendiente de validación.</div>
    <section><div className="section-label">01 / CONEXIÓN</div>
      <div className="status"><span className={health?'dot on':'dot'}/><strong>{health?'Backend conectado · SymPy disponible':'Backend sin comprobar'}</strong></div>
      <p className="small">IA: {health?.ai_configured?'configurada':'opcional, sin configurar'} · Google: {health?.google_configured?'configurado':'pendiente de configuración'}</p>
      <button disabled={busy} onClick={()=>void connectBackend()}>Conectar backend y simulador</button>
      <p className="small">Acceso limitado a {BACKEND}. Lee ejercicios y escribe o envía respuestas en la actividad que autorices.</p>
    </section>
    <section><div className="section-label">02 / IDENTIDAD DE LA APLICACIÓN</div>
      {mode ? <><span className="pill">{mode==='demo'?'SESIÓN DE DEMOSTRACIÓN':'Identidad Google verificada'}</span><div className="actions">
        <button className="secondary" disabled={busy} onClick={()=>void attempt(async()=>{await rpc('logout');setMode(null);})}>Cerrar sesión</button>
        <button className="secondary" disabled={busy} onClick={()=>void attempt(async()=>{await rpc('unlink');setMode(null);setNotice('Sesiones de la extensión desvinculadas.');})}>Desvincular extensión</button>
      </div></> : <div className="stack">
        <button disabled={busy || !health} onClick={()=>void login('google')}>Continuar con Google</button>
        <button className="secondary" disabled={busy || !health} onClick={()=>void login('demo')}>Entrar en demostración</button>
      </div>}
      <p className="small">Google identifica tu cuenta en esta aplicación. ALEKS usa su propia sesión; inicia sesión allí por separado. No leemos contraseñas.</p>
    </section>
    {!options && <><section><div className="section-label">03 / PESTAÑA Y ACTIVIDAD</div>
      <button className="secondary" disabled={busy} onClick={()=>void attempt(refresh)}>Actualizar pestañas</button>
      <label>Pestaña de trabajo<select aria-label="Pestaña de trabajo" disabled={busy} value={selected || ''} onChange={e=>{setSelected(Number(e.target.value));setView({});setAssist(undefined);}}>
        <option value="">Selecciona una pestaña</option>{tabs.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
      </select></label>
      <button disabled={!selected || busy} onClick={()=>void attach()}>Leer actividad seleccionada</button>
      <p className="small">Abre el simulador en Chrome: <code>{BACKEND}/simulator/</code></p>
      {view.detection && <div className="inset"><strong>{view.detection.origin}</strong><p className="small">Actividad: {view.detection.activity}</p>
        {view.detection.observedTopic && <p>Tema observado: {view.detection.observedTopic}</p>}
        {view.detection.promptObservation?.status==='readable' ? <><p><strong>Enunciado leído</strong></p><p>{view.detection.promptObservation.statement}</p><p className="small">{view.detection.promptObservation.reason} Esta lectura no habilita envíos automáticos.</p></>:view.detection.promptObservation && <p className="small">{view.detection.promptObservation.reason}</p>}
        {view.detection.editorObservation && <>{circleTable?.status==='observed' ? <><p><strong>Dos recuadros visuales reconocidos por sus etiquetas.</strong></p>
          <p className="small">{circleTable.disabled?'Tabla deshabilitada.':'Tabla sin marca de bloqueo observada.'} La lectura no habilita escritura ni entrega.</p>
          {circleTable.fields.map(field=><p key={field.kind}>{field.label}: <strong>{field.readback.display || (field.readback.status==='empty'?'vacío':'lectura pendiente')}</strong><br/><span className="small">{field.readback.reason}</span></p>)}</>:
          showSingle ? <><p><strong>Un recuadro visual reconocido.</strong></p><p>Contenido del recuadro: <strong>{singleEditor.readback.display || (singleEditor.readback.status==='empty'?'vacío':'lectura pendiente')}</strong></p>
            <p className="small">{singleEditor.readback.reason} {singleEditor.disabled?'El editor está deshabilitado.':''}</p></>:
          <p className="small">Inspección ALEKS: {editorDiagnostics?.presentCount ?? view.detection.editorObservation.inputCount} entrada(s) encontradas y {editorDiagnostics?.visibleRootCount ?? 0} contenedor(es) visual(es) visibles. La presencia de un recuadro no confirma su funcionamiento.</p>}
          {editorDiagnostics && <details><summary>Detalle del diagnóstico del editor</summary><p className="small">Coincidencias del editor en la página: {editorDiagnostics.presentCount}. Con representación visual: {editorDiagnostics.paintedCount}. Marcadas como ocultas para accesibilidad: {editorDiagnostics.ariaHiddenCount}. Marcos incrustados: {editorDiagnostics.frameCount}.
            {editorDiagnostics.visibleRootCount!==undefined && <> Contenedores visuales del editor: {editorDiagnostics.visibleRootCount}.</>}
            {editorDiagnostics.blockedBy && <> Motivos de exclusión (pueden coincidir): sin caja de disposición: {editorDiagnostics.blockedBy.noLayout}; atributo hidden: {editorDiagnostics.blockedBy.hiddenAttribute}; display:none: {editorDiagnostics.blockedBy.displayNone}; visibility:hidden/collapse: {editorDiagnostics.blockedBy.visibilityHidden}; opacity:0: {editorDiagnostics.blockedBy.opacityZero}; documento sin vista: {editorDiagnostics.blockedBy.noView}.</>}
            {' '}{circleTable?.status==='observed'?'La asociación de los recuadros aparece arriba.':'Estos conteos no identifican qué respuesta corresponde a cada recuadro.'} No se inspecciona el contenido de los marcos.</p></details>}</>}
        {menu?.status==='observed' && Object.values(menu.controls).some(control=>control.count>0) && <p className="small">Menú: {Object.values(menu.controls).filter(control=>control.count===1).length} de 4 controles de fracción, π y unidades identificados; {Object.values(menu.controls).filter(control=>control.status==='disabled').length} deshabilitados.</p>}
        {view.detection.editorObservation?.renderedAnswer.status==='readable' && <p>Respuesta visible en el editor: <strong>{view.detection.editorObservation.renderedAnswer.display}</strong>. Aceptación pendiente.</p>}
        {view.detection.editorObservation?.submitControl.status==='observed' && <p className="small">Botón «{view.detection.editorObservation.submitControl.label || 'Entregar'}» identificado. La inspección no hace clic ni envía respuestas.</p>}
        {view.detection.editorObservation?.resultMarker.status==='positive_marker' ? <p>Mensaje «Correcta» y botón «{view.detection.editorObservation.resultMarker.continuation==='topic'?'Siguiente tema':'Siguiente'}» observados. Falta vincularlos a una entrega de la extensión.</p>:view.detection.editorObservation?.nextControl.status==='observed' && <p className="small">Botón «Siguiente» identificado. Falta asociar el resultado al ejercicio enviado; no se avanza automáticamente.</p>}
        {view.detection.editorObservation?.nextTopicControl?.status==='observed' && <p className="small">«Siguiente tema» cambia de tema. La inspección no lo pulsa ni autoriza una actividad nueva.</p>}
        <p>{view.detection.supported ? (view.detection.session?'Sesión del simulador disponible':'Sesión perdida'):view.detection.reason}</p></div>}
    </section>
    {aleks && <section><div className="section-label">IA LOCAL / OLLAMA</div>
      <p>Consulta el ejercicio con tu modelo local. La IA puede equivocarse: revisa la propuesta antes de usarla.</p>
      <button className="secondary" disabled={busy || !mode} onClick={()=>void attempt(async()=>{setLocalStatus(await rpc('localAIStatus'));})}>Comprobar Ollama</button>
      {localStatus && <p className="small">{!localStatus.configured?'Configura AI_PROVIDER=ollama y AI_MODEL en .env y reinicia el backend.':!localStatus.online?'Ollama no está disponible. Abre la aplicación Ollama en tu computadora.':!localStatus.model_installed?`Falta instalar el modelo ${localStatus.model} en Ollama.`:`Ollama conectado · ${localStatus.model} instalado.`}</p>}
      <label className="check"><input type="checkbox" checked={includeImage} disabled={busy} onChange={event=>{setImage(event.target.checked);setImageFile(undefined);setAssist(undefined);}}/>Incluir captura visible de la pestaña seleccionada</label>
      <p className="small">Para capturar, activa esa pestaña y pulsa el icono del asistente en la barra de Chrome. Abrirlo desde el menú lateral o elegir otra pestaña no concede ese permiso.</p>
      <label>Adjuntar imagen del ejercicio<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event=>{
        const file=event.target.files?.[0];event.target.value='';
        if(file)void attempt(async()=>{setAssist(undefined);setImageFile(undefined);setImage(false);setImageFile(await prepareAssistImage(file));});
      }}/></label>
      {imageFile && <><img src={imageFile} alt="Imagen adjunta para la consulta" style={{maxWidth:'100%',maxHeight:240,objectFit:'contain'}}/><button className="secondary" disabled={busy} onClick={()=>{setImageFile(undefined);setAssist(undefined);}}>Quitar imagen adjunta</button></>}
      {!view.detection?.promptObservation?.diagramReferenceDetected && <label className="check"><input type="checkbox" checked={needsImage} disabled={busy} onChange={event=>{setNeedsImage(event.target.checked);setAssist(undefined);}}/>El ejercicio necesita una imagen o dibujo</label>}
      {diagramRequired && !hasImage && <p role="note">Falta la imagen del ejercicio. Marca la captura visible o adjunta una imagen; no se consultará al modelo sin ella.</p>}
      <p className="small">El texto y la imagen elegida se envían a Ollama en tu computadora. La captura visible incluye toda el área de la pestaña y puede contener datos de tu cuenta; puedes adjuntar un recorte del ejercicio. La imagen no se guarda en el historial ni se envía a una API externa.</p>
      <button disabled={busy || !mode || health?.ai_provider!=='ollama' || (view.detection?.promptObservation?.status!=='readable' && !hasImage) || (diagramRequired && !hasImage)} onClick={()=>void attempt(async()=>{
        setAssist(undefined);setNotice('Consultando el modelo local…');setAssistActive(true);
        try{setAssist(await rpc('assist',{tabId:selected,includeImage,needsImage,...(imageFile?{image:imageFile}:{})}));}finally{setNotice('');setAssistActive(false);}
      })}>Resolver con IA local</button>
      {assistActive && <button className="danger" onClick={()=>void rpc('cancelAssist',{tabId:selected}).catch(error=>setError(error.message))}>Cancelar operación de IA</button>}
      {health?.ai_provider!=='ollama' && <p className="small">Activa Ollama en .env para habilitar esta función. Consulta docs/IA_GENERAL.md.</p>}
      {assist && <div className="inset"><p><strong>{assist.result.verified?'Resultado comprobado · premios por puestos':assist.result.proposal.status==='proposed'?'Propuesta de IA · sin verificar':assist.result.proposal.status==='needs_context'?'Falta información':'El modelo no obtuvo una solución utilizable'}</strong></p>
        {assist.result.proposal.answers.map(answer=><p key={answer.field_key}>{assist.context.fields.find(field=>field.key===answer.field_key)?.label || answer.field_key}: <strong>{answer.value} {answer.unit}</strong></p>)}
        <p>{assist.result.proposal.explanation}</p>{assist.result.proposal.missing_information.map((item,i)=><p key={i}>{item}</p>)}
        {canFill ? <button disabled={busy} onClick={()=>void attempt(async()=>{
          const proposal=assist;setAssist(undefined);setAssistActive(true);
          try {
            await rpc('assistFill',{tabId:selected,proposalId:proposal.id});
            setView(await rpc('status',{tabId:selected}));setNotice('Entero reflejado en el recuadro. No se pulsó Verificar; revisa el contenido antes de entregarlo.');
          }finally{setAssistActive(false);}
        })}>Introducir entero en el recuadro</button>:assist.result.proposal.status==='proposed' && <><p className="small">Escritura asistida no disponible:</p><ul>{fillBlockers.map(blocker=><li key={blocker}>{fillBlockerMessages[blocker]}</li>)}</ul></>}
      </div>}
    </section>}
    <section><div className="section-label">04 / AUTORIZACIÓN DE SESIÓN</div>
      <div className="limits"><label>Ejercicios<input type="number" min="1" max="100" value={maxExercises} onChange={e=>setMax(Number(e.target.value))}/></label>
      <label>Minutos<input type="number" min="1" max="120" value={maxMinutes} onChange={e=>setMinutes(Number(e.target.value))}/></label>
      <label>Llamadas IA<input type="number" min="0" max="100" value={maxAICalls} onChange={e=>setCalls(Number(e.target.value))}/></label></div>
      <label className="check"><input type="checkbox" checked={preview} onChange={e=>setPreview(e.target.checked)}/>Vista previa: leer y resolver sin escribir</label>
      <p className="small">Al iniciar autorizas {preview?'leer y resolver':'leer, resolver, escribir, enviar y avanzar'} en la pestaña y actividad mostradas, hasta los límites indicados. Puedes detenerlo en cualquier momento.</p>
      <button className="primary" disabled={busy || !mode || !view.detection?.supported || !view.detection?.session} onClick={()=>void command('start')}>Autorizar e iniciar</button>
      <div className="actions"><button className="secondary" disabled={!run} onClick={()=>void command('pause')}>Pausar</button><button className="secondary" disabled={run?.state!=='PAUSADO'} onClick={()=>void command('resume')}>Continuar</button><button className="danger" disabled={!run} onClick={()=>void command('stop')}>Detener</button></div>
    </section>
    <section aria-live="polite"><div className="section-label">05 / EJECUCIÓN</div><h2>{run?.state || 'INACTIVO'}</h2><p>{run?.message || 'Selecciona una actividad para comenzar.'}</p>
      {view.exercise && <div className="inset"><p>{view.exercise.statement}</p><strong>Respuesta: {view.solution?.answer || 'Calculando…'} {view.solution?.unit?.replace('^3','³')}</strong><p className="small">{view.solution?.status==='verified'?'Verificada matemáticamente':view.solution?'Propuesta sin verificación suficiente':'Pendiente'}</p></div>}
      <div className="metrics"><span><b>{operations.filter(o=>o.status==='accepted').length}</b>Aceptadas</span><span><b>{operations.filter(o=>o.status==='rejected').length}</b>Rechazadas</span><span><b>0</b>Omitidas</span><span><b>{operations.filter(o=>o.status==='uncertain').length}</b>Inciertas</span></div>
      <details><summary>Historial de transiciones</summary><ol>{run?.events.slice().reverse().map((e,i)=><li key={i}><b>{e.state}</b> · {e.message}</li>)}</ol></details>
    </section></>}
    {options && <section><div className="section-label">CONFIGURACIÓN LOCAL</div><p>Backend fijo del MVP: <code>{BACKEND}</code>.</p><p>ID de esta extensión: <code>{chrome.runtime.id}</code></p><p>Configura este ID en <code>CHROME_EXTENSION_IDS</code> del backend. Google requiere un cliente OAuth web y el retorno <code>{BACKEND}/auth/google/callback</code>. Las claves se guardan exclusivamente en el backend.</p><p>Ollama usa AI_PROVIDER=ollama y AI_MODEL en .env. La captura visible es opcional; no se manipulan gráficos interactivos.</p></section>}
    <section><div className="section-label">DATOS Y PERMISOS</div><div className="stack">
      <button className="secondary" disabled={busy} onClick={()=>void attempt(async()=>{await rpc('clear');setView({});setNotice('Historial de la aplicación borrado.');})}>Borrar historial de la aplicación</button>
      <button className="secondary" disabled={busy} onClick={()=>void attempt(async()=>{const ok=await chrome.permissions.request({origins:[`${ALEKS_ACTIVITY}/*`]});if(!ok) throw Error('Permiso ALEKS no concedido');await refresh();setNotice(`Inspección autorizada en ${ALEKS_ACTIVITY}. Los envíos reales siguen pendientes de validación.`);})}>Autorizar sitio ALEKS para inspección</button>
      <p className="small">Sitio de ejercicios confirmado: {ALEKS_ACTIVITY}. El permiso se solicita solo para ese origen.</p>
      <button className="danger" disabled={busy} onClick={()=>void attempt(async()=>{await rpc('revoke');setHealth(undefined);setView({});setTabs([]);setNotice('Permisos de los sitios revocados.');})}>Revocar permisos de sitios</button>
    </div></section>
    {error && <div className="error" role="alert">{error}</div>}{notice && <p role="status">{notice}</p>}
    <footer>{!options && <button className="link" onClick={()=>void chrome.runtime.openOptionsPage()}>Configuración</button>}Chrome y la pestaña deben permanecer abiertos.</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
