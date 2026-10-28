// Run with Electron (npm run icon): renders the app icon to build/icon.png for the installer.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createNoteIcon } = require('../src/icon');

app.whenReady().then(() => {
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, createNoteIcon(256).toPNG());
  console.log(`wrote ${out}`);
  app.quit();
});
