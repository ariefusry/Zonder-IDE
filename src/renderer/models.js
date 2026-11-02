// Model logo per agent (layout spec §4.3). A 9router agent shows the model that
// last answered (§4.4); the logos are drawn in --muted so colour stays for status.

const Models = (() => {
  const PREFIXES = [
    ['claude', ['claude', 'opus', 'sonnet', 'haiku']],
    ['openai', ['gpt', 'o1', 'o3', 'o4', 'chatgpt']],
    ['gemini', ['gemini']],
    ['deepseek', ['deepseek']],
  ];
  const LABELS = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', deepseek: 'DeepSeek' };

  // Drop the 9router path: kr/claude-sonnet-4.5 -> claude-sonnet-4.5.
  const bare = (id) => String(id ?? '').slice(String(id ?? '').lastIndexOf('/') + 1);

  function modelFamily(id) {
    const name = bare(id).toLowerCase();
    if (!name) return null;
    for (const [family, starts] of PREFIXES) if (starts.some((p) => name.startsWith(p))) return family;
    return null;
  }

  // The served model counts only when it names something other than the choice;
  // a router that echoes the combo name tells nothing.
  const shown = (a) => (a.servedModel && a.servedModel !== a.model ? a.servedModel : a.model);

  function logoFor(a) {
    if (a.kind === 'claude') return { kind: 'logo', family: 'claude', label: LABELS.claude };
    const name = shown(a);
    const family = modelFamily(name);
    if (family) return { kind: 'logo', family, label: LABELS[family] };
    // A path-style id is one model we do not know; a plain name is a combo.
    if (String(name ?? '').includes('/')) return { kind: 'initial', letter: (bare(name)[0] || '?').toUpperCase(), label: name };
    return { kind: 'combo', label: 'Combo' };
  }

  function modelLine(a) {
    return a.servedModel && a.servedModel !== a.model ? `${a.model} · ${bare(a.servedModel)}` : a.model;
  }

  // Combo: three linked nodes in 1px lines.
  const COMBO = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">'
    + '<circle cx="4" cy="4" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="8" cy="12" r="2"/>'
    + '<path d="M6 4h4M5 5.7l2 4.6M11 5.7l-2 4.6"/></svg>';

  function logoNode(a) {
    const logo = logoFor(a);
    const node = document.createElement('span');
    // A logo is a CSS mask of the official shape (styles.css), painted in --muted.
    node.className = `mlogo ${logo.kind === 'logo' ? logo.family : logo.kind}`;
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', logo.label);
    node.title = logo.label;
    if (logo.kind === 'combo') node.innerHTML = COMBO;
    else if (logo.kind === 'initial') node.textContent = logo.letter;
    return node;
  }

  return { modelFamily, logoFor, modelLine, logoNode };
})();

if (typeof module !== 'undefined') module.exports = Models;
