import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BACKEND, ALEKS, type Run, type Exercise, type Solution, type Detection } from './shared';
import './ui.css';

type Tab = {id:number;title:string;url:string};
type View = {tab?:Tab;detection?:Detection;run?:Run;exercise?:Exercise;solution?:Solution};
type Health = {status:string;google_configured:boolean;ai_configured:boolean};
async function rpc(type:string,data:Record<string,unknown>={}) {
  const r=await chrome.runtime.sendMessage({scope:'ui',type,...data});
  if(!r?.ok) throw Error(r?.error || 'La extensión no respondió');return r.data;
}
function App() {
  const [health,setHealth]=useState<Health>();
  const [mode,setMode]=useState<string|null>(null);
  const [tabs,setTabs]=useState<Tab[]>([]),[selected,setSelected]=useState<number>();
  const [view,setView]=useState<View>({}),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
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
  useEffect(()=>{
    if(!selected || !view.detection) return;
    const timer=setInterval(()=>{void rpc('status',{tabId:selected}).then(setView).catch(e=>setError(e.message));},1000);
    return ()=>clearInterval(timer);
  },[selected,Boolean(view.detection)]);
  async function login(type:'google'|'demo') {await attempt(async()=>{setMode((await rpc(type)).mode);});}
  async function attach() {await attempt(async()=>{setView(await rpc('attach',{tabId:selected}));});}
  async function command(type:string) {await attempt(async()=>{
    await rpc(type,{tabId:selected,activity:view.detection?.activity,limits:{maxExercises,maxMinutes,maxAICalls,preview}});
    setView(await rpc('status',{tabId:selected}));
  });}
  const run=view.run;
  const operations=Object.values(run?.operations || {});
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
      {mode ? <><span className="pill">{mode==='demo'?'DEMOSTRACIÓN · solo simulador':'Identidad Google verificada'}</span><div className="actions">
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
      <label>Pestaña de trabajo<select aria-label="Pestaña de trabajo" value={selected || ''} onChange={e=>{setSelected(Number(e.target.value));setView({});}}>
        <option value="">Selecciona una pestaña</option>{tabs.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
      </select></label>
      <button disabled={!selected || busy} onClick={()=>void attach()}>Leer actividad seleccionada</button>
      <p className="small">Abre el simulador en Chrome: <code>{BACKEND}/simulator/</code></p>
      {view.detection && <div className="inset"><strong>{view.detection.origin}</strong><p className="small">Actividad: {view.detection.activity}</p>
        {view.detection.editorObservation && <p className="small">Inspección ALEKS: {view.detection.editorObservation.inputCount} campo(s) visibles y {view.detection.editorObservation.unitButtonCount} botón(es) de cm³. La presencia de un control no confirma su funcionamiento.</p>}
        <p>{view.detection.supported ? (view.detection.session?'Sesión del simulador disponible':'Sesión perdida'):view.detection.reason}</p></div>}
    </section>
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
    {options && <section><div className="section-label">CONFIGURACIÓN LOCAL</div><p>Backend fijo del MVP: <code>{BACKEND}</code>.</p><p>ID de esta extensión: <code>{chrome.runtime.id}</code></p><p>Configura este ID en <code>CHROME_EXTENSION_IDS</code> del backend. Google requiere un cliente OAuth web y el retorno <code>{BACKEND}/auth/google/callback</code>. Las claves se guardan exclusivamente en el backend.</p><p>No hay capturas de pantalla ni editores gráficos compatibles en esta versión.</p></section>}
    <section><div className="section-label">DATOS Y PERMISOS</div><div className="stack">
      <button className="secondary" disabled={busy} onClick={()=>void attempt(async()=>{await rpc('clear');setView({});setNotice('Historial de la aplicación borrado.');})}>Borrar historial de la aplicación</button>
      <button className="secondary" disabled={busy} onClick={()=>void attempt(async()=>{const ok=await chrome.permissions.request({origins:[`${ALEKS}/*`]});if(!ok) throw Error('Permiso ALEKS no concedido');await refresh();setNotice('Permiso concedido. La integración real sigue pendiente de validación.');})}>Autorizar sitio ALEKS para inspección</button>
      <button className="danger" disabled={busy} onClick={()=>void attempt(async()=>{await rpc('revoke');setHealth(undefined);setView({});setTabs([]);setNotice('Permisos de los sitios revocados.');})}>Revocar permisos de sitios</button>
    </div></section>
    {error && <div className="error" role="alert">{error}</div>}{notice && <p role="status">{notice}</p>}
    <footer>{!options && <button className="link" onClick={()=>void chrome.runtime.openOptionsPage()}>Configuración</button>}Chrome y la pestaña deben permanecer abiertos.</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
