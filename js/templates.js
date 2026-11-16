/* Templates & starter workspace */
(function () {
  'use strict';
  const A = window.App;
  const esc = A.esc;
  const I = (n, s) => A.icon(n, s);

  function builder() {
    const s = { boards: [], cards: [], lines: [] }; let n = 0;
    const id = (p) => p + '_tpl' + n++;
    const api = {
      s,
      board(title, parent, opt = {}) { const b = { id: id('b'), title, parentId: parent, icon: opt.icon || '', color: opt.color || 'blue', view: { x: 0, y: 0, z: 1 } }; s.boards.push(b); return b.id; },
      card(type, bid, x, y, data = {}, ex = {}) {
        const T = A.CardTypes[type];
        const c = { id: id('c'), type, boardId: bid, x, y, w: ex.w || T.w, h: ex.h || T.h || null, z: n, color: ex.color || null, locked: false, data: Object.assign(T.defaults(), data), comments: ex.comments || [] };
        if (ex.col) { c.columnId = ex.col; c.order = n; }
        s.cards.push(c); return c.id;
      },
      sub(bid, x, y, title, opt = {}) { const nb = api.board(title, bid, opt); api.card('board', bid, x, y, { board: nb }); return nb; },
      note(bid, x, y, html, ex) { return api.card('note', bid, x, y, { html }, ex); },
      todo(bid, x, y, title, items, ex) { return api.card('todo', bid, x, y, { title, items: items.map((t) => ({ id: A.uid('t'), text: typeof t === 'string' ? t.replace(/^\[x\]\s*/, '') : t.text, done: /^\[x\]/.test(t), due: t.due || null })) }, ex); },
      column(bid, x, y, title, fill, ex) { const cid = api.card('column', bid, x, y, { title }, ex); fill && fill(cid); return cid; },
      line(bid, a, b, opt = {}) { s.lines.push({ id: id('l'), boardId: bid, from: typeof a === 'string' ? { card: a } : a, to: typeof b === 'string' ? { card: b } : b, color: null, width: 2, style: 'solid', arrowEnd: true, arrowStart: false, label: '', bend: { x: 0, y: 0 }, ...opt }); },
    };
    return api;
  }
  A.templateBuilder = builder;

  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  A.TEMPLATES = [
    { id: 'blank', name: 'Blank board', desc: 'Start from an empty canvas', icon: '', color: 'blue', build() {} },
    {
      id: 'kanban', name: 'Project plan', desc: 'To do, doing and done columns with tasks', icon: '🚀', color: 'purple',
      build(b, R) {
        b.note(R, 0, -130, '<h1>Project plan</h1><p>Drag cards between columns as work progresses.</p>', { w: 420, color: 'clear' });
        b.column(R, 0, 0, 'To do', (c) => { b.note(R, 0, 0, '<p><b>Research</b> competitors</p>', { col: c }); b.note(R, 0, 0, '<p>Write the project brief</p>', { col: c, color: 'yellow' }); b.todo(R, 0, 0, 'Kick-off', ['Book meeting room', 'Send agenda', 'Prepare slides'], { col: c }); });
        b.column(R, 320, 0, 'Doing', (c) => { b.note(R, 0, 0, '<p>Design first wireframes</p>', { col: c, color: 'blue' }); b.note(R, 0, 0, '<p>Collect user feedback</p>', { col: c }); });
        b.column(R, 640, 0, 'Done', (c) => { b.note(R, 0, 0, '<p><s>Define goals</s></p>', { col: c, color: 'green' }); });
        b.column(R, 960, 0, 'Notes & files', (c) => { b.card('link', R, 0, 0, { url: 'https://en.wikipedia.org/wiki/Kanban_board', title: 'Kanban board', desc: 'Background reading' }, { col: c }); });
      },
    },
    {
      id: 'mindmap', name: 'Mind map', desc: 'A central idea with connected branches', icon: '🧠', color: 'pink',
      build(b, R) {
        const c = b.note(R, 380, 260, '<h2 style="text-align:center">Central idea</h2>', { w: 220, color: 'purple' });
        const br = [[0, 40, 'Branch one', 'blue'], [760, 40, 'Branch two', 'green'], [0, 470, 'Branch three', 'orange'], [760, 470, 'Branch four', 'pink']];
        br.forEach(([x, y, t, col]) => {
          const n = b.note(R, x, y, `<h3>${t}</h3><p>Add thoughts…</p>`, { w: 220, color: col });
          b.line(R, c, n, { arrowEnd: false, bend: { x: 0, y: (y < 200 ? -1 : 1) * 30 } });
          const leaf = b.note(R, x + (x ? 260 : -250), y + 40, '<p>Sub-idea</p>', { w: 180 });
          b.line(R, n, leaf, { arrowEnd: false, style: 'dashed' });
        });
      },
    },
    {
      id: 'flow', name: 'Flowchart', desc: 'Steps, decisions and arrows', icon: '🧩', color: 'teal',
      build(b, R) {
        const s = b.note(R, 300, 0, '<p style="text-align:center"><b>Start</b></p>', { w: 180, color: 'green' });
        const a = b.note(R, 300, 120, '<p style="text-align:center">Collect input</p>', { w: 180 });
        const d = b.note(R, 300, 250, '<p style="text-align:center"><b>Is it valid?</b></p>', { w: 180, color: 'yellow' });
        const y = b.note(R, 560, 380, '<p style="text-align:center">Process request</p>', { w: 180 });
        const n = b.note(R, 40, 380, '<p style="text-align:center">Show error</p>', { w: 180, color: 'red' });
        const e = b.note(R, 560, 520, '<p style="text-align:center"><b>End</b></p>', { w: 180, color: 'green' });
        b.line(R, s, a); b.line(R, a, d); b.line(R, d, y, { label: 'Yes' }); b.line(R, d, n, { label: 'No' }); b.line(R, y, e); b.line(R, n, a, { style: 'dashed', label: 'Retry', bend: { x: -120, y: 0 } });
      },
    },
    {
      id: 'mood', name: 'Moodboard', desc: 'Collect images, colours and inspiration', icon: '🎨', color: 'orange',
      build(b, R) {
        b.note(R, 0, -120, '<h1>Moodboard</h1><p>Drop images here, add colours and notes about the feeling you want.</p>', { w: 460, color: 'clear' });
        [['#2F3437', 'Charcoal'], ['#F4EDE4', 'Linen'], ['#D98E73', 'Terracotta'], ['#7A9E7E', 'Sage'], ['#E8C468', 'Mustard']].forEach(([c, nme], i) => b.card('swatch', R, i * 196, 0, { color: c.toLowerCase(), name: nme }));
        b.card('image', R, 0, 150, {}, { w: 300 }); b.card('image', R, 320, 150, {}, { w: 240 }); b.card('image', R, 580, 150, {}, { w: 380 });
        b.note(R, 0, 420, '<h3>Keywords</h3><p>Warm · tactile · calm · natural light</p>', { w: 300, color: 'yellow' });
        b.note(R, 320, 420, '<h3>Typography</h3><p>Serif headings, generous spacing.</p>', { w: 300 });
      },
    },
    {
      id: 'brainstorm', name: 'Brainstorm', desc: 'Colourful sticky notes for quick ideas', icon: '💡', color: 'yellow',
      build(b, R) {
        b.note(R, 0, -120, '<h1>Brainstorm</h1><p>No bad ideas. Double-click anywhere to add one.</p>', { w: 460, color: 'clear' });
        const cols = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'];
        ['What problem are we solving?', 'Who is it for?', 'Crazy idea #1', 'What would make this 10× better?', 'Quick win', 'Open question'].forEach((t, i) => b.note(R, (i % 3) * 230, Math.floor(i / 3) * 190, `<p>${t}</p>`, { w: 200, color: cols[i] }));
        b.card('comment', R, 720, 0, {}, { comments: [{ id: A.uid('m'), author: 'Facilitator', text: 'Vote on your favourite ideas by commenting!', time: Date.now() }] });
      },
    },
    {
      id: 'week', name: 'Weekly planner', desc: 'A column for every day of the week', icon: '📅', color: 'green',
      build(b, R) {
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach((d, i) => b.column(R, i * 300, 0, d, (c) => { b.todo(R, 0, 0, 'Tasks', [''], { col: c }); }, { w: 280 }));
        b.note(R, 0, -130, '<h1>This week</h1><p>Top 3 priorities: …</p>', { w: 500, color: 'clear' });
      },
    },
    {
      id: 'story', name: 'Storyboard', desc: 'Frames for scenes with notes', icon: '🎬', color: 'red',
      build(b, R) {
        b.note(R, 0, -120, '<h1>Storyboard</h1><p>Click a frame to sketch the shot.</p>', { w: 460, color: 'clear' });
        let prev = null;
        for (let i = 0; i < 4; i++) { const sk = b.card('sketch', R, i * 360, 0, {}, { w: 320 }); b.note(R, i * 360, 250, `<p><b>Scene ${i + 1}</b> — describe the action, camera and sound.</p>`, { w: 320 }); if (prev) b.line(R, prev, sk); prev = sk; }
      },
    },
    {
      id: 'meeting', name: 'Meeting notes', desc: 'Agenda, notes and action items', icon: '💬', color: 'blue',
      build(b, R) {
        b.note(R, 0, 0, `<h1>Meeting — ${new Date().toLocaleDateString()}</h1><p><b>Attendees:</b> …</p><h2>Agenda</h2><ol><li>Updates</li><li>Decisions</li><li>Next steps</li></ol>`, { w: 360 });
        b.card('document', R, 400, 0, { title: 'Detailed notes', html: '<h2>Discussion</h2><p>Write notes here…</p>' });
        b.todo(R, 400, 220, 'Action items', [{ text: 'Share the summary', due: day(1) }, { text: 'Follow up with the team', due: day(3) }]);
        b.card('comment', R, 0, 300, {});
      },
    },
    {
      id: 'travel', name: 'Trip planner', desc: 'Itinerary by day, places and packing list', icon: '✈️', color: 'teal',
      build(b, R) {
        b.note(R, 0, -130, '<h1>Trip planner</h1><p>Dates, flights and bookings.</p>', { w: 460, color: 'clear' });
        b.card('map', R, 0, 0, { query: 'Lisbon, Portugal' }, { w: 380, h: 280 });
        ['Day 1', 'Day 2', 'Day 3'].forEach((d, i) => b.column(R, 420 + i * 300, 0, d, (c) => { b.note(R, 0, 0, '<p>Morning: …</p>', { col: c }); b.note(R, 0, 0, '<p>Afternoon: …</p>', { col: c }); }, { w: 280 }));
        b.todo(R, 0, 320, 'Packing list', ['Passport', 'Chargers', 'Comfortable shoes', 'Sunscreen']);
      },
    },
    {
      id: 'research', name: 'Research board', desc: 'Links, sources, quotes and findings', icon: '📚', color: 'grey',
      build(b, R) {
        b.note(R, 0, -120, '<h1>Research</h1><p>Question: …</p>', { w: 460, color: 'clear' });
        b.column(R, 0, 0, 'Sources', (c) => { b.card('link', R, 0, 0, { url: 'https://scholar.google.com', title: 'Scholar search' }, { col: c }); b.card('link', R, 0, 0, { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Reference video' }, { col: c }); });
        b.column(R, 320, 0, 'Quotes', (c) => { b.note(R, 0, 0, '<blockquote>“A memorable quote goes here.”</blockquote><p>— Source</p>', { col: c, color: 'yellow' }); });
        const f = b.card('document', R, 640, 0, { title: 'Findings', html: '<h2>Summary</h2><p>…</p>' });
        b.card('table', R, 640, 220, { title: 'Comparison', rows: [['Option', 'Pros', 'Cons'], ['A', '', ''], ['B', '', '']] });
      },
    },
    {
      id: 'roadmap', name: 'Product roadmap', desc: 'Now, next and later', icon: '🗺️', color: 'purple',
      build(b, R) {
        [['Now', 'green'], ['Next', 'yellow'], ['Later', 'grey']].forEach(([t, col], i) => b.column(R, i * 320, 0, t, (c) => { b.note(R, 0, 0, '<p><b>Feature</b> — short description</p>', { col: c, color: col }); b.note(R, 0, 0, '<p><b>Improvement</b></p>', { col: c }); }));
      },
    },
    {
      id: 'retro', name: 'Retrospective', desc: 'What went well, what to improve, actions', icon: '🔁', color: 'pink',
      build(b, R) {
        b.column(R, 0, 0, '😀 Went well', (c) => b.note(R, 0, 0, '<p>…</p>', { col: c, color: 'green' }));
        b.column(R, 320, 0, '🤔 To improve', (c) => b.note(R, 0, 0, '<p>…</p>', { col: c, color: 'orange' }));
        b.column(R, 640, 0, '🎯 Actions', (c) => b.todo(R, 0, 0, '', [''], { col: c }));
      },
    },
    {
      id: 'calendar', name: 'Content calendar', desc: 'Plan posts in a simple table', icon: '🗓️', color: 'blue',
      build(b, R) {
        b.card('table', R, 0, 0, { title: 'Content calendar', rows: [['Date', 'Channel', 'Topic', 'Status'], [day(1), 'Blog', '', 'Draft'], [day(3), 'Newsletter', '', 'Idea'], [day(6), 'Social', '', 'Idea']] }, { w: 640 });
        b.column(R, 680, 0, 'Ideas backlog', (c) => { b.note(R, 0, 0, '<p>Idea…</p>', { col: c, color: 'yellow' }); });
      },
    },
  ];

  A.applyTemplate = function (tid, at) {
    const t = A.TEMPLATES.find((x) => x.id === tid); if (!t) return;
    const b = builder();
    const inner = b.sub('ROOT', 0, 0, t.id === 'blank' ? 'New board' : t.name, { icon: t.icon, color: t.color });
    t.build(b, inner);
    A.checkpoint();
    const p = at || A.spawnPoint(128);
    const ids = A.instantiate(b.s, A.ui.boardId, p.x, p.y);
    const card = A.state.cards[ids[0]];
    A.log(`Created “${t.name}” from a template`);
    A.changed();
    return card;
  };
  A.openTemplates = function () {
    const body = A.h(`<div class="tpl-grid">${A.TEMPLATES.map((t) => `<button class="tpl" data-tpl="${t.id}"><div class="tpl-art" style="--bc:${A.BOARD_HEX[t.color]}">${t.icon ? `<span>${t.icon}</span>` : I('plus', 28)}</div><div class="tpl-name">${esc(t.name)}</div><div class="muted small">${esc(t.desc)}</div></button>`).join('')}</div>`);
    const m = A.modal({ title: 'Start from a template', body, wide: true });
    body.onclick = (e) => {
      const b = e.target.closest('[data-tpl]'); if (!b) return;
      m.close();
      const card = A.applyTemplate(b.dataset.tpl);
      if (card) setTimeout(() => A.openBoard(card.data.board), 60);
    };
  };

  /* ---------- starter workspace ---------- */
  A.seed = function () {
    const S = A.state;
    const root = A.createBoard('Home', null, { icon: '🏠', color: 'blue' });
    S.rootId = root.id;
    const b = builder();
    const R = 'ROOT';
    b.note(R, 0, 0, `<h1>Welcome 👋</h1><p>This is your visual workspace. Everything is a card on an infinite canvas — organise ideas, plan projects and build diagrams.</p><ul><li><b>Drag</b> anything from the toolbar on the left</li><li><b>Double-click</b> the canvas to add a note</li><li><b>Paste</b> images, links or text</li><li>Open a <b>board</b> to go one level deeper — boards can contain boards, forever.</li></ul>`, { w: 360 });
    // nested boards demo
    const g = b.sub(R, 400, 0, 'Getting started', { icon: '📝', color: 'green' });
    b.note(g, 0, 0, '<h2>Cards</h2><p>Notes, to-dos, links, images, files, tables, documents, sketches, colours, maps, audio and comments.</p>', { w: 300 });
    b.todo(g, 330, 0, 'Try these', ['Drag a card onto a board to move it inside', 'Connect two cards with a line', '[x] Open this board', 'Group cards in a column', 'Right-click a card for more options', 'Press ? for keyboard shortcuts']);
    const deep = b.sub(g, 0, 220, 'Diagram inside a diagram', { icon: '🧩', color: 'teal' });
    const n1 = b.note(deep, 0, 0, '<p style="text-align:center"><b>Idea</b></p>', { w: 160, color: 'yellow' });
    const n2 = b.note(deep, 260, 0, '<p style="text-align:center"><b>Plan</b></p>', { w: 160, color: 'blue' });
    const n3 = b.note(deep, 520, 0, '<p style="text-align:center"><b>Build</b></p>', { w: 160, color: 'green' });
    b.line(deep, n1, n2, { label: 'refine' }); b.line(deep, n2, n3);
    const deeper = b.sub(deep, 260, 140, 'Even deeper', { icon: '🔍', color: 'purple' });
    b.note(deeper, 0, 0, '<p>Boards nest without limit. Use the breadcrumbs at the top to climb back out.</p>', { w: 300 });
    // projects
    const proj = b.sub(R, 560, 0, 'Projects', { icon: '🚀', color: 'purple' });
    b.column(proj, 0, 0, 'Ideas', (c) => { b.note(proj, 0, 0, '<p>Redesign the website</p>', { col: c, color: 'yellow' }); b.note(proj, 0, 0, '<p>Start a podcast</p>', { col: c }); });
    b.column(proj, 320, 0, 'In progress', (c) => { b.todo(proj, 0, 0, 'Launch checklist', [{ text: 'Finalize copy', due: day(2) }, '[x] Pick a name', { text: 'Ship it', due: day(7) }], { col: c }); });
    const mood = b.sub(R, 720, 0, 'Inspiration', { icon: '🎨', color: 'orange' });
    [['#4c8dff', 'Ocean'], ['#ff8a3d', 'Sunset'], ['#45b85a', 'Fern']].forEach(([c, nm], i) => b.card('swatch', mood, i * 200, 0, { color: c, name: nm }));
    b.card('link', mood, 0, 150, { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Open movie', desc: 'Links to videos play right on the board.' });
    // diagram on home
    const a = b.note(R, 400, 220, '<p style="text-align:center"><b>Capture</b></p>', { w: 170, color: 'yellow' });
    const c2 = b.note(R, 640, 220, '<p style="text-align:center"><b>Organise</b></p>', { w: 170, color: 'blue' });
    const d2 = b.note(R, 880, 220, '<p style="text-align:center"><b>Create</b></p>', { w: 170, color: 'green' });
    b.line(R, a, c2); b.line(R, c2, d2);
    b.column(R, 0, 380, 'Quick notes', (c) => { b.note(R, 0, 0, '<p>Columns keep related cards together. Drag cards in and out.</p>', { col: c }); b.card('swatch', R, 0, 0, { color: '#8e6bf0', name: 'Brand purple' }, { col: c }); });
    b.todo(R, 400, 380, 'Today', ['Explore the toolbar', 'Create your first board', 'Invite your team']);
    b.card('comment', R, 700, 380, {}, { comments: [{ id: A.uid('m'), author: 'Tip', text: 'Comments can be added to any card from the right-click menu.', time: Date.now() }] });
    A.ui.boardId = root.id;
    A.instantiate(b.s, root.id, 0, 0);
    // mark root's child boards as fit-on-first-open
  };
})();
