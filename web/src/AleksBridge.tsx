import { WRITER_VERSION,UPDATE_WRITER_MESSAGE } from '../../extension/src/writer-version';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { z } from 'zod';
import type { AssistContext, AssistView } from '../../extension/src/shared';
import type { AutomationView } from '../../extension/src/aleks-automation';
import { assistContextSchema, assistResultSchema } from '../../extension/src/shared';
import { automationLimitsSchema } from '../../extension/src/aleks-automation';
import { proposalFillMessages } from '../../extension/src/assist-readiness';
import './bridge.css';

const EXTENSION_ID = 'fjjgjakbpjhhegekcjogilmfheaicjge';
const PORT_NAME = 'aleks-web-bridge-v1';
type Tab = { id: number; title: string; active?: boolean };
type Snapshot = { connected: boolean; writerVersion?: string; tab?: Tab; context?: AssistContext; proposal?: AssistView;
  automation?: AutomationView; providerCalls?: number; providerCallsUncertain?: boolean; interrupted?: string };
type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Pending = { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> };
type IssuedCapability = { id: string; csrf: string };
const tabSchema = z.object({ id: z.number().int().nonnegative(), title: z.string().max(500), active: z.boolean().optional() }).strict();
const proposalSchema = z.object({ id: z.uuid(), context: assistContextSchema, result: assistResultSchema }).strict();
const automationSchema = z.object({ id: z.uuid(), phase: z.enum(['LEYENDO', 'RESOLVIENDO', 'LISTO', 'ENVIANDO', 'CORRECTA', 'AVANZANDO', 'DETENIDO', 'COMPLETADO']),
  active: z.boolean(), busy: z.boolean(), canContinue: z.boolean(), accepted: z.number().int().min(0).max(100), aiCalls: z.number().int().min(0).max(100),
  started: z.number(), limits: automationLimitsSchema, message: z.string().max(4000), answer: z.string().max(500).optional() }).strict();
const snapshotSchema = z.object({ connected: z.boolean(), writerVersion:z.string().max(40).optional(), tab: tabSchema.optional(), context: assistContextSchema.optional(),
  proposal: proposalSchema.optional(), automation: automationSchema.optional(), providerCalls: z.number().int().nonnegative().optional(), providerCallsUncertain: z.boolean().optional(), interrupted: z.string().max(1000).optional() }).strict();

