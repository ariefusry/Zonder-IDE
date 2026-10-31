const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseLine } = require('../src/main/agents/claude-parse.js');

// Real lines recorded from claude 2.1.316 (haiku) over stream-json; temp paths
// replaced with C:\wt and the init line trimmed to the fields Zonder reads.
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'claude', `${name}.jsonl`), 'utf8').trim().split('\n');
const one = (name) => parseLine(fixture(name)[0]);

test('system/init yields the session id', () => {
  assert.deepEqual(one('init'), [{ type: 'session', sessionId: 'ef6d033a-2ef2-4ba5-b93d-edabdca54057' }]);
});

test('assistant text becomes an agent message', () => {
  assert.deepEqual(one('text'), [{ type: 'message', role: 'agent', text: 'Marker: ZQ " & % ^ | < > end\nLine2: ZQ-second' }]);
});

test('assistant thinking sets status thinking and shows no text', () => {
  assert.deepEqual(one('thinking'), [{ type: 'status', to: 'thinking' }]);
});

test('tool_use Write starts a tool row and sets working', () => {
  assert.deepEqual(one('tool_use_write'), [
    { type: 'tool_start', toolUseId: 'toolu_01ALV23PorFWnmzCFCAY5dMq', tool: 'Write', summary: 'C:\\wt\\hello.txt', input: { file_path: 'C:\\wt\\hello.txt', content: 'hi' } },
    { type: 'status', to: 'working' },
  ]);
});

test('tool_use Bash with a recognised test command sets testing', () => {
  const events = one('tool_use_bash_test');
  assert.equal(events[0].type, 'tool_start');
  assert.equal(events[0].tool, 'Bash');
  assert.equal(events[0].summary, 'node --test');
  assert.deepEqual(events[1], { type: 'status', to: 'testing' });
});

test('a Bash command that is not a test stays working', () => {
  const line = fixture('tool_use_bash_test')[0].replace('"command":"node --test"', '"command":"node build.js"');
  assert.deepEqual(parseLine(line)[1], { type: 'status', to: 'working' });
});

test('can_use_tool control_request becomes a control item', () => {
  assert.deepEqual(one('control_can_use_tool'), {
    control: { requestId: 'b9534983-e655-4fe8-b3da-f55f7ab27d66', tool: 'Write', toolUseId: 'toolu_01ALV23PorFWnmzCFCAY5dMq', input: { file_path: 'C:\\wt\\hello.txt', content: 'hi' } },
  });
});

test('tool_result ends the tool row with its output', () => {
  const [evt] = one('tool_result');
  assert.equal(evt.type, 'tool_end');
  assert.equal(evt.toolUseId, 'toolu_01ALV23PorFWnmzCFCAY5dMq');
  assert.equal(evt.isError, false);
  assert.match(evt.output, /^File created successfully at: C:\\wt\\hello\.txt/);
});

test('a denied tool_result is marked as an error with the denial text', () => {
  assert.deepEqual(one('tool_result_denied'), [{ type: 'tool_end', toolUseId: 'toolu_01DfdGKyUanoUA9W21afJTb9', isError: true, output: 'Ditolak oleh pemilik (uji).' }]);
});

test('result success ends the turn as done', () => {
  assert.deepEqual(one('result_success'), [{ type: 'status', to: 'done' }, { type: 'turn_end', interrupted: false }]);
});

test('an interrupted turn returns to idle, not done or error', () => {
  assert.deepEqual(one('result_interrupted'), [{ type: 'status', to: 'idle' }, { type: 'turn_end', interrupted: true }]);
});

test('a failed turn reports the error and leaves the agent usable', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'api_error', result: 'Overloaded' });
  assert.deepEqual(parseLine(line), [{ type: 'error', message: 'Overloaded' }, { type: 'status', to: 'idle' }, { type: 'turn_end', interrupted: false }]);
});

test('hooks, rate limits, summaries, notifications and control_responses are ignored', () => {
  for (const line of [...fixture('ignored'), ...fixture('control_response_interrupt')]) assert.deepEqual(parseLine(line), [], line.slice(0, 60));
});

test('unparseable or odd lines return [] without throwing', () => {
  for (const line of ['', '   ', '{"type":"assis', 'not json', 'null', '42', '[]', '{"type":"assistant"}', '{"type":"user","message":{"content":"plain"}}']) {
    assert.deepEqual(parseLine(line), [], line);
  }
});

test('very long tool output is capped', () => {
  const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(50000) }] } });
  const [evt] = parseLine(line);
  assert.ok(evt.output.length <= 8100);
  assert.match(evt.output, /dipotong/);
});

test('long string fields in tool_start input are capped (file contents, edit strings)', () => {
  const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'a.txt', content: 'y'.repeat(30000) } }] } });
  const [evt] = parseLine(line);
  assert.equal(evt.input.file_path, 'a.txt');
  assert.ok(evt.input.content.length <= 2100);
  assert.match(evt.input.content, /dipotong/);
});

test('tool_result content given as an array of text blocks is joined', () => {
  const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] } });
  assert.equal(parseLine(line)[0].output, 'a\nb');
});

test('a top-level text_delta stream_event becomes a delta', () => {
  assert.deepEqual(one('stream_text_delta'), [{ type: 'delta', text: ', two, three, four, five' }]);
});

test('other stream_events (thinking, signature, tool input json, subagent text, start/stop) are ignored', () => {
  for (const line of fixture('stream_ignored')) assert.deepEqual(parseLine(line), [], line.slice(0, 90));
});
