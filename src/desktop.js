// Keeps the overlay on the desktop layer on Windows: above the wallpaper and icons, below every
// app window, like a desktop widget. The trick (the same one Rainmeter's "On desktop" uses) is to
// make the desktop window (Progman) the overlay's owner: an owned window always stays just above
// its owner, and the desktop is never minimised, so Win+D (show desktop) doesn't hide the notes.
const GWLP_HWNDPARENT = -8;
const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;

let user32 = null;
function api() {
  if (!user32) {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    user32 = {
      FindWindowW: lib.func('intptr_t __stdcall FindWindowW(str16, str16)'),
      SetWindowLongPtrW: lib.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t, int, intptr_t)'),
      SetWindowPos: lib.func('bool __stdcall SetWindowPos(intptr_t, intptr_t, int, int, int, int, uint32_t)'),
    };
  }
  return user32;
}

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

const supported = process.platform === 'win32';

/** Puts the window on the desktop layer. Returns false if that isn't possible here. */
function pinToDesktop(win) {
  if (!supported) return false;
  const desktop = api().FindWindowW('Progman', null);
  if (!desktop) return false;
  api().SetWindowLongPtrW(hwndOf(win), GWLP_HWNDPARENT, desktop);
  sendToBack(win);
  return true;
}

function unpinFromDesktop(win) {
  if (supported) api().SetWindowLongPtrW(hwndOf(win), GWLP_HWNDPARENT, 0);
}

/** Drops the window back behind the apps (clicking a note brings it forward, like any window). */
function sendToBack(win) {
  if (supported) api().SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

module.exports = { pinToDesktop, unpinFromDesktop, sendToBack };
