const fs = require('node:fs');
const path = require('node:path');

// layer: 'desktop' (behind apps, like a desktop widget) or 'top' (floats over everything)
const DEFAULT_SETTINGS = { layer: 'desktop', sound: true };

function emptyDoc() {
  return { version: 1, notes: [], balls: [], bin: null, stats: { done: 0 }, history: [] };
}

// Persists everything to one JSON file. The renderer owns the notes/balls document;
// the main process owns settings (tray toggles), so a renderer save never clobbers them.
class Store {
  constructor(file) {
    this.file = file;
    this.timer = null;
    this.data = { ...emptyDoc(), settings: { ...DEFAULT_SETTINGS } };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { ...this.data, ...raw, settings: { ...DEFAULT_SETTINGS, ...raw.settings } };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Keep the unreadable file around instead of silently overwriting the user's notes.
        try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
        console.error('Could not read notes file, starting fresh:', err.message);
      }
    }
  }

  get settings() {
    return this.data.settings;
  }

  saveDoc(doc) {
    this.data = { ...doc, settings: this.data.settings };
    this.schedule();
  }

  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
