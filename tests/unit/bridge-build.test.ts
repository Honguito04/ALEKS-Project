import { readFileSync } from 'node:fs';
import { WRITER_VERSION } from '../../extension/src/writer-version';
import { describe, expect, it } from 'vitest';
import { bridgeOrigin } from '../../vite.config';

describe('origen permitido al compilar el puente web', () => {
  it('deshabilita el puente por defecto y normaliza HTTPS', () => {
    expect(bridgeOrigin('', false)).toBe('');
    expect(bridgeOrigin('https://Mi-Web.onrender.com:443/', false)).toBe('https://mi-web.onrender.com');
    expect(bridgeOrigin('https://mi-web.onrender.com:8443', false)).toBe('https://mi-web.onrender.com:8443');
  });

  it('permite solo el origen HTTP local explícito con bandera', () => {
    expect(bridgeOrigin('http://127.0.0.1:8000', true)).toBe('http://127.0.0.1:8000');
    expect(() => bridgeOrigin('http://127.0.0.1:8000', false)).toThrow('BRIDGE_WEB_ORIGIN');
  });

  it.each([
    'http://example.com', 'http://localhost:8000', 'http://127.0.0.1:8001',
    'https://*.example.com', 'https://user:password@example.com', 'https://@example.com',
    'https://example.com/app/', 'https://example.com/a/../', 'https://example.com?x=1',
    'https://example.com/?', 'https://example.com#fragment', 'https://example.com/#',
    'https://example.com\\app', 'https://example.com ', 'https://example.com\n', 'file:///tmp/web', 'not-an-origin'
  ])('rechaza configuración insegura: %s', value => {
    expect(() => bridgeOrigin(value, true)).toThrow('BRIDGE_WEB_ORIGIN');
  });
});

it('el manifiesto y el contrato de escritura tienen la misma versión',()=>{
  expect(JSON.parse(readFileSync('extension/public/manifest.json','utf8')).version).toBe(WRITER_VERSION);
});
