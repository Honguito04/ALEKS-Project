import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const runtime = mkdtempSync(join(tmpdir(), 'aleks-web-e2e-'));
export default defineConfig({
  testDir: 'tests/web', timeout: 30000, workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:8000', headless: true,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] },
    trace: 'retain-on-failure' },
  webServer: { command: `"${process.env.PYTHON_EXECUTABLE || '.venv/bin/python'}" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-access-log`,
    url: 'http://127.0.0.1:8000/health', reuseExistingServer: false, timeout: 20000,
    env: { DATABASE_PATH: join(runtime, 'legacy.sqlite3'), WEB_DATABASE_URL: `sqlite:///${join(runtime, 'accounts.sqlite3')}`, WEB_PUBLIC_URL: 'http://127.0.0.1:8000' } }
});
