/* Canvas: rendering, pan/zoom, selection, drag & drop, resize, lines */
(function () {
  'use strict';
  const A = window.App;
  const esc = A.esc;
  let vp, world, cardsLayer, linesSvg, labelsLayer, overlaySvg, marqueeEl, dropInd;
  A.cardEls = new Map();
  A.view = { x: 0, y: 0, z: 1 };
  let spaceDown = false;
  A.tempLine = null; A.guides = [];

  A.initCanvas = function () {
    vp = document.getElementById('viewport');
    world = document.getElementById('world');
    cardsLayer = document.getElementById('cards-layer');
    linesSvg = document.getElementById('lines-layer');
    labelsLayer = document.getElementById('labels-layer');
    overlaySvg = document.getElementById('overlay-layer');
    marqueeEl = document.getElementById('marquee');
    dropInd = document.createElement('div'); dropInd.className = 'drop-indicator';

    vp.addEventListener('pointerdown', onPointerDown);
    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('dblclick', onDblClick);
    vp.addEventListener('click', onClick);
    vp.addEventListener('contextmenu', onContext);
    vp.addEventListener('dragover', onDragOver);
    vp.addEventListener('dragleave', () => vp.classList.remove('file-over'));
    vp.addEventListener('drop', onDrop);
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping()) { if (!spaceDown) { spaceDown = true; vp.classList.add('space-pan'); } if (!e.repeat) e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; vp.classList.remove('space-pan'); } });
    window.addEventListener('resize', () => A.updateSelBar && A.updateSelBar());
    // gesture (Safari pinch)
    let gz = 1;
    vp.addEventListener('gesturestart', (e) => { e.preventDefault(); gz = A.view.z; });
    vp.addEventListener('gesturechange', (e) => { e.preventDefault(); A.zoomAt(gz * e.scale, e.clientX, e.clientY); });
  };
  const isTyping = () => { const a = document.activeElement; return a && (a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName)); };
  A.isTyping = isTyping;

  /* ---------- view ---------- */
  A.applyView = function () {
    const v = A.view;
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    const g = 24 * v.z;
    vp.style.backgroundSize = `${g}px ${g}px`;
    vp.style.backgroundPosition = `${v.x}px ${v.y}px`;
    vp.style.setProperty('--z', v.z);
    const zl = document.getElementById('zoom-label'); if (zl) zl.textContent = Math.round(v.z * 100) + '%';
    const b = A.state.boards[A.ui.boardId]; if (b) { b.view = { x: v.x, y: v.y, z: v.z }; A.save(); }
    A.updateSelBar && A.updateSelBar();
    A.spawnIdx = 0;
    if (A.ui.selectedLine || A.tempLine) renderOverlay();
  };
  A.toWorld = function (cx, cy) { const r = vp.getBoundingClientRect(); return { x: (cx - r.left - A.view.x) / A.view.z, y: (cy - r.top - A.view.y) / A.view.z }; };
  A.toScreen = function (wx, wy) { const r = vp.getBoundingClientRect(); return { x: wx * A.view.z + A.view.x + r.left, y: wy * A.view.z + A.view.y + r.top }; };
  A.viewCenter = function () { const r = vp.getBoundingClientRect(); return A.toWorld(r.left + r.width / 2, r.top + r.height / 2); };
  A.zoomAt = function (z, cx, cy) {
    const r = vp.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    z = A.clamp(z, 0.1, 4);
    const sx = cx - r.left, sy = cy - r.top, v = A.view;
    v.x = sx - (sx - v.x) * (z / v.z); v.y = sy - (sy - v.y) * (z / v.z); v.z = z;
    A.applyView();
  };
  A.zoomIn = () => A.zoomAt(A.view.z * 1.2);
  A.zoomOut = () => A.zoomAt(A.view.z / 1.2);
  A.zoomReset = () => A.zoomAt(1);
  A.contentBounds = function (ids) {
    const list = ids ? ids.map((id) => A.state.cards[id]).filter(Boolean) : A.cardsOn(A.ui.boardId);
    if (!list.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const c of list) { const r = A.cardRect(c.id) || { x: c.x, y: c.y, w: c.w || 200, h: 120 }; x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
    for (const l of Object.values(A.state.lines)) if (l.boardId === A.ui.boardId && !ids) for (const ep of [l.from, l.to]) if (!ep.card) { x1 = Math.min(x1, ep.x); y1 = Math.min(y1, ep.y); x2 = Math.max(x2, ep.x); y2 = Math.max(y2, ep.y); }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  A.fitToContent = function (ids, maxZ = 1) {
    const b = A.contentBounds(ids); const r = vp.getBoundingClientRect();
    if (!b) { A.view.x = r.width / 2; A.view.y = r.height / 3; A.view.z = 1; return A.applyView(); }
    const pad = 80;
    const z = A.clamp(Math.min((r.width - pad * 2) / Math.max(b.w, 1), (r.height - pad * 2) / Math.max(b.h, 1), maxZ), 0.1, 4);
    A.view.z = z; A.view.x = r.width / 2 - (b.x + b.w / 2) * z; A.view.y = r.height / 2 - (b.y + b.h / 2) * z;
    A.applyView();
  };
  A.focusCard = function (id) {
    const c = A.state.cards[id]; if (!c) return;
    A.render();
    const target = c.columnId || id;
    A.fitToContent([target], 1);
    A.ui.selection.clear(); A.ui.selection.add(id); A.render();
    const el = A.cardEls.get(id); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  };
  A.spawnIdx = 0;
  A.spawnPoint = function (w = 260) {
    const c = A.viewCenter(); const i = A.spawnIdx++ % 8;
    return { x: c.x - w / 2 + i * 28, y: c.y - 80 + i * 28 };
  };

  /* ---------- render ---------- */
  A.render = function () {
    const S = A.state; const bid = A.ui.boardId; if (!S.boards[bid]) return;
    A._pass = new Set();
    const top = A.cardsOn(bid);
    for (const c of top) {
      const el = A.ensureEl(c);
      if (el.parentNode !== cardsLayer) cardsLayer.appendChild(el);
      if (!el.classList.contains('dragging')) { el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; el.style.zIndex = c.z || 1; }
    }
    for (const [id, el] of A.cardEls) if (!A._pass.has(id)) { el.remove(); A.cardEls.delete(id); }
    for (const [id, el] of A.cardEls) { el.classList.toggle('selected', A.ui.selection.has(id)); el.classList.toggle('active', A.ui.active === id); }
    document.getElementById('empty-hint').hidden = top.length > 0;
    A.renderLines();
    A.updateChrome && A.updateChrome();
    A.updateSelBar && A.updateSelBar();
  };

  A.ensureEl = function (c) {
    A._pass && A._pass.add(c.id);
    let el = A.cardEls.get(c.id);
    if (!el) { el = document.createElement('div'); A.cardEls.set(c.id, el); el._sig = null; }
    const sig = A.sigOf(c);
    const ae = document.activeElement;
    const busy = (A.ui.editing && el.contains(A.ui.editing.el)) || (ae && ae !== document.body && el.contains(ae));
    if (el._sig !== sig && !busy) { A.fillCard(el, c); el._sig = sig; }
    else if (c.type === 'column') for (const k of A.columnChildren(c.id)) { if (c.data.collapsed) A._pass.add(k.id); else A.ensureEl(k); }
    return el;
  };

  A.cardRect = function (id) {
    const c = A.state.cards[id]; const el = A.cardEls.get(id);
    if (!c || !el || !el.isConnected || c.boardId !== A.ui.boardId) {
      if (c && c.columnId && A.state.cards[c.columnId] && A.state.cards[c.columnId].data.collapsed) return A.cardRect(c.columnId);
      return null;
    }
    if (c.columnId && !el.classList.contains('dragging')) {
      const r = el.getBoundingClientRect(); const p = A.toWorld(r.left, r.top);
      return { x: p.x, y: p.y, w: r.width / A.view.z, h: r.height / A.view.z };
    }
    return { x: c.x, y: c.y, w: el.offsetWidth, h: el.offsetHeight };
  };

  /* ---------- lines ---------- */
  const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  function rectEdge(r, from, toward, gap = 6) {
    const c = center(r); let dx = toward.x - c.x, dy = toward.y - c.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return c;
    const tx = dx ? (r.w / 2) / Math.abs(dx) : Infinity, ty = dy ? (r.h / 2) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty); const len = Math.hypot(dx, dy);
    return { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap };
  }
  A.lineGeom = function (l) {
    const r1 = l.from.card ? A.cardRect(l.from.card) : null, r2 = l.to.card ? A.cardRect(l.to.card) : null;
    if ((l.from.card && !r1) || (l.to.card && !r2)) return null;
    const a = r1 ? center(r1) : { x: l.from.x, y: l.from.y }, b = r2 ? center(r2) : { x: l.to.x, y: l.to.y };
    const bend = l.bend || { x: 0, y: 0 };
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const h = { x: m.x + bend.x, y: m.y + bend.y };
    const c0 = { x: 2 * h.x - m.x, y: 2 * h.y - m.y };
    const p1 = r1 ? rectEdge(r1, a, c0) : a, p2 = r2 ? rectEdge(r2, b, c0) : b;
    const c = { x: 2 * h.x - (p1.x + p2.x) / 2, y: 2 * h.y - (p1.y + p2.y) / 2 };
    const straight = Math.abs(bend.x) < 0.5 && Math.abs(bend.y) < 0.5;
    const d = straight ? `M${p1.x},${p1.y} L${p2.x},${p2.y}` : `M${p1.x},${p1.y} Q${c.x},${c.y} ${p2.x},${p2.y}`;
    const hh = straight ? { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } : h;
    return { p1, p2, c: straight ? hh : c, h: hh, d, a, b };
  };
  function arrowHead(tip, from, w, color) {
    let dx = tip.x - from.x, dy = tip.y - from.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const s = 7 + w * 2.2, px = -dy, py = dx;
    const p = (x, y) => `${x.toFixed(1)},${y.toFixed(1)}`;
    return `<polygon class="arrow" points="${p(tip.x, tip.y)} ${p(tip.x - dx * s + px * s * 0.55, tip.y - dy * s + py * s * 0.55)} ${p(tip.x - dx * s - px * s * 0.55, tip.y - dy * s - py * s * 0.55)}" style="fill:${color}"/>`;
  }
  A.renderLines = function () {
    if (!linesSvg) return;
    const bid = A.ui.boardId; let svg = '', labels = '';
    for (const l of Object.values(A.state.lines)) {
      if (l.boardId !== bid) continue;
      const g = A.lineGeom(l); if (!g) continue;
      const col = l.color || 'var(--line)'; const w = l.width || 2;
      const dash = l.style === 'dashed' ? `stroke-dasharray="${w * 4} ${w * 3}"` : l.style === 'dotted' ? `stroke-dasharray="0.1 ${w * 3}" stroke-linecap="round"` : '';
      svg += `<g class="line${A.ui.selectedLine === l.id ? ' sel' : ''}" data-line="${l.id}"><path class="line-hit" d="${g.d}"/><path class="line-path" d="${g.d}" style="stroke:${col}" stroke-width="${w}" ${dash}/>${l.arrowEnd ? arrowHead(g.p2, g.c, w, col) : ''}${l.arrowStart ? arrowHead(g.p1, g.c, w, col) : ''}</g>`;
      if (l.label) labels += `<div class="line-label${A.ui.selectedLine === l.id ? ' sel' : ''}" data-line="${l.id}" style="left:${g.h.x}px;top:${g.h.y}px;--lc:${col}">${esc(l.label)}</div>`;
    }
    linesSvg.innerHTML = svg;
    if (!A._labelEditing) labelsLayer.innerHTML = labels;
    renderOverlay();
  };
  function renderOverlay() {
    let s = ''; const z = A.view.z;
    if (A.tempLine) {
      const t = A.tempLine;
      s += `<path class="temp-line" d="M${t.p1.x},${t.p1.y} L${t.p2.x},${t.p2.y}" stroke-width="${2 / Math.max(z, .3)}"/>`;
    }
    for (const g of A.guides) s += `<line class="guide" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke-width="${1 / z}"/>`;
    const l = A.ui.selectedLine && A.state.lines[A.ui.selectedLine];
    if (l && l.boardId === A.ui.boardId) {
      const g = A.lineGeom(l);
      if (g) {
        const r = 6 / z;
        s += `<circle class="handle" data-handle="from" cx="${g.p1.x}" cy="${g.p1.y}" r="${r}" stroke-width="${2 / z}"/>`;
        s += `<circle class="handle" data-handle="to" cx="${g.p2.x}" cy="${g.p2.y}" r="${r}" stroke-width="${2 / z}"/>`;
        s += `<circle class="handle mid" data-handle="mid" cx="${g.h.x}" cy="${g.h.y}" r="${r * 0.85}" stroke-width="${2 / z}"/>`;
      }
    }
    overlaySvg.innerHTML = s;
    A.updateLineBar && A.updateLineBar();
  }
  A.renderOverlay = renderOverlay;

  A.selectLine = function (id) {
    A.endEdit(); A.ui.selection.clear(); A.ui.selectedLine = id; A.ui.active = null; A.render();
  };

  /* ---------- hit helpers ---------- */
  function cardAt(cx, cy, exclude) {
    const els = document.elementsFromPoint(cx, cy);
    for (const el of els) {
      const c = el.closest && el.closest('.card');
      if (c && !c.classList.contains('dragging') && !(exclude && exclude.has(c.dataset.id))) return c;
    }
    return null;
  }

  /* ---------- pointer ---------- */
  function onPointerDown(e) {
    A.closeMenus && A.closeMenus();
    if (e.button === 1 || (e.button === 0 && (spaceDown || A.ui.tool === 'hand'))) { e.preventDefault(); return startPan(e); }
    if (e.button !== 0) return;
    const t = e.target;
    const hd = t.closest('[data-handle]');
    if (hd) { e.preventDefault(); return startLineHandle(e, A.ui.selectedLine, hd.dataset.handle, false); }
    const lineEl = t.closest('[data-line]');
    if (lineEl && !t.closest('.card')) {
      e.preventDefault();
      const id = lineEl.dataset.line;
      if (A.ui.selectedLine !== id) A.selectLine(id);
      return startLineHandle(e, id, 'mid', true);
    }
    const cardEl = t.closest('.card');
    if (cardEl) return onCardDown(e, cardEl);
    if (A.ui.editing) A.endEdit();
    if (A.ui.tool === 'line') { e.preventDefault(); return startLineCreate(e, null); }
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    startMarquee(e);
  }

  function startPan(e) {
    vp.classList.add('panning');
    let lx = e.clientX, ly = e.clientY;
    const mv = (ev) => { A.view.x += ev.clientX - lx; A.view.y += ev.clientY - ly; lx = ev.clientX; ly = ev.clientY; A.applyView(); };
    const up = () => { vp.classList.remove('panning'); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  function onWheel(e) {
    if (e.target.closest('.card .scrollable, .table-wrap') && !e.ctrlKey && !e.metaKey) {
      const sc = e.target.closest('.card .scrollable, .table-wrap');
      if (sc.scrollHeight > sc.clientHeight || sc.scrollWidth > sc.clientWidth) return;
    }
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0035));
      A.zoomAt(A.view.z * f, e.clientX, e.clientY);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      if (e.shiftKey && !e.deltaX) { A.view.x -= e.deltaY * k; } else { A.view.x -= e.deltaX * k; A.view.y -= e.deltaY * k; }
      A.applyView();
    }
  }

  function startMarquee(e) {
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = add ? new Set(A.ui.selection) : new Set();
    const vr = vp.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY; let moved = false;
    if (!add) { A.ui.selection.clear(); }
    A.ui.selectedLine = null; A.ui.active = null;
    A.render();
    const mv = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      const x1 = Math.min(sx, ev.clientX), y1 = Math.min(sy, ev.clientY), x2 = Math.max(sx, ev.clientX), y2 = Math.max(sy, ev.clientY);
      Object.assign(marqueeEl.style, { display: 'block', left: x1 - vr.left + 'px', top: y1 - vr.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
      const a = A.toWorld(x1, y1), b = A.toWorld(x2, y2);
      const sel = new Set(base);
      for (const c of A.cardsOn(A.ui.boardId)) {
        const r = A.cardRect(c.id); if (!r) continue;
        if (r.x < b.x && r.x + r.w > a.x && r.y < b.y && r.y + r.h > a.y) sel.add(c.id);
      }
      A.ui.selection = sel;
      for (const [id, el] of A.cardEls) el.classList.toggle('selected', sel.has(id));
    };
    const up = () => {
      marqueeEl.style.display = 'none';
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      A.render();
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  function onCardDown(e, cardEl) {
    const id = cardEl.dataset.id; const c = A.state.cards[id]; if (!c) return;
    const t = e.target;
    if (A.ui.editing && A.ui.editing.el.contains(t)) return;
    if (t.closest('input, textarea, select, video, audio, iframe')) return;
    if (t.closest('[data-nodrag], a[href]')) { if (A.ui.editing && !A.ui.editing.el.closest('.card').contains(t)) A.endEdit(); return; }
    if (t.classList.contains('resize-handle')) { e.preventDefault(); e.stopPropagation(); return startResize(e, c, cardEl); }
    if (t.classList.contains('connect-handle') || A.ui.tool === 'line') { e.preventDefault(); return startLineCreate(e, id); }
    e.preventDefault();
    if (A.ui.editing) A.endEdit();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    A.ui.selectedLine = null;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const wasSelected = A.ui.selection.has(id);
    if (additive) { if (wasSelected) A.ui.selection.delete(id); else A.ui.selection.add(id); }
    else if (!wasSelected) { A.ui.selection.clear(); A.ui.selection.add(id); }
    if (A.ui.active !== id) A.ui.active = null;
    // children of a selected column shouldn't be selected separately
    A.render();
    const sx = e.clientX, sy = e.clientY; let drag = null;
    const mv = (ev) => {
      if (!drag) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        if (!A.ui.selection.has(id)) { A.ui.selection.clear(); A.ui.selection.add(id); }
        drag = beginDrag(ev, sx, sy, ev.altKey);
        if (!drag) { cleanup(); return; }
      }
      dragMove(drag, ev);
    };
    const up = (ev) => {
      cleanup();
      if (drag) dragEnd(drag, ev);
      else if (!additive) clickCard(ev, c, cardEl, t, wasSelected);
    };
    const cleanup = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  function clickCard(ev, c, cardEl, t, wasSelected) {
    const T = A.CardTypes[c.type];
    if (T.onClick && T.onClick(c, ev)) return;
    if (c.locked) return;
    let f = t.closest('[data-field]');
    if (f && f.closest('.card') !== cardEl) f = null;
    if (!f && c.type === 'note') f = cardEl.querySelector('.card-body > [data-field="html"]');
    if (f) A.beginEdit(f, c.id, ev);
  }

  /* ---------- drag cards ---------- */
  function beginDrag(ev, sx, sy, duplicate) {
    const S = A.state;
    let ids = [...A.ui.selection].filter((id) => S.cards[id] && !S.cards[id].locked && S.cards[id].boardId === A.ui.boardId);
    // drop children whose column is also being dragged
    ids = ids.filter((id) => !(S.cards[id].columnId && ids.includes(S.cards[id].columnId)));
    if (!ids.length) { A.toast('Locked cards can’t be moved'); return null; }
    A.checkpoint();
    if (duplicate) {
      const snapData = A.collect(ids, false);
      // place copies at the same spot; originals stay
      snapData.cards.forEach((c) => { if (c.columnId && !snapData.cards.find((x) => x.id === c.columnId)) { const r = A.cardRect(c.id); delete c.columnId; if (r) { c.x = r.x; c.y = r.y; } } });
      ids = A.instantiate(snapData, A.ui.boardId, 0, 0);
      A.ui.selection = new Set(ids); A.render();
    }
    const orig = {};
    for (const id of ids) {
      const c = S.cards[id]; const el = A.cardEls.get(id);
      if (c.columnId) {
        const r = A.cardRect(id);
        delete c.columnId; c.x = r ? r.x : 0; c.y = r ? r.y : 0; c.z = A.nextZ();
        if (r) c.w = Math.round(r.w);
        cardsLayer.appendChild(el); A.fillCard(el, c); el._sig = A.sigOf(c);
        el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
      }
      orig[id] = { x: c.x, y: c.y };
      el.classList.add('dragging');
      el.style.zIndex = 100000;
    }
    A.endEdit();
    document.body.classList.add('is-dragging');
    // gather static rects for guides
    const others = [];
    if (A.state.settings.guides !== false) for (const c of A.cardsOn(A.ui.boardId)) if (!orig[c.id]) { const r = A.cardRect(c.id); if (r) others.push(r); }
    const sizes = {}; ids.forEach((id) => { const el = A.cardEls.get(id); sizes[id] = { w: el.offsetWidth, h: el.offsetHeight }; });
    A.hideSelBar && A.hideSelBar();
    return { ids, orig, sx, sy, others, sizes, drop: null };
  }

  function dragMove(d, ev) {
    const S = A.state, z = A.view.z;
    let dx = (ev.clientX - d.sx) / z, dy = (ev.clientY - d.sy) / z;
    // bounding box of moving group
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const id of d.ids) { const o = d.orig[id], s = d.sizes[id]; x1 = Math.min(x1, o.x + dx); y1 = Math.min(y1, o.y + dy); x2 = Math.max(x2, o.x + dx + s.w); y2 = Math.max(y2, o.y + dy + s.h); }
    A.guides = [];
    if (S.settings.snap && !ev.shiftKey) {
      const g = 24; const nx = Math.round(x1 / g) * g, ny = Math.round(y1 / g) * g; dx += nx - x1; dy += ny - y1;
    } else if (d.others.length && !ev.shiftKey && d.ids.length < 40) {
      const th = 6 / z;
      const xs = [x1, (x1 + x2) / 2, x2], ys = [y1, (y1 + y2) / 2, y2];
      let bx = null, by = null;
      for (const r of d.others) {
        const rx = [r.x, r.x + r.w / 2, r.x + r.w], ry = [r.y, r.y + r.h / 2, r.y + r.h];
        for (const a of xs) for (const b of rx) { const df = b - a; if (Math.abs(df) < th && (!bx || Math.abs(df) < Math.abs(bx.df))) bx = { df, v: b, r }; }
        for (const a of ys) for (const b of ry) { const df = b - a; if (Math.abs(df) < th && (!by || Math.abs(df) < Math.abs(by.df))) by = { df, v: b, r }; }
      }
      if (bx) { dx += bx.df; A.guides.push({ x1: bx.v, x2: bx.v, y1: Math.min(y1 + dy - (by ? by.df : 0), bx.r.y) - 20, y2: Math.max(y2 + dy, bx.r.y + bx.r.h) + 20 }); }
      if (by) { dy += by.df; A.guides.push({ y1: by.v, y2: by.v, x1: Math.min(x1 + dx, by.r.x) - 20, x2: Math.max(x2 + dx, by.r.x + by.r.w) + 20 }); }
    }
    for (const id of d.ids) {
      const c = S.cards[id], o = d.orig[id], el = A.cardEls.get(id);
      c.x = Math.round(o.x + dx); c.y = Math.round(o.y + dy);
      el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
    }
    // drop target detection
    const dragIds = new Set(d.ids);
    const hasColumn = d.ids.some((id) => S.cards[id].type === 'column');
    let drop = null;
    const trash = document.getElementById('trash-btn');
    const tr = trash && trash.getBoundingClientRect();
    if (tr && ev.clientX >= tr.left && ev.clientX <= tr.right && ev.clientY >= tr.top && ev.clientY <= tr.bottom) drop = { type: 'trash' };
    else {
      const hit = cardAt(ev.clientX, ev.clientY, dragIds);
      if (hit) {
        const hc = S.cards[hit.dataset.id];
        let colEl = hit.classList.contains('card-column') ? hit : hit.closest('.card-column');
        if (colEl && !hasColumn && !dragIds.has(colEl.dataset.id)) {
          const col = S.cards[colEl.dataset.id];
          if (!col.data.collapsed) {
            const body = colEl.querySelector('.col-body');
            const kids = [...body.children].filter((k) => k.classList.contains('card') && !dragIds.has(k.dataset.id));
            let idx = kids.length;
            for (let i = 0; i < kids.length; i++) { const r = kids[i].getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { idx = i; break; } }
            drop = { type: 'column', id: col.id, idx, before: kids[idx] || null, body };
          } else drop = { type: 'column', id: col.id, idx: Infinity };
        } else if (hc && hc.type === 'board' && !hc.columnId) drop = { type: 'board', id: hc.id, board: hc.data.board };
        else if (hc && hc.type === 'board' && hc.columnId) drop = { type: 'board', id: hc.id, board: hc.data.board };
      }
    }
    setDrop(d, drop);
    A.renderLines();
    // auto-scroll near edges
    const r = vp.getBoundingClientRect(); const m = 24; let px = 0, py = 0;
    if (ev.clientX < r.left + m) px = 12; else if (ev.clientX > r.right - m) px = -12;
    if (ev.clientY < r.top + m) py = 12; else if (ev.clientY > r.bottom - m) py = -12;
    if (px || py) { A.view.x += px; A.view.y += py; d.sx += px; d.sy += py; A.applyView(); }
  }

  function setDrop(d, drop) {
    document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    document.getElementById('trash-btn') && document.getElementById('trash-btn').classList.remove('drop-hot');
    dropInd.remove();
    d.drop = drop;
    if (!drop) return;
    if (drop.type === 'trash') document.getElementById('trash-btn').classList.add('drop-hot');
    else if (drop.type === 'board') { const el = A.cardEls.get(drop.id); el && el.classList.add('drop-target'); }
    else if (drop.type === 'column') {
      const el = A.cardEls.get(drop.id); el && el.classList.add('drop-target');
      if (drop.body) { if (drop.before) drop.body.insertBefore(dropInd, drop.before); else drop.body.appendChild(dropInd); }
    }
  }

  function dragEnd(d, ev) {
    const S = A.state;
    A.guides = [];
    document.body.classList.remove('is-dragging');
    const drop = d.drop; setDrop(d, null);
    for (const id of d.ids) { const el = A.cardEls.get(id); if (el) el.classList.remove('dragging'); }
    if (drop && drop.type === 'trash') {
      const n = A.deleteCards(d.ids);
      A.toast(`${n} card${n === 1 ? '' : 's'} moved to trash`, { action: 'Undo', fn: A.undo });
    } else if (drop && drop.type === 'board') {
      const tb = S.boards[drop.board];
      if (A.moveCardsToBoard(d.ids, drop.board)) A.toast(`Moved to “${tb.title}”`, { action: 'Open', fn: () => A.openBoard(drop.board) });
    } else if (drop && drop.type === 'column') {
      const col = S.cards[drop.id];
      const moving = d.ids.slice().sort((a, b) => S.cards[a].y - S.cards[b].y);
      const kids = A.columnChildren(col.id).filter((k) => !moving.includes(k.id));
      const idx = Math.min(drop.idx, kids.length);
      kids.splice(idx, 0, ...moving.map((id) => S.cards[id]));
      kids.forEach((k, i) => { k.columnId = col.id; k.order = i; k.boardId = col.boardId; });
      A.ui.selection = new Set(moving);
    }
    A.changed();
  }

  /* ---------- resize ---------- */
  function startResize(e, c, el) {
    A.checkpoint();
    const T = A.CardTypes[c.type];
    const sw = el.offsetWidth, sh = el.offsetHeight, sx = e.clientX, sy = e.clientY;
    document.body.classList.add('is-resizing');
    const mv = (ev) => {
      const z = A.view.z;
      c.w = Math.round(Math.max(T.minW || 120, sw + (ev.clientX - sx) / z));
      if (A.state.settings.snap) c.w = Math.round(c.w / 12) * 12;
      el.style.width = c.w + 'px';
      if (T.resize === 'wh') { c.h = Math.round(Math.max(100, sh + (ev.clientY - sy) / z)); el.style.height = c.h + 'px'; }
      A.renderLines(); A.updateSelBar && A.updateSelBar();
    };
    const up = () => { document.body.classList.remove('is-resizing'); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); A.changed(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  /* ---------- line creation & editing ---------- */
  function newLine(from, to) {
    return { id: A.uid('l'), boardId: A.ui.boardId, from, to, color: null, width: 2, style: 'solid', arrowEnd: true, arrowStart: false, label: '', bend: { x: 0, y: 0 } };
  }
  function startLineCreate(e, fromCard) {
    A.endEdit();
    const p0 = A.toWorld(e.clientX, e.clientY);
    const fromRect = fromCard ? A.cardRect(fromCard) : null;
    const start = fromRect ? center(fromRect) : p0;
    let target = null, moved = false;
    const exclude = new Set(fromCard ? [fromCard] : []);
    const mv = (ev) => {
      const p = A.toWorld(ev.clientX, ev.clientY);
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) * A.view.z < 5) return;
      moved = true;
      document.querySelectorAll('.connect-target').forEach((x) => x.classList.remove('connect-target'));
      const hit = cardAt(ev.clientX, ev.clientY, exclude);
      target = hit ? hit.dataset.id : null;
      if (hit) hit.classList.add('connect-target');
      let p2 = p;
      if (target) { const r = A.cardRect(target); if (r) p2 = center(r); }
      let p1 = start; if (fromRect) p1 = rectEdge(fromRect, start, p2);
      A.tempLine = { p1, p2 }; renderOverlay();
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      document.querySelectorAll('.connect-target').forEach((x) => x.classList.remove('connect-target'));
      A.tempLine = null;
      if (!moved) { renderOverlay(); if (fromCard && A.ui.tool !== 'line') { /* plain click on handle */ } return; }
      const p = A.toWorld(ev.clientX, ev.clientY);
      A.checkpoint();
      const l = newLine(fromCard ? { card: fromCard } : { x: p0.x, y: p0.y }, target ? { card: target } : { x: p.x, y: p.y });
      A.state.lines[l.id] = l;
      if (!ev.shiftKey) A.setTool(null);
      A.log('Added a line');
      A.selectLine(l.id); A.save();
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  function startLineHandle(e, lineId, which, needMove) {
    const l = A.state.lines[lineId]; if (!l) return;
    const sx = e.clientX, sy = e.clientY; let started = !needMove;
    const otherCard = (k) => (l[k === 'from' ? 'to' : 'from'] || {}).card;
    if (started) A.checkpoint();
    const mv = (ev) => {
      if (!started) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return; started = true; A.checkpoint(); }
      const p = A.toWorld(ev.clientX, ev.clientY);
      if (which === 'mid') {
        // if both ends free and user drags with alt → move whole line; default: bend
        const g = A.lineGeom(l); if (!g) return;
        const m = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
        l.bend = { x: p.x - m.x, y: p.y - m.y };
        if (Math.hypot(l.bend.x, l.bend.y) < 8 / A.view.z) l.bend = { x: 0, y: 0 };
      } else {
        document.querySelectorAll('.connect-target').forEach((x) => x.classList.remove('connect-target'));
        const ex = new Set(); const oc = otherCard(which); if (oc) ex.add(oc);
        const hit = cardAt(ev.clientX, ev.clientY, ex);
        if (hit) { hit.classList.add('connect-target'); l[which] = { card: hit.dataset.id }; }
        else l[which] = { x: p.x, y: p.y };
      }
      A.renderLines();
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      document.querySelectorAll('.connect-target').forEach((x) => x.classList.remove('connect-target'));
      if (started) A.changed();
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  A.editLineLabel = function (id) {
    const l = A.state.lines[id]; if (!l) return;
    const g = A.lineGeom(l); if (!g) return;
    A._labelEditing = true;
    labelsLayer.innerHTML = '';
    const inp = document.createElement('input');
    inp.className = 'line-label-input'; inp.value = l.label || ''; inp.placeholder = 'Label';
    inp.style.left = g.h.x + 'px'; inp.style.top = g.h.y + 'px';
    labelsLayer.appendChild(inp);
    inp.focus(); inp.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      if (save && inp.value !== (l.label || '')) { A.checkpoint(); l.label = inp.value.trim(); }
      A._labelEditing = false; A.changed();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('pointerdown', (e) => e.stopPropagation());
  };

  /* ---------- click / dblclick / context ---------- */
  function onClick(e) {
    const actEl = e.target.closest('[data-act]'); if (!actEl) return;
    const cardEl = actEl.closest('.card'); if (!cardEl) return;
    const c = A.state.cards[cardEl.dataset.id]; if (!c) return;
    const T = A.CardTypes[c.type];
    const act = actEl.dataset.act;
    const fn = (T.actions && T.actions[act]) || (A.commonActions && A.commonActions[act]);
    if (fn) { e.stopPropagation(); if (c.locked && !/open-comments|file-download|file-preview|link-play|swatch-copy/.test(act)) return A.toast('This card is locked'); fn(c, actEl, e); }
  }
  function onDblClick(e) {
    const t = e.target;
    if (t.closest('[data-handle="mid"]')) { const l = A.state.lines[A.ui.selectedLine]; if (l) { A.checkpoint(); l.bend = { x: 0, y: 0 }; A.changed(); } return; }
    const lineEl = t.closest('[data-line]');
    if (lineEl && !t.closest('.card')) return A.editLineLabel(lineEl.dataset.line);
    const cardEl = t.closest('.card');
    if (cardEl) {
      const c = A.state.cards[cardEl.dataset.id]; const T = c && A.CardTypes[c.type];
      if (T && T.onDblClick && !t.closest('[data-field].editing')) T.onDblClick(c, e);
      return;
    }
    if (t.closest('#viewport') && !t.closest('.card')) {
      const p = A.toWorld(e.clientX, e.clientY);
      A.checkpoint();
      const c = A.createCard('note', p.x - 130, p.y - 20);
      A.ui.selection = new Set([c.id]); A.render();
      A.focusField(c.id, '[data-field="html"]');
    }
  }
  function onContext(e) {
    e.preventDefault();
    const t = e.target;
    const lineEl = t.closest('[data-line]');
    if (lineEl && !t.closest('.card')) { A.selectLine(lineEl.dataset.line); return A.lineContextMenu(e); }
    const cardEl = t.closest('.card');
    if (cardEl) {
      const id = cardEl.dataset.id;
      if (!A.ui.selection.has(id)) { A.endEdit(); A.ui.selection = new Set([id]); A.ui.selectedLine = null; A.render(); }
      return A.cardContextMenu(e);
    }
    A.canvasContextMenu(e, A.toWorld(e.clientX, e.clientY));
  }

  /* ---------- external drag & drop ---------- */
  function onDragOver(e) {
    const types = [...(e.dataTransfer.types || [])];
    if (types.includes('Files') || types.includes('application/x-tool') || types.includes('application/x-card') || types.includes('text/uri-list') || types.includes('text/plain')) {
      e.preventDefault(); e.dataTransfer.dropEffect = types.includes('application/x-card') ? 'move' : 'copy';
      vp.classList.add('file-over');
    }
  }
  function onDrop(e) {
    e.preventDefault(); vp.classList.remove('file-over');
    const p = A.toWorld(e.clientX, e.clientY);
    const dt = e.dataTransfer;
    const tool = dt.getData('application/x-tool');
    if (tool) return A.addTool(tool, p);
    const cid = dt.getData('application/x-card');
    if (cid && A.state.cards[cid]) {
      A.checkpoint();
      const c = A.state.cards[cid];
      if (c.boardId === A.ui.boardId) return;
      const hit = cardAt(e.clientX, e.clientY);
      const hc = hit && A.state.cards[hit.dataset.id];
      if (hc && hc.type === 'board') { A.moveCardsToBoard([cid], hc.data.board); A.toast('Moved into “' + A.state.boards[hc.data.board].title + '”'); }
      else { A.moveCardsToBoard([cid], A.ui.boardId, { x: p.x - (c.w || 260) / 2, y: p.y - 20 }); A.ui.selection = new Set([cid]); }
      A.changed(); A.renderUnsorted && A.renderUnsorted();
      return;
    }
    if (dt.files && dt.files.length) return A.importFiles([...dt.files], p);
    const uri = dt.getData('text/uri-list'); const txt = dt.getData('text/plain');
    const val = (uri || txt || '').trim();
    if (val) A.createFromText(val, p);
  }

  A.createFromText = function (val, p) {
    A.checkpoint();
    p = p || A.spawnPoint();
    let c;
    if (A.isUrl(val)) {
      const u = A.normalizeUrl(val);
      if (/\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i.test(u)) c = A.createCard('image', p.x - 150, p.y - 20, { src: u });
      else c = A.createCard('link', p.x - 140, p.y - 20, { url: u });
    } else {
      const html = val.split(/\n{2,}/).map((para) => '<p>' + A.linkify(para).replace(/\n/g, '<br>') + '</p>').join('');
      c = A.createCard('note', p.x - 130, p.y - 20, { html });
    }
    A.ui.selection = new Set([c.id]); A.changed();
    return c;
  };

  A.importFiles = async function (files, p) {
    if (!files.length) return;
    A.checkpoint();
    p = p || A.spawnPoint(300);
    let x = p.x, y = p.y; const ids = [];
    for (const f of files) {
      const asset = await A.addAsset(f);
      let c;
      if (/^image\//.test(f.type)) {
        let w = 300;
        try { const dim = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = rej; im.src = A.assetURL(asset); }); w = Math.min(360, Math.max(140, dim[0] / 2)); } catch (e) {}
        c = A.createCard('image', x, y, { asset, caption: '' }, { w: Math.round(w) });
      } else if (/^video\//.test(f.type)) c = A.createCard('video', x, y, { asset, caption: f.name });
      else if (/^audio\//.test(f.type)) c = A.createCard('audio', x, y, { asset, name: f.name });
      else c = A.createCard('file', x, y, { asset, name: f.name, size: f.size, mime: f.type });
      ids.push(c.id); x += (c.w || 260) + 24;
    }
    A.log(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
    A.ui.selection = new Set(ids); A.changed();
  };

  A.pickFiles = function (accept, multiple, cb) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept || '*/*'; inp.multiple = !!multiple;
    inp.style.display = 'none'; document.body.appendChild(inp);
    inp.onchange = () => { cb([...inp.files]); inp.remove(); };
    inp.click();
  };

  A.downloadAsset = function (id, name) {
    const u = A.assetURL(id); if (!u) return A.toast('File not available');
    const a = document.createElement('a'); a.href = u; a.download = name || 'file'; document.body.appendChild(a); a.click(); a.remove();
  };

  /* ---------- tools ---------- */
  A.setTool = function (t) {
    A.ui.tool = t;
    vp.classList.toggle('line-mode', t === 'line');
    vp.classList.toggle('hand-mode', t === 'hand');
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  };
  A.addTool = function (type, pos) {
    if (type === 'line') return A.setTool(A.ui.tool === 'line' ? null : 'line');
    if (type === 'upload') return A.pickFiles('*/*', true, (f) => A.importFiles(f, pos));
    if (type === 'image') return A.pickFiles('image/*', true, (f) => A.importFiles(f, pos));
    if (type === 'template') return A.openTemplates();
    if (type === 'ai') return A.openAI();
    const T = A.CardTypes[type]; if (!T) return;
    A.endEdit();
    A.checkpoint();
    const p = pos ? { x: pos.x - (T.w || 260) / 2, y: pos.y - 30 } : A.spawnPoint(T.w);
    const c = A.createCard(type, p.x, p.y);
    A.ui.selection = new Set([c.id]); A.ui.selectedLine = null;
    A.log(`Added ${/^[aeiou]/i.test(T.label) ? 'an' : 'a'} ${T.label.toLowerCase()}`);
    A.render(); A.save();
    const focus = { note: '[data-field="html"]', todo: '[data-field="item"]', column: '[data-field="title"]', board: '[data-field="boardTitle"]', table: '[data-r="0"][data-c="0"]', swatch: '[data-field="name"]', comment: '[data-cmt-input]', link: 'input', map: 'input' }[type];
    if (type === 'document') return A.openDocument(c.id);
    if (type === 'sketch') return A.openSketch(c.id);
    if (focus) requestAnimationFrame(() => {
      const el = A.cardEls.get(c.id); const f = el && el.querySelector(focus); if (!f) return;
      if (f.tagName === 'INPUT' || f.tagName === 'TEXTAREA') f.focus(); else A.beginEdit(f, c.id);
      if (type === 'board') document.execCommand('selectAll');
    });
  };
})();
