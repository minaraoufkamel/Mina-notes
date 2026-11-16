/* Store: state, persistence (IndexedDB), history (undo/redo), model helpers */
(function () {
  'use strict';
  const A = (window.App = window.App || {});

  A.uid = (p = 'i') => p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  A.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  A.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  A.clone = (o) => JSON.parse(JSON.stringify(o));
  A.now = () => Date.now();

  /* ---------------- IndexedDB ---------------- */
  const DB_NAME = 'canvas-notes-db';
  let db = null;
  function openDB() {
    return new Promise((res) => {
      try {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
          if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets');
        };
        r.onsuccess = () => { db = r.result; res(db); };
        r.onerror = () => res(null);
        r.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
  }
  function req(store, mode, fn) {
    return new Promise((res, rej) => {
      if (!db) return res(undefined);
      try {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => res(r ? r.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      } catch (e) { rej(e); }
    });
  }
  function allAssets() {
    return new Promise((res) => {
      if (!db) return res([]);
      const out = [];
      try {
        const t = db.transaction('assets', 'readonly');
        const c = t.objectStore('assets').openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } };
        t.oncomplete = () => res(out);
        t.onerror = () => res(out);
      } catch (e) { res(out); }
    });
  }

  /* ---------------- Assets (images, files, audio, video) ---------------- */
  A.assets = {};
  function registerAsset(id, v) {
    if (!v || !v.blob) return;
    A.assets[id] = { ...v, url: URL.createObjectURL(v.blob) };
  }
  A.addAsset = async function (blob, name) {
    const id = A.uid('a');
    const v = { blob, name: name || blob.name || 'file', type: blob.type || '', size: blob.size || 0 };
    registerAsset(id, v);
    try { await req('assets', 'readwrite', (s) => s.put(v, id)); } catch (e) { A.toast && A.toast('Could not store file (storage full?)'); }
    return id;
  };
  A.assetURL = (id) => (A.assets[id] ? A.assets[id].url : '');
  A.assetToDataURL = (id) => new Promise((res) => {
    const a = A.assets[id]; if (!a) return res(null);
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(a.blob);
  });
  A.dataURLToBlob = function (d) {
    const [h, b] = d.split(','); const mime = (h.match(/:(.*?);/) || [])[1] || 'application/octet-stream';
    const bin = atob(b); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };
  A.importAsset = async function (id, v) { // used by JSON import, keeps id
    registerAsset(id, v);
    try { await req('assets', 'readwrite', (s) => s.put(v, id)); } catch (e) {}
  };
  // Remove assets no longer referenced anywhere (state or trash)
  A.gcAssets = function () {
    const used = new Set();
    const scan = (c) => { if (c && c.data && c.data.asset) used.add(c.data.asset); };
    Object.values(A.state.cards).forEach(scan);
    A.state.trash.forEach((t) => (t.cards || []).forEach(scan));
    for (const id of Object.keys(A.assets)) {
      if (!used.has(id)) {
        try { URL.revokeObjectURL(A.assets[id].url); } catch (e) {}
        delete A.assets[id];
        req('assets', 'readwrite', (s) => s.delete(id)).catch(() => {});
      }
    }
  };

  /* ---------------- State ---------------- */
  A.state = null;
  A.ui = {
    boardId: null, selection: new Set(), selectedLine: null, editing: null,
    tool: null, active: null, playing: new Set(), clipboard: null, recording: null,
  };

  function emptyState() {
    return {
      version: 1, rootId: null, boards: {}, cards: {}, lines: {}, trash: [], activity: [], starred: [],
      settings: { name: 'You', theme: 'system', snap: false, grid: true, guides: true },
      shares: {},
    };
  }
  A.emptyState = emptyState;

  function migrate(st) {
    const base = emptyState();
    const s = Object.assign(base, st);
    s.settings = Object.assign(emptyState().settings, st.settings || {});
    if (!s.rootId || !s.boards[s.rootId]) {
      const root = Object.values(s.boards).find((b) => !b.parentId);
      if (root) s.rootId = root.id;
    }
    return s;
  }

  A.load = async function () {
    await openDB();
    let st = null;
    try { st = db ? await req('kv', 'readonly', (s) => s.get('state')) : null; } catch (e) { st = null; }
    if (!st) { try { const ls = localStorage.getItem('canvas-notes-state'); if (ls) st = JSON.parse(ls); } catch (e) {} }
    if (st && st.rootId) A.state = migrate(st);
    else { A.state = emptyState(); A.seed(); }
    for (const [k, v] of await allAssets()) registerAsset(k, v);
    if (!db) setTimeout(() => A.toast && A.toast('Browser storage unavailable – changes will not persist.'), 800);
  };

  let saveT = null;
  function saveNow() {
    saveT = null;
    const s = A.state;
    if (db) req('kv', 'readwrite', (st) => st.put(s, 'state')).catch(() => lsSave());
    lsSave();
    A.setSaved && A.setSaved(true);
  }
  function lsSave() { try { localStorage.setItem('canvas-notes-state', JSON.stringify(A.state)); } catch (e) {} }
  A.save = function () { A.setSaved && A.setSaved(false); clearTimeout(saveT); saveT = setTimeout(saveNow, 350); };
  A.saveNow = () => { if (saveT) { clearTimeout(saveT); saveNow(); } };
  window.addEventListener('beforeunload', () => { if (saveT) { clearTimeout(saveT); lsSave(); } });

  let rq = false;
  A.requestRender = function () {
    if (rq) return; rq = true;
    requestAnimationFrame(() => { rq = false; A.render && A.render(); });
  };
  A.changed = function () { A.save(); A.requestRender(); };

  /* ---------------- History ---------------- */
  const undoStack = [], redoStack = [];
  const snap = () => JSON.stringify({ boards: A.state.boards, cards: A.state.cards, lines: A.state.lines, trash: A.state.trash });
  A.checkpoint = function () {
    const s = snap();
    if (undoStack[undoStack.length - 1] !== s) { undoStack.push(s); if (undoStack.length > 150) undoStack.shift(); }
    redoStack.length = 0;
    A.updateHistoryButtons && A.updateHistoryButtons();
  };
  function restore(str) {
    A.endEdit && A.endEdit(true);
    Object.assign(A.state, JSON.parse(str));
    for (const id of [...A.ui.selection]) if (!A.state.cards[id]) A.ui.selection.delete(id);
    if (A.ui.selectedLine && !A.state.lines[A.ui.selectedLine]) A.ui.selectedLine = null;
    if (!A.state.boards[A.ui.boardId]) A.openBoard(A.state.rootId);
    A.changed();
    A.updateHistoryButtons && A.updateHistoryButtons();
  }
  A.undo = function () { if (!undoStack.length) return A.toast('Nothing to undo'); redoStack.push(snap()); restore(undoStack.pop()); };
  A.redo = function () { if (!redoStack.length) return A.toast('Nothing to redo'); undoStack.push(snap()); restore(redoStack.pop()); };
  A.canUndo = () => undoStack.length > 0;
  A.canRedo = () => redoStack.length > 0;

  /* ---------------- Activity ---------------- */
  A.log = function (text, boardId) {
    const s = A.state;
    s.activity.unshift({ id: A.uid('ev'), time: A.now(), text, boardId: boardId || A.ui.boardId, user: s.settings.name, unread: true });
    if (s.activity.length > 300) s.activity.length = 300;
    A.updateActivityBadge && A.updateActivityBadge();
  };

  /* ---------------- Model helpers ---------------- */
  A.cardsOn = (bid) => Object.values(A.state.cards).filter((c) => c.boardId === bid && !c.columnId);
  A.allCardsOn = (bid) => Object.values(A.state.cards).filter((c) => c.boardId === bid);
  A.columnChildren = (colId) => Object.values(A.state.cards).filter((c) => c.columnId === colId).sort((a, b) => (a.order || 0) - (b.order || 0));
  A.nextZ = (bid) => { let z = 0; for (const c of A.cardsOn(bid || A.ui.boardId)) z = Math.max(z, c.z || 0); return z + 1; };
  A.boardPath = function (bid) {
    const out = []; let b = A.state.boards[bid]; const seen = new Set();
    while (b && !seen.has(b.id)) { seen.add(b.id); out.unshift(b); b = A.state.boards[b.parentId]; }
    return out;
  };
  A.isDescendant = function (bid, ancestorId) { // is bid inside ancestorId (or equal)
    let b = A.state.boards[bid]; const seen = new Set();
    while (b && !seen.has(b.id)) { if (b.id === ancestorId) return true; seen.add(b.id); b = A.state.boards[b.parentId]; }
    return false;
  };
  A.boardCardFor = (bid) => Object.values(A.state.cards).find((c) => c.type === 'board' && c.data.board === bid);

  A.createBoard = function (title, parentId, opts = {}) {
    const b = { id: A.uid('b'), title: title || 'Untitled board', parentId: parentId || null, icon: opts.icon || '', color: opts.color || 'blue', created: A.now(), updated: A.now(), view: { x: 0, y: 0, z: 1 } };
    A.state.boards[b.id] = b;
    return b;
  };

  A.createCard = function (type, x, y, data = {}, extra = {}) {
    const T = A.CardTypes[type];
    const bid = extra.boardId || A.ui.boardId;
    const c = {
      id: A.uid('c'), type, boardId: bid, x: Math.round(x), y: Math.round(y), w: T.w || 260, h: T.h || null,
      z: A.nextZ(bid), color: null, locked: false, data: Object.assign(T.defaults ? T.defaults() : {}, data),
      comments: [], created: A.now(), updated: A.now(),
    };
    Object.assign(c, extra);
    if (type === 'board' && !c.data.board) {
      const b = A.createBoard(data.title || 'New board', bid, { icon: data.icon, color: data.color });
      c.data = { board: b.id };
    }
    A.state.cards[c.id] = c;
    return c;
  };

  /* Collect cards (with column children & board subtrees) into a detached snapshot */
  A.collect = function (ids, touchingLines) {
    const S = A.state;
    const cardSet = new Set(), boardSet = new Set();
    const addBoard = (bid) => {
      if (boardSet.has(bid) || !S.boards[bid]) return; boardSet.add(bid);
      for (const c of Object.values(S.cards)) if (c.boardId === bid) addCard(c.id);
    };
    const addCard = (id) => {
      const c = S.cards[id]; if (!c || cardSet.has(id)) return; cardSet.add(id);
      if (c.type === 'column') A.columnChildren(id).forEach((ch) => addCard(ch.id));
      if (c.type === 'board' && c.data.board) addBoard(c.data.board);
    };
    ids.forEach(addCard);
    const inSet = (ep) => ep && ep.card && cardSet.has(ep.card);
    const free = (ep) => ep && !ep.card;
    const lines = Object.values(S.lines).filter((l) => {
      if (boardSet.has(l.boardId)) return true;
      if (touchingLines) return inSet(l.from) || inSet(l.to);
      return (inSet(l.from) || inSet(l.to)) && (inSet(l.from) || free(l.from)) && (inSet(l.to) || free(l.to));
    });
    return {
      cards: [...cardSet].map((id) => A.clone(S.cards[id])),
      boards: [...boardSet].map((id) => A.clone(S.boards[id])),
      lines: lines.map((l) => A.clone(l)),
    };
  };

  /* Instantiate a snapshot into a board with fresh ids. Returns ids of new top-level cards. */
  A.instantiate = function (snapData, targetBoardId, dx = 0, dy = 0) {
    const S = A.state; const bMap = {}, cMap = {};
    (snapData.boards || []).forEach((b) => (bMap[b.id] = A.uid('b')));
    (snapData.cards || []).forEach((c) => (cMap[c.id] = A.uid('c')));
    let z = A.nextZ(targetBoardId);
    const top = [];
    for (const b of snapData.boards || []) {
      const nb = A.clone(b); nb.id = bMap[b.id]; nb.parentId = bMap[b.parentId] || targetBoardId; nb.created = nb.updated = A.now();
      if (!nb.view) nb.view = { x: 0, y: 0, z: 1 };
      S.boards[nb.id] = nb;
    }
    const sorted = [...(snapData.cards || [])].sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const c of sorted) {
      const nc = A.clone(c); nc.id = cMap[c.id];
      nc.created = nc.updated = A.now(); nc.comments = nc.comments || [];
      if (bMap[c.boardId]) nc.boardId = bMap[c.boardId];
      else nc.boardId = targetBoardId;
      if (c.columnId && cMap[c.columnId]) nc.columnId = cMap[c.columnId];
      else delete nc.columnId;
      if (!bMap[c.boardId] && !nc.columnId) { nc.x = Math.round((c.x || 0) + dx); nc.y = Math.round((c.y || 0) + dy); nc.z = z++; top.push(nc.id); }
      if (c.type === 'board' && c.data.board) nc.data.board = bMap[c.data.board] || c.data.board;
      S.cards[nc.id] = nc;
    }
    for (const l of snapData.lines || []) {
      const nl = A.clone(l); nl.id = A.uid('l');
      const onTarget = !bMap[l.boardId];
      nl.boardId = bMap[l.boardId] || targetBoardId;
      for (const k of ['from', 'to']) {
        const ep = nl[k];
        if (ep.card) { if (cMap[ep.card]) ep.card = cMap[ep.card]; else { nl._bad = true; } }
        else if (onTarget) { ep.x += dx; ep.y += dy; }
      }
      if (nl._bad) continue;
      S.lines[nl.id] = nl;
    }
    return top;
  };

  /* Delete cards → trash */
  A.deleteCards = function (ids, opts = {}) {
    const S = A.state;
    ids = ids.filter((id) => S.cards[id] && (opts.force || !S.cards[id].locked));
    if (!ids.length) return 0;
    const snapData = A.collect(ids, true);
    snapData.cards.forEach((c) => delete S.cards[c.id]);
    snapData.boards.forEach((b) => delete S.boards[b.id]);
    snapData.lines.forEach((l) => delete S.lines[l.id]);
    const first = snapData.cards.find((c) => ids.includes(c.id));
    S.trash.unshift({ id: A.uid('t'), time: A.now(), boardId: first ? first.boardId : A.ui.boardId, title: A.cardSummary(first) + (ids.length > 1 ? ` + ${ids.length - 1} more` : ''), topIds: ids, ...snapData });
    ids.forEach((id) => A.ui.selection.delete(id));
    A.log(`Deleted ${ids.length === 1 ? A.cardSummary(first) : ids.length + ' cards'}`);
    return ids.length;
  };

  A.restoreTrash = function (tid) {
    const S = A.state; const i = S.trash.findIndex((t) => t.id === tid); if (i < 0) return;
    const t = S.trash[i];
    const target = S.boards[t.boardId] ? t.boardId : A.ui.boardId;
    const ownBoards = new Set((t.boards || []).map((b) => b.id));
    (t.boards || []).forEach((b) => { if (!ownBoards.has(b.parentId) && !S.boards[b.parentId]) b.parentId = target; S.boards[b.id] = b; });
    (t.cards || []).forEach((c) => {
      if (!ownBoards.has(c.boardId) && !S.boards[c.boardId]) c.boardId = target;
      if (c.columnId && !S.cards[c.columnId] && !t.cards.find((x) => x.id === c.columnId)) delete c.columnId;
      S.cards[c.id] = c;
    });
    (t.lines || []).forEach((l) => {
      const ok = (ep) => !ep.card || S.cards[ep.card];
      if (!ownBoards.has(l.boardId) && !S.boards[l.boardId]) l.boardId = target;
      if (ok(l.from) && ok(l.to)) S.lines[l.id] = l;
    });
    S.trash.splice(i, 1);
    A.log(`Restored ${t.title}`);
  };

  /* Move cards to another board */
  A.moveCardsToBoard = function (ids, targetBid, pos) {
    const S = A.state;
    ids = ids.filter((id) => S.cards[id]);
    for (const id of ids) {
      const c = S.cards[id];
      if (c.type === 'board' && A.isDescendant(targetBid, c.data.board)) { A.toast('A board cannot be moved inside itself'); return false; }
    }
    if (!ids.length) return false;
    const idSet = new Set(ids);
    const srcBoard = S.cards[ids[0]].boardId;
    // bounding box
    let minX = Infinity, minY = Infinity;
    ids.forEach((id) => { const c = S.cards[id]; minX = Math.min(minX, c.x || 0); minY = Math.min(minY, c.y || 0); });
    if (!pos) {
      const tc = A.cardsOn(targetBid);
      let maxY = 0; tc.forEach((c) => (maxY = Math.max(maxY, (c.y || 0) + (c.h || 160))));
      pos = { x: 80, y: tc.length ? maxY + 60 : 80 };
    }
    let z = A.nextZ(targetBid);
    for (const id of ids) {
      const c = S.cards[id];
      if (c.columnId) { delete c.columnId; c.x = minX; c.y = minY; }
      c.x = Math.round(pos.x + (c.x - minX)); c.y = Math.round(pos.y + (c.y - minY)); c.z = z++;
      c.boardId = targetBid;
      if (c.type === 'column') A.columnChildren(c.id).forEach((ch) => (ch.boardId = targetBid));
      if (c.type === 'board' && S.boards[c.data.board]) S.boards[c.data.board].parentId = targetBid;
    }
    const all = new Set(ids); ids.forEach((id) => { if (S.cards[id].type === 'column') A.columnChildren(id).forEach((ch) => all.add(ch.id)); });
    for (const l of Object.values(S.lines)) {
      if (l.boardId !== srcBoard) continue;
      const a = l.from.card && all.has(l.from.card), b = l.to.card && all.has(l.to.card);
      if (a && b) l.boardId = targetBid;
      else if (a || b) delete S.lines[l.id];
    }
    ids.forEach((id) => A.ui.selection.delete(id));
    const tb = S.boards[targetBid];
    A.log(`Moved ${idSet.size} card${idSet.size > 1 ? 's' : ''} to “${tb ? tb.title : 'board'}”`);
    return true;
  };

  A.textOf = function (html) { const d = document.createElement('div'); d.innerHTML = html || ''; return (d.textContent || '').trim(); };
  A.cardSummary = function (c) {
    if (!c) return 'card';
    const d = c.data || {};
    let t = '';
    switch (c.type) {
      case 'note': t = A.textOf(d.html); break;
      case 'todo': t = d.title || 'To-do list'; break;
      case 'link': t = d.title || d.url; break;
      case 'board': t = (A.state.boards[d.board] || {}).title || 'Board'; break;
      case 'column': t = d.title || 'Column'; break;
      case 'document': t = d.title || 'Document'; break;
      case 'image': t = d.caption || 'Image'; break;
      case 'file': t = d.name || 'File'; break;
      case 'swatch': t = d.name || d.color; break;
      case 'map': t = d.query || 'Map'; break;
      case 'table': t = 'Table'; break;
      default: t = (A.CardTypes[c.type] || {}).label || c.type;
    }
    t = (t || (A.CardTypes[c.type] || {}).label || 'card').replace(/\s+/g, ' ');
    return t.length > 48 ? t.slice(0, 46) + '…' : t;
  };
  A.searchText = function (c) {
    const d = c.data || {}; const parts = [];
    for (const k of ['title', 'url', 'desc', 'caption', 'name', 'query', 'color']) if (d[k]) parts.push(d[k]);
    if (d.html) parts.push(A.textOf(d.html));
    if (d.items) d.items.forEach((i) => parts.push(i.text));
    if (d.rows) d.rows.forEach((r) => r.forEach((x) => parts.push(x)));
    if (c.comments) c.comments.forEach((m) => parts.push(m.text));
    if (c.type === 'board') parts.push((A.state.boards[d.board] || {}).title || '');
    return parts.join(' \n ');
  };

  /* Export / import whole workspace */
  A.exportWorkspace = async function () {
    const assets = {};
    for (const id of Object.keys(A.assets)) {
      const a = A.assets[id];
      assets[id] = { name: a.name, type: a.type, size: a.size, data: await A.assetToDataURL(id) };
    }
    return JSON.stringify({ format: 'canvas-notes', version: 1, exported: new Date().toISOString(), state: A.state, assets });
  };
  A.importWorkspace = async function (text) {
    const o = JSON.parse(text);
    if (!o || o.format !== 'canvas-notes' || !o.state) throw new Error('Not a valid backup file');
    A.checkpoint();
    for (const [id, a] of Object.entries(o.assets || {})) if (a.data) await A.importAsset(id, { blob: A.dataURLToBlob(a.data), name: a.name, type: a.type, size: a.size });
    A.state = migrate(o.state);
    A.ui.selection.clear();
    A.openBoard(A.state.rootId);
    A.saveNow(); A.save();
  };
  A.resetWorkspace = function () {
    A.state = emptyState(); A.seed(); A.ui.selection.clear(); A.openBoard(A.state.rootId); A.save();
  };
})();
