// Electron main-process bridge for Claude API calls.
// The API key lives only here (encrypted with the OS keychain via safeStorage);
// the web page sends request parameters over IPC and gets results back.
const { ipcMain, safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

const keyFile = () => path.join(app.getPath('userData'), 'ai-key.bin');
const streams = new Map(); // request id -> stream (for cancel)
let client = null;

function readKey() {
  try {
    if (fs.existsSync(keyFile()) && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(fs.readFileSync(keyFile()));
    }
  } catch (e) { console.error('Could not read API key:', e.message); }
  return process.env.ANTHROPIC_API_KEY || '';
}

function getClient() {
  if (client) return client;
  const apiKey = readKey();
  if (!apiKey) return null;
  client = new Anthropic({ apiKey });
  return client;
}

// Errors don't survive IPC as class instances, so send a plain description.
function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return { kind: 'auth', status: 401, message: 'The API key was rejected.' };
  if (err instanceof Anthropic.PermissionDeniedError) return { kind: 'permission', status: 403, message: err.message };
  if (err instanceof Anthropic.NotFoundError) return { kind: 'not_found', status: 404, message: err.message };
  if (err instanceof Anthropic.RateLimitError) return { kind: 'rate_limit', status: 429, message: 'Rate limited — wait a moment and try again.' };
  if (err instanceof Anthropic.BadRequestError) return { kind: 'bad_request', status: 400, message: err.message };
  if (err instanceof Anthropic.APIUserAbortError) return { kind: 'aborted', message: 'Cancelled.' };
  if (err instanceof Anthropic.APIConnectionError) return { kind: 'network', message: 'Could not reach the Claude API. Check your internet connection.' };
  if (err instanceof Anthropic.APIError) return { kind: 'api', status: err.status, message: err.message };
  return { kind: 'unknown', message: (err && err.message) || String(err) };
}

function register(getWindow) {
  ipcMain.handle('ai:keyStatus', () => ({
    hasKey: !!readKey(),
    encrypted: safeStorage.isEncryptionAvailable(),
    fromEnv: !fs.existsSync(keyFile()) && !!process.env.ANTHROPIC_API_KEY,
  }));

  ipcMain.handle('ai:setKey', (e, key) => {
    key = String(key || '').trim();
    if (!key) return { ok: false, error: { message: 'Empty key' } };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: { message: 'Secure storage is not available on this system.' } };
    fs.writeFileSync(keyFile(), safeStorage.encryptString(key), { mode: 0o600 });
    client = null;
    return { ok: true };
  });

  ipcMain.handle('ai:clearKey', () => {
    try { fs.rmSync(keyFile(), { force: true }); } catch (e) {}
    client = null;
    return { ok: true };
  });

  ipcMain.handle('ai:count', async (e, params) => {
    const c = getClient(); if (!c) return { ok: false, error: { kind: 'no_key', message: 'Add your Claude API key first.' } };
    try { return { ok: true, result: await c.messages.countTokens(params) }; }
    catch (err) { return { ok: false, error: describeError(err) }; }
  });

  ipcMain.handle('ai:create', async (e, params) => {
    const c = getClient(); if (!c) return { ok: false, error: { kind: 'no_key', message: 'Add your Claude API key first.' } };
    try { return { ok: true, result: await c.beta.messages.create(params) }; }
    catch (err) { return { ok: false, error: describeError(err) }; }
  });

  ipcMain.handle('ai:stream', async (e, { id, params }) => {
    const c = getClient(); if (!c) return { ok: false, error: { kind: 'no_key', message: 'Add your Claude API key first.' } };
    const win = getWindow();
    try {
      const stream = c.beta.messages.stream(params);
      streams.set(id, stream);
      stream.on('text', (delta) => { if (win && !win.isDestroyed()) win.webContents.send('ai:delta', { id, delta }); });
      const message = await stream.finalMessage();
      return { ok: true, result: message };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    } finally {
      streams.delete(id);
    }
  });

  ipcMain.handle('ai:cancel', (e, id) => { const s = streams.get(id); if (s) s.abort(); return { ok: true }; });
}

module.exports = { register };
