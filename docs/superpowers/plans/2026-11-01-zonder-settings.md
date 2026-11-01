# Zonder Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A header with a Settings icon that opens a full Settings page (Providers, Roles, Skills, Workspace, Agent, Notifikasi), with editable and addable roles, per-role skills (usable by 9router agents through `load_skill`), every Claude model version, and effort for Claude and 9router.

**Architecture:** Roles become data (`roles.json`) instead of a fixed list; a role's permissions are two enums that `decide()` reads from a snapshot stored on the agent record. Skills are read in the main process only. App settings live in `settings.json`. The renderer gets a Settings page in the same window, swapping out the three columns; all new IPC is narrow and validated in main.

**Tech Stack:** Electron 45 (CommonJS), vanilla JS renderer, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-zonder-settings-design.md` (read it and `docs/superpowers/specs/2026-11-01-zonder-design.md` first; § numbers below refer to the settings spec).

**Order:** Tasks 14–19 run after Task 12 (quit, relaunch, resume) of `docs/superpowers/plans/2026-11-01-zonder-implementation.md`. Task 13 (installer) stays out of scope. Numbering continues that plan so "Lanjut Tugas N" stays unambiguous.

## Global Constraints

- Test-first, one commit per task, stop after each task for the owner's "Lanjut Tugas N". Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new dependencies or abstractions beyond what a task names. No PTY, node-pty, xterm. Dark theme only; antislop rules apply. UI copy in Indonesian.
- Keep the native Windows titlebar; the header is a row inside the window.
- Renderer never touches the filesystem or child processes; every new IPC channel is listed in `CHANNELS` (`src/main/ipc.js`) and repeated in `src/preload/preload.js`, and validates its arguments in main.
- Hard blocks never become options: credential files, main checkout, paths outside the worktree, force push, history rewrite. Install, git push, and delete always ask.
- The 9router key never reaches the renderer, a plain-text file, or a log. CDP check scripts never read `#rkKey`.
- Built-in roles that the owner has not edited must decide exactly as today: every existing row in `tests/decide.test.js` keeps passing unchanged.
- Data files live in the Zonder data dir (`ZONDER_DATA_DIR` or `app.getPath('userData')`): `roles.json`, `settings.json`, next to `router.json` and `router-key.bin`.

## Review Focus

1. `roles.json` or `settings.json` missing, empty, or corrupt JSON → app starts with built-in roles and default settings, and the next save rewrites the file (Tasks 14, 18).
2. A custom role named like a built-in (any case), blank, over 40 characters, or duplicating another custom role → rejected with an Indonesian message, nothing written (Task 14).
3. A custom role deleted while an agent spawned from it is running or stopped → that agent keeps its snapshot and shows "peran dihapus"; resume does not crash (Task 14).
4. `load_skill` with `../`, an absolute path, a UNC path, another drive, a symlink or junction leaving the skill folder, a credential file inside it, or a skill not selected for the role → refused with a reason returned as the tool result (Task 17).
5. A skill folder without `SKILL.md`, with no frontmatter, or with unreadable files → skipped; the rest of the list still renders (Task 17).

---

## File Structure

```
src/main/roles.js            NEW  built-in role table, roles.json store, snapshot + resume policy
src/main/policy/decide.js    MOD  decide(role | policy, action, ctx)
src/main/approvals.js        MOD  passes record.rolePolicy to decide
src/main/claude-status.js    NEW  claude --version / login check
src/main/skills.js           NEW  list skills, readSkillFile with path checks
src/main/settings.js         NEW  settings.json store with defaults + validation
src/main/notify.js           NEW  desktop alerts from store events
src/main/ipc.js              MOD  new channels, spawn uses roles/settings
src/main/main.js             MOD  wiring
src/main/agents/claude-agent.js   MOD  model list, --effort, skill flags, setEffort
src/main/agents/router-agent.js   MOD  skill list in prompt, load_skill, effort, settings caps
src/main/agents/router-tools.js   MOD  load_skill tool, timeout from settings
src/main/agents/router-client.js  MOD  reasoning_effort
src/preload/preload.js       MOD
src/renderer/index.html, styles.css, app.js, spawn-modal.js, chat.js, sidebar.js  MOD
src/renderer/settings.js     NEW  Settings page: nav + panes
tests/roles.test.js, claude-status.test.js, skills.test.js, settings.test.js, notify.test.js  NEW
```

