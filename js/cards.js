/* Card types, card element rendering, inline editing */
(function () {
  'use strict';
  const A = window.App;
  const esc = A.esc;
  const I = (n, s) => A.icon(n, s);

  A.COLORS = [
    { id: null, name: 'Default', hex: '#ffffff' },
    { id: 'grey', name: 'Grey', hex: '#e6e6e3' },
    { id: 'red', name: 'Red', hex: '#ffd9d6' },
    { id: 'orange', name: 'Orange', hex: '#ffe3c7' },
    { id: 'yellow', name: 'Yellow', hex: '#fff3b8' },
    { id: 'green', name: 'Green', hex: '#d7f2d4' },
    { id: 'teal', name: 'Teal', hex: '#cdf0ec' },
    { id: 'blue', name: 'Blue', hex: '#d6e6ff' },
    { id: 'purple', name: 'Purple', hex: '#e6dcff' },
    { id: 'pink', name: 'Pink', hex: '#ffd9ec' },
    { id: 'dark', name: 'Dark', hex: '#2f3437' },
    { id: 'clear', name: 'No background', hex: 'transparent' },
  ];
  A.BOARD_COLORS = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'grey', 'dark'];
  A.BOARD_HEX = { blue: '#4c8dff', teal: '#22b3a6', green: '#45b85a', yellow: '#f2c230', orange: '#ff8a3d', red: '#f0544f', pink: '#ec5ca6', purple: '#8e6bf0', grey: '#8b9196', dark: '#2f3437' };

  /* ---------- sanitizer for rich text ---------- */
  const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'A', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'P', 'BR', 'DIV', 'BLOCKQUOTE', 'CODE', 'PRE', 'SPAN', 'FONT', 'MARK', 'HR', 'SUB', 'SUP']);
  A.sanitize = function (html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    const walk = (node) => {
      for (const ch of [...node.childNodes]) {
        if (ch.nodeType === 1) {
          if (!ALLOWED.has(ch.tagName)) {
            if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'META', 'LINK'].includes(ch.tagName)) { ch.remove(); continue; }
            walk(ch); ch.replaceWith(...ch.childNodes); continue;
          }
          for (const at of [...ch.attributes]) {
            const n = at.name.toLowerCase();
            if (n === 'href' && ch.tagName === 'A') { if (/^\s*javascript:/i.test(at.value)) ch.removeAttribute(n); else { ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noopener'); } }
            else if (n === 'style') { const st = ch.getAttribute('style'); const keep = (st.match(/(color|background-color|text-align|text-decoration)\s*:[^;]+/gi) || []).join(';'); if (keep) ch.setAttribute('style', keep); else ch.removeAttribute('style'); }
            else if (n === 'color' && ch.tagName === 'FONT') {}
            else if (n === 'target' || n === 'rel') {}
            else ch.removeAttribute(at.name);
          }
          walk(ch);
        } else if (ch.nodeType !== 3) ch.remove();
      }
    };
    const root = doc.body.firstChild; walk(root);
    return root.innerHTML;
  };
  A.linkify = function (text) {
    return esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  };

  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  A.normalizeUrl = (u) => { u = (u || '').trim(); if (!u) return ''; if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u; return u; };
  A.isUrl = (t) => /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test((t || '').trim()) && !/\s/.test(t.trim());
  A.youtubeId = (u) => { const m = (u || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/); return m ? m[1] : null; };
  A.vimeoId = (u) => { const m = (u || '').match(/vimeo\.com\/(\d+)/); return m ? m[1] : null; };
  const isImageUrl = (u) => /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i.test(u || '');
  A.fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  A.fmtDate = (t) => { const d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  A.fmtTime = (t) => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  A.initials = (n) => (n || '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

  function commentsHTML(c, inCard) {
    const list = (c.comments || []);
    return `<div class="thread">${list.map((m) => `
      <div class="cmt ${m.resolved ? 'resolved' : ''}" data-cmt="${m.id}">
        <div class="avatar">${esc(A.initials(m.author))}</div>
        <div class="cmt-main"><div class="cmt-head"><b>${esc(m.author)}</b><span>${A.fmtTime(m.time)}</span>
          <button class="mini" data-nodrag data-act="cmt-del" data-cmt="${m.id}" title="Delete">${I('x', 12)}</button></div>
          <div class="cmt-text">${A.linkify(m.text)}</div></div></div>`).join('')}
      ${inCard && !list.length ? '<div class="muted small">Start a conversation…</div>' : ''}
      </div>
      <div class="cmt-input" data-nodrag><textarea rows="1" placeholder="${list.length ? 'Reply…' : 'Write a comment…'}" data-cmt-input></textarea>
      <button class="btn small primary" data-act="cmt-post">Post</button></div>`;
  }
  A.commentsHTML = commentsHTML;

  function shield() { return '<div class="iframe-shield" title="Double-click to interact"></div>'; }

  /* ---------- Card type registry ---------- */
  const T = (A.CardTypes = {});

  T.note = {
    label: 'Note', icon: 'note', w: 260, resize: 'w', editable: true,
    defaults: () => ({ html: '' }),
    render(c, b) { b.innerHTML = `<div class="rich" data-field="html" data-rich data-placeholder="Type something…">${A.sanitize(c.data.html)}</div>`; },
  };

  T.todo = {
    label: 'To-do', icon: 'todo', w: 260, resize: 'w', editable: true,
    defaults: () => ({ title: '', items: [{ id: A.uid('t'), text: '', done: false }], hideDone: false }),
    render(c, b) {
      const items = c.data.items || [];
      const done = items.filter((i) => i.done).length;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const vis = items.filter((i) => !(c.data.hideDone && i.done));
      b.innerHTML = `
        <div class="todo-head"><div class="todo-title" data-field="title" data-single data-placeholder="To-do list">${esc(c.data.title)}</div>
          ${items.length ? `<span class="todo-count">${done}/${items.length}</span>` : ''}</div>
        ${items.length ? `<div class="progress"><div style="width:${(done / items.length) * 100}%"></div></div>` : ''}
        <ul class="todo-items">${vis.map((i) => {
          const due = i.due ? new Date(i.due + 'T00:00:00') : null;
          const cls = due ? (due < today && !i.done ? 'overdue' : (due.getTime() === today.getTime() ? 'today' : '')) : '';
          return `<li class="todo-item ${i.done ? 'done' : ''}" data-item="${i.id}">
            <button class="check" data-nodrag data-act="todo-toggle" data-item="${i.id}" aria-label="Toggle">${i.done ? I('check', 12) : ''}</button>
            <div class="todo-text" data-field="item" data-item="${i.id}" data-single data-placeholder="To-do">${esc(i.text)}</div>
            ${due ? `<button class="due ${cls}" data-nodrag data-act="todo-due" data-item="${i.id}">${A.fmtDate(due)}</button>` : ''}
            <span class="item-tools"><button class="mini" data-nodrag data-act="todo-due" data-item="${i.id}" title="Set due date">${I('calendar', 13)}</button>
            <button class="mini" data-nodrag data-act="todo-del" data-item="${i.id}" title="Remove">${I('x', 13)}</button></span></li>`;
        }).join('')}</ul>
        <div class="todo-foot"><button class="add-row" data-nodrag data-act="todo-add">${I('plus', 13)} Add a task</button>
        ${done ? `<button class="mini-text" data-nodrag data-act="todo-hide">${c.data.hideDone ? 'Show' : 'Hide'} completed</button>` : ''}</div>`;
    },
    onEdit(c, el, val) {
      if (el.dataset.field === 'item') { const it = c.data.items.find((i) => i.id === el.dataset.item); if (it) it.text = val; }
      else c.data[el.dataset.field] = val;
    },
    onKey(c, el, e) {
      if (el.dataset.field === 'title' && e.key === 'Enter') {
        e.preventDefault(); A.endEdit();
        if (!c.data.items.length) { c.data.items.push({ id: A.uid('t'), text: '', done: false }); }
        A.rebuildCard(c.id); A.focusField(c.id, `[data-field="item"][data-item="${c.data.items[0].id}"]`);
        return true;
      }
      if (el.dataset.field !== 'item') return false;
      const idx = c.data.items.findIndex((i) => i.id === el.dataset.item);
      if (e.key === 'Enter') {
        e.preventDefault();
        const it = { id: A.uid('t'), text: '', done: false };
        c.data.items.splice(idx + 1, 0, it);
        A.endEdit(); A.rebuildCard(c.id); A.focusField(c.id, `[data-field="item"][data-item="${it.id}"]`);
        return true;
      }
      if (e.key === 'Backspace' && !el.textContent && c.data.items.length > 1) {
        e.preventDefault();
        c.data.items.splice(idx, 1);
        const prev = c.data.items[Math.max(0, idx - 1)];
        A.endEdit(); A.rebuildCard(c.id); A.focusField(c.id, `[data-field="item"][data-item="${prev.id}"]`);
        return true;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const n = c.data.items[idx + (e.key === 'ArrowUp' ? -1 : 1)];
        if (n) { e.preventDefault(); A.endEdit(); A.focusField(c.id, `[data-field="item"][data-item="${n.id}"]`); return true; }
      }
      return false;
    },
    actions: {
      'todo-toggle'(c, t) { const it = c.data.items.find((i) => i.id === t.dataset.item); if (it) { A.checkpoint(); it.done = !it.done; if (it.done) A.log(`Completed “${it.text || 'task'}”`); A.changed(); } },
      'todo-del'(c, t) { A.checkpoint(); c.data.items = c.data.items.filter((i) => i.id !== t.dataset.item); A.changed(); },
      'todo-add'(c) { A.checkpoint(); const it = { id: A.uid('t'), text: '', done: false }; c.data.items.push(it); A.rebuildCard(c.id); A.focusField(c.id, `[data-field="item"][data-item="${it.id}"]`); },
      'todo-hide'(c) { A.checkpoint(); c.data.hideDone = !c.data.hideDone; A.changed(); },
      'todo-due'(c, t) {
        const it = c.data.items.find((i) => i.id === t.dataset.item); if (!it) return;
        const wrap = document.createElement('div'); wrap.className = 'pop-form';
        wrap.innerHTML = `<label class="small muted">Due date</label><input type="date" value="${it.due || ''}"><div class="row"><button class="btn small" data-x="clear">Clear</button><button class="btn small primary" data-x="ok">Done</button></div>`;
        const inp = wrap.querySelector('input');
        const close = A.popover(t, wrap);
        wrap.querySelector('[data-x=ok]').onclick = () => { A.checkpoint(); it.due = inp.value || null; close(); A.changed(); };
        wrap.querySelector('[data-x=clear]').onclick = () => { A.checkpoint(); it.due = null; close(); A.changed(); };
        setTimeout(() => inp.focus(), 30);
      },
    },
  };

  T.link = {
    label: 'Link', icon: 'link', w: 280, resize: 'w', editable: true,
    defaults: () => ({ url: '', title: '', desc: '' }),
    render(c, b) {
      const d = c.data;
      if (!d.url) {
        b.innerHTML = `<div class="empty-input">${I('link', 16)}<input data-nodrag class="inline-input" placeholder="Paste or type a web address…"></div>`;
        const inp = b.querySelector('input');
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && inp.value.trim()) { A.checkpoint(); d.url = A.normalizeUrl(inp.value); A.changed(); }
          if (e.key === 'Escape') inp.blur();
          e.stopPropagation();
        });
        return;
      }
      const h = host(d.url), yt = A.youtubeId(d.url), vm = A.vimeoId(d.url);
      const playing = A.ui.playing.has(c.id);
      let media = '';
      if (yt || vm) {
        media = playing
          ? `<div class="embed"><iframe src="${yt ? `https://www.youtube.com/embed/${yt}?autoplay=1` : `https://player.vimeo.com/video/${vm}?autoplay=1`}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>`
          : `<div class="link-media" data-nodrag data-act="link-play">${yt ? `<img src="https://img.youtube.com/vi/${yt}/hqdefault.jpg" alt="" draggable="false">` : '<div class="media-ph"></div>'}<span class="play-btn">${I('play', 20)}</span></div>`;
      } else if (isImageUrl(d.url)) {
        media = `<div class="link-media"><img src="${esc(d.url)}" alt="" draggable="false" onerror="this.parentNode.style.display='none'"></div>`;
      }
      b.innerHTML = `${media}<div class="link-body">
        <div class="link-meta"><img class="favicon" src="https://icons.duckduckgo.com/ip3/${esc(h)}.ico" alt="" onerror="this.style.display='none'"><span>${esc(h)}</span></div>
        <div class="link-title" data-field="title" data-single data-placeholder="${esc(h)}">${esc(d.title)}</div>
        <div class="link-desc" data-field="desc" data-placeholder="Add a description">${esc(d.desc)}</div>
        <div class="link-actions"><a class="mini-text" href="${esc(d.url)}" target="_blank" rel="noopener" data-nodrag>${I('external', 12)} Open</a>
        <button class="mini-text" data-nodrag data-act="link-edit">Edit URL</button></div></div>`;
    },
    actions: {
      'link-play'(c) { A.ui.playing.add(c.id); A.rebuildCard(c.id); },
      'link-edit'(c, t) {
        const wrap = document.createElement('div'); wrap.className = 'pop-form';
        wrap.innerHTML = `<label class="small muted">Web address</label><input type="url" value="${esc(c.data.url)}"><div class="row"><button class="btn small primary">Save</button></div>`;
        const inp = wrap.querySelector('input'); const close = A.popover(t, wrap);
        const save = () => { A.checkpoint(); c.data.url = A.normalizeUrl(inp.value); A.ui.playing.delete(c.id); close(); A.changed(); };
        wrap.querySelector('button').onclick = save; inp.onkeydown = (e) => { if (e.key === 'Enter') save(); };
        setTimeout(() => inp.select(), 30);
      },
    },
  };

  T.image = {
    label: 'Image', icon: 'image', w: 300, resize: 'w', editable: true,
    defaults: () => ({ asset: null, src: '', caption: '' }),
    render(c, b) {
      const src = c.data.asset ? A.assetURL(c.data.asset) : c.data.src;
      b.innerHTML = src ? `<div class="img-wrap"><img src="${esc(src)}" alt="" draggable="false"></div>
        <div class="caption" data-field="caption" data-placeholder="Add a caption">${esc(c.data.caption)}</div>`
        : `<div class="empty-media" data-nodrag data-act="image-pick">${I('image', 26)}<span>Click to add an image</span></div>`;
    },
    onDblClick(c) { const src = c.data.asset ? A.assetURL(c.data.asset) : c.data.src; if (src) A.lightbox({ type: 'image', src, title: c.data.caption }); },
    actions: { 'image-pick'(c) { A.pickFiles('image/*', false, async (files) => { if (!files[0]) return; A.checkpoint(); c.data.asset = await A.addAsset(files[0]); A.changed(); }); } },
  };

  T.file = {
    label: 'File', icon: 'file', w: 260, resize: 'w', editable: true,
    defaults: () => ({ asset: null, name: 'File', size: 0, mime: '' }),
    render(c, b) {
      const ext = (c.data.name.split('.').pop() || 'file').slice(0, 4).toUpperCase();
      const canPreview = /pdf|text|image|video|audio/.test(c.data.mime || '');
      b.innerHTML = `<div class="file-row"><div class="file-icon">${esc(ext)}</div>
        <div class="file-info"><div class="file-name" data-field="name" data-single>${esc(c.data.name)}</div><div class="muted small">${A.fmtSize(c.data.size || 0)}</div></div></div>
        <div class="file-actions">${canPreview ? `<button class="mini-text" data-nodrag data-act="file-preview">${I('eye', 12)} Preview</button>` : ''}
        <button class="mini-text" data-nodrag data-act="file-download">${I('download', 12)} Download</button></div>`;
    },
    onDblClick(c) { T.file.actions['file-preview'](c); },
    actions: {
      'file-download'(c) { A.downloadAsset(c.data.asset, c.data.name); },
      'file-preview'(c) { const u = A.assetURL(c.data.asset); if (u) A.lightbox({ type: /image/.test(c.data.mime) ? 'image' : /video/.test(c.data.mime) ? 'video' : 'frame', src: u, title: c.data.name }); },
    },
  };

  T.video = {
    label: 'Video', icon: 'video', w: 360, resize: 'w', editable: true,
    defaults: () => ({ asset: null, src: '', caption: '' }),
    render(c, b) {
      const src = c.data.asset ? A.assetURL(c.data.asset) : c.data.src;
      b.innerHTML = src ? `<video src="${esc(src)}" controls preload="metadata" data-nodrag></video>
        <div class="caption" data-field="caption" data-placeholder="Add a caption">${esc(c.data.caption)}</div>`
        : `<div class="empty-media" data-nodrag data-act="video-pick">${I('video', 26)}<span>Click to add a video</span></div>`;
    },
    actions: { 'video-pick'(c) { A.pickFiles('video/*', false, async (f) => { if (!f[0]) return; A.checkpoint(); c.data.asset = await A.addAsset(f[0]); A.changed(); }); } },
  };

  T.audio = {
    label: 'Audio', icon: 'audio', w: 300, resize: 'w', editable: true,
    defaults: () => ({ asset: null, name: '', duration: 0 }),
    render(c, b) {
      const rec = A.ui.recording && A.ui.recording.cardId === c.id;
      if (c.data.asset) {
        b.innerHTML = `<div class="audio-head">${I('audio', 15)}<div class="audio-name" data-field="name" data-single data-placeholder="Voice note">${esc(c.data.name)}</div></div>
        <audio src="${esc(A.assetURL(c.data.asset))}" controls preload="metadata" data-nodrag></audio>`;
      } else if (rec) {
        b.innerHTML = `<div class="rec-live"><span class="rec-dot"></span><span class="rec-time">0:00</span><button class="btn small danger" data-nodrag data-act="audio-stop">${I('stop', 12)} Stop</button></div>`;
      } else {
        b.innerHTML = `<div class="audio-empty"><button class="btn small" data-nodrag data-act="audio-rec">${I('audio', 13)} Record</button>
          <button class="btn small" data-nodrag data-act="audio-upload">${I('upload', 13)} Upload</button></div>`;
      }
    },
    actions: {
      async 'audio-rec'(c) {
        if (!navigator.mediaDevices || !window.MediaRecorder) return A.toast('Recording is not supported in this browser');
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const mr = new MediaRecorder(stream); const chunks = []; const start = Date.now();
          mr.ondataavailable = (e) => chunks.push(e.data);
          mr.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop()); clearInterval(A.ui.recording.timer); A.ui.recording = null;
            const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
            A.checkpoint(); c.data.asset = await A.addAsset(blob, 'Recording.webm'); c.data.name = c.data.name || 'Voice note ' + new Date().toLocaleTimeString(); A.changed();
          };
          mr.start();
          A.ui.recording = { cardId: c.id, mr, timer: setInterval(() => { const el = A.cardEls.get(c.id); const t = el && el.querySelector('.rec-time'); if (t) { const s = Math.floor((Date.now() - start) / 1000); t.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); } }, 250) };
          A.rebuildCard(c.id);
        } catch (e) { A.toast('Microphone access was denied'); }
      },
      'audio-stop'() { if (A.ui.recording) A.ui.recording.mr.stop(); },
      'audio-upload'(c) { A.pickFiles('audio/*', false, async (f) => { if (!f[0]) return; A.checkpoint(); c.data.asset = await A.addAsset(f[0]); c.data.name = f[0].name; A.changed(); }); },
    },
  };

  T.board = {
    label: 'Board', icon: 'board', w: 128, resize: false,
    defaults: () => ({ board: null }),
    render(c, b) {
      const bd = A.state.boards[c.data.board] || { title: 'Missing board', color: 'grey' };
      const n = A.cardsOn(bd.id).length;
      const hex = A.BOARD_HEX[bd.color] || A.BOARD_HEX.blue;
      b.innerHTML = `<div class="board-tile" style="--bc:${hex}">${bd.icon ? `<span class="board-emoji">${esc(bd.icon)}</span>` : I('board', 30)}</div>
        <div class="board-title" data-field="boardTitle" data-single>${esc(bd.title)}</div>
        <div class="board-sub">${n} card${n === 1 ? '' : 's'}</div>`;
    },
    onEdit(c, el, val) { const bd = A.state.boards[c.data.board]; if (bd) { bd.title = val; bd.updated = A.now(); } },
    onClick(c, e) { A.openBoard(c.data.board); return true; },
  };

  T.column = {
    label: 'Column', icon: 'column', w: 290, resize: 'w', editable: true,
    defaults: () => ({ title: '', collapsed: false }),
    render(c, b) {
      const kids = A.columnChildren(c.id);
      b.innerHTML = `<div class="col-head"><div class="col-title" data-field="title" data-single data-placeholder="Untitled column">${esc(c.data.title)}</div>
        <span class="col-count">${kids.length}</span>
        <button class="mini" data-nodrag data-act="col-collapse" title="${c.data.collapsed ? 'Expand' : 'Collapse'}">${I(c.data.collapsed ? 'chevronDown' : 'chevronUp', 14)}</button></div>
        <div class="col-body ${c.data.collapsed ? 'collapsed' : ''}" data-col="${c.id}">${kids.length ? '' : '<div class="col-empty">Drag cards here</div>'}</div>`;
      const body = b.querySelector('.col-body');
      if (!c.data.collapsed) for (const k of kids) body.appendChild(A.ensureEl(k));
      else kids.forEach((k) => A._pass && A._pass.add(k.id));
    },
    actions: { 'col-collapse'(c) { A.checkpoint(); c.data.collapsed = !c.data.collapsed; A.changed(); } },
  };

  T.comment = {
    label: 'Comment', icon: 'comment', w: 280, resize: 'w',
    defaults: () => ({}),
    render(c, b) { b.innerHTML = `<div class="comment-card-head">${I('comment', 14)} Comment thread</div>${commentsHTML(c, true)}`; A.bindCommentInput(c, b); },
  };

  T.table = {
    label: 'Table', icon: 'table', w: 380, resize: 'w', editable: true,
    defaults: () => ({ rows: [['', '', ''], ['', '', ''], ['', '', '']], header: true, title: '' }),
    render(c, b) {
      const rows = c.data.rows;
      b.innerHTML = `<div class="table-title" data-field="title" data-single data-placeholder="Table">${esc(c.data.title)}</div>
      <div class="table-wrap"><table class="${c.data.header ? 'has-header' : ''}">${rows.map((r, ri) => `<tr>${r.map((v, ci) => `<td data-field="cell" data-r="${ri}" data-c="${ci}">${esc(v)}</td>`).join('')}</tr>`).join('')}</table></div>
      <div class="table-tools">
        <button class="mini-text" data-nodrag data-act="tbl-addrow">${I('plus', 12)} Row</button>
        <button class="mini-text" data-nodrag data-act="tbl-addcol">${I('plus', 12)} Column</button>
        <button class="mini-text" data-nodrag data-act="tbl-delrow">${I('minus', 12)} Row</button>
        <button class="mini-text" data-nodrag data-act="tbl-delcol">${I('minus', 12)} Column</button>
        <button class="mini-text" data-nodrag data-act="tbl-header">${c.data.header ? 'No header' : 'Header row'}</button></div>`;
    },
    onEdit(c, el, val) { if (el.dataset.field === 'cell') c.data.rows[+el.dataset.r][+el.dataset.c] = val; else c.data[el.dataset.field] = val; },
    onKey(c, el, e) {
      if (el.dataset.field !== 'cell') return false;
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        let r = +el.dataset.r, col = +el.dataset.c; const R = c.data.rows.length, C = c.data.rows[0].length;
        if (e.key === 'Enter') r++; else if (e.shiftKey) { col--; if (col < 0) { col = C - 1; r--; } } else { col++; if (col >= C) { col = 0; r++; } }
        if (r >= R) { c.data.rows.push(new Array(C).fill('')); A.endEdit(); A.rebuildCard(c.id); }
        else A.endEdit();
        if (r >= 0) A.focusField(c.id, `[data-r="${r}"][data-c="${col}"]`);
        return true;
      }
      return false;
    },
    actions: {
      'tbl-addrow'(c) { A.checkpoint(); c.data.rows.push(new Array(c.data.rows[0].length).fill('')); A.changed(); },
      'tbl-addcol'(c) { A.checkpoint(); c.data.rows.forEach((r) => r.push('')); A.changed(); },
      'tbl-delrow'(c) { if (c.data.rows.length > 1) { A.checkpoint(); c.data.rows.pop(); A.changed(); } },
      'tbl-delcol'(c) { if (c.data.rows[0].length > 1) { A.checkpoint(); c.data.rows.forEach((r) => r.pop()); A.changed(); } },
      'tbl-header'(c) { A.checkpoint(); c.data.header = !c.data.header; A.changed(); },
    },
  };

  T.document = {
    label: 'Document', icon: 'document', w: 240, resize: 'w',
    defaults: () => ({ title: '', html: '' }),
    render(c, b) {
      const txt = A.textOf(c.data.html);
      b.innerHTML = `<div class="doc-head">${I('document', 18)}<span class="doc-label">Document</span></div>
        <div class="doc-title">${esc(c.data.title || 'Untitled document')}</div>
        <div class="doc-excerpt">${esc(txt.slice(0, 220)) || '<span class="muted">Empty document — click to start writing</span>'}</div>
        <div class="doc-foot muted small">${txt ? txt.split(/\s+/).length : 0} words</div>`;
    },
    onClick(c) { A.openDocument(c.id); return true; },
  };

  T.sketch = {
    label: 'Sketch', icon: 'sketch', w: 320, resize: 'w',
    defaults: () => ({ strokes: [], vw: 800, vh: 560, bg: 'white' }),
    render(c, b) {
      b.innerHTML = `<div class="sketch-view">${A.sketchSVG(c.data)}${c.data.strokes.length ? '' : `<div class="sketch-empty">${I('sketch', 22)}<span>Click to draw</span></div>`}</div>`;
    },
    onClick(c) { A.openSketch(c.id); return true; },
  };

  T.swatch = {
    label: 'Color', icon: 'swatch', w: 180, resize: 'w', editable: true,
    defaults: () => ({ color: '#4c8dff', name: '' }),
    render(c, b) {
      const hex = c.data.color; const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), bl = parseInt(hex.slice(5, 7), 16);
      b.innerHTML = `<div class="swatch-color" style="background:${esc(hex)}" data-nodrag data-act="swatch-pick" title="Change color"></div>
        <div class="swatch-info"><div class="swatch-name" data-field="name" data-single data-placeholder="Color name">${esc(c.data.name)}</div>
        <div class="swatch-hex" data-nodrag data-act="swatch-copy" title="Copy">${esc(hex.toUpperCase())}</div><div class="muted small">RGB ${r}, ${g}, ${bl}</div></div>`;
    },
    actions: {
      'swatch-pick'(c, t) {
        const inp = document.createElement('input'); inp.type = 'color'; inp.value = c.data.color;
        inp.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:' + t.getBoundingClientRect().left + 'px;top:' + t.getBoundingClientRect().bottom + 'px';
        document.body.appendChild(inp);
        let first = true;
        inp.oninput = () => { if (first) { A.checkpoint(); first = false; } c.data.color = inp.value; A.changed(); };
        inp.onchange = () => inp.remove();
        inp.click();
        setTimeout(() => { if (document.body.contains(inp) && !first) inp.remove(); }, 60000);
      },
      'swatch-copy'(c) { navigator.clipboard && navigator.clipboard.writeText(c.data.color.toUpperCase()); A.toast('Copied ' + c.data.color.toUpperCase()); },
    },
  };

  T.map = {
    label: 'Map', icon: 'map', w: 340, h: 260, resize: 'wh', editable: true,
    defaults: () => ({ query: '' }),
    render(c, b) {
      if (!c.data.query) {
        b.innerHTML = `<div class="empty-input">${I('map', 16)}<input data-nodrag class="inline-input" placeholder="Search for a place or address…"></div>`;
        const inp = b.querySelector('input');
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && inp.value.trim()) { A.checkpoint(); c.data.query = inp.value.trim(); A.changed(); } });
        return;
      }
      b.innerHTML = `<div class="map-frame"><iframe loading="lazy" src="https://maps.google.com/maps?q=${encodeURIComponent(c.data.query)}&z=13&output=embed"></iframe>${shield()}</div>
        <div class="map-label">${I('map', 13)}<div data-field="query" data-single>${esc(c.data.query)}</div></div>`;
    },
    onDblClick(c) { A.ui.active = c.id; A.render(); },
  };

  /* ---------- Card element filling ---------- */
  A.sigOf = function (c) {
    const extra = [];
    if (c.type === 'board') { const b = A.state.boards[c.data.board] || {}; extra.push(b.title, b.icon, b.color, A.cardsOn(b.id).length); }
    if (c.type === 'link') extra.push(A.ui.playing.has(c.id));
    if (c.type === 'audio') extra.push(!!(A.ui.recording && A.ui.recording.cardId === c.id));
    if (c.type === 'comment' || (c.comments && c.comments.length)) extra.push(Math.floor(Date.now() / 60000));
    let s = JSON.stringify([c.type, c.data, c.color, c.locked, c.w, c.h, c.comments, !!c.columnId, extra]);
    if (c.type === 'column' && !c.data.collapsed) for (const k of A.columnChildren(c.id)) s += '|' + A.sigOf(k);
    else if (c.type === 'column') s += '|' + A.columnChildren(c.id).length;
    return s;
  };

  A.fillCard = function (el, c) {
    const T = A.CardTypes[c.type] || A.CardTypes.note;
    el.className = `card card-${c.type}` + (c.color ? ` color-${c.color}` : '') + (c.locked ? ' locked' : '') + (c.columnId ? ' in-column' : '');
    el.dataset.id = c.id;
    el.innerHTML = '';
    const body = document.createElement('div'); body.className = 'card-body';
    el.appendChild(body);
    try { T.render(c, body, el); } catch (err) { console.error(err); body.textContent = 'Could not display card'; }
    const badges = [];
    if (c.locked) badges.push(`<span class="badge" title="Locked">${I('lock', 11)}</span>`);
    if (c.comments && c.comments.length && c.type !== 'comment') badges.push(`<button class="badge cmt-badge" data-nodrag data-act="open-comments" title="Comments">${I('comment', 11)} ${c.comments.length}</button>`);
    if (badges.length) { const bd = document.createElement('div'); bd.className = 'badges'; bd.innerHTML = badges.join(''); el.appendChild(bd); }
    if (!c.columnId && T.resize && !c.locked) {
      const h = document.createElement('div'); h.className = 'resize-handle ' + (T.resize === 'wh' ? 'rh-wh' : 'rh-w'); h.dataset.resize = T.resize; el.appendChild(h);
    }
    if (!c.locked) { const ch = document.createElement('div'); ch.className = 'connect-handle'; ch.title = 'Drag to connect'; el.appendChild(ch); }
    el.style.width = c.columnId ? '' : (c.w || T.w) + 'px';
    el.style.height = T.resize === 'wh' && !c.columnId && c.h ? c.h + 'px' : '';
  };

  A.rebuildCard = function (id) {
    const c = A.state.cards[id]; const el = A.cardEls.get(id); if (!c || !el) return;
    A._pass = A._pass || new Set();
    A.fillCard(el, c); el._sig = A.sigOf(c);
    if (c.columnId) { const col = A.cardEls.get(c.columnId); if (col) col._sig = A.sigOf(A.state.cards[c.columnId]); }
    A.renderLines && A.renderLines();
  };

  /* ---------- Comments binding ---------- */
  A.bindCommentInput = function (c, root) {
    const ta = root.querySelector('[data-cmt-input]'); if (!ta) return;
    const post = () => {
      const v = ta.value.trim(); if (!v) return;
      A.checkpoint();
      c.comments = c.comments || [];
      c.comments.push({ id: A.uid('m'), author: A.state.settings.name || 'You', text: v, time: A.now() });
      A.log(`Commented on ${A.cardSummary(c)}: “${v.slice(0, 40)}”`);
      ta.value = '';
      if (root.closest('.popover')) { A.changed(); A.renderCommentPopover && A.renderCommentPopover(); return; }
      ta.blur(); A.rebuildCard(c.id); A.changed();
      requestAnimationFrame(() => { const el = A.cardEls.get(c.id); const t = el && el.querySelector('[data-cmt-input]'); t && t.focus(); });
    };
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
    ta.addEventListener('paste', (e) => e.stopPropagation());
    const btn = root.querySelector('[data-act="cmt-post"]');
    if (btn) { btn.removeAttribute('data-act'); btn.addEventListener('click', (e) => { e.stopPropagation(); post(); }); btn.setAttribute('data-nodrag', ''); }
  };

  /* ---------- Inline editing ---------- */
  const plainOK = (() => { const d = document.createElement('div'); try { d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; } catch (e) { return false; } })();

  function placeCaret(x, y, el) {
    let r = null;
    if (x != null) {
      if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
      else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); } }
    }
    if (!r || !el.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  A.beginEdit = function (el, cardId, e) {
    if (A.ui.editing && A.ui.editing.el === el) return;
    A.endEdit();
    const c = A.state.cards[cardId]; if (!c || c.locked) return;
    A.checkpoint();
    const rich = el.hasAttribute('data-rich');
    el.contentEditable = rich ? 'true' : (plainOK ? 'plaintext-only' : 'true');
    el.classList.add('editing');
    const cardEl = el.closest('.card'); if (cardEl) cardEl.classList.add('is-editing');
    A.ui.editing = { el, cardId, rich, startValue: rich ? el.innerHTML : el.textContent };
    el.focus({ preventScroll: true });
    placeCaret(e ? e.clientX : null, e ? e.clientY : null, el);
    if (rich) A.showFormatBar && A.showFormatBar(el);
    A.hideSelBar && A.hideSelBar();
  };

  A.focusField = function (cardId, selector) {
    requestAnimationFrame(() => {
      const el = A.cardEls.get(cardId); if (!el) return;
      const f = el.querySelector(selector); if (f) A.beginEdit(f, cardId);
    });
  };

  A.commitEdit = function () {
    const ed = A.ui.editing; if (!ed) return;
    const c = A.state.cards[ed.cardId]; if (!c) return;
    const T = A.CardTypes[c.type];
    const val = ed.rich ? ed.el.innerHTML : ed.el.innerText.replace(/\n$/, '');
    if (ed.rich && !A.textOf(val) && !/<(img|hr|li)/i.test(val)) {
      if (T.onEdit) T.onEdit(c, ed.el, ''); else c.data[ed.el.dataset.field] = '';
    } else if (T.onEdit) T.onEdit(c, ed.el, val);
    else c.data[ed.el.dataset.field] = val;
    c.updated = A.now();
    A.save();
    A.renderLines && A.renderLines();
  };

  A.endEdit = function (silent) {
    const ed = A.ui.editing; if (!ed) return;
    if (!silent) A.commitEdit();
    A.ui.editing = null;
    ed.el.contentEditable = 'false';
    ed.el.classList.remove('editing');
    const cardEl = ed.el.closest('.card'); if (cardEl) cardEl.classList.remove('is-editing');
    if (document.activeElement === ed.el) ed.el.blur();
    A.hideFormatBar && A.hideFormatBar();
    A.requestRender();
  };

  document.addEventListener('input', (e) => {
    if (A.ui.editing && (e.target === A.ui.editing.el || A.ui.editing.el.contains(e.target))) A.commitEdit();
  });
  document.addEventListener('focusout', (e) => {
    const ed = A.ui.editing;
    if (ed && e.target === ed.el) {
      setTimeout(() => { if (A.ui.editing === ed && document.activeElement !== ed.el) A.endEdit(); }, 0);
    }
  });
  // paste inside editors: sanitize
  document.addEventListener('paste', (e) => {
    const ed = A.ui.editing; if (!ed || !ed.el.contains(e.target)) return;
    e.stopPropagation(); e.preventDefault();
    const html = e.clipboardData.getData('text/html'), text = e.clipboardData.getData('text/plain');
    if (ed.rich && html) document.execCommand('insertHTML', false, A.sanitize(html));
    else document.execCommand('insertText', false, text);
  }, true);

  A.handleEditKey = function (e) {
    const ed = A.ui.editing; if (!ed) return false;
    const c = A.state.cards[ed.cardId]; if (!c) return false;
    const T = A.CardTypes[c.type];
    if (e.key === 'Escape') { e.preventDefault(); A.endEdit(); return true; }
    if (T.onKey && T.onKey(c, ed.el, e)) return true;
    if (ed.el.hasAttribute('data-single') && e.key === 'Enter') { e.preventDefault(); A.endEdit(); return true; }
    if (ed.rich && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); A.formatCmd && A.formatCmd('link'); return true; }
    if (ed.rich && e.key === ' ') return A.markdownShortcut && A.markdownShortcut(e);
    return false;
  };

  // markdown-style shortcuts at the start of a line
  A.markdownShortcut = function (e) {
    const sel = window.getSelection(); if (!sel.rangeCount) return false;
    const node = sel.anchorNode; if (!node || node.nodeType !== 3) return false;
    const before = node.textContent.slice(0, sel.anchorOffset);
    const map = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'ul', '*': 'ul', '1.': 'ol', '>': 'blockquote', '[]': 'todo' };
    const cmd = map[before.trim()];
    if (!cmd || before !== before.trimStart()) return false;
    // ensure we are at the start of a block
    e.preventDefault();
    const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, sel.anchorOffset); sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('delete');
    if (cmd === 'ul') document.execCommand('insertUnorderedList');
    else if (cmd === 'ol') document.execCommand('insertOrderedList');
    else if (cmd === 'todo') document.execCommand('insertText', false, '☐ ');
    else document.execCommand('formatBlock', false, '<' + cmd + '>');
    A.commitEdit();
    return true;
  };
})();
