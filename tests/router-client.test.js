const test = require('node:test');
const assert = require('node:assert/strict');
const { listModels, streamChat, RouterOffline, RouterHttpError } = require('../src/main/agents/router-client.js');

const enc = new TextEncoder();

// A fetch that answers with the given byte chunks as a streamed body.
function sseFetch(chunks, { status = 200, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const body = new ReadableStream({
      start(ctrl) {
        for (const c of chunks) ctrl.enqueue(typeof c === 'string' ? enc.encode(c) : c);
        ctrl.close();
      },
    });
    return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
  };
}

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const textChunk = (text) => sse({ choices: [{ index: 0, delta: { content: text } }] });

async function collect(iter) {
  const out = [];
  for await (const x of iter) out.push(x);
  return out;
}

const base = { baseUrl: 'https://router.test/v1', key: 'k-123', model: 'm1', messages: [{ role: 'user', content: 'hai' }], tools: [] };

test('listModels returns model ids and sends the bearer key', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ data: [{ id: 'a/model-1' }, { id: 'model-2' }] }), { status: 200 });
  };
  const ids = await listModels({ baseUrl: 'https://router.test/v1/', key: 'k-123', fetch });
  assert.deepEqual(ids, ['a/model-1', 'model-2']);
  assert.equal(calls[0].url, 'https://router.test/v1/models');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k-123');
});

test('listModels: network failure is RouterOffline, HTTP error is RouterHttpError without the key', async () => {
  await assert.rejects(listModels({ baseUrl: 'https://x/v1', key: 'secret-key', fetch: async () => { throw new TypeError('fetch failed'); } }), RouterOffline);
  const err = await listModels({ baseUrl: 'https://x/v1', key: 'secret-key', fetch: async () => new Response('bad key secret-key', { status: 401 }) }).catch((e) => e);
  assert.ok(err instanceof RouterHttpError);
  assert.equal(err.status, 401);
  assert.ok(!err.message.includes('secret-key'));
});

test('streamChat yields text deltas then done, and posts stream:true with tools', async () => {
  const calls = [];
  const out = await collect(streamChat({ ...base, tools: [{ type: 'function', function: { name: 'read_file' } }], fetch: sseFetch([textChunk('Ha'), textChunk('lo'), 'data: [DONE]\n\n'], { calls }) }));
  assert.deepEqual(out, [{ delta: 'Ha' }, { delta: 'lo' }, { done: true }]);
  assert.equal(calls[0].url, 'https://router.test/v1/chat/completions');
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].body.model, 'm1');
  assert.equal(calls[0].body.tools.length, 1);
});

test('streamChat: an SSE event split mid-JSON across chunks still parses', async () => {
  const full = textChunk('halo dunia');
  const cut = Math.floor(full.length / 2);
  const out = await collect(streamChat({ ...base, fetch: sseFetch([full.slice(0, cut), full.slice(cut), 'data: [DO', 'NE]\n\n']) }));
  assert.deepEqual(out, [{ delta: 'halo dunia' }, { done: true }]);
});

test('streamChat: a multibyte character split across chunks survives', async () => {
  const bytes = enc.encode(textChunk('kopi ☕ siap'));
  const at = bytes.indexOf(0xe2) + 1;
  const out = await collect(streamChat({ ...base, fetch: sseFetch([bytes.slice(0, at), bytes.slice(at), 'data: [DONE]\n\n']) }));
  assert.deepEqual(out, [{ delta: 'kopi ☕ siap' }, { done: true }]);
});

test('streamChat: CRLF lines, keepalive comments, data: without space, no [DONE]', async () => {
  const out = await collect(streamChat({ ...base, fetch: sseFetch([': ping\r\n\r\n', `data:${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\r\n\r\n`]) }));
  assert.deepEqual(out, [{ delta: 'x' }, { done: true }]);
});

test('streamChat assembles tool_calls fragments by index', async () => {
  const frag = (tc) => sse({ choices: [{ index: 0, delta: { tool_calls: tc } }] });
  const out = await collect(streamChat({
    ...base,
    fetch: sseFetch([
      frag([{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{"pa' } }]),
      frag([{ index: 0, function: { arguments: 'th":"a.txt"}' } }]),
      frag([{ index: 1, id: 'call_b', type: 'function', function: { name: 'list_dir', arguments: '{}' } }]),
      sse({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n',
    ]),
  }));
  assert.deepEqual(out, [
    { toolCalls: [{ id: 'call_a', name: 'read_file', arguments: '{"path":"a.txt"}' }, { id: 'call_b', name: 'list_dir', arguments: '{}' }] },
    { done: true },
  ]);
});

test('streamChat: tool_calls without index fall back to their position', async () => {
  const out = await collect(streamChat({
    ...base,
    fetch: sseFetch([sse({ choices: [{ delta: { tool_calls: [{ id: 'c1', function: { name: 'list_dir', arguments: '{}' } }] } }] }), 'data: [DONE]\n\n']),
  }));
  assert.deepEqual(out[0], { toolCalls: [{ id: 'c1', name: 'list_dir', arguments: '{}' }] });
});

test('streamChat: tool_call arguments sent as an object become a JSON string', async () => {
  const out = await collect(streamChat({
    ...base,
    fetch: sseFetch([sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: { path: 'a.txt' } } }] } }] }), 'data: [DONE]\n\n']),
  }));
  assert.deepEqual(out[0], { toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}' }] });
});

test('streamChat: malformed SSE data lines are skipped, not thrown', async () => {
  const out = await collect(streamChat({ ...base, fetch: sseFetch(['data: {not json\n\n', textChunk('ok'), 'data: [DONE]\n\n']) }));
  assert.deepEqual(out, [{ delta: 'ok' }, { done: true }]);
});

test('streamChat: HTTP error throws RouterHttpError with status and body snippet', async () => {
  const fetch = async () => new Response('{"error":"model not found"}', { status: 404 });
  const err = await collect(streamChat({ ...base, fetch })).catch((e) => e);
  assert.ok(err instanceof RouterHttpError);
  assert.equal(err.status, 404);
  assert.match(err.message, /404/);
  assert.match(err.message, /model not found/);
});

test('streamChat: fetch failure throws RouterOffline; abort passes through as AbortError', async () => {
  const offline = await collect(streamChat({ ...base, fetch: async () => { throw new TypeError('fetch failed'); } })).catch((e) => e);
  assert.ok(offline instanceof RouterOffline);
  const ctrl = new AbortController();
  ctrl.abort();
  const fetch = async (_u, init) => {
    init.signal.throwIfAborted();
    return new Response('');
  };
  const aborted = await collect(streamChat({ ...base, signal: ctrl.signal, fetch })).catch((e) => e);
  assert.equal(aborted.name, 'AbortError');
});

test('streamChat: effort medium -> reasoning_effort medium; null -> key absent', async () => {
  const calls = [];
  await collect(streamChat({ ...base, effort: 'medium', fetch: sseFetch(['data: [DONE]\n\n'], { calls }) }));
  await collect(streamChat({ ...base, effort: null, fetch: sseFetch(['data: [DONE]\n\n'], { calls }) }));
  assert.equal(calls[0].body.reasoning_effort, 'medium');
  assert.ok(!('reasoning_effort' in calls[1].body));
});