---

### Task 14: Roles as data

**Files:**
- Create: `src/main/roles.js`, `tests/roles.test.js`
- Modify: `src/main/policy/decide.js`, `src/main/approvals.js`, `src/main/ipc.js`, `src/main/main.js`, `src/main/personas.js`, `src/preload/preload.js`
- Test: `tests/decide.test.js`, `tests/spawn.test.js`, `tests/approvals.test.js`

**Interfaces:**
- Consumes: Task 12's resume path in `ipc.js` (`resumeAgent(agentId)`), `PERSONAS` from `personas.js`.
- Produces:
  - `WRITE = ['deny', 'tests', 'ask', 'allow']`, `SHELL = ['deny', 'ask', 'auto']` (exported from `roles.js`).
  - `Role = { name: string, builtin: boolean, persona: string, write: WRITE[n], shell: SHELL[n], skills: string[], disableSkills: boolean }`.
  - `RolePolicy = { name: string, write, shell, skills: string[], disableSkills: boolean }` (what goes on the record as `record.rolePolicy`).
  - `createRoles({ dir }) -> { list(): Role[], get(name): Role | null, save(role): Role, remove(name): void, reset(name): Role }`.
  - `snapshot(role): RolePolicy`; `policyForResume(record, roles): { rolePolicy: RolePolicy, roleDeleted: boolean }`.
  - `decide(roleOrPolicy, action, ctx)`: a string is looked up in the built-in table (old callers and tests keep working); an object is used as `RolePolicy`.
  - IPC: `listRoles() -> Role[]`, `saveRole(role) -> Role`, `deleteRole(name) -> void`, `resetRole(name) -> Role`. `spawnOptions().roles` now comes from `roles.list()`.

