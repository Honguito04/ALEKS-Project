/// <reference types="vite/client" />

import { useEffect, useRef, useState, type FormEvent } from 'react';
import brandMark from '../../extension/public/icons/aleks-128.png';
import AleksBridge from './AleksBridge';

type User = { id: string; email: string };
type Session = { user: User | null; csrf_token: string };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const generation = useRef(0);
  const bridgeDisconnect = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  function acceptSession(next: Session) {
    bridgeDisconnect.current?.();
    generation.current++;
    sessionRef.current = next; setSession(next);
    if (!next.user) setMode('login');
    setPassword(''); setAccountPassword(''); setAccountOpen(false); setConfirmDelete(false);
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
        : response.status === 401 ? 'Tu sesión venció. Vuelve a entrar.'
        : response.status === 403 ? 'La solicitud no pudo verificarse. Recarga la página antes de intentarlo.'
        : 'No se pudo completar la solicitud. Revisa los datos e inténtalo de nuevo.';
      if (response.status === 401 && dispatchedSession?.user && sessionRef.current === dispatchedSession) {
        acceptSession({ user: null, csrf_token: '' });
        setNotice('Tu sesión venció. Vuelve a entrar.');
        void loadSession().catch(() => {});
      }
      throw new Error(typeof payload?.detail === 'string' ? payload.detail : fallback);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
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
    bridgeDisconnect.current?.();
    generation.current++; setError(''); setAuthBusy(true);
    try {
      await request('/logout', 'POST');
      acceptSession({ user: null, csrf_token: '' });
      setNotice('Sesión cerrada.');
      await loadSession();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cerrar la sesión.'); }
    finally { setAuthBusy(false); }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault(); if (!confirmDelete) return;
    bridgeDisconnect.current?.();
    setError(''); setAuthBusy(true);
    try {
      await request('/account', 'DELETE', { password: accountPassword });
      acceptSession({ user: null, csrf_token: '' });
      setNotice('Cuenta eliminada. Sus sesiones y consultas se han revocado.');
      await loadSession();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo eliminar la cuenta.'); }
    finally { setAuthBusy(false); setAccountPassword(''); }
  }

  const user = session?.user;
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/app/" aria-label="Aleks Project, inicio">
        <img className="brand-mark" src={brandMark} alt="" width={39} height={39} />
        <span>Aleks Project</span>
      </a>
      {user ? <nav className="account-nav" aria-label="Cuenta"><span className="account-name">{user.email}</span><button className="text-button" onClick={() => { setAccountOpen(!accountOpen); setError(''); }}>Mi cuenta</button><button className="text-button" onClick={() => void logout()} disabled={authBusy}>Cerrar sesión</button></nav> : null}
    </header>

    <main id="main">
      <h1 className="page-title">Automatización de ALEKS</h1>
      <div className="messages">
        {error && <p className="message error" role="alert">{error}</p>}
        <p className={`message status${notice ? '' : ' empty'}`} role="status" aria-live="polite">{notice}</p>
      </div>

      {!session ? <section className="card loading-card" aria-busy="true"><p>Cargando sesión…</p>{error && <button className="secondary" onClick={() => { setError(''); void loadSession().catch(reason => setError(reason.message)); }}>Volver a conectar</button>}</section> : !user ? <section className="welcome-grid">
        <div className="auth-card card">
          <h2>{mode === 'login' ? 'Iniciar sesión' : 'Crear una cuenta'}</h2>
          <p className="muted">{mode === 'login' ? 'Entra para vincular la extensión de Chrome y gestionar tus recorridos.' : 'Solo necesitas un correo y una contraseña segura.'}</p>
          <p className="field-help">Usa la contraseña que creaste en esta aplicación. Puedes usar tu correo Gmail; este formulario no inicia sesión con Google ni usa su contraseña.</p>
          <form onSubmit={authenticate}>
            <label htmlFor="email">Correo electrónico</label><input id="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} required />
            <label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 12 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required />
            {mode === 'register' && <p className="field-help">Usa al menos 12 caracteres. No reutilices una contraseña de otro sitio.</p>}
            <button className="primary full" disabled={authBusy || !session.csrf_token}>{authBusy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Registrarme'}<span aria-hidden="true">→</span></button>
          </form>
          <p className="auth-switch">{mode === 'login' ? '¿Primera vez aquí?' : '¿Ya tienes una cuenta?'} <button className="inline-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setPassword(''); setError(''); }} disabled={authBusy}>{mode === 'login' ? 'Crear una cuenta' : 'Iniciar sesión'}</button></p>
          <p className="privacy-note">No hay recuperación de contraseña por correo en esta demo. Conserva tu contraseña en un gestor seguro.</p>
          <details className="account-recovery"><summary>¿Tu cuenta dejó de funcionar después de actualizar?</summary><p>Si descargaste otro ZIP, tus cuentas pueden seguir en la carpeta anterior. Detén el servidor y ejecuta <code>scripts\restore-local-data.cmd</code> en la carpeta nueva; indica la carpeta de la instalación anterior. Después inicia la web con <code>scripts\start-web.cmd</code> y entra con tu contraseña habitual.</p><p>Conserva la carpeta anterior hasta recuperar tus datos. No hace falta crear otra cuenta.</p></details>
        </div>
      </section> : <>
        {accountOpen && <section className="card account-panel" aria-labelledby="account-title">
          <div className="section-heading"><div><span className="step-label">MI CUENTA</span><h2 id="account-title">Tu espacio</h2></div><button className="text-button" onClick={() => { setAccountOpen(false); setAccountPassword(''); }}>Cerrar panel</button></div>
          <p className="account-email">{user.email}</p><p className="muted">Cerrar sesión o eliminar la cuenta detiene el recorrido y desconecta la extensión.</p>
          <form onSubmit={deleteAccount} className="delete-form"><h3>Eliminar cuenta</h3><p>Esta acción es permanente y revoca todas tus sesiones.</p><label htmlFor="account-password">Contraseña actual</label><input id="account-password" type="password" autoComplete="current-password" value={accountPassword} maxLength={128} onChange={event => setAccountPassword(event.target.value)} required /><label className="check-label"><input type="checkbox" checked={confirmDelete} onChange={event => setConfirmDelete(event.target.checked)} />Confirmo que quiero eliminar mi cuenta</label><button className="danger" disabled={!confirmDelete || authBusy}>Eliminar mi cuenta</button></form>
        </section>}
        <AleksBridge key={user.id} userId={user.id} csrfToken={session.csrf_token} request={request} disconnectRef={bridgeDisconnect} suspended={authBusy} />
      </>}
    </main>
    <footer className="site-footer">
      <span>Aleks Project</span>
    </footer>
  </div>;
}
