// Column widths and the office toggle (layout spec §4.1, §4.5, §4.6, §4.9).
// Stored per machine in localStorage['zonder.layout']; anything unreadable
// falls back to the defaults.

const Layout = (() => {
  const LAYOUT = { left: { def: 240, min: 180 }, right: { def: 380, min: 300 }, officeMin: 360 };

  const num = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

  // Each column at least its minimum; while the office shows, it keeps 360px:
  // the right column gives way first, then the left.
  function clampWidths({ left, right, officeHidden = false }, total) {
    let l = Math.max(LAYOUT.left.min, Math.round(num(left, LAYOUT.left.def)));
    let r = Math.max(LAYOUT.right.min, Math.round(num(right, LAYOUT.right.def)));
    let excess = l + r - (officeHidden ? total : total - LAYOUT.officeMin);
    if (excess > 0) {
      const cut = Math.min(excess, r - LAYOUT.right.min);
      r -= cut;
      excess -= cut;
    }
    if (excess > 0) l = Math.max(LAYOUT.left.min, l - excess);
    return { left: l, right: r };
  }

  function parseLayout(text) {
    let raw = null;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
    return {
      left: num(raw.left, LAYOUT.left.def),
      right: num(raw.right, LAYOUT.right.def),
      officeHidden: typeof raw.officeHidden === 'boolean' ? raw.officeHidden : false,
    };
  }

  return { LAYOUT, clampWidths, parseLayout };
})();

if (typeof module !== 'undefined') module.exports = Layout;

const LAYOUT_KEY = 'zonder.layout';
const NARROW = Layout.LAYOUT.left.min + Layout.LAYOUT.officeMin + Layout.LAYOUT.right.min;
const STEP = 16;
const BIG_STEP = 64;

function initLayout({ office }) {
  const main = document.querySelector('.main');
  const sepLeft = document.getElementById('sepLeft');
  const sepRight = document.getElementById('sepRight');
  const toggle = document.getElementById('officeToggle');
  const legend = document.getElementById('legend');
  const legendHome = legend.parentElement;
  const legendSlot = document.getElementById('legendSlot');

  let saved;
  try {
    saved = Layout.parseLayout(localStorage.getItem(LAYOUT_KEY));
  } catch {
    saved = Layout.parseLayout(null);
  }
  // `saved` is the owner's choice; a narrow window only hides the office for now.
  // `cur` is the widths the owner set, `shown` what fits now: a smaller window
  // squeezes the columns without forgetting the chosen widths.
  const cur = { left: saved.left, right: saved.right };
  const shown = { ...cur };
  let narrow = false;

  const save = () => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ left: cur.left, right: cur.right, officeHidden: saved.officeHidden }));
    } catch {
      // Storage unavailable: the layout still works for this session.
    }
  };
  // Grid width minus the two separators.
  const total = () => main.clientWidth - sepLeft.offsetWidth - (sepRight.hidden ? 0 : sepRight.offsetWidth);
  const officeHidden = () => saved.officeHidden || narrow;

  function apply() {
    const width = main.clientWidth;
    // Settings hides .main; nothing to measure until it is back.
    if (!width) return;
    narrow = width < NARROW;
    const hidden = officeHidden();
    main.classList.toggle('office-hidden', hidden);
    document.querySelector('.office').hidden = hidden;
    sepRight.hidden = hidden;
    office.setHidden(hidden);
    (hidden ? legendSlot : legendHome).append(legend);
    legendSlot.hidden = !hidden;
    document.getElementById('narrowNote').hidden = !narrow;

    toggle.setAttribute('aria-pressed', String(saved.officeHidden));
    const label = saved.officeHidden ? 'Tampilkan kantor' : 'Sembunyikan kantor';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    toggle.disabled = narrow;

    const w = Layout.clampWidths({ ...cur, officeHidden: hidden }, total());
    Object.assign(shown, w);
    main.style.setProperty('--col-left', `${w.left}px`);
    main.style.setProperty('--col-right', `${w.right}px`);
    const max = (side) => Layout.clampWidths({ ...shown, [side]: 1e6, officeHidden: hidden }, total())[side];
    for (const [sep, side] of [[sepLeft, 'left'], [sepRight, 'right']]) {
      sep.setAttribute('aria-valuemin', String(Layout.LAYOUT[side].min));
      sep.setAttribute('aria-valuemax', String(max(side)));
      sep.setAttribute('aria-valuenow', String(shown[side]));
    }
  }

  // A width the owner sets is stored as it fits now, so End or a long drag
  // does not store a huge number.
  function setWidth(side, value) {
    cur[side] = value;
    apply();
    cur[side] = shown[side];
  }

  function wire(sep, side) {
    // The left separator grows its column to the right; the right one to the left.
    const dir = side === 'left' ? 1 : -1;
    let drag = null;
    sep.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      sep.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, start: shown[side] };
      main.classList.add('resizing');
    });
    sep.addEventListener('pointermove', (e) => {
      if (drag) setWidth(side, drag.start + dir * (e.clientX - drag.x));
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      main.classList.remove('resizing');
      save();
    };
    sep.addEventListener('pointerup', end);
    sep.addEventListener('pointercancel', end);
    sep.addEventListener('dblclick', () => {
      setWidth(side, Layout.LAYOUT[side].def);
      save();
    });
    sep.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? BIG_STEP : STEP;
      const keys = {
        ArrowRight: () => shown[side] + dir * step,
        ArrowLeft: () => shown[side] - dir * step,
        Home: () => Layout.LAYOUT[side].min,
        End: () => 1e6,
        Enter: () => Layout.LAYOUT[side].def,
      };
      if (!keys[e.key]) return;
      e.preventDefault();
      setWidth(side, keys[e.key]());
      save();
    });
  }

  wire(sepLeft, 'left');
  wire(sepRight, 'right');
  toggle.addEventListener('click', () => {
    saved.officeHidden = !saved.officeHidden;
    apply();
    save();
  });
  window.addEventListener('resize', apply);
  // .main comes back after Settings closes; measure again then.
  new ResizeObserver(apply).observe(main);
  apply();
}
