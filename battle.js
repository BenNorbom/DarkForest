const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (n) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const rand = (seed) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const hull = [
  [-0.55, 0, 1.85],
  [-0.82, 0, 0.15],
  [-0.36, 0, -1.08],
  [0.36, 0, -1.08],
  [0.82, 0, 0.15],
  [0.55, 0, 1.85],
  [0, 0.23, 1.64],
  [0, 0.3, -0.32],
  [0, -0.18, 0.75],
  [-0.63, 0.11, 1.6],
  [0.63, 0.11, 1.6],
];
const faces = [
  [[0, 1, 8], 0.31],
  [[1, 2, 8], 0.44],
  [[2, 3, 8], 0.59],
  [[3, 4, 8], 0.43],
  [[4, 5, 8], 0.29],
  [[0, 8, 5, 6], 0.51],
  [[0, 6, 7, 1], 0.59],
  [[1, 7, 2], 0.83],
  [[2, 7, 3], 1],
  [[3, 7, 4], 0.75],
  [[4, 7, 6, 5], 0.53],
  [[0, 9, 1], 0.76],
  [[5, 4, 10], 0.67],
];
const colors = { attack: '#ffae8c', defense: '#91e4ff' };

function planetTexture(seed) {
  const image = document.createElement('canvas');
  const size = (image.width = image.height = 420);
  const ctx = image.getContext('2d'),
    pixels = ctx.createImageData(size, size);
  const noise = rand(seed + 61),
    tint = rand(seed + 2)();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (2 * (i + 0.5)) / size - 1,
        y = (2 * (j + 0.5)) / size - 1;
      const r2 = x * x + y * y;
      if (r2 >= 1) continue;
      const z = Math.sqrt(1 - r2),
        lat = y * 0.91 + x * 0.3;
      const wave = Math.sin(lat * 20 + Math.sin(x * 6 + z * 2) * 1.4 + tint * 5);
      const clouds = Math.sin(lat * 47 + Math.cos(x * 12 + z * 7)) * 0.06 + noise() * 0.065;
      const light = clamp(-0.53 * x - 0.79 * y + 0.25 * z);
      const value = (0.49 + wave * 0.16 + clouds) * (0.034 + 0.95 * light ** 0.72);
      const air = (1 - z) ** 3 * (0.05 + light * 0.32);
      const index = (j * size + i) * 4;
      pixels.data[index] = (125 + tint * 75) * value + 77 * air;
      pixels.data[index + 1] = (178 + tint * 25) * value + 147 * air;
      pixels.data[index + 2] = (224 - tint * 30) * value + 215 * air + 8;
      pixels.data[index + 3] = Math.min(255, (1 - r2) * size * 180);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return image;
}

