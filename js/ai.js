/* AI: flow diagrams and documentation with Claude, plus token & cost tracking */
(function () {
  'use strict';
  const A = window.App;
  const esc = A.esc;
  const I = (n, s) => A.icon(n, s);

  /* ---------- models & prices (USD per 1M tokens, Claude API list prices, Nov 2026) ---------- */
  A.AI_MODELS = {
    'claude-opus-5-5': { label: 'Claude Opus 5.5', note: 'Best quality (default)', in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5, fallbacks: 'default' },
    'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', note: 'Faster, half the price', in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5, fallbacks: 'default' },
    'claude-haiku-5-5': { label: 'Claude Haiku 5.5', note: 'Cheapest, simpler output', in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longIn: 0.5, longOut: 2.5, longAt: 100000, fallbacks: null },
  };
  // Models that may answer via server-side fallback; priced so the ledger stays exact.
  const FALLBACK_PRICES = {
    'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-opus-4-8': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  };
  const TYPICAL_OUTPUT = { diagram: 3000, document: 3500, both: 6500 }; // includes thinking

  function priceOf(model, promptTokens) {
    const p = A.AI_MODELS[model] || FALLBACK_PRICES[model];
    if (!p) return null;
    if (p.longAt && promptTokens > p.longAt) return { ...p, in: p.longIn, out: p.longOut, cacheRead: p.cacheRead * 5, cacheWrite: p.cacheWrite * 5 };
    return p;
  }
  function usageCost(u, model) {
    const prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const p = priceOf(model, prompt); if (!p) return { cost: 0, known: false };
    const cost = ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + (u.cache_read_input_tokens || 0) * p.cacheRead + (u.cache_creation_input_tokens || 0) * p.cacheWrite) / 1e6;
    return { cost, known: true };
  }
  // Cost of a whole response. usage.iterations (when present) holds every attempt,
  // including a fallback model that answered after a decline, each with its own model.
  A.aiMessageCost = function (msg, requestedModel) {
    const u = msg.usage || {};
    const its = Array.isArray(u.iterations) ? u.iterations.filter((x) => x && typeof x.input_tokens === 'number') : [];
    const parts = its.length ? its.map((x) => ({ u: x, model: x.model || msg.model || requestedModel })) : [{ u, model: msg.model || requestedModel }];
    let cost = 0, known = true, input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
    for (const p of parts) {
      const c = usageCost(p.u, p.model); cost += c.cost; known = known && c.known;
      input += p.u.input_tokens || 0; output += p.u.output_tokens || 0;
      cacheRead += p.u.cache_read_input_tokens || 0; cacheWrite += p.u.cache_creation_input_tokens || 0;
    }
    const thinking = (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0;
    const servedBy = msg.model || requestedModel;
    const fellBack = its.some((x) => x.type === 'fallback_message');
    return { cost, known, input, output, cacheRead, cacheWrite, thinking, servedBy, fellBack, attempts: parts.length };
  };

  A.fmtUSD = (n) => n === 0 ? '$0.00' : n < 0.01 ? '$' + n.toFixed(4) : n < 1 ? '$' + n.toFixed(3) : '$' + n.toFixed(2);
  A.fmtNum = (n) => Number(n || 0).toLocaleString();

  /* ---------- settings ---------- */
  const settings = () => (A.state.settings.ai = Object.assign({ model: 'claude-opus-5-5', effort: 'medium', budget: 0 }, A.state.settings.ai || {}));
  A.state && settings();

  /* ---------- transport: Electron bridge (preferred) or browser SDK ---------- */
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.9.0/+esm';
  const LS_KEY = 'mina-notes-ai-key';
  let browserSDK = null, browserClient = null;
  const isDesktop = () => !!window.minaAI;

  async function getBrowserClient() {
    let key = ''; try { key = localStorage.getItem(LS_KEY) || ''; } catch (e) {}
    if (!key) return null;
    if (!browserSDK) browserSDK = await import(SDK_URL);
    if (!browserClient) {
      const Anthropic = browserSDK.default || browserSDK.Anthropic;
      browserClient = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    }
    return browserClient;
  }
  function browserError(err) {
    const S = browserSDK && (browserSDK.default || browserSDK.Anthropic);
    if (S) {
      if (err instanceof S.AuthenticationError) return { kind: 'auth', status: 401, message: 'The API key was rejected.' };
      if (err instanceof S.RateLimitError) return { kind: 'rate_limit', status: 429, message: 'Rate limited — wait a moment and try again.' };
      if (err instanceof S.BadRequestError) return { kind: 'bad_request', status: 400, message: err.message };
      if (err instanceof S.APIUserAbortError) return { kind: 'aborted', message: 'Cancelled.' };
      if (err instanceof S.APIConnectionError) return { kind: 'network', message: 'Could not reach the Claude API. Check your internet connection.' };
      if (err instanceof S.APIError) return { kind: 'api', status: err.status, message: err.message };
    }
    return { kind: 'unknown', message: (err && err.message) || String(err) };
  }
  const noKey = { ok: false, error: { kind: 'no_key', message: 'Add your Claude API key in AI settings first.' } };
  const browserStreams = new Map();

  A.ai = {
    isDesktop,
    async keyStatus() {
      if (isDesktop()) return window.minaAI.keyStatus();
      let k = ''; try { k = localStorage.getItem(LS_KEY) || ''; } catch (e) {}
      return { hasKey: !!k, encrypted: false };
    },
    async setKey(k) {
      if (isDesktop()) return window.minaAI.setKey(k);
      try { localStorage.setItem(LS_KEY, k.trim()); browserClient = null; return { ok: true }; } catch (e) { return { ok: false, error: { message: e.message } }; }
    },
    async clearKey() {
      if (isDesktop()) return window.minaAI.clearKey();
      try { localStorage.removeItem(LS_KEY); } catch (e) {} browserClient = null; return { ok: true };
    },
    async count(params) {
      if (isDesktop()) return window.minaAI.count(params);
      try { const c = await getBrowserClient(); if (!c) return noKey; return { ok: true, result: await c.messages.countTokens(params) }; }
      catch (e) { return { ok: false, error: browserError(e) }; }
    },
    async create(params) {
      if (isDesktop()) return window.minaAI.create(params);
      try { const c = await getBrowserClient(); if (!c) return noKey; return { ok: true, result: await c.beta.messages.create(params) }; }
      catch (e) { return { ok: false, error: browserError(e) }; }
    },
    async stream(params, onText) {
      const id = A.uid('rq');
      if (isDesktop()) {
        const off = window.minaAI.onDelta((m) => { if (m.id === id) onText(m.delta); });
        A.ai._current = id;
        try { return await window.minaAI.stream(id, params); } finally { off(); A.ai._current = null; }
      }
      try {
        const c = await getBrowserClient(); if (!c) return noKey;
        const s = c.beta.messages.stream(params);
        browserStreams.set(id, s); A.ai._current = id;
        s.on('text', (d) => onText(d));
        return { ok: true, result: await s.finalMessage() };
      } catch (e) { return { ok: false, error: browserError(e) }; }
      finally { browserStreams.delete(id); A.ai._current = null; }
    },
    cancel() {
      const id = A.ai._current; if (!id) return;
      if (isDesktop()) window.minaAI.cancel(id); else { const s = browserStreams.get(id); if (s) s.abort(); }
    },
  };

  /* ---------- request building ---------- */
  function baseParams(maxTokens) {
    const s = settings(); const m = A.AI_MODELS[s.model] || A.AI_MODELS['claude-opus-5-5'];
    const p = { model: s.model, max_tokens: maxTokens, output_config: { effort: s.effort } };
    // Server-side fallback: if the model declines on policy grounds, the API retries on
    // Anthropic's recommended fallback model in the same call. Not offered for Haiku.
    if (m.fallbacks) { p.betas = ['server-side-fallback-2026-07-01']; p.fallbacks = m.fallbacks; }
    return p;
  }

  const DIAGRAM_SCHEMA = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for the diagram' },
      summary: { type: 'string', description: 'One or two sentences describing the flow' },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Short unique slug, e.g. "check_email"' },
            label: { type: 'string', description: 'Node text, at most about 6 words' },
            kind: { type: 'string', enum: ['start', 'end', 'process', 'decision', 'input_output', 'subprocess', 'note'] },
            detail: { type: 'string', description: 'Optional one-sentence explanation, or empty string' },
          },
          required: ['id', 'label', 'kind', 'detail'],
          additionalProperties: false,
        },
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            label: { type: 'string', description: 'e.g. "Yes", "No", or empty string' },
          },
          required: ['from', 'to', 'label'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'summary', 'nodes', 'edges'],
    additionalProperties: false,
  };

  const DIAGRAM_SYSTEM = `You design clear, accurate flowcharts for a visual whiteboard app.
Return one flowchart for the user's request.
- Use between 4 and 24 nodes; prefer fewer, clearer steps.
- Begin with a "start" node and finish with one or more "end" nodes.
- Phrase "decision" nodes as short questions; label each outgoing edge of a decision (for example "Yes" / "No").
- Every node except end nodes needs at least one outgoing edge. Loops back to earlier steps are allowed.
- Keep labels short (about 6 words). Put any explanation in "detail" as one sentence, or leave it empty.
- Use "input_output" for data entering or leaving the system, "subprocess" for a step that is its own process, and "note" only for side remarks.`;

  const DOC_SYSTEM = `You write clear, well-organised documentation in Markdown for a notes app.
- Start with a single "# " title line, then the content. No preamble or closing remarks.
- Use "## " section headings, short paragraphs, bullet lists, numbered steps for procedures, and tables only when they genuinely help.
- Be concrete and accurate. If the request is ambiguous, state a reasonable assumption briefly in the text.
- Do not wrap the whole answer in a code block.`;

  function boardContext() {
    const md = A.boardToMarkdown(A.ui.boardId);
    return md.length > 400000 ? null : md; // ~100K tokens: too large to send whole
  }

  function buildDiagramRequest(prompt, useBoard) {
    let content = prompt;
    if (useBoard) { const ctx = boardContext(); if (ctx) content = `Context — the current board:\n<board>\n${ctx}\n</board>\n\nRequest: ${prompt}`; }
    return { ...baseParams(16000), system: DIAGRAM_SYSTEM, messages: [{ role: 'user', content }], output_config: { ...baseParams(0).output_config, format: { type: 'json_schema', schema: DIAGRAM_SCHEMA } } };
  }
  function buildDocRequest(prompt, useBoard, diagram) {
    let content = prompt;
    if (diagram) content = `Write documentation for this process. The flowchart (JSON):\n<flowchart>\n${JSON.stringify(diagram)}\n</flowchart>\n\nOriginal request: ${prompt}`;
    else if (useBoard) { const ctx = boardContext(); if (ctx) content = `Context — the current board:\n<board>\n${ctx}\n</board>\n\nRequest: ${prompt}`; }
    return { ...baseParams(64000), system: DOC_SYSTEM, messages: [{ role: 'user', content }] };
  }
  const countParams = (p) => ({ model: p.model, system: p.system, messages: p.messages });

  /* ---------- usage ledger ---------- */
  const ledger = () => (A.state.aiUsage = A.state.aiUsage || []);
  function record(feature, msg, requestedModel, extra = {}) {
    const c = A.aiMessageCost(msg, requestedModel);
    const row = { id: A.uid('u'), time: A.now(), feature, model: c.servedBy, requested: requestedModel, input: c.input, output: c.output, thinking: c.thinking, cacheRead: c.cacheRead, cacheWrite: c.cacheWrite, cost: c.cost, priced: c.known, fellBack: c.fellBack, stop: msg.stop_reason, boardId: A.ui.boardId, ...extra };
    ledger().unshift(row); if (ledger().length > 2000) ledger().length = 2000;
    A.save(); A.updateAIBadge();
    if (A.panelOpen === 'ai') A.renderAIUsage();
    return row;
  }
  function totals(since) {
    const t = { n: 0, input: 0, output: 0, thinking: 0, cost: 0 };
    for (const r of ledger()) if (r.time >= since) { t.n++; t.input += r.input + (r.cacheRead || 0) + (r.cacheWrite || 0); t.output += r.output; t.thinking += r.thinking || 0; t.cost += r.cost; }
    return t;
  }
  const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const startOfMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); };
  A.aiMonthCost = () => totals(startOfMonth()).cost;
  A.updateAIBadge = function () {
    const b = document.getElementById('ai-usage-btn'); if (!b) return;
    const m = A.aiMonthCost(); const s = settings();
    b.querySelector('span').textContent = A.fmtUSD(m);
    b.classList.toggle('over', !!s.budget && m >= s.budget);
    b.title = `AI usage this month: ${A.fmtUSD(m)}${s.budget ? ` of ${A.fmtUSD(s.budget)} budget` : ''} — click for details`;
  };

  /* ---------- markdown → HTML (for generated documents) ---------- */
  A.mdToHtml = function (md) {
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const lines = (md || '').replace(/\r/g, '').split('\n');
    let out = '', i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { let code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; out += `<pre>${esc(code.join('\n'))}</pre>`; continue; }
      const h = l.match(/^(#{1,6})\s+(.*)$/); if (h) { const n = Math.min(3, h[1].length); out += `<h${n}>${inline(h[2])}</h${n}>`; i++; continue; }
      if (/^\s*([-*+])\s+/.test(l)) { out += '<ul>'; while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, (m, cb) => cb ? (/x/i.test(cb) ? '☑ ' : '☐ ') : ''))}</li>`; i++; } out += '</ul>'; continue; }
      if (/^\s*\d+[.)]\s+/.test(l)) { out += '<ol>'; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</li>`; i++; } out += '</ol>'; continue; }
      if (/^>\s?/.test(l)) { let q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, '')); out += `<blockquote>${inline(q.join(' '))}</blockquote>`; continue; }
      if (/^\|.*\|\s*$/.test(l)) {
        let rows = []; while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        rows = rows.filter((r) => !/^\|[\s:|-]+\|\s*$/.test(r)).map((r) => r.trim().slice(1, -1).split('|').map((c) => c.trim()));
        out += '<pre>' + esc(rows.map((r) => r.join('  |  ')).join('\n')) + '</pre>'; continue;
      }
      if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out += '<hr>'; i++; continue; }
      if (!l.trim()) { i++; continue; }
      let para = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|>|\|)/.test(lines[i])) para.push(lines[i++]);
      if (!para.length) { para.push(lines[i++]); }
      out += `<p>${para.map(inline).join('<br>')}</p>`;
    }
    return out;
  };
  // Tables become editable table cards elsewhere; inside documents they render as aligned text.

  /* ---------- diagram layout ---------- */
  const KIND_STYLE = {
    start: { color: 'green', w: 190 }, end: { color: 'green', w: 190 }, process: { color: null, w: 230 },
    decision: { color: 'yellow', w: 210 }, input_output: { color: 'blue', w: 230 }, subprocess: { color: 'purple', w: 230 }, note: { color: 'grey', w: 220 },
  };
  A.layoutDiagram = function (d) {
    const nodes = d.nodes.filter((n, i, a) => n.id && a.findIndex((x) => x.id === n.id) === i);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = d.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
    const out = {}; nodes.forEach((n) => (out[n.id] = []));
    edges.forEach((e, i) => out[e.from].push({ to: e.to, i }));
    const incoming = new Set(edges.map((e) => e.to));
    let roots = nodes.filter((n) => n.kind === 'start').map((n) => n.id);
    if (!roots.length) roots = nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
    if (!roots.length && nodes.length) roots = [nodes[0].id];
    // find back edges (cycles) with DFS
    const state = {}, back = new Set();
    const dfs = (u) => { state[u] = 1; for (const { to, i } of out[u]) { if (state[to] === 1) back.add(i); else if (!state[to]) dfs(to); } state[u] = 2; };
    roots.forEach((r) => !state[r] && dfs(r)); nodes.forEach((n) => !state[n.id] && dfs(n.id));
    // longest-path ranks over forward edges (Kahn)
    const indeg = {}; nodes.forEach((n) => (indeg[n.id] = 0));
    edges.forEach((e, i) => { if (!back.has(i)) indeg[e.to]++; });
    const rank = {}; nodes.forEach((n) => (rank[n.id] = 0));
    const q = nodes.filter((n) => !indeg[n.id]).map((n) => n.id);
    while (q.length) { const u = q.shift(); for (const { to, i } of out[u]) { if (back.has(i)) continue; rank[to] = Math.max(rank[to], rank[u] + 1); if (--indeg[to] === 0) q.push(to); } }
    // rows, ordered by average parent position
    const rows = {}; nodes.forEach((n) => (rows[rank[n.id]] = rows[rank[n.id]] || []).push(n));
    const pos = {}; const GX = 290, GY = 200;
    Object.keys(rows).map(Number).sort((a, b) => a - b).forEach((r) => {
      const row = rows[r];
      row.forEach((n) => { const ps = edges.filter((e, i) => e.to === n.id && !back.has(i) && pos[e.from]).map((e) => pos[e.from].x); n._bx = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0; });
      row.sort((a, b) => a._bx - b._bx);
      row.forEach((n, k) => (pos[n.id] = { x: (k - (row.length - 1) / 2) * GX, y: r * GY }));
    });
    return { nodes, edges, pos, back };
  };

  function diagramSnapshot(d, title, opts) {
    const L = A.layoutDiagram(d);
    const b = A.templateBuilder();
    const target = opts.newBoard ? b.sub('ROOT', 0, 0, title || 'AI diagram', { icon: '🧭', color: 'teal' }) : 'ROOT';
    const ox = opts.newBoard ? 0 : 0;
    const map = {};
    for (const n of L.nodes) {
      const st = KIND_STYLE[n.kind] || KIND_STYLE.process;
      const p = L.pos[n.id];
      const html = `<p style="text-align:center"><b>${esc(n.label)}</b></p>` + (n.detail ? `<p style="text-align:center"><span style="color:#787774">${esc(n.detail)}</span></p>` : '');
      map[n.id] = b.note(target, Math.round(ox + p.x - st.w / 2), Math.round(p.y), html, { w: st.w, color: st.color });
    }
    L.edges.forEach((e, i) => {
      const isBack = L.back.has(i);
      b.line(target, map[e.from], map[e.to], { label: e.label || '', style: isBack ? 'dashed' : 'solid', bend: isBack ? { x: -170, y: 0 } : { x: 0, y: 0 } });
    });
    if (opts.summary && d.summary) {
      const maxX = Math.max(...Object.values(L.pos).map((p) => p.x)) + 260;
      b.note(target, Math.round(maxX), 0, `<h3>${esc(title || d.title)}</h3><p>${esc(d.summary)}</p><p><span style="color:#787774">Generated with ${esc((A.AI_MODELS[settings().model] || {}).label || 'Claude')}</span></p>`, { w: 260, color: 'clear' });
    }
    return { snap: b.s, innerBoard: opts.newBoard ? target : null };
  }

  /* ---------- errors ---------- */
  function friendly(err) {
    if (!err) return 'Something went wrong.';
    if (err.kind === 'no_key') return err.message;
    if (err.kind === 'auth') return 'Your API key was rejected. Check it in AI settings.';
    if (err.kind === 'network' && !isDesktop()) return 'Could not reach the Claude API from this browser (offline, or the request was blocked). The desktop app is the most reliable way to use AI.';
    return err.message || 'Request failed.';
  }

  /* ---------- the AI dialog ---------- */
  A.openAI = async function (preset) {
    const s = settings();
    const st = await A.ai.keyStatus();
    const body = A.h(`<div class="ai">
      <div class="seg ai-tabs"><button data-mode="diagram">${I('line', 14)} Flow diagram</button><button data-mode="document">${I('document', 14)} Documentation</button><button data-mode="both">Both</button></div>
      <label class="ai-label" data-promptlabel>Describe the process</label>
      <textarea class="input ai-prompt" rows="4" placeholder=""></textarea>
      <div class="ai-opts">
        <label class="check" data-opt="newBoard"><input type="checkbox" checked> Put it in a new board (a diagram inside your diagram)</label>
        <label class="check" data-opt="useBoard"><input type="checkbox"> Use this board's content as context</label>
      </div>
      <div class="ai-estimate"><div class="ai-est-row"><span class="muted">Estimate</span><span data-est>Type a request to see the token count and cost.</span></div></div>
      <div class="ai-result" hidden></div>
      <div class="ai-foot">
        <button class="btn ghost small" data-aiset>${I('settings', 13)} ${esc((A.AI_MODELS[s.model] || {}).label || s.model)} · ${esc(s.effort)} effort</button>
        <div class="grow"></div>
        <button class="btn" data-cancel hidden>Cancel</button>
        <button class="btn primary" data-go>${I('sparkle', 14)} Generate</button>
      </div>
      ${st.hasKey ? '' : `<div class="ai-nokey">${I('lock', 14)} Add your Claude API key to start. <button class="btn small primary" data-aiset>Add key</button></div>`}
    </div>`);
    const m = A.modal({ title: 'AI assistant', body, wide: true, cls: 'ai-modal', onClose: () => { if (busy) A.ai.cancel(); } });
    const ta = body.querySelector('.ai-prompt'), est = body.querySelector('[data-est]'), resBox = body.querySelector('.ai-result');
    const go = body.querySelector('[data-go]'), cancel = body.querySelector('[data-cancel]');
    let mode = preset || 'diagram', busy = false, estTimer = null, estSeq = 0;
    const placeholders = {
      diagram: 'e.g. User signs up, verifies email, and completes onboarding. Include what happens if verification fails.',
      document: 'e.g. Write a how-to guide for our customer refund process, including who approves what.',
      both: 'e.g. Our hiring process from job posting to offer — diagram it and write the documentation.',
    };
    const setMode = (md) => {
      mode = md;
      body.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === md));
      ta.placeholder = placeholders[md];
      body.querySelector('[data-promptlabel]').textContent = md === 'document' ? 'What should the document cover?' : 'Describe the process or system';
      body.querySelector('[data-opt=newBoard]').hidden = md === 'document';
      estimate();
    };
    body.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
    body.querySelectorAll('[data-aiset]').forEach((b) => (b.onclick = () => { m.close(); A.openAISettings(() => A.openAI(mode)); }));
    const opt = (k) => body.querySelector(`[data-opt=${k}] input`).checked;
    body.querySelector('[data-opt=useBoard] input').onchange = () => estimate();
    ta.addEventListener('input', () => estimate());
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); });

    function requestsFor(prompt) {
      const r = [];
      if (mode !== 'document') r.push({ feature: 'diagram', params: buildDiagramRequest(prompt, opt('useBoard')) });
      if (mode !== 'diagram') r.push({ feature: 'document', params: buildDocRequest(prompt, opt('useBoard'), mode === 'both' ? { placeholder: true } : null) });
      return r;
    }
    function estimate() {
      clearTimeout(estTimer);
      const prompt = ta.value.trim();
      if (!prompt) { est.textContent = 'Type a request to see the token count and cost.'; return; }
      est.innerHTML = '<span class="muted">Counting tokens…</span>';
      estTimer = setTimeout(async () => {
        const seq = ++estSeq; const model = settings().model; const p = A.AI_MODELS[model];
        let inTok = 0;
        for (const r of requestsFor(prompt)) {
          const res = await A.ai.count(countParams(r.params));
          if (seq !== estSeq) return;
          if (!res.ok) { est.innerHTML = `<span class="muted">${esc(res.error.kind === 'no_key' ? 'Add an API key to see exact token counts.' : 'Could not count tokens: ' + friendly(res.error))}</span>`; return; }
          inTok += res.result.input_tokens;
        }
        // the "both" document request also carries the diagram JSON (~typical size)
        if (mode === 'both') inTok += 900;
        const typ = TYPICAL_OUTPUT[mode];
        const inCost = (inTok * priceOf(model, inTok).in) / 1e6, outCost = (typ * priceOf(model, inTok).out) / 1e6;
        est.innerHTML = `<b>${A.fmtNum(inTok)}</b> input tokens <span class="muted">(${A.fmtUSD(inCost)})</span> · about <b>${A.fmtNum(typ)}</b> output tokens <span class="muted">(${A.fmtUSD(outCost)})</span> · <b>≈ ${A.fmtUSD(inCost + outCost)}</b> total
          <div class="muted small">${esc(p.label)}: ${A.fmtUSD(p.in)} / 1M input, ${A.fmtUSD(p.out)} / 1M output. Output is billed by actual length, including the model's thinking.</div>`;
        const b = settings().budget;
        if (b && A.aiMonthCost() + inCost + outCost > b) est.innerHTML += `<div class="ai-warn">This would take you past your monthly budget of ${A.fmtUSD(b)} (spent ${A.fmtUSD(A.aiMonthCost())}).</div>`;
      }, 650);
    }

    function showResult(rows, notes) {
      resBox.hidden = false;
      const tot = rows.reduce((a, r) => ({ input: a.input + r.input + (r.cacheRead || 0), output: a.output + r.output, thinking: a.thinking + (r.thinking || 0), cost: a.cost + r.cost }), { input: 0, output: 0, thinking: 0, cost: 0 });
      resBox.innerHTML = `<div class="ai-usage-card">
        <div class="ai-stat"><span>Input</span><b>${A.fmtNum(tot.input)}</b></div>
        <div class="ai-stat"><span>Output</span><b>${A.fmtNum(tot.output)}</b>${tot.thinking ? `<i>${A.fmtNum(tot.thinking)} thinking</i>` : ''}</div>
        <div class="ai-stat"><span>Cost</span><b>${A.fmtUSD(tot.cost)}</b>${rows.some((r) => !r.priced) ? '<i>partly unpriced</i>' : ''}</div>
        <div class="ai-stat"><span>This month</span><b>${A.fmtUSD(A.aiMonthCost())}</b></div></div>
        ${rows.map((r) => `<div class="muted small">${r.feature === 'diagram' ? 'Diagram' : 'Document'}: ${A.fmtNum(r.input + (r.cacheRead || 0))} in · ${A.fmtNum(r.output)} out · ${A.fmtUSD(r.cost)} · ${esc(r.model)}${r.fellBack ? ' (fallback model answered)' : ''}</div>`).join('')}
        ${notes.map((n) => `<div class="ai-note">${n}</div>`).join('')}`;
    }

    async function run() {
      if (busy) return;
      const prompt = ta.value.trim(); if (!prompt) { ta.focus(); return; }
      const ks = await A.ai.keyStatus(); if (!ks.hasKey) { m.close(); return A.openAISettings(() => A.openAI(mode)); }
      busy = true; go.disabled = true; cancel.hidden = false; ta.disabled = true;
      const rows = [], notes = []; const model = settings().model;
      resBox.hidden = false; resBox.innerHTML = '<div class="ai-progress"><span class="spinner"></span> <span data-status>Thinking…</span></div><div class="ai-stream"></div>';
      const status = (t) => { const s = resBox.querySelector('[data-status]'); if (s) s.textContent = t; };
      let diagram = null, created = null;
      try {
        if (mode !== 'document') {
          status('Designing the flow diagram…');
          const res = await A.ai.create(buildDiagramRequest(prompt, opt('useBoard')));
          if (!res.ok) throw res.error;
          const msg = res.result; rows.push(record('diagram', msg, model, { prompt: prompt.slice(0, 200) }));
          if (msg.stop_reason === 'refusal') throw { message: `The request was declined${msg.stop_details && msg.stop_details.category ? ` (${msg.stop_details.category})` : ''}. Try rephrasing it.` };
          if (msg.stop_reason === 'max_tokens') throw { message: 'The diagram was too long and got cut off. Try a narrower request.' };
          const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
          try { diagram = JSON.parse(text); } catch (e) { throw { message: 'The diagram came back in an unexpected format. Please try again.' }; }
          if (!diagram.nodes || !diagram.nodes.length) throw { message: 'No diagram was produced. Try describing the steps in more detail.' };
          A.checkpoint();
          const title = diagram.title || 'AI diagram';
          const { snap, innerBoard } = diagramSnapshot(diagram, title, { newBoard: opt('newBoard'), summary: true });
          const at = A.spawnPoint(260);
          const top = A.instantiate(snap, A.ui.boardId, at.x, at.y);
          created = { boardCard: innerBoard ? A.state.cards[top[0]] : null, ids: top, title };
          A.log(`AI created the flow diagram “${title}”`);
          A.changed();
          notes.push(`${I('check', 13)} Created “${esc(title)}” with ${diagram.nodes.length} steps${innerBoard ? ' in a new board' : ''}.`);
        }
        if (mode !== 'diagram') {
          status('Writing the documentation…');
          const box = resBox.querySelector('.ai-stream'); let mdText = '', last = 0;
          const res = await A.ai.stream(buildDocRequest(prompt, opt('useBoard'), diagram), (d) => {
            mdText += d; const now = Date.now(); if (now - last > 120) { last = now; box.innerHTML = A.sanitize(A.mdToHtml(mdText)); box.scrollTop = box.scrollHeight; }
          });
          if (!res.ok) throw res.error;
          const msg = res.result; rows.push(record('document', msg, model, { prompt: prompt.slice(0, 200) }));
          if (msg.stop_reason === 'refusal') throw { message: `The request was declined${msg.stop_details && msg.stop_details.category ? ` (${msg.stop_details.category})` : ''}. Try rephrasing it.` };
          const full = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') || mdText;
          box.innerHTML = A.sanitize(A.mdToHtml(full));
          const tm = full.match(/^#\s+(.+)$/m); const title = tm ? tm[1].trim() : (diagram ? diagram.title + ' — documentation' : prompt.slice(0, 60));
          const html = A.sanitize(A.mdToHtml(full.replace(/^#\s+.+\n?/m, '')));
          A.checkpoint();
          let targetBoard = A.ui.boardId, pt;
          if (created && created.boardCard) { targetBoard = created.boardCard.data.board; const L = A.layoutDiagram(diagram); pt = { x: Math.max(...Object.values(L.pos).map((p) => p.x)) + 260, y: 200 }; }
          else if (created) { const bb = A.contentBounds(created.ids); pt = bb ? { x: bb.x + bb.w + 60, y: bb.y } : A.spawnPoint(); }
          else pt = A.spawnPoint(240);
          const card = A.createCard('document', pt.x, pt.y, { title, html }, { boardId: targetBoard, w: 280 });
          if (!created) A.ui.selection = new Set([card.id]);
          A.log(`AI wrote the document “${title}”`); A.changed();
          notes.push(`${I('check', 13)} Wrote the document “${esc(title)}”${msg.stop_reason === 'max_tokens' ? ' (stopped at the length limit)' : ''}.`);
          created = Object.assign(created || {}, { doc: card });
        }
        showResult(rows, notes);
        resBox.insertAdjacentHTML('beforeend', `<div class="ai-actions">${created && created.boardCard ? '<button class="btn primary small" data-open>Open the diagram board</button>' : ''}${created && created.doc ? '<button class="btn small" data-opendoc>Open the document</button>' : ''}<button class="btn small" data-again>New request</button></div>`);
        const ob = resBox.querySelector('[data-open]'); if (ob) ob.onclick = () => { m.close(); A.openBoard(created.boardCard.data.board); };
        const od = resBox.querySelector('[data-opendoc]'); if (od) od.onclick = () => { m.close(); A.openDocument(created.doc.id); };
        resBox.querySelector('[data-again]').onclick = () => { ta.value = ''; ta.disabled = false; resBox.hidden = true; ta.focus(); estimate(); };
      } catch (err) {
        if (rows.length) showResult(rows, []); else resBox.innerHTML = '';
        resBox.hidden = false;
        resBox.insertAdjacentHTML('beforeend', `<div class="ai-error">${I('x', 14)} ${esc(err && err.kind === 'aborted' ? 'Cancelled.' : friendly(err))}</div>`);
        ta.disabled = false;
      } finally {
        busy = false; go.disabled = false; cancel.hidden = true;
      }
    }
    go.onclick = run;
    cancel.onclick = () => A.ai.cancel();
    setMode(mode);
    setTimeout(() => ta.focus(), 40);
  };

  /* ---------- AI settings ---------- */
  A.openAISettings = async function (after) {
    const s = settings(); const st = await A.ai.keyStatus();
    const body = A.h(`<div class="settings">
      <section><h4>Claude API key</h4>
        <p class="muted small">${isDesktop()
          ? 'Stored on this Mac, encrypted with your macOS keychain. It never leaves the app except to call the Claude API.'
          : 'Stored in this browser only. For better security, use the desktop app, which keeps the key encrypted outside the page.'}
          Get a key at <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com</a>.</p>
        <div class="row"><input class="input" type="password" autocomplete="off" placeholder="${st.hasKey ? '•••••••• key saved' : 'sk-ant-…'}" data-key><button class="btn primary" data-savekey>Save</button>${st.hasKey ? '<button class="btn danger" data-clearkey>Remove</button>' : ''}</div>
        ${st.fromEnv ? '<p class="muted small">Using the ANTHROPIC_API_KEY environment variable.</p>' : ''}</section>
      <section><h4>Model</h4>
        ${Object.entries(A.AI_MODELS).map(([id, p]) => `<label class="check radio"><input type="radio" name="aimodel" value="${id}" ${s.model === id ? 'checked' : ''}> <span><b>${esc(p.label)}</b> <span class="muted small">— ${esc(p.note)} · ${A.fmtUSD(p.in)} in / ${A.fmtUSD(p.out)} out per 1M tokens</span></span></label>`).join('')}</section>
      <section><h4>Effort</h4><p class="muted small">Higher effort thinks longer: better on complex processes, more output tokens.</p>
        <div class="seg">${['low', 'medium', 'high'].map((e) => `<button data-effort="${e}" class="${s.effort === e ? 'on' : ''}">${e[0].toUpperCase() + e.slice(1)}</button>`).join('')}</div></section>
      <section><h4>Monthly budget</h4><p class="muted small">Warns you before a request would go over. 0 = no budget.</p>
        <div class="row"><span>$</span><input class="input" type="number" min="0" step="1" value="${s.budget || 0}" data-budget style="max-width:120px"></div></section>
    </div>`);
    const m = A.modal({ title: 'AI settings', body, onClose: () => after && after() });
    body.querySelector('[data-savekey]').onclick = async () => {
      const v = body.querySelector('[data-key]').value.trim();
      if (!/^sk-ant-/.test(v)) return A.toast('That doesn’t look like a Claude API key (it should start with sk-ant-)');
      const r = await A.ai.setKey(v); if (r.ok) { A.toast('API key saved'); m.close(); } else A.toast('Could not save key: ' + (r.error && r.error.message));
    };
    const ck = body.querySelector('[data-clearkey]'); if (ck) ck.onclick = async () => { await A.ai.clearKey(); A.toast('API key removed'); m.close(); };
    body.querySelectorAll('input[name=aimodel]').forEach((r) => (r.onchange = () => { s.model = r.value; A.save(); }));
    body.querySelectorAll('[data-effort]').forEach((b) => (b.onclick = () => { s.effort = b.dataset.effort; body.querySelectorAll('[data-effort]').forEach((x) => x.classList.toggle('on', x === b)); A.save(); }));
    body.querySelector('[data-budget]').oninput = (e) => { s.budget = Math.max(0, +e.target.value || 0); A.save(); A.updateAIBadge(); };
    body.querySelector('[data-key]').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') body.querySelector('[data-savekey]').click(); });
  };

  /* ---------- usage panel ---------- */
  A.renderAIUsage = function () {
    const p = document.getElementById('side-panel');
    const day = totals(startOfDay()), month = totals(startOfMonth()), all = totals(0);
    const s = settings(); const rows = ledger();
    const byFeature = {}; rows.forEach((r) => { const f = (byFeature[r.feature] = byFeature[r.feature] || { n: 0, cost: 0, tokens: 0 }); f.n++; f.cost += r.cost; f.tokens += r.input + r.output; });
    const block = (label, t) => `<div class="ai-tot"><div class="muted small">${label}</div><div class="ai-tot-cost">${A.fmtUSD(t.cost)}</div><div class="muted small">${A.fmtNum(t.n)} request${t.n === 1 ? '' : 's'} · ${A.fmtNum(t.input)} in · ${A.fmtNum(t.output)} out</div></div>`;
    const pct = s.budget ? Math.min(100, (month.cost / s.budget) * 100) : 0;
    p.innerHTML = `<div class="panel-head"><h3>AI usage</h3><button class="icon-btn" data-pclose>${I('x', 16)}</button></div>
      <div class="panel-body">
        <div class="ai-tots">${block('Today', day)}${block('This month', month)}${block('All time', all)}</div>
        ${s.budget ? `<div class="ai-budget"><div class="row between"><span class="small">Monthly budget</span><span class="small">${A.fmtUSD(month.cost)} of ${A.fmtUSD(s.budget)}</span></div><div class="progress"><div style="width:${pct}%;${pct >= 100 ? 'background:var(--danger)' : pct > 80 ? 'background:#f2a20c' : ''}"></div></div></div>` : ''}
        ${all.thinking ? `<p class="muted small">Output includes ${A.fmtNum(all.thinking)} thinking tokens in total.</p>` : ''}
        ${Object.keys(byFeature).length ? `<div class="nav-section">By feature</div>${Object.entries(byFeature).map(([f, v]) => `<div class="ai-row"><span>${f === 'diagram' ? 'Flow diagrams' : 'Documentation'}</span><span class="muted small">${v.n} · ${A.fmtNum(v.tokens)} tokens</span><b>${A.fmtUSD(v.cost)}</b></div>`).join('')}` : ''}
        <div class="nav-section">Recent requests</div>
        <div class="ai-list">${rows.slice(0, 60).map((r) => `<div class="ai-req"><div class="row between"><b class="small">${r.feature === 'diagram' ? 'Flow diagram' : 'Document'}</b><b class="small">${A.fmtUSD(r.cost)}</b></div>
          <div class="muted small">${A.fmtTime(r.time)} · ${esc(r.model)}${r.fellBack ? ' (fallback)' : ''}</div>
          <div class="muted small">${A.fmtNum(r.input + (r.cacheRead || 0))} input · ${A.fmtNum(r.output)} output${r.thinking ? ` (${A.fmtNum(r.thinking)} thinking)` : ''}${r.stop && r.stop !== 'end_turn' ? ` · stopped: ${esc(r.stop)}` : ''}</div>
          ${r.prompt ? `<div class="ai-req-prompt small">“${esc(r.prompt)}”</div>` : ''}</div>`).join('') || `<div class="empty-small">${I('sparkle', 24)}<br>No AI requests yet.</div>`}</div>
        <div class="row wrap" style="margin-top:14px"><button class="btn small" data-new>${I('sparkle', 13)} New AI request</button><button class="btn small" data-csv>${I('download', 13)} Export CSV</button><button class="btn small" data-set>${I('settings', 13)} Settings</button>${rows.length ? '<button class="btn small danger" data-clear>Clear history</button>' : ''}</div>
        <p class="muted small" style="margin-top:12px">Costs use Claude API list prices for each model and are calculated from the token counts the API reports for every request. Your Anthropic Console bill is the final word.</p>
      </div>`;
    p.querySelector('[data-pclose]').onclick = () => A.togglePanel('ai');
    p.querySelector('[data-new]').onclick = () => A.openAI();
    p.querySelector('[data-set]').onclick = () => A.openAISettings(() => A.renderAIUsage());
    p.querySelector('[data-csv]').onclick = () => {
      const head = 'time,feature,model,requested_model,input_tokens,output_tokens,thinking_tokens,cache_read_tokens,cache_write_tokens,cost_usd,stop_reason,prompt';
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [head, ...rows.map((r) => [new Date(r.time).toISOString(), r.feature, r.model, r.requested, r.input, r.output, r.thinking || 0, r.cacheRead || 0, r.cacheWrite || 0, r.cost.toFixed(6), r.stop, q(r.prompt)].join(','))].join('\n');
      A.downloadText(csv, `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    };
    const cl = p.querySelector('[data-clear]'); if (cl) cl.onclick = async () => { if (!(await A.confirm('Clear the AI usage history? This does not affect your Anthropic bill.', 'Clear', true))) return; A.state.aiUsage = []; A.save(); A.updateAIBadge(); A.renderAIUsage(); };
  };
})();
