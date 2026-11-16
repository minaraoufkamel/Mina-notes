// Electron main-process bridge for AI providers (Claude, OpenAI, OpenRouter).
// API keys live only here, encrypted with the OS keychain via safeStorage.
// The web page sends request parameters over IPC and gets results back.
const { ipcMain, safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;
const OpenAI = require('openai').default;

const PROVIDERS = ['anthropic', 'openai', 'openrouter'];
const ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' };
const keyFile = (p) => path.join(app.getPath('userData'), `ai-key-${p}.bin`);
const clients = {};
const streams = new Map(); // request id -> stream (for cancel)

// Earlier versions stored a single Claude key in ai-key.bin.
function migrateOldKey() {
  try {
    const old = path.join(app.getPath('userData'), 'ai-key.bin');
    if (fs.existsSync(old) && !fs.existsSync(keyFile('anthropic'))) fs.renameSync(old, keyFile('anthropic'));
  } catch (e) { console.error('Key migration skipped:', e.message); }
}

function readKey(p) {
  try {
    if (fs.existsSync(keyFile(p)) && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(fs.readFileSync(keyFile(p)));
  } catch (e) { console.error(`Could not read ${p} key:`, e.message); }
  return process.env[ENV[p]] || '';
}

function getClient(p) {
  if (clients[p]) return clients[p];
  const apiKey = readKey(p);
  if (!apiKey) return null;
  if (p === 'anthropic') clients[p] = new Anthropic({ apiKey });
  else if (p === 'openai') clients[p] = new OpenAI({ apiKey });
  else clients[p] = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', defaultHeaders: { 'X-Title': 'Mina Notes' } });
  return clients[p];
}

// Errors don't survive IPC as class instances, so send a plain description.
// Both SDKs expose the same error class names.
function describeError(err, p) {
  const S = p === 'anthropic' ? Anthropic : OpenAI;
  if (err instanceof S.AuthenticationError) return { kind: 'auth', status: 401, message: 'The API key was rejected.' };
  if (err instanceof S.PermissionDeniedError) return { kind: 'permission', status: 403, message: err.message };
  if (err instanceof S.NotFoundError) return { kind: 'not_found', status: 404, message: err.message };
  if (err instanceof S.RateLimitError) return { kind: 'rate_limit', status: 429, message: 'Rate limited (or out of credits) — wait a moment or check your account.' };
  if (err instanceof S.BadRequestError) return { kind: 'bad_request', status: 400, message: err.message };
  if (err instanceof S.APIUserAbortError) return { kind: 'aborted', message: 'Cancelled.' };
  if (err instanceof S.APIConnectionError) return { kind: 'network', message: 'Could not reach the AI provider. Check your internet connection.' };
  if (err instanceof S.APIError) return { kind: 'api', status: err.status, message: err.message };
  return { kind: 'unknown', message: (err && err.message) || String(err) };
}

async function streamChat(client, params, id, send) {
  const stream = await client.chat.completions.create({ ...params, stream: true });
  streams.set(id, { abort: () => stream.controller.abort() });
  let text = '', refusal = '', usage = null, finish = null, model = params.model;
  for await (const chunk of stream) {
    if (chunk.model) model = chunk.model;
    if (chunk.usage) usage = chunk.usage;
    const c = chunk.choices && chunk.choices[0];
    if (!c) continue;
    const d = c.delta || {};
    if (d.content) { text += d.content; send(d.content); }
    if (d.refusal) refusal += d.refusal;
    if (c.finish_reason) finish = c.finish_reason;
  }
  return { model, choices: [{ message: { role: 'assistant', content: text, refusal: refusal || null }, finish_reason: finish }], usage };
}

async function call({ id, provider, op, params }, send) {
  if (!PROVIDERS.includes(provider)) return { ok: false, error: { kind: 'bad_request', message: 'Unknown provider' } };
  const c = getClient(provider);
  if (!c) return { ok: false, error: { kind: 'no_key', message: 'Add an API key for this provider first.' } };
  try {
    if (provider === 'anthropic') {
      if (op === 'count') return { ok: true, result: await c.messages.countTokens(params) };
      if (op === 'create') return { ok: true, result: await c.beta.messages.create(params) };
      if (op === 'stream') {
        const s = c.beta.messages.stream(params);
        streams.set(id, s);
        s.on('text', (d) => send(d));
        return { ok: true, result: await s.finalMessage() };
      }
    } else {
      if (op === 'count' && provider === 'openai') return { ok: true, result: await c.responses.inputTokens.count(params) };
      if (op === 'create') return { ok: true, result: await c.chat.completions.create(params) };
      if (op === 'stream') return { ok: true, result: await streamChat(c, params, id, send) };
    }
    return { ok: false, error: { kind: 'bad_request', message: `Unsupported operation ${op} for ${provider}` } };
  } catch (err) {
    return { ok: false, error: describeError(err, provider) };
  } finally {
    streams.delete(id);
  }
}

function register(getWindow) {
  migrateOldKey();

  ipcMain.handle('ai:keyStatus', (e, p) => ({
    hasKey: !!readKey(p),
    encrypted: safeStorage.isEncryptionAvailable(),
    fromEnv: !fs.existsSync(keyFile(p)) && !!process.env[ENV[p]],
  }));

  ipcMain.handle('ai:setKey', (e, p, key) => {
    key = String(key || '').trim();
    if (!PROVIDERS.includes(p) || !key) return { ok: false, error: { message: 'Missing key' } };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: { message: 'Secure storage is not available on this system.' } };
    fs.writeFileSync(keyFile(p), safeStorage.encryptString(key), { mode: 0o600 });
    delete clients[p];
    return { ok: true };
  });

  ipcMain.handle('ai:clearKey', (e, p) => {
    try { fs.rmSync(keyFile(p), { force: true }); } catch (err) {}
    delete clients[p];
    return { ok: true };
  });

  ipcMain.handle('ai:call', (e, req) => {
    const win = getWindow();
    const send = (delta) => { if (win && !win.isDestroyed()) win.webContents.send('ai:delta', { id: req.id, delta }); };
    return call(req, send);
  });

  ipcMain.handle('ai:cancel', (e, id) => { const s = streams.get(id); if (s) s.abort(); return { ok: true }; });

  // Public OpenRouter model catalog (no key needed), fetched here to avoid CORS issues.
  ipcMain.handle('ai:openrouterModels', async () => {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/models');
      if (!r.ok) return { ok: false, error: { message: `HTTP ${r.status}` } };
      return { ok: true, result: await r.json() };
    } catch (err) { return { ok: false, error: { kind: 'network', message: 'Could not load the OpenRouter model list.' } }; }
  });
}

module.exports = { register };
