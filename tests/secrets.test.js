const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSecrets } = require('../src/main/secrets.js');

// Stand-in for Electron's async safeStorage API (the sync one is deprecated in
// Electron 45): reversible, and never stores the plain text.
const xor = (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a));
function fakeSafeStorage({ available = true, reEncrypt = false } = {}) {
  return {
    encrypted: 0,
    isAsyncEncryptionAvailable: async () => available,
    async encryptStringAsync(s) { this.encrypted++; return xor(Buffer.from(s, 'utf8')); },
    decryptStringAsync: async (buf) => ({ shouldReEncrypt: reEncrypt, result: xor(buf).toString('utf8') }),
  };
}

function setup(t, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-secrets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const safeStorage = fakeSafeStorage(opts);
  return { dir, safeStorage, secrets: createSecrets({ dir, safeStorage }) };
}

const KEY = 'sk-test-not-a-real-key-123';

test('no key stored yet', async (t) => {
  const { secrets } = setup(t);
  assert.equal(await secrets.hasRouterKey(), false);
  assert.equal(await secrets.getRouterKey(), null);
});

test('stored key round-trips and survives a new instance', async (t) => {
  const { dir, secrets } = setup(t);
  await secrets.setRouterKey(KEY);
  assert.equal(await secrets.hasRouterKey(), true);
  assert.equal(await secrets.getRouterKey(), KEY);
  assert.equal(await createSecrets({ dir, safeStorage: fakeSafeStorage() }).getRouterKey(), KEY);
});

test('the key never appears in plain text on disk', async (t) => {
  const { dir, secrets } = setup(t);
  await secrets.setRouterKey(KEY);
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!fs.readFileSync(path.join(dir, f)).includes(KEY), f);
  }
});

test('refuses to store when OS encryption is unavailable, and writes nothing', async (t) => {
  const { dir, secrets } = setup(t, { available: false });
  await assert.rejects(secrets.setRouterKey(KEY), /encryption/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('rejects empty or non-string keys', async (t) => {
  const { secrets } = setup(t);
  for (const bad of ['', '   ', null, 42]) await assert.rejects(secrets.setRouterKey(bad), /key/);
});

test('a key file that cannot be decrypted reads as no key', async (t) => {
  const { dir } = setup(t);
  await createSecrets({ dir, safeStorage: fakeSafeStorage() }).setRouterKey(KEY);
  const broken = createSecrets({ dir, safeStorage: { ...fakeSafeStorage(), decryptStringAsync: async () => { throw new Error('bad'); } } });
  assert.equal(await broken.getRouterKey(), null);
});

test('a rotated OS key re-encrypts the stored key on read', async (t) => {
  const { dir } = setup(t);
  await createSecrets({ dir, safeStorage: fakeSafeStorage() }).setRouterKey(KEY);
  const rotating = fakeSafeStorage({ reEncrypt: true });
  assert.equal(await createSecrets({ dir, safeStorage: rotating }).getRouterKey(), KEY);
  assert.equal(rotating.encrypted, 1);
});
