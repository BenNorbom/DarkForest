import {cruiseState,routePosition} from './flight.mjs';
// The renderer only knows the observation frame supplied by the caller.
// All moving marks are positioned using simulation time, including on replay.
const TAU = 2 * Math.PI;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;
const FIT_YAW = -0.21;
const FIT_PITCH = 0.82;

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
      pixels.data[i] = 6 + 38 * light + 86 * core + grain;
      pixels.data[i + 1] = 11 + 40 * light + 56 * core + 3 * cold + grain;
      pixels.data[i + 2] = 23 + 70 * light + 35 * core + 3 * cold + grain;
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

export function createStarMap(canvas, onSelect = () => {}) {
  const g = canvas.getContext('2d', { alpha: false });
  const sky = makeSky();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = { systems: [], fleets: [], signals: [], selected: null, year: 0 };
  let starsById = new Map();
  let positions = [];
  let bounds = { x: 50, y: 50, z: 0, halfX: 50, halfY: 50, halfZ: 0 };
  const fitCamera = () => ({
    x: bounds.x,
    y: bounds.y,
    z: bounds.z,
    yaw: FIT_YAW,
    pitch: FIT_PITCH,
    zoom: 1,
  });
  let camera = fitCamera();
  let fitWidth = 100;
  let fitHeight = 100;
  let travel = null;
  let cosYaw, sinYaw, cosPitch, sinPitch;
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
      '3D star map. Drag or use arrow keys to orbit, hold Shift to pan, and use plus and minus to zoom. Home fits the map. Enter selects the central system.',
    );
  }

  function project(x, y, z = 0) {
    const dx = x - camera.x;
    const dy = y - camera.y;
    const dz = z - camera.z;
    const u = cosYaw * dx + sinYaw * dy;
    const v = -sinYaw * dx + cosYaw * dy;
    return [
      width / 2 + scale * u,
      height / 2 + scale * (v * cosPitch - dz * sinPitch),
      dz * cosPitch + v * sinPitch,
    ];
  }
  function shiftCamera(x, y) {
    camera.x += (x * cosYaw - y * sinYaw * cosPitch) / scale;
    camera.y += (x * sinYaw + y * cosYaw * cosPitch) / scale;
    camera.z -= (y * sinPitch) / scale;
  }
  function updateBounds(systems) {
    for (const [axis, half] of [
      ['x', 'halfX'],
      ['y', 'halfY'],
      ['z', 'halfZ'],
    ]) {
      const values = systems.map((s) => s[axis] ?? 0);
      const min = Math.min(...values),
        max = Math.max(...values);
      bounds[axis] = (min + max) / 2;
      bounds[half] = Math.max(axis === 'z' ? 0 : 6, (max - min) / 2);
    }
    // Fit the stars in the reset orientation. Orbiting keeps that scale.
    const c = Math.cos(FIT_YAW),
      s = Math.sin(FIT_YAW),
      tilt = Math.cos(FIT_PITCH),
      lift = Math.sin(FIT_PITCH);
    fitWidth = 12;
    fitHeight = 12;
    for (const star of systems) {
      const x = star.x - bounds.x,
        y = star.y - bounds.y,
        z = (star.z ?? 0) - bounds.z;
      fitWidth = Math.max(fitWidth, 2 * Math.abs(c * x + s * y));
      fitHeight = Math.max(fitHeight, 2 * Math.abs((-s * x + c * y) * tilt - z * lift));
    }
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
    scale = Math.min((width - 2 * padX) / fitWidth, (height - 2 * padY) / fitHeight) * camera.zoom;
    cosYaw = Math.cos(camera.yaw);
    sinYaw = Math.sin(camera.yaw);
    cosPitch = Math.cos(camera.pitch);
    sinPitch = Math.sin(camera.pitch);
  }

  function drawGrid() {
    const { x, y, z, halfX, halfY, halfZ } = bounds;
    const floor = z - halfZ - 3;
    g.lineWidth = 0.75;
    g.strokeStyle = 'rgba(135,167,184,.2)';
    g.beginPath();
    for (let i = -5; i <= 5; i++) {
      const gx = x + (i * halfX) / 5;
      const gy = y + (i * halfY) / 5;
      g.moveTo(...project(gx, y - halfY, floor).slice(0, 2));
      g.lineTo(...project(gx, y + halfY, floor).slice(0, 2));
      g.moveTo(...project(x - halfX, gy, floor).slice(0, 2));
      g.lineTo(...project(x + halfX, gy, floor).slice(0, 2));
    }
    g.stroke();
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
    const [ax, ay] = project(a.x, a.y, a.z),
      [bx, by] = project(b.x, b.y, b.z);
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
    const f = trip.path ? cruiseState(trip.path, frame.year - trip.start).fraction : t;
    const [x, y] = trip.path?.start
      ? project(...routePosition(trip.path, frame.year - trip.start))
      : [mix(ax, bx, f), mix(ay, by, f)];
    const selected = frame.selected === a.id || frame.selected === b.id;
    if (frame.localRoutes && !selected) return;
    const color = trip.color || (signal ? '#8ed8ca' : '#e1bb77');
    g.save();
    g.strokeStyle = color;
    g.fillStyle = color;
    g.globalAlpha = selected ? 0.72 : 0.11;
    g.lineWidth = selected ? 1.35 : 0.9;
    if (signal) g.setLineDash([2, 5]);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = selected ? 0.98 : 0.83;
    if (!signal) {
      const trail = g.createLinearGradient(mix(ax, x, 0.77), mix(ay, y, 0.77), x, y);
      trail.addColorStop(0, 'transparent');
      trail.addColorStop(1, color);
      g.strokeStyle = trail;
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(mix(ax, x, 0.77), mix(ay, y, 0.77));
      g.lineTo(x, y);
      g.stroke();
    }
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
    positions = frame.systems
      .map((s) => {
        const [x, y, depth] = project(s.x, s.y, s.z);
        return { s, x, y, depth };
      })
      .filter(({ x, y }) => x >= -20 && x <= width + 20 && y >= -20 && y <= height + 20)
      .sort((a, b) => a.depth - b.depth);
    const centerDepth = project(bounds.x, bounds.y, bounds.z)[2];
    for (const { s, x, y, depth } of positions) {
      const selected = s.id === frame.selected;
      const hot = s.id === hovered;
      const controlled = s.owner !== null && s.owner !== undefined && s.known !== false;
      const stale = Boolean(s.stale);
      const color = controlled && s.color ? s.color : '#9cabbc';
      const proximity = clamp(0.5 + (depth - centerDepth) / 130, 0, 1);
      const r = selected ? 4.5 : (controlled ? (s.home ? 3.5 : 2.8) : 1.75) * (0.8 + 0.4 * proximity);
      if (selected && bounds.halfZ > 0) {
        const [fx, fy] = project(s.x, s.y, bounds.z - bounds.halfZ - 3);
        g.strokeStyle = 'rgba(151,223,230,.47)';
        g.lineWidth = 1;
        g.setLineDash([3, 5]);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(fx, fy);
        g.stroke();
        g.setLineDash([]);
      }
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
      g.globalAlpha = selected ? 1 : (controlled ? 1 : 0.78) * (0.58 + 0.42 * proximity);
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
      if(s.contested){
        g.strokeStyle='#ffac78';g.lineWidth=1.8;g.globalAlpha=.95;
        for(let i=0;i<3;i++){
          g.beginPath();g.arc(x,y,r+7,i*TAU/3+.15,(i+1)*TAU/3-.22);g.stroke();
        }
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
      const priority = selected ? 5 : hot ? 4 : s.contested ? 3 : s.home && controlled ? 3 : controlled ? 2 : 1;
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
      for (const field of ['x', 'y', 'z', 'zoom']) {
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
    drawGrid();
    for (const s of frame.signals || []) drawTransit(s, true, starsById);
    for (const f of frame.fleets || []) drawTransit(f, false, starsById);
    const highlight = starsById.get(frame.highlightSite);
    if (highlight) {
      const [x, y] = project(highlight.x, highlight.y, highlight.z);
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
    const center = project(camera.x, camera.y, camera.z);
    g.save();
    g.translate(38, height - 70);
    g.font = '9px monospace';
    for (const [i, label] of ['X', 'Y', 'Z'].entries()) {
      const xyz = [camera.x, camera.y, camera.z];
      xyz[i] += 21 / scale;
      const p = project(...xyz),
        dx = p[0] - center[0],
        dy = p[1] - center[1];
      g.strokeStyle = g.fillStyle = ['#f0ac83', '#95dcb5', '#8abde7'][i];
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(dx, dy);
      g.stroke();
      g.fillText(label, dx + 2, dy - 2);
    }
    if (frame.distanceScale && width > 520) {
      const target = (65 * frame.distanceScale) / scale;
      const step = 10 ** Math.floor(Math.log10(target));
      const ly = ([5, 2, 1].find((n) => n * step <= target) || 1) * step;
      const end = 44 + (ly / frame.distanceScale) * scale;
      g.strokeStyle = '#88a8b3';
      g.fillStyle = '#c3d3db';
      g.beginPath();
      g.moveTo(44, 0);
      g.lineTo(end, 0);
      g.stroke();
      g.fillText(ly.toPrecision(2) + ' ly', 44, -5);
    }
    g.restore();
    if (travel) schedulePaint();
  }
  function schedulePaint() {
    if (!passiveFrame) passiveFrame = requestAnimationFrame(paint);
  }
  function reset() {
    travel = null;
    camera = fitCamera();
    schedulePaint();
  }
  function draw(next) {
    frame = next;
    const systems = frame.systems || [];
    starsById = new Map(systems.map((s) => [s.id, s]));
    // Preserve the observer's camera when a timeline update reshapes the visible evidence.
    const identity = systems.length ? frame.mapId : null;
    if (mapIdentity !== identity && identity !== null) {
      updateBounds(systems);
      travel = null;
      camera = fitCamera();
      mapIdentity = identity;
    }
    if (passiveFrame) cancelAnimationFrame(passiveFrame);
    paint();
  }
  function focus(id, { animate = false, zoom = Math.max(camera.zoom, 1.75) } = {}) {
    const target = starsById.get(id);
    if (!target) return;
    const to = { ...camera, x: target.x, y: target.y, z: target.z ?? 0, zoom };
    travel = animate && !reduced.matches ? { start: performance.now(), from: { ...camera }, to } : null;
    if (!travel) camera = to;
    schedulePaint();
  }
  function zoomBy(factor, x = width / 2, y = height / 2) {
    travel = null;
    const next = clamp(camera.zoom * factor, 0.52, 18);
    const ratio = next / camera.zoom;
    shiftCamera((x - width / 2) * (1 - 1 / ratio), (y - height / 2) * (1 - 1 / ratio));
    camera.zoom = next;
    schedulePaint();
  }
  function nearest(x, y, limit = 15) {
    let choice = null,
      best = limit * limit;
    for (let i = positions.length - 1; i >= 0; i--) {
      const p = positions[i];
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
      drag = { x, y, from: { ...camera }, pan: e.shiftKey, moved: false };
      hovered = null;
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
          if (drag.pan) {
            camera = { ...drag.from };
            shiftCamera(drag.x - x, drag.y - y);
          } else {
            camera.yaw = drag.from.yaw - (x - drag.x) * 0.009;
            camera.pitch = clamp(drag.from.pitch + (y - drag.y) * 0.009, -1.55, 1.55);
          }
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
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = arrows[e.key];
      if (direction) {
        travel = null;
        const [x, y] = direction;
        if (e.shiftKey) shiftCamera(x * 48, y * 48);
        else {
          camera.yaw -= x * 0.15;
          camera.pitch = clamp(camera.pitch + y * 0.15, -1.55, 1.55);
        }
        e.preventDefault();
        schedulePaint();
        return;
      }
      switch (e.key) {
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
