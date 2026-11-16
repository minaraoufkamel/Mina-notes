/* AI: flow diagrams and documentation with Claude, OpenAI or OpenRouter,
   plus token & cost tracking */
(function () {
  'use strict';
  const A = window.App;
  const esc = A.esc;
  const I = (n, s) => A.icon(n, s);

  /* ---------- providers, models & prices ---------- */
  A.AI_PROVIDERS = {
    anthropic: { label: 'Claude', keyHint: 'sk-ant-', keyUrl: 'https://platform.claude.com/settings/keys', keyPrefix: /^sk-ant-/, count: 'exact' },
    openai: { label: 'OpenAI', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys', keyPrefix: /^sk-/, count: 'exact' },
    openrouter: { label: 'OpenRouter', keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/settings/keys', keyPrefix: /^sk-or-/, count: 'approx' },
  };
  // USD per 1M tokens — Claude API list prices (Nov 2026).
  A.AI_MODELS = {
    'claude-opus-5-5': { label: 'Claude Opus 5.5', note: 'Best quality (default)', in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5, fallbacks: 'default' },
    'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', note: 'Faster, half the price', in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5, fallbacks: 'default' },
    'claude-haiku-5-5': { label: 'Claude Haiku 5.5', note: 'Cheapest, simpler output', in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longIn: 0.5, longOut: 2.5, longAt: 100000, fallbacks: null },
  };
  // Models that may answer via Claude's server-side fallback; priced so the ledger stays exact.
  const CLAUDE_FALLBACK_PRICES = {
    'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-opus-4-8': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  };
  // USD per 1M tokens — OpenAI standard prices from the official pricing page (Nov 2026).
  // Requests over 272K input tokens use the long-context rates.
  A.OPENAI_MODELS = {
    'gpt-6.1-sol': { label: 'GPT-6.1 Sol', note: 'Balanced (default)', in: 2, cached: 0.1, out: 10, long: { in: 4, cached: 0.2, out: 15 } },
    'gpt-6-astra': { label: 'GPT-6 Astra', note: 'Most capable', in: 10, cached: 1, out: 50, long: { in: 20, cached: 2, out: 75 } },
    'gpt-6.1-terra': { label: 'GPT-6.1 Terra', note: 'Faster, lower cost', in: 1, cached: 0.05, out: 5, long: { in: 2, cached: 0.1, out: 7.5 } },
    'gpt-6-luna': { label: 'GPT-6 Luna', note: 'Cheapest', in: 0.1, cached: 0.01, out: 0.5, long: { in: 0.2, cached: 0.02, out: 0.75 } },
  };
  const OPENAI_LONG_AT = 272000;
  const TYPICAL_OUTPUT = { diagram: 3000, document: 3500, both: 6500 }; // includes reasoning

  /* ---------- settings ---------- */
  const settings = () => {
    const s = (A.state.settings.ai = Object.assign({ provider: 'anthropic', models: {}, effort: 'medium', budget: 0, customOpenAI: { in: 0, out: 0 } }, A.state.settings.ai || {}));
    if (typeof s.model === 'string') { s.models.anthropic = s.model; delete s.model; } // older setting
    s.models = Object.assign({ anthropic: 'claude-opus-5-5', openai: 'gpt-6.1-sol', openrouter: 'anthropic/claude-sonnet-5.5' }, s.models);
    return s;
  };
  const current = () => { const s = settings(); return { provider: s.provider, model: s.models[s.provider] }; };
  A.aiModelLabel = (provider, model) => provider === 'anthropic' ? (A.AI_MODELS[model] || {}).label || model
    : provider === 'openai' ? (A.OPENAI_MODELS[model] || {}).label || model
    : ((orModel(model) || {}).name || model);

  /* ---------- OpenRouter catalog (public; prices per token) ---------- */
  let orCatalog = null;
  const OR_CACHE = 'mina-notes-openrouter-models';
  function loadORCache() { try { const c = JSON.parse(localStorage.getItem(OR_CACHE) || 'null'); if (c && Date.now() - c.time < 12 * 3600e3) orCatalog = c.list; } catch (e) {} }
  loadORCache();
  function orModel(id) { return orCatalog ? orCatalog.find((m) => m.id === id) : null; }
  A.loadOpenRouterModels = async function (force) {
    if (orCatalog && !force) return orCatalog;
    let res;
    if (window.minaAI) res = await window.minaAI.openrouterModels();
    else { try { const r = await fetch('https://openrouter.ai/api/v1/models'); res = r.ok ? { ok: true, result: await r.json() } : { ok: false }; } catch (e) { res = { ok: false }; } }
    if (!res.ok) return orCatalog;
    orCatalog = (res.result.data || []).filter((m) => m.pricing && !/:batch$/.test(m.id)).map((m) => ({
      id: m.id, name: m.name || m.id, ctx: m.context_length || 0,
      prompt: +m.pricing.prompt || 0, completion: +m.pricing.completion || 0, cacheRead: +(m.pricing.input_cache_read || 0),
      struct: (m.supported_parameters || []).includes('structured_outputs') || (m.supported_parameters || []).includes('response_format'),
    }));
    try { localStorage.setItem(OR_CACHE, JSON.stringify({ time: Date.now(), list: orCatalog })); } catch (e) {}
    return orCatalog;
  };

  /* ---------- pricing ---------- */
  // Prices per 1M tokens for a provider/model, for estimates.
  function estimatePrice(provider, model, promptTokens) {
    if (provider === 'anthropic') {
      const p = A.AI_MODELS[model]; if (!p) return null;
      return p.longAt && promptTokens > p.longAt ? { in: p.longIn, out: p.longOut } : { in: p.in, out: p.out };
    }
    if (provider === 'openai') {
      const p = openaiPrice(model); if (!p) return null;
      return promptTokens > OPENAI_LONG_AT && p.long ? { in: p.long.in, out: p.long.out } : { in: p.in, out: p.out };
    }
    const m = orModel(model); if (!m) return null;
    return { in: m.prompt * 1e6, out: m.completion * 1e6 };
  }
  function openaiPrice(model) {
    if (!model) return null;
    const keys = Object.keys(A.OPENAI_MODELS).sort((a, b) => b.length - a.length);
    const k = keys.find((key) => model === key || model.startsWith(key + '-')); // dated snapshots
    if (k) return A.OPENAI_MODELS[k];
    const c = settings().customOpenAI;
    return c && (c.in || c.out) ? { in: +c.in || 0, cached: (+c.in || 0) / 10, out: +c.out || 0 } : null;
  }
  function claudePrice(model, promptTokens) {
    const p = A.AI_MODELS[model] || CLAUDE_FALLBACK_PRICES[model]; if (!p) return null;
    if (p.longAt && promptTokens > p.longAt) return { ...p, in: p.longIn, out: p.longOut, cacheRead: p.cacheRead * 5, cacheWrite: p.cacheWrite * 5 };
    return p;
  }

  /* ---------- normalising responses ---------- */
  // Every provider's response becomes: { text, stop, refusal, model, fellBack, usage, cost, priced, costSource }
  // usage: { input (uncached), cacheRead, cacheWrite, output (incl. reasoning), thinking }
  function normClaude(msg, requested) {
    const u = msg.usage || {};
    const its = Array.isArray(u.iterations) ? u.iterations.filter((x) => x && typeof x.input_tokens === 'number') : [];
    const parts = its.length ? its.map((x) => ({ u: x, model: x.model || msg.model || requested })) : [{ u, model: msg.model || requested }];
    let cost = 0, priced = true; const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0 };
    for (const p of parts) {
      const x = p.u; const prompt = (x.input_tokens || 0) + (x.cache_read_input_tokens || 0) + (x.cache_creation_input_tokens || 0);
      const pr = claudePrice(p.model, prompt);
      if (pr) cost += ((x.input_tokens || 0) * pr.in + (x.output_tokens || 0) * pr.out + (x.cache_read_input_tokens || 0) * pr.cacheRead + (x.cache_creation_input_tokens || 0) * pr.cacheWrite) / 1e6; else priced = false;
      usage.input += x.input_tokens || 0; usage.output += x.output_tokens || 0; usage.cacheRead += x.cache_read_input_tokens || 0; usage.cacheWrite += x.cache_creation_input_tokens || 0;
    }
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const stop = msg.stop_reason === 'refusal' ? 'refusal' : msg.stop_reason === 'max_tokens' ? 'length' : 'end';
    return { text, stop, refusal: stop === 'refusal' ? (msg.stop_details && msg.stop_details.category) || 'policy' : null, model: msg.model || requested, fellBack: its.some((x) => x.type === 'fallback_message'), usage, cost, priced, costSource: 'list price' };
  }
  function normChat(provider, res, requested) {
    const ch = (res.choices && res.choices[0]) || {}; const msg = ch.message || {};
    const u = res.usage || {};
    const prompt = u.prompt_tokens || 0, cached = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
    const cacheWrite = (u.prompt_tokens_details && u.prompt_tokens_details.cache_write_tokens) || 0;
    const usage = { input: Math.max(0, prompt - cached - cacheWrite), cacheRead: cached, cacheWrite, output: u.completion_tokens || 0, thinking: (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0 };
    const model = res.model || requested;
    let cost = 0, priced = true, costSource = 'list price';
    if (provider === 'openrouter' && typeof u.cost === 'number') { cost = u.cost; costSource = 'charged'; }
    else if (provider === 'openrouter') {
      const m = orModel(requested) || orModel(model);
      if (m) cost = (usage.input + cacheWrite) * m.prompt + cached * (m.cacheRead || m.prompt) + usage.output * m.completion; else priced = false;
    } else {
      const p = openaiPrice(model) || openaiPrice(requested);
      if (p) { const r = prompt > OPENAI_LONG_AT && p.long ? p.long : p; cost = ((prompt - cached) * r.in + cached * (r.cached ?? r.in) + usage.output * r.out) / 1e6; } else priced = false;
    }
    const refusal = msg.refusal || (ch.finish_reason === 'content_filter' ? 'content filter' : null);
    const stop = refusal ? 'refusal' : ch.finish_reason === 'length' ? 'length' : 'end';
    return { text: msg.content || '', stop, refusal, model, fellBack: false, usage, cost, priced, costSource };
  }

  A.fmtUSD = (n) => n === 0 ? '$0.00' : n < 0.01 ? '$' + n.toFixed(4) : n < 1 ? '$' + n.toFixed(3) : '$' + n.toFixed(2);
  A.fmtNum = (n) => Number(n || 0).toLocaleString();

  /* ---------- transport: Electron bridge (preferred) or browser SDKs ---------- */
  const SDK_URLS = { anthropic: 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.9.0/+esm', openai: 'https://cdn.jsdelivr.net/npm/openai@7.57.0/+esm' };
  const LS_KEY = (p) => `mina-notes-ai-key-${p}`;
  const sdk = {}, browserClients = {}, browserStreams = new Map();
  const isDesktop = () => !!window.minaAI;
  try { const old = localStorage.getItem('mina-notes-ai-key'); if (old && !localStorage.getItem(LS_KEY('anthropic'))) { localStorage.setItem(LS_KEY('anthropic'), old); localStorage.removeItem('mina-notes-ai-key'); } } catch (e) {}

  async function browserClient(p) {
    let key = ''; try { key = localStorage.getItem(LS_KEY(p)) || ''; } catch (e) {}
    if (!key) return null;
    const lib = p === 'anthropic' ? 'anthropic' : 'openai';
    if (!sdk[lib]) sdk[lib] = await import(SDK_URLS[lib]);
    if (!browserClients[p]) {
      const C = sdk[lib].default || sdk[lib].Anthropic || sdk[lib].OpenAI;
      browserClients[p] = p === 'anthropic' ? new C({ apiKey: key, dangerouslyAllowBrowser: true })
        : p === 'openai' ? new C({ apiKey: key, dangerouslyAllowBrowser: true })
        : new C({ apiKey: key, baseURL: 'https://openrouter.ai/api/v1', defaultHeaders: { 'X-Title': 'Mina Notes' }, dangerouslyAllowBrowser: true });
    }
    return browserClients[p];
  }
  function browserError(err, p) {
    const lib = sdk[p === 'anthropic' ? 'anthropic' : 'openai']; const S = lib && (lib.default || lib.Anthropic || lib.OpenAI);
    if (S) {
      if (err instanceof S.AuthenticationError) return { kind: 'auth', status: 401, message: 'The API key was rejected.' };
      if (err instanceof S.RateLimitError) return { kind: 'rate_limit', status: 429, message: 'Rate limited (or out of credits) — wait a moment or check your account.' };
      if (err instanceof S.BadRequestError) return { kind: 'bad_request', status: 400, message: err.message };
      if (err instanceof S.APIUserAbortError) return { kind: 'aborted', message: 'Cancelled.' };
      if (err instanceof S.APIConnectionError) return { kind: 'network', message: 'Could not reach the AI provider. Check your internet connection.' };
      if (err instanceof S.APIError) return { kind: 'api', status: err.status, message: err.message };
    }
    return { kind: 'unknown', message: (err && err.message) || String(err) };
  }
  async function browserCall(id, p, op, params, onText) {
    try {
      const c = await browserClient(p); if (!c) return { ok: false, error: { kind: 'no_key', message: 'Add an API key for this provider first.' } };
      if (p === 'anthropic') {
        if (op === 'count') return { ok: true, result: await c.messages.countTokens(params) };
        if (op === 'create') return { ok: true, result: await c.beta.messages.create(params) };
        const s = c.beta.messages.stream(params); browserStreams.set(id, s);
        s.on('text', (d) => onText(d));
        return { ok: true, result: await s.finalMessage() };
      }
      if (op === 'count') return { ok: true, result: await c.responses.inputTokens.count(params) };
      if (op === 'create') return { ok: true, result: await c.chat.completions.create(params) };
      const stream = await c.chat.completions.create({ ...params, stream: true });
      browserStreams.set(id, { abort: () => stream.controller.abort() });
      let text = '', refusal = '', usage = null, finish = null, model = params.model;
      for await (const chunk of stream) {
        if (chunk.model) model = chunk.model; if (chunk.usage) usage = chunk.usage;
        const ch = chunk.choices && chunk.choices[0]; if (!ch) continue;
        const d = ch.delta || {}; if (d.content) { text += d.content; onText(d.content); } if (d.refusal) refusal += d.refusal; if (ch.finish_reason) finish = ch.finish_reason;
      }
      return { ok: true, result: { model, choices: [{ message: { content: text, refusal: refusal || null }, finish_reason: finish }], usage } };
    } catch (e) { return { ok: false, error: browserError(e, p) }; }
    finally { browserStreams.delete(id); }
  }

  A.ai = {
    isDesktop,
    async keyStatus(p) {
      p = p || settings().provider;
      if (isDesktop()) return window.minaAI.keyStatus(p);
      let k = ''; try { k = localStorage.getItem(LS_KEY(p)) || ''; } catch (e) {}
      return { hasKey: !!k, encrypted: false };
    },
    async setKey(p, k) {
      if (isDesktop()) return window.minaAI.setKey(p, k);
      try { localStorage.setItem(LS_KEY(p), k.trim()); delete browserClients[p]; return { ok: true }; } catch (e) { return { ok: false, error: { message: e.message } }; }
    },
    async clearKey(p) {
      if (isDesktop()) return window.minaAI.clearKey(p);
      try { localStorage.removeItem(LS_KEY(p)); } catch (e) {} delete browserClients[p]; return { ok: true };
    },
    async call(p, op, params, onText) {
      const id = A.uid('rq'); A.ai._current = id;
      try {
        if (isDesktop()) {
          const off = window.minaAI.onDelta((m) => { if (m.id === id && onText) onText(m.delta); });
          try { return await window.minaAI.call(id, p, op, params); } finally { off(); }
        }
        return await browserCall(id, p, op, params, onText || (() => {}));
      } finally { A.ai._current = null; }
    },
    cancel() {
      const id = A.ai._current; if (!id) return;
      if (isDesktop()) window.minaAI.cancel(id); else { const s = browserStreams.get(id); if (s) s.abort(); }
    },
  };

  /* ---------- prompts & schema ---------- */
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
          properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string', description: 'e.g. "Yes", "No", or empty string' } },
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
  const JSON_ONLY = `\n\nRespond with only a JSON object (no code fences, no other text) that matches this JSON Schema:\n${JSON.stringify(DIAGRAM_SCHEMA)}`;
  const DOC_SYSTEM = `You write clear, well-organised documentation in Markdown for a notes app.
- Start with a single "# " title line, then the content. No preamble or closing remarks.
- Use "## " section headings, short paragraphs, bullet lists, numbered steps for procedures, and tables only when they genuinely help.
- Be concrete and accurate. If the request is ambiguous, state a reasonable assumption briefly in the text.
- Do not wrap the whole answer in a code block.`;

  function boardContext() {
    const md = A.boardToMarkdown(A.ui.boardId);
    return md.length > 400000 ? null : md; // roughly 100K tokens: too large to send whole
  }
  function userContent(kind, prompt, useBoard, diagram) {
    if (kind === 'document' && diagram) return `Write documentation for this process. The flowchart (JSON):\n<flowchart>\n${JSON.stringify(diagram)}\n</flowchart>\n\nOriginal request: ${prompt}`;
    if (useBoard) { const ctx = boardContext(); if (ctx) return `Context — the current board:\n<board>\n${ctx}\n</board>\n\nRequest: ${prompt}`; }
    return prompt;
  }

  /* ---------- request building per provider ---------- */
  function buildRequest(kind, content) {
    const { provider, model } = current(); const s = settings();
    const system = kind === 'diagram' ? DIAGRAM_SYSTEM : DOC_SYSTEM;
    if (provider === 'anthropic') {
      const m = A.AI_MODELS[model] || {};
      const p = { model, max_tokens: kind === 'diagram' ? 16000 : 64000, system, messages: [{ role: 'user', content }], output_config: { effort: s.effort } };
      if (kind === 'diagram') p.output_config.format = { type: 'json_schema', schema: DIAGRAM_SCHEMA };
      // Server-side fallback: a policy decline is retried on Anthropic's recommended model in the same call.
      if (m.fallbacks) { p.betas = ['server-side-fallback-2026-07-01']; p.fallbacks = m.fallbacks; }
      return { provider, model, op: kind === 'diagram' ? 'create' : 'stream', params: p, system, content };
    }
    const msgs = (sys) => [{ role: 'system', content: sys }, { role: 'user', content }];
    if (provider === 'openai') {
      const p = { model, messages: msgs(system), max_completion_tokens: kind === 'diagram' ? 16000 : 32000, reasoning_effort: s.effort };
      if (kind === 'diagram') p.response_format = { type: 'json_schema', json_schema: { name: 'flowchart', schema: DIAGRAM_SCHEMA, strict: true } };
      else p.stream_options = { include_usage: true };
      return { provider, model, op: kind === 'diagram' ? 'create' : 'stream', params: p, system, content };
    }
    // OpenRouter: structured output only on models that support it; otherwise ask for JSON in the prompt.
    const m = orModel(model); const struct = !m || m.struct;
    const sys = kind === 'diagram' && !struct ? system + JSON_ONLY : system;
    const p = { model, messages: msgs(sys), max_tokens: kind === 'diagram' ? 16000 : 32000 };
    if (kind === 'diagram' && struct) p.response_format = { type: 'json_schema', json_schema: { name: 'flowchart', schema: DIAGRAM_SCHEMA, strict: true } };
    return { provider, model, op: kind === 'diagram' ? 'create' : 'stream', params: p, system: sys, content };
  }

  // Some models reject optional parameters; drop the one named in the error and retry (max twice).
  async function callWithRetry(req, onText) {
    let params = { ...req.params };
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await A.ai.call(req.provider, req.op, params, onText);
      if (res.ok || req.provider === 'anthropic' || !res.error || res.error.kind !== 'bad_request') return res;
      const msg = (res.error.message || '').toLowerCase();
      if (params.reasoning_effort && /reasoning/.test(msg)) { delete params.reasoning_effort; continue; }
      if (params.response_format && /response_format|json_schema|structured/.test(msg)) {
        delete params.response_format;
        params.messages = [{ role: 'system', content: req.system + JSON_ONLY }, params.messages[1]];
        continue;
      }
      if (params.max_completion_tokens && /max_completion_tokens/.test(msg)) { params.max_tokens = params.max_completion_tokens; delete params.max_completion_tokens; continue; }
      if (params.stream_options && /stream_options/.test(msg)) { delete params.stream_options; continue; }
      return res;
    }
    return { ok: false, error: { kind: 'bad_request', message: 'The provider rejected the request.' } };
  }

  async function countTokens(req) {
    if (req.provider === 'anthropic') {
      const r = await A.ai.call('anthropic', 'count', { model: req.model, system: req.system, messages: [{ role: 'user', content: req.content }] });
      return r.ok ? { ok: true, tokens: r.result.input_tokens, exact: true } : r;
    }
    if (req.provider === 'openai') {
      const r = await A.ai.call('openai', 'count', { model: req.model, instructions: req.system, input: req.content });
      return r.ok ? { ok: true, tokens: r.result.input_tokens, exact: true } : r;
    }
    // OpenRouter has no counting endpoint: about 4 characters per token plus message overhead.
    return { ok: true, tokens: Math.ceil((req.system.length + req.content.length) / 4) + 12, exact: false };
  }

  function parseJSONLoose(text) {
    let t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(t); } catch (e) {}
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
    return null;
  }

  /* ---------- usage ledger ---------- */
  const ledger = () => (A.state.aiUsage = A.state.aiUsage || []);
  function record(feature, n, req, extra = {}) {
    const row = {
      id: A.uid('u'), time: A.now(), feature, provider: req.provider, model: n.model, requested: req.model,
      input: n.usage.input, output: n.usage.output, thinking: n.usage.thinking, cacheRead: n.usage.cacheRead, cacheWrite: n.usage.cacheWrite,
      cost: n.cost, priced: n.priced, costSource: n.costSource, fellBack: n.fellBack, stop: n.stop, boardId: A.ui.boardId, ...extra,
    };
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
    const b = document.getElementById('ai-usage-btn'); if (!b || !A.state) return;
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
      if (/^```/.test(l)) { const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; out += `<pre>${esc(code.join('\n'))}</pre>`; continue; }
      const h = l.match(/^(#{1,6})\s+(.*)$/); if (h) { const n = Math.min(3, h[1].length); out += `<h${n}>${inline(h[2])}</h${n}>`; i++; continue; }
      if (/^\s*([-*+])\s+/.test(l)) { out += '<ul>'; while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, (m, cb) => cb ? (/x/i.test(cb) ? '☑ ' : '☐ ') : ''))}</li>`; i++; } out += '</ul>'; continue; }
      if (/^\s*\d+[.)]\s+/.test(l)) { out += '<ol>'; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</li>`; i++; } out += '</ol>'; continue; }
      if (/^>\s?/.test(l)) { const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, '')); out += `<blockquote>${inline(q.join(' '))}</blockquote>`; continue; }
      if (/^\|.*\|\s*$/.test(l)) {
        let rows = []; while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        rows = rows.filter((r) => !/^\|[\s:|-]+\|\s*$/.test(r)).map((r) => r.trim().slice(1, -1).split('|').map((c) => c.trim()));
        out += '<pre>' + esc(rows.map((r) => r.join('  |  ')).join('\n')) + '</pre>'; continue;
      }
      if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out += '<hr>'; i++; continue; }
      if (!l.trim()) { i++; continue; }
      const para = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|>|\|)/.test(lines[i])) para.push(lines[i++]);
      if (!para.length) para.push(lines[i++]);
      out += `<p>${para.map(inline).join('<br>')}</p>`;
    }
    return out;
  };

  /* ---------- diagram layout ---------- */
  const KIND_STYLE = {
    start: { color: 'green', w: 190 }, end: { color: 'green', w: 190 }, process: { color: null, w: 230 },
    decision: { color: 'yellow', w: 210 }, input_output: { color: 'blue', w: 230 }, subprocess: { color: 'purple', w: 230 }, note: { color: 'grey', w: 220 },
  };
  A.layoutDiagram = function (d) {
    const nodes = d.nodes.filter((n, i, a) => n && n.id && a.findIndex((x) => x.id === n.id) === i);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (d.edges || []).filter((e) => e && ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
    const out = {}; nodes.forEach((n) => (out[n.id] = []));
    edges.forEach((e, i) => out[e.from].push({ to: e.to, i }));
    const incoming = new Set(edges.map((e) => e.to));
    let roots = nodes.filter((n) => n.kind === 'start').map((n) => n.id);
    if (!roots.length) roots = nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
    if (!roots.length && nodes.length) roots = [nodes[0].id];
    const state = {}, back = new Set();
    const dfs = (u) => { state[u] = 1; for (const { to, i } of out[u]) { if (state[to] === 1) back.add(i); else if (!state[to]) dfs(to); } state[u] = 2; };
    roots.forEach((r) => !state[r] && dfs(r)); nodes.forEach((n) => !state[n.id] && dfs(n.id));
    const indeg = {}; nodes.forEach((n) => (indeg[n.id] = 0));
    edges.forEach((e, i) => { if (!back.has(i)) indeg[e.to]++; });
    const rank = {}; nodes.forEach((n) => (rank[n.id] = 0));
    const q = nodes.filter((n) => !indeg[n.id]).map((n) => n.id);
    while (q.length) { const u = q.shift(); for (const { to, i } of out[u]) { if (back.has(i)) continue; rank[to] = Math.max(rank[to], rank[u] + 1); if (--indeg[to] === 0) q.push(to); } }
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
    const map = {};
    for (const n of L.nodes) {
      const st = KIND_STYLE[n.kind] || KIND_STYLE.process; const p = L.pos[n.id];
      const html = `<p style="text-align:center"><b>${esc(n.label)}</b></p>` + (n.detail ? `<p style="text-align:center"><span style="color:#787774">${esc(n.detail)}</span></p>` : '');
      map[n.id] = b.note(target, Math.round(p.x - st.w / 2), Math.round(p.y), html, { w: st.w, color: st.color });
    }
    L.edges.forEach((e, i) => {
      const isBack = L.back.has(i);
      b.line(target, map[e.from], map[e.to], { label: e.label || '', style: isBack ? 'dashed' : 'solid', bend: isBack ? { x: -170, y: 0 } : { x: 0, y: 0 } });
    });
    if (d.summary) {
      const maxX = Math.max(...Object.values(L.pos).map((p) => p.x)) + 260;
      b.note(target, Math.round(maxX), 0, `<h3>${esc(title || d.title)}</h3><p>${esc(d.summary)}</p><p><span style="color:#787774">Generated with ${esc(opts.modelLabel || 'AI')}</span></p>`, { w: 260, color: 'clear' });
    }
    return { snap: b.s, innerBoard: opts.newBoard ? target : null };
  }

  /* ---------- errors ---------- */
  function friendly(err) {
    if (!err) return 'Something went wrong.';
    if (err.kind === 'no_key') return `Add your ${A.AI_PROVIDERS[settings().provider].label} API key in AI settings first.`;
    if (err.kind === 'auth') return `Your ${A.AI_PROVIDERS[settings().provider].label} API key was rejected. Check it in AI settings.`;
    if (err.kind === 'not_found') return 'That model was not found. Pick another model in AI settings.';
    if (err.kind === 'network' && !isDesktop()) return 'Could not reach the AI provider from this browser (offline, or the request was blocked). The desktop app is the most reliable way to use AI.';
    return err.message || 'Request failed.';
  }

  /* ---------- the AI dialog ---------- */
  A.openAI = async function (preset) {
    const s = settings(); const cur = current();
    if (cur.provider === 'openrouter') A.loadOpenRouterModels();
    const st = await A.ai.keyStatus(cur.provider);
    const provLabel = A.AI_PROVIDERS[cur.provider].label;
    const body = A.h(`<div class="ai">
      <div class="seg ai-tabs"><button data-mode="diagram">${I('line', 14)} Flow diagram</button><button data-mode="document">${I('document', 14)} Documentation</button><button data-mode="both">Both</button></div>
      <label class="ai-label" data-promptlabel>Describe the process</label>
      <textarea class="input ai-prompt" rows="4"></textarea>
      <div class="ai-opts">
        <label class="check" data-opt="newBoard"><input type="checkbox" checked> Put it in a new board (a diagram inside your diagram)</label>
        <label class="check" data-opt="useBoard"><input type="checkbox"> Use this board's content as context</label>
      </div>
      <div class="ai-estimate"><div class="ai-est-row"><span class="muted">Estimate</span><span data-est>Type a request to see the token count and cost.</span></div></div>
      <div class="ai-result" hidden></div>
      <div class="ai-foot">
        <button class="btn ghost small" data-aiset>${I('settings', 13)} ${esc(provLabel)} · ${esc(A.aiModelLabel(cur.provider, cur.model))}${cur.provider !== 'openrouter' ? ` · ${esc(s.effort)} effort` : ''}</button>
        <div class="grow"></div>
        <button class="btn" data-cancel hidden>Cancel</button>
        <button class="btn primary" data-go>${I('sparkle', 14)} Generate</button>
      </div>
      ${st.hasKey ? '' : `<div class="ai-nokey">${I('lock', 14)} Add your ${esc(provLabel)} API key to start. <button class="btn small primary" data-aiset>Add key</button></div>`}
    </div>`);
    let busy = false;
    const m = A.modal({ title: 'AI assistant', body, wide: true, cls: 'ai-modal', onClose: () => { if (busy) A.ai.cancel(); } });
    const ta = body.querySelector('.ai-prompt'), est = body.querySelector('[data-est]'), resBox = body.querySelector('.ai-result');
    const go = body.querySelector('[data-go]'), cancel = body.querySelector('[data-cancel]');
    let mode = preset || 'diagram', estTimer = null, estSeq = 0;
    const placeholders = {
      diagram: 'e.g. User signs up, verifies email, and completes onboarding. Include what happens if verification fails.',
      document: 'e.g. Write a how-to guide for our customer refund process, including who approves what.',
      both: 'e.g. Our hiring process from job posting to offer — diagram it and write the documentation.',
    };
    const opt = (k) => body.querySelector(`[data-opt=${k}] input`).checked;
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
    body.querySelector('[data-opt=useBoard] input').onchange = () => estimate();
    ta.addEventListener('input', () => estimate());
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); });

    function estimate() {
      clearTimeout(estTimer);
      const prompt = ta.value.trim();
      if (!prompt) { est.textContent = 'Type a request to see the token count and cost.'; return; }
      est.innerHTML = '<span class="muted">Counting tokens…</span>';
      estTimer = setTimeout(async () => {
        const seq = ++estSeq; const { provider, model } = current();
        const kinds = mode === 'both' ? ['diagram', 'document'] : [mode];
        let inTok = 0, exact = true;
        for (const k of kinds) {
          const r = await countTokens(buildRequest(k, userContent(k, prompt, opt('useBoard'), mode === 'both' && k === 'document' ? { placeholder: true } : null)));
          if (seq !== estSeq) return;
          if (!r.ok) { est.innerHTML = `<span class="muted">${esc(r.error.kind === 'no_key' ? 'Add an API key to see exact token counts.' : 'Could not count tokens: ' + friendly(r.error))}</span>`; return; }
          inTok += r.tokens; exact = exact && r.exact;
        }
        if (mode === 'both') inTok += 900; // the document request also carries the diagram JSON
        const typ = TYPICAL_OUTPUT[mode]; const pr = estimatePrice(provider, model, inTok);
        if (!pr) { est.innerHTML = `<b>${exact ? '' : '≈ '}${A.fmtNum(inTok)}</b> input tokens · price for ${esc(model)} unknown${provider === 'openai' ? ' — add custom prices in AI settings' : ''}`; return; }
        const inCost = (inTok * pr.in) / 1e6, outCost = (typ * pr.out) / 1e6;
        est.innerHTML = `<b>${exact ? '' : '≈ '}${A.fmtNum(inTok)}</b> input tokens <span class="muted">(${A.fmtUSD(inCost)})</span> · about <b>${A.fmtNum(typ)}</b> output tokens <span class="muted">(${A.fmtUSD(outCost)})</span> · <b>≈ ${A.fmtUSD(inCost + outCost)}</b> total
          <div class="muted small">${esc(A.aiModelLabel(provider, model))}: ${A.fmtUSD(pr.in)} / 1M input, ${A.fmtUSD(pr.out)} / 1M output.${exact ? '' : ' OpenRouter has no token-counting endpoint, so input is approximate; the actual charge is shown after the request.'} Output is billed by actual length, including reasoning.</div>`;
        const b = settings().budget;
        if (b && A.aiMonthCost() + inCost + outCost > b) est.innerHTML += `<div class="ai-warn">This would take you past your monthly budget of ${A.fmtUSD(b)} (spent ${A.fmtUSD(A.aiMonthCost())}).</div>`;
      }, 650);
    }

    function showResult(rows, notes) {
      resBox.hidden = false;
      const tot = rows.reduce((a, r) => ({ input: a.input + r.input + (r.cacheRead || 0) + (r.cacheWrite || 0), output: a.output + r.output, thinking: a.thinking + (r.thinking || 0), cost: a.cost + r.cost }), { input: 0, output: 0, thinking: 0, cost: 0 });
      resBox.innerHTML = `<div class="ai-usage-card">
        <div class="ai-stat"><span>Input</span><b>${A.fmtNum(tot.input)}</b></div>
        <div class="ai-stat"><span>Output</span><b>${A.fmtNum(tot.output)}</b>${tot.thinking ? `<i>${A.fmtNum(tot.thinking)} reasoning</i>` : ''}</div>
        <div class="ai-stat"><span>Cost</span><b>${A.fmtUSD(tot.cost)}</b>${rows.some((r) => !r.priced) ? '<i>partly unpriced</i>' : rows.every((r) => r.costSource === 'charged') ? '<i>as charged</i>' : ''}</div>
        <div class="ai-stat"><span>This month</span><b>${A.fmtUSD(A.aiMonthCost())}</b></div></div>
        ${rows.map((r) => `<div class="muted small">${r.feature === 'diagram' ? 'Diagram' : 'Document'}: ${A.fmtNum(r.input + (r.cacheRead || 0) + (r.cacheWrite || 0))} in · ${A.fmtNum(r.output)} out · ${A.fmtUSD(r.cost)} · ${esc(r.model)}${r.fellBack ? ' (fallback model answered)' : ''}</div>`).join('')}
        ${notes.map((n) => `<div class="ai-note">${n}</div>`).join('')}`;
    }
    const declined = (n) => ({ message: `The request was declined${n.refusal && n.refusal !== 'policy' ? ` (${n.refusal})` : ''}. Try rephrasing it.` });

    async function run() {
      if (busy) return;
      const prompt = ta.value.trim(); if (!prompt) { ta.focus(); return; }
      const ks = await A.ai.keyStatus(current().provider); if (!ks.hasKey) { m.close(); return A.openAISettings(() => A.openAI(mode)); }
      if (current().provider === 'openrouter') await A.loadOpenRouterModels();
      busy = true; go.disabled = true; cancel.hidden = false; ta.disabled = true;
      const rows = [], notes = [];
      resBox.hidden = false; resBox.innerHTML = '<div class="ai-progress"><span class="spinner"></span> <span data-status>Thinking…</span></div><div class="ai-stream"></div>';
      const status = (t) => { const s = resBox.querySelector('[data-status]'); if (s) s.textContent = t; };
      let diagram = null, created = null;
      try {
        if (mode !== 'document') {
          status('Designing the flow diagram…');
          const req = buildRequest('diagram', userContent('diagram', prompt, opt('useBoard')));
          const res = await callWithRetry(req);
          if (!res.ok) throw res.error;
          const n = req.provider === 'anthropic' ? normClaude(res.result, req.model) : normChat(req.provider, res.result, req.model);
          rows.push(record('diagram', n, req, { prompt: prompt.slice(0, 200) }));
          if (n.stop === 'refusal') throw declined(n);
          if (n.stop === 'length') throw { message: 'The diagram was too long and got cut off. Try a narrower request.' };
          diagram = parseJSONLoose(n.text);
          if (!diagram) throw { message: 'The diagram came back in an unexpected format. Please try again or pick another model.' };
          if (!Array.isArray(diagram.nodes) || !diagram.nodes.length) throw { message: 'No diagram was produced. Try describing the steps in more detail.' };
          A.checkpoint();
          const title = diagram.title || 'AI diagram';
          const { snap, innerBoard } = diagramSnapshot(diagram, title, { newBoard: opt('newBoard'), modelLabel: A.aiModelLabel(req.provider, req.model) });
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
          const req = buildRequest('document', userContent('document', prompt, opt('useBoard'), diagram));
          const res = await callWithRetry(req, (d) => {
            mdText += d; const now = Date.now(); if (now - last > 120) { last = now; box.innerHTML = A.sanitize(A.mdToHtml(mdText)); box.scrollTop = box.scrollHeight; }
          });
          if (!res.ok) throw res.error;
          const n = req.provider === 'anthropic' ? normClaude(res.result, req.model) : normChat(req.provider, res.result, req.model);
          rows.push(record('document', n, req, { prompt: prompt.slice(0, 200) }));
          if (n.stop === 'refusal') throw declined(n);
          const full = n.text || mdText;
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
          notes.push(`${I('check', 13)} Wrote the document “${esc(title)}”${n.stop === 'length' ? ' (stopped at the length limit)' : ''}.`);
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
    const s = settings();
    const body = A.h('<div class="settings ai-settings"></div>');
    const m = A.modal({ title: 'AI settings', body, wide: true, onClose: () => after && after() });
    let view = s.provider;
    const render = async () => {
      const p = A.AI_PROVIDERS[view]; const st = await A.ai.keyStatus(view);
      const statuses = {}; for (const k of Object.keys(A.AI_PROVIDERS)) statuses[k] = k === view ? st : await A.ai.keyStatus(k);
      body.innerHTML = `
        <section><h4>Provider</h4>
          <div class="seg">${Object.entries(A.AI_PROVIDERS).map(([k, v]) => `<button data-prov="${k}" class="${view === k ? 'on' : ''}">${esc(v.label)}${statuses[k].hasKey ? ' ✓' : ''}</button>`).join('')}</div>
          <label class="check"><input type="radio" name="useprov" ${s.provider === view ? 'checked' : ''} data-use> Use ${esc(p.label)} for AI requests</label></section>
        <section><h4>${esc(p.label)} API key</h4>
          <p class="muted small">${isDesktop()
            ? 'Stored on this Mac, encrypted with your macOS keychain. It never leaves the app except to call the provider.'
            : 'Stored in this browser only. For better security, use the desktop app, which keeps keys encrypted outside the page.'}
            Get a key at <a href="${p.keyUrl}" target="_blank" rel="noopener">${esc(new URL(p.keyUrl).host)}</a>.</p>
          <div class="row"><input class="input" type="password" autocomplete="off" placeholder="${st.hasKey ? '•••••••• key saved' : esc(p.keyHint)}" data-key><button class="btn primary" data-savekey>Save</button>${st.hasKey ? '<button class="btn danger" data-clearkey>Remove</button>' : ''}</div>
          ${st.fromEnv ? '<p class="muted small">Using the key from an environment variable.</p>' : ''}</section>
        <section><h4>Model</h4><div data-models></div></section>
        ${view !== 'openrouter' ? `<section><h4>Effort</h4><p class="muted small">Higher effort reasons longer: better on complex processes, more output tokens. Applies to Claude and OpenAI.</p>
          <div class="seg">${['low', 'medium', 'high'].map((e) => `<button data-effort="${e}" class="${s.effort === e ? 'on' : ''}">${e[0].toUpperCase() + e.slice(1)}</button>`).join('')}</div></section>` : ''}
        <section><h4>Monthly budget</h4><p class="muted small">Across all providers. Warns you before a request would go over. 0 = no budget.</p>
          <div class="row"><span>$</span><input class="input" type="number" min="0" step="1" value="${s.budget || 0}" data-budget style="max-width:120px"></div></section>`;
      const models = body.querySelector('[data-models]');
      if (view === 'anthropic') {
        models.innerHTML = Object.entries(A.AI_MODELS).map(([id, x]) => `<label class="check radio"><input type="radio" name="aimodel" value="${id}" ${s.models.anthropic === id ? 'checked' : ''}> <span><b>${esc(x.label)}</b> <span class="muted small">— ${esc(x.note)} · ${A.fmtUSD(x.in)} in / ${A.fmtUSD(x.out)} out per 1M</span></span></label>`).join('');
      } else if (view === 'openai') {
        const known = A.OPENAI_MODELS[s.models.openai];
        models.innerHTML = Object.entries(A.OPENAI_MODELS).map(([id, x]) => `<label class="check radio"><input type="radio" name="aimodel" value="${id}" ${s.models.openai === id ? 'checked' : ''}> <span><b>${esc(x.label)}</b> <span class="muted small">— ${esc(x.note)} · ${A.fmtUSD(x.in)} in / ${A.fmtUSD(x.out)} out per 1M</span></span></label>`).join('') +
          `<label class="check radio"><input type="radio" name="aimodel" value="__custom" ${known ? '' : 'checked'}> <span><b>Other model</b></span></label>
           <div class="ai-custom ${known ? 'dim' : ''}"><input class="input" placeholder="Model ID, e.g. gpt-5.5" value="${known ? '' : esc(s.models.openai)}" data-customid>
           <span class="small muted">$ per 1M:</span><input class="input" type="number" min="0" step="0.01" placeholder="input" value="${s.customOpenAI.in || ''}" data-cin><input class="input" type="number" min="0" step="0.01" placeholder="output" value="${s.customOpenAI.out || ''}" data-cout></div>`;
        const cid = models.querySelector('[data-customid]');
        cid.oninput = () => { if (cid.value.trim()) { s.models.openai = cid.value.trim(); models.querySelector('input[value=__custom]').checked = true; A.save(); } };
        models.querySelector('[data-cin]').oninput = (e) => { s.customOpenAI.in = +e.target.value || 0; A.save(); };
        models.querySelector('[data-cout]').oninput = (e) => { s.customOpenAI.out = +e.target.value || 0; A.save(); };
        cid.addEventListener('keydown', (e) => e.stopPropagation());
      } else {
        models.innerHTML = `<p class="muted small">OpenRouter gives one key access to hundreds of models. Prices come from OpenRouter's live catalog; the cost shown after each request is what OpenRouter actually charged.</p>
          <div class="ai-or-current" data-orcur></div>
          <input class="input" placeholder="Search models (e.g. claude, gpt, gemini, llama)…" data-orq>
          <div class="ai-or-list" data-orlist><div class="muted small">Loading models…</div></div>`;
        const q = models.querySelector('[data-orq]'), list = models.querySelector('[data-orlist]'), curEl = models.querySelector('[data-orcur]');
        const showCur = () => { const x = orModel(s.models.openrouter); curEl.innerHTML = `Selected: <b>${esc(x ? x.name : s.models.openrouter)}</b> <span class="muted small">${esc(s.models.openrouter)}${x ? ` · ${A.fmtUSD(x.prompt * 1e6)} in / ${A.fmtUSD(x.completion * 1e6)} out per 1M${x.struct ? '' : ' · no structured output (uses JSON prompt)'}` : ''}</span>`; };
        const draw = () => {
          if (!orCatalog) { list.innerHTML = '<div class="muted small">Could not load the model list. Check your connection.</div>'; return; }
          const t = q.value.trim().toLowerCase();
          const hits = orCatalog.filter((x) => !t || x.id.toLowerCase().includes(t) || x.name.toLowerCase().includes(t)).slice(0, 60);
          list.innerHTML = hits.map((x) => `<button class="ai-or-row ${x.id === s.models.openrouter ? 'on' : ''}" data-or="${esc(x.id)}"><span><b>${esc(x.name)}</b><br><span class="muted small">${esc(x.id)}</span></span><span class="small">${x.prompt || x.completion ? `${A.fmtUSD(x.prompt * 1e6)} / ${A.fmtUSD(x.completion * 1e6)}` : 'free'}</span></button>`).join('') || '<div class="muted small">No matches</div>';
        };
        q.oninput = draw; q.addEventListener('keydown', (e) => e.stopPropagation());
        list.onclick = (e) => { const b = e.target.closest('[data-or]'); if (!b) return; s.models.openrouter = b.dataset.or; A.save(); showCur(); draw(); };
        showCur(); draw();
        A.loadOpenRouterModels().then(() => { showCur(); draw(); });
      }
      models.querySelectorAll('input[name=aimodel]').forEach((r) => (r.onchange = () => {
        if (r.value === '__custom') { const c = models.querySelector('[data-customid]'); c.focus(); if (c.value.trim()) s.models.openai = c.value.trim(); }
        else s.models[view] = r.value;
        A.save();
      }));
      body.querySelectorAll('[data-prov]').forEach((b) => (b.onclick = () => { view = b.dataset.prov; render(); }));
      body.querySelector('[data-use]').onchange = () => { s.provider = view; A.save(); };
      body.querySelector('[data-savekey]').onclick = async () => {
        const v = body.querySelector('[data-key]').value.trim();
        if (!v) return;
        if (!p.keyPrefix.test(v)) return A.toast(`That doesn’t look like a ${p.label} API key (it should start with ${p.keyHint.replace('…', '')})`);
        const r = await A.ai.setKey(view, v);
        if (r.ok) { if (!(await A.ai.keyStatus(s.provider)).hasKey) s.provider = view; A.save(); A.toast(`${p.label} key saved`); render(); } else A.toast('Could not save key: ' + (r.error && r.error.message));
      };
      const ck = body.querySelector('[data-clearkey]'); if (ck) ck.onclick = async () => { await A.ai.clearKey(view); A.toast(`${p.label} key removed`); render(); };
      body.querySelector('[data-key]').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') body.querySelector('[data-savekey]').click(); });
      body.querySelectorAll('[data-effort]').forEach((b) => (b.onclick = () => { s.effort = b.dataset.effort; body.querySelectorAll('[data-effort]').forEach((x) => x.classList.toggle('on', x === b)); A.save(); }));
      body.querySelector('[data-budget]').oninput = (e) => { s.budget = Math.max(0, +e.target.value || 0); A.save(); A.updateAIBadge(); };
    };
    render();
    return m;
  };

  /* ---------- usage panel ---------- */
  A.renderAIUsage = function () {
    const p = document.getElementById('side-panel');
    const day = totals(startOfDay()), month = totals(startOfMonth()), all = totals(0);
    const s = settings(); const rows = ledger();
    const group = (key, label) => { const g = {}; rows.forEach((r) => { const k = label(r); const f = (g[k] = g[k] || { n: 0, cost: 0, tokens: 0 }); f.n++; f.cost += r.cost; f.tokens += r.input + (r.cacheRead || 0) + r.output; }); return g; };
    const byFeature = group('feature', (r) => (r.feature === 'diagram' ? 'Flow diagrams' : 'Documentation'));
    const byProvider = group('provider', (r) => (A.AI_PROVIDERS[r.provider || 'anthropic'] || {}).label || r.provider);
    const block = (label, t) => `<div class="ai-tot"><div class="muted small">${label}</div><div class="ai-tot-cost">${A.fmtUSD(t.cost)}</div><div class="muted small">${A.fmtNum(t.n)} request${t.n === 1 ? '' : 's'} · ${A.fmtNum(t.input)} in · ${A.fmtNum(t.output)} out</div></div>`;
    const grp = (title, g) => Object.keys(g).length ? `<div class="nav-section">${title}</div>${Object.entries(g).map(([k, v]) => `<div class="ai-row"><span>${esc(k)}</span><span class="muted small">${v.n} · ${A.fmtNum(v.tokens)} tokens</span><b>${A.fmtUSD(v.cost)}</b></div>`).join('')}` : '';
    const pct = s.budget ? Math.min(100, (month.cost / s.budget) * 100) : 0;
    p.innerHTML = `<div class="panel-head"><h3>AI usage</h3><button class="icon-btn" data-pclose>${I('x', 16)}</button></div>
      <div class="panel-body">
        <div class="ai-tots">${block('Today', day)}${block('This month', month)}${block('All time', all)}</div>
        ${s.budget ? `<div class="ai-budget"><div class="row between"><span class="small">Monthly budget</span><span class="small">${A.fmtUSD(month.cost)} of ${A.fmtUSD(s.budget)}</span></div><div class="progress"><div style="width:${pct}%;${pct >= 100 ? 'background:var(--danger)' : pct > 80 ? 'background:#f2a20c' : ''}"></div></div></div>` : ''}
        ${all.thinking ? `<p class="muted small">Output includes ${A.fmtNum(all.thinking)} reasoning tokens in total.</p>` : ''}
        ${grp('By provider', byProvider)}${grp('By feature', byFeature)}
        <div class="nav-section">Recent requests</div>
        <div class="ai-list">${rows.slice(0, 60).map((r) => `<div class="ai-req"><div class="row between"><b class="small">${r.feature === 'diagram' ? 'Flow diagram' : 'Document'}</b><b class="small">${A.fmtUSD(r.cost)}</b></div>
          <div class="muted small">${A.fmtTime(r.time)} · ${esc((A.AI_PROVIDERS[r.provider || 'anthropic'] || {}).label || '')} · ${esc(r.model)}${r.fellBack ? ' (fallback)' : ''}${r.costSource === 'charged' ? ' · as charged' : ''}</div>
          <div class="muted small">${A.fmtNum(r.input + (r.cacheRead || 0) + (r.cacheWrite || 0))} input · ${A.fmtNum(r.output)} output${r.thinking ? ` (${A.fmtNum(r.thinking)} reasoning)` : ''}${r.stop && !/^(end|end_turn)$/.test(r.stop) ? ` · stopped: ${esc(r.stop)}` : ''}</div>
          ${r.prompt ? `<div class="ai-req-prompt small">“${esc(r.prompt)}”</div>` : ''}</div>`).join('') || `<div class="empty-small">${I('sparkle', 24)}<br>No AI requests yet.</div>`}</div>
        <div class="row wrap" style="margin-top:14px"><button class="btn small" data-new>${I('sparkle', 13)} New AI request</button><button class="btn small" data-csv>${I('download', 13)} Export CSV</button><button class="btn small" data-set>${I('settings', 13)} Settings</button>${rows.length ? '<button class="btn small danger" data-clear>Clear history</button>' : ''}</div>
        <p class="muted small" style="margin-top:12px">Claude and OpenAI costs use each provider's list prices applied to the token counts the API reports. OpenRouter costs are the amounts OpenRouter reports as charged. Your provider's bill is the final word.</p>
      </div>`;
    p.querySelector('[data-pclose]').onclick = () => A.togglePanel('ai');
    p.querySelector('[data-new]').onclick = () => A.openAI();
    p.querySelector('[data-set]').onclick = () => A.openAISettings(() => A.renderAIUsage());
    p.querySelector('[data-csv]').onclick = () => {
      const head = 'time,provider,feature,model,requested_model,input_tokens,output_tokens,reasoning_tokens,cache_read_tokens,cache_write_tokens,cost_usd,cost_source,stop_reason,prompt';
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [head, ...rows.map((r) => [new Date(r.time).toISOString(), r.provider || 'anthropic', r.feature, q(r.model), q(r.requested), r.input, r.output, r.thinking || 0, r.cacheRead || 0, r.cacheWrite || 0, r.cost.toFixed(6), r.costSource || 'list price', r.stop, q(r.prompt)].join(','))].join('\n');
      A.downloadText(csv, `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    };
    const cl = p.querySelector('[data-clear]'); if (cl) cl.onclick = async () => { if (!(await A.confirm('Clear the AI usage history? This does not affect your provider bills.', 'Clear', true))) return; A.state.aiUsage = []; A.save(); A.updateAIBadge(); A.renderAIUsage(); };
  };

  // test hooks (used by the automated checks; harmless otherwise)
  A._aiInternals = { buildRequest, normClaude, normChat, countTokens, parseJSONLoose, callWithRetry, setCatalog: (c) => (orCatalog = c) };
})();
