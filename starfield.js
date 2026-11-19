// The renderer only knows the observation frame supplied by the caller.
// All moving marks are positioned using simulation time, including on replay.
const TAU = 2 * Math.PI;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

function randomSequence(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const backdropRandom = randomSequence(718931);
const noiseTable = Float32Array.from({ length: 256 * 256 }, backdropRandom);
function noise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const u = smooth(x - ix);
  const v = smooth(y - iy);
  const top = (iy & 255) << 8;
  const bottom = ((iy + 1) & 255) << 8;
  const left = ix & 255;
  const right = (ix + 1) & 255;
  return mix(
    mix(noiseTable[top + left], noiseTable[top + right], u),
    mix(noiseTable[bottom + left], noiseTable[bottom + right], u),
    v,
  );
}

function turbulence(x, y) {
  return (
    noise(x, y) * 0.51 +
    noise(x * 2.07 + 17, y * 2.07) * 0.27 +
    noise(x * 4.13, y * 4.13 + 23) * 0.14 +
    noise(x * 8.4, y * 8.4) * 0.08
  );
}

let skyTexture;
function makeSky() {
  if (skyTexture) return skyTexture;
  const sky = document.createElement('canvas');
  sky.width = 920;
  sky.height = 620;
  const g = sky.getContext('2d', { alpha: false });
  const pixels = g.createImageData(sky.width, sky.height);
  const rng = randomSequence(93045);
  for (let y = 0; y < sky.height; y++) {
    for (let x = 0; x < sky.width; x++) {
      const nx = (x / sky.width - 0.46) * 2.44;
      const ny = (y / sky.height - 0.54) * 1.6;
      const u = 0.91 * nx - 0.42 * ny;
      const v = (0.42 * nx + 0.91 * ny) * 1.75;
      const r = Math.hypot(u, v);
      const phase = Math.atan2(v, u) + 2.8 * Math.log(r + 0.23);
      const warp = turbulence(4 * u + 9, 4 * v + 23);
      const lanes = Math.exp(-4 * Math.pow(Math.sin(phase + 0.64 * warp), 2));
      const clouds = turbulence(10 * u + 2.1 * warp + 60, 8 * v + 1.6 * warp);
      const filaments = turbulence(22 * u - 4 * clouds, 17 * v + 3 * warp);
      const dust = clamp((clouds * 0.66 + filaments * 0.34 - 0.27) * 2.5, 0, 1);
      const light = Math.exp(-2.1 * r * r) * (0.12 + lanes * 0.88) * dust * dust;
      const core = Math.exp(-15.8 * r * r) * (0.2 + 0.8 * dust);
      const cold = Math.exp(-2 * ((u + 0.29) ** 2 + (v + 0.17) ** 2));
      const grain = rng() * 2.4;
      const i = (y * sky.width + x) * 4;
      pixels.data[i] = 5 + 24 * light + 49 * core + grain;
      pixels.data[i + 1] = 11 + 35 * light + 34 * core + 3 * cold + grain;
      pixels.data[i + 2] = 21 + 58 * light + 28 * core + 3 * cold + grain;
      pixels.data[i + 3] = 255;
    }
  }
  g.putImageData(pixels, 0, 0);
  // Tiny unresolved stars form the background texture. They are never selectable.
  for (let i = 0; i < 3200; i++) {
    const x = rng() * sky.width;
    const y = rng() * sky.height;
    const magnitude = rng() ** 3;
    const size = 0.26 + magnitude * 0.7;
    g.fillStyle = rng() > 0.92 ? '#e8ccb5' : '#c7dae4';
    g.globalAlpha = 0.06 + magnitude * 0.5;
    g.fillRect(x, y, size, size);
  }
  g.globalAlpha = 1;
  skyTexture = sky;
  return sky;
}

function circle(g, x, y, radius) {
  g.beginPath();
  g.arc(x, y, radius, 0, TAU);
}

