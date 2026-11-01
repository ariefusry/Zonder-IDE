# Zonder Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents grouped per repo with model logos (the 9router logo follows the model that last answered), resizable columns, a hideable office, and a read-only "Perubahan" panel showing what each agent changed.

**Architecture:** Pure helpers (`modelFamily`, `groupAgents`, `clampWidths`, `parseNameStatus`) live in small renderer/main modules with the same IIFE + `module.exports` guard as `office/map.js`, so `node:test` covers them. Git for the changes panel runs in main (`worktree.js`), behind three narrow IPC channels. Layout preferences live in renderer `localStorage`.

**Tech Stack:** Electron 45 (CommonJS), vanilla JS renderer, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-zonder-layout-design.md` (§ numbers below refer to it). Mockup: `.superpowers/brainstorm/1282-1793547312/content/layout-v2.html`, card "Bawaan: kantor tampil".

**Order:** Runs before Tasks 18–20 of `docs/superpowers/plans/2026-11-01-zonder-settings.md`. Numbering starts at 21 so "Lanjut Tugas N" stays unambiguous across both plans.

## Global Constraints

- Test-first, one commit per task, stop after each task for the owner's "Lanjut Tugas N". Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new dependencies. No PTY, node-pty, xterm. Dark theme only; antislop rules apply. UI copy in Indonesian.
- Renderer never touches the filesystem or child processes; every new IPC channel is listed in `CHANNELS` (`src/main/ipc.js`), repeated in `src/preload/preload.js`, validated with `expectArgs` and `ownAgent` in main.
- All git runs in main through `worktree.js`'s `git(cwd, args)` (execFile, no shell), with `cwd = record.worktreePath`.
- The 9router key never reaches the renderer, a file, or a log. CDP scripts never read `#rkKey`.
- Status is never shown by colour or logo alone: every status keeps its dot plus text; change letters (M/A/D/R) and diff `+`/`-` are always printed.
- Logos are local files under `src/renderer/assets/models/`; nothing is fetched at runtime (CSP stays `img-src 'self' data:`).
- Layout key: `localStorage['zonder.layout']` = `{ left: number, right: number, officeHidden: boolean }`; every read and write wrapped in try/catch, defaults on any failure.
- Column widths (§4.1): left default 240 / min 180; office min 360; right default 380 / min 300.

## Review Focus

1. `zonder.layout` missing, not JSON, wrong types, or widths that no longer fit the window → defaults or clamped widths, no thrown error, office never under 360px while shown (Task 23).
2. Worktree deleted, base branch deleted or renamed, or the agent never committed → Perubahan shows the right state ("Worktree agent ini sudah tidak ada.", git error + "Coba lagi", or "Belum ada perubahan dari agent ini.") instead of a stack trace (Task 24, 25).
3. `fileDiff` with a path not in the agent's last `listChanges` (e.g. `../secret`, `C:\x`, another agent's file) → refused in main (Task 24).
4. File names with spaces, non-ASCII, renames, deleted files, binary files, and diffs over 200 KB → listed and shown correctly (Task 24).
5. 9router stream with no `model` field, an empty one, or one that only repeats the combo name → combo icon, never a wrong logo (Task 21).

---

## File Structure

```
src/renderer/models.js         NEW  modelFamily(id), logoFor(agent) (pure, IIFE + module.exports)
src/renderer/assets/models/    NEW  claude.svg, openai.svg, gemini.svg, deepseek.svg, LICENSE.md
src/renderer/layout.js         NEW  clampWidths, readLayout/writeLayout, separators, office toggle
src/renderer/changes.js        NEW  Perubahan panel (renderer)
src/renderer/sidebar.js        MOD  groupAgents (pure, exported), grouped render, logos
src/renderer/chat.js           MOD  logos in agent tabs, Chat/Perubahan view tabs
src/renderer/office/office.js  MOD  setHidden(bool) on the returned handle
src/renderer/app.js, index.html, styles.css   MOD
src/main/agents/router-client.js  MOD  yields {servedModel}
src/main/agents/router-agent.js   MOD  record.servedModel + 'servedModel' event
src/main/worktree.js           MOD  parseNameStatus, listChanges, fileDiff
src/main/ipc.js, src/preload/preload.js   MOD  listChanges, fileDiff, openWorktree
tests/models.test.js, tests/layout.test.js, tests/sidebar.test.js   NEW
tests/router-client.test.js, router-agent.test.js, worktree.test.js, ipc.test.js   MOD
```

