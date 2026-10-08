/*
 * <liquid-key>
 *
 * One key with a whole interaction model. It can be tapped, double tapped,
 * and held, and while it is held, bubbles pull out of it up, left, and
 * right, each tearing free where letting go would act. It has no meaning of
 * its own: the key reports what the finger did, and draws the state the
 * page gives it.
 *
 *   <script src="liquid-key.js"></script>
 *   <liquid-key></liquid-key>
 *
 * Gestures
 *   A press let go before its hold (275 ms) is a tap, or a double tap when it
 *   began within 300 ms of a tap's release. A press kept 275 ms within 12 px
 *   is a hold; one that moves farther first slides, and is neither. Pulls
 *   open at the hold, at the slide, or at once on a press ending a latch. A
 *   bubble comes out of the key and follows the finger around its top half;
 *   whichever direction leads names its action. It arms where it tears from
 *   the key, and clears once pushed back into the merge. Letting go with a
 *   pull armed performs it. A double tap latches the key until the next
 *   press.
 *
 * Events, bubbling and composed. Every detail describes the press as
 * { ending, held, slid, aim }: ending is 'lock' or 'armed' when the press
 * ends a latch or an armed one-shot, and aim is the armed pull's action.
 *   press         the finger, or Space, came down
 *   hold          the press became a hold
 *   slide         the press moved before its hold; it will not be a tap or a hold
 *   aim           { action, direction, previous }  the armed pull changed
 *   tap           let go before the hold
 *   singletap     no second press began within the double-tap window
 *   doubletap     { locked }  let go before the hold, within the window of a tap
 *   action        { action, direction }  let go with a pull armed
 *   release       let go after a hold or a slide, nothing armed
 *   presscancel   the press was cancelled
 * Exactly one of tap, doubletap, action, release, and presscancel ends each
 * press. For the key's own state:
 *   activechange  { active }  a press is under way or the key is latched
 *   lockchange    { locked }
 *
 * State the page sets, as properties or attributes
 *   live       what the key started is running: the key turns live, shows
 *              its live symbol, and marks an armed pull at its edge. Turning
 *              it off ends a latch.
 *   armed      a one-shot waits on the key: while live, the armed symbol
 *              pulses, and the next press ends it.
 *   aura       a CSS color glowing behind the key, or none.
 *   disabled   not pressable.
 *
 * Configuration
 *   pulls             each { action, symbol, label }, by direction: up, left,
 *                     right, up-left, or up-right. A key at the edge of a
 *                     screen can move a pull with no room onto a diagonal.
 *   symbol, live-symbol, armed-symbol
 *   label, locked-label    the accessible name, and the name while latched;
 *                          an armed pull's label stands in for both
 *   hold-delay, double-tap-delay    in milliseconds
 *   size              the key's diameter in pixels, 68 by default; everything
 *                     it draws scales with it, and its pulls arm sooner
 *   no-latch          a double tap does not latch
 *   no-haptics        no vibration (Android) or switch tick (iOS Safari).
 *                     Haptics go through LiquidKey.haptic(kind), kind one of
 *                     selection, medium, heavy, or success; a native shell
 *                     can replace it, to play them on a Mac's trackpad.
 *   theme             outline, the default, glass, solid, or your own
 *   geometry          draws the gesture's geometry over the key: the slop,
 *                     clear, and arm radii, the directions' arcs, the pull,
 *                     and the hold and double-tap timers
 * The defaults are the speech key's: mic, waveform, and ⌘, with send, undo,
 * and fix pulls. A symbol is a name in LiquidKey.symbols, where you can add
 * your own, or SVG markup on a 24-unit grid. Paths with class="stroke" take
 * the key's line weights, and the live symbol's lines ripple.
 *
 * Themes are custom properties on the element, so your own is plain CSS,
 * and whatever it leaves out keeps the outline theme's value:
 *   liquid-key[theme=mine] { --liquid-key-fill: #222; }
 *   --liquid-key-fill, --liquid-key-fill-live    the shape's body, idle and live
 *   --liquid-key-light, --liquid-key-rim         light along the edge; rim 0 is flat
 *   --liquid-key-stroke, --liquid-key-stroke-live, --liquid-key-stroke-width
 *   --liquid-key-shadow                         0 to 1
 *   --liquid-key-backdrop                       a backdrop-filter, or none
 *   --liquid-key-ink, --liquid-key-ink-live      symbols on the key, idle and live
 *   --liquid-key-hint                           hints and unarmed bubbles
 *   --liquid-key-focus                          the focus ring
 *   --liquid-key-geometry                       the geometry overlay
 * The key reads them when it connects, when its theme, class, or style
 * attribute changes, and at each press.
 *
 * Keyboard: focus the key and hold Space or Enter; arrows pull while it is
 * held, and Escape cancels.
 */
