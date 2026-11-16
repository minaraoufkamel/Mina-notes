/* Document editor, sketch editor, export */
(function () {
  'use strict';
  const A = window.App;
  const esc = A.esc;
  const I = (n, s) => A.icon(n, s);

  /* ---------- document editor ---------- */
  A.openDocument = function (id) {
    const c = A.state.cards[id]; if (!c) return;
    A.endEdit(); A.closeMenus();
    A.checkpoint();
    const bd = A.state.boards[c.boardId] || { title: '' };
    const m = A.h(`<div class="doc-editor" role="dialog" aria-label="Document">
      <div class="doc-top">
        <button class="btn ghost" data-close>${I('back', 15)} ${esc(bd.title)}</button>
        <div class="grow"></div>
        <span class="muted small" data-wc></span>
        <button class="icon-btn" data-cmt title="Comments">${I('comment', 17)}</button>
        <button class="icon-btn" data-md title="Download as Markdown">${I('download', 17)}</button>
        <button class="icon-btn" data-print title="Print">${I('print', 17)}</button>
        <button class="icon-btn" data-close title="Close (Esc)">${I('x', 18)}</button>
      </div>
      <div class="formatbar static doc-fmt">${A.fmtButtonsHTML()}</div>
      <div class="doc-scroll"><div class="doc-page">
        <input class="doc-title-input" placeholder="Untitled document" value="${esc(c.data.title)}">
        <div class="doc-editor-body rich" contenteditable="true" data-placeholder="Start writing… Use # for headings, - for lists.">${A.sanitize(c.data.html)}</div>
      </div></div></div>`);
    document.body.appendChild(m);
    const title = m.querySelector('.doc-title-input'), body = m.querySelector('.doc-editor-body'), wc = m.querySelector('[data-wc]');
    const upd = () => { const t = A.textOf(body.innerHTML); const n = t ? t.split(/\s+/).length : 0; wc.textContent = `${n} word${n === 1 ? '' : 's'} · ${Math.max(1, Math.round(n / 220))} min read`; };
    upd();
    title.oninput = () => { c.data.title = title.value; c.updated = A.now(); A.save(); };
    body.addEventListener('input', () => { c.data.html = A.textOf(body.innerHTML) || /<(img|hr|li)/i.test(body.innerHTML) ? body.innerHTML : ''; c.updated = A.now(); A.save(); upd(); });
    body.addEventListener('paste', (e) => {
      e.preventDefault(); e.stopPropagation();
      const html = e.clipboardData.getData('text/html'), text = e.clipboardData.getData('text/plain');
      if (html) document.execCommand('insertHTML', false, A.sanitize(html)); else document.execCommand('insertText', false, text);
    });
    body.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === ' ' && A.markdownShortcut(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); A.formatCmd('link', null, m.querySelector('[data-fmt=link]')); }
      if (e.key === 'Escape') close();
    });
    title.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); body.focus(); } if (e.key === 'Escape') close(); });
    A.bindFormatButtons(m.querySelector('.doc-fmt'));
    m.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
    m.querySelector('[data-md]').onclick = () => A.downloadText(`# ${c.data.title || 'Untitled document'}\n\n${A.htmlToMd(c.data.html)}`, (c.data.title || 'document').replace(/[^\w\- ]+/g, '') + '.md', 'text/markdown');
    m.querySelector('[data-print]').onclick = () => { document.body.classList.add('print-doc'); window.print(); setTimeout(() => document.body.classList.remove('print-doc'), 500); };
    m.querySelector('[data-cmt]').onclick = (e) => A.openCommentPopover(c, e.currentTarget);
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.popover')) close(); };
    window.addEventListener('keydown', onKey);
    function close() { window.removeEventListener('keydown', onKey); m.remove(); A.changed(); }
    setTimeout(() => { if (!c.data.title) title.focus(); else { body.focus(); const r = document.createRange(); r.selectNodeContents(body); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }, 30);
  };

  /* ---------- sketch ---------- */
  function smooth(pts) {
    if (!pts.length) return '';
    const f = (n) => Math.round(n * 10) / 10;
    if (pts.length === 1) return `M${f(pts[0][0])},${f(pts[0][1])} l0.01,0`;
    let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${f(pts[i][0])},${f(pts[i][1])} ${f(mx)},${f(my)}`;
    }
    const l = pts[pts.length - 1]; d += ` L${f(l[0])},${f(l[1])}`;
    return d;
  }
  const strokeEl = (s) => `<path d="${smooth(s.points)}" stroke="${esc(s.color)}" stroke-width="${s.size}" fill="none" stroke-linecap="round" stroke-linejoin="round"${s.tool === 'marker' ? ' opacity="0.38"' : ''}/>`;
  A.sketchSVG = (d) => `<svg class="sketch-svg" viewBox="0 0 ${d.vw} ${d.vh}" preserveAspectRatio="xMidYMid meet">${(d.strokes || []).map(strokeEl).join('')}</svg>`;

  A.openSketch = function (id) {
    const c = A.state.cards[id]; if (!c) return;
    A.endEdit(); A.closeMenus(); A.checkpoint();
    let strokes = A.clone(c.data.strokes || []);
    const undo = [], redo = [];
    let tool = 'pen', color = '#222222', size = 4;
    const COLORS = ['#222222', '#ffffff', '#f0544f', '#ff8a3d', '#f2c230', '#45b85a', '#22b3a6', '#4c8dff', '#8e6bf0', '#ec5ca6', '#8b5a2b', '#8b9196'];
    const m = A.h(`<div class="sketch-editor">
      <div class="sk-bar">
        <div class="sk-group">${[['pen', 'sketch', 'Pen'], ['marker', 'highlighter', 'Marker'], ['eraser', 'eraser', 'Eraser']].map(([t, ic, lb]) => `<button data-t="${t}" class="${t === tool ? 'on' : ''}" title="${lb}">${I(ic, 18)}</button>`).join('')}</div>
        <div class="sk-group colors">${COLORS.map((col) => `<button data-c="${col}" class="sk-color ${col === color ? 'on' : ''}" style="--c:${col}"></button>`).join('')}<label class="sk-custom" title="Custom colour"><input type="color" value="#222222"></label></div>
        <div class="sk-group">${[2, 4, 8, 16].map((s) => `<button data-s="${s}" class="${s === size ? 'on' : ''}" title="${s}px"><span class="sk-size" style="width:${Math.min(s + 2, 18)}px;height:${Math.min(s + 2, 18)}px"></span></button>`).join('')}</div>
        <div class="sk-group"><button data-a="undo" title="Undo">${I('undo', 18)}</button><button data-a="redo" title="Redo">${I('redo', 18)}</button><button data-a="clear" title="Clear">${I('trash', 18)}</button></div>
        <div class="grow"></div>
        <button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="done">Done</button>
      </div>
      <div class="sk-stage"><svg class="sk-canvas" viewBox="0 0 ${c.data.vw} ${c.data.vh}" preserveAspectRatio="xMidYMid meet"><rect class="sk-bg" width="${c.data.vw}" height="${c.data.vh}"/><g class="sk-strokes"></g><circle class="sk-cursor" r="0"/></svg></div></div>`);
    document.body.appendChild(m);
    const svg = m.querySelector('.sk-canvas'), g = m.querySelector('.sk-strokes'), cur = m.querySelector('.sk-cursor');
    const draw = () => { g.innerHTML = strokes.map(strokeEl).join(''); };
    draw();
    const pt = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const r = p.matrixTransform(svg.getScreenCTM().inverse()); return [r.x, r.y]; };
    const push = () => { undo.push(JSON.stringify(strokes)); redo.length = 0; };
    const eraseAt = (p) => {
      const R = size * 2 + 6; const before = strokes.length;
      strokes = strokes.filter((s) => !s.points.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < R + s.size / 2));
      if (strokes.length !== before) draw();
    };
    let cur_s = null, curEl = null;
    svg.addEventListener('pointerdown', (e) => {
      e.preventDefault(); svg.setPointerCapture(e.pointerId);
      const p = pt(e); push();
      if (tool === 'eraser') { eraseAt(p); cur_s = { erasing: true }; return; }
      cur_s = { tool, color, size: tool === 'marker' ? size * 3 : size, points: [p] };
      g.insertAdjacentHTML('beforeend', strokeEl(cur_s)); curEl = g.lastElementChild;
    });
    svg.addEventListener('pointermove', (e) => {
      const p = pt(e);
      cur.setAttribute('cx', p[0]); cur.setAttribute('cy', p[1]); cur.setAttribute('r', tool === 'eraser' ? size * 2 + 6 : (tool === 'marker' ? size * 1.5 : size / 2));
      if (!cur_s) return;
      if (cur_s.erasing) return eraseAt(p);
      const last = cur_s.points[cur_s.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return;
      cur_s.points.push(p); curEl.setAttribute('d', smooth(cur_s.points));
    });
    const end = () => { if (cur_s && !cur_s.erasing) strokes.push(cur_s); cur_s = null; curEl = null; };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', () => cur.setAttribute('r', 0));
    m.querySelector('.sk-bar').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t) { tool = b.dataset.t; m.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b)); }
      if (b.dataset.c) { color = b.dataset.c; if (tool === 'eraser') { tool = 'pen'; m.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x.dataset.t === 'pen')); } m.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b)); }
      if (b.dataset.s) { size = +b.dataset.s; m.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); }
      const a = b.dataset.a;
      if (a === 'undo' && undo.length) { redo.push(JSON.stringify(strokes)); strokes = JSON.parse(undo.pop()); draw(); }
      if (a === 'redo' && redo.length) { undo.push(JSON.stringify(strokes)); strokes = JSON.parse(redo.pop()); draw(); }
      if (a === 'clear' && strokes.length) { push(); strokes = []; draw(); }
      if (a === 'done') { c.data.strokes = strokes; c.updated = A.now(); close(); A.log('Updated a sketch'); }
      if (a === 'cancel') close();
    });
    m.querySelector('input[type=color]').oninput = (e) => { color = e.target.value; m.querySelectorAll('[data-c]').forEach((x) => x.classList.remove('on')); };
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { c.data.strokes = strokes; close(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); m.querySelector(`[data-a=${e.shiftKey ? 'redo' : 'undo'}]`).click(); }
      if (e.key === 'e') m.querySelector('[data-t=eraser]').click();
      if (e.key === 'p') m.querySelector('[data-t=pen]').click();
    };
    window.addEventListener('keydown', onKey, true);
    function close() { window.removeEventListener('keydown', onKey, true); m.remove(); A.changed(); }
  };

  /* ---------- export ---------- */
  A.htmlToMd = function (html) {
    const d = document.createElement('div'); d.innerHTML = html || '';
    const walk = (n, ctx = {}) => {
      if (n.nodeType === 3) return n.textContent;
      if (n.nodeType !== 1) return '';
      const kids = (c2) => [...n.childNodes].map((x) => walk(x, c2 || ctx)).join('');
      switch (n.tagName) {
        case 'H1': return '\n# ' + kids().trim() + '\n\n';
        case 'H2': return '\n## ' + kids().trim() + '\n\n';
        case 'H3': return '\n### ' + kids().trim() + '\n\n';
        case 'B': case 'STRONG': return '**' + kids() + '**';
        case 'I': case 'EM': return '_' + kids() + '_';
        case 'S': case 'STRIKE': case 'DEL': return '~~' + kids() + '~~';
        case 'CODE': return '`' + kids() + '`';
        case 'PRE': return '\n```\n' + n.textContent + '\n```\n\n';
        case 'A': return `[${kids()}](${n.getAttribute('href') || ''})`;
        case 'BR': return '\n';
        case 'BLOCKQUOTE': return kids().trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
        case 'UL': return [...n.children].map((li) => '- ' + walk(li).trim()).join('\n') + '\n\n';
        case 'OL': return [...n.children].map((li, i) => `${i + 1}. ` + walk(li).trim()).join('\n') + '\n\n';
        case 'P': case 'DIV': return kids() + '\n\n';
        case 'HR': return '\n---\n\n';
        default: return kids();
      }
    };
    return walk(d).replace(/\n{3,}/g, '\n\n').trim();
  };
  A.boardToMarkdown = function (bid, depth = 1, seen = new Set()) {
    if (seen.has(bid)) return ''; seen.add(bid);
    const b = A.state.boards[bid]; if (!b) return '';
    const H = (n) => '#'.repeat(Math.min(6, n)) + ' ';
    let out = `${H(depth)}${b.icon ? b.icon + ' ' : ''}${b.title}\n\n`;
    const cardMd = (c, d) => {
      const x = c.data;
      switch (c.type) {
        case 'note': return A.htmlToMd(x.html) + '\n\n';
        case 'todo': return (x.title ? `**${x.title}**\n\n` : '') + x.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}${i.due ? ` (due ${i.due})` : ''}`).join('\n') + '\n\n';
        case 'link': return `[${x.title || x.url}](${x.url})${x.desc ? ' — ' + x.desc : ''}\n\n`;
        case 'image': return `![${x.caption || 'image'}](${x.src || 'image'})\n\n`;
        case 'file': return `📎 ${x.name} (${A.fmtSize(x.size || 0)})\n\n`;
        case 'video': return `🎬 ${x.caption || 'Video'}\n\n`;
        case 'audio': return `🎙️ ${x.name || 'Audio'}\n\n`;
        case 'swatch': return `🎨 ${x.name ? x.name + ' ' : ''}\`${x.color}\`\n\n`;
        case 'map': return `📍 [${x.query}](https://maps.google.com/?q=${encodeURIComponent(x.query)})\n\n`;
        case 'document': return `${H(d + 1)}📄 ${x.title || 'Document'}\n\n${A.htmlToMd(x.html)}\n\n`;
        case 'sketch': return `✏️ Sketch (${(x.strokes || []).length} strokes)\n\n`;
        case 'table': { const r = x.rows; if (!r.length) return ''; const row = (a) => '| ' + a.map((v) => (v || '').replace(/\|/g, '\\|')).join(' | ') + ' |'; return (x.title ? `**${x.title}**\n\n` : '') + (x.header ? [row(r[0]), row(r[0].map(() => '---')), ...r.slice(1).map(row)] : [row(r[0].map(() => ' ')), row(r[0].map(() => '---')), ...r.map(row)]).join('\n') + '\n\n'; }
        case 'comment': return (c.comments || []).map((m) => `> **${m.author}:** ${m.text}`).join('\n') + '\n\n';
        case 'column': return `${H(d + 1)}${x.title || 'Column'}\n\n` + A.columnChildren(c.id).map((k) => cardMd(k, d + 1)).join('');
        case 'board': return A.boardToMarkdown(x.board, d + 1, seen);
        default: return '';
      }
    };
    const cards = A.cardsOn(bid).sort((a, c) => a.y - c.y || a.x - c.x);
    out += cards.map((c) => cardMd(c, depth)).join('');
    const lines = Object.values(A.state.lines).filter((l) => l.boardId === bid && l.from.card && l.to.card);
    if (lines.length) out += `**Connections**\n\n` + lines.map((l) => `- ${A.cardSummary(A.state.cards[l.from.card])} → ${A.cardSummary(A.state.cards[l.to.card])}${l.label ? ` (${l.label})` : ''}`).join('\n') + '\n\n';
    return out;
  };
  A.boardToText = (bid) => A.boardToMarkdown(bid).replace(/[#*_`>]/g, '').replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)');

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  A.exportPNG = async function () {
    const b = A.state.boards[A.ui.boardId];
    const bounds = A.contentBounds(); if (!bounds) return A.toast('Board is empty');
    A.toast('Preparing image…');
    try {
      if (!window.htmlToImage) await loadScript('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js');
      const world = document.getElementById('world'); const pad = 48;
      A.ui.selection.clear(); A.ui.selectedLine = null; A.render();
      const bg = getComputedStyle(document.getElementById('viewport')).backgroundColor;
      const url = await window.htmlToImage.toPng(world, {
        width: Math.ceil(bounds.w + pad * 2), height: Math.ceil(bounds.h + pad * 2), backgroundColor: bg, pixelRatio: 2, cacheBust: false,
        style: { transform: `translate(${pad - bounds.x}px, ${pad - bounds.y}px) scale(1)`, transformOrigin: '0 0' },
        filter: (n) => !(n.tagName === 'IFRAME' || (n.classList && (n.classList.contains('connect-handle') || n.classList.contains('resize-handle')))),
        imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      });
      const a = document.createElement('a'); a.href = url; a.download = (b.title || 'board') + '.png'; a.click();
    } catch (e) { console.error(e); A.toast('Image export needs an internet connection to load the renderer'); }
  };
  A.printBoard = function () {
    const saved = { ...A.view };
    document.body.classList.add('printing');
    A.ui.selection.clear(); A.ui.selectedLine = null; A.render();
    A.fitToContent(null, 1);
    setTimeout(() => {
      window.print();
      setTimeout(() => { document.body.classList.remove('printing'); A.view = saved; A.applyView(); }, 300);
    }, 120);
  };
  A.exportMenu = function (anchor) {
    const r = anchor.getBoundingClientRect(); const b = A.state.boards[A.ui.boardId];
    const safe = (b.title || 'board').replace(/[^\w\- ]+/g, '');
    A.menu(r.right - 230, r.bottom + 6, [
      { header: 'Export this board' },
      { label: 'Image (.png)', icon: 'image', fn: () => A.exportPNG() },
      { label: 'PDF / Print', icon: 'print', fn: () => A.printBoard() },
      { label: 'Markdown (.md)', icon: 'note', fn: () => A.downloadText(A.boardToMarkdown(A.ui.boardId), safe + '.md', 'text/markdown') },
      { label: 'Plain text (.txt)', icon: 'document', fn: () => A.downloadText(A.boardToText(A.ui.boardId), safe + '.txt') },
      { sep: true },
      { label: 'Copy as Markdown', icon: 'copy', fn: () => { navigator.clipboard.writeText(A.boardToMarkdown(A.ui.boardId)).then(() => A.toast('Copied to clipboard')); } },
      { label: 'Full workspace backup (.json)', icon: 'download', fn: async () => A.downloadText(await A.exportWorkspace(), `workspace-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json') },
    ]);
  };
})();