export default function AleksBridge({ userId, csrfToken, request, disconnectRef, suspended }: {
  userId: string; csrfToken: string; request: Api; disconnectRef: MutableRefObject<(() => void) | null>; suspended: boolean;
}) {
  const port = useRef<chrome.runtime.Port | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const lifecycle = useRef(0);
  const action = useRef(0);
  const issued = useRef<IssuedCapability | null>(null);
  const api = useRef(request); api.current = request;
  const csrf = useRef(csrfToken); csrf.current = csrfToken;
  const [connected, setConnected] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selected, setSelected] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [expires, setExpires] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('Conecta la extensión para trabajar sobre una pestaña ALEKS concreta.');
  const [error, setError] = useState('');
  const [nativeKeyboard, setNativeKeyboard] = useState(false);
  const [includeImage, setIncludeImage] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [limits, setLimits] = useState({ maxExercises: '1', maxMinutes: '5', maxAICalls: '2' });

  function revoke(capability: IssuedCapability | null) {
    if (!capability) return;
    void fetch('/web-api/bridge-token', { method: 'DELETE', credentials: 'same-origin',
      headers: { 'X-CSRF-Token': capability.csrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability_id: capability.id }), signal: AbortSignal.timeout(10000) }).catch(() => {});
  }

  function disconnect(message = 'Vínculo desconectado. Vuelve a conectar, seleccionar y leer la pestaña; no se reanudará ningún recorrido.') {
    lifecycle.current++; action.current++;
    const current = port.current; port.current = null;
    if (current) {
      try { current.disconnect(); } catch { /* The browser may already have closed it. */ }
    }
    for (const item of pending.current.values()) { clearTimeout(item.timer); item.reject(new Error('El vínculo se desconectó.')); }
    pending.current.clear(); revoke(issued.current); issued.current = null;
    setConnected(false); setTabs([]); setSelected(''); setSnapshot(null); setExpires(null);
    setBusy(''); setAuthorized(false); setNativeKeyboard(false); setIncludeImage(false); setError(''); setNotice(message);
  }

  useEffect(() => {
    disconnectRef.current = () => disconnect('Vínculo detenido por cambio de sesión. No se reanudará automáticamente.');
    return () => { disconnectRef.current = null; disconnect(); };
  }, [userId, csrfToken]);

  function command<T>(name: string, values: Record<string, unknown> = {}): Promise<T> {
    const current = port.current;
    if (!current) return Promise.reject(new Error('Conecta de nuevo la extensión.'));
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current.delete(requestId);
        disconnect('La extensión dejó de responder. El estado anterior ya no es válido; vuelve a vincular la pestaña.');
        reject(new Error('Se agotó la espera de la extensión.'));
      }, name === 'preview' ? 270000 : 20000);
      pending.current.set(requestId, { resolve: value => resolve(value as T), reject, timer });
      try { current.postMessage({ requestId, command: name, ...values }); }
      catch { clearTimeout(timer); pending.current.delete(requestId); reject(new Error('No se pudo enviar la orden a la extensión.')); }
    });
  }

  function receive(value: unknown, epoch: number) {
    if (epoch !== lifecycle.current || !value || typeof value !== 'object') return;
    const message = value as { requestId?: string; ok?: boolean; value?: unknown; error?: unknown; event?: string };
    if (message.event === 'progress' && message.value && typeof message.value === 'object') {
      const state = snapshotSchema.safeParse(message.value);
      if (!state.success) { disconnect('La extensión devolvió un estado incompatible. Actualízala antes de volver a vincular.'); return; }
      if (state.data.writerVersion!==WRITER_VERSION) { disconnect(`La versión de la extensión cambió. ${UPDATE_WRITER_MESSAGE}`); return; }
      if (!state.data.connected) { disconnect(); return; }
      setSnapshot(state.data); return;
    }
    if (typeof message.requestId !== 'string') return;
    const item = pending.current.get(message.requestId);
    if (!item) return;
    clearTimeout(item.timer); pending.current.delete(message.requestId);
    if (message.ok === true) item.resolve(message.value);
    else item.reject(new Error(message.error==='Comando del puente no admitido.' ? `La extensión conectada no reconoce esta versión de la web. ${UPDATE_WRITER_MESSAGE}` : typeof message.error === 'string' ? message.error : 'La extensión rechazó la orden. Vuelve a leer la pestaña.'));
  }

  async function connect() {
    const epoch = lifecycle.current; const operation = ++action.current;
    setBusy('connect'); setError(''); setNotice('Comprobando sesión y extensión…');
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.connect) {
        throw new Error('Esta función necesita Chrome de escritorio y la extensión instalada. En celulares puedes seguir usando las consultas web.');
      }
      const issuingCsrf = csrf.current;
      const capability = await api.current<{ token: string; capability_id: string; expires_at: number; user: { id: string } }>('/bridge-token', 'POST');
      const issuedCapability = { id: capability.capability_id, csrf: issuingCsrf };
      if (epoch !== lifecycle.current) {
        revoke(issuedCapability);
        return;
      }
      issued.current = issuedCapability;
      if (capability.user.id !== userId) throw new Error('La cuenta activa cambió. Recarga la página antes de conectar.');
      const current = chrome.runtime.connect(EXTENSION_ID, { name: PORT_NAME }); port.current = current;
      current.onMessage.addListener(message => receive(message, epoch));
      current.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (port.current === current) disconnect('La extensión se desconectó o no autorizó este sitio. El recorrido queda detenido. Vuelve a conectar y leer la pestaña; no hay reanudación automática.');
      });
      const status = snapshotSchema.parse(await command<Snapshot>('connect', { token: capability.token, writerVersion:WRITER_VERSION }));
      if(status.writerVersion!==WRITER_VERSION)throw new Error(`La extensión conectada es anterior o incompatible con la web ${WRITER_VERSION}. ${UPDATE_WRITER_MESSAGE}`);
      if (!status.connected) throw new Error('La extensión no confirmó la vinculación.');
      if (epoch !== lifecycle.current) return;
      setSnapshot(status); setConnected(true); setExpires(capability.expires_at);
      const available = z.array(tabSchema).max(1000).parse(await command<Tab[]>('list'));
      if (epoch !== lifecycle.current) return;
      setTabs(available); setSelected('');
      setNotice(available.length ? 'Extensión conectada. Elige y vincula una pestaña ALEKS.' : 'Extensión conectada. Abre tu ejercicio en ALEKS y pulsa Actualizar pestañas.');
    } catch (reason) {
      if (epoch === lifecycle.current) {
        const detail = reason instanceof Error ? reason.message : 'No se pudo conectar la extensión.';
        disconnect(); setError(detail);
      }
    } finally { if (operation === action.current) setBusy(''); }
  }

  async function perform(name: string, values: Record<string, unknown> = {}) {
    const epoch = lifecycle.current; const operation = ++action.current;
    setBusy(name); setError('');
    try {
      if (name === 'list') {
        const available = z.array(tabSchema).max(1000).parse(await command<Tab[]>(name));
        if (epoch === lifecycle.current && operation === action.current) {
          setTabs(available); setNotice(available.length ? 'Pestañas actualizadas.' : 'No hay pestañas ALEKS disponibles. Abre el ejercicio en Chrome.');
        }
      } else {
        const raw = await command<unknown>(name, values);
        const value = name === 'read' ? z.object({ context: assistContextSchema }).strict().parse(raw)
          : name === 'preview' ? z.object({ proposal: proposalSchema }).strict().parse(raw)
          : name === 'start' ? z.object({ automation: automationSchema }).strict().parse(raw) : snapshotSchema.parse(raw);
        if (epoch !== lifecycle.current || operation !== action.current) return;
        setSnapshot(previous => name === 'bind' ? value as Snapshot : { ...previous, ...(name === 'read' ? {proposal:undefined} : {}), ...value, connected: true });
        if (name === 'bind' || name === 'read' || name === 'stop') setAuthorized(false);
        if (name === 'bind') { setNativeKeyboard(false); setIncludeImage(false); }
        setNotice(name === 'bind' ? 'Pestaña vinculada. Lee la actividad antes de consultar.'
          : name === 'read' ? 'Actividad leída por la extensión. Comprueba enunciado, campos y formato.'
          : name === 'preview' ? 'Vista previa lista. No se ha escrito ni enviado ninguna respuesta.'
          : name === 'start' ? 'Recorrido autorizado. Chrome activará ALEKS; mantén esa pestaña enfocada.'
          : name === 'stop' ? 'Se solicitó detener el recorrido y cancelar las consultas pendientes.' : 'Estado actualizado.');
      }
    } catch (reason) {
      if (epoch === lifecycle.current && operation === action.current) setError(reason instanceof Error ? reason.message : 'La extensión rechazó la orden.');
    } finally { if (operation === action.current) setBusy(''); }
  }

  const context = snapshot?.context;
  const proposal = snapshot?.proposal;
  const automation = snapshot?.automation;
  const eligible = Boolean(context && [1,2].includes(context.fields.length) && !context.diagram_required &&
    (context.can_fill_integer || context.can_fill_fraction) && !context.fill_blockers.length);
  const blockers = proposal ? proposalFillMessages(proposal) : [];
  const numericLimits = { maxExercises: Number(limits.maxExercises), maxMinutes: Number(limits.maxMinutes), maxAICalls: Number(limits.maxAICalls) };
  const validLimits = Number.isInteger(numericLimits.maxExercises) && numericLimits.maxExercises >= 1 && numericLimits.maxExercises <= 100 &&
    Number.isInteger(numericLimits.maxMinutes) && numericLimits.maxMinutes >= 1 && numericLimits.maxMinutes <= 120 &&
    Number.isInteger(numericLimits.maxAICalls) && numericLimits.maxAICalls >= 1 && numericLimits.maxAICalls <= 100;
  const running = Boolean(automation?.active);

  return <section className="card bridge-card" aria-labelledby="bridge-title">
    <fieldset disabled={suspended}>
    <div className="section-heading"><div><span className="step-label">EXTENSIÓN / ALEKS</span><h2 id="bridge-title">Trabaja en tu pestaña ALEKS</h2></div><span className={`bridge-badge ${connected ? 'is-connected' : ''}`}>{connected ? 'Conectada' : 'Sin vínculo'}</span></div>
    <p className="muted">La web controla únicamente la pestaña que vincules. La extensión lee el ejercicio y ejecuta las teclas, la verificación y el avance; las consultas usan tu cuenta y sus cuotas en la nube.</p>
    <p className="field-help">Web {WRITER_VERSION}{snapshot?.writerVersion ? ` · Extensión ${snapshot.writerVersion}` : ''}</p>
    {error && <p className="message error" role="alert">{error}</p>}
    <p className="message status bridge-status" role="status" aria-live="polite">{notice}</p>
    {!connected ? <div className="bridge-connect"><button className="secondary" disabled={Boolean(busy)} onClick={() => void connect()}>{busy ? 'Conectando extensión…' : 'Conectar extensión ALEKS'}</button><p className="field-help">Necesitas Chrome de escritorio, la extensión actualizada y este origen autorizado en su compilación. No se conecta automáticamente.</p></div> : <>
      <div className="bridge-toolbar"><button className="inline-button" disabled={Boolean(busy) || running} onClick={() => void perform('list')}>Actualizar pestañas</button><button className="text-button" onClick={() => disconnect()}>Desvincular extensión</button></div>
      <div className="bridge-tab-picker"><div><label htmlFor="bridge-tab">Pestaña ALEKS que autorizas</label><select id="bridge-tab" value={selected} disabled={Boolean(busy) || running} onChange={event => { setSelected(event.target.value); setAuthorized(false); }}><option value="">Selecciona una pestaña</option>{tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.title || 'ALEKS'} · pestaña {tab.id}{tab.active ? ' (activa)' : ''}</option>)}</select></div><button className="secondary" disabled={!selected || Boolean(busy) || running} onClick={() => void perform('bind', { tabId: Number(selected) })}>Vincular pestaña</button></div>
      {snapshot?.tab && <>
        <p className="bridge-bound">Vinculada: <strong>{snapshot.tab.title || 'ALEKS'}</strong> · pestaña {snapshot.tab.id}</p>
        <label className="check-label"><input type="checkbox" checked={includeImage} disabled={Boolean(busy) || running} onChange={event => { setIncludeImage(event.target.checked); setAuthorized(false); setSnapshot(previous => previous ? { ...previous, proposal: undefined } : previous); }} />Adjuntar captura de la pestaña vinculada solo para vista previa; requiere permiso de Chrome y no autoriza escritura</label>
        <div className="bridge-actions"><button className="secondary" disabled={Boolean(busy) || running} onClick={() => void perform('read')}>Leer actividad ALEKS</button><button className="secondary" disabled={!context || Boolean(busy) || running} onClick={() => void perform('preview', { includeImage })}>{busy === 'preview' ? 'Consultando nube…' : 'Consultar vista previa'}</button><button className="inline-button" disabled={Boolean(busy)} onClick={() => void perform('status')}>Actualizar estado</button></div>
      </>}
      {context && <div className="bridge-context"><h3>Actividad observada</h3><p className="bridge-statement">{context.statement}</p><dl className="bridge-diagnostics"><div><dt>Campos</dt><dd>{context.fields.map(field => field.label).join(' · ')}</dd></div><div><dt>Unidad predefinida</dt><dd>{context.fixed_unit || 'Sin unidad reconocida'}</dd></div><div><dt>Formato</dt><dd>{eligible ? 'Editor vacío compatible' : 'Requiere revisión; no se autoriza escritura automática'}</dd></div><div><dt>Huella de actividad</dt><dd><code>{context.fingerprint}</code></dd></div></dl></div>}
      {proposal && <div className="bridge-proposal"><p className={`verification-tag ${proposal.result.verified ? 'verified' : 'unverified'}`}>{proposal.result.verified ? 'Resultado comprobado' : 'Propuesta de IA sin verificar'}</p>{proposal.result.proposal.answers.map(answer => <p key={answer.field_key}><strong>{answer.value}</strong> {answer.unit}</p>)}<p>{proposal.result.proposal.explanation}</p>{proposal.result.proposal.missing_information.map((information, index) => <p className="field-help" key={index}>{information}</p>)}{blockers.length > 0 && <p className="result-caution">{blockers.join(' ')}</p>}</div>}
      <div className="bridge-authorization"><h3>Autoriza un recorrido limitado</h3><p className="field-help">Texto con uno o dos recuadros vacíos: enteros, decimales con punto o coma y fracciones reducidas. Conserva unidades fijas y permite seleccionar cm, cm² o cm³. Diagramas y otros formatos requieren revisión manual.</p>
        <fieldset disabled={Boolean(busy) || running} className="bridge-limits">{([
          ['maxExercises', 'Máximo de respuestas', 100], ['maxMinutes', 'Máximo de minutos', 120], ['maxAICalls', 'Máximo de llamadas IA', 100],
        ] as const).map(([key, label, max]) => <div key={key}><label htmlFor={`bridge-${key}`}>{label}</label><input id={`bridge-${key}`} type="number" min="1" max={max} step="1" value={limits[key]} onChange={event => { setLimits(previous => ({ ...previous, [key]: event.target.value })); setAuthorized(false); }} /></div>)}</fieldset>
        <label className="check-label"><input type="checkbox" checked={nativeKeyboard} disabled={Boolean(busy) || running} onChange={event => { setNativeKeyboard(event.target.checked); setAuthorized(false); }} />Usar teclado de Chrome en la pestaña vinculada</label>
        <label className="check-label"><input type="checkbox" checked={authorized} disabled={!eligible || Boolean(busy) || running} onChange={event => setAuthorized(event.target.checked)} />Autorizo escribir, verificar y avanzar en la pestaña vinculada con estos límites</label>
        <p className="result-caution">Al iniciar, Chrome activa ALEKS. Mantén ALEKS como pestaña enfocada: volver a esta web puede detener el recorrido por sus controles de foco. La extensión ejecuta el recorrido; esta página no lo reanuda por sí sola.</p>
        <div className="bridge-actions"><button className="primary" disabled={!eligible || !nativeKeyboard || !authorized || !validLimits || Boolean(busy) || running || blockers.length > 0} onClick={() => void perform('start', { fingerprint: context!.fingerprint, limits: numericLimits, nativeKeyboard, ...(proposal ? { proposalId: proposal.id } : {}) })}>Autorizar e iniciar recorrido</button><button className="danger" onClick={() => { setAuthorized(false); void perform('stop'); }}>Detener recorrido ALEKS</button></div>
      </div>
      {snapshot && <div className="bridge-progress" aria-live="polite">{automation && <><h3>Estado: {automation.phase}</h3><p>{automation.message}</p></>}<dl><div><dt>«Correcta» confirmadas</dt><dd>{automation?.accepted ?? 0}</dd></div><div><dt>Presupuesto IA utilizado o reservado</dt><dd>{automation?.aiCalls ?? 0}</dd></div><div><dt>Llamadas confirmadas de la conexión</dt><dd>{snapshot.providerCallsUncertain ? 'Al menos ' : ''}{snapshot.providerCalls ?? 0}{snapshot.providerCallsUncertain && ' · consumo final sin confirmar'}</dd></div></dl></div>}
      {snapshot?.interrupted && <p className="message error" role="alert">{snapshot.interrupted} No se reanudará automáticamente.</p>}
      {expires && <p className="field-help">El vínculo caduca a las {new Date(expires * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}. Al caducar deberás conectar y leer de nuevo.</p>}
    </>}
    </fieldset>
  </section>;
}