export function createBattleView(canvas, moment) {
  const g = canvas.getContext('2d', { alpha: false });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController(),
    options = { signal: listeners.signal };
  const seed = 43 + moment.id * 1717,
    random = rand(seed);
  const planet = planetTexture(seed);
  const stars = Array.from({ length: 210 }, () => [random(), random(), random(), random()]);
  const sparks = Array.from({ length: 50 }, () => [random(), random(), random(), random()]);
  const { captured, strength } = moment.battle;
  const squad = (side, weight, fallback) => {
    const size = weight == null ? fallback : clamp(Math.round(2 + Math.sqrt(weight)), 2, 12);
    return Array.from({ length: size }, (_, n) => ({
      side,
      n,
      file: (n % 2 ? 1 : -1) * Math.ceil(n / 2),
      spread: random() - 0.5,
      elevation: random() - 0.5,
      phase: random(),
      size: n ? mix(0.25, 0.41, random()) : 0.82,
    }));
  };
  const vessels = [
    ...squad(-1, strength?.attack, captured ? 8 : 6),
    ...squad(1, strength?.defense, captured ? 5 : 8),
  ];
  let width,
    height,
    dpr,
    project,
    progress = 0,
    yaw = 0,
    pitch = 0,
    drag;

  function dot(x, y, r) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  function backdrop() {
    g.fillStyle = '#060b15';
    g.fillRect(0, 0, width, height);
    const x = width * (0.72 + Math.sin(yaw) * 0.065),
      y = height * 0.34;
    const cloud = g.createRadialGradient(x, y, 0, x, y, width * 0.7);
    cloud.addColorStop(0, '#263553');
    cloud.addColorStop(0.34, '#111e35');
    cloud.addColorStop(1, '#060b15');
    g.fillStyle = cloud;
    g.fillRect(0, 0, width, height);
    g.fillStyle = '#dfefff';
    for (const [sx, sy, light, depth] of stars) {
      g.globalAlpha = 0.16 + light ** 3 * 0.72;
      const px = ((((sx - yaw * (0.012 + depth * 0.02)) % 1) + 1) % 1) * width;
      dot(px, sy * height, 0.31 + light ** 5 * 0.97);
    }
    g.globalAlpha = 1;
    const radius = Math.min(width * 0.38, height * 0.52);
    const px = width * (0.72 - Math.sin(yaw) * 0.08),
      py = height * (0.68 + pitch * 0.1);
    const air = g.createRadialGradient(px, py, radius * 0.93, px, py, radius * 1.16);
    air.addColorStop(0, '#73cbf366');
    air.addColorStop(0.32, '#5db2e85a');
    air.addColorStop(1, '#5db2e800');
    g.fillStyle = air;
    dot(px, py, radius * 1.16);
    g.drawImage(planet, px - radius, py - radius, radius * 2, radius * 2);
    g.strokeStyle = '#a8d4ff22';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(px - radius * 0.2, py - radius * 0.08, radius * 1.86, radius * 0.35, -0.36, 0.1, 3.2);
    g.stroke();
    const vignette = g.createLinearGradient(0, 0, 0, height);
    vignette.addColorStop(0, '#05091282');
    vignette.addColorStop(0.37, '#05091200');
    vignette.addColorStop(0.65, '#05091200');
    vignette.addColorStop(1, '#040810eb');
    g.fillStyle = vignette;
    g.fillRect(0, 0, width, height);
  }

  function formation(ship) {
    const approach = smooth(progress / 0.6),
      exit = smooth((progress - 0.59) / 0.4);
    const routed = captured ? ship.side > 0 : ship.side < 0;
    const divert = routed ? exit * 5.6 : exit * -0.95;
    const stagger = Math.abs(ship.file) * 0.4;
    const x = ship.side * (mix(5.9, 1.58, approach) + divert + stagger + ship.spread);
    const y =
      ship.elevation + Math.sin(ship.phase * 8 + progress * 7) * 0.21 + (routed ? exit * 1.8 : 0);
    const z = ship.file * 0.78 + (routed ? -exit * 1.8 : 0);
    const angle = ship.side * (1.36 - (routed ? exit * 2.75 : exit * 0.24));
    return { ...ship, x, y, z, angle, alpha: routed ? 1 - exit * 0.64 : 1 };
  }

  function drawShip(ship) {
    const color = ship.side < 0 ? colors.attack : colors.defense;
    const c = Math.cos(ship.angle),
      s = Math.sin(ship.angle);
    const fromHull = ([x, y, z]) =>
      project(
        ship.x + (x * c + z * s) * ship.size,
        ship.y + y * ship.size,
        ship.z + (z * c - x * s) * ship.size,
      );
    const vertices = hull.map(fromHull);
    const depth = (face) => face.reduce((sum, n) => sum + vertices[n].z, 0) / face.length;
    const ordered = faces.toSorted(([a], [b]) => depth(b) - depth(a));
    g.globalAlpha = ship.alpha;
    for (const x of [-0.4, 0.4]) {
      const engine = fromHull([x, 0, 1.83]),
        trace = fromHull([x, 0, 3.3]);
      const trail = g.createLinearGradient(engine.x, engine.y, trace.x, trace.y);
      trail.addColorStop(0, color);
      trail.addColorStop(1, '#ffffff00');
      g.strokeStyle = trail;
      g.lineWidth = ship.n ? 1.2 : 2.7;
      g.beginPath();
      g.moveTo(engine.x, engine.y);
      g.lineTo(trace.x, trace.y);
      g.stroke();
    }
    for (const [face, light] of ordered) {
      g.beginPath();
      for (const n of face) g.lineTo(vertices[n].x, vertices[n].y);
      g.closePath();
      g.fillStyle = `rgb(${Math.round(20 + 128 * light)} ${Math.round(24 + 145 * light)} ${Math.round(34 + 161 * light)})`;
      g.fill();
      g.strokeStyle = color + '73';
      g.lineWidth = ship.n ? 0.4 : 0.7;
      g.stroke();
    }
    const bridge = vertices[7];
    g.fillStyle = color;
    dot(bridge.x, bridge.y, ship.n ? 1.15 : 2.3);
    g.globalAlpha = 1;
  }

  function exchange() {
    if (progress < 0.21 || progress > 0.72) return;
    const interval = (progress - 0.21) / 0.51;
    const envelope = Math.sin(interval * Math.PI);
    for (const [beat, band, depth, tint] of sparks) {
      const side = tint > 0.5 ? 1 : -1;
      const p = (interval * 2.7 + beat) % 1;
      const y = (band - 0.5) * 1.2,
        z = (depth - 0.5) * 5.5;
      const start = project(side * mix(4, -3.1, p), y, z);
      const end = project(side * mix(4, -3.1, p + 0.055), y + 0.06, z);
      g.globalAlpha = envelope * Math.sin(p * Math.PI) * (0.35 + depth * 0.61);
      g.strokeStyle = side < 0 ? colors.attack : colors.defense;
      g.lineWidth = 0.8 + band * 1.1;
      g.beginPath();
      g.moveTo(start.x, start.y);
      g.lineTo(end.x, end.y);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  function render(value = progress) {
    progress = value;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    width = box.width;
    height = box.height;
    dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(width * dpr),
      h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const turn = yaw - 0.29 + (reduced.matches ? 0 : progress * 0.43);
    const tilt = pitch + 0.28,
      cy = Math.cos(turn),
      sy = Math.sin(turn);
    const cp = Math.cos(tilt),
      sp = Math.sin(tilt);
    const zoom = Math.min(width * 1.05, height * 1.62);
    project = (x, y, z) => {
      const dx = x * cy - z * sy,
        dz = x * sy + z * cy;
      const vertical = y * cp - dz * sp,
        depth = 16 + y * sp + dz * cp;
      return {
        x: width / 2 + (dx * zoom) / depth,
        y: height * 0.46 - (vertical * zoom) / depth,
        z: depth,
      };
    };
    backdrop();
    if (!reduced.matches) exchange();
    const fleet = vessels.map(formation);
    fleet.sort((a, b) => project(b.x, b.y, b.z).z - project(a.x, a.y, a.z).z);
    for (const ship of fleet) drawShip(ship);
  }

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.isPrimary || e.button !== 0) return;
      canvas.focus({ preventScroll: true });
      drag = { x: e.clientX, y: e.clientY, yaw, pitch };
      canvas.setPointerCapture(e.pointerId);
    },
    options,
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || !e.isPrimary) return;
      yaw = clamp(drag.yaw + (e.clientX - drag.x) * 0.008, -1.05, 1.05);
      pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.008, -0.45, 0.63);
      render();
    },
    options,
  );
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(
      type,
      () => {
        drag = null;
      },
      options,
    );
  }
  canvas.addEventListener(
    'keydown',
    (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        yaw = clamp(yaw + (e.key === 'ArrowLeft' ? -0.12 : 0.12), -1.05, 1.05);
      } else pitch = clamp(pitch + (e.key === 'ArrowUp' ? -0.1 : 0.1), -0.45, 0.63);
      render();
    },
    options,
  );
  const observer = new ResizeObserver(() => render());
  observer.observe(canvas);
  return {
    render,
    destroy() {
      listeners.abort();
      observer.disconnect();
    },
  };
}
