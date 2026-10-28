// Launches the app with a throwaway data folder and the scripted UI test.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sticks-test-'));
const env = {
  ...process.env,
  STICKS_USER_DATA: userData,
  STICKS_TEST_SCRIPT: path.join(__dirname, 'ui-test.js'),
  STICKS_SHOTS: path.join(root, 'test-output'),
};
// VS Code's terminal sets this, which would make Electron behave as plain Node.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [root], { env, stdio: 'inherit' });
// The test overlay is full-screen and always on top with an opaque background; if anything
// hangs it must never be left covering the desktop.
const killer = setTimeout(() => {
  console.error('UI test timed out — killing the app');
  spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
}, 120_000);
child.on('exit', (code) => {
  clearTimeout(killer);
  fs.rmSync(userData, { recursive: true, force: true });
  process.exit(code ?? 1);
});
