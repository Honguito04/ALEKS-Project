import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/e2e',timeout:60000,workers:1,fullyParallel:false,
  use:{baseURL:'http://127.0.0.1:8000',headless:true,launchOptions:{executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']},trace:'retain-on-failure'},
  webServer:{command:`"${process.env.PYTHON_EXECUTABLE || '.venv/bin/python'}" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-access-log`,url:'http://127.0.0.1:8000/health',reuseExistingServer:false,timeout:20000,
    env:{DATABASE_PATH:'.runtime/e2e.sqlite3'} }
});
