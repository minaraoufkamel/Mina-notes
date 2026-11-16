/* UI: chrome, navigation, menus, toolbars, panels */
(function () {
  'use strict';
  const A = window.App;
  const esc = A.esc;
  const I = (n, s) => A.icon(n, s);
  const $ = (s, r = document) => r.querySelector(s);
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  A.h = h;

  A.TOOLS = [
    { id: 'note', label: 'Note', key: 'N' }, { id: 'link', label: 'Link', key: 'W' }, { id: 'todo', label: 'To-do', key: 'T' },
    { id: 'line', label: 'Line', key: 'L' }, { id: 'board', label: 'Board', key: 'B' }, { id: 'column', label: 'Column', key: 'C' },
    { id: 'comment', label: 'Comment', key: 'M' }, { id: 'table', label: 'Table' }, { id: 'document', label: 'Document', key: 'D' },
    { id: 'sketch', label: 'Sketch', key: 'S' }, { id: 'swatch', label: 'Color', key: 'K' }, { id: 'map', label: 'Map' },
    { id: 'audio', label: 'Audio' }, { id: 'image', label: 'Image', key: 'I', icon: 'image' }, { id: 'upload', label: 'Upload', key: 'U', icon: 'upload' },
    { id: 'template', label: 'Templates', icon: 'template' },
  ];

  /* ---------- chrome build ---------- */
  A.buildChrome = function () {
    const tb = $('#toolbar-tools');
    tb.innerHTML = A.TOOLS.map((t) => `<button class="tool" data-tool="${t.id}" draggable="${t.id !== 'line' && t.id !== 'template' && t.id !== 'upload' && t.id !== 'image'}" title="${t.label}${t.key ? ' (' + t.key + ')' : ''}">${I(t.icon || (A.CardTypes[t.id] || {}).icon || t.id, 20)}<span>${t.label}</span></button>`).join('');
    tb.addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) A.addTool(b.dataset.tool); });
    tb.addEventListener('dragstart', (e) => {
      const b = e.target.closest('[data-tool]'); if (!b) return;
      e.dataTransfer.setData('application/x-tool', b.dataset.tool); e.dataTransfer.effectAllowed = 'copy';
      const ghost = h(`<div class="drag-ghost">${I((A.CardTypes[b.dataset.tool] || {}).icon || 'note', 16)} ${b.querySelector('span').textContent}</div>`);
      document.body.appendChild(ghost); e.dataTransfer.setDragImage(ghost, 20, 16); setTimeout(() => ghost.remove(), 0);
    });
    $('#unsorted-btn').innerHTML = I('inbox', 20) + '<span>Unsorted</span><i class="count" id="unsorted-count"></i>';
    $('#trash-btn').innerHTML = I('trash', 20) + '<span>Trash</span>';
    $('#unsorted-btn').onclick = () => A.togglePanel('unsorted');
    $('#trash-btn').onclick = () => A.togglePanel('trash');

    const set = (id, icon, fn, title) => { const b = $('#' + id); b.innerHTML = I(icon, 18); b.onclick = fn; if (title) b.title = title; };
    set('nav-btn', 'menu', () => A.togglePanel('nav'), 'All boards');
    set('home-btn', 'home', () => A.openBoard(A.state.rootId), 'Home');
    set('back-btn', 'back', () => { const b = A.state.boards[A.ui.boardId]; if (b && b.parentId) A.openBoard(b.parentId); }, 'Up one level (Backspace)');
    set('undo-btn', 'undo', () => A.undo(), 'Undo (⌘Z)');
    set('redo-btn', 'redo', () => A.redo(), 'Redo (⇧⌘Z)');
    set('search-btn', 'search', () => A.openSearch(), 'Search (⌘K)');
    set('activity-btn', 'bell', () => A.togglePanel('activity'), 'Activity');
    set('export-btn', 'download', (e) => A.exportMenu(e.currentTarget), 'Export');
    set('settings-btn', 'settings', () => A.openSettings(), 'Settings');
    set('help-btn', 'help', () => A.openShortcuts(), 'Keyboard shortcuts (?)');
    set('theme-btn', 'moon', () => A.cycleTheme(), 'Toggle dark mode');
    $('#share-btn').innerHTML = I('share', 15) + ' Share';
    $('#share-btn').onclick = () => A.openShare();
    $('#activity-btn').insertAdjacentHTML('beforeend', '<i class="dot" id="activity-dot" hidden></i>');

    set('zoom-out', 'minus', () => A.zoomOut(), 'Zoom out (⌘-)');
    set('zoom-in', 'plus', () => A.zoomIn(), 'Zoom in (⌘+)');
    set('zoom-fit', 'fit', () => A.fitToContent(), 'Fit to screen (⇧1)');
    $('#zoom-label').onclick = () => A.zoomReset();

    $('#empty-hint').innerHTML = `<div class="eh-icon">${I('board', 34)}</div><h3>This board is empty</h3>
      <p>Drag items from the toolbar, double-click anywhere to add a note, paste images and links, or drop files here.</p>
      <div class="eh-actions"><button class="btn" data-eh="note">${I('note', 14)} Add a note</button><button class="btn" data-eh="template">${I('template', 14)} Use a template</button></div>`;
    $('#empty-hint').onclick = (e) => { const b = e.target.closest('[data-eh]'); if (b) A.addTool(b.dataset.eh); };

    buildSelBar(); buildLineBar(); buildFormatBar();
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.popover, .menu, .selbar, .linebar, .formatbar, [data-popover-anchor]')) A.closeMenus();
    }, true);
  };

  A.setSaved = function (ok) { const s = $('#save-state'); if (s) { s.textContent = ok ? 'Saved' : 'Saving…'; s.classList.toggle('pending', !ok); } };
  A.updateHistoryButtons = function () { const u = $('#undo-btn'), r = $('#redo-btn'); if (u) u.disabled = !A.canUndo(); if (r) r.disabled = !A.canRedo(); };
  A.updateActivityBadge = function () { const d = $('#activity-dot'); if (d) d.hidden = !A.state.activity.some((a) => a.unread); };

  A.updateChrome = function () {
    const S = A.state; const b = S.boards[A.ui.boardId]; if (!b) return;
    const path = A.boardPath(b.id);
    const bc = $('#breadcrumbs');
    const sig = JSON.stringify(path.map((p) => [p.id, p.title, p.icon, p.color])) + S.starred.includes(b.id);
    if (bc._sig !== sig) {
      bc._sig = sig;
      bc.innerHTML = path.map((p, i) => {
        const last = i === path.length - 1;
        const ic = p.icon ? `<span class="crumb-emoji">${esc(p.icon)}</span>` : `<span class="crumb-dot" style="background:${A.BOARD_HEX[p.color] || A.BOARD_HEX.blue}"></span>`;
        return last ? `<button class="crumb current" id="board-title-btn" title="Board settings">${ic}<span class="crumb-text">${esc(p.title)}</span>${I('chevronDown', 14)}</button>
          <button class="icon-btn star-btn ${S.starred.includes(p.id) ? 'on' : ''}" id="star-btn" title="Star board">${I('star', 15)}</button>`
          : `<button class="crumb" data-crumb="${p.id}">${ic}<span class="crumb-text">${esc(p.title)}</span></button><span class="crumb-sep">${I('chevronRight', 14)}</span>`;
      }).join('');
      bc.querySelectorAll('[data-crumb]').forEach((x) => (x.onclick = () => A.openBoard(x.dataset.crumb)));
      $('#board-title-btn').onclick = (e) => A.boardSettings(e.currentTarget);
      $('#star-btn').onclick = () => { const i = S.starred.indexOf(b.id); if (i >= 0) S.starred.splice(i, 1); else S.starred.push(b.id); A.changed(); bc._sig = null; A.updateChrome(); };
      document.title = b.title;
      // make crumbs droppable targets for cards (move up a level)
      bc.querySelectorAll('[data-crumb]').forEach((x) => {
        x.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-card')) e.preventDefault(); });
        x.addEventListener('drop', (e) => { const id = e.dataTransfer.getData('application/x-card'); if (id) { A.checkpoint(); A.moveCardsToBoard([id], x.dataset.crumb); A.changed(); A.renderUnsorted(); } });
      });
    }
    $('#back-btn').disabled = !b.parentId;
    const uc = $('#unsorted-count'); const n = A.cardsOn('__unsorted').length; if (uc) { uc.textContent = n || ''; uc.hidden = !n; }
    A.updateHistoryButtons();
    A.updateActivityBadge();
  };

  /* ---------- navigation ---------- */
  A.openBoard = function (id, opts = {}) {
    const S = A.state;
    if (!S.boards[id]) id = S.rootId;
    A.endEdit(); A.closeMenus();
    if (A.ui.recording) { try { A.ui.recording.mr.stop(); } catch (e) {} }
    const same = A.ui.boardId === id;
    A.ui.boardId = id; A.ui.selection.clear(); A.ui.selectedLine = null; A.ui.active = null; A.ui.playing.clear();
    A.setTool && A.setTool(null);
    for (const el of A.cardEls.values()) el.remove();
    A.cardEls.clear();
    const b = S.boards[id];
    A.render();
    if (b.visited && b.view) { A.view = { ...b.view }; A.applyView(); }
    else { b.visited = true; A.fitToContent(null, 1); }
    const hash = '#/b/' + id;
    if (location.hash !== hash && !opts.fromHash) { try { history.pushState(null, '', hash); } catch (e) { location.hash = hash; } }
    if (!same) { const w = $('#world'); w.classList.remove('enter'); void w.offsetWidth; w.classList.add('enter'); }
    b.lastOpened = A.now();
    if (A.panelOpen === 'nav') A.renderNav();
  };
  A.routeFromHash = function () {
    const m = location.hash.match(/#\/b\/([\w-]+)/);
    A.openBoard(m && A.state.boards[m[1]] ? m[1] : A.state.rootId, { fromHash: true });
    const cm = location.hash.match(/[?&]card=([\w-]+)/);
    if (cm && A.state.cards[cm[1]]) setTimeout(() => A.focusCard(cm[1]), 50);
  };

  /* ---------- toast ---------- */
  A.toast = function (msg, opt = {}) {
    const box = $('#toasts');
    const t = h(`<div class="toast"><span>${esc(msg)}</span>${opt.action ? `<button>${esc(opt.action)}</button>` : ''}</div>`);
    if (opt.action) t.querySelector('button').onclick = () => { opt.fn(); t.remove(); };
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), opt.time || 3200);
    setTimeout(() => t.remove(), (opt.time || 3200) + 300);
  };

  /* ---------- popover & menu ---------- */
  let openPops = [];
  A.closeMenus = function () { openPops.forEach((p) => p.close(true)); openPops = []; };
  A.popover = function (anchor, content, opts = {}) {
    const pop = h('<div class="popover"></div>');
    pop.appendChild(content);
    document.body.appendChild(pop);
    const place = () => {
      const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let x = opts.align === 'right' ? r.right - pw : r.left + r.width / 2 - pw / 2, y = r.bottom + 8;
      if (y + ph > innerHeight - 8) y = r.top - ph - 8;
      x = A.clamp(x, 8, innerWidth - pw - 8); y = A.clamp(y, 8, innerHeight - ph - 8);
      pop.style.left = x + 'px'; pop.style.top = y + 'px';
    };
    place();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    const rec = { close: (silent) => close(silent) };
    function close() { pop.remove(); window.removeEventListener('keydown', onKey, true); openPops = openPops.filter((x) => x !== rec); opts.onClose && opts.onClose(); }
    if (!opts.keep) { A.closeMenus(); }
    openPops.push(rec);
    pop._place = place;
    return close;
  };

  A.menu = function (x, y, items, opts = {}) {
    if (!opts.sub) A.closeMenus();
    const m = h('<div class="menu"></div>');
    const build = (list) => {
      for (const it of list) {
        if (!it) continue;
        if (it.sep) { m.appendChild(h('<div class="menu-sep"></div>')); continue; }
        if (it.header) { m.appendChild(h(`<div class="menu-header">${esc(it.header)}</div>`)); continue; }
        if (it.colors) {
          const row = h('<div class="menu-colors"></div>');
          for (const c of it.colors) {
            const b = h(`<button class="color-dot c-${c.id || 'default'} ${it.current === c.id ? 'on' : ''}" title="${esc(c.name)}"></button>`);
            b.onclick = () => { close(); it.fn(c.id); };
            row.appendChild(b);
          }
          m.appendChild(row); continue;
        }
        const b = h(`<button class="menu-item ${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? I(it.icon, 15) : '<span class="mi-pad"></span>'}<span class="mi-label">${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}${it.sub ? I('chevronRight', 14) : ''}${it.checked ? I('check', 14) : ''}</button>`);
        if (it.sub) {
          b.onmouseenter = b.onclick = () => {
            m.querySelectorAll('.menu.sub').forEach((s) => s.remove());
            const r = b.getBoundingClientRect();
            const sm = A.menu(r.right - 4, r.top - 6, it.sub, { sub: true, parent: close });
            m.appendChild(sm);
          };
        } else b.onclick = () => { (opts.parent || close)(); it.fn && it.fn(); };
        m.appendChild(b);
      }
    };
    build(items);
    if (opts.sub) { m.classList.add('sub'); m.style.position = 'fixed'; }
    (opts.sub ? document.body : document.body).appendChild(m);
    const pw = m.offsetWidth, ph = m.offsetHeight;
    m.style.left = A.clamp(x + pw > innerWidth - 8 && opts.sub ? x - pw - 200 + 8 : x, 8, innerWidth - pw - 8) + 'px';
    m.style.top = A.clamp(y, 8, innerHeight - ph - 8) + 'px';
    if (opts.sub) { m.remove(); return m; }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    const rec = { close: () => close() };
    function close() { m.remove(); window.removeEventListener('keydown', onKey, true); openPops = openPops.filter((x) => x !== rec); }
    openPops.push(rec);
    return m;
  };

  /* ---------- selection operations ---------- */
  const sel = () => [...A.ui.selection].filter((id) => A.state.cards[id]);
  A.sel = sel;
  function detachSnapshot(ids) {
    const snapData = A.collect(ids, false);
    const inSnap = new Set(snapData.cards.map((c) => c.id));
    snapData.cards.forEach((c) => {
      if (c.columnId && !inSnap.has(c.columnId)) { const r = A.cardRect(c.id); delete c.columnId; if (r) { c.x = r.x; c.y = r.y; c.w = Math.round(r.w); } }
    });
    return snapData;
  }
  A.duplicate = function (ids = sel()) {
    if (!ids.length) return;
    A.checkpoint();
    const n = A.instantiate(detachSnapshot(ids), A.ui.boardId, 30, 30);
    A.ui.selection = new Set(n); A.changed();
    A.log(`Duplicated ${n.length} card${n.length > 1 ? 's' : ''}`);
  };
  A.copySel = function (ids = sel()) {
    if (!ids.length) return null;
    const snapData = detachSnapshot(ids);
    const text = ids.map((id) => {
      const c = A.state.cards[id];
      if (c.type === 'note') return A.textOf(c.data.html);
      if (c.type === 'link') return c.data.url;
      if (c.type === 'todo') return (c.data.title ? c.data.title + '\n' : '') + c.data.items.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`).join('\n');
      return A.cardSummary(c);
    }).join('\n\n');
    A.ui.clipboard = { snap: snapData, text, time: A.now() };
    return A.ui.clipboard;
  };
  A.pasteSnap = function (snapData, at) {
    A.checkpoint();
    const tops = snapData.cards.filter((c) => !c.columnId || !snapData.cards.find((x) => x.id === c.columnId)).filter((c) => !snapData.boards.find((b) => b.id === c.boardId));
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    tops.forEach((c) => { x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y); x2 = Math.max(x2, c.x + (c.w || 200)); y2 = Math.max(y2, c.y + 100); });
    const p = at || A.viewCenter();
    const dx = p.x - (x1 + x2) / 2, dy = p.y - (y1 + y2) / 2;
    const n = A.instantiate(snapData, A.ui.boardId, dx, dy);
    A.ui.selection = new Set(n); A.changed();
  };
  A.deleteSel = function () {
    if (A.ui.selectedLine) { A.checkpoint(); delete A.state.lines[A.ui.selectedLine]; A.ui.selectedLine = null; A.changed(); return; }
    const ids = sel(); if (!ids.length) return;
    const locked = ids.filter((id) => A.state.cards[id].locked).length;
    A.checkpoint();
    const n = A.deleteCards(ids);
    if (n) A.toast(`${n} item${n > 1 ? 's' : ''} moved to trash`, { action: 'Undo', fn: A.undo });
    if (locked) A.toast(`${locked} locked card${locked > 1 ? 's were' : ' was'} not deleted`);
    A.changed();
  };
  A.setColor = function (color, ids = sel()) { A.checkpoint(); ids.forEach((id) => (A.state.cards[id].color = color)); A.changed(); };
  A.toggleLock = function (ids = sel()) {
    A.checkpoint(); const lock = !ids.every((id) => A.state.cards[id].locked);
    ids.forEach((id) => (A.state.cards[id].locked = lock)); A.toast(lock ? 'Locked' : 'Unlocked'); A.changed();
  };
  A.bringToFront = function (ids = sel()) { A.checkpoint(); let z = A.nextZ(); ids.sort((a, b) => A.state.cards[a].z - A.state.cards[b].z).forEach((id) => (A.state.cards[id].z = z++)); A.changed(); };
  A.sendToBack = function (ids = sel()) {
    A.checkpoint(); const set = new Set(ids); let z = 1;
    ids.sort((a, b) => A.state.cards[a].z - A.state.cards[b].z).forEach((id) => (A.state.cards[id].z = z++));
    A.cardsOn(A.ui.boardId).filter((c) => !set.has(c.id)).sort((a, b) => a.z - b.z).forEach((c) => (c.z = z++));
    A.changed();
  };
  A.align = function (kind, ids = sel()) {
    ids = ids.filter((id) => !A.state.cards[id].columnId && !A.state.cards[id].locked);
    if (ids.length < 2) return;
    A.checkpoint();
    const rs = ids.map((id) => ({ id, r: A.cardRect(id) })).filter((x) => x.r);
    const x1 = Math.min(...rs.map((x) => x.r.x)), y1 = Math.min(...rs.map((x) => x.r.y));
    const x2 = Math.max(...rs.map((x) => x.r.x + x.r.w)), y2 = Math.max(...rs.map((x) => x.r.y + x.r.h));
    const C = (id) => A.state.cards[id];
    if (kind === 'left') rs.forEach((x) => (C(x.id).x = x1));
    if (kind === 'right') rs.forEach((x) => (C(x.id).x = Math.round(x2 - x.r.w)));
    if (kind === 'centerH') rs.forEach((x) => (C(x.id).x = Math.round((x1 + x2) / 2 - x.r.w / 2)));
    if (kind === 'top') rs.forEach((x) => (C(x.id).y = y1));
    if (kind === 'bottom') rs.forEach((x) => (C(x.id).y = Math.round(y2 - x.r.h)));
    if (kind === 'middle') rs.forEach((x) => (C(x.id).y = Math.round((y1 + y2) / 2 - x.r.h / 2)));
    if (kind === 'distH' && rs.length > 2) {
      rs.sort((a, b) => a.r.x - b.r.x); const tot = rs.reduce((s, x) => s + x.r.w, 0); const gap = (x2 - x1 - tot) / (rs.length - 1); let cx = x1;
      rs.forEach((x) => { C(x.id).x = Math.round(cx); cx += x.r.w + gap; });
    }
    if (kind === 'distV' && rs.length > 2) {
      rs.sort((a, b) => a.r.y - b.r.y); const tot = rs.reduce((s, x) => s + x.r.h, 0); const gap = (y2 - y1 - tot) / (rs.length - 1); let cy = y1;
      rs.forEach((x) => { C(x.id).y = Math.round(cy); cy += x.r.h + gap; });
    }
    if (kind === 'grid') {
      rs.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x); const cols = Math.ceil(Math.sqrt(rs.length)); let cx = x1, cy = y1, rowH = 0;
      rs.forEach((x, i) => { if (i && i % cols === 0) { cx = x1; cy += rowH + 24; rowH = 0; } C(x.id).x = Math.round(cx); C(x.id).y = Math.round(cy); cx += x.r.w + 24; rowH = Math.max(rowH, x.r.h); });
    }
    A.changed();
  };
  A.convertCard = function (id, to) {
    const c = A.state.cards[id]; if (!c) return;
    A.checkpoint();
    const d = c.data;
    let text = c.type === 'todo' ? d.items.map((i) => i.text) : c.type === 'note' ? (() => { const div = document.createElement('div'); div.innerHTML = d.html; const blocks = [...div.querySelectorAll('p,div,li,h1,h2,h3,blockquote')].filter((b) => !b.querySelector('p,div,li')).map((b) => b.textContent.trim()).filter(Boolean); return blocks.length ? blocks : (div.textContent || '').split('\n').filter(Boolean); })() : [A.textOf(d.html)];
    if (to === 'todo') { c.data = { title: c.type === 'document' ? d.title : '', items: (text.length ? text : ['']).map((t) => ({ id: A.uid('t'), text: t.replace(/^☐\s*/, ''), done: false })), hideDone: false }; }
    if (to === 'note') {
      if (c.type === 'todo') c.data = { html: (d.title ? `<h2>${esc(d.title)}</h2>` : '') + '<ul>' + d.items.map((i) => `<li>${i.done ? '<s>' + esc(i.text) + '</s>' : esc(i.text)}</li>`).join('') + '</ul>' };
      else if (c.type === 'document') c.data = { html: (d.title ? `<h1>${esc(d.title)}</h1>` : '') + (d.html || '') };
    }
    if (to === 'document') {
      if (c.type === 'note') c.data = { title: text[0] || '', html: d.html };
      else if (c.type === 'todo') c.data = { title: d.title || 'Checklist', html: '<ul>' + d.items.map((i) => `<li>${esc(i.text)}</li>`).join('') + '</ul>' };
    }
    c.type = to; c.w = A.CardTypes[to].w; A.changed();
  };
  A.sendToUnsorted = function (ids = sel()) { A.checkpoint(); ids.forEach((id) => { const c = A.state.cards[id]; if (c.type === 'board') return; }); A.moveCardsToBoard(ids.filter((id) => A.state.cards[id].type !== 'board'), '__unsorted', { x: 0, y: 0 }); A.changed(); A.renderUnsorted(); A.toast('Sent to Unsorted'); };

  A.selectAll = function () { A.ui.selection = new Set(A.cardsOn(A.ui.boardId).map((c) => c.id)); A.ui.selectedLine = null; A.render(); };

  /* ---------- context menus ---------- */
  A.cardContextMenu = function (e) {
    const ids = sel(); if (!ids.length) return;
    const one = ids.length === 1 ? A.state.cards[ids[0]] : null;
    const cur = one ? one.color : undefined;
    const locked = ids.every((id) => A.state.cards[id].locked);
    const items = [
      one && one.type === 'board' && { label: 'Open board', icon: 'board', fn: () => A.openBoard(one.data.board) },
      one && one.type === 'board' && { label: 'Rename', icon: 'sketch', kbd: 'F2', fn: () => A.renameCard(one.id) },
      one && one.type === 'document' && { label: 'Open document', icon: 'document', fn: () => A.openDocument(one.id) },
      one && one.type === 'sketch' && { label: 'Edit sketch', icon: 'sketch', fn: () => A.openSketch(one.id) },
      one && (one.type === 'image') && { label: 'View full size', icon: 'eye', fn: () => A.CardTypes.image.onDblClick(one) },
      one && one.data && one.data.asset && { label: 'Download', icon: 'download', fn: () => A.downloadAsset(one.data.asset, one.data.name || 'image') },
      one && one.type === 'board' && { sep: true },
      one && one.type !== 'board' && { colors: A.COLORS, current: cur, fn: (c) => A.setColor(c, ids) },
      one && one.type === 'board' && { header: 'Board colour' },
      one && one.type === 'board' && { colors: A.BOARD_COLORS.map((c) => ({ id: c, name: c })), current: (A.state.boards[one.data.board] || {}).color, fn: (c) => { A.checkpoint(); A.state.boards[one.data.board].color = c; A.changed(); } },
      !one && { colors: A.COLORS, fn: (c) => A.setColor(c, ids) },
      { sep: true },
      { label: 'Copy', icon: 'copy', kbd: '⌘C', fn: () => { A.copySel(ids); A.toast('Copied'); } },
      { label: 'Cut', icon: 'copy', kbd: '⌘X', fn: () => { A.copySel(ids); A.deleteSel(); } },
      { label: 'Duplicate', icon: 'copy', kbd: '⌘D', fn: () => A.duplicate(ids) },
      { label: 'Move to board…', icon: 'move', fn: () => A.pickBoard('Move to board', ids, (bid) => { A.checkpoint(); if (A.moveCardsToBoard(ids, bid)) { A.changed(); A.toast('Moved to “' + A.state.boards[bid].title + '”', { action: 'Open', fn: () => A.openBoard(bid) }); } }) },
      { label: 'Copy to board…', icon: 'layers', fn: () => A.pickBoard('Copy to board', [], (bid) => { A.checkpoint(); const s = detachSnapshot(ids); A.instantiate(s, bid, 0, 0); A.changed(); A.toast('Copied to “' + A.state.boards[bid].title + '”'); }) },
      { label: 'Send to Unsorted', icon: 'inbox', fn: () => A.sendToUnsorted(ids) },
      { sep: true },
      one && ['note', 'todo', 'document'].includes(one.type) && { label: 'Turn into', icon: 'convert', sub: ['note', 'todo', 'document'].filter((t) => t !== one.type).map((t) => ({ label: A.CardTypes[t].label, icon: A.CardTypes[t].icon, fn: () => A.convertCard(one.id, t) })) },
      one && { label: 'Add comment', icon: 'comment', fn: () => A.openCommentPopover(one) },
      one && { label: 'Copy link to card', icon: 'link', fn: () => { const u = location.href.split('#')[0] + '#/b/' + A.ui.boardId + '?card=' + one.id; navigator.clipboard && navigator.clipboard.writeText(u); A.toast('Link copied'); } },
      { label: locked ? 'Unlock' : 'Lock', icon: locked ? 'unlock' : 'lock', kbd: '⇧⌘L', fn: () => A.toggleLock(ids) },
      { label: 'Bring to front', icon: 'bringFront', kbd: '⌘]', fn: () => A.bringToFront(ids) },
      { label: 'Send to back', icon: 'sendBack', kbd: '⌘[', fn: () => A.sendToBack(ids) },
      ids.length > 1 && { label: 'Arrange', icon: 'alignLeft', sub: alignItems(ids) },
      { sep: true },
      { label: 'Delete', icon: 'trash', kbd: '⌫', danger: true, fn: () => A.deleteSel() },
    ];
    A.menu(e.clientX, e.clientY, items);
  };
  function alignItems(ids) {
    return [
      { label: 'Align left', icon: 'alignLeft', fn: () => A.align('left', ids) }, { label: 'Align center', icon: 'alignCenterH', fn: () => A.align('centerH', ids) },
      { label: 'Align right', icon: 'alignRight', fn: () => A.align('right', ids) }, { label: 'Align top', icon: 'alignTop', fn: () => A.align('top', ids) },
      { label: 'Align middle', icon: 'alignMiddle', fn: () => A.align('middle', ids) }, { label: 'Align bottom', icon: 'alignBottom', fn: () => A.align('bottom', ids) },
      { label: 'Distribute horizontally', icon: 'distributeH', fn: () => A.align('distH', ids) }, { label: 'Distribute vertically', icon: 'distributeV', fn: () => A.align('distV', ids) },
      { label: 'Tidy into grid', icon: 'grid', fn: () => A.align('grid', ids) },
    ];
  }
  A.canvasContextMenu = function (e, p) {
    const add = (t) => ({ label: A.CardTypes[t].label, icon: A.CardTypes[t].icon, fn: () => A.addTool(t, { x: p.x + A.CardTypes[t].w / 2, y: p.y + 30 }) });
    A.menu(e.clientX, e.clientY, [
      { label: 'Add here', icon: 'plus', sub: ['note', 'todo', 'link', 'board', 'column', 'comment', 'table', 'document', 'sketch', 'swatch', 'map', 'audio'].map(add) },
      { label: 'Paste', icon: 'copy', kbd: '⌘V', disabled: !A.ui.clipboard, fn: () => A.ui.clipboard && A.pasteSnap(A.ui.clipboard.snap, p) },
      { label: 'Upload files…', icon: 'upload', fn: () => A.pickFiles('*/*', true, (f) => A.importFiles(f, p)) },
      { label: 'Use a template…', icon: 'template', fn: () => A.openTemplates() },
      { sep: true },
      { label: 'Select all', icon: 'pointer', kbd: '⌘A', fn: () => A.selectAll() },
      { label: 'Fit to screen', icon: 'fit', kbd: '⇧1', fn: () => A.fitToContent() },
      { label: 'Zoom to 100%', icon: 'search', kbd: '⌘0', fn: () => A.zoomReset() },
      { sep: true },
      { label: 'Snap to grid', icon: 'grid', checked: A.state.settings.snap, fn: () => { A.state.settings.snap = !A.state.settings.snap; A.save(); } },
      { label: 'Show dot grid', icon: 'grid', checked: A.state.settings.grid, fn: () => { A.state.settings.grid = !A.state.settings.grid; A.applySettings(); A.save(); } },
    ]);
  };
  A.lineContextMenu = function (e) {
    const l = A.state.lines[A.ui.selectedLine]; if (!l) return;
    const upd = (fn) => () => { A.checkpoint(); fn(); A.changed(); };
    A.menu(e.clientX, e.clientY, [
      { label: l.label ? 'Edit label' : 'Add label', icon: 'tag', fn: () => A.editLineLabel(l.id) },
      { label: 'Arrow at start', checked: l.arrowStart, icon: 'back', fn: upd(() => (l.arrowStart = !l.arrowStart)) },
      { label: 'Arrow at end', checked: l.arrowEnd, icon: 'line', fn: upd(() => (l.arrowEnd = !l.arrowEnd)) },
      { label: 'Style', icon: 'line', sub: ['solid', 'dashed', 'dotted'].map((s) => ({ label: s[0].toUpperCase() + s.slice(1), checked: l.style === s, fn: upd(() => (l.style = s)) })) },
      { label: 'Straighten', icon: 'minus', fn: upd(() => (l.bend = { x: 0, y: 0 })) },
      { label: 'Reverse direction', icon: 'convert', fn: upd(() => { const f = l.from; l.from = l.to; l.to = f; l.bend = { x: -l.bend.x, y: -l.bend.y }; }) },
      { sep: true },
      { label: 'Delete line', icon: 'trash', danger: true, fn: () => A.deleteSel() },
    ]);
  };
  A.renameCard = function (id) {
    const el = A.cardEls.get(id); if (!el) return;
    const f = el.querySelector('[data-field="boardTitle"], [data-field="title"], [data-field="name"]');
    if (f) { A.beginEdit(f, id); document.execCommand('selectAll'); }
  };

  /* ---------- selection bar ---------- */
  let selBar;
  function buildSelBar() {
    selBar = h(`<div class="selbar" hidden>
      <button data-sb="color" title="Colour"><span class="color-dot c-default"></span></button>
      <span class="sb-sep"></span>
      <button data-sb="comment" title="Comment">${I('comment', 16)}</button>
      <button data-sb="dup" title="Duplicate (⌘D)">${I('copy', 16)}</button>
      <button data-sb="lock" title="Lock (⇧⌘L)">${I('lock', 16)}</button>
      <button data-sb="align" title="Arrange">${I('alignLeft', 16)}</button>
      <button data-sb="front" title="Bring to front">${I('bringFront', 16)}</button>
      <button data-sb="move" title="Move to board">${I('move', 16)}</button>
      <span class="sb-sep"></span>
      <button data-sb="del" title="Delete (⌫)">${I('trash', 16)}</button>
      <button data-sb="more" title="More">${I('more', 16)}</button></div>`);
    document.body.appendChild(selBar);
    selBar.addEventListener('pointerdown', (e) => e.stopPropagation());
    selBar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sb]'); if (!b) return;
      const ids = sel();
      switch (b.dataset.sb) {
        case 'color': {
          const one = ids.length === 1 ? A.state.cards[ids[0]] : null;
          if (one && one.type === 'board') { A.menu(b.getBoundingClientRect().left, b.getBoundingClientRect().bottom + 6, [{ colors: A.BOARD_COLORS.map((c) => ({ id: c, name: c })), current: A.state.boards[one.data.board].color, fn: (c) => { A.checkpoint(); A.state.boards[one.data.board].color = c; A.changed(); } }]); break; }
          A.menu(b.getBoundingClientRect().left, b.getBoundingClientRect().bottom + 6, [{ colors: A.COLORS, current: one ? one.color : undefined, fn: (c) => A.setColor(c, ids) }]); break;
        }
        case 'comment': if (ids.length === 1) A.openCommentPopover(A.state.cards[ids[0]], b); break;
        case 'dup': A.duplicate(ids); break;
        case 'lock': A.toggleLock(ids); break;
        case 'align': { const r = b.getBoundingClientRect(); A.menu(r.left, r.bottom + 6, alignItems(ids)); break; }
        case 'front': A.bringToFront(ids); break;
        case 'move': A.pickBoard('Move to board', ids, (bid) => { A.checkpoint(); if (A.moveCardsToBoard(ids, bid)) { A.changed(); A.toast('Moved to “' + A.state.boards[bid].title + '”', { action: 'Open', fn: () => A.openBoard(bid) }); } }); break;
        case 'del': A.deleteSel(); break;
        case 'more': A.cardContextMenu({ clientX: b.getBoundingClientRect().left, clientY: b.getBoundingClientRect().bottom + 6 }); break;
      }
    });
  }
  A.hideSelBar = () => { if (selBar) selBar.hidden = true; };
  A.updateSelBar = function () {
    if (!selBar) return;
    const ids = sel().filter((id) => A.cardEls.get(id));
    if (!ids.length || A.ui.editing || document.body.classList.contains('is-dragging') || document.body.classList.contains('is-resizing')) return (selBar.hidden = true);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const id of ids) { const r = A.cardEls.get(id).getBoundingClientRect(); x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom); }
    const one = ids.length === 1 ? A.state.cards[ids[0]] : null;
    const dot = selBar.querySelector('.color-dot');
    dot.className = 'color-dot ' + (one && one.type === 'board' ? 'bc-' + (A.state.boards[one.data.board] || {}).color : 'c-' + ((one && one.color) || 'default'));
    selBar.querySelector('[data-sb=comment]').hidden = !one;
    selBar.querySelector('[data-sb=align]').hidden = ids.length < 2;
    const locked = ids.every((id) => A.state.cards[id].locked);
    selBar.querySelector('[data-sb=lock]').innerHTML = I(locked ? 'unlock' : 'lock', 16);
    selBar.querySelector('[data-sb=lock]').classList.toggle('on', locked);
    selBar.hidden = false;
    const vr = document.getElementById('viewport').getBoundingClientRect();
    const bw = selBar.offsetWidth, bh = selBar.offsetHeight;
    let x = (x1 + x2) / 2 - bw / 2, y = y1 - bh - 12;
    if (y < vr.top + 8) y = Math.min(y2 + 12, vr.bottom - bh - 8);
    if (y2 < vr.top || y1 > vr.bottom || x2 < vr.left || x1 > vr.right) return (selBar.hidden = true);
    selBar.style.left = A.clamp(x, vr.left + 8, vr.right - bw - 8) + 'px';
    selBar.style.top = A.clamp(y, vr.top + 8, vr.bottom - bh - 8) + 'px';
  };

  /* ---------- line bar ---------- */
  let lineBar;
  const LINE_COLORS = [null, '#f0544f', '#ff8a3d', '#e5b412', '#45b85a', '#22b3a6', '#4c8dff', '#8e6bf0', '#ec5ca6'];
  function buildLineBar() {
    lineBar = h('<div class="linebar" hidden></div>');
    document.body.appendChild(lineBar);
    lineBar.addEventListener('pointerdown', (e) => e.stopPropagation());
    lineBar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lb]'); if (!b) return;
      const l = A.state.lines[A.ui.selectedLine]; if (!l) return;
      const v = b.dataset.v;
      if (b.dataset.lb === 'label') return A.editLineLabel(l.id);
      if (b.dataset.lb === 'del') return A.deleteSel();
      A.checkpoint();
      switch (b.dataset.lb) {
        case 'color': l.color = v === 'null' ? null : v; break;
        case 'style': l.style = { solid: 'dashed', dashed: 'dotted', dotted: 'solid' }[l.style || 'solid']; break;
        case 'width': l.width = { 1: 2, 2: 4, 4: 6, 6: 1 }[l.width || 2] || 2; break;
        case 'as': l.arrowStart = !l.arrowStart; break;
        case 'ae': l.arrowEnd = !l.arrowEnd; break;
      }
      A.changed();
    });
  }
  A.updateLineBar = function () {
    if (!lineBar) return;
    const l = A.ui.selectedLine && A.state.lines[A.ui.selectedLine];
    if (!l || l.boardId !== A.ui.boardId || A._labelEditing) return (lineBar.hidden = true);
    const g = A.lineGeom(l); if (!g) return (lineBar.hidden = true);
    lineBar.innerHTML = `${LINE_COLORS.map((c) => `<button data-lb="color" data-v="${c}" class="lc ${l.color === c ? 'on' : ''}" style="--c:${c || 'var(--line)'}"></button>`).join('')}
      <span class="sb-sep"></span>
      <button data-lb="style" title="Line style" class="txt">${{ solid: '━', dashed: '╍', dotted: '┉' }[l.style || 'solid']}</button>
      <button data-lb="width" title="Thickness" class="txt">${l.width || 2}px</button>
      <button data-lb="as" title="Start arrow" class="${l.arrowStart ? 'on' : ''}">${I('back', 15)}</button>
      <button data-lb="ae" title="End arrow" class="${l.arrowEnd ? 'on' : ''}" style="transform:scaleX(-1)">${I('back', 15)}</button>
      <button data-lb="label" title="Label">${I('tag', 15)}</button>
      <span class="sb-sep"></span>
      <button data-lb="del" title="Delete line">${I('trash', 15)}</button>`;
    lineBar.hidden = false;
    const s = A.toScreen(g.h.x, g.h.y);
    const vr = document.getElementById('viewport').getBoundingClientRect();
    const bw = lineBar.offsetWidth;
    lineBar.style.left = A.clamp(s.x - bw / 2, vr.left + 8, vr.right - bw - 8) + 'px';
    lineBar.style.top = A.clamp(s.y - 64, vr.top + 8, vr.bottom - 50) + 'px';
  };

  /* ---------- format bar (rich text) ---------- */
  let fmtBar, savedRange = null;
  const FMT = [
    ['bold', '<b>B</b>', 'Bold (⌘B)'], ['italic', '<i>I</i>', 'Italic (⌘I)'], ['underline', '<u>U</u>', 'Underline (⌘U)'], ['strike', '<s>S</s>', 'Strikethrough'], ['|'],
    ['h1', 'H1', 'Large heading'], ['h2', 'H2', 'Small heading'], ['|'],
    ['ul', '•', 'Bulleted list'], ['ol', '1.', 'Numbered list'], ['quote', '❝', 'Quote'], ['code', '&lt;/&gt;', 'Code block'], ['|'],
    ['link', null, 'Link (⌘K)'], ['color', null, 'Text colour'], ['hilite', null, 'Highlight'], ['center', '≡', 'Align center'], ['clear', '⌫', 'Clear formatting'],
  ];
  A.fmtButtonsHTML = () => FMT.map(([c, label, t]) => c === '|' ? '<span class="sb-sep"></span>' : `<button data-fmt="${c}" title="${t}">${label || (c === 'link' ? I('link', 14) : c === 'color' ? '<span class="fc-a">A</span>' : '<span class="fc-h">A</span>')}</button>`).join('');
  function buildFormatBar() {
    fmtBar = h(`<div class="formatbar" hidden>${A.fmtButtonsHTML()}</div>`);
    document.body.appendChild(fmtBar);
    A.bindFormatButtons(fmtBar);
  }
  A.bindFormatButtons = function (bar) {
    bar.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-fmt]'); if (b) A.formatCmd(b.dataset.fmt, null, b); });
    document.addEventListener('selectionchange', () => { if (bar.offsetParent) updateFmtState(bar); });
  };
  function updateFmtState(bar) {
    const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
    const block = (() => { try { return (document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch (e) { return ''; } })();
    const st = { bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'), ul: q('insertUnorderedList'), ol: q('insertOrderedList'), h1: block === 'h1', h2: block === 'h2', quote: block === 'blockquote', code: block === 'pre', center: q('justifyCenter') };
    bar.querySelectorAll('[data-fmt]').forEach((b) => b.classList.toggle('on', !!st[b.dataset.fmt]));
  }
  A.showFormatBar = function (el) {
    fmtBar.hidden = false;
    const place = () => {
      if (fmtBar.hidden) return;
      const card = el.closest('.card'); const r = (card || el).getBoundingClientRect();
      const bw = fmtBar.offsetWidth, bh = fmtBar.offsetHeight;
      let y = r.top - bh - 10; if (y < 60) y = r.bottom + 10;
      fmtBar.style.left = A.clamp(r.left + r.width / 2 - bw / 2, 8, innerWidth - bw - 8) + 'px';
      fmtBar.style.top = A.clamp(y, 8, innerHeight - bh - 8) + 'px';
    };
    place(); updateFmtState(fmtBar);
    fmtBar._place = place;
  };
  A.hideFormatBar = function () { if (fmtBar) fmtBar.hidden = true; };
  A.formatCmd = function (cmd, val, btn) {
    document.execCommand('styleWithCSS', false, cmd === 'color' || cmd === 'hilite');
    const block = (() => { try { return (document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch (e) { return ''; } })();
    const toggle = (tag) => document.execCommand('formatBlock', false, block === tag ? '<div>' : '<' + tag + '>');
    const sel = window.getSelection();
    switch (cmd) {
      case 'bold': case 'italic': case 'underline': document.execCommand(cmd); break;
      case 'strike': document.execCommand('strikeThrough'); break;
      case 'h1': toggle('h1'); break; case 'h2': toggle('h2'); break;
      case 'quote': toggle('blockquote'); break; case 'code': toggle('pre'); break;
      case 'ul': document.execCommand('insertUnorderedList'); break;
      case 'ol': document.execCommand('insertOrderedList'); break;
      case 'center': document.execCommand(document.queryCommandState('justifyCenter') ? 'justifyLeft' : 'justifyCenter'); break;
      case 'clear': document.execCommand('removeFormat'); document.execCommand('formatBlock', false, '<div>'); break;
      case 'link': {
        savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const anchor = btn || fmtBar.querySelector('[data-fmt=link]');
        const wrap = h(`<div class="pop-form"><label class="small muted">Link address</label><input type="url" placeholder="https://"><div class="row"><button class="btn small" data-x="rm">Remove</button><button class="btn small primary" data-x="ok">Apply</button></div></div>`);
        const inp = wrap.querySelector('input');
        const restore = () => { const ed = A.ui.editing ? A.ui.editing.el : document.querySelector('.doc-editor-body'); if (ed) ed.focus({ preventScroll: true }); if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); } };
        const close = A.popover(anchor, wrap, { keep: true });
        const apply = () => { restore(); const u = A.normalizeUrl(inp.value); if (u) { if (sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(inp.value)}</a>`); else document.execCommand('createLink', false, u); } close(); A.ui.editing && A.commitEdit(); };
        wrap.querySelector('[data-x=ok]').onclick = apply;
        wrap.querySelector('[data-x=rm]').onclick = () => { restore(); document.execCommand('unlink'); close(); A.ui.editing && A.commitEdit(); };
        inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') apply(); if (e.key === 'Escape') { close(); restore(); } };
        wrap.addEventListener('mousedown', (e) => e.stopPropagation());
        setTimeout(() => inp.focus(), 20);
        return;
      }
      case 'color': case 'hilite': {
        savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const cols = cmd === 'color' ? ['inherit', '#e03e3e', '#d9730d', '#c29a00', '#0f7b6c', '#0b6bcb', '#6940a5', '#ad1a72', '#787774'] : ['transparent', '#ffe58f', '#ffd6cc', '#d3f5d0', '#cfe8ff', '#eadcff', '#ffd6ea'];
        const wrap = h(`<div class="pop-colors">${cols.map((c) => `<button style="--c:${c}" data-c="${c}" class="${cmd}"></button>`).join('')}</div>`);
        const close = A.popover(btn || fmtBar, wrap, { keep: true });
        wrap.addEventListener('mousedown', (e) => e.preventDefault());
        wrap.onclick = (e) => {
          const b = e.target.closest('[data-c]'); if (!b) return;
          if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); }
          document.execCommand('styleWithCSS', false, true);
          if (cmd === 'color') document.execCommand('foreColor', false, b.dataset.c === 'inherit' ? (document.documentElement.classList.contains('dark') ? '#e6e6e6' : '#2b2b2b') : b.dataset.c);
          else document.execCommand('hiliteColor', false, b.dataset.c);
          close(); A.ui.editing && A.commitEdit();
        };
        return;
      }
    }
    A.ui.editing && A.commitEdit();
    updateFmtState(fmtBar);
  };

  /* ---------- modal ---------- */
  A.modal = function ({ title, body, wide, cls, onClose, footer }) {
    const m = h(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''} ${cls || ''}" role="dialog" aria-label="${esc(title || '')}">
      ${title ? `<div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close>${I('x', 18)}</button></div>` : ''}
      <div class="modal-body"></div>${footer ? '<div class="modal-foot"></div>' : ''}</div></div>`);
    const b = m.querySelector('.modal-body');
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
    if (footer) { const f = m.querySelector('.modal-foot'); if (typeof footer === 'string') f.innerHTML = footer; else f.appendChild(footer); }
    document.body.appendChild(m);
    A.endEdit(); A.closeMenus();
    const onKey = (e) => { if (e.key === 'Escape' && document.querySelector('.modal-back:last-of-type') === m) { e.stopPropagation(); e.preventDefault(); close(); } };
    function close() { m.remove(); window.removeEventListener('keydown', onKey, true); onClose && onClose(); }
    m.addEventListener('pointerdown', (e) => { if (e.target === m) close(); });
    m.querySelectorAll('[data-close]').forEach((x) => (x.onclick = close));
    window.addEventListener('keydown', onKey, true);
    m.close = close;
    requestAnimationFrame(() => m.classList.add('in'));
    return m;
  };
  A.confirm = function (msg, okLabel = 'OK', danger = false) {
    return new Promise((res) => {
      let done = false;
      const m = A.modal({ title: 'Are you sure?', body: `<p>${esc(msg)}</p>`, footer: `<button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button>`, onClose: () => { if (!done) res(false); } });
      m.querySelector('[data-no]').onclick = () => m.close();
      m.querySelector('[data-yes]').onclick = () => { done = true; res(true); m.close(); };
      setTimeout(() => m.querySelector('[data-yes]').focus(), 30);
    });
  };

  /* ---------- board picker ---------- */
  A.pickBoard = function (title, movingIds, cb) {
    const blocked = new Set();
    movingIds.forEach((id) => { const c = A.state.cards[id]; if (c && c.type === 'board') Object.keys(A.state.boards).forEach((b) => { if (A.isDescendant(b, c.data.board)) blocked.add(b); }); });
    const body = h(`<div><input class="input" placeholder="Filter boards…" autofocus><div class="board-pick-list"></div></div>`);
    const list = body.querySelector('.board-pick-list'); const inp = body.querySelector('input');
    const render = () => {
      const q = inp.value.toLowerCase();
      const rows = [];
      const walk = (bid, depth) => {
        const b = A.state.boards[bid]; if (!b) return;
        if (!q || b.title.toLowerCase().includes(q)) rows.push({ b, depth });
        Object.values(A.state.boards).filter((x) => x.parentId === bid).sort((a, c) => a.title.localeCompare(c.title)).forEach((x) => walk(x.id, depth + 1));
      };
      walk(A.state.rootId, 0);
      list.innerHTML = rows.map(({ b, depth }) => `<button class="pick-row" data-b="${b.id}" ${blocked.has(b.id) || b.id === A.ui.boardId ? 'disabled' : ''} style="padding-left:${12 + (q ? 0 : depth * 18)}px">${b.icon ? esc(b.icon) : `<span class="crumb-dot" style="background:${A.BOARD_HEX[b.color]}"></span>`} ${esc(b.title)}${b.id === A.ui.boardId ? ' <span class="muted small">(current)</span>' : ''}</button>`).join('');
    };
    inp.oninput = render; render();
    const m = A.modal({ title, body });
    list.onclick = (e) => { const r = e.target.closest('[data-b]'); if (r && !r.disabled) { m.close(); cb(r.dataset.b); } };
    setTimeout(() => inp.focus(), 30);
  };

  /* ---------- comments popover ---------- */
  let cmtPop = null;
  A.openCommentPopover = function (c, anchor) {
    anchor = anchor || A.cardEls.get(c.id);
    const wrap = h('<div class="cmt-pop"></div>');
    const render = () => { wrap.innerHTML = `<div class="cmt-pop-head">${I('comment', 14)} Comments <span class="muted small">on ${esc(A.cardSummary(c))}</span></div>` + A.commentsHTML(c, true); A.bindCommentInput(c, wrap); setTimeout(() => { const t = wrap.querySelector('textarea'); t && t.focus(); }, 20); };
    render();
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-act="cmt-del"]'); if (b) { A.checkpoint(); c.comments = c.comments.filter((m) => m.id !== b.dataset.cmt); A.changed(); render(); } });
    const close = A.popover(anchor, wrap, { onClose: () => (cmtPop = null) });
    cmtPop = { render, close, wrap };
  };
  A.renderCommentPopover = () => cmtPop && cmtPop.render();
  A.commonActions = {
    'open-comments'(c, t) { A.openCommentPopover(c, t); },
    'cmt-del'(c, t) { A.checkpoint(); c.comments = c.comments.filter((m) => m.id !== t.dataset.cmt); A.changed(); },
  };

  /* ---------- side panels ---------- */
  A.panelOpen = null;
  A.togglePanel = function (name) {
    const p = $('#side-panel');
    if (A.panelOpen === name) { A.panelOpen = null; p.classList.remove('open'); document.body.classList.remove('panel-' + name); return; }
    if (A.panelOpen) document.body.classList.remove('panel-' + A.panelOpen);
    A.panelOpen = name; p.className = 'side-panel open ' + (name === 'trash' || name === 'activity' ? 'right' : 'left');
    document.body.classList.add('panel-' + name);
    ({ unsorted: A.renderUnsorted, trash: A.renderTrash, activity: A.renderActivity, nav: A.renderNav })[name]();
  };
  function panelShell(title, inner) {
    const p = $('#side-panel');
    p.innerHTML = `<div class="panel-head"><h3>${esc(title)}</h3><button class="icon-btn" data-pclose>${I('x', 16)}</button></div><div class="panel-body">${inner}</div>`;
    p.querySelector('[data-pclose]').onclick = () => A.togglePanel(A.panelOpen);
    return p;
  }
  A.renderUnsorted = function () {
    if (A.panelOpen !== 'unsorted') { A.updateChrome(); return; }
    const items = A.cardsOn('__unsorted').sort((a, b) => b.created - a.created);
    const p = panelShell('Unsorted', `
      <p class="muted small">Quick notes land here. Drag them onto any board when you're ready.</p>
      <div class="quick-add"><textarea placeholder="Jot something down… (Enter to save)" rows="2"></textarea></div>
      <div class="unsorted-list">${items.map((c) => `<div class="mini-card" draggable="true" data-cid="${c.id}"><span class="mc-icon">${I(A.CardTypes[c.type].icon, 14)}</span><span class="mc-text">${esc(A.cardSummary(c))}</span><button class="mini" data-udel="${c.id}" title="Delete">${I('x', 12)}</button></div>`).join('') || '<div class="empty-small">Nothing here yet</div>'}</div>`);
    const ta = p.querySelector('textarea');
    ta.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && ta.value.trim()) {
        e.preventDefault(); A.checkpoint();
        const v = ta.value.trim();
        if (A.isUrl(v)) A.createCard('link', 0, 0, { url: A.normalizeUrl(v) }, { boardId: '__unsorted' });
        else A.createCard('note', 0, 0, { html: '<p>' + A.linkify(v).replace(/\n/g, '<br>') + '</p>' }, { boardId: '__unsorted' });
        A.save(); A.renderUnsorted(); setTimeout(() => p.querySelector('textarea').focus(), 0);
      }
    };
    ta.onpaste = (e) => e.stopPropagation();
    p.querySelectorAll('[data-cid]').forEach((el) => el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-card', el.dataset.cid); e.dataTransfer.effectAllowed = 'move'; }));
    p.querySelectorAll('[data-udel]').forEach((b) => (b.onclick = () => { A.checkpoint(); A.deleteCards([b.dataset.udel]); A.save(); A.renderUnsorted(); }));
    p.querySelectorAll('[data-cid]').forEach((el) => (el.ondblclick = () => { A.checkpoint(); const c = A.state.cards[el.dataset.cid]; const pt = A.spawnPoint(c.w); A.moveCardsToBoard([c.id], A.ui.boardId, pt); A.ui.selection = new Set([c.id]); A.changed(); A.renderUnsorted(); }));
    A.updateChrome();
  };
  A.renderTrash = function () {
    const t = A.state.trash;
    const p = panelShell('Trash', `
      ${t.length ? `<div class="row between"><span class="muted small">${t.length} item${t.length > 1 ? 's' : ''}</span><button class="btn small danger" data-empty>Empty trash</button></div>` : ''}
      <div class="trash-list">${t.map((x) => `<div class="trash-row"><div class="tr-main"><div class="tr-title">${esc(x.title)}</div>
        <div class="muted small">${A.fmtTime(x.time)} · from ${esc((A.state.boards[x.boardId] || { title: x.boardId === '__unsorted' ? 'Unsorted' : 'a deleted board' }).title)}${x.boards.length ? ` · ${x.boards.length} board${x.boards.length > 1 ? 's' : ''}` : ''}</div></div>
        <button class="btn small" data-restore="${x.id}">Restore</button><button class="icon-btn" data-perm="${x.id}" title="Delete forever">${I('x', 14)}</button></div>`).join('') || `<div class="empty-small">${I('trash', 24)}<br>Trash is empty.<br><span class="muted small">Tip: drag cards onto the trash icon to delete them.</span></div>`}</div>`);
    p.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = () => { A.checkpoint(); A.restoreTrash(b.dataset.restore); A.changed(); A.renderTrash(); A.toast('Restored'); }));
    p.querySelectorAll('[data-perm]').forEach((b) => (b.onclick = async () => { if (!(await A.confirm('This item will be deleted forever.', 'Delete forever', true))) return; A.state.trash = A.state.trash.filter((x) => x.id !== b.dataset.perm); A.gcAssets(); A.save(); A.renderTrash(); }));
    const em = p.querySelector('[data-empty]'); if (em) em.onclick = async () => { if (!(await A.confirm('Permanently delete everything in the trash?', 'Empty trash', true))) return; A.state.trash = []; A.gcAssets(); A.save(); A.renderTrash(); };
  };
  A.renderActivity = function () {
    const acts = A.state.activity;
    const p = panelShell('Activity', `
      ${acts.length ? '<div class="row between"><span class="muted small">Recent changes</span><button class="btn small" data-read>Mark all read</button></div>' : ''}
      <div class="activity-list">${acts.slice(0, 120).map((a) => `<button class="act-row ${a.unread ? 'unread' : ''}" data-ab="${a.boardId}"><div class="avatar sm">${esc(A.initials(a.user))}</div><div><div>${esc(a.text)}</div><div class="muted small">${A.fmtTime(a.time)} · ${esc((A.state.boards[a.boardId] || { title: '—' }).title)}</div></div></button>`).join('') || '<div class="empty-small">No activity yet</div>'}</div>`);
    p.querySelectorAll('[data-ab]').forEach((b) => (b.onclick = () => { if (A.state.boards[b.dataset.ab]) A.openBoard(b.dataset.ab); }));
    const r = p.querySelector('[data-read]'); if (r) r.onclick = () => { acts.forEach((a) => (a.unread = false)); A.save(); A.renderActivity(); A.updateActivityBadge(); };
    setTimeout(() => { acts.forEach((a) => (a.unread = false)); A.updateActivityBadge(); A.save(); }, 1500);
  };
  A.renderNav = function () {
    const S = A.state;
    const expanded = (A._navOpen = A._navOpen || new Set(A.boardPath(A.ui.boardId).map((b) => b.id)));
    const kids = (bid) => Object.values(S.boards).filter((b) => b.parentId === bid).sort((a, b) => a.title.localeCompare(b.title));
    const row = (b, depth) => {
      const k = kids(b.id); const open = expanded.has(b.id);
      return `<div class="tree-row ${b.id === A.ui.boardId ? 'current' : ''}" style="padding-left:${6 + depth * 14}px">
        <button class="tree-tog ${k.length ? '' : 'none'}" data-tog="${b.id}">${k.length ? I(open ? 'chevronDown' : 'chevronRight', 13) : ''}</button>
        <button class="tree-name" data-open="${b.id}">${b.icon ? `<span>${esc(b.icon)}</span>` : `<span class="crumb-dot" style="background:${A.BOARD_HEX[b.color]}"></span>`}<span class="tn">${esc(b.title)}</span><span class="muted small">${A.cardsOn(b.id).length}</span></button></div>
        ${open ? k.map((x) => row(x, depth + 1)).join('') : ''}`;
    };
    const starred = S.starred.filter((id) => S.boards[id]);
    const recent = Object.values(S.boards).filter((b) => b.lastOpened).sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 5);
    const p = panelShell('Boards', `
      ${starred.length ? `<div class="nav-section">Starred</div>${starred.map((id) => `<button class="nav-link" data-open="${id}">${I('star', 13)} ${esc(S.boards[id].title)}</button>`).join('')}` : ''}
      ${recent.length ? `<div class="nav-section">Recent</div>${recent.map((b) => `<button class="nav-link" data-open="${b.id}">${I('clock', 13)} ${esc(b.title)}</button>`).join('')}` : ''}
      <div class="nav-section">All boards</div><div class="tree">${row(S.boards[S.rootId], 0)}</div>
      <button class="btn small wide-btn" data-newb>${I('plus', 13)} New board here</button>`);
    p.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => A.openBoard(b.dataset.open)));
    p.querySelectorAll('[data-tog]').forEach((b) => (b.onclick = () => { const id = b.dataset.tog; if (expanded.has(id)) expanded.delete(id); else expanded.add(id); A.renderNav(); }));
    p.querySelector('[data-newb]').onclick = () => A.addTool('board');
  };

  /* ---------- board settings ---------- */
  const EMOJI = ['', '📁', '📝', '💡', '🎯', '🚀', '🎨', '📸', '🎬', '🎵', '📚', '✈️', '🏠', '💼', '📊', '🧠', '❤️', '⭐', '🔥', '🌱', '🍕', '🛍️', '🧩', '🗺️', '🎮', '⚙️', '🧪', '📅', '✅', '💬', '🏋️', '🎓', '🐾', '🌈', '☕', '🎁', '📦', '🔒', '🌍', '🪴'];
  A.boardSettings = function (anchor, bid = A.ui.boardId) {
    const b = A.state.boards[bid]; if (!b) return;
    const isRoot = bid === A.state.rootId;
    const wrap = h(`<div class="board-settings">
      <label class="small muted">Board name</label><input class="input" value="${esc(b.title)}">
      <label class="small muted">Icon</label><div class="emoji-grid">${EMOJI.map((e) => `<button data-emoji="${e}" class="${b.icon === e ? 'on' : ''}">${e || I('board', 14)}</button>`).join('')}</div>
      <label class="small muted">Colour</label><div class="menu-colors">${A.BOARD_COLORS.map((c) => `<button class="color-dot bc-${c} ${b.color === c ? 'on' : ''}" data-bcol="${c}"></button>`).join('')}</div>
      <div class="menu-sep"></div>
      <button class="menu-item" data-x="dup">${I('copy', 15)}<span class="mi-label">Duplicate board</span></button>
      <button class="menu-item" data-x="share">${I('share', 15)}<span class="mi-label">Share…</span></button>
      <button class="menu-item" data-x="export">${I('download', 15)}<span class="mi-label">Export…</span></button>
      ${isRoot ? '' : `<button class="menu-item danger" data-x="del">${I('trash', 15)}<span class="mi-label">Delete board</span></button>`}</div>`);
    const inp = wrap.querySelector('input');
    let cp = false; const ck = () => { if (!cp) { A.checkpoint(); cp = true; } };
    inp.oninput = () => { ck(); b.title = inp.value || 'Untitled board'; A.changed(); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') close(); };
    wrap.querySelectorAll('[data-emoji]').forEach((x) => (x.onclick = () => { ck(); b.icon = x.dataset.emoji; wrap.querySelectorAll('[data-emoji]').forEach((y) => y.classList.toggle('on', y === x)); A.changed(); }));
    wrap.querySelectorAll('[data-bcol]').forEach((x) => (x.onclick = () => { ck(); b.color = x.dataset.bcol; wrap.querySelectorAll('[data-bcol]').forEach((y) => y.classList.toggle('on', y === x)); A.changed(); }));
    wrap.querySelector('[data-x=dup]').onclick = () => {
      close(); A.checkpoint();
      const card = A.boardCardFor(bid);
      if (card) { A.openBoard(card.boardId); A.duplicate([card.id]); }
      else { const nb = A.createBoard(b.title + ' copy', bid); A.instantiate(A.collect(A.cardsOn(bid).map((c) => c.id), false), nb.id, 0, 0); A.createCard('board', 80, 80, {}, {}).data.board = nb.id; A.changed(); }
      A.toast('Board duplicated');
    };
    wrap.querySelector('[data-x=share]').onclick = () => { close(); A.openShare(); };
    wrap.querySelector('[data-x=export]').onclick = (e) => { close(); A.exportMenu(anchor); };
    const del = wrap.querySelector('[data-x=del]');
    if (del) del.onclick = async () => {
      close();
      if (!(await A.confirm(`Move “${b.title}” and everything inside it to the trash?`, 'Delete board', true))) return;
      const card = A.boardCardFor(bid); const parent = b.parentId;
      A.checkpoint();
      if (card) { A.openBoard(card.boardId); A.deleteCards([card.id], { force: true }); }
      else { delete A.state.boards[bid]; A.openBoard(parent); }
      A.changed(); A.toast('Board moved to trash', { action: 'Undo', fn: A.undo });
    };
    const close = A.popover(anchor, wrap);
    setTimeout(() => inp.select(), 30);
  };

  /* ---------- search ---------- */
  A.openSearch = function () {
    const body = h(`<div class="search"><div class="search-box">${I('search', 18)}<input placeholder="Search all boards, notes, tasks, links…" autofocus></div>
      <div class="search-filters">${['all', 'board', 'note', 'todo', 'link', 'document', 'image', 'file', 'comment'].map((f, i) => `<button data-f="${f}" class="${i === 0 ? 'on' : ''}">${f === 'all' ? 'All' : A.CardTypes[f].label + 's'}</button>`).join('')}</div>
      <div class="search-results"></div></div>`);
    const inp = body.querySelector('input'), res = body.querySelector('.search-results');
    let filter = 'all', idx = 0, items = [];
    const run = () => {
      const q = inp.value.trim().toLowerCase();
      items = [];
      if (q) {
        if (filter === 'all' || filter === 'board') for (const b of Object.values(A.state.boards)) if (b.title.toLowerCase().includes(q)) items.push({ kind: 'board', b });
        for (const c of Object.values(A.state.cards)) {
          if (c.type === 'board') continue;
          if (filter !== 'all' && filter !== c.type && !(filter === 'comment' && c.comments && c.comments.length)) continue;
          const t = A.searchText(c); const i = t.toLowerCase().indexOf(q);
          if (i >= 0) items.push({ kind: 'card', c, snip: t.slice(Math.max(0, i - 30), i + q.length + 60) });
          if (items.length > 80) break;
        }
      }
      idx = 0;
      const hl = (s) => esc(s).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
      res.innerHTML = !q ? `<div class="empty-small">Type to search across ${Object.keys(A.state.boards).length} boards and ${Object.keys(A.state.cards).length} cards</div>`
        : items.length ? items.map((it, i) => it.kind === 'board'
          ? `<button class="sr ${i === 0 ? 'on' : ''}" data-i="${i}"><span class="sr-ic">${it.b.icon ? esc(it.b.icon) : I('board', 15)}</span><div><div>${hl(it.b.title)}</div><div class="muted small">Board · in ${esc(A.boardPath(it.b.id).slice(0, -1).map((x) => x.title).join(' › ') || 'top level')}</div></div></button>`
          : `<button class="sr ${i === 0 ? 'on' : ''}" data-i="${i}"><span class="sr-ic">${I(A.CardTypes[it.c.type].icon, 15)}</span><div><div>${hl(it.snip)}</div><div class="muted small">${A.CardTypes[it.c.type].label} · ${esc(it.c.boardId === '__unsorted' ? 'Unsorted' : (A.state.boards[it.c.boardId] || {}).title || '')}</div></div></button>`).join('')
          : '<div class="empty-small">No results</div>';
    };
    const go = (i) => {
      const it = items[i]; if (!it) return; m.close();
      if (it.kind === 'board') A.openBoard(it.b.id);
      else if (it.c.boardId === '__unsorted') { if (A.panelOpen !== 'unsorted') A.togglePanel('unsorted'); }
      else { if (A.ui.boardId !== it.c.boardId) A.openBoard(it.c.boardId); setTimeout(() => A.focusCard(it.c.id), 30); }
    };
    inp.oninput = run;
    inp.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = A.clamp(idx + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1); res.querySelectorAll('.sr').forEach((x, i) => x.classList.toggle('on', i === idx)); const on = res.querySelector('.sr.on'); on && on.scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Enter') go(idx);
    };
    body.querySelector('.search-filters').onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; body.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); run(); inp.focus(); };
    res.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) go(+b.dataset.i); };
    const m = A.modal({ body, cls: 'search-modal' });
    run(); setTimeout(() => inp.focus(), 30);
  };

  /* ---------- settings ---------- */
  A.applySettings = function () {
    const s = A.state.settings;
    const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.getElementById('viewport').classList.toggle('no-grid', !s.grid);
    const tb = $('#theme-btn'); if (tb) tb.innerHTML = I(dark ? 'sun' : 'moon', 18);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => A.state && A.applySettings());
  A.cycleTheme = function () {
    const s = A.state.settings; const dark = document.documentElement.classList.contains('dark');
    s.theme = dark ? 'light' : 'dark'; A.applySettings(); A.save();
  };
  A.openSettings = function () {
    const s = A.state.settings;
    const body = h(`<div class="settings">
      <section><h4>Profile</h4><label>Display name<input class="input" data-s="name" value="${esc(s.name)}"></label></section>
      <section><h4>Appearance</h4><div class="seg">${['light', 'dark', 'system'].map((t) => `<button data-theme="${t}" class="${s.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
        <label class="check"><input type="checkbox" data-s="grid" ${s.grid ? 'checked' : ''}> Show dot grid</label>
        <label class="check"><input type="checkbox" data-s="snap" ${s.snap ? 'checked' : ''}> Snap cards to grid</label>
        <label class="check"><input type="checkbox" data-s="guides" ${s.guides !== false ? 'checked' : ''}> Smart alignment guides</label></section>
      <section><h4>Your data</h4><p class="muted small">Everything is stored privately in this browser. <span data-usage></span></p>
        <div class="row wrap"><button class="btn" data-x="export">${I('download', 14)} Export backup (.json)</button>
        <button class="btn" data-x="import">${I('upload', 14)} Import backup</button>
        <button class="btn danger" data-x="reset">${I('refresh', 14)} Reset workspace</button></div></section></div>`);
    body.querySelector('[data-s=name]').oninput = (e) => { s.name = e.target.value || 'You'; A.save(); };
    body.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => { s.theme = b.dataset.theme; body.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('on', x === b)); A.applySettings(); A.save(); }));
    body.querySelectorAll('input[type=checkbox]').forEach((c) => (c.onchange = () => { s[c.dataset.s] = c.checked; A.applySettings(); A.save(); }));
    body.querySelector('[data-x=export]').onclick = async () => { const json = await A.exportWorkspace(); A.downloadText(json, `workspace-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); };
    body.querySelector('[data-x=import]').onclick = () => A.pickFiles('.json,application/json', false, async (f) => {
      if (!f[0]) return;
      if (!(await A.confirm('Importing replaces your current workspace. Continue?', 'Import', true))) return;
      try { await A.importWorkspace(await f[0].text()); m.close(); A.toast('Workspace imported'); } catch (e) { A.toast('Import failed: ' + e.message); }
    });
    body.querySelector('[data-x=reset]').onclick = async () => { if (!(await A.confirm('This erases every board and card and restores the starter workspace.', 'Reset everything', true))) return; A.resetWorkspace(); m.close(); A.toast('Workspace reset'); };
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => { const u = body.querySelector('[data-usage]'); if (u) u.textContent = `Using ${A.fmtSize(e.usage || 0)}${e.quota ? ' of ' + A.fmtSize(e.quota) : ''}.`; });
    const m = A.modal({ title: 'Settings', body });
  };
  A.downloadText = function (text, name, type = 'text/plain') {
    const u = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  };

  /* ---------- share (front-end only) ---------- */
  A.openShare = function () {
    const bid = A.ui.boardId; const b = A.state.boards[bid];
    const sh = (A.state.shares[bid] = A.state.shares[bid] || { public: false, people: [], allowComments: true });
    const url = location.href.split('#')[0] + '#/b/' + bid;
    const body = h('<div class="share"></div>');
    const render = () => {
      body.innerHTML = `
        <div class="share-invite"><input class="input" type="email" placeholder="Invite people by email"><select class="input sel"><option value="edit">Can edit</option><option value="comment">Can comment</option><option value="view">Can view</option></select><button class="btn primary">Invite</button></div>
        <div class="people">
          <div class="person"><div class="avatar">${esc(A.initials(A.state.settings.name))}</div><div class="p-main"><b>${esc(A.state.settings.name)}</b> <span class="muted small">(you)</span></div><span class="muted small">Owner</span></div>
          ${sh.people.map((p, i) => `<div class="person"><div class="avatar">${esc(A.initials(p.email))}</div><div class="p-main">${esc(p.email)}<div class="muted small">Invitation pending</div></div>
            <select class="input sel" data-role="${i}">${['edit', 'comment', 'view'].map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>Can ${r}</option>`).join('')}</select><button class="icon-btn" data-rm="${i}">${I('x', 14)}</button></div>`).join('')}
        </div>
        <div class="share-link">
          <label class="check toggle"><input type="checkbox" data-pub ${sh.public ? 'checked' : ''}><span></span> Anyone with the link can view</label>
          ${sh.public ? `<label class="check"><input type="checkbox" data-cm ${sh.allowComments ? 'checked' : ''}> Allow viewers to comment</label>` : ''}
          <div class="row"><input class="input" readonly value="${esc(url)}"><button class="btn" data-copy>${I('link', 14)} Copy link</button></div>
        </div>
        <p class="muted small">Sharing settings are saved with the board. Sending invitations requires connecting a backend service.</p>`;
      const em = body.querySelector('input[type=email]'), role = body.querySelector('.share-invite select');
      body.querySelector('.share-invite button').onclick = () => {
        const v = em.value.trim(); if (!/^\S+@\S+\.\S+$/.test(v)) return A.toast('Enter a valid email address');
        sh.people.push({ email: v, role: role.value, time: A.now() }); A.log(`Invited ${v} to “${b.title}”`); A.save(); render();
      };
      em.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') body.querySelector('.share-invite button').click(); };
      body.querySelectorAll('[data-rm]').forEach((x) => (x.onclick = () => { sh.people.splice(+x.dataset.rm, 1); A.save(); render(); }));
      body.querySelectorAll('[data-role]').forEach((x) => (x.onchange = () => { sh.people[+x.dataset.role].role = x.value; A.save(); }));
      body.querySelector('[data-pub]').onchange = (e) => { sh.public = e.target.checked; A.save(); render(); };
      const cm = body.querySelector('[data-cm]'); if (cm) cm.onchange = (e) => { sh.allowComments = e.target.checked; A.save(); };
      body.querySelector('[data-copy]').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(url).then(() => A.toast('Link copied'), () => A.toast('Copy failed')); };
    };
    render();
    A.modal({ title: `Share “${b.title}”`, body });
  };

  /* ---------- shortcuts ---------- */
  A.openShortcuts = function () {
    const rows = [
      ['Add note / to-do / link / board', 'N  T  W  B'], ['Column / comment / document / sketch', 'C  M  D  S'], ['Line tool', 'L'], ['Colour swatch / image / upload', 'K  I  U'],
      ['New note anywhere', 'Double-click canvas'], ['Edit selected card', 'Enter'], ['Stop editing', 'Esc'],
      ['Select multiple', 'Shift-click / drag'], ['Select all', '⌘A'], ['Duplicate', '⌘D  or  Alt-drag'], ['Copy / cut / paste', '⌘C  ⌘X  ⌘V'],
      ['Delete', '⌫'], ['Undo / redo', '⌘Z  ⇧⌘Z'], ['Lock / unlock', '⇧⌘L'], ['Bring forward / send back', '⌘]  ⌘['], ['Nudge', 'Arrows (⇧ = 10px)'],
      ['Pan', 'Scroll / Space-drag / middle mouse'], ['Zoom', '⌘ + scroll / pinch'], ['Zoom in / out / 100%', '⌘+  ⌘-  ⌘0'], ['Fit to screen', '⇧1'],
      ['Search', '⌘K  or  /'], ['Go up a board', '⌘↑  or  Backspace (nothing selected)'], ['Disable snapping while dragging', 'Hold ⇧'],
      ['Rich text: bold / italic / underline / link', '⌘B  ⌘I  ⌘U  ⌘K'], ['Markdown shortcuts', '#  ##  -  1.  >  then space'], ['This help', '?'],
    ];
    A.modal({ title: 'Keyboard shortcuts', wide: true, body: `<div class="shortcuts">${rows.map(([a, b]) => `<div class="sc-row"><span>${esc(a)}</span><span>${b.split('  ').map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</span></div>`).join('')}</div>` });
  };

  /* ---------- lightbox ---------- */
  A.lightbox = function ({ type, src, title }) {
    const inner = type === 'image' ? `<img src="${esc(src)}" alt="">` : type === 'video' ? `<video src="${esc(src)}" controls autoplay></video>` : `<iframe src="${esc(src)}"></iframe>`;
    const m = h(`<div class="lightbox"><div class="lb-head"><span>${esc(title || '')}</span><button class="icon-btn" data-close>${I('x', 20)}</button></div><div class="lb-body">${inner}</div></div>`);
    document.body.appendChild(m);
    const close = () => { m.remove(); window.removeEventListener('keydown', k, true); };
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]') || e.target.classList.contains('lb-body')) close(); };
    window.addEventListener('keydown', k, true);
  };
})();
