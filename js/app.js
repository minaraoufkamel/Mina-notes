/* App bootstrap, keyboard shortcuts, clipboard */
(function () {
  'use strict';
  const A = window.App;
  A.lastPointer = null;

  const TOOL_KEYS = { n: 'note', t: 'todo', w: 'link', l: 'line', b: 'board', c: 'column', m: 'comment', d: 'document', s: 'sketch', k: 'swatch', i: 'image', u: 'upload' };
  const overlayOpen = () => document.querySelector('.modal-back, .doc-editor, .sketch-editor, .lightbox');

  function onKey(e) {
    if (overlayOpen()) return;
    if (A.ui.editing) { A.handleEditKey(e); return; }
    if (A.isTyping()) return;
    const mod = e.metaKey || e.ctrlKey; const k = e.key; const kl = k.toLowerCase();
    const ids = A.sel();
    if (mod) {
      if (kl === 'z') { e.preventDefault(); e.shiftKey ? A.redo() : A.undo(); }
      else if (kl === 'y') { e.preventDefault(); A.redo(); }
      else if (kl === 'a') { e.preventDefault(); A.selectAll(); }
      else if (kl === 'd') { e.preventDefault(); A.duplicate(); }
      else if (kl === 'k' || kl === 'f') { e.preventDefault(); A.openSearch(); }
      else if (k === '=' || k === '+') { e.preventDefault(); A.zoomIn(); }
      else if (k === '-') { e.preventDefault(); A.zoomOut(); }
      else if (k === '0') { e.preventDefault(); A.zoomReset(); }
      else if (kl === 'l' && e.shiftKey) { e.preventDefault(); if (ids.length) A.toggleLock(); }
      else if (k === ']') { e.preventDefault(); if (ids.length) A.bringToFront(); }
      else if (k === '[') { e.preventDefault(); if (ids.length) A.sendToBack(); }
      else if (k === 'ArrowUp') { e.preventDefault(); const b = A.state.boards[A.ui.boardId]; if (b.parentId) A.openBoard(b.parentId); }
      else if (kl === 'e') { e.preventDefault(); A.exportMenu(document.getElementById('export-btn')); }
      else if (kl === 's') { e.preventDefault(); A.saveNow(); A.toast('All changes saved'); }
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      if (ids.length || A.ui.selectedLine) A.deleteSel();
      else if (k === 'Backspace') { const b = A.state.boards[A.ui.boardId]; if (b.parentId) A.openBoard(b.parentId); }
      return;
    }
    if (k === 'Escape') {
      if (A.ui.tool) A.setTool(null);
      else { A.ui.selection.clear(); A.ui.selectedLine = null; A.ui.active = null; A.render(); }
      return;
    }
    if (k === 'Enter' && ids.length === 1) {
      e.preventDefault();
      const c = A.state.cards[ids[0]]; const T = A.CardTypes[c.type];
      if (T.onClick) return T.onClick(c);
      const el = A.cardEls.get(c.id);
      const f = el && el.querySelector('[data-field]');
      if (f) A.beginEdit(f, c.id);
      return;
    }
    if (k === 'F2' && ids.length === 1) { e.preventDefault(); return A.renameCard(ids[0]); }
    if (k.startsWith('Arrow') && ids.length) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1; const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
      if (!e.repeat) A.checkpoint();
      ids.forEach((id) => { const c = A.state.cards[id]; if (!c.locked && !c.columnId) { c.x += dx; c.y += dy; } });
      A.changed(); return;
    }
    if (k === '?') { e.preventDefault(); return A.openShortcuts(); }
    if (k === '/') { e.preventDefault(); return A.openSearch(); }
    if (k === '!' || (e.shiftKey && e.code === 'Digit1')) { e.preventDefault(); return A.fitToContent(); }
    if (!e.shiftKey && !e.altKey && TOOL_KEYS[kl]) {
      e.preventDefault();
      const p = A.lastPointer && A.pointerInViewport ? A.lastPointer : null;
      A.addTool(TOOL_KEYS[kl], TOOL_KEYS[kl] === 'line' ? null : p);
    }
  }

  function onCopy(e, cut) {
    if (overlayOpen() || A.ui.editing || A.isTyping()) return;
    if (String(window.getSelection())) return;
    const cb = A.copySel(); if (!cb) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', cb.text);
    try { e.clipboardData.setData('application/x-canvas-notes', JSON.stringify(cb.snap)); } catch (err) {}
    if (cut) A.deleteSel(); else A.toast(`Copied ${cb.snap.cards.filter((c) => !c.columnId).length || 1} item(s)`);
  }
  async function onPaste(e) {
    if (overlayOpen() || A.ui.editing || A.isTyping()) return;
    const dt = e.clipboardData; if (!dt) return;
    const at = A.lastPointer && A.pointerInViewport ? A.lastPointer : null;
    const custom = dt.getData('application/x-canvas-notes');
    if (custom) { e.preventDefault(); try { return A.pasteSnap(JSON.parse(custom), at); } catch (err) {} }
    const files = [...(dt.files || [])];
    if (!files.length) for (const it of dt.items || []) if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
    if (files.length) { e.preventDefault(); return A.importFiles(files, at); }
    const text = dt.getData('text/plain');
    if (A.ui.clipboard && text && text === A.ui.clipboard.text) { e.preventDefault(); return A.pasteSnap(A.ui.clipboard.snap, at); }
    if (text && text.trim()) { e.preventDefault(); A.createFromText(text.trim(), at); }
  }

  async function init() {
    await A.load();
    A.buildChrome();
    A.initCanvas();
    A.applySettings();
    A.routeFromHash();
    A.updateHistoryButtons();
    window.addEventListener('popstate', () => A.routeFromHash());
    window.addEventListener('hashchange', () => { const m = location.hash.match(/#\/b\/([\w-]+)/); if (m && m[1] !== A.ui.boardId) A.routeFromHash(); });
    window.addEventListener('keydown', onKey);
    document.addEventListener('copy', (e) => onCopy(e, false));
    document.addEventListener('cut', (e) => onCopy(e, true));
    document.addEventListener('paste', onPaste);
    const vp = document.getElementById('viewport');
    vp.addEventListener('pointermove', (e) => { A.lastPointer = A.toWorld(e.clientX, e.clientY); A.pointerInViewport = true; });
    vp.addEventListener('pointerleave', () => (A.pointerInViewport = false));
    window.addEventListener('beforeprint', () => { if (!document.body.classList.contains('printing') && !document.body.classList.contains('print-doc')) { document.body.classList.add('printing'); A._pv = { ...A.view }; A.fitToContent(null, 1); } });
    window.addEventListener('afterprint', () => { if (A._pv) { document.body.classList.remove('printing'); A.view = A._pv; A._pv = null; A.applyView(); } });
    setInterval(() => A.requestRender(), 60000); // refresh relative times
    document.body.classList.add('ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
