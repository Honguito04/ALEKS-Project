import { ALEKS_ORIGINS } from './shared';
import './panel.css';

declare const __BRIDGE_WEB_ORIGIN__: string;
const origin = typeof __BRIDGE_WEB_ORIGIN__ === 'string' ? __BRIDGE_WEB_ORIGIN__ : '';
const status = document.querySelector<HTMLParagraphElement>('#access-status')!;
const grant = document.querySelector<HTMLButtonElement>('#grant-access')!;
const openWeb = document.querySelector<HTMLAnchorElement>('#open-web')!;

if (!origin) {
  status.textContent = 'El puente web no está configurado. Inicia la web con scripts\\start-web.cmd y recarga la extensión desde la carpeta dist.';
} else {
  const permissions = { origins: [...new Set([origin, ...ALEKS_ORIGINS])].map(site => site + '/*') };
  openWeb.href = new URL('/app/', origin).href;
  openWeb.hidden = false;

  function showAccess(granted: boolean, message?: string) {
    grant.hidden = granted;
    grant.disabled = false;
    openWeb.classList.toggle('primary', granted);
    openWeb.classList.toggle('secondary', !granted);
    status.textContent = message ?? (granted
      ? 'Acceso concedido. Abre la web y pulsa Conectar extensión ALEKS.'
      : 'Acceso pendiente. Autoriza los sitios en el diálogo de Chrome.');
  }

  async function refreshAccess() {
    try { showAccess(await chrome.permissions.contains(permissions)); }
    catch { showAccess(false, 'Chrome no pudo comprobar los permisos. Intenta autorizar el acceso.'); }
  }

  grant.addEventListener('click', async () => {
    if (grant.disabled) return;
    grant.disabled = true;
    try {
      // El diálogo de Chrome exige el gesto directo del usuario.
      const granted = await chrome.permissions.request(permissions);
      showAccess(granted, granted ? undefined : 'Acceso pendiente. Puedes volver a solicitarlo.');
      if (granted) openWeb.focus();
    } catch {
      showAccess(false, 'Chrome no pudo solicitar los permisos. Vuelve a intentarlo.');
    }
  });
  chrome.permissions.onAdded.addListener(() => void refreshAccess());
  chrome.permissions.onRemoved.addListener(() => void refreshAccess());
  void refreshAccess();
}