---

### Task 21: Model logos and the model that answered

**Files:**
- Create: `src/renderer/models.js`, `src/renderer/assets/models/{claude,openai,gemini,deepseek}.svg`, `src/renderer/assets/models/LICENSE.md`, `tests/models.test.js`
- Modify: `src/main/agents/router-client.js`, `src/main/agents/router-agent.js`, `src/renderer/sidebar.js`, `src/renderer/chat.js`, `src/renderer/app.js`, `src/renderer/index.html`, `src/renderer/styles.css`
- Test: `tests/router-client.test.js`, `tests/router-agent.test.js`

**Interfaces:**
- Produces:
  - `modelFamily(id: string | null) -> 'claude' | 'openai' | 'gemini' | 'deepseek' | null` (§4.3 rules: strip up to the last `/`, case-insensitive prefix match).
  - `logoFor(agent) -> { kind: 'logo', family, label } | { kind: 'combo', label } | { kind: 'initial', letter, label }`. `agent` is the public record (`kind`, `model`, `servedModel?`). `label` is the accessible name ("Claude", "OpenAI", "Gemini", "DeepSeek", "Combo", or the model name).
  - `modelLine(agent) -> string`: `"daily-coding · claude-sonnet-4.5"` when `servedModel` is set and differs from `model`; else `model`.
  - `logoNode(agent) -> HTMLElement` (renderer only): `<img src="assets/models/<family>.svg" alt=label>` 16px, or a 1px-line combo glyph / initial circle with `role="img"` and `aria-label`.
  - `streamChat` yields `{ servedModel: string }` once, from the first SSE chunk whose `model` is a non-empty string.
  - `record.servedModel: string | null`; agent event `{ type: 'servedModel', agentId, model }` emitted when it changes.

- [ ] **Step 1: Write failing tests.**
  - `tests/models.test.js`:
    - `modelFamily maps kr/claude-sonnet-4.5, ag/claude-opus-4-6-thinking, sonnet -> claude; cx/gpt-6-luna, o3-mini -> openai; ag/gemini-3.8-flash, gemini/gemini-3.6-flash -> gemini; oc/deepseek-v4.1-flash-free -> deepseek; daily-coding, '', null -> null`.
    - `logoFor({kind:'claude', model:'sonnet'}) -> logo claude`.
    - `logoFor({kind:'router', model:'daily-coding'}) -> combo; with servedModel 'kr/claude-sonnet-4.5' -> logo claude` (Review Focus 5).
    - `logoFor router with servedModel equal to model -> combo; servedModel 'xx/mystery-1' -> initial 'M'; model 'xx/mystery-1' and no servedModel -> initial 'M'`.
    - `modelLine shows "daily-coding · claude-sonnet-4.5"; no servedModel -> "daily-coding"`.
  - `tests/router-client.test.js`: `stream with model "kr/claude-sonnet-4.5" in chunks yields one {servedModel}; chunks without model or with "" yield none`.
  - `tests/router-agent.test.js`: `after a turn whose stream reports servedModel, record.servedModel is set and one servedModel event is emitted; same value next turn -> no new event`.
