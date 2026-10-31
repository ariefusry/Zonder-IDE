# Zonder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows Electron app that spawns Claude Code and 9router agents in per-agent Git worktrees, with own chat UI, enforced role permissions, and an isometric office reflecting real agent status.

**Architecture:** Main process owns everything privileged (child processes, HTTP, git, fs, policy). Every agent kind implements one interface that emits typed events; an `AgentStore` holds records and status and fans events to the renderer over a narrow `contextBridge` API. Renderer is vanilla JS plus Canvas 2D. Claude runs as one persistent `claude -p` stream-json process per agent (no PTY); 9router agents are an HTTP loop where Zonder executes tools locally.

**Tech Stack:** Electron (CommonJS), vanilla JS, `node:test`, `electron-builder` (last task only). No other runtime deps unless a task says so.

**Spec:** `docs/superpowers/specs/2026-11-01-zonder-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- Windows 10/11 x64 only. Node 24.3, Git 2.54, Claude Code 2.1.316.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, preload + `contextBridge`, native Windows titlebar. Renderer API is exactly: `listAgents`, `spawnAgent`, `stopAgent`, `sendMessage`, `respondApproval`, `selectWorkspace`, `subscribeAgentEvents` (extra methods only where a task names them: `interruptAgent`, `listBranches`, `getHistory`, `resumeAgent`, `setRouterKey`, `listModels`).
- Layout: sidebar fixed 220px, chat panel fixed 340px, status bar at bottom. Dark, dense, no gradients/glassmorphism, no emoji sprites.
- Claude launch: `cmd.exe /d /s /c claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode manual --permission-prompt-tool stdio --strict-mcp-config --append-system-prompt <persona> --model <m>`, `cwd` = worktree. Never `--dangerously-skip-permissions`, never PTY/node-pty/xterm.
- Worktrees at `<repo-parent>/.zonder-worktrees/<agent-id>`, branch `zonder/<slug>-<shortid>`. Never auto-merge. Never operate on the main checkout.
- 9router base URL `https://20128-agqzdjehcbqqxt5op7nul4teau.instabox.tech/v1`; key only via `safeStorage`.
- Hard blocks (all roles, never overridable, not by "allow for session"): main-checkout access, paths outside worktree, force push, history rewrite, credential files.
- Enforcement is best-effort (spec §5): unknown shell command → `ask` (`deny` for read-only roles); read-only roles get no shell. UI/docs must not claim OS-level isolation.
- Tests use `node:test`; run with `node --test tests/`. Office status must come from real process events; show `testing` only when a command is classified as a test command.

## Review Focus

1. Agent name with spaces, unicode, `..`, or Windows reserved names (`CON`, `NUL`) → still yields a valid, unique slug/branch/dir (Task 3).
2. Path escape via `..`, symlink/junction, other drive letter, UNC, 8.3 short names, mixed slashes/case (Task 4).
3. Persona/prompt containing `" & % ^ | < >` and newlines survives the `cmd.exe` launch unchanged (Task 6).
4. Claude process dies mid-turn or never starts: status `error`, input re-enabled, agent resumable, no zombie process (Task 6, 12).
5. 9router returns malformed `tool_calls` JSON, an unknown tool, or loops forever: bounded iterations, denial returned as `role: tool` result, no crash (Task 11).

---

## File Structure

```
package.json
src/main/main.js            window + app lifecycle (close kills all agents)
src/main/ipc.js             registers the 7+ IPC handlers, validates input
src/main/store.js           AgentStore: records, status transitions, event fan-out
src/main/worktree.js        git/worktree ops
src/main/policy/paths.js    isInside, isCredentialPath
src/main/policy/shell.js    classifyShell
src/main/policy/decide.js   decide(role, action, ctx)
src/main/persistence.js     registry + chat history on disk (app userData)
src/main/secrets.js         safeStorage wrapper for router key
src/main/agents/claude-parse.js   pure stream-json line -> events
src/main/agents/claude-agent.js   process, queue, interrupt, approvals
src/main/agents/router-client.js  /models, streaming chat
src/main/agents/router-tools.js   read_file, list_dir, write_file, run_command
src/main/agents/router-agent.js   tool loop using decide()
src/preload/preload.js
src/renderer/index.html, styles.css, app.js, sidebar.js, chat.js, spawn-modal.js, stop-dialog.js
src/renderer/office/{iso.js,map.js,pathfinder.js,characters.js,office.js}
tests/*.test.js
```

