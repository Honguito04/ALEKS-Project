import { useEffect, useRef, useState, type FormEvent } from 'react';

type User = { id: string; email: string };
type Session = { user: User | null; csrf_token: string };
type Answer = { field_key: string; value: string; unit: string };
type Result = { verified: boolean; provider: string; provider_calls: number; proposal: {
  status: 'proposed' | 'needs_context' | 'unable_to_solve'; answers: Answer[];
  explanation: string; missing_information: string[];
} };
type Field = { key: string; label: string; unit: string };
type Job = { status: 'pending' | 'completed' | 'error' | 'cancelled'; result?: Result; error?: { code: string; message: string } };

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const initialFields = (): Field[] => [{ key: 'answer', label: 'Respuesta', unit: '' }];
const sample = 'Hay 4 nadadores en una carrera. Hay premios para un primer lugar y un segundo lugar. ¿De cuántas maneras distintas se pueden otorgar los 2 premios?';

async function jpeg(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Adjunta una imagen JPG, PNG o WebP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('La imagen supera 8 MB. Reduce su tamaño e inténtalo de nuevo.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error('La imagen tiene dimensiones demasiado grandes.');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('El navegador no pudo preparar la imagen.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', 0.82);
    if (image.length > 1_300_000) throw new Error('La imagen sigue siendo demasiado grande. Recorta el ejercicio antes de adjuntarlo.');
    return image;
  } finally { bitmap.close(); }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const generation = useRef(0);
  const jobRef = useRef<string | null>(null);
  const cancellation = useRef<Promise<void>>(Promise.resolve());
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [statement, setStatement] = useState('');
  const [fields, setFields] = useState<Field[]>(initialFields);
  const [diagramRequired, setDiagramRequired] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  function acceptSession(next: Session) {
    generation.current++;
    jobRef.current = null;
    sessionRef.current = next; setSession(next);
    if (!next.user) setMode('login');
    setPassword(''); setAccountPassword(''); setAccountOpen(false); setConfirmDelete(false);
    setStatement(''); setFields(initialFields()); setImage(null); setImageName('');
    setDiagramRequired(false); setResult(null); setBusy(false); setImageBusy(false);
  }

  async function loadSession() {
    const run = generation.current;
    const response = await fetch('/web-api/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo conectar con el servidor. Recarga la página para volver a intentar.');
    const next = await response.json() as Session;
    if (generation.current === run) acceptSession(next);
  }

  useEffect(() => {
    let live = true;
    fetch('/web-api/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('El servidor no está disponible. Recarga la página para volver a intentar.');
        const next = await response.json() as Session;
        if (live) acceptSession(next);
      }).catch(reason => { if (live) setError(reason.message); });
    return () => { live = false; generation.current++; };
  }, []);

  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const dispatchedSession = sessionRef.current;
    const response = await fetch(`/web-api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(method === 'GET' ? {} : { 'X-CSRF-Token': sessionRef.current?.csrf_token || '' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const fallback = response.status === 429 ? 'Cuota o límite de intentos alcanzado. Espera antes de volver a intentar.'
        : response.status === 404 ? 'La consulta ya no está disponible. El servidor pudo reiniciarse; no se volverá a enviar automáticamente.'
        : response.status === 503 ? 'El servicio de IA todavía no está disponible. Prueba el ejemplo comprobable o inténtalo más tarde.'
        : response.status === 401 ? 'Tu sesión venció. Vuelve a entrar.'
        : response.status === 403 ? 'La solicitud no pudo verificarse. Recarga la página antes de intentarlo.'
        : 'No se pudo completar la solicitud. Revisa los datos e inténtalo de nuevo.';
      if (response.status === 401 && dispatchedSession?.user && sessionRef.current === dispatchedSession) {
        acceptSession({ user: null, csrf_token: '' });
        setNotice('Tu sesión venció. Vuelve a entrar.');
        void loadSession().catch(() => {});
      }
      throw new ApiError(typeof payload?.detail === 'string' ? payload.detail : fallback, response.status);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  async function cancelRemote(id: string | null, token: string) {
    const response = await fetch(`/web-api/jobs${id ? `/${encodeURIComponent(id)}` : ''}`, {
      method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRF-Token': token },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok && response.status !== 404) throw new Error('No se pudo confirmar la cancelación.');
  }

  function cancel() {
    const run = ++generation.current;
    const id = jobRef.current; jobRef.current = null;
    setBusy(false); setResult(null); setError('');
    setNotice('Espera cancelada. Confirmando la cancelación en el servidor…');
    cancellation.current = cancelRemote(id, sessionRef.current?.csrf_token || '').then(() => {
      if (run === generation.current) setNotice('Consulta cancelada. Una llamada ya enviada puede consumir cuota.');
    }).catch(() => {
      if (run === generation.current) setError('Se detuvo la espera local. No se pudo confirmar la cancelación en el servidor.');
    });
  }

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setAuthBusy(true);
    try {
      const next = await request<Session>(`/${mode}`, 'POST', { email: email.trim(), password });
      acceptSession(next); setNotice(mode === 'register' ? 'Tu cuenta está lista.' : 'Sesión iniciada.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.'); }
    finally { setAuthBusy(false); setPassword(''); }
  }

  async function logout() {
    generation.current++; setBusy(false); setResult(null); setError(''); setAuthBusy(true);
    try {
      await request('/logout', 'POST');
      acceptSession({ user: null, csrf_token: '' });
      setNotice('Sesión cerrada. Las consultas y sus resultados se han eliminado.');
      await loadSession();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cerrar la sesión.'); }
    finally { setAuthBusy(false); }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault(); if (!confirmDelete) return;
    setError(''); setAuthBusy(true);
    try {
      await request('/account', 'DELETE', { password: accountPassword });
      acceptSession({ user: null, csrf_token: '' });
      setNotice('Cuenta eliminada. Sus sesiones y consultas se han revocado.');
      await loadSession();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo eliminar la cuenta.'); }
    finally { setAuthBusy(false); setAccountPassword(''); }
  }

  async function attach(file?: File) {
    if (!file) return;
    const run = ++generation.current; setImageBusy(true); setError(''); setResult(null);
    setImage(null); setImageName('');
    try {
      const converted = await jpeg(file);
      if (generation.current === run) { setImage(converted); setImageName(file.name); }
    } catch (reason) {
      if (generation.current === run) setError(reason instanceof Error ? reason.message : 'No se pudo leer la imagen.');
    } finally { if (generation.current === run) setImageBusy(false); }
  }

  async function consult(event: FormEvent) {
    event.preventDefault();
    if (!sessionRef.current?.user || imageBusy) return;
    if (diagramRequired && !image) { setError('Este ejercicio necesita una imagen. Adjunta el diagrama antes de consultar.'); return; }
    const run = ++generation.current;
    const token = sessionRef.current.csrf_token;
    setBusy(true); setResult(null); setError(''); setNotice('Preparando consulta…');
    try {
      const context = {
        fingerprint: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ statement, fields, image }))))).map(byte => byte.toString(16).padStart(2, '0')).join(''),
        statement: statement.trim(), fields: fields.map(field => ({ key: field.key, label: field.unit.trim() ? `${field.label.trim()} (unidad solicitada: ${field.unit.trim()})` : field.label.trim() })),
        diagram_required: diagramRequired, can_fill_integer: false,
      };
      await cancellation.current;
      if (run !== generation.current) return;
      const created = await request<{ id: string }>('/jobs', 'POST', { context, image });
      if (run !== generation.current) { void cancelRemote(created.id, token).catch(() => {}); return; }
      jobRef.current = created.id; setNotice('Procesando. Revisando la propuesta y sus cálculos…');
      while (run === generation.current) {
        const job = await request<Job>(`/jobs/${created.id}`);
        if (run !== generation.current) return;
        if (job.status === 'completed' && job.result) {
          setResult(job.result); setNotice('Consulta terminada. Revisa el resultado antes de utilizarlo.'); return;
        }
        if (job.status === 'error') throw new Error(job.error?.message || 'La consulta falló. No se reenviará automáticamente.');
        if (job.status === 'cancelled') { setNotice('Consulta cancelada.'); return; }
        await new Promise(resolve => setTimeout(resolve, 900));
      }
    } catch (reason) {
      if (run === generation.current) { setError(reason instanceof Error ? reason.message : 'Se perdió la conexión. No se reenviará la consulta automáticamente.'); setNotice(''); }
    } finally {
      if (run === generation.current) { setBusy(false); jobRef.current = null; }
    }
  }

  const user = session?.user;
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/app/" aria-label="Honguito, inicio"><span className="brand-mark" aria-hidden="true">h<span>·</span></span><span>honguito<small>LABORATORIO MATEMÁTICO</small></span></a>
      {user ? <nav className="account-nav" aria-label="Cuenta"><span className="account-name">{user.email}</span><button className="text-button" onClick={() => { setAccountOpen(!accountOpen); setError(''); }}>Mi cuenta</button><button className="text-button" onClick={() => void logout()} disabled={authBusy}>Cerrar sesión</button></nav> : <span className="demo-tag">DEMO WEB</span>}
    </header>

    <main id="main">
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow"><span aria-hidden="true" /> UN ESPACIO PARA ENTENDER</p>
        <h1 id="page-title">Las matemáticas,<br /><em>paso a paso.</em></h1>
        <p>Pega tu ejercicio, añade lo que necesitas encontrar y revisa una propuesta con su explicación.</p>
        <div className="intro-notes"><span>Texto e imágenes</span><span>Cálculos revisados</span><span>Sin instalar nada</span></div>
      </section>

      <div className="messages">
        {error && <p className="message error" role="alert">{error}</p>}
        <p className={`message status${notice ? '' : ' empty'}`} role="status" aria-live="polite">{notice}</p>
      </div>

      {!session ? <section className="card loading-card" aria-busy="true"><p>Conectando con tu espacio…</p>{error && <button className="secondary" onClick={() => { setError(''); void loadSession().catch(reason => setError(reason.message)); }}>Volver a conectar</button>}</section> : !user ? <section className="welcome-grid">
        <div className="auth-card card">
          <span className="step-label">TU ESPACIO PERSONAL</span>
          <h2>{mode === 'login' ? 'Continúa aprendiendo' : 'Empieza con una cuenta'}</h2>
          <p className="muted">{mode === 'login' ? 'Entra para consultar y revisar tus ejercicios.' : 'Solo necesitas un correo y una contraseña segura.'}</p>
          <form onSubmit={authenticate}>
            <label htmlFor="email">Correo electrónico</label><input id="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} required />
            <label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 12 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required />
            {mode === 'register' && <p className="field-help">Usa al menos 12 caracteres. No reutilices una contraseña de otro sitio.</p>}
            <button className="primary full" disabled={authBusy || !session.csrf_token}>{authBusy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Registrarme'}<span aria-hidden="true">→</span></button>
          </form>
          <p className="auth-switch">{mode === 'login' ? '¿Primera vez aquí?' : '¿Ya tienes una cuenta?'} <button className="inline-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setPassword(''); setError(''); }} disabled={authBusy}>{mode === 'login' ? 'Crear una cuenta' : 'Iniciar sesión'}</button></p>
          <p className="privacy-note">No hay recuperación de contraseña por correo en esta demo. Conserva tu contraseña en un gestor seguro.</p>
        </div>
        <aside className="welcome-aside">
          <div className="math-paper" aria-hidden="true"><span className="paper-caption">ENTENDER EL PORQUÉ</span><span className="paper-expression">4 × 3 = <strong>12</strong></span><span className="paper-line" /><span className="paper-small">Un paso. Una idea más clara.</span><span className="paper-check">✓</span></div>
          <h2>Una ayuda para razonar.</h2><p>Los comprobadores reconocen algunos ejercicios exactos. Para los demás, la IA propone una respuesta que debes revisar.</p>
          <p className="small-note">Acceso sujeto a las cuotas disponibles. Una cuenta no garantiza disponibilidad de IA.</p>
        </aside>
      </section> : <>
        {accountOpen && <section className="card account-panel" aria-labelledby="account-title">
          <div className="section-heading"><div><span className="step-label">MI CUENTA</span><h2 id="account-title">Tu espacio</h2></div><button className="text-button" onClick={() => { setAccountOpen(false); setAccountPassword(''); }}>Cerrar panel</button></div>
          <p className="account-email">{user.email}</p><p className="muted">Las cuentas sobreviven a reinicios del servicio. Los ejercicios se mantienen temporalmente mientras la sesión está activa. Cerrar sesión o eliminar la cuenta cancela y borra sus consultas.</p>
          <form onSubmit={deleteAccount} className="delete-form"><h3>Eliminar cuenta</h3><p>Esta acción es permanente y revoca todas tus sesiones.</p><label htmlFor="account-password">Contraseña actual</label><input id="account-password" type="password" autoComplete="current-password" value={accountPassword} maxLength={128} onChange={event => setAccountPassword(event.target.value)} required /><label className="check-label"><input type="checkbox" checked={confirmDelete} onChange={event => setConfirmDelete(event.target.checked)} />Confirmo que quiero eliminar mi cuenta</label><button className="danger" disabled={!confirmDelete || authBusy}>Eliminar mi cuenta</button></form>
        </section>}
        <div className="workspace-grid">
          <section className="card exercise-card" aria-labelledby="exercise-title">
            <div className="section-heading"><div><span className="step-label">01 / PLANTEA EL EJERCICIO</span><h2 id="exercise-title">¿Qué resolvemos hoy?</h2></div><span className="little-symbol" aria-hidden="true">ƒ</span></div>
            <form onSubmit={consult}>
              <fieldset disabled={busy || authBusy}>
                <div className="label-row"><label htmlFor="statement">Enunciado</label><button className="inline-button" type="button" onClick={() => { generation.current++; setImageBusy(false); setStatement(sample); setFields(initialFields()); setDiagramRequired(false); setImage(null); setImageName(''); setResult(null); }}>Probar un ejemplo</button></div>
                <textarea id="statement" rows={6} placeholder="Escribe o pega el problema completo, con todos sus datos…" value={statement} onChange={event => { setStatement(event.target.value); setResult(null); }} maxLength={8000} required />
                <div className="field-footer"><span>Incluye datos, condiciones y precisión solicitada.</span><span>{statement.length}/8000</span></div>
                <div className="attachment-row"><label className="upload-button" htmlFor="image"><span aria-hidden="true">＋</span> {imageBusy ? 'Preparando imagen…' : 'Adjuntar imagen'}</label><input id="image" className="file-input" type="file" accept="image/jpeg,image/png,image/webp" disabled={imageBusy} onChange={event => { void attach(event.target.files?.[0]); event.target.value = ''; }} /><span className="field-help">JPG, PNG o WebP · máximo 8 MB</span></div>
                {image && <div className="image-preview"><img src={image} alt="Imagen del ejercicio adjunta" /><div><span>{imageName}</span><button className="inline-button" type="button" onClick={() => { generation.current++; setImage(null); setImageName(''); setResult(null); }}>Quitar imagen</button></div></div>}
                <label className="check-label"><input type="checkbox" checked={diagramRequired} onChange={event => { setDiagramRequired(event.target.checked); setResult(null); }} />El ejercicio depende de un diagrama o imagen</label>
                <div className="answer-fields-heading"><h3>Respuestas que necesitas</h3><p className="field-help">Indica qué se busca y su unidad, si corresponde.</p></div>
                {fields.map((field, index) => <div className="answer-field-row" key={field.key}>
                  <div><label htmlFor={`field-${field.key}`}>Respuesta {index + 1}</label><input id={`field-${field.key}`} value={field.label} maxLength={130} onChange={event => { setFields(current => current.map(item => item.key === field.key ? { ...item, label: event.target.value } : item)); setResult(null); }} placeholder="Ej. Volumen" required /></div>
                  <div><label htmlFor={`unit-${field.key}`}>Unidad <span className="optional">(opcional)</span></label><input id={`unit-${field.key}`} value={field.unit} maxLength={40} onChange={event => { setFields(current => current.map(item => item.key === field.key ? { ...item, unit: event.target.value } : item)); setResult(null); }} placeholder="Ej. cm³" /></div>
                  {fields.length > 1 && <button className="remove-field" type="button" aria-label={`Quitar respuesta ${index + 1}`} onClick={() => { setFields(current => current.filter(item => item.key !== field.key)); setResult(null); }}>×</button>}
                </div>)}
                {fields.length < 12 && <button className="inline-button add-field" type="button" onClick={() => { setFields(current => [...current, { key: `answer_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`, label: '', unit: '' }]); setResult(null); }}>＋ Añadir otra respuesta</button>}
              </fieldset>
              <div className="submit-row"><p>Una consulta puede usar varias llamadas de IA para revisar la imagen. Cada llamada cuenta en tu cuota.</p>{busy ? <button className="secondary" type="button" onClick={event => { event.preventDefault(); cancel(); }}>Cancelar consulta</button> : <button className="primary" disabled={authBusy || imageBusy || !statement.trim()}>Consultar<span aria-hidden="true">↗</span></button>}</div>
            </form>
          </section>
          <section className={`card result-card${result ? ' has-result' : ''}`} aria-labelledby="result-title" aria-busy={busy}>
            <span className="step-label">02 / REVISA Y COMPRENDE</span><h2 id="result-title">Tu propuesta</h2>
            {busy ? <div className="result-placeholder"><span className="processing-mark" aria-hidden="true">∑</span><h3>Vamos paso a paso</h3><p>Preparando una respuesta. Si hay una imagen, se revisan su interpretación y las cuentas.</p><p className="small-note">Puedes cancelar la espera en cualquier momento.</p></div> : result ? <>
              <p className={`verification-tag ${result.verified ? 'verified' : 'unverified'}`}>{result.verified ? 'Resultado comprobado' : 'Propuesta de IA sin verificar'}</p>
              {result.proposal.answers.map(answer => <div className="answer-result" key={answer.field_key}><span>{fields.find(field => field.key === answer.field_key)?.label || answer.field_key}</span><strong data-testid="answer-value">{answer.value}</strong>{answer.unit && <span className="result-unit">{answer.unit}</span>}</div>)}
              <h3>{result.proposal.status === 'needs_context' ? 'Faltan datos' : result.proposal.status === 'unable_to_solve' ? 'No hay una solución utilizable' : 'La explicación'}</h3><p className="result-explanation">{result.proposal.explanation}</p>
              {!!result.proposal.missing_information.length && <ul>{result.proposal.missing_information.map((item, index) => <li key={index}>{item}</li>)}</ul>}
              <p className="result-meta">{result.provider === 'deterministic' ? 'Comprobador matemático' : 'IA en la nube'} · {result.provider_calls} {result.provider_calls === 1 ? 'llamada' : 'llamadas'} de IA</p>
              {!result.verified && <p className="result-caution">Una revisión de cálculos no demuestra que la IA haya interpretado correctamente el enunciado o la imagen. Contrasta la propuesta antes de utilizarla.</p>}
            </> : <div className="result-placeholder"><span className="empty-math" aria-hidden="true">x<span>²</span> + y<span>²</span></span><h3>Primero, el problema.<br />Después, el porqué.</h3><p>Aquí aparecerán las respuestas, su explicación y el alcance de la comprobación.</p></div>}
            <div className="result-bottom"><span aria-hidden="true">◇</span><p>Esta web no lee ni controla ALEKS. Esas acciones requieren la extensión; las cuentas aún no están vinculadas.</p></div>
          </section>
        </div>
      </>}
    </main>
    <footer className="site-footer"><span>honguito <span aria-hidden="true">·</span> aprende con criterio</span><span>Demo con cuotas limitadas. No se garantiza disponibilidad continua.</span></footer>
  </div>;
}