(() => {
  'use strict';

  // Press timing, by default.
  const HOLD_MS = 275;
  const DOUBLE_TAP_MS = 300;
  // A bubble is the key's size. Held back, it trails the finger and stays
  // necked to the key; a pull arms the moment its trailing travel would part
  // the two circles, and arming springs it the rest of the way to the
  // finger, so the tear, the jump, and the haptic are one event. It clears
  // once pushed back into the merge.
  const SIZE = 68;
  const R = SIZE / 2;
  // How far apart two shapes still melt together.
  const MERGE = 24;
  // How far the held-back bubble trails the finger when it arms.
  const DRAG = 0.25;
  // Travel at which two touching circles of this size part.
  const PART = SIZE - 2;
  const ARM = PART / (1 - DRAG);
  const CLEAR = ARM - 28;
  // Pull below this is finger jitter, and shows no bubble.
  const REVEAL = 10;
  // Travel beyond this before the hold engages makes the press a slide.
  const SLOP = 12;
  // Another direction takes over the pull once it leads by this much.
  const SWITCH = 16;
  // How strongly the bubble leans toward its direction's axis rather than
  // all the way to the finger, so that when another direction takes over,
  // the bubble swings across to it.
  const MAGNET = 0.5;

  // Room the shapes may draw in around the key's center.
  const STAGE = { left: 220, right: 220, up: 400, down: 120 };
  const STAGE_W = STAGE.left + STAGE.right;
  const STAGE_H = STAGE.up + STAGE.down;
  const MAX_UP = STAGE.up - SIZE - 8;
  const MAX_SIDE = STAGE.left - SIZE - 8;

  // SwiftUI springs as response and damping fraction; spring(duration:bounce:)
  // is response = duration and damping = 1 - bounce.
  const INTERACTIVE = { response: 0.22, damping: 0.62 };
  const TEAR = { response: 0.4, damping: 0.45 };
  const SETTLE = { response: 0.35, damping: 0.7 };
  const PRESS = { response: 0.3, damping: 0.55 };
  const FADE = { response: 0.22, damping: 1 };

  // The directions a pull can take, in the order a tie between them goes.
  const DIRECTIONS = ['up', 'left', 'right', 'up-left', 'up-right'];
  // The drop's shapes, in the renderer's order: the key, then the bubble.
  const SHAPES = ['key', 'bubble'];
  // Each direction's axis, as an angle from the key's center; upward is
  // -π/2. The pulls a key has share the top half of the circle between
  // them, each owning the arc out to halfway to its neighbors; the bubble
  // follows the finger within the arcs open to it, and below the key's
  // middle it keeps to its direction's axis.
  const AXIS = { up: -Math.PI / 2, left: -Math.PI, right: 0, 'up-left': -0.75 * Math.PI, 'up-right': -0.25 * Math.PI };

  // The speech key's meaning, for a page to replace.
  const DEFAULTS = {
    symbol: 'mic',
    liveSymbol: 'waveform',
    armedSymbol: 'command',
    label: 'Tap for a command, hold to dictate, double tap to keep dictating',
    lockedLabel: 'Dictation locked, tap to finish',
    holdDelay: HOLD_MS,
    doubleTapDelay: DOUBLE_TAP_MS,
    size: SIZE,
  };
  const PULLS = {
    up: { action: 'send', symbol: 'arrow-up', label: 'Send' },
    left: { action: 'undo', symbol: 'undo', label: 'Undo' },
    right: { action: 'fix', symbol: 'wand', label: 'Fix' },
  };

  // The theme's custom properties that the renderer reads.
  const THEME = ['fill', 'fill-live', 'light', 'rim', 'stroke', 'stroke-live', 'stroke-width', 'shadow', 'backdrop']
    .map((name) => `--liquid-key-${name}`);

  const clamp01 = (value) => Math.min(1, Math.max(0, value));
  // An angle's direction, exact on the axes.
  const heading = (angle) => {
    const x = Math.cos(angle), y = Math.sin(angle);
    return [Math.abs(x) < 1e-9 ? 0 : x, Math.abs(y) < 1e-9 ? 0 : y];
  };
  // So far along a direction, with no negative zeros.
  const toward = (direction, distance) => heading(AXIS[direction]).map((v) => v * distance || 0);

  /** Each pulled direction's arc of the key's top half, out to halfway to its neighbors, in order round from the left. */
  function arcsOf(pulls) {
    const names = DIRECTIONS.filter((name) => pulls[name]).sort((a, b) => AXIS[a] - AXIS[b]);
    return Object.fromEntries(names.map((name, i) => [name, [
      i ? (AXIS[names[i - 1]] + AXIS[name]) / 2 : -Math.PI,
      i < names.length - 1 ? (AXIS[name] + AXIS[names[i + 1]]) / 2 : 0,
    ]]));
  }

  // MARK: Symbols, drawn after SF Symbols on a 24-unit grid

  const star = (x, y, r) => {
    const c = r * 0.2;
    return `M${x} ${y - r}Q${x + c} ${y - c} ${x + r} ${y}Q${x + c} ${y + c} ${x} ${y + r}` +
      `Q${x - c} ${y + c} ${x - r} ${y}Q${x - c} ${y - c} ${x} ${y - r}Z`;
  };
  const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  // Names asked for before they were added, warned about once.
  const unknown = new Set();
  // Keys on the page, redrawn when a symbol arrives.
  const connected = new Set();
  const SYMBOLS = new Proxy({
    mic: svg('<rect x="8.5" y="1.75" width="7" height="12.5" rx="3.5" fill="currentColor"/>' +
      '<path class="stroke" d="M5.25 10.75a6.75 6.75 0 0 0 13.5 0M12 17.5v4"/>'),
    waveform: svg([6, 12, 18, 13, 17, 10, 5].map((h, i) =>
      `<line class="stroke" style="--i:${i}" x1="${2.4 + i * 3.2}" x2="${2.4 + i * 3.2}" y1="${12 - h / 2}" y2="${12 + h / 2}"/>`).join('')),
    command: svg('<path class="stroke" d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>'),
    message: svg('<path class="stroke" d="M6.5 3.5h11A2.5 2.5 0 0 1 20 6v7.5a2.5 2.5 0 0 1-2.5 2.5H12l-4.5 4v-4h-1A2.5 2.5 0 0 1 4 13.5V6a2.5 2.5 0 0 1 2.5-2.5Z"/>' +
      '<path class="stroke" d="M8.5 8h7M8.5 11.5h4.5"/>'),
    'arrow-up': svg('<path class="stroke" d="M12 20V4.5M5.5 11 12 4.5l6.5 6.5"/>'),
    undo: svg('<path class="stroke" d="M9 14.5 3.75 9.25 9 4M3.75 9.25H14.5a5.5 5.5 0 0 1 0 11H11"/>'),
    wand: svg('<path class="stroke" d="M4 20.5 13.5 11M15.25 9.25l1.5-1.5"/>' +
      `<path fill="currentColor" d="${star(8, 5.5, 3.6)}${star(18.5, 14.5, 2.6)}${star(19.5, 4.5, 1.9)}"/>`),
    lock: svg('<path class="stroke" d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>' +
      '<rect x="5" y="10" width="14" height="11.5" rx="2.5" fill="currentColor"/>'),
  }, {
    set(symbols, name, markup) {
      symbols[name] = markup;
      unknown.delete(name);
      for (const key of connected) key.scheduleSync();
      return true;
    },
  });

  /** A symbol's markup: a name in LiquidKey.symbols, or markup already. */
  function symbolMarkup(symbol) {
    const value = String(symbol ?? '').trim();
    if (!value) return '';
    if (value.startsWith('<')) return value;
    const markup = SYMBOLS[value];
    if (markup != null) return markup;
    if (!unknown.has(value)) {
      unknown.add(value);
      console.warn(`liquid-key: no symbol named "${value}" yet; add it to LiquidKey.symbols.`);
    }
    return '';
  }

  // MARK: Springs

  class Spring {
    constructor(value, epsilon = 0.01) {
      this.value = this.target = value;
      this.velocity = 0;
      this.epsilon = epsilon;
      this.stiffness = 0;
      this.damping = 0;
    }

    to(target, { response, damping }) {
      const omega = (2 * Math.PI) / response;
      this.stiffness = omega * omega;
      this.damping = 2 * damping * omega;
      this.target = target;
    }

    set(value) {
      this.value = this.target = value;
      this.velocity = 0;
    }

    get settled() { return this.value === this.target && this.velocity === 0; }

    /** Advances by dt seconds; false when there was nothing to do. */
    step(dt) {
      if (this.settled) return false;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
        this.velocity += force * h;
        this.value += this.velocity * h;
      }
      if (Math.abs(this.value - this.target) < this.epsilon && Math.abs(this.velocity) < this.epsilon * 10) {
        this.set(this.target);
      }
      return true;
    }
  }

  // MARK: Haptics

  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /** Vibration where the browser has it; on iOS Safari, a switch's tick. */
  function haptic(kind) {
    try {
      if (!iOS && typeof navigator.vibrate === 'function') {
        navigator.vibrate({ selection: 8, medium: 14, heavy: 24, success: [12, 70, 18] }[kind]);
        return;
      }
      if (!iOS) return;
      const tick = () => {
        const label = document.createElement('label');
        label.setAttribute('aria-hidden', 'true');
        label.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        label.append(input);
        document.head.append(label);
        label.click();
        label.remove();
      };
      tick();
      if (kind === 'success') setTimeout(tick, 90);
    } catch {
      // Haptics are a nicety.
    }
  }

  // MARK: Colors

  const colors = new Map();
  let probe = null;

  /** A CSS color as [r, g, b, a] in 0...1, or null when it is not one. */
  function parseColor(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    if (!colors.has(text)) colors.set(text, readColor(text));
    return colors.get(text);
  }

  function readColor(text) {
    const exact = parseRGB(text);
    if (exact) return exact;
    if (!CSS.supports('color', text)) return null;
    probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    // A canvas spells sRGB colors as hex or rgba(); others it can only paint.
    probe.fillStyle = '#000';
    probe.fillStyle = text;
    const spelled = parseRGB(String(probe.fillStyle));
    if (spelled) return spelled;
    probe.clearRect(0, 0, 1, 1);
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255, a / 255];
  }

  /** Hex, rgb(), rgba(), and color(srgb), the spellings themes use, read exactly. */
  function parseRGB(text) {
    let match = /^#([0-9a-f]{3,8})$/i.exec(text);
    if (match) {
      let hex = match[1];
      if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
      if (hex.length !== 6 && hex.length !== 8) return null;
      const byte = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
      return [byte(0), byte(2), byte(4), hex.length === 8 ? byte(6) : 1];
    }
    const fraction = (part, scale) => (part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part) / scale);
    const channels = (parts, scale) => {
      if (parts.length < 3 || parts.length > 4) return null;
      const color = [...parts.slice(0, 3).map((part) => fraction(part, scale)), parts[3] == null ? 1 : fraction(parts[3], 1)];
      return color.every(Number.isFinite) ? color.map(clamp01) : null;
    };
    match = /^rgba?\(([^)]*)\)$/i.exec(text);
    if (match) return channels(match[1].split(/\s*[,/]\s*|\s+/).filter(Boolean), 255);
    match = /^color\(\s*srgb\s+([^)]*)\)$/i.exec(text);
    if (match) return channels(match[1].split(/\s*\/\s*|\s+/).filter(Boolean), 1);
    return null;
  }

  // MARK: The drop

  // One drop: the key and the bubble pulled out of it as a smooth union of
  // ellipses, shaded by the theme: a body that darkens where it is live or
  // armed, light along its edge, a line around it, and a shadow. The bubble
  // melts into the key where their edges meet at an angle, never where they
  // coincide, so one sitting inside the key does not swell it. Each shape is
  // its center and radii, then its tint, its alpha, and the cosine and sine
  // of its turn.
  const FRAGMENT = `
precision highp float;
uniform vec2 uPx;
uniform float uDpr;
uniform vec2 uCenter;
uniform vec4 uShape[2];
uniform vec4 uLook[2];
uniform vec3 uGlow;
uniform float uMerge;
uniform vec4 uFill;
uniform vec4 uFillLive;
uniform vec4 uLight;
uniform float uRim;
uniform vec4 uStroke;
uniform vec4 uStrokeLive;
uniform float uStrokeWidth;
uniform float uShadow;

float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k1 > 1e-4 ? k0 * (k0 - 1.0) / k1 : (k0 - 1.0) * min(r.x, r.y);
}

float smin(float a, float b, float k) {
  if (k < 1e-3) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

vec2 normal(vec2 q, vec2 r) {
  vec2 g = q / (r * r);
  float l = length(g);
  return l > 1e-5 ? g / l : vec2(0.0);
}

// Into a shape's own frame, and a direction back out of it.
vec2 turned(vec2 q, vec2 cs) {
  return vec2(cs.x * q.x + cs.y * q.y, cs.x * q.y - cs.y * q.x);
}

vec2 unturned(vec2 n, vec2 cs) {
  return vec2(cs.x * n.x - cs.y * n.y, cs.y * n.x + cs.x * n.y);
}

float field(vec2 p) {
  vec2 q = turned(p - uShape[0].xy, uLook[0].zw);
  float d = sdEllipse(q, uShape[0].zw);
  if (uLook[1].y >= 0.999) {
    vec2 n = unturned(normal(q, uShape[0].zw), uLook[0].zw);
    vec2 qb = turned(p - uShape[1].xy, uLook[1].zw);
    float w = clamp(0.5 - 0.5 * dot(n, unturned(normal(qb, uShape[1].zw), uLook[1].zw)), 0.0, 1.0);
    d = smin(d, sdEllipse(qb, uShape[1].zw), uMerge * w);
  }
  return d;
}

vec4 shade(float d, vec2 n, float tint, float glow) {
  float cover = clamp(0.5 - d * uDpr, 0.0, 1.0);
  float edge = uStrokeWidth > 0.0 ? clamp((0.5 * uStrokeWidth - abs(d)) * uDpr + 0.5, 0.0, 1.0) : 0.0;
  if (cover <= 0.0 && edge <= 0.0) return vec4(0.0);
  float depth = max(-d, 0.0);
  vec2 light = normalize(vec2(-1.0, -1.2));
  float lit = max(dot(n, light), 0.0);
  float back = max(-dot(n, light), 0.0);
  float spec = pow(lit, 3.0) + 0.6 * pow(back, 3.0);
  float rim = exp(-depth * 1.3) * (0.14 + 0.6 * spec);
  float band = exp(-depth / 7.0) * (0.035 + 0.15 * spec);
  float lift = clamp(((rim + band) * uRim * mix(1.0, 0.8, tint) + glow) * uLight.a, 0.0, 1.0);
  vec4 fill = mix(uFill, uFillLive, tint);
  vec4 body = vec4(uLight.rgb * lift + fill.rgb * fill.a * (1.0 - lift), lift + fill.a * (1.0 - lift)) * cover;
  vec4 line = mix(uStroke, uStrokeLive, tint);
  line.a *= edge;
  return vec4(line.rgb * line.a, line.a) + body * (1.0 - line.a);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uPx.y - gl_FragCoord.y) / uDpr - uCenter;
  float d = field(p);
  vec2 n = vec2(field(p + vec2(0.5, 0.0)) - d, field(p + vec2(0.0, 0.5)) - d);
  n = dot(n, n) > 1e-10 ? normalize(n) : vec2(0.0, -1.0);
  // Tint in drawing order: the bubble behind, the key in front.
  float tint = 0.0;
  vec2 qb = turned(p - uShape[1].xy, uLook[1].zw);
  if (uLook[1].y >= 0.999) tint = mix(tint, uLook[1].x, smoothstep(8.0, -1.0, sdEllipse(qb, uShape[1].zw)));
  tint = mix(tint, uLook[0].x, smoothstep(8.0, -1.0, sdEllipse(turned(p - uShape[0].xy, uLook[0].zw), uShape[0].zw)));
  vec2 g = p - uGlow.xy;
  vec4 color = shade(d, n, tint, uGlow.z * 0.14 * exp(-dot(g, g) / 1152.0));
  // A launched bubble fades on its own, apart from the drop.
  float a = uLook[1].y;
  if (a > 0.0 && a < 0.999) {
    vec4 ghost = shade(sdEllipse(qb, uShape[1].zw), unturned(normal(qb, uShape[1].zw), uLook[1].zw), uLook[1].x, 0.0) * a;
    color = ghost + color * (1.0 - ghost.a);
  }
  float outside = clamp(d * uDpr + 0.5, 0.0, 1.0);
  float shadow = uShadow * (1.0 - smoothstep(-4.0, 12.0, field(p - vec2(0.0, 2.5)))) * outside;
  gl_FragColor = color + vec4(0.0, 0.0, 0.0, shadow) * (1.0 - color.a);
}`;

  // The same field on the CPU, for the shapes of the backdrop blur.
  function sdEllipse(x, y, rx, ry) {
    const k0 = Math.hypot(x / rx, y / ry);
    const k1 = Math.hypot(x / (rx * rx), y / (ry * ry));
    return k1 > 1e-4 ? (k0 * (k0 - 1)) / k1 : (k0 - 1) * Math.min(rx, ry);
  }

  function smin(a, b, k) {
    if (k < 1e-3) return Math.min(a, b);
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }

  function direction(x, y, rx, ry) {
    const gx = x / (rx * rx), gy = y / (ry * ry);
    const l = Math.hypot(gx, gy);
    return l > 1e-5 ? [gx / l, gy / l] : [0, 0];
  }

  // Into a shape's own frame, and a direction back out of it.
  const turned = (x, y, shape) => [shape.c * x + shape.s * y, shape.c * y - shape.s * x];
  const unturned = ([x, y], shape) => [shape.c * x - shape.s * y, shape.s * x + shape.c * y];

  function field(shapes, x, y) {
    const key = shapes[0];
    const [qx, qy] = turned(x - key.x, y - key.y, key);
    let d = sdEllipse(qx, qy, key.rx, key.ry);
    const [nx, ny] = unturned(direction(qx, qy, key.rx, key.ry), key);
    for (let i = 1; i < shapes.length; i++) {
      const s = shapes[i];
      if (s.alpha < 0.999) continue;
      const [px, py] = turned(x - s.x, y - s.y, s);
      const [mx, my] = unturned(direction(px, py, s.rx, s.ry), s);
      const w = Math.min(1, Math.max(0, 0.5 - 0.5 * (nx * mx + ny * my)));
      d = smin(d, sdEllipse(px, py, s.rx, s.ry), MERGE * w);
    }
    return d;
  }

  function bounds(shapes, pad) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of shapes) {
      if (s.alpha <= 0) continue;
      // A turned shape reaches no farther than its longer radius.
      const rx = s.s ? Math.max(s.rx, s.ry) : s.rx, ry = s.s ? Math.max(s.rx, s.ry) : s.ry;
      x0 = Math.min(x0, s.x - rx);
      x1 = Math.max(x1, s.x + rx);
      y0 = Math.min(y0, s.y - ry);
      y1 = Math.max(y1, s.y + ry);
    }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }

  /**
   * The band through the bubble's neck while it is melted into the key, or
   * null once it has torn free: along the line between their centers, as
   * wide as the neck at its narrowest, so it stays inside the drop. On the
   * axes it stands upright; between them it is turned.
   */
  function neck(shapes, bubble) {
    const key = shapes[0];
    const ax = bubble.x - key.x, ay = bubble.y - key.y;
    const length = Math.hypot(ax, ay);
    if (!length) return null;
    const vx = -ay / length, vy = ax / length;
    let half = Infinity;
    for (const f of [0.3, 0.5, 0.7]) {
      const px = key.x + ax * f, py = key.y + ay * f;
      for (const side of [1, -1]) {
        const inside = (t) => field(shapes, px + vx * t * side, py + vy * t * side) < 0;
        if (!inside(0)) return null;
        let lo = 0, hi = 50;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (inside(mid)) lo = mid;
          else hi = mid;
        }
        half = Math.min(half, lo);
      }
    }
    half = Math.max(0, half - 0.75);
    if (!ax) return { x: key.x - half, y: Math.min(key.y, bubble.y), w: 2 * half, h: length, angle: 0 };
    if (!ay) return { x: Math.min(key.x, bubble.x), y: key.y - half, w: length, h: 2 * half, angle: 0 };
    return { x: (key.x + bubble.x - length) / 2, y: (key.y + bubble.y) / 2 - half, w: length, h: 2 * half, angle: Math.atan2(ay, ax) };
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }

  const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
  const rgba = ([r, g, b, a]) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;

  /** Paints the drop with WebGL, in the theme's colors, over a backdrop blur shaped to it. */
  class Painter {
    constructor(canvas, blurs) {
      this.canvas = canvas;
      this.blurs = blurs;
      this.dpr = 0;
      this.scale = 1;
      this.clipKey = '';
      this.theme = null;
      try {
        this.gl = this.setup(canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false }));
      } catch (error) {
        console.warn('liquid-key: drawing flat shapes without WebGL.', error);
        this.gl = null;
      }
      if (!this.gl) this.ctx = canvas.getContext('2d');
    }

    setup(gl) {
      if (!gl) return null;
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }'));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.u = Object.fromEntries(['uPx', 'uDpr', 'uCenter', 'uShape', 'uLook', 'uGlow', 'uMerge', 'uFill', 'uFillLive',
        'uLight', 'uRim', 'uStroke', 'uStrokeLive', 'uStrokeWidth', 'uShadow']
        .map((name) => [name, gl.getUniformLocation(program, name)]));
      gl.uniform1f(this.u.uMerge, MERGE);
      gl.uniform2f(this.u.uCenter, STAGE.left, STAGE.up);
      gl.clearColor(0, 0, 0, 0);
      return gl;
    }

    /** Takes up a theme: its colors for the shader, and whether to blur behind. */
    style(theme) {
      this.theme = theme;
      this.clipKey = '';
      for (const el of Object.values(this.blurs)) el.hidden = !theme.blur;
      if (!this.gl) return;
      const { gl, u } = this;
      gl.uniform4fv(u.uFill, theme.fill);
      gl.uniform4fv(u.uFillLive, theme.fillLive);
      gl.uniform4fv(u.uLight, theme.light);
      gl.uniform1f(u.uRim, theme.rim);
      gl.uniform4fv(u.uStroke, theme.stroke);
      gl.uniform4fv(u.uStrokeLive, theme.strokeLive);
      gl.uniform1f(u.uStrokeWidth, theme.strokeWidth);
      gl.uniform1f(u.uShadow, theme.shadow);
    }

    /** Device pixels per stage pixel: the screen's, times the key's scale. */
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3) * this.scale;
      if (dpr === this.dpr) return dpr;
      this.dpr = dpr;
      this.canvas.width = Math.round(STAGE_W * dpr);
      this.canvas.height = Math.round(STAGE_H * dpr);
      if (this.gl) {
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.uniform2f(this.u.uPx, this.canvas.width, this.canvas.height);
        this.gl.uniform1f(this.u.uDpr, dpr);
      }
      return dpr;
    }

    render(shapes, glow) {
      if (!this.theme) return;
      const dpr = this.resize();
      if (this.theme.blur) this.shapeBlur(shapes);
      if (this.gl) this.paint(shapes, glow, dpr);
      else this.paintFlat(shapes, dpr);
    }

    /**
     * Shapes the backdrop blur to the drop: an ellipse per shape and a band
     * through the neck, each its own rounded element, turned with a turned
     * bubble. Chromium bounds a backdrop filter by its clip-path's box and
     * misplaces it under a positioned mask, but follows border-radius
     * everywhere. The blur is all the filter does, so where elements overlap
     * no color compounds.
     */
    shapeBlur(shapes) {
      const key = shapes.map((s) => `${s.alpha >= 0.999 ? 1 : 0},${s.x.toFixed(1)},${s.y.toFixed(1)},${s.rx.toFixed(1)},${s.ry.toFixed(1)},${s.s.toFixed(4)}`).join(';');
      if (key === this.clipKey) return;
      this.clipKey = key;
      const place = (el, rect) => {
        el.style.display = rect ? '' : 'none';
        if (!rect) return;
        const turn = rect.angle ? ` rotate(${rect.angle.toFixed(4)}rad)` : '';
        el.style.transform = `translate(${(STAGE.left + rect.x).toFixed(2)}px, ${(STAGE.up + rect.y).toFixed(2)}px)${turn}`;
        el.style.width = `${rect.w.toFixed(2)}px`;
        el.style.height = `${rect.h.toFixed(2)}px`;
      };
      shapes.forEach((s, i) => {
        // Inset half a pixel so the blur's edge stays under the rim.
        place(this.blurs[SHAPES[i]], s.alpha >= 0.999
          ? { x: s.x - s.rx + 0.5, y: s.y - s.ry + 0.5, w: 2 * s.rx - 1, h: 2 * s.ry - 1, angle: Math.atan2(s.s, s.c) }
          : null);
      });
      const bubble = shapes[1];
      place(this.blurs.neck, bubble.alpha >= 0.999 ? neck(shapes, bubble) : null);
    }

    paint(shapes, glow, dpr) {
      const { gl, u, canvas } = this;
      const shape = new Float32Array(8), look = new Float32Array(8);
      shapes.forEach((s, i) => {
        shape.set([s.x, s.y, s.rx, s.ry], i * 4);
        look.set([s.tint, s.alpha, s.c, s.s], i * 4);
      });
      gl.uniform4fv(u.uShape, shape);
      gl.uniform4fv(u.uLook, look);
      gl.uniform3f(u.uGlow, glow.x, glow.y, glow.strength);
      gl.disable(gl.SCISSOR_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Only the pixels the drop, its line, and its shadow can reach.
      const box = bounds(shapes, 20 + this.theme.strokeWidth / 2);
      const x0 = Math.max(0, Math.floor((STAGE.left + box.x0) * dpr));
      const x1 = Math.min(canvas.width, Math.ceil((STAGE.left + box.x1) * dpr));
      const y0 = Math.max(0, Math.floor((STAGE.up + box.y0) * dpr));
      const y1 = Math.min(canvas.height, Math.ceil((STAGE.up + box.y1) * dpr));
      if (x1 <= x0 || y1 <= y0) return;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x0, canvas.height - y1, x1 - x0, y1 - y0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /** Without WebGL: each shape flat in the theme's colors, the bubble behind the key, no neck. */
    paintFlat(shapes, dpr) {
      const { ctx, theme } = this;
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, STAGE.left * dpr, STAGE.up * dpr);
      const lined = theme.strokeWidth > 0;
      ctx.lineWidth = lined ? theme.strokeWidth : 1;
      for (const s of [...shapes.slice(1), shapes[0]]) {
        if (s.alpha <= 0) continue;
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = rgba(mix(theme.fill, theme.fillLive, s.tint));
        ctx.strokeStyle = rgba(lined ? mix(theme.stroke, theme.strokeLive, s.tint)
          : [...theme.light.slice(0, 3), 0.24 * theme.rim * theme.light[3]]);
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, s.rx, s.ry, Math.atan2(s.s, s.c), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  // MARK: The element

  const STYLE = `
:host {
  display: inline-block;
  position: relative;
  flex: none;
  width: ${SIZE}px;
  height: ${SIZE}px;
  border-radius: 50%;
  outline: none;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  /* Outline, the default theme: ink on paper, the drop's edge alone. */
  --liquid-key-fill: #fff;
  --liquid-key-fill-live: #1c1c1e;
  --liquid-key-light: rgba(28, 28, 30, 0.6);
  --liquid-key-rim: 0;
  --liquid-key-stroke: #1c1c1e;
  --liquid-key-stroke-live: #1c1c1e;
  --liquid-key-stroke-width: 1.5;
  --liquid-key-shadow: 0;
  --liquid-key-backdrop: none;
  --liquid-key-ink: #1c1c1e;
  --liquid-key-ink-live: #fff;
  --liquid-key-hint: rgba(60, 60, 67, 0.6);
  --liquid-key-focus: rgba(28, 28, 30, 0.45);
  --liquid-key-geometry: rgb(0, 113, 227);
  color: var(--liquid-key-ink);
}
/* Glass: a clear drop over a blur of what's behind it, lit along its rim. */
:host([theme="glass"]) {
  --liquid-key-fill: rgba(255, 255, 255, 0.07);
  --liquid-key-fill-live: rgba(56.1, 56.1, 56.1, 0.88);
  --liquid-key-light: #fff;
  --liquid-key-rim: 1;
  --liquid-key-stroke: transparent;
  --liquid-key-stroke-live: transparent;
  --liquid-key-stroke-width: 0;
  --liquid-key-shadow: 0.2;
  --liquid-key-backdrop: blur(4px);
  --liquid-key-ink: #fff;
  --liquid-key-ink-live: #fff;
  --liquid-key-hint: rgba(235, 235, 245, 0.6);
  --liquid-key-focus: rgba(255, 255, 255, 0.65);
  --liquid-key-geometry: rgb(100, 210, 255);
}
/* Solid: opaque and flat; live, it turns over. */
:host([theme="solid"]) {
  --liquid-key-fill: #3a3a3c;
  --liquid-key-fill-live: #f2f2f7;
  --liquid-key-light: rgba(255, 255, 255, 0.7);
  --liquid-key-rim: 0;
  --liquid-key-stroke: transparent;
  --liquid-key-stroke-live: transparent;
  --liquid-key-stroke-width: 0;
  --liquid-key-shadow: 0.35;
  --liquid-key-backdrop: none;
  --liquid-key-ink: #fff;
  --liquid-key-ink-live: #1c1c1e;
  --liquid-key-hint: rgba(235, 235, 245, 0.6);
  --liquid-key-focus: rgba(255, 255, 255, 0.65);
  --liquid-key-geometry: rgb(100, 210, 255);
}
:host([hidden]) { display: none; }
:host([aria-disabled="true"]) { cursor: default; }
.stage {
  position: absolute;
  left: ${R - STAGE.left}px;
  top: ${R - STAGE.up}px;
  width: ${STAGE_W}px;
  height: ${STAGE_H}px;
  pointer-events: none;
}
.aura {
  position: absolute;
  left: ${STAGE.left - 58}px;
  top: ${STAGE.up - 58}px;
  width: 116px;
  height: 116px;
  border-radius: 50%;
}
.blur {
  position: absolute;
  left: 0;
  top: 0;
  border-radius: 50%;
  -webkit-backdrop-filter: var(--liquid-key-backdrop);
  backdrop-filter: var(--liquid-key-backdrop);
}
.blur.neck { border-radius: 0; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.origin { position: absolute; left: ${STAGE.left}px; top: ${STAGE.up}px; width: 0; height: 0; }
.origin > * { position: absolute; left: 0; top: 0; }
svg { display: block; width: 100%; height: 100%; overflow: visible; }
.stroke { fill: none; stroke: currentColor; stroke-width: var(--weight, 2.2); stroke-linecap: round; stroke-linejoin: round; }
.key, .bubble {
  display: grid;
  place-items: center;
  width: ${SIZE}px;
  height: ${SIZE}px;
  transform: translate(-50%, -50%);
}
.symbols { position: relative; width: 26px; height: 26px; transition: transform 0.15s ease-out; }
:host([aria-disabled="true"]) .symbols { opacity: 0.4; }
.sym {
  position: absolute;
  inset: 0;
  opacity: 0;
  transform: scale(0.4);
  filter: blur(3px);
  transition: opacity 0.18s ease, transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.18s ease, color 0.2s ease;
}
.sym.on { opacity: 1; transform: none; filter: none; }
.key.live .sym { color: var(--liquid-key-ink-live); }
.key.bold { --weight: 2.7; }
.sym.vc line { opacity: 0.45; animation: variable 1.15s linear infinite; animation-delay: calc(var(--i) * 0.1s); }
@keyframes variable { 0% { opacity: 0.45; } 9% { opacity: 1; } 30%, 100% { opacity: 0.45; } }
.sym.pulse svg { animation: pulse 1.3s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.edge {
  position: absolute;
  width: 14px;
  height: 14px;
  color: var(--liquid-key-ink-live);
  opacity: 0;
  --weight: 2.9;
  transition: opacity 0.15s ease-out, transform 0.15s ease-out;
}
/* Each direction's mark sits at the key's edge, slid in from the middle. */
.edge { transform: var(--hidden); }
.edge.on { opacity: 1; transform: none; }
.bubble .glyph { grid-area: 1 / 1; width: 26px; height: 26px; color: var(--liquid-key-hint); opacity: 0; --weight: 2.7; transition: opacity 0.12s ease, color 0.2s ease; }
.bubble .glyph:not([data-name="up"]) { width: 24px; height: 24px; }
.bubble.shown .glyph.on { opacity: 1; }
.bubble.armed .glyph { color: var(--liquid-key-ink-live); }
.lock {
  width: 12px;
  height: 12px;
  color: var(--liquid-key-ink);
  opacity: 0;
  --weight: 2.6;
  transform: translate(17.5px, -16.5px) translate(-50%, -50%);
  transition: opacity 0.2s ease, color 0.2s ease;
}
.lock.live { color: var(--liquid-key-ink-live); }
.lock.on { opacity: 1; }
.hint { width: 20px; height: 20px; color: var(--liquid-key-hint); opacity: 0; transition: opacity 0.15s ease-out; }
.hint.on { opacity: 1; }
.focus {
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--liquid-key-focus);
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}
:host(:focus-visible) .focus { opacity: 1; }
.geometry {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  display: none;
  color: var(--liquid-key-geometry);
  font: 600 9px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  letter-spacing: 0.02em;
}
:host([geometry]) .geometry { display: block; }
.geometry .ring, .geometry .ray, .geometry .slop, .geometry .pull, .geometry .timer, .geometry .window { fill: none; stroke: currentColor; }
.geometry .ring { stroke-width: 1; stroke-dasharray: 3 4; opacity: 0.55; transition: opacity 0.15s ease; }
.geometry .pressed .ring { opacity: 0.85; }
.geometry .ring.on { stroke-width: 2; stroke-dasharray: none; opacity: 1; }
.geometry .ray { stroke-width: 1; stroke-dasharray: 1 3; opacity: 0.45; }
.geometry .label { fill: currentColor; text-anchor: middle; opacity: 0.85; }
.geometry .anchor { fill: currentColor; }
.geometry .slop { stroke-width: 1; stroke-dasharray: 2 2; }
.geometry .pull { stroke-width: 1.25; opacity: 0.8; }
.geometry .finger { fill: currentColor; fill-opacity: 0.2; stroke: currentColor; stroke-width: 1.25; }
.geometry .timer, .geometry .window { stroke-width: 1.5; stroke-dasharray: 1; stroke-dashoffset: 1; stroke-linecap: round; }
.geometry .timer.held { stroke-width: 2.5; }
.geometry .window { opacity: 0.6; }
`;

  // The geometry overlay, drawn in the stage's coordinates: the radii and
  // arcs around where pulls are measured from, the slop around touch-down,
  // the pull to the finger, and rings that time the hold and the double tap.
  // The rays between directions and the labels follow the key's pulls and
  // size, so they are drawn in later.
  const arc = (r) => `M${-r} 0A${r} ${r} 0 0 1 ${r} 0`;
  const LABEL = -0.85 * Math.PI;
  const label = (name, r) => `<text class="label ${name}" x="${((r + 9) * Math.cos(LABEL)).toFixed(1)}" y="${((r + 9) * Math.sin(LABEL)).toFixed(1)}"></text>`;
  const ring = (name, r) => `<circle class="${name}" cx="${STAGE.left}" cy="${STAGE.up}" r="${r}" pathLength="1" transform="rotate(-90 ${STAGE.left} ${STAGE.up})"/>`;
  const GEOMETRY = `<svg class="geometry" viewBox="0 0 ${STAGE_W} ${STAGE_H}" aria-hidden="true">
  ${ring('timer', R + 8)}
  ${ring('window', R + 12)}
  <g class="around">
    <path class="ray"/>
    <path class="ring" d="${arc(CLEAR)}"/>
    <path class="ring arm" d="${arc(ARM)}"/>
    ${label('clear', CLEAR)}
    ${label('reach', ARM)}
    <circle class="anchor" r="2.5"/>
  </g>
  <g class="down"><circle class="slop"/><text class="label slack"/></g>
  <line class="pull"/>
  <circle class="finger" r="6"/>
</svg>`;

  // Each direction's mark at the key's edge, slid in from the middle when shown.
  const edge = (name) => {
    const [x, y] = toward(name, 15), [hx, hy] = toward(name, -6);
    return `<div class="edge" data-name="${name}" style="left: ${R - 7 + x}px; top: ${R - 7 + y}px; --hidden: translate(${hx}px, ${hy}px)"></div>`;
  };
  // Each direction's hint, a bare symbol where its pull arms.
  const hint = (name) => {
    const [x, y] = toward(name, ARM);
    return `<div class="hint" data-name="${name}" style="transform: translate(${x}px, ${y}px) translate(-50%, -50%)"></div>`;
  };

  const TEMPLATE = `<style>${STYLE}</style><style class="sizing"></style>
<div class="stage" aria-hidden="true">
  <div class="aura"></div>
  <div class="blur" data-name="bubble"></div><div class="blur neck" data-name="neck"></div>
  <div class="blur" data-name="key"></div>
  <canvas></canvas>
  <div class="origin">
    <div class="bubble">${DIRECTIONS.map((name) => `<div class="glyph" data-name="${name}"></div>`).join('')}</div>
    <div class="key">
      <div class="symbols"></div>
      ${DIRECTIONS.map(edge).join('')}
    </div>
    <div class="lock">${SYMBOLS.lock}</div>
    ${DIRECTIONS.map(hint).join('')}
  </div>
  ${GEOMETRY}
</div>
<div class="focus"></div>`;

  /** Pulls by direction, each with its action, symbol, and label. */
  function copyPulls(pulls) {
    const copy = {};
    for (const [direction, pull] of Object.entries(pulls ?? {})) {
      if (!pull) continue;
      if (!DIRECTIONS.includes(direction)) {
        console.warn(`liquid-key: there is no ${direction} pull; pulls go ${DIRECTIONS.join(', ')}.`);
        continue;
      }
      copy[direction] = { action: String(pull.action ?? direction), symbol: pull.symbol ?? '', label: pull.label ?? '' };
    }
    return copy;
  }

  class LiquidKey extends HTMLElement {
    static get observedAttributes() {
      return ['disabled', 'live', 'armed', 'aura', 'symbol', 'live-symbol', 'armed-symbol', 'label', 'locked-label',
        'theme', 'geometry', 'size', 'class', 'style'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = TEMPLATE;
      const named = (selector) => Object.fromEntries([...root.querySelectorAll(selector)].map((el) => [el.dataset.name, el]));
      this.el = {
        stage: root.querySelector('.stage'),
        sizing: root.querySelector('.sizing'),
        aura: root.querySelector('.aura'),
        blurs: named('.blur'),
        canvas: root.querySelector('canvas'),
        key: root.querySelector('.key'),
        symbols: root.querySelector('.symbols'),
        lock: root.querySelector('.lock'),
        edge: named('.edge'),
        bubble: root.querySelector('.bubble'),
        glyph: named('.glyph'),
        hint: named('.hint'),
        geometry: Object.fromEntries(['timer', 'window', 'around', 'ray', 'arm', 'clear', 'reach', 'down', 'slop', 'slack', 'pull', 'finger']
          .map((name) => [name, root.querySelector(`.geometry .${name}`)])),
      };
      // The key's face: an element per symbol it has shown, so changes cross-fade.
      this.faces = new Map();
      // The markup each direction's bubble, edge, and hint draw.
      this.drawn = {};
      this._pulls = copyPulls(PULLS);
      this.arcs = arcsOf(this._pulls);
      // Screen pixels per stage pixel, from the size attribute.
      this.scale = 0;
      // The pull the arrow keys have reached for.
      this.keyboardPull = null;
      this.s = {
        // The direction pulled free: letting go performs it.
        aim: null,
        // What this press ends: 'lock' when the key was latched, 'armed' when
        // a one-shot waited on it.
        ending: null,
        pressed: false,
        // The press lasted long enough to be a hold.
        held: false,
        // This press came soon enough after a tap to make a double tap.
        second: false,
        // When the last tap was released, for the next press to pair with.
        lastTap: null,
        // Where pulls are measured from: touch-down, or the finger at the hold.
        anchor: { x: 0, y: 0 },
        // The direction whose action the bubble would perform.
        target: null,
        // The direction whose symbol the bubble shows, kept as it goes back in.
        glyph: null,
        // The angle the bubble is pulled out at, and how far.
        angle: AXIS.up,
        pull: 0,
        // The armed up bubble is flying off after a release that performs it.
        launched: false,
        // The press moved before it became a hold.
        dropped: false,
        // The slid press can still pull up, for the up action alone.
        bare: false,
        // The finger's latest travel from touch-down.
        travel: { x: 0, y: 0 },
        // A double tap latched the key; the next press ends it.
        locked: false,
      };
      this.sp = {
        key: new Spring(0, 0.0005),
        press: new Spring(1, 0.0005),
        tint: new Spring(0, 0.002),
        glow: new Spring(0, 0.002),
        bubble: {
          angle: new Spring(AXIS.up, 0.0005),
          travel: new Spring(0, 0.05),
          tension: new Spring(0, 0.0005),
          tint: new Spring(0, 0.002),
        },
      };
      this.springs = [this.sp.key, this.sp.press, this.sp.tint, this.sp.glow, ...Object.values(this.sp.bubble)];
      this.prev = {};
      this.pointer = null;
      this.keyboard = null;
      this.touch = { x: 0, y: 0 };
      this.launch = null;
      this.pendingTap = null;
      this.auraFade = { color: [1, 1, 1, 0], from: null, to: null, start: 0 };
      this.raf = 0;
      this.lastFrame = 0;
      this.themeKey = '';
      this.tick = this.tick.bind(this);
      this.onScheme = () => this.readTheme();

      this.addEventListener('pointerdown', (event) => this.pointerDown(event));
      this.addEventListener('pointermove', (event) => this.pointerMove(event));
      this.addEventListener('pointerup', (event) => this.pointerUp(event, false));
      this.addEventListener('pointercancel', (event) => this.pointerUp(event, true));
      this.addEventListener('lostpointercapture', (event) => this.pointerUp(event, true));
      this.addEventListener('keydown', (event) => this.keyDown(event));
      this.addEventListener('keyup', (event) => this.keyUp(event));
      this.addEventListener('blur', () => this.keyboardRelease(true));
      this.addEventListener('contextmenu', (event) => event.preventDefault());
    }

    connectedCallback() {
      // Properties set before the element was defined shadow its accessors.
      for (const name of PROPERTIES) {
        if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
        const value = this[name];
        delete this[name];
        this[name] = value;
      }
      connected.add(this);
      if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
      this.setAttribute('role', 'button');
      if (!this.renderer) this.renderer = new Painter(this.el.canvas, this.el.blurs);
      this.applySize();
      this.drawArcs();
      this.themeKey = '';
      this.readTheme();
      this.scheme = matchMedia('(prefers-color-scheme: dark)');
      this.scheme.addEventListener('change', this.onScheme);
      this.sync();
    }

    disconnectedCallback() {
      connected.delete(this);
      if (this.pointer != null || this.keyboard) {
        this.pointer = this.keyboard = null;
        this.ended(true);
      }
      clearTimeout(this.pendingTap?.timer);
      this.pendingTap = null;
      this.scheme?.removeEventListener('change', this.onScheme);
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.lastFrame = 0;
    }

    attributeChangedCallback(name, previous, value) {
      if (previous === value || !this.isConnected) return;
      if (name === 'disabled') this.cancelPress();
      if (name === 'size') this.applySize();
      if (name === 'theme' || name === 'class' || name === 'style') this.readTheme();
      this.scheduleSync();
    }

    get pulls() {
      return copyPulls(this._pulls);
    }

    set pulls(pulls) {
      this._pulls = copyPulls(pulls);
      this.arcs = arcsOf(this._pulls);
      // A press under way was pulling out what was there.
      this.cancelPress();
      if (this.isConnected) {
        this.drawArcs();
        this.scheduleSync();
      }
    }

    /**
     * Draws the key at its size by scaling the whole stage about the key's
     * center, so the bubble tears where the circles part at any size. What
     * belongs to the finger instead, the slop, the switch margin, and the
     * jitter that shows no bubble, stays in screen pixels.
     */
    applySize() {
      const size = this.size, scale = size / SIZE;
      if (scale === this.scale) return;
      // A press under way was measured at the old size.
      this.cancelPress();
      this.scale = scale;
      this.el.sizing.textContent = scale === 1 ? '' : `
:host { width: ${size}px; height: ${size}px; }
.stage { left: ${size / 2 - STAGE.left}px; top: ${size / 2 - STAGE.up}px; transform: scale(${scale}); transform-origin: ${STAGE.left}px ${STAGE.up}px; }
.geometry { font-size: ${9 / scale}px; }`;
      if (this.renderer) this.renderer.scale = scale;
      // The overlay's numbers are what the finger travels.
      const g = this.el.geometry;
      g.clear.textContent = `clear ${Math.round(CLEAR * scale)}`;
      g.reach.textContent = `arm ${Math.round(ARM * scale)}`;
      g.slop.setAttribute('r', SLOP / scale);
      g.slack.setAttribute('y', -SLOP / scale - 5);
      g.slack.textContent = `slop ${SLOP}`;
      this.frame();
    }

    /**
     * The overlay's rays, between the directions the key can be pulled in,
     * and its labels, on the side the pulls lean toward, where a key at a
     * screen's edge has its room.
     */
    drawArcs() {
      const g = this.el.geometry;
      const edges = [...new Set(Object.values(this.arcs).flat())];
      g.ray.setAttribute('d', edges.map((angle) => {
        const [x0, y0] = heading(angle).map((v) => v * 16), [x1, y1] = heading(angle).map((v) => v * (ARM + 22));
        return `M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`;
      }).join(''));
      const names = Object.keys(this.arcs);
      const lean = names.reduce((sum, name) => sum + AXIS[name], 0) / (names.length || 1);
      const angle = lean > AXIS.up ? -Math.PI - LABEL : LABEL;
      for (const [label, r] of [[g.clear, CLEAR], [g.reach, ARM]]) {
        label.setAttribute('x', ((r + 9) * Math.cos(angle)).toFixed(1));
        label.setAttribute('y', ((r + 9) * Math.sin(angle)).toFixed(1));
      }
    }

    get locked() {
      return this.s.locked;
    }

    set locked(locked) {
      if (!!locked === this.s.locked) return;
      this.s.locked = !!locked;
      if (this.isConnected) this.scheduleSync();
    }

    /** From touch-down, or while the key is latched. */
    get active() {
      return this.s.pressed || this.s.locked;
    }

    /** Ends a press under way as cancelled. */
    cancelPress() {
      if (this.pointer == null && !this.keyboard) return;
      this.pointer = this.keyboard = null;
      this.ended(true);
      this.sync();
    }

    /** Reads the theme's custom properties, and repaints when they changed. */
    readTheme() {
      if (!this.renderer) return;
      const style = getComputedStyle(this);
      const values = THEME.map((name) => style.getPropertyValue(name).trim());
      const key = values.join('|');
      if (key === this.themeKey) return;
      const [fill, fillLive, light, rim, stroke, strokeLive, strokeWidth, shadow, backdrop] = values;
      const clear = [0, 0, 0, 0];
      const number = (text, fallback) => (Number.isFinite(parseFloat(text)) ? parseFloat(text) : fallback);
      this.renderer.style({
        fill: parseColor(fill) ?? clear,
        fillLive: parseColor(fillLive) ?? clear,
        light: parseColor(light) ?? [1, 1, 1, 1],
        rim: number(rim, 0),
        stroke: parseColor(stroke) ?? clear,
        strokeLive: parseColor(strokeLive) ?? clear,
        strokeWidth: Math.max(0, number(strokeWidth, 0)),
        shadow: number(shadow, 0),
        blur: !!backdrop && backdrop !== 'none',
      });
      this.themeKey = key;
      this.frame();
    }

    // MARK: Input

    pointerDown(event) {
      if (this.pointer != null || this.keyboard || this.disabled) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const rect = this.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      // The key answers inside its circle only.
      if (Math.hypot(event.clientX - cx, event.clientY - cy) > rect.width / 2) return;
      event.preventDefault();
      this.pointer = event.pointerId;
      this.origin = { x: event.clientX, y: event.clientY };
      this.center = { x: cx, y: cy };
      try {
        this.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers cannot be captured.
      }
      // The finger in the key's own pixels, which its size scales.
      this.touch = { x: (event.clientX - cx) / this.scale, y: (event.clientY - cy) / this.scale };
      this.downAt = { ...this.touch };
      this.began();
      this.moved({ x: 0, y: 0 });
      this.sync();
    }

    pointerMove(event) {
      if (event.pointerId !== this.pointer) return;
      const scale = this.scale;
      this.touch = { x: (event.clientX - this.center.x) / scale, y: (event.clientY - this.center.y) / scale };
      this.moved({ x: (event.clientX - this.origin.x) / scale, y: (event.clientY - this.origin.y) / scale });
      this.sync();
    }

    pointerUp(event, cancelled) {
      if (event.pointerId !== this.pointer) return;
      this.pointer = null;
      this.ended(cancelled);
      this.sync();
    }

    keyDown(event) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (event.repeat || this.keyboard || this.pointer != null || this.disabled) return;
        this.keyboard = { x: 0, y: 0 };
        this.touch = { x: 0, y: 0 };
        this.downAt = { x: 0, y: 0 };
        this.began();
        this.moved(this.keyboard);
        this.sync();
      } else if (this.keyboard && ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        this.keyboardPull = this.arrowPull(event.key);
        const [x, y] = this.keyboardPull ? toward(this.keyboardPull, ARM + 12) : [0, 0];
        this.keyboard = { x: this.s.anchor.x + x, y: this.s.anchor.y + y };
        this.moved(this.keyboard);
        this.sync();
      } else if (this.keyboard && event.key === 'Escape') {
        event.preventDefault();
        this.keyboardRelease(true);
      }
    }

    /**
     * The pull an arrow key reaches for: ArrowUp the one nearest straight
     * up, ArrowLeft and ArrowRight the next one round from the last, or
     * the one nearest that side, and ArrowDown none, back to the middle.
     */
    arrowPull(key) {
      const names = Object.keys(this.arcs);
      if (key === 'ArrowDown' || !names.length) return null;
      const nearest = (angle) => names.reduce((best, name) => (Math.abs(AXIS[name] - angle) < Math.abs(AXIS[best] - angle) ? name : best));
      if (key === 'ArrowUp') return nearest(AXIS.up);
      const step = key === 'ArrowLeft' ? -1 : 1;
      const at = names.indexOf(this.keyboardPull);
      if (at < 0) return nearest(step < 0 ? AXIS.left : AXIS.right);
      return names[Math.min(names.length - 1, Math.max(0, at + step))];
    }

    keyUp(event) {
      if ((event.key === ' ' || event.key === 'Enter') && this.keyboard) {
        event.preventDefault();
        this.keyboardRelease(false);
      }
    }

    keyboardRelease(cancelled) {
      if (!this.keyboard) return;
      this.keyboard = null;
      this.ended(cancelled);
      this.sync();
    }

    // MARK: Gesture

    began() {
      const s = this.s;
      s.second = s.lastTap != null && performance.now() - s.lastTap <= this.doubleTapDelay;
      s.lastTap = null;
      // A tap still waiting on a second press was a single tap after all.
      this.settleTap(s.second);
      s.pressed = true;
      s.held = false;
      s.anchor = { x: 0, y: 0 };
      s.target = null;
      s.pull = 0;
      s.launched = false;
      this.finishLaunch();
      s.dropped = false;
      s.bare = false;
      s.travel = { x: 0, y: 0 };
      s.ending = s.locked ? 'lock' : this.live && this.armed ? 'armed' : null;
      s.aim = null;
      s.locked = false;
      this.keyboardPull = null;
      this.readTheme();
      this.emit('press');
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => {
        if (!s.pressed || s.held) return;
        this.hold();
        this.sync();
      }, this.holdDelay);
    }

    hold() {
      const s = this.s;
      s.held = true;
      // A press ending a latch has pulled from touch-down all along; any
      // other pulls from where the finger is now.
      if (s.ending !== 'lock') s.anchor = { ...s.travel };
      this.emit('hold');
    }

    aimAt(direction) {
      const s = this.s;
      if (direction === s.aim) return;
      const previous = this.actionOf(s.aim);
      s.aim = direction;
      this.emit('aim', { action: this.actionOf(direction), direction, previous });
    }

    /**
     * A move before the hold: only a hold in the middle is a hold, so the
     * press is neither a tap nor a hold now, and goes on pulling. Up after a
     * slide is the up action alone, which a press ending something does not
     * offer; it pulls only sideways.
     */
    drop() {
      const s = this.s;
      clearTimeout(this.holdTimer);
      s.dropped = true;
      s.bare = !s.ending;
      this.emit('slide');
    }

    /**
     * The directions are targets, not axes: whichever leads names the
     * bubble's action, and turning toward another hands the pull over, armed
     * or not. The bubble itself follows the finger around the key's top
     * half, so it swings from one direction to the next rather than going
     * back through the middle. It arms where it parts from the key and
     * clears once pushed back into the merge. Upward travel is negative.
     */
    moved(translation) {
      const s = this.s;
      if (!s.pressed) return;
      s.travel = translation;
      // The slop and the switch margin are the finger's, in screen pixels.
      const scale = this.scale;
      if (!s.held && s.ending !== 'lock' && !s.dropped && Math.hypot(translation.x, translation.y) * scale > SLOP) {
        this.drop();
        if (!s.pressed) return;
      }
      const open = s.held || s.ending === 'lock';
      const dx = translation.x - s.anchor.x, dy = translation.y - s.anchor.y;
      // Each direction's reach is the finger's travel along its axis.
      const reach = [];
      for (const name of DIRECTIONS) {
        if (!this._pulls[name] || !(open || (name === 'up' ? s.bare : s.dropped))) continue;
        const [ux, uy] = heading(AXIS[name]);
        reach.push([name, dx * ux + dy * uy]);
      }
      if (!reach.length) return;
      const of = (pull) => reach.find(([name]) => name === pull)?.[1];
      let next = reach.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
      if (s.target != null) {
        const current = of(s.target), lead = of(next);
        if (current !== undefined && lead !== undefined && (lead - current) * scale < SWITCH) next = s.target;
      }
      if (next !== s.target) {
        this.aimAt(null);
        if (!s.pressed) return;
        s.target = next;
      }
      // How far the bubble is pulled is the finger's reach along its angle.
      s.angle = this.pullAngle(dx, dy, next, reach.map(([name]) => name));
      s.pull = Math.max(0, dx * Math.cos(s.angle) + dy * Math.sin(s.angle));
      const armed = s.aim != null;
      if (!armed && s.pull >= ARM) this.aimAt(next);
      else if (armed && s.pull < CLEAR) this.aimAt(null);
    }

    /**
     * The finger's angle from where pulls are measured, kept to the arcs of
     * the directions open to this press. Below the key's middle, a pull
     * keeps to its direction's axis.
     */
    pullAngle(dx, dy, target, open) {
      if (dy >= 0) return AXIS[target];
      const angle = Math.atan2(dy, dx);
      let nearest = AXIS[target], distance = Infinity;
      for (const [from, to] of open.map((name) => this.arcs[name])) {
        if (angle >= from && angle <= to) return angle;
        for (const edge of [from, to]) {
          if (Math.abs(angle - edge) < distance) {
            nearest = edge;
            distance = Math.abs(angle - edge);
          }
        }
      }
      return nearest;
    }

    ended(cancelled) {
      const s = this.s;
      clearTimeout(this.holdTimer);
      s.pressed = false;
      const aim = s.aim;
      const detail = this.snapshot();
      s.aim = null;
      s.target = null;
      if (aim === 'up' && !cancelled) {
        s.launched = true;
        this.launch = { start: performance.now(), t: 0 };
      } else {
        s.pull = 0;
      }
      let type;
      if (cancelled) {
        type = 'presscancel';
      } else if (aim) {
        type = 'action';
        Object.assign(detail, { action: this.actionOf(aim), direction: aim });
      } else if (s.held || s.dropped) {
        type = 'release';
      } else if (s.second) {
        type = 'doubletap';
        s.locked = !this.noLatch;
        detail.locked = s.locked;
      } else {
        type = 'tap';
        s.lastTap = performance.now();
      }
      s.held = false;
      s.dropped = false;
      s.bare = false;
      this.lastEnd = type;
      this.dispatch(type, detail);
      if (type === 'tap') this.awaitTap(detail);
    }

    /** After a tap, a single tap once no second press can make it a double. */
    awaitTap(detail) {
      const timer = setTimeout(() => {
        this.pendingTap = null;
        this.dispatch('singletap', detail);
      }, this.doubleTapDelay);
      this.pendingTap = { detail, timer };
    }

    settleTap(second) {
      const pending = this.pendingTap;
      if (!pending) return;
      this.pendingTap = null;
      clearTimeout(pending.timer);
      if (!second) this.dispatch('singletap', pending.detail);
    }

    snapshot() {
      const s = this.s;
      return { ending: s.ending, held: s.held, slid: s.dropped, aim: this.actionOf(s.aim) };
    }

    actionOf(direction) {
      return direction ? this._pulls[direction]?.action ?? direction : null;
    }

    emit(type, detail) {
      this.dispatch(type, { ...this.snapshot(), ...detail });
    }

    dispatch(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }

    // MARK: State to presentation

    scheduleSync() {
      if (this.syncQueued) return;
      this.syncQueued = true;
      queueMicrotask(() => {
        this.syncQueued = false;
        if (this.isConnected) this.sync();
      });
    }

    /** The element showing this markup on the key's face, made the first time it is needed. */
    face(markup) {
      if (!markup) return null;
      let el = this.faces.get(markup);
      if (el) return el;
      el = document.createElement('div');
      el.className = 'sym';
      el.innerHTML = markup;
      this.el.symbols.append(el);
      this.faces.set(markup, el);
      // Styled once hidden, so its first showing fades in like the rest.
      if (this.prev.live !== undefined) getComputedStyle(el).opacity;
      return el;
    }

    sync() {
      const s = this.s, p = this.prev, sp = this.sp;
      const live = this.live;
      if (p.live && !live) {
        s.locked = false;
        s.lastTap = null;
      }
      const up = s.aim === 'up';
      // The direction the bubble shows, once it shows; it keeps that
      // direction's symbol as it goes back in.
      const revealed = s.pull * this.scale > REVEAL;
      const seen = revealed ? s.target : null;
      if (s.target) s.glyph = s.target;
      if (!this.noHaptics) {
        if (live && !p.live && s.pressed) LiquidKey.haptic('medium');
        if (up && !p.up) LiquidKey.haptic('heavy');
        if (s.locked && !p.locked) LiquidKey.haptic('success');
        if (s.aim && !up && s.aim !== p.aim) LiquidKey.haptic('selection');
        // Turning from one direction to another ticks, unless arming the
        // new one already buzzed.
        else if (seen && p.seen && seen !== p.seen && !(up && !p.up)) LiquidKey.haptic('selection');
      }
      const active = this.active;
      const armedGlyph = live && !s.pressed && !s.locked && this.armed;
      const motion = s.pressed ? INTERACTIVE : SETTLE;
      const pulled = s.aim;

      // The bubble trails the finger, stretched toward it, until it tears
      // free. It leans toward its direction's axis, halfway to the finger,
      // and swings across when another direction takes over. One still in
      // the key turns at once.
      const bubble = sp.bubble;
      const tension = pulled ? 0 : Math.min(s.pull / ARM, 1);
      const lean = s.glyph ? AXIS[s.glyph] + (s.angle - AXIS[s.glyph]) * (1 - MAGNET) : s.angle;
      if (!this.launch) {
        if (bubble.travel.value <= 0.5) bubble.angle.set(lean);
        else bubble.angle.to(lean, motion);
        bubble.travel.to(pulled ? ARM + Math.max(0, s.pull - ARM) * 0.3 : s.pull * (1 - DRAG * tension), motion);
        bubble.tension.to(tension, motion);
        bubble.tint.to(pulled ? 1 : 0, FADE);
      }
      // The key gives a little toward a pull upward, and wobbles back when
      // it tears free.
      const keyTension = this.launch ? 0 : tension * Math.max(0, -heading(lean)[1]);
      const tore = !!pulled !== !!p.pulled;
      if (up !== !!p.up || (tore && (keyTension || sp.key.target))) sp.key.to(keyTension, TEAR);
      else if (keyTension !== sp.key.target) {
        if (s.pressed) sp.key.set(keyTension);
        else sp.key.to(keyTension, SETTLE);
      }
      sp.tint.to(live ? 1 : 0, FADE);
      sp.press.to(s.pressed ? 1.06 : 1, PRESS);
      sp.glow.to(s.pressed ? 1 : 0, FADE);

      // The symbols each direction draws.
      for (const name of DIRECTIONS) {
        const markup = symbolMarkup(this._pulls[name]?.symbol);
        if (this.drawn[name] === markup) continue;
        this.drawn[name] = markup;
        this.el.glyph[name].innerHTML = markup;
        this.el.edge[name].innerHTML = markup;
        this.el.hint[name].innerHTML = markup;
      }
      // The key's symbol: the armed symbol while a one-shot waits, the live
      // symbol while live, an armed pull's symbol alone when nothing is
      // live, and its own symbol otherwise.
      const symbolOnly = pulled != null && !live;
      const role = armedGlyph ? 'armed' : live ? 'live' : symbolOnly ? 'pull' : 'idle';
      const shown = this.face(symbolMarkup(role === 'armed' ? this.armedSymbol : role === 'live' ? this.liveSymbol
        : role === 'pull' ? this._pulls[pulled]?.symbol : this.symbol));
      for (const el of this.faces.values()) {
        el.classList.toggle('on', el === shown);
        el.classList.toggle('vc', el === shown && role === 'live');
        el.classList.toggle('pulse', el === shown && role === 'armed');
      }
      this.el.key.classList.toggle('live', live);
      this.el.key.classList.toggle('bold', symbolOnly);
      const [nx, ny] = live && pulled ? toward(pulled, -6) : [0, 0];
      this.el.symbols.style.transform = `translate(${nx}px, ${ny}px)`;
      for (const [name, el] of Object.entries(this.el.edge)) el.classList.toggle('on', live && pulled === name);
      this.el.lock.classList.toggle('on', s.locked);
      this.el.lock.classList.toggle('live', live);
      // Bare symbols where each direction arms; only the one being pulled gives way.
      for (const [name, el] of Object.entries(this.el.hint)) {
        el.classList.toggle('on', active && seen !== name && !!this._pulls[name]);
      }
      // The bubble shows its direction's symbol, and keeps it as it goes back in.
      for (const [name, el] of Object.entries(this.el.glyph)) el.classList.toggle('on', name === s.glyph);
      this.el.bubble.classList.toggle('shown', revealed);
      this.el.bubble.classList.toggle('armed', !!pulled || !!this.launch);

      const aura = this.aura;
      if (aura !== p.aura) this.setAura(aura);
      const label = (pulled && this._pulls[pulled]?.label) || (s.locked ? this.lockedLabel : this.label);
      if (!label) this.removeAttribute('aria-label');
      else if (this.getAttribute('aria-label') !== label) this.setAttribute('aria-label', label);
      this.setAttribute('aria-disabled', String(this.disabled));
      this.toggleAttribute('active', active);
      this.toggleAttribute('locked', s.locked);

      if (active !== !!p.active) {
        this.dispatchEvent(new CustomEvent('activechange', { detail: { active }, bubbles: true, composed: true }));
      }
      if (s.locked !== !!p.locked) {
        this.dispatchEvent(new CustomEvent('lockchange', { detail: { locked: s.locked }, bubbles: true, composed: true }));
      }
      this.drawGeometry(p);
      Object.assign(p, { live, active, aura, up, pulled, seen, locked: s.locked, aim: s.aim, pressed: s.pressed, held: s.held, dropped: s.dropped });
      this.frame();
    }

    /**
     * The geometry overlay: the clear and arm radii and the directions' arcs
     * around where pulls are measured from, the slop around touch-down while
     * the press could still be a tap, the pull to the finger, and two rings,
     * one filling until the hold and one draining through the double-tap
     * window after a tap.
     */
    drawGeometry(p) {
      if (!this.geometry) return;
      const s = this.s, g = this.el.geometry;
      const at = ({ x, y }) => `translate(${(STAGE.left + x).toFixed(2)} ${(STAGE.up + y).toFixed(2)})`;
      const down = s.pressed ? this.downAt : { x: 0, y: 0 };
      const anchor = s.pressed ? { x: down.x + s.anchor.x, y: down.y + s.anchor.y } : down;
      const finger = { x: down.x + s.travel.x, y: down.y + s.travel.y };
      g.around.setAttribute('transform', at(anchor));
      g.around.classList.toggle('pressed', s.pressed);
      g.arm.classList.toggle('on', s.aim != null);
      g.down.setAttribute('transform', at(down));
      g.down.style.display = s.pressed && !s.held && !s.dropped && s.ending !== 'lock' ? '' : 'none';
      g.finger.setAttribute('transform', at(finger));
      g.pull.setAttribute('x1', (STAGE.left + anchor.x).toFixed(2));
      g.pull.setAttribute('y1', (STAGE.up + anchor.y).toFixed(2));
      g.pull.setAttribute('x2', (STAGE.left + finger.x).toFixed(2));
      g.pull.setAttribute('y2', (STAGE.up + finger.y).toFixed(2));
      g.pull.style.display = g.finger.style.display = s.pressed ? '' : 'none';
      const run = (el, from, to, duration) => {
        for (const animation of el.getAnimations()) animation.cancel();
        if (duration) el.animate([{ strokeDashoffset: from }, { strokeDashoffset: to }], { duration, fill: 'forwards' });
      };
      if (s.pressed && !p.pressed) {
        run(g.window);
        run(g.timer, 1, 0, this.holdDelay);
      } else if ((p.pressed && !s.pressed) || (s.dropped && !p.dropped)) {
        run(g.timer);
        if (!s.pressed && this.lastEnd === 'tap') run(g.window, 0, 1, this.doubleTapDelay);
      }
      g.timer.classList.toggle('held', s.held);
    }

    setAura(css) {
      const tint = parseColor(css);
      const from = this.auraFade.color;
      const to = tint ? [...tint] : [from[0], from[1], from[2], 0];
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.auraFade = { color: to, from: null, to: null, start: 0 };
        this.paintAura();
      } else {
        // A fresh color fades in rather than sliding through another.
        const start = from[3] > 0.01 ? from : [to[0], to[1], to[2], 0];
        this.auraFade = { color: start, from: start, to, start: performance.now() };
      }
    }

    paintAura() {
      const [r, g, b, a] = this.auraFade.color;
      const rgb = `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`;
      this.el.aura.style.background = a <= 0.001 ? 'none'
        : `radial-gradient(closest-side, rgba(${rgb}, ${0.85 * a}) 41.4%, rgba(${rgb}, ${0.55 * a}) 70.7%, rgba(${rgb}, 0) 100%)`;
    }

    finishLaunch() {
      if (!this.launch) return;
      this.launch = null;
      this.s.launched = false;
      this.s.pull = 0;
      const { travel, tension, tint } = this.sp.bubble;
      for (const spring of [travel, tension, tint]) spring.set(0);
    }

    // MARK: Drawing

    frame() {
      if (!this.raf && this.isConnected) this.raf = requestAnimationFrame(this.tick);
    }

    tick(now) {
      this.raf = 0;
      const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 1 / 20) : 1 / 60;
      this.lastFrame = now;
      let moving = false;
      for (const spring of this.springs) if (spring.step(dt)) moving = true;
      if (this.launch) {
        const progress = Math.min(1, (now - this.launch.start) / 180);
        this.launch.t = progress * progress;
        if (progress >= 1) {
          this.finishLaunch();
          this.sync();
        }
        moving = true;
      }
      const fade = this.auraFade;
      if (fade.to) {
        const progress = Math.min(1, (now - fade.start) / 200);
        const eased = 1 - (1 - progress) ** 3;
        fade.color = fade.from.map((value, i) => value + (fade.to[i] - value) * eased);
        if (progress >= 1) this.auraFade = { color: fade.to, from: null, to: null, start: 0 };
        else moving = true;
        this.paintAura();
      }
      this.draw();
      if (moving) this.frame();
      else this.lastFrame = 0;
    }

    /**
     * The key and its bubble, centered on the key, in CSS pixels. Each shape
     * is an ellipse turned by an angle given as its cosine c and sine s;
     * the bubble is long along its direction, so on an axis it is upright.
     */
    shapes() {
      const s = this.s, sp = this.sp;
      const press = sp.press.value, kt = sp.key.value;
      // Pressed, the key swells about its center; tension stretches it from its bottom.
      const kx = 1 - 0.04 * kt, ky = 1 + 0.06 * kt;
      const key = { x: 0, y: R - R * ky, rx: R * press * kx, ry: R * press * ky, c: 1, s: 0, tint: clamp01(sp.tint.value), alpha: 1 };
      const b = sp.bubble;
      const [ux, uy] = heading(b.angle.value);
      // As far as the stage reaches in its direction; launched, a little farther.
      const reach = Math.min(ux ? MAX_SIDE / Math.abs(ux) : Infinity, uy < 0 ? MAX_UP / -uy : Infinity);
      const launched = this.launch ? this.launch.t : 0;
      const travel = Math.min(Math.max(0, b.travel.value) + 40 * launched, reach);
      const t = b.tension.value;
      const along = R * (1 + 0.2 * t), across = R * (1 - 0.14 * t);
      const out = travel - R + along;
      const shown = s.pull > 0 || this.launch || b.travel.value > 0.5;
      const bubble = {
        x: ux * out, y: uy * out,
        ...(!uy ? { rx: along, ry: across, c: 1, s: 0 } : !ux ? { rx: across, ry: along, c: 1, s: 0 } : { rx: across, ry: along, c: -uy, s: ux }),
        tint: clamp01(b.tint.value),
        alpha: !shown ? 0 : this.launch ? 1 - launched : 1,
      };
      return [key, bubble];
    }

    draw() {
      const shapes = this.shapes();
      const reach = Math.hypot(this.touch.x, this.touch.y);
      const scale = reach > 24 ? 24 / reach : 1;
      this.renderer?.render(shapes, { x: this.touch.x * scale, y: this.touch.y * scale, strength: this.sp.glow.value });
      // A turned bubble's symbol stays upright, stretched along the bubble.
      const place = (el, { x, y, rx, ry, c, s }) => {
        const a = rx / R, b = ry / R, skew = (a - b) * c * s;
        const stretch = s ? `matrix(${a * c * c + b * s * s}, ${skew}, ${skew}, ${a * s * s + b * c * c}, 0, 0)` : `scale(${a}, ${b})`;
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) ${stretch}`;
      };
      const [key, bubble] = shapes;
      place(this.el.key, key);
      place(this.el.bubble, bubble);
      this.el.bubble.style.opacity = bubble.alpha;
    }
  }

  // Attributes, and the properties that reflect them.
  const BOOLEANS = ['live', 'armed', 'disabled', 'no-latch', 'no-haptics', 'geometry'];
  const STRINGS = ['aura', 'symbol', 'live-symbol', 'armed-symbol', 'label', 'locked-label', 'theme'];
  const NUMBERS = ['hold-delay', 'double-tap-delay', 'size'];
  const camel = (name) => name.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
  const reflect = (name, get, set) => Object.defineProperty(LiquidKey.prototype, camel(name), { get, set, configurable: true });
  for (const name of BOOLEANS) {
    reflect(name, function () { return this.hasAttribute(name); }, function (value) { this.toggleAttribute(name, !!value); });
  }
  for (const name of [...STRINGS, ...NUMBERS]) {
    const set = function (value) {
      if (value == null) this.removeAttribute(name);
      else this.setAttribute(name, String(value));
    };
    reflect(name, STRINGS.includes(name)
      ? function () { return this.getAttribute(name) ?? DEFAULTS[camel(name)] ?? ''; }
      : function () {
        const value = parseFloat(this.getAttribute(name));
        return Number.isFinite(value) && value >= 0 ? value : DEFAULTS[camel(name)];
      }, set);
  }
  const PROPERTIES = ['pulls', 'locked', ...[...BOOLEANS, ...STRINGS, ...NUMBERS].map(camel)];

  Object.defineProperty(LiquidKey, 'symbols', { value: SYMBOLS, enumerable: true });
  LiquidKey.haptic = haptic;
  window.LiquidKey = LiquidKey;
  if (!customElements.get('liquid-key')) customElements.define('liquid-key', LiquidKey);
})();