- [ ] **Step 2: Run `npm test`.** Expected: the new tests fail.
- [ ] **Step 3: Get the logos.** Stop and ask the owner before downloading: name each file, the source URL (LobeHub Icons static SVG first, Simple Icons as fallback), and its size. On a yes, save the four files, strip any script or external reference, set `fill="currentColor"`, and write `LICENSE.md` with source and licence per file.
- [ ] **Step 4: Implement** `models.js`, the `servedModel` yield in `streamChat`, and in `router-agent.js` store it on the record and emit the event. In `app.js` `onAgentEvent`: `servedModel` updates `a.servedModel` and re-renders chrome, like `model`. Use `logoNode` and `modelLine` in sidebar cards and agent tabs; logos drawn in `--muted` (§6).
- [ ] **Step 5: Run `npm test`.** Expected: all pass.
- [ ] **Step 6: CDP check** with the fake router: spawn a router agent on combo `daily-coding` with the fake router's chunks carrying `model: "kr/claude-sonnet-4.5"` → combo icon before the reply, Claude logo and "daily-coding · claude-sonnet-4.5" after it. A Claude haiku agent shows the Claude logo. 0 console errors.
- [ ] **Step 7: Real 9router check (owner).** Stop and ask the owner to run Zonder with their key and send one message to a combo agent. Read only `servedModel` from `agents.json` in the data dir. Log the result as a `Task 21: Ruling` (does 9router report the real model?).
- [ ] **Step 8: Commit** `feat: model logos`.

### Task 22: Sidebar grouped per repo

**Files:**
- Modify: `src/renderer/sidebar.js`, `src/renderer/styles.css`
- Create: `tests/sidebar.test.js`

**Interfaces:**
- Consumes: public record fields `workspace`, `createdAt`, `sample`, `status`.
- Produces: `groupAgents(agents) -> [{ key: string, name: string, path: string | null, agents: Agent[], approvals: number }]` (exported via the `module.exports` guard). `key` = workspace path lower-cased; samples go to one group `{ key: 'sample', name: 'Contoh', path: null }`. Groups sorted by the newest `createdAt` inside, newest first; agents keep their incoming order. `name` = last folder of `path`.

- [ ] **Step 1: Write failing tests** in `tests/sidebar.test.js`:
  - `two agents in D:\\a\\Repo and one in D:\\b\\Other -> two groups named Repo and Other; group with the newest createdAt first`.
  - `D:\\a\\Repo and d:\\A\\repo are one group`.
  - `sample agents -> group "Contoh"`.
  - `approvals counts agents with status approval`.
- [ ] **Step 2: Run `npm test`.** Expected: fail (`groupAgents` not exported).
- [ ] **Step 3: Implement** `groupAgents` and render: one `<section>` per group with a header button (`aria-expanded`, `title` = full path) that collapses the group; collapsed header shows `"<n> agent"` plus `", <k> butuh izin"` when k > 0. Collapsed set kept in memory for the session. Cards inside are unchanged (logo from Task 21). Keyboard: header toggles with Enter/Space; card tab order unchanged.
- [ ] **Step 4: Run `npm test`.** Expected: all pass.
- [ ] **Step 5: CDP check** with two scratch repos and three agents: groups and names correct, collapse/expand by click and keyboard, approval count text appears when one agent asks. No overflow at the 1100px window minimum. 0 console errors.
- [ ] **Step 6: Commit** `feat: agents grouped per repo`.

### Task 23: Resizable columns and hideable office

**Files:**
- Create: `src/renderer/layout.js`, `tests/layout.test.js`
- Modify: `src/renderer/office/office.js`, `src/renderer/app.js`, `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/sidebar.js` (legend placement)