function drawGrid(g, width, height, project, scale) {
  let step = 10;
  while (step * scale < 52) step *= 2;
  while (step * scale > 155) step /= 2;
  const [ox, oy] = project(0, 0);
  const gap = step * scale;
  const firstX = Math.ceil(-ox / gap);
  const firstY = Math.ceil(-oy / gap);
  g.lineWidth = 0.65;
  g.strokeStyle = 'rgba(135,167,184,.13)';
  g.beginPath();
  for (let i = firstX; ox + i * gap < width; i++) {
    const x = Math.round(ox + i * gap) + 0.5;
    g.moveTo(x, 0);
    g.lineTo(x, height);
  }
  for (let i = firstY; oy + i * gap < height; i++) {
    const y = Math.round(oy + i * gap) + 0.5;
    g.moveTo(0, y);
    g.lineTo(width, y);
  }
  g.stroke();
  g.strokeStyle = 'rgba(168,191,200,.24)';
  g.beginPath();
  for (let i = firstX; ox + i * gap < width; i++) {
    for (let j = firstY; oy + j * gap < height; j++) {
      const x = Math.round(ox + i * gap) + 0.5;
      const y = Math.round(oy + j * gap) + 0.5;
      g.moveTo(x - 2.5, y);
      g.lineTo(x + 2.5, y);
      g.moveTo(x, y - 2.5);
      g.lineTo(x, y + 2.5);
    }
  }
  g.stroke();
}

