// A note's text as lines, each either plain or a checklist item.
// Saved as plain text with markdown-style markers: "[ ] todo", "[x] done", anything else is plain.

const OPEN = '[ ] ';
const DONE = '[x] ';

export function parseLines(text) {
  return (text ?? '').split('\n').map((raw) => {
    if (raw.startsWith(OPEN)) return { text: raw.slice(4), check: false };
    if (raw.startsWith(DONE)) return { text: raw.slice(4), check: true };
    return { text: raw, check: null };
  });
}

export function serializeLines(lines) {
  return lines.map((l) => (l.check === null ? '' : l.check ? DONE : OPEN) + l.text).join('\n');
}

const checkOf = (row) => ({ none: null, open: false, done: true })[row.dataset.check];
const checkAttr = (check) => (check === null ? 'none' : check ? 'done' : 'open');
const txtOf = (row) => row.querySelector('.txt');

function caretOffset(txt) {
  const sel = getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  const pre = r.cloneRange();
  pre.selectNodeContents(txt);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

function setCaret(txt, offset) {
  txt.focus();
  txt.normalize();
  const node = [...txt.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  const range = document.createRange();
  if (node) range.setStart(node, Math.min(offset, node.length));
  else range.setStart(txt, 0);
  range.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Line-based editor: Enter starts a checklist item on the next line (the current line keeps its kind),
 * Enter on an empty item ends the list, Shift+Enter adds a plain line, clicking a box ticks it.
 */
export class NoteEditor {
  constructor({ onChange, onCtrlEnter, onToggle }) {
    this.onChange = onChange;
    this.onCtrlEnter = onCtrlEnter;
    this.onToggle = onToggle;
    this.el = document.createElement('div');
    this.el.className = 'editor';
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    // ticking a box must not start dragging the note or editing the line
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.box')) e.stopPropagation();
    }, true);
    this.el.addEventListener('click', (e) => {
      const box = e.target.closest('.box');
      if (box) this.toggle(box.parentElement);
    });
  }

  get text() {
    return serializeLines(this.rows().map((row) => ({ text: txtOf(row).textContent, check: checkOf(row) })));
  }

  setText(text) {
    this.el.replaceChildren(...parseLines(text).map((l) => this.makeRow(l)));
  }

  get isEditing() {
    return this.el.contains(document.activeElement);
  }

  blur() {
    if (this.isEditing) document.activeElement.blur();
  }

  /** Puts the caret where the user clicked, or at the end if they clicked below the text. */
  focusAt(x, y) {
    if (!this.rows().length) this.setText('');
    const pos = document.caretRangeFromPoint?.(x, y);
    const node = pos?.startContainer;
    const txt = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.closest?.('.txt');
    if (txt && this.el.contains(txt)) {
      txt.focus();
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(pos);
      return;
    }
    this.focusEnd();
  }

  focusEnd() {
    if (!this.rows().length) this.setText('');
    const rows = this.rows();
    setCaret(txtOf(rows[rows.length - 1]), Infinity);
  }

  rows() {
    return [...this.el.children];
  }

  makeRow({ text, check }) {
    const row = document.createElement('div');
    row.className = 'line';
    row.dataset.check = checkAttr(check);
    row.innerHTML = '<span class="box"></span><div class="txt" contenteditable="plaintext-only" spellcheck="false"></div>';
    txtOf(row).textContent = text;
    return row;
  }

  toggle(row) {
    row.dataset.check = row.dataset.check === 'done' ? 'open' : 'done';
    this.onToggle?.(row.dataset.check === 'done');
    this.changed();
  }

  changed() {
    this.onChange(this.text);
  }

  onKey(e) {
    const row = e.target.closest?.('.line');
    if (!row) return;
    const txt = txtOf(row);
    const sel = getSelection();

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return this.onCtrlEnter?.(e);
      if (!sel.isCollapsed) sel.deleteFromDocument();
      const full = txt.textContent;
      const off = caretOffset(txt);
      let nextCheck;
      if (e.shiftKey) {
        nextCheck = null;
      } else if (row.dataset.check !== 'none' && full.trim() === '') {
        // Enter on an empty item ends the checklist, like a bullet list in any editor
        row.dataset.check = 'none';
        return this.changed();
      } else {
        // the line just typed keeps its kind (a heading stays a heading); the new line is an item
        nextCheck = false;
      }
      txt.textContent = full.slice(0, off);
      const next = this.makeRow({ text: full.slice(off), check: nextCheck });
      row.after(next);
      setCaret(txtOf(next), 0);
      next.scrollIntoView({ block: 'nearest' });
      return this.changed();
    }

    if (e.key === 'Backspace' && sel.isCollapsed && caretOffset(txt) === 0) {
      e.preventDefault();
      if (row.dataset.check !== 'none') {
        row.dataset.check = 'none'; // first backspace removes the box, the next joins the lines
        return this.changed();
      }
      const prev = row.previousElementSibling;
      if (!prev) return;
      const pt = txtOf(prev);
      const join = pt.textContent.length;
      pt.textContent += txt.textContent;
      row.remove();
      setCaret(pt, join);
      return this.changed();
    }

    if (e.key === 'Delete' && sel.isCollapsed && caretOffset(txt) === txt.textContent.length) {
      const next = row.nextElementSibling;
      if (!next) return;
      e.preventDefault();
      const off = txt.textContent.length;
      txt.textContent += txtOf(next).textContent;
      next.remove();
      setCaret(txt, off);
      return this.changed();
    }

    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel.isCollapsed) {
      const target = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
      if (!target) return;
      const caret = sel.getRangeAt(0).getBoundingClientRect();
      const box = txt.getBoundingClientRect();
      const top = caret.height ? caret.top : box.top;
      const bottom = caret.height ? caret.bottom : box.bottom;
      const onEdge = e.key === 'ArrowUp' ? top - box.top < 13 : box.bottom - bottom < 13;
      if (!onEdge) return;
      e.preventDefault();
      setCaret(txtOf(target), caretOffset(txt));
      return;
    }

    if (e.key === 'Escape') this.blur();
  }

  // Pasted text can carry newlines: split it into lines of the same kind.
  onInput(e) {
    const row = e.target.closest?.('.line');
    const txt = row && txtOf(row);
    if (txt && txt.textContent.includes('\n')) {
      const [first, ...rest] = txt.textContent.split('\n');
      txt.textContent = first;
      const check = row.dataset.check === 'none' ? null : false;
      let last = row;
      for (const text of rest) {
        const next = this.makeRow({ text, check });
        last.after(next);
        last = next;
      }
      setCaret(txtOf(last), Infinity);
    }
    this.changed();
  }
}