**Interfaces:**
- Produces:
  - `LAYOUT = { left: { def: 240, min: 180 }, right: { def: 380, min: 300 }, officeMin: 360 }`.
  - `clampWidths({ left, right, officeHidden }, total: number) -> { left, right }`: each at least its min; when shown, `left + right <= total - 360`, shrinking right then left toward their mins; non-numbers fall back to defaults.
  - `parseLayout(text: string | null) -> { left, right, officeHidden }`: defaults on null, bad JSON, or wrong types.
  - `initLayout({ office })`: reads/writes `localStorage['zonder.layout']` (try/catch), wires the two separators and the header toggle, observes window size.
  - `startOffice(...)` handle gains `setHidden(hidden: boolean)`: pauses the loop and ignores `visibilitychange` while hidden; resumes when shown.

- [ ] **Step 1: Write failing tests** in `tests/layout.test.js`:
  - `parseLayout(null), parseLayout('{'), parseLayout('{"left":"x"}') -> defaults 240/380/false` (Review Focus 1).
  - `clampWidths({left:100,right:200}, 1400) -> {left:180,right:300}`.
  - `clampWidths({left:400,right:700}, 1100) keeps office >= 360: left + right <= 740, right shrinks first`.
  - `clampWidths with officeHidden true allows left + right up to total`.
- [ ] **Step 2: Run `npm test`.** Expected: fail.
- [ ] **Step 3: Implement** `layout.js`.
  - `.main` grid columns come from CSS variables `--col-left` / `--col-right` set by `initLayout`.
  - Two separators: `role="separator"`, `aria-orientation="vertical"`, `aria-valuemin/max/now`, `tabindex="0"`, visible `:focus-visible` ring. Pointer drag with pointer capture; double-click resets. Keys: ←/→ 16px, Shift 64px, Home/End to min/max, Enter resets (§4.5).
  - Header button before Settings, `aria-pressed`, label "Sembunyikan kantor" / "Tampilkan kantor". When hidden: office column and its separator get `hidden`, the right column takes the rest, `office.setHidden(true)`, and the status legend moves into the right column head.
  - Below 840px total, hide the office for the session only (stored value untouched) and show the note "Kantor disembunyikan: jendela terlalu sempit." in the header.
  - Save on drag end, key change, and toggle.
- [ ] **Step 4: Run `npm test`.** Expected: all pass.
- [ ] **Step 5: CDP check.**
  - Drag both separators and use the keyboard on each; widths change and clamp; reload keeps them.
  - Set `localStorage['zonder.layout'] = '{'` and reload → defaults, no console error.
  - Hide the office → no `requestAnimationFrame` frames while hidden (count via an instrumented check), legend visible in the right column; show → office redraws at the new width.
  - Screenshot at 1100px and 1600px. 0 console errors.
- [ ] **Step 6: Commit** `feat: resizable columns and office toggle`.

### Task 24: Changes in main (git + IPC)

**Files:**
- Modify: `src/main/worktree.js`, `src/main/ipc.js`, `src/preload/preload.js`
- Test: `tests/worktree.test.js`, `tests/ipc.test.js`

**Interfaces:**
- Consumes: `record.worktreePath`, `record.baseBranch`, `worktree.exists`.
- Produces:
  - `parseNameStatus(text: string) -> [{ path, status: 'M' | 'A' | 'D' | 'R', oldPath? }]` from `git diff --name-status -z -M` output (NUL-separated, so spaces and non-ASCII survive). `T`/`C` map to `M`/`A`.
  - `listChanges(wtPath, baseBranch) -> { base: string, files }`: `base = git merge-base <baseBranch> HEAD`; files = `diff --name-status -z -M <base>` plus `ls-files --others --exclude-standard -z` as `A`; sorted by path.
  - `fileDiff(wtPath, base, file) -> { path, text, truncated, binary }`: tracked file `git diff <base> -- <path>`; untracked `git diff --no-index -- NUL <path>` (exit code 1 is success). Binary when git prints "Binary files"; text cut at `MAX_DIFF = 200 * 1024` bytes.
  - IPC `listChanges(agentId)`, `fileDiff(agentId, path)`, `openWorktree(agentId)`. Main keeps the last `listChanges` result per agent; `fileDiff` throws "File ini tidak ada di daftar perubahan." for any other path. Missing worktree → throws "Worktree agent ini sudah tidak ada." `openWorktree` calls `shell.openPath(record.worktreePath)` and throws its error string if non-empty.

