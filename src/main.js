const { app, BrowserWindow, screen, ipcMain, Tray, Menu, globalShortcut } = require('electron');
const path = require('node:path');
const { Store } = require('./store');
const { createNoteIcon } = require('./icon');
const desktop = require('./desktop');

// Dev hooks: isolated data folder and a scripted UI run (see README "Testing").
if (process.env.STICKS_USER_DATA) app.setPath('userData', process.env.STICKS_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let tray = null;
let store = null;
let ignoringMouse = null;
let notesVisible = true;

// The overlay covers the work area (screen minus taskbar), so the taskbar edge is the "floor".
function overlayBounds() {
  return screen.getPrimaryDisplay().workArea;
}

function setIgnoreMouse(ignore) {
  // A scripted UI run drives the page with synthetic input only; the real mouse must not interfere.
  if (process.env.STICKS_TEST_SCRIPT) ignore = true;
  if (!win || ignore === ignoringMouse) return;
  ignoringMouse = ignore;
  // forward: true keeps mousemove events flowing while clicks pass through,
  // so the renderer can tell when the cursor is over a note and take the mouse back.
  win.setIgnoreMouseEvents(ignore, { forward: !process.env.STICKS_TEST_SCRIPT });
}

function send(cmd) {
  if (win && !win.isDestroyed()) win.webContents.send('cmd', cmd);
}

// 'desktop': behind every app, like a desktop widget. 'top': floats over everything.
// A scripted UI run always floats, so it is never covered (and throttled) by other windows.
function layer() {
  return process.env.STICKS_TEST_SCRIPT ? 'top' : store.settings.layer;
}

function applyLayer() {
  if (layer() === 'top') {
    desktop.unpinFromDesktop(win);
    win.setAlwaysOnTop(true);
  } else {
    win.setAlwaysOnTop(false);
    desktop.pinToDesktop(win);
  }
}

function createWindow() {
  win = new BrowserWindow({
    ...overlayBounds(),
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: layer() === 'top',
    backgroundColor: '#00000000',
    title: 'Sticks',
    icon: createNoteIcon(64),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  setIgnoreMouse(true);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.showInactive();
    applyLayer();
  });
  // clicking a note brings it forward like any window; once you click elsewhere it goes back down
  win.on('blur', () => {
    if (layer() === 'desktop') desktop.sendToBack(win);
  });

  win.webContents.on('console-message', (e) => {
    if (e.message.includes('X4122')) return; // harmless D3D shader-compiler precision chatter
    if (process.env.STICKS_DEBUG || process.env.STICKS_LOG || e.level === 'error' || e.level === 'warning') {
      const time = new Date().toLocaleTimeString('en-GB');
      console.log(`${time} [${e.level}] ${e.message}`);
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer gone:', details.reason);
  });
  if (process.env.STICKS_DEBUG) win.webContents.openDevTools({ mode: 'detach' });
  if (process.env.STICKS_TEST_SCRIPT) {
    // watchdog: a stuck test must not leave its opaque full-screen overlay on the desktop
    setTimeout(() => app.exit(2), 100_000).unref();
    win.webContents.once('did-finish-load', () => require(path.resolve(process.env.STICKS_TEST_SCRIPT))(win, app));
  }
}

function refitWindow() {
  if (!win) return;
  win.setBounds(overlayBounds());
}

function setNotesVisible(visible) {
  notesVisible = visible;
  if (!win) return;
  if (visible) win.showInactive();
  else win.hide();
  buildTrayMenu();
}

function buildTrayMenu() {
  const s = store.settings;
  const menu = Menu.buildFromTemplate([
    { label: 'Show the note pad', accelerator: 'Ctrl+Alt+N', click: showPad },
    { label: notesVisible ? 'Hide notes' : 'Show notes', accelerator: 'Ctrl+Alt+H', click: () => setNotesVisible(!notesVisible) },
    { label: 'Empty the dustbin', click: () => send({ type: 'empty-bin' }) },
    { type: 'separator' },
    {
      label: 'Notes on the desktop', type: 'radio', checked: s.layer === 'desktop',
      click: () => { updateSettings({ layer: 'desktop' }); applyLayer(); },
    },
    {
      label: 'Notes always on top', type: 'radio', checked: s.layer === 'top',
      click: () => { updateSettings({ layer: 'top' }); applyLayer(); },
    },
    { label: 'Sounds', type: 'checkbox', checked: s.sound, click: (item) => updateSettings({ sound: item.checked }) },
    {
      label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Quit Sticks', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// An unpackaged run is electron.exe + this app's folder; without the arg, login would start bare Electron.
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}

// New notes only come off the pad, so "new note" brings the notes up and points at the pad.
function showPad() {
  setNotesVisible(true);
  // asked for from inside another app: bring the notes up over it until that app is clicked again
  if (layer() === 'desktop') win.moveTop();
  send({ type: 'show-pad' });
}

function updateSettings(patch) {
  store.updateSettings(patch);
  send({ type: 'settings', settings: store.settings });
  buildTrayMenu();
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.sticks.app');
  store = new Store(path.join(app.getPath('userData'), 'sticks.json'));

  ipcMain.handle('store:load', () => store.data);
  ipcMain.on('store:save', (_e, doc) => store.saveDoc(doc));
  ipcMain.on('mouse:ignore', (_e, ignore) => setIgnoreMouse(!!ignore));

  createWindow();

  tray = new Tray(createNoteIcon(32));
  tray.setToolTip('Sticks — sticky notes');
  tray.on('click', () => tray.popUpContextMenu());
  buildTrayMenu();

  globalShortcut.register('Control+Alt+N', showPad);
  globalShortcut.register('Control+Alt+H', () => setNotesVisible(!notesVisible));

  for (const evt of ['display-metrics-changed', 'display-added', 'display-removed']) {
    screen.on(evt, refitWindow);
  }
});

app.on('second-instance', showPad);
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  store?.flush();
});