---

### Task 1: Scaffold Electron app with three-column UI on mock data

**Files:** Create `package.json`, `src/main/main.js`, `src/preload/preload.js`, `src/renderer/{index.html,styles.css,app.js,sidebar.js,chat.js}`, `tests/security.test.js`.

**Interfaces:**
- Produces: `window.zonder` with the Global-Constraints API (stubs returning mock data for now); CSS tokens from the mockup palette (`--bg #0d0f14`, `--surface #151820`, `--border #252a3a`, `--accent #3b82f6`, status colors) in `styles.css`.

- [ ] **Step 1:** `git init` in the project folder (confirm with user it is acceptable; folder is empty and not a repo), add `.gitignore` (`node_modules`, `dist`).
- [ ] **Step 2:** Write `tests/security.test.js` asserting `createWindowOptions()` (exported from `main.js`) has `contextIsolation === true`, `nodeIntegration === false`, `sandbox === true`, and `frame !== false`. Run `node --test tests/security.test.js`; expect FAIL.
- [ ] **Step 3:** Implement `main.js` (export `createWindowOptions()`), `preload.js` (expose only the listed methods via `contextBridge`, no `ipcRenderer` leak), and the renderer: 220px sidebar (agent rows, Spawn button, router status), center `<canvas id="office">` placeholder, 340px chat panel (tabs, message list, model select, textarea), status bar. Mock 4 agents in `app.js` behind `?mock` / `ZONDER_MOCK=1`.
- [ ] **Step 4:** Run test (PASS), then `npm start` and confirm visually: three columns at 220px / flex / 340px, native titlebar, no console errors. Report actual result.
- [ ] **Step 5:** Commit `feat: scaffold electron shell with three-column ui`.

### Task 2: AgentStore, status machine, events

**Files:** Create `src/main/store.js`, `tests/store.test.js`. Modify `src/main/ipc.js` (create), `main.js`.

**Interfaces:**
- Produces:
  - Statuses: `starting|idle|thinking|working|testing|approval|done|error|stopped`.
  - `AgentRecord = {id, name, slug, role, systemPrompt, kind:'claude'|'router', model, workspace, worktreePath, branch, status, sessionId?, createdAt}`.
  - `AgentEvent = {agentId, ts, type:'message'|'tool_start'|'tool_end'|'approval_request'|'status'|'error'|'exit', ...payload}`.
  - `class AgentStore { add(rec); get(id); list(); setStatus(id, next); emit(evt); subscribe(cb) -> unsubscribe }`; `setStatus` throws `IllegalTransition` per a `TRANSITIONS` table exported from `store.js`.
- IPC: `subscribeAgentEvents(cb)` delivers every `AgentEvent` and `status` changes; `listAgents()` returns records.

- [ ] **Step 1:** Tests: `idle→working` ok; `stopped→working` throws; `approval→working` ok; `error→starting` ok (resume); every status has an entry in `TRANSITIONS`; `subscribe` receives a `status` event with `from`/`to`; unsubscribe stops delivery.
- [ ] **Step 2:** Run (FAIL), implement, run (PASS).
- [ ] **Step 3:** Wire `ipc.js`: validate every IPC arg (type/length) in main; replace Task 1 mocks with store-backed mock agents still behind `ZONDER_MOCK=1`. Sidebar/status bar render from store events.
- [ ] **Step 4:** Commit `feat: agent store and status machine`.

### Task 3: Worktree manager

**Files:** Create `src/main/worktree.js`, `tests/worktree.test.js` (temp repos via `git init` in `os.tmpdir()`).

**Interfaces:**
- Produces:
  - `isGitRepo(dir): Promise<boolean>`; `listBranches(repo): Promise<string[]>`
  - `makeSlug(name: string, taken: Set<string>): string` (ascii, lowercase, `[a-z0-9-]`, ≤32 chars, reserved Windows names prefixed, collision-free by suffix)
  - `createWorktree({repo, baseBranch, name, agentId, taken}): Promise<{path, branch, slug}>`
  - `removeWorktree({repo, path, branch, deleteBranch}): Promise<void>`
  - `isDirty(path): Promise<boolean>`