Built-in table (§5, must match today's behaviour):

| name | write | shell |
|---|---|---|
| Senior Developer | allow | auto |
| Junior Developer | ask | ask |
| Reviewer | deny | deny |
| QA Engineer | tests | auto |
| Researcher | deny | deny |
| Custom | ask | ask |

Mapping inside `decide`: `write: 'deny'` = today's READ_ONLY file branch; `'tests'` = today's QA test-file rule then ask; `'ask'` = ask with grant key; `'allow'` = allow. `shell: 'deny'` = no shell; `'auto'` = today's `trusted` (safe-test and git-read allowed); `'ask'` = ask. Delete, install, git push stay ask without a grant key for every policy.

- [ ] **Step 1: Write failing tests**

`tests/roles.test.js`:
- `list() on an empty dir returns the six built-ins in table order with the PERSONAS text`
- `save() adds a custom role "Designer" {write:'ask', shell:'ask'} and a new createRoles on the same dir returns it`
- `save() edits a built-in's persona; reset() restores PERSONAS text and table permissions`
- `remove("Reviewer") throws "Peran bawaan tidak bisa dihapus."`
- `save() rejects names "", "reviewer", "x".repeat(41), and a second "Designer"` (Review Focus 2) — each throws, file unchanged
- `save() rejects write:'everything' and shell:'yes'`
- `corrupt roles.json ("{not json") -> list() returns built-ins; next save() writes valid JSON` (Review Focus 1)
- `policyForResume: role exists -> current permissions, roleDeleted false; custom role removed -> record.rolePolicy kept, roleDeleted true; record without rolePolicy and role "Junior Developer" -> built-in snapshot` (Review Focus 3)

`tests/decide.test.js` (append):
- `every built-in name and its snapshot() object give the same verdict for each existing action row`
- `policy {name:'Designer', write:'ask', shell:'ask'}: write src/a.css -> ask with grantKey; npm test -> ask; credential path -> hard deny; git push --force -> hard deny`
- `policy {write:'allow', shell:'auto'}: rm -rf x -> ask without grantKey`

`tests/spawn.test.js` (append):
- `spawn with role "Designer" stores record.rolePolicy = snapshot(Designer) and persona from cfg`
- `editing Designer after spawn leaves the running record's rolePolicy unchanged`
- `spawn with an unknown role -> "Peran tidak dikenal."`

`tests/approvals.test.js` (append): `decideFn receives record.rolePolicy when present, else record.role`.

- [ ] **Step 2: Run `npm test`.** Expected: the new tests fail (module `roles.js` missing / assertions), every old test still passes.
- [ ] **Step 3: Implement `src/main/roles.js`** with the interfaces above. `roles.json` stores only edits to built-ins and custom roles; write via tmp file + rename like `secrets.js`. Names trimmed; built-in names compared case-insensitively.
- [ ] **Step 4: Change `decide.js`** to accept a string or `RolePolicy` and branch on `write`/`shell` per the mapping; keep `ROLES` exported (built-in names) for old callers. Reasons stay Indonesian and name the role (`${policy.name} butuh persetujuan untuk menulis.`).
- [ ] **Step 5: Wire it.** `approvals.js` passes `rec.rolePolicy ?? rec.role`. `ipc.js`: `registerIpc({ ..., roles })`, spawn validates with `roles.get(cfg.role)` and stores `rolePolicy: snapshot(role)`; Task 12's resume applies `policyForResume` and saves the record; the four role channels. `main.js` creates `createRoles({ dir: dataDir })`. Preload gets the four methods.
- [ ] **Step 6: Run `npm test`.** Expected: all pass (old count + new), 0 fail.
- [ ] **Step 7: Commit** `feat: roles as data`.

### Task 15: Header, Settings page, Providers

**Files:**
- Create: `src/main/claude-status.js`, `src/renderer/settings.js`, `tests/claude-status.test.js`
- Modify: `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/app.js`, `src/renderer/sidebar.js`, `src/main/ipc.js`, `src/main/main.js`, `src/preload/preload.js`
- Test: `tests/router-ipc.test.js`, `tests/security.test.js`

**Interfaces:**
- Consumes: `setRouterKey`, `listModels` (Task 11), `refreshRouter()` in `app.js`.
- Produces:
  - `checkClaude({ execFile }) -> Promise<{ installed: boolean, version: string | null, loggedIn: boolean | null, error: string | null }>` in `claude-status.js`. `loggedIn: null` means "tidak diketahui".
  - IPC `claudeStatus()` → that object.
  - Renderer globals in `settings.js`: `openSettings(section = 'providers')`, `closeSettings()`, `SETTINGS_SECTIONS = ['providers', 'roles', 'skills', 'workspace', 'agent', 'notify']`. Later tasks fill panes `#set-<section>`.

- [ ] **Step 1: Write failing tests** in `tests/claude-status.test.js` with a fake `execFile`:
  - `"2.1.316 (Claude Code)" on stdout -> installed true, version "2.1.316"`
  - `ENOENT -> installed false, version null, error "Claude Code CLI tidak ditemukan."`
  - `the login check never runs a command that starts an interactive login` (assert the argv the fake received)
  - `a 10 s timeout -> installed true or false per --version, loggedIn null`
  
  In `tests/security.test.js`: `preload exposes claudeStatus and no raw ipcRenderer`.
- [ ] **Step 2: Run `npm test`.** Expected: new tests fail.
- [ ] **Step 3: Implement `checkClaude`** via `cmd.exe /d /s /c claude --version` (same launch style as `claude-agent.js`). The login check is the builder's call (§6) under the test above; if no non-interactive way exists, return `loggedIn: null`.
- [ ] **Step 4: Renderer.**
  - `index.html`: `<header class="app-head">` above `.main`, with a right-aligned rounded group holding `#settingsBtn` (gear, `aria-label="Settings"`).
  - `<section class="settings" id="settings" hidden>` with a back button ("← Settings"), a left nav for the six sections, and one pane per section (empty panes say "Diisi di tugas berikutnya." until their task).
  - Providers pane:
    - 9router card: the fields of the old key dialog, same ids `rkUrl`, `rkKey`, same submit behaviour, plus status, latency, and model count.
    - Claude Code CLI card: status, version, login, and "Periksa ulang".
  - Delete the old key dialog. `#routerBtn` calls `openSettings('providers')`. Opening Settings hides `.main`; agents keep running.
- [ ] **Step 5: Run `npm test`.** Expected: all pass.
- [ ] **Step 6: CDP check** (scratch data dir, fake router as in Task 11):
  - Header gear opens Settings, and Back returns to the office.
  - The 9router card saves URL and key: status "terhubung", and `router.json` is written.
  - The key is not in renderer state or any plain file.
  - The Claude card shows version 2.1.316.
  - 0 console errors.
  - Save screenshots of the header and Providers.
- [ ] **Step 7: Commit** `feat: header and settings page`.

### Task 16: Roles pane

**Files:**
- Modify: `src/renderer/settings.js`, `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/spawn-modal.js`, `src/renderer/sidebar.js`, `src/renderer/chat.js`

**Interfaces:**
- Consumes: `listRoles`, `saveRole`, `deleteRole`, `resetRole` (Task 14); `record.roleDeleted` (Task 14).
- Produces: none for later tasks except the editor's skills slot `#roleSkills` (filled in Task 17).

- [ ] **Step 1: Build the Roles pane.**
  - Left list of roles, with a "bawaan" tag on built-ins.
  - Editor fields:
    - name: editable for custom roles only.
    - persona: textarea, max 20000 chars, matching `MAX_PROMPT`.
    - Tulis file select: Tidak boleh / Hanya file tes / Tanya dulu / Langsung.
    - Shell select: Tidak boleh / Tanya dulu / Otomatis untuk tes & Git baca.
  - A fixed note listing the hard blocks and "pasang paket, git push, hapus selalu bertanya".
  - Buttons:
    - Simpan.
    - "Tambah peran": a new role with defaults ask/ask.
    - Hapus: custom roles only, asks for confirmation.
    - "Kembalikan ke default": built-ins only.
  - Errors from main show inline.
- [ ] **Step 2: Spawn modal.**
  - The role select lists `spawnOptions().roles`, refreshed on every open.
  - The prompt prefills from the chosen role's persona.
- [ ] **Step 3: Show "peran dihapus".** An agent with `roleDeleted` shows "peran dihapus" next to its role in the sidebar and the chat head.
- [ ] **Step 4: Run `npm test`.** Expected: all pass (no main changes).
- [ ] **Step 5: CDP check.**
  - Add "Designer" with persona "Kamu Designer…" and ask/ask, then Simpan. `roles.json` contains it.
  - Spawn modal lists Designer and prefills its persona.
  - Spawn a Designer agent (Claude, scratch repo) and ask it to write `index.css`: an approval card appears.
  - Edit Designer to write "Langsung", then send another write: it still asks, because of the snapshot.
  - Delete Designer: the agent shows "peran dihapus".
  - Reset Junior Developer after editing it: the persona is back to default.
  - Stop the agent with worktree+branch cleanup. 0 console errors.
- [ ] **Step 6: Commit** `feat: role editor`.

### Task 17: Skills

**Files:**
- Create: `src/main/skills.js`, `tests/skills.test.js`
- Modify: `src/main/agents/router-tools.js`, `src/main/agents/router-agent.js`, `src/main/agents/claude-agent.js`, `src/main/ipc.js`, `src/main/main.js`, `src/preload/preload.js`, `src/renderer/settings.js`, `src/renderer/index.html`
- Test: `tests/router-tools.test.js`, `tests/router-agent.test.js`, `tests/claude-agent.test.js`

**Interfaces:**
- Consumes: `record.rolePolicy.skills`, `record.rolePolicy.disableSkills` (Task 14); `isInside`, `isCredentialPath` (`policy/paths.js`).
- Produces:
  - `Skill = { id: string, name: string, description: string, source: string, dir: string }`; `id` is `"<source>:<name>"`, `source` is `"user"` for `~/.claude/skills` or the plugin name.
  - `listSkills({ home = os.homedir(), pluginsDir = <home>/.claude/plugins }) -> Skill[]`.
  - `readSkillFile(skill, relPath = 'SKILL.md') -> string`; throws an Error with an Indonesian reason. Max 100 KB, truncated with a note.
  - Router tool `load_skill { name: string, path?: string }`. It runs in main without `decide` and without an approval card, but only for ids in `record.rolePolicy.skills`.
  - IPC `listSkills() -> Skill[]` without `dir` (the renderer needs no paths).

- [ ] **Step 1: Write failing tests.** Fixture tree under tmp: `home/.claude/skills/{ui/SKILL.md, nofront/SKILL.md (no frontmatter), empty/}` and one plugin skill.
  - `tests/skills.test.js`:
    - `listSkills returns ui and the plugin skill with name/description from frontmatter; nofront and empty are skipped` (Review Focus 5).
    - `readSkillFile(ui) returns SKILL.md; readSkillFile(ui, 'references/a.md') returns that file`.
    - `readSkillFile refuses '../x', 'C:\\Windows\\win.ini', '\\\\server\\share\\x', a junction to outside, and '.env' inside the skill` (Review Focus 4). Each throws, and the message names the reason.
  - `tests/router-tools.test.js`:
    - `load_skill for a skill not in rolePolicy.skills -> tool result "Skill tidak tersedia untuk peran ini."`.
    - `load_skill path escape -> tool result with the refusal, no throw`.
  - `tests/router-agent.test.js`:
    - `system prompt lists name + description of the role's skills and mentions load_skill; no skills -> no skill section and no load_skill tool`.
  - `tests/claude-agent.test.js`:
    - `rolePolicy.disableSkills -> buildArgs contains --disable-slash-commands`.
- [ ] **Step 2: Run `npm test`.** Expected: new tests fail.
- [ ] **Step 3: Spike the Claude per-skill limit** (10 min, scratch repo).
  - Try `--disallowedTools "Skill(<name>)"` with a real skill and record whether Claude can still invoke it.
  - If it blocks: pass every unselected skill that way in `buildArgs`, and add a test for it.
  - If not: the editor shows "Centang skill hanya berlaku untuk agent 9router; agent Claude memuat semua skill Anda kecuali 'Matikan semua skill' dicentang."
  - Log the result as a `Task 17: Ruling` line in the ledger.
- [ ] **Step 4: Implement `skills.js`.** Parse only the `name:` and `description:` frontmatter lines. Plugin layout discovery is the builder's call (§6). For path checks, use `realpath` first, then `isInside(skill.dir, target)` and `!isCredentialPath(target)`, and reject absolute and UNC paths before resolving.
- [ ] **Step 5: Wire it.**
  - `router-tools`: `load_skill` is added to TOOLS only when the role has skills.
  - `router-agent` `systemPrompt(record, skills)`.
  - IPC `listSkills`.
  - Skills pane: list with name, description, and source.
  - Role editor `#roleSkills`: a checklist plus a "Matikan semua skill (agent Claude)" checkbox, saved into `Role.skills` / `Role.disableSkills`.
- [ ] **Step 6: Run `npm test`.** Expected: all pass.
- [ ] **Step 7: CDP check.**
  - The Skills pane lists the owner's real skills (names only in the report).
  - Give Designer the `antislop-ui` skill and spawn a 9router Designer.
  - Ask "Pakai load_skill antislop-ui lalu sebutkan satu aturannya": a `load_skill` tool row appears and the reply quotes a rule.
  - Stop with cleanup. 0 console errors.
- [ ] **Step 8: Commit** `feat: skills per role`.

### Task 18: Settings store, Workspace, Agent limits, Notifikasi

**Files:**
- Create: `src/main/settings.js`, `src/main/notify.js`, `tests/settings.test.js`, `tests/notify.test.js`
- Modify: `src/main/ipc.js`, `src/main/main.js`, `src/main/agents/router-agent.js`, `src/main/agents/router-tools.js`, `src/preload/preload.js`, `src/renderer/settings.js`, `src/renderer/spawn-modal.js`, `src/renderer/stop-dialog.js`

**Interfaces:**
- Consumes: `pickFolder` and the `pickedRepos` allowlist (`ipc.js`), `MAX_TOOL_ROUNDS`, `COMMAND_TIMEOUT_MS`.
- Produces:
  - `Settings = { workspace: { defaultRepo: string | null, baseBranch: string, stopCleanup: 'keep' | 'worktree' | 'worktree+branch' | null }, agent: { claude: { model: string, effort: string | null }, router: { model: string | null, effort: string | null }, maxToolRounds: number, commandTimeoutSec: number }, notify: { approval: boolean, done: boolean, error: boolean } }`.
  - Defaults: `defaultRepo null`, `baseBranch 'main'`, `stopCleanup null` (null = today's choice: keep while running, worktree when stopped), `claude.model 'sonnet'`, efforts `null` (no flag sent), `router.model null`, `maxToolRounds 25` (range 1–100), `commandTimeoutSec 60` (range 5–600), all notify `true`.
  - `createSettings({ dir }) -> { get(): Settings, update(patch): Settings }`. `update` deep-merges, validates every field, and throws an Indonesian message on a bad value.
  - `startNotifier({ store, getWindow, settings, Notification }) -> () => void`.
  - IPC: `getSettings() -> Settings`, `updateSettings(patch) -> Settings`, `pickDefaultRepo() -> string | null` (opens `pickFolder`, adds the pick to `pickedRepos`, and stores it).
  - `agent.claude.effort` / `agent.router.effort` are stored here; Task 19 validates and uses them.

- [ ] **Step 1: Write failing tests.**
  - `tests/settings.test.js`:
    - `get() on an empty dir returns the defaults above`.
    - `update({agent:{maxToolRounds:0}}) and 101 throw; 40 persists across createSettings`.
    - `update({workspace:{stopCleanup:'nuke'}}) throws`.
    - `corrupt settings.json -> defaults; next update rewrites it` (Review Focus 1).
  - `tests/notify.test.js` (fake Notification, fake store events):
    - `status approval/done/error -> one alert with agent name and kind, body has no message text`.
    - `notify.done false -> no alert for done`.
    - `window focused -> no alert`.
  - `tests/router-agent.test.js`:
    - `maxToolRounds from settings (3) caps at 3 rounds`.
  - `tests/router-tools.test.js`:
    - `commandTimeoutSec 5 passes timeoutMs 5000`.
  - `tests/spawn.test.js`:
    - `the stored defaultRepo is accepted by spawn after restart without a new pick`.
- [ ] **Step 2: Run `npm test`.** Expected: new tests fail.
- [ ] **Step 3: Implement `settings.js` and `notify.js`.** Alerts fire only when the window is not focused: this is my call, so the owner is not pinged for what is on screen. On startup, `main.js` adds the stored `defaultRepo` to `pickedRepos` if `isGitRepo` is true.
- [ ] **Step 4: Wire it.**
  - The router agent reads `maxToolRounds` and `commandTimeoutSec` per turn.
  - The spawn modal prefills workspace and base branch from settings.
  - The stop dialog preselects `stopCleanup` when it is set.
  - Panes:
    - Workspace: repo picker, base branch, stop choice.
    - Agent: the two number fields with their ranges shown; the model/effort defaults come in Task 19.
    - Notifikasi: three toggles.
- [ ] **Step 5: Run `npm test`.** Expected: all pass.
- [ ] **Step 6: CDP check.**
  - Set the default repo to the scratch repo and base branch `main`; the spawn modal is prefilled.
  - Set stop choice to "hapus worktree+branch"; the stop dialog preselects it.
  - Set tool rounds to 3; a fake router that always calls tools stops at 3 with the cap error.
  - Blur the window during an approval: an alert appears (screenshot or a log of the fake).
  - 0 console errors.
- [ ] **Step 7: Commit** `feat: workspace, agent and notification settings`.

### Task 19: Models and effort

**Files:**
- Modify: `src/main/agents/claude-agent.js`, `src/main/agents/router-agent.js`, `src/main/agents/router-client.js`, `src/main/ipc.js`, `src/preload/preload.js`, `src/renderer/app.js`, `src/renderer/chat.js`, `src/renderer/spawn-modal.js`, `src/renderer/settings.js`
- Test: `tests/claude-agent.test.js`, `tests/router-client.test.js`, `tests/router-agent.test.js`, `tests/spawn.test.js`, `tests/ipc.test.js`

**Interfaces:**
- Consumes: `Settings.agent` (Task 18).
- Produces:
  - `CLAUDE_MODELS = ['opus', 'sonnet', 'haiku', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-4-7', 'claude-haiku-4-5']`.
  - `isClaudeModelId(s)`: true for list members or `/^claude-[a-z0-9][a-z0-9.-]{1,60}(\[1m\])?$/`.
  - `CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']`, `ROUTER_EFFORTS = ['low', 'medium', 'high']`; `null` means default.
  - Record field `effort: string | null`. Event `{ type: 'effort', effort, pending: boolean }`.
  - `ClaudeAgent.setEffort(effort)`, `RouterAgent.setEffort(effort)`.
  - IPC `setEffort(agentId, effort)`.
  - `spawnOptions()` adds `claudeModels`, `claudeEfforts`, `routerEfforts`. The renderer stops hard-coding `CLAUDE_MODELS` in `app.js`.

- [ ] **Step 1: Write failing tests.**
  - `tests/claude-agent.test.js`:
    - `buildArgs with effort 'high' contains --effort high; null -> no --effort`.
    - `setModel accepts 'claude-opus-5-5' and a custom 'claude-sonnet-6-0'; rejects 'gpt-5' and 'claude-; rm'`.
    - `setEffort while idle -> process restarted with --resume <sessionId> and --effort; event pending false`.
    - `setEffort while thinking or approval -> no restart, event pending true; restart happens after the turn's result and when no approval is open` (§5 ruling).
    - `setEffort('ultra') throws`.
  - `tests/router-client.test.js`:
    - `effort 'medium' -> request body has reasoning_effort 'medium'; null -> key absent`.
  - `tests/router-agent.test.js`:
    - `setEffort applies to the next request without restart`.
  - `tests/spawn.test.js`:
    - `spawn stores cfg.effort after validation per kind; claude 'xhigh' ok, router 'xhigh' -> "Effort tidak dikenal."`.
  - `tests/ipc.test.js`:
    - `setEffort validates agent id and value`.
- [ ] **Step 2: Run `npm test`.** Expected: new tests fail.
- [ ] **Step 3: Implement.**
  - `buildArgs` pushes `--effort` when set.
  - `ClaudeAgent.setEffort`: if idle or stopped, restart; otherwise set `pendingEffort` and apply it in the turn-end handler once no approval is pending.
  - `streamChat` takes `effort`.
  - Spawn validates `effort` per kind and `model` with `isClaudeModelId` for Claude.
- [ ] **Step 4: Renderer.**
  - Spawn modal:
    - Claude: model select (list + "ID model lain…" opening a text field).
    - Effort select ("bawaan" plus levels), prefilled from Settings → Agent.
  - Composer: effort select next to the model select, calling `setEffort`. A pending event shows "berlaku setelah giliran ini".
  - Settings → Agent: Claude and 9router default model and effort.
  - 9router effort shows the note "efeknya bergantung pada model".
- [ ] **Step 5: Run `npm test`.** Expected: all pass.
- [ ] **Step 6: CDP check** (real Claude, scratch repo; real 9router only with the owner present).
  - Spawn Claude with `claude-haiku-4-5` and effort `low`, and send "halo": it replies.
  - Change the effort to `high` while idle: the process restarts and the next reply arrives with history intact.
  - Change the effort mid-turn: "berlaku setelah giliran ini" shows, then it applies.
  - Spawn with a custom ID `claude-haiku-5-5`: it works.
  - 9router agent with effort `low` (fake router): the request body logged by the fake has `reasoning_effort`.
  - Stop all with cleanup. 0 console errors, 0 leftover `claude` processes.
- [ ] **Step 7: Commit** `feat: model versions and effort`.
