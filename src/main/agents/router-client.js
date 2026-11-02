// 9router over HTTP (spec §3.2): GET /models and streaming POST /chat/completions
// in the OpenAI format. The key goes only into the Authorization header; no
// error message built here ever contains it.

const MODELS_TIMEOUT_MS = 10000;
const BODY_SNIPPET = 300;

class RouterOffline extends Error {
  constructor(cause) {
    super('Router offline');
    this.name = 'RouterOffline';
    this.cause = cause;
  }
}

class RouterHttpError extends Error {
  constructor(status, snippet) {
    super(`Router menjawab HTTP ${status}${snippet ? `: ${snippet}` : ''}`);
    this.name = 'RouterHttpError';
    this.status = status;
  }
}

const join = (baseUrl, p) => `${String(baseUrl).replace(/\/+$/, '')}/${p}`;

async function request(fetch, url, init, key) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw err;
    throw new RouterOffline(err);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const snippet = text.split(key).join('***').replace(/\s+/g, ' ').trim().slice(0, BODY_SNIPPET);
    throw new RouterHttpError(res.status, snippet);
  }
  return res;
}

async function listModels({ baseUrl, key, fetch = globalThis.fetch, timeoutMs = MODELS_TIMEOUT_MS }) {
  let res;
  try {
    res = await request(fetch, join(baseUrl, 'models'), { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) }, key);
  } catch (err) {
    // A host that never answers is as offline as one that refuses.
    if (err?.name === 'TimeoutError') throw new RouterOffline(err);
    throw err;
  }
  const json = await res.json();
  return (Array.isArray(json?.data) ? json.data : []).map((m) => m?.id).filter((id) => typeof id === 'string');
}

// Yields {servedModel} once, from the first chunk naming the model that
// answered (a combo names its member here), {delta} for streamed text, then {toolCalls} if the model asked for
// tools, then {done: true}. Tool call fragments are joined by index; id and
// name usually arrive only in the first fragment of each call.
async function* streamChat({ baseUrl, key, model, messages, tools, effort = null, signal, fetch = globalThis.fetch }) {
  const body = { model, messages, stream: true };
  // Models and routers without reasoning support ignore it (settings spec §4.6).
  if (effort) body.reasoning_effort = effort;
  if (tools?.length) body.tools = tools;
  const res = await request(fetch, join(baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  }, key);

  const calls = [];
  const decoder = new TextDecoder();
  let buf = '';
  let finished = false;
  let served = false;

  const handle = (line) => {
    const out = [];
    if (!line.startsWith('data:')) return out;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      finished = true;
      return out;
    }
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return out;
    }
    if (!served && typeof json?.model === 'string' && json.model) {
      served = true;
      out.push({ servedModel: json.model });
    }
    const delta = json?.choices?.[0]?.delta;
    if (typeof delta?.content === 'string' && delta.content) out.push({ delta: delta.content });
    (Array.isArray(delta?.tool_calls) ? delta.tool_calls : []).forEach((frag, pos) => {
      const i = Number.isInteger(frag?.index) ? frag.index : pos;
      const call = (calls[i] ??= { id: '', name: '', arguments: '' });
      if (frag?.id) call.id = frag.id;
      if (frag?.function?.name) call.name += frag.function.name;
      const args = frag?.function?.arguments;
      // Some backends send the arguments as an object instead of a JSON string.
      if (typeof args === 'string') call.arguments += args;
      else if (args && typeof args === 'object') call.arguments += JSON.stringify(args);
    });
    return out;
  };

  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while (!finished && (nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      yield* handle(line);
    }
    if (finished) break;
  }
  if (!finished) {
    buf += decoder.decode();
    for (const line of buf.split(/\r?\n/)) yield* handle(line);
  }

  const toolCalls = calls.filter(Boolean);
  if (toolCalls.length) yield { toolCalls };
  yield { done: true };
}

module.exports = { listModels, streamChat, RouterOffline, RouterHttpError };