export function createStarMap(canvas, onSelect = () => {}) {
  const g = canvas.getContext('2d', { alpha: false });
  const sky = makeSky();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = { systems: [], fleets: [], signals: [], selected: null, year: 0 };
  let starsById = new Map();
  let positions = [];
  let camera = { x: 50, y: 50, zoom: 1 };
  let travel = null;
  let bounds = { x: 50, y: 50, spanX: 100, spanY: 100 };
  let width = 1;
  let height = 1;
  let scale = 1;
  let drag = null;
  let hovered = null;
  let passiveFrame = 0;
  let mapIdentity = null;
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  canvas.style.touchAction = 'none';
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
  if (!canvas.hasAttribute('aria-label')) {
    canvas.setAttribute(
      'aria-label',
      'Interactive star chart. Arrow keys pan, plus and minus zoom, Home fits the map, and Enter selects the closest system to the center.',
    );
  }

  function project(x, y) {
    return [(x - camera.x) * scale + width / 2, (y - camera.y) * scale + height / 2];
  }
  function updateBounds(systems) {
    if (!systems.length) return;
    const xs = systems.map((s) => s.x),
      ys = systems.map((s) => s.y);
    const loX = Math.min(...xs),
      hiX = Math.max(...xs);
    const loY = Math.min(...ys),
      hiY = Math.max(...ys);
    bounds = {
      x: (loX + hiX) / 2,
      y: (loY + hiY) / 2,
      spanX: Math.max(12, hiX - loX),
      spanY: Math.max(12, hiY - loY),
    };
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(width * dpr),
      ph = Math.round(height * dpr);
    if (pw !== canvas.width || ph !== canvas.height) {
      canvas.width = pw;
      canvas.height = ph;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const padX = Math.min(width * 0.1, 64),
      padY = Math.min(height * 0.12, 58);
    scale = Math.max(
      0.001,
      Math.min((width - 2 * padX) / bounds.spanX, (height - 2 * padY) / bounds.spanY) * camera.zoom,
    );
  }

  function drawTransit(trip, signal, stars) {
    const a = stars.get(trip.from),
      b = stars.get(trip.to);
    if (
      !a ||
      !b ||
      !Number.isFinite(trip.start) ||
      !Number.isFinite(trip.end) ||
      frame.year < trip.start ||
      frame.year > trip.end ||
      trip.end <= trip.start
    )
      return;
    const [ax, ay] = project(a.x, a.y),
      [bx, by] = project(b.x, b.y);
    if (
      Math.max(ax, bx) < -40 ||
      Math.min(ax, bx) > width + 40 ||
      Math.max(ay, by) < -40 ||
      Math.min(ay, by) > height + 40
    )
      return;
    const dx = bx - ax,
      dy = by - ay,
      len = Math.hypot(dx, dy);
    if (len < 2) return;
    const t = (frame.year - trip.start) / (trip.end - trip.start);
    const x = mix(ax, bx, t),
      y = mix(ay, by, t);
    const selected = frame.selected === a.id || frame.selected === b.id;
    const color = trip.color || (signal ? '#8ed8ca' : '#e1bb77');
    g.save();
    g.strokeStyle = color;
    g.fillStyle = color;
    g.globalAlpha = selected ? 0.69 : 0.34;
    g.lineWidth = selected ? 1.35 : 0.9;
    if (signal) g.setLineDash([2, 5]);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = selected ? 0.98 : 0.83;
    g.translate(x, y);
    g.rotate(Math.atan2(dy, dx));
    if (signal) {
      g.beginPath();
      g.arc(-2, 0, 5, -0.9, 0.9);
      g.stroke();
      circle(g, 0, 0, 1.6);
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(5, 0);
      g.lineTo(-3, 3);
      g.lineTo(-1.7, 0);
      g.lineTo(-3, -3);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function marks() {
    const labels = [];
    const smallScene = frame.systems.length <= 25;
    positions = [];
    for (const s of frame.systems) {
      const [x, y] = project(s.x, s.y);
      if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;
      const selected = s.id === frame.selected;
      const hot = s.id === hovered;
      const controlled = s.owner !== null && s.owner !== undefined && s.known !== false;
      const stale = Boolean(s.stale);
      const color = controlled && s.color ? s.color : '#9cabbc';
      const r = selected ? 4.5 : controlled ? (s.home ? 3.5 : 2.8) : 1.75;
      positions.push({ s, x, y });
      g.strokeStyle = color;
      g.fillStyle = color;
      if ((controlled || selected) && !stale) {
        g.globalAlpha = selected ? 0.11 : 0.07;
        circle(g, x, y, selected ? 20 : 12);
        g.fill();
        g.globalAlpha = selected ? 0.18 : 0.15;
        circle(g, x, y, selected ? 11 : 6.5);
        g.fill();
      }
      g.globalAlpha = controlled || selected ? 1 : 0.76;
      if (stale) {
        g.lineWidth = 1.05;
        circle(g, x, y, r + 0.5);
        g.stroke();
        const age = typeof s.stale === 'number' ? s.stale : 4;
        g.setLineDash([2, 4]);
        g.globalAlpha = 0.36;
        circle(g, x, y, clamp(7 + Math.sqrt(age) * 1.6, 8, 28));
        g.stroke();
        g.setLineDash([]);
      } else {
        circle(g, x, y, r);
        g.fill();
        if (controlled) {
          g.fillStyle = '#e8f3ef';
          circle(g, x, y, r * 0.35);
          g.fill();
        }
      }
      if (s.home && controlled) {
        g.strokeStyle = color;
        g.globalAlpha = 0.72;
        g.lineWidth = 0.85;
        circle(g, x, y, r + 3);
        g.stroke();
      }
      if (selected || hot) {
        const gap = selected ? 15 : 10;
        const arm = selected ? 5 : 3.5;
        g.lineWidth = 1.2;
        g.globalAlpha = 1;
        g.strokeStyle = selected ? '#ebe7d8' : '#a7c3cc';
        g.beginPath();
        for (const sx of [-1, 1])
          for (const sy of [-1, 1]) {
            g.moveTo(x + sx * (gap - arm), y + sy * gap);
            g.lineTo(x + sx * gap, y + sy * gap);
            g.lineTo(x + sx * gap, y + sy * (gap - arm));
          }
        g.stroke();
      }
      g.globalAlpha = 1;
      const priority = selected ? 5 : hot ? 4 : s.home && controlled ? 3 : controlled ? 2 : 1;
      if (smallScene || priority >= 3 || (camera.zoom >= 1.75 && priority >= 2) || camera.zoom >= 3) {
        labels.push({ s, x, y, priority, selected, hot });
      }
    }
    labels.sort((a, b) => b.priority - a.priority);
    const occupied = [];
    const maxLabels = Math.max(6, Math.min(34, Math.floor((width * height) / 13000)));
    for (const label of labels) {
      if (occupied.length >= maxLabels && label.priority < 4) break;
      const name = label.s.name || String(label.s.id);
      g.font = label.priority >= 4 ? '600 13px "Segoe UI", sans-serif' : '12px "Segoe UI", sans-serif';
      const tw = g.measureText(name).width;
      const gap = label.selected ? 20 : 10;
      const dir = label.x + gap + tw < width - 5 ? 1 : -1;
      const x = dir === 1 ? label.x + gap : label.x - gap - tw;
      const y = clamp(label.y - 4, 15, height - 5);
      const box = { x: x - 4, y: y - 13, w: tw + 8, h: 18 };
      if (
        x < 3 ||
        x + tw > width - 2 ||
        occupied.some(
          (p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y,
        )
      )
        continue;
      occupied.push(box);
      g.lineWidth = 3.5;
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(8,16,28,.86)';
      g.strokeText(name, x, y);
      g.fillStyle = label.priority >= 4 ? '#f0eee3' : label.priority >= 2 ? '#c1cfd4' : '#a3b1bc';
      g.fillText(name, x, y);
    }
  }

  function paint() {
    passiveFrame = 0;
    if (travel) {
      const fraction = Math.min(1, (performance.now() - travel.start) / 780);
      const ease = fraction * fraction * (3 - 2 * fraction);
      for (const field of ['x', 'y', 'zoom']) {
        camera[field] = travel.from[field] + (travel.to[field] - travel.from[field]) * ease;
      }
      if (fraction === 1) travel = null;
    }
    resize();
    const factor = Math.max(width / sky.width, height / sky.height) * 1.1;
    const sw = sky.width * factor,
      sh = sky.height * factor;
    const px = reduced.matches
      ? 0
      : clamp((camera.x - bounds.x) * scale * 0.033, -width * 0.04, width * 0.04);
    const py = reduced.matches
      ? 0
      : clamp((camera.y - bounds.y) * scale * 0.033, -height * 0.04, height * 0.04);
    g.drawImage(sky, (width - sw) / 2 - px, (height - sh) / 2 - py, sw, sh);
    drawGrid(g, width, height, project, scale);
    for (const s of frame.signals || []) drawTransit(s, true, starsById);
    for (const f of frame.fleets || []) drawTransit(f, false, starsById);
    const highlight = starsById.get(frame.highlightSite);
    if (highlight) {
      const [x, y] = project(highlight.x, highlight.y);
      g.strokeStyle = frame.highlightColor || '#97dfe6';
      g.globalAlpha = 0.6;
      g.lineWidth = 1.25;
      g.setLineDash([5, 4]);
      circle(g, x, y, 24);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    marks();
    if (travel) schedulePaint();
  }
  function schedulePaint() {
    if (!passiveFrame) passiveFrame = requestAnimationFrame(paint);
  }
  function reset() {
    travel = null;
    camera = { x: bounds.x, y: bounds.y, zoom: 1 };
    schedulePaint();
  }
  function draw(next) {
    frame = next;
    const systems = frame.systems || [];
    starsById = new Map(systems.map((s) => [s.id, s]));
    // Preserve the observer's camera when a timeline update reshapes the visible evidence.
    const identity = systems.length
      ? String(systems[0].id) + '/' + systems[0].x + '/' + systems[0].y
      : null;
    if (mapIdentity !== identity && identity !== null) {
      updateBounds(systems);
      travel = null;
      camera = { x: bounds.x, y: bounds.y, zoom: 1 };
      mapIdentity = identity;
    }
    if (passiveFrame) cancelAnimationFrame(passiveFrame);
    paint();
  }
  function focus(id, { animate = false, zoom = Math.max(camera.zoom, 1.75) } = {}) {
    const target = starsById.get(id);
    if (!target) return;
    const to = { x: target.x, y: target.y, zoom };
    travel = animate && !reduced.matches ? { start: performance.now(), from: { ...camera }, to } : null;
    if (!travel) camera = to;
    schedulePaint();
  }
  function zoomBy(factor, x = width / 2, y = height / 2) {
    travel = null;
    const next = clamp(camera.zoom * factor, 0.52, 18);
    const ratio = next / camera.zoom;
    camera.x += ((x - width / 2) / scale) * (1 - 1 / ratio);
    camera.y += ((y - height / 2) / scale) * (1 - 1 / ratio);
    camera.zoom = next;
    schedulePaint();
  }
  function nearest(x, y, limit = 15) {
    let choice = null,
      best = limit * limit;
    for (const p of positions) {
      const distance = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (distance < best) {
        choice = p.s;
        best = distance;
      }
    }
    return choice;
  }
  function coordinates(e) {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const amount = e.deltaY * (e.deltaMode === 1 ? 15 : e.deltaMode === 2 ? height : 1);
      zoomBy(Math.exp(-clamp(amount, -400, 400) * 0.0018), ...coordinates(e));
    },
    { ...options, passive: false },
  );
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.isPrimary || e.button !== 0) return;
      travel = null;
      const [x, y] = coordinates(e);
      drag = { x, y, cx: camera.x, cy: camera.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    },
    options,
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      const [x, y] = coordinates(e);
      if (drag && e.isPrimary) {
        if (Math.hypot(x - drag.x, y - drag.y) > 4) drag.moved = true;
        if (drag.moved) {
          camera.x = drag.cx - (x - drag.x) / scale;
          camera.y = drag.cy - (y - drag.y) / scale;
          schedulePaint();
        }
      } else if (!drag) {
        const hit = nearest(x, y);
        if ((hit?.id ?? null) !== hovered) {
          hovered = hit?.id ?? null;
          schedulePaint();
        }
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
    },
    options,
  );
  canvas.addEventListener(
    'pointerup',
    (e) => {
      if (!drag || !e.isPrimary) return;
      const hit = !drag.moved && nearest(...coordinates(e), e.pointerType === 'touch' ? 24 : 15);
      drag = null;
      canvas.style.cursor = 'grab';
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (hit) onSelect(hit.id);
    },
    options,
  );
  canvas.addEventListener(
    'pointercancel',
    () => {
      drag = null;
      canvas.style.cursor = 'grab';
    },
    options,
  );
  canvas.addEventListener(
    'pointerleave',
    () => {
      hovered = null;
      schedulePaint();
    },
    options,
  );
  canvas.addEventListener(
    'keydown',
    (e) => {
      const amount = 48 / scale;
      switch (e.key) {
        case 'ArrowLeft':
          camera.x -= amount;
          break;
        case 'ArrowRight':
          camera.x += amount;
          break;
        case 'ArrowUp':
          camera.y -= amount;
          break;
        case 'ArrowDown':
          camera.y += amount;
          break;
        case '+':
        case '=':
          zoomBy(1.35);
          break;
        case '-':
          zoomBy(1 / 1.35);
          break;
        case 'Home':
          reset();
          break;
        case 'Enter': {
          const hit = nearest(width / 2, height / 2, Infinity);
          if (hit) onSelect(hit.id);
          break;
        }
        default:
          return;
      }
      travel = null;
      e.preventDefault();
      schedulePaint();
    },
    options,
  );
  const observer = new ResizeObserver(schedulePaint);
  observer.observe(canvas);
  return {
    draw,
    focus,
    reset,
    zoomBy,
    destroy() {
      listeners.abort();
      observer.disconnect();
      if (passiveFrame) cancelAnimationFrame(passiveFrame);
    },
  };
}