- [ ] **Step 1:** Tests: non-repo dir → `isGitRepo` false; `makeSlug('CON', …)`, `'  ../Évil Name!! '`, and an already-taken slug each give valid unique output matching `/^[a-z0-9-]{1,32}$/`; `createWorktree` creates `<parent>/.zonder-worktrees/<id>` on `zonder/<slug>-<shortid>` and the main checkout's HEAD/branch is unchanged; `removeWorktree` with `deleteBranch:false` keeps the branch, with `true` deletes it; removing a dirty worktree needs force and `isDirty` reports true.
- [ ] **Step 2:** Run (FAIL), implement with `child_process.execFile('git', args)` (argument arrays only, never a shell string), run (PASS).
- [ ] **Step 3:** Commit `feat: git worktree lifecycle`.

### Task 4: Permission policy (pure)

**Files:** Create `src/main/policy/{paths,shell,decide}.js`, `tests/{paths,shell,decide}.test.js`.

**Interfaces:**
- Produces:
  - `isInside(root, candidate): boolean` (resolves `..`, realpath on existing parents, case-insensitive on Windows, rejects other drives/UNC)
  - `isCredentialPath(p): boolean` (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.git-credentials`, `credentials*`, `.aws/`, `.ssh/`)
  - `classifyShell(cmd): {class:'safe-test'|'git-read'|'git-write'|'git-push'|'git-force'|'history-rewrite'|'install'|'delete'|'unknown', isTest:boolean}` (conservative: any chaining/redirect/subshell/`cd` token → `unknown`)
  - `Action = {kind:'read'|'write'|'delete'|'shell'|'other', tool:string, path?:string, command?:string}`; `Ctx = {worktree:string, mainRepo:string, sessionGrants:Set<string>}`
  - `decide(role, action, ctx): {verdict:'allow'|'deny'|'ask', reason:string, hard:boolean, grantKey?:string}`; `grantKey` = `tool + ':' + normalized path-or-command`. A matching grant in `ctx.sessionGrants` turns `ask` into `allow` unless the verdict is `hard` or the class is install/git-push/delete/secret.

- [ ] **Step 1:** `paths` tests: `isInside(wt, wt+'\\..\\x')` false; sibling dir sharing a prefix (`wt2`) false; `D:\` vs `C:\` false; `\\\\srv\\share` false; a junction inside the worktree pointing outside false; forward-slash and upper-case variants of an inside path true; `isCredentialPath('.env.local')` true.
- [ ] **Step 2:** `shell` tests: `npm test`, `node --test` → `safe-test`/`isTest`; `git push` → `git-push`; `git push --force`, `-f`, `--force-with-lease` → `git-force`; `git reset --hard origin/x`, `git rebase`, `git filter-branch` → `history-rewrite`; `npm i x` → `install`; `rm -rf x`, `del x` → `delete`; `cd .. && git push -f`, `echo a > b`, `node -e "..."`, `$(x)` → `unknown`.
- [ ] **Step 3:** `decide` table-driven test over all 5 roles × (read, write, shell safe-test, shell unknown, install, git push, delete, outside-worktree path, credential path, main-repo path) matching spec §5/§10 of the design doc: Reviewer/Researcher never get shell (`deny`) or writes; QA allows tests, denies source edits; Junior asks for write/shell; Senior allows worktree write + safe-test, asks for install/push/delete; unknown tool → `ask`; hard blocks `deny` with `hard:true` for every role, and a session grant never flips them.
- [ ] **Step 4:** Run (FAIL), implement all three modules, run (PASS).
- [ ] **Step 5:** Commit `feat: role-based permission policy`.

### Task 5: Persistence and secrets

**Files:** Create `src/main/persistence.js`, `src/main/secrets.js`, `tests/persistence.test.js`.

**Interfaces:**
- Produces: `class Persistence { constructor(dir); saveAgents(records); loadAgents(); appendEvent(agentId, evt); loadHistory(agentId): AgentEvent[] }` (JSONL per agent under `dir/history/<id>.jsonl`, registry in `dir/agents.json`, atomic write via temp+rename); `secrets.setRouterKey(key)`, `secrets.getRouterKey(): string|null`, `secrets.hasRouterKey(): boolean` (safeStorage-encrypted file; never returns the key to the renderer).

- [ ] **Step 1:** Tests (temp dir): round-trip records; appended events return in order; a truncated last JSONL line is skipped, not fatal; two quick `saveAgents` calls leave valid JSON.
- [ ] **Step 2:** Implement, run, commit `feat: persistence and secrets`.

### Task 6: Claude agent (real process)

**Files:** Create `src/main/agents/claude-parse.js`, `src/main/agents/claude-agent.js`, `tests/claude-parse.test.js`, `tests/claude-agent.int.test.js` (skipped unless `ZONDER_INT=1`).

**Interfaces:**
- Consumes: `AgentStore.emit/setStatus` (Task 2).
- Produces:
  - `parseLine(line: string): AgentEvent[] | {control: {requestId, tool, input}} | []` mapping `assistant` text→`message`, `thinking`→status `thinking`, `tool_use`→`tool_start` + status `working` (`testing` only if `classifyShell(cmd).isTest`), `tool_result`→`tool_end`, `result`→status `done`, `system/init`→capture `session_id`, unknown types ignored.
  - `class ClaudeAgent { constructor({record, store, persistence, onApproval}); start(): Promise<void>; send(text): void; interrupt(): void; respond(requestId, decision:'allow'|'deny', input?): void; stop(): Promise<void> }`. While a turn is running, `send` queues the text and flushes on `result`. `done` returns to `idle` 30 s later (author's call).

- [ ] **Step 1:** Save real stream samples from a haiku run as fixtures in `tests/fixtures/claude/*.jsonl` (init, text, tool_use Write, can_use_tool control_request, result). Parser tests assert event types/status for each fixture line, and that an unparseable line returns `[]` without throwing.
- [ ] **Step 2:** Run (FAIL), implement `claude-parse.js`, run (PASS).
- [ ] **Step 3:** Launch check: verify with `claude --help` that `--append-system-prompt` and `--strict-mcp-config` exist; test a persona containing `" & % ^ | < >` and a newline arrives intact (ask Claude to echo it). If `cmd.exe` mangles it, pass the persona via the supported file/stdin mechanism instead, or resolve the real `claude` JS/exe entry and spawn it without `cmd.exe`. Record the chosen mechanism in a comment.
- [ ] **Step 4:** Implement `ClaudeAgent`: newline-delimited stdin writes of `{"type":"user","message":{"role":"user","content":text}}`; buffer partial stdout lines; ignore known benign stderr (user hooks on `localhost`); on unexpected exit emit `exit`, set `error`, reject queued sends visibly; `stop()` kills the process tree (`taskkill /pid /T /F`). Interrupt uses the `control_request` `interrupt` subtype; confirm its exact shape by experiment before relying on it.
- [ ] **Step 5:** Integration test (`ZONDER_INT=1`, haiku, temp worktree): two turns keep memory; a Write request produces a `control` item and replying allow creates the file; replying **deny** results in no file and the agent reports it was denied (this closes the untested branch from the spike); `stop()` leaves no `claude`/`cmd` child behind. Run and report actual output.
- [ ] **Step 6:** Commit `feat: claude agent over stream-json`.

### Task 7: Approval flow wiring

**Files:** Create `src/main/approvals.js`, `tests/approvals.test.js`. Modify `claude-agent.js`, `ipc.js`.

**Interfaces:**
- Consumes: `decide` (Task 4), `ClaudeAgent.respond` (Task 6).
- Produces: `class Approvals { constructor({store, decideFn}); handle(agentId, action, ctx): Promise<{behavior:'allow'|'deny', message?}>; respond(requestId, decision:'once'|'session'|'deny'): void }`. `ask` verdict → emits `approval_request {requestId, agentId, tool, summary, path?}`, sets agent `approval`, resolves on `respond`; `session` adds `grantKey` to that agent's `sessionGrants` (only when not `hard`); `deny`/hard verdict resolves immediately with a message that states the reason (becomes the tool result). After resolution status returns to `working`. Pending requests resolve `deny` if the agent is stopped.

- [ ] **Step 1:** Tests with a fake `decideFn`: allow resolves immediately without an event; deny returns reason text; ask emits event, sets `approval`, `respond('once')` resolves allow and a second identical ask asks again; `respond('session')` makes the next identical ask auto-allow; stop while pending resolves deny.
- [ ] **Step 2:** Implement, run (PASS); map Claude `can_use_tool` (tool name + input → `Action`) into `Approvals.handle`.
- [ ] **Step 3:** Commit `feat: approval flow`.

### Task 8: Chat UI

**Files:** Modify `src/renderer/{chat.js,app.js,styles.css}`; create `src/renderer/render-message.js` + `tests/render-message.test.js`.

**Interfaces:**
- Consumes: `window.zonder.*` and `AgentEvent` (Task 2); `getHistory(agentId)` IPC added here (reads `Persistence.loadHistory`).
- Produces: `renderEvent(evt): HTMLElement|null` pure-DOM function (tests via `jsdom`-free string check: export `eventToViewModel(evt)` returning `{kind, text, ...}` and test that).

- [ ] **Step 1:** Test `eventToViewModel` for message (agent/user), tool_start/tool_end (one collapsed row `tool · summary`), approval_request (card with Allow once / Allow for this session / Deny), error.
- [ ] **Step 2:** Implement: tabs per agent with status dot, streaming bubbles (escape HTML; render fenced code blocks; no `innerHTML` with raw text), tool rows, approval card calling `respondApproval`, model select, queued-message indicator, Interrupt button visible while status is `thinking|working|testing`, input stays enabled during a turn. Load history on tab open.
- [ ] **Step 3:** Run `npm start` with a real Claude agent (via Task 9 wiring if done, else a temporary dev command) and confirm streaming, a tool row, and an approval card; report what was observed.
- [ ] **Step 4:** Commit `feat: chat panel`.

### Task 9: Spawn flow end to end

**Files:** Create `src/renderer/{spawn-modal.js,stop-dialog.js}`, `src/main/personas.js` (role → default prompt); modify `ipc.js`, `store.js` wiring, `app.js`.

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7.
- Produces: `PERSONAS: Record<Role, string>` (spec §9 old doc defaults); IPC `spawnAgent(cfg)` where `cfg = {name, role, systemPrompt, kind, model, workspace, baseBranch}` validated in main (name 1–40 chars, workspace is a git repo, branch exists, model non-empty); `stopAgent(id, cleanup:'keep'|'worktree'|'worktree+branch')`; `selectWorkspace()` opens a native folder dialog in main; `listBranches(repo)`.

- [ ] **Step 1:** Modal: name, role (preset fills editable prompt), kind+model, workspace picker (rejects non-repo with message), base branch select. Stop shows the three cleanup choices; dirty worktree warns.
- [ ] **Step 2:** Main: create worktree → record → start agent → persist. Spawn failure rolls back (remove worktree/branch it created) and returns an error shown in the modal.
- [ ] **Step 3:** Smoke (real): spawn a Claude agent in a scratch repo, send "list files", see streamed reply, stop with "worktree+branch", verify directory and branch are gone and the main repo is untouched. Report actual output.
- [ ] **Step 4:** Commit `feat: spawn and stop flow`.

### Task 10: Isometric office wired to real status

**Files:** Create `src/renderer/office/{iso.js,map.js,pathfinder.js,characters.js,office.js}`, `tests/iso.test.js`, `tests/office-map.test.js`. Source to adapt (MIT): `D:\pixel-agent-desk\src\office\{office-pathfinder,office-character,office-renderer}.js`.

**Interfaces:**
- Produces:
  - `iso.js`: `project(gx, gy, gz=0): {x, y}` and `unproject(x, y): {gx, gy}` (inverse, for click-picking); `depthKey(footY): number`.
  - `map.js`: `ZONES` with explicit seat IDs (`desk.A1…`, `whiteboard.1`, `meeting.1…`, `qa.1…`, `lounge.1…`, `coffee.1…`), `STATUS_TO_ZONE = {working:'desk', thinking:'whiteboard', approval:'meeting', testing:'qa', done:'lounge', idle:'coffee', error:'desk', starting:'coffee', stopped:null}`, `assignSeat(zone, takenSeatIds): seatId|null`, walkable grid `GRID`.
  - `office.js`: `startOffice(canvas, {getAgents, onSelect}): {stop()}`; reads statuses from store events only.

- [ ] **Step 1:** Tests: `unproject(project(x,y))` ≈ `(x,y)`; sprites with larger foot Y sort later; every `STATUS_TO_ZONE` value exists in `ZONES` and every seat ID is unique and walkable; `assignSeat` never double-books and returns `null` when full (fallback: stand in zone's overflow spot); `error` renders red state flag distinct from `working`.
- [ ] **Step 2:** Implement: logical grid + adapted pathfinder separated from projection; flat-colour furniture drawn from geometry; avatars as simple shapes with name tag and status colour; walking between seats; click → `onSelect(agentId)` focusing chat; `imageSmoothingEnabled=false`, RAF loop, pause when the window is hidden. No sprite sheet unless it demonstrably fits; if reused, copy the asset with its licence note.
- [ ] **Step 3:** Run with two real agents in different states; confirm avatars sit in the mapped zones, move on status change, and `approval` uses the meeting pod. Report what was seen (screenshot via the browser pane tooling if available).
- [ ] **Step 4:** Commit `feat: isometric office`.

### Task 11: 9router agent

**Files:** Create `src/main/agents/{router-client,router-tools,router-agent}.js`, `tests/router-*.test.js`. Modify `ipc.js` (`setRouterKey`, `listModels`), sidebar/status bar router state, spawn modal model list.

**Interfaces:**
- Consumes: `decide`, `Approvals`, `secrets`, `isInside`.
- Produces:
  - `listModels({baseUrl, key}): Promise<string[]>` (`GET /models`), `streamChat({baseUrl, key, model, messages, tools, signal}): AsyncIterable<{delta?:string, toolCalls?:ToolCall[], done?:true}>` (SSE; handles split chunks and `[DONE]`).
  - `TOOLS` (OpenAI function schemas) and `execTool(name, args, ctx): Promise<string>` for `read_file`, `list_dir`, `write_file`, `run_command`; all paths pass `isInside(worktree)`; `run_command` uses `execFile`/`cmd /c` only after `decide` allowed it, `cwd` = worktree, timeout 60 s, output capped at 20 KB.
  - `class RouterAgent` implementing the same methods as `ClaudeAgent` (`start/send/interrupt/respond/stop`) with a loop capped at 25 tool iterations per turn.

- [ ] **Step 1:** Tests with a fake `fetch`/server: SSE split mid-JSON still parses; malformed `tool_calls` arguments → tool result "invalid arguments" and loop continues; unknown tool → denial result; 26th iteration stops with an error event; denied/hard action returns the reason as `role:'tool'`; Reviewer asking `run_command` is denied without prompting; `write_file` to `..\x` is denied.
- [ ] **Step 2:** Implement; unreachable router → agent status `error` and bubble "Router offline"; status bar shows connected/disconnected + latency from the last `/models` call (RTK %: show "—").
- [ ] **Step 3:** Real check with the user's key (entered through the UI, stored via `safeStorage`): list models, spawn a router agent, ask it to read a file in its worktree and to write one (approval card for Junior). Report the actual output. Never log or echo the key.
- [ ] **Step 4:** Commit `feat: 9router agents`.

### Task 12: Quit, relaunch, resume

**Files:** Modify `main.js`, `ipc.js`, `store.js`, `claude-agent.js`, `router-agent.js`; create `tests/lifecycle.test.js`.

**Interfaces:** `resumeAgent(agentId)` IPC; `AgentStore.markAllStopped()`.

- [ ] **Step 1:** Tests: on quit every agent's `stop()` is called and records persist as `stopped`; on load, records come back `stopped` with history intact; worktrees listed in the registry but whose agent record is gone are reported by `findOrphans()`.
- [ ] **Step 2:** Implement: `before-quit` stops all child processes (verify no `claude` left); Claude resume via `--resume <sessionId>`; router resume replays stored history; orphan worktrees offered the same three cleanup choices.
- [ ] **Step 3:** Manual: spawn, chat, quit, relaunch, resume, confirm memory continues and history shows. Report.
- [ ] **Step 4:** Commit `feat: persistence across restarts`.

### Task 13: Packaging (only after Tasks 1–12 verified on this machine)

**Files:** Modify `package.json` (`build` config), create `build/` icon.

- [ ] **Step 1:** Add `electron-builder`, NSIS x64 target only; `npm run dist`; install the result on this machine and repeat the Task 9 smoke from the installed app. Report actual results and size.
- [ ] **Step 2:** Commit `chore: windows installer`.
