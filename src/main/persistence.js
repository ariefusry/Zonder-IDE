// Agent registry (agents.json) and per-agent chat history (history/<id>.jsonl)
// under the app's userData dir. Synchronous on purpose: writes are small and
// ordered, so two saves can never interleave.

const fs = require('node:fs');
const path = require('node:path');

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function checkId(agentId) {
  if (!ID.test(String(agentId))) throw new Error(`invalid agent id: ${agentId}`);
}

class Persistence {
  constructor(dir) {
    this.dir = dir;
    this.registry = path.join(dir, 'agents.json');
    this.historyDir = path.join(dir, 'history');
    fs.mkdirSync(this.historyDir, { recursive: true });
  }

  saveAgents(records) {
    // Write then rename, so a crash mid-write never leaves half a registry.
    const tmp = `${this.registry}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
    fs.renameSync(tmp, this.registry);
  }

  loadAgents() {
    let text;
    try {
      text = fs.readFileSync(this.registry, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      // Keep the damaged file for inspection instead of overwriting it on the next save.
      fs.renameSync(this.registry, `${this.registry}.corrupt-${Date.now()}`);
      return [];
    }
  }

  historyFile(agentId) {
    checkId(agentId);
    return path.join(this.historyDir, `${agentId}.jsonl`);
  }

  appendEvent(agentId, evt) {
    const file = this.historyFile(agentId);
    // After a crash the last line may lack its newline; start a fresh line so
    // the new event is not glued onto the broken one.
    let prefix = '';
    try {
      const { size } = fs.statSync(file);
      if (size > 0) {
        const fd = fs.openSync(file, 'r');
        const last = Buffer.alloc(1);
        fs.readSync(fd, last, 0, 1, size - 1);
        fs.closeSync(fd);
        if (last[0] !== 0x0a) prefix = '\n';
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    fs.appendFileSync(file, `${prefix}${JSON.stringify(evt)}\n`);
  }

  loadHistory(agentId) {
    let text;
    try {
      text = fs.readFileSync(this.historyFile(agentId), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const events = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Truncated line from an interrupted write: skip it.
      }
    }
    return events;
  }
}

module.exports = { Persistence };
