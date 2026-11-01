// How an avatar looks: pose and mark per status (office-life spec §4.1), a stable
// hair look per agent id, and animation phases. No drawing here.

const OfficeLook = (() => {
  const POSES = ['type', 'board', 'sip', 'raise', 'qa', 'lounge', 'facepalm', 'walk'];

  // pose, mark, and whether the pose sits when it has a seat.
  const BY_STATUS = {
    working: { pose: 'type', mark: null, sits: true },
    thinking: { pose: 'board', mark: 'dots', sits: false },
    idle: { pose: 'sip', mark: null, sits: false },
    starting: { pose: 'sip', mark: null, sits: false },
    approval: { pose: 'raise', mark: 'alert', sits: false },
    // Tests running: no tick or cross, so nothing reads as a pass or fail.
    testing: { pose: 'qa', mark: null, sits: true },
    done: { pose: 'lounge', mark: 'check', sits: true },
    error: { pose: 'facepalm', mark: 'error', sits: true },
  };

  function poseFor(status, { walking = false, seated = false } = {}) {
    const look = BY_STATUS[status] || BY_STATUS.idle;
    if (walking) return { pose: 'walk', standing: true, mark: look.mark };
    return { pose: look.pose, standing: !(seated && look.sits), mark: look.mark };
  }

  // Neutral grey tones, tokens in styles.css.
  const HAIR = ['--office-hair-1', '--office-hair-2', '--office-hair-3', '--office-hair-4', '--office-hair-5', '--office-hair-6'];

  // FNV-1a: the same id always gets the same look.
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  function appearanceFor(agentId) {
    const h = hash(String(agentId));
    return { hair: HAIR[h % HAIR.length], hairStyle: Math.floor(h / HAIR.length) % 3 };
  }

  // Position inside a repeating cycle, in [0, 1).
  function phase(tMs, periodMs, offset = 0) {
    const p = (tMs / periodMs + offset) % 1;
    return p < 0 ? p + 1 : p;
  }

  return { POSES, poseFor, appearanceFor, phase, hash };
})();

if (typeof module !== 'undefined') module.exports = OfficeLook;
