// 9router API key, encrypted with Electron safeStorage (DPAPI on Windows).
// Main process only: no IPC handler may return the key to the renderer.
// Uses the async safeStorage API; the sync one is deprecated in Electron 45.
// The router base URL lives next to it in router.json: each owner runs their
// own router, and the URL is not a secret, so it is stored as plain JSON.

const fs = require('node:fs');
const path = require('node:path');

function normaliseUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('URL router tidak valid. Contoh: https://router.contoh.com/v1');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('URL router harus http atau https.');
  // Credentials belong in the key field, never in a plain-text file.
  if (url.username || url.password) throw new Error('URL router tidak boleh memuat nama pengguna atau sandi.');
  return url.href.replace(/\/+$/, '');
}

function createSecrets({ dir, safeStorage }) {
  const file = path.join(dir, 'router-key.bin');
  const urlFile = path.join(dir, 'router.json');

  function getRouterUrl() {
    try {
      return JSON.parse(fs.readFileSync(urlFile, 'utf8')).baseUrl || null;
    } catch {
      return null;
    }
  }

  function setRouterUrl(raw) {
    const baseUrl = normaliseUrl(raw);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${urlFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ baseUrl }));
    fs.renameSync(tmp, urlFile);
  }

  async function write(key) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, await safeStorage.encryptStringAsync(key));
    fs.renameSync(tmp, file);
  }

  async function getRouterKey() {
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    let decrypted;
    try {
      decrypted = await safeStorage.decryptStringAsync(buf);
    } catch {
      // Encrypted by another Windows user or machine: treat as unset.
      return null;
    }
    if (decrypted.shouldReEncrypt) await write(decrypted.result);
    return decrypted.result;
  }

  async function setRouterKey(key) {
    if (typeof key !== 'string' || !key.trim()) throw new Error('router key must be a non-empty string');
    // Never fall back to plain text (spec §3.2).
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('OS encryption is not available; key not stored');
    await write(key.trim());
  }

  return { setRouterKey, getRouterKey, hasRouterKey: async () => (await getRouterKey()) !== null, getRouterUrl, setRouterUrl };
}

module.exports = { createSecrets };