- [ ] **Step 1: Write failing tests** (temp git repo, base `main`, worktree on a branch):
  - `parseNameStatus handles M, A, D, R100 with oldPath, a path with spaces, and a non-ASCII name`.
  - `listChanges counts a committed edit, an uncommitted edit, a deleted file, a rename, and an untracked file; ignored files and unchanged files are absent` (Review Focus 4).
  - `listChanges with no changes -> files []`.
  - `listChanges after the base branch is deleted -> throws with git's message` (Review Focus 2).
  - `fileDiff of an untracked file shows every line with +; of a binary -> binary true, text ''; of a 300 KB change -> truncated true, text <= 200 KB`.
  - `tests/ipc.test.js`: `fileDiff for a path not in the last listChanges ('../x', 'C:\\x', a real file the agent did not change) -> rejects with "File ini tidak ada di daftar perubahan."` (Review Focus 3); `listChanges on a removed worktree -> "Worktree agent ini sudah tidak ada."`; `preload exposes listChanges, fileDiff, openWorktree`.
- [ ] **Step 2: Run `npm test`.** Expected: fail.
- [ ] **Step 3: Implement** the three functions in `worktree.js` and the three channels. `fileDiff`'s untracked case needs a `git` variant that accepts exit code 1; add an option to the existing helper rather than a second one.
- [ ] **Step 4: Run `npm test`.** Expected: all pass.
- [ ] **Step 5: Commit** `feat: agent changes in main`.

### Task 25: Perubahan panel

**Files:**
- Create: `src/renderer/changes.js`
- Modify: `src/renderer/chat.js`, `src/renderer/app.js`, `src/renderer/index.html`, `src/renderer/styles.css`

**Interfaces:**
- Consumes: Task 24 IPC; agent `status` events.
- Produces: `renderChanges(state, agentId)`; `state.view: Map<agentId, 'chat' | 'changes'>` (default `'chat'`); `state.changes: Map<agentId, { loading, error, files, base, open: string | null, diff }>`.

- [ ] **Step 1: Implement** (renderer only; logic it depends on is tested in Task 24).
  - View tabs under the chat head: `role="tablist"`, "Chat" and "Perubahan (n)" (`n` hidden until first count), arrow keys move between them. Composer only on Chat.
  - Load on opening the tab, on the agent's status turning idle/done/error while the tab is open, and on "Muat ulang". Ignore a result that arrives after the selected agent changed.
  - Toolbar: "Muat ulang", "Buka folder".
  - List rows are buttons: status letter (`title` "Diubah"/"Baru"/"Dihapus"/"Dipindah dari <oldPath>") + path. Clicking shows the diff below in `--mono`, lines coloured and prefixed `+`/`-`.
  - States (§4.8): "Membaca perubahan...", "Belum ada perubahan dari agent ini.", error text + "Coba lagi", "Worktree agent ini sudah tidak ada.", "Diff dipotong di 200 KB.", "File biner, isinya tidak ditampilkan."
- [ ] **Step 2: Run `npm test`.** Expected: all pass (no regressions).
- [ ] **Step 3: CDP check** with a scratch repo and a fake-router agent that writes two files and edits one:
  - Perubahan shows 3 rows with the right letters; diff of each; untracked file shown as all `+`.
  - Agent writes another file → count updates after its turn ends.
  - "Buka folder" resolves without error (do not assert Explorer opened).
  - Delete the worktree from outside → "Worktree agent ini sudah tidak ada."
  - Keyboard only: reach the view tabs, a file row, and both buttons; focus visible.
  - 0 console errors, stop with cleanup, 0 leftover processes.
- [ ] **Step 4: Commit** `feat: changes panel`.
