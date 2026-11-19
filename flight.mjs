// Cruise uses light-years and years, with c = 1. Local orbits use AU and months.
const properAcceleration = (9.80665 * 31557600) / 299792458;
export function cruise(distance, cap) {
  const a = properAcceleration;
  const gamma = Math.min(1 / Math.sqrt(1 - cap * cap), 1 + (distance * a) / 2);
  const momentum = Math.sqrt((gamma - 1) * (gamma + 1));
  const speed = momentum / gamma;
  const ramp = momentum / a;
  const rampDistance = (gamma - 1) / a;
  const coast = Math.max(0, distance - 2 * rampDistance) / (speed || 1);
  return {
    distance,
    speed,
    ramp,
    coast,
    duration: 2 * ramp + coast,
    properYears: (2 * Math.asinh(momentum)) / a + coast / gamma,
  };
}
// Slow the cruise leg just enough to meet the scheduled system-entry epoch.
export function departurePath(source, target, layout, month, mapScale, cap) {
  const auPerLy = 63241.077;
  const xyz = (star) => [star.x, star.y, star.z];
  const port = orbit(layout, 0, month);
  const start = add(xyz(source), scale(port.p, 1 / (auPerLy * mapScale)));
  const direction = unit(sub(xyz(source), xyz(target)));
  const finish = add(xyz(target), scale(direction, 5.4 / (auPerLy * mapScale)));
  const beta = (length(port.v) * 12) / auPerLy;
  const momentum = beta / Math.sqrt(1 - beta * beta);
  const injection = momentum / properAcceleration;
  const brakingDistance = (momentum * injection) / (Math.hypot(1, momentum) + 1);
  const braked = add(start, scale(unit(port.v), brakingDistance / mapScale));
  const distance = length(sub(finish, braked)) * mapScale;
  const months = Math.ceil((cruise(distance, cap).duration + injection) * 12);
  let lo = 0,
    hi = cap;
  for (let i = 0; i < 42; i++) {
    const mid = (lo + hi) / 2;
    if (cruise(distance, mid).duration + injection > months / 12) lo = mid;
    else hi = mid;
  }
  const path = cruise(distance, hi);
  return {
    ...path,
    start,
    braked,
    finish,
    direction,
    injection,
    months,
    duration: months / 12,
    mainDuration: path.duration,
    properYears: path.properYears + Math.asinh(momentum) / properAcceleration,
  };
}
export function routePosition(path, years) {
  if (years < (path.injection || 0)) {
    const remaining = path.injection - Math.max(0, years);
    const u = properAcceleration * remaining;
    const dx = (u * remaining) / (Math.hypot(1, u) + 1);
    const total =
      (properAcceleration * path.injection ** 2) /
      (Math.hypot(1, properAcceleration * path.injection) + 1);
    return add(path.braked, scale(sub(path.start, path.braked), dx / total));
  }
  return add(path.braked, scale(sub(path.finish, path.braked), cruiseState(path, years).fraction));
}
export function cruiseState(path, years) {
  const injectionClock = Math.asinh(properAcceleration * (path.injection || 0)) / properAcceleration;
  if (years < (path.injection || 0)) {
    const u = properAcceleration * (path.injection - Math.max(0, years));
    return {
      fraction: 0,
      speed: u / Math.hypot(1, u),
      shipYears: injectionClock - Math.asinh(u) / properAcceleration,
      phase: 'Departure burn',
    };
  }
  const duration = path.mainDuration ?? path.duration;
  const time = Math.max(0, Math.min(years - (path.injection || 0), duration));
  const remaining = duration - time;
  const ramp = Math.min(time, remaining, path.ramp);
  const u = properAcceleration * ramp;
  const dx = (u * ramp) / (Math.hypot(1, u) + 1);
  const position =
    time <= path.ramp
      ? dx
      : remaining <= path.ramp
        ? path.distance - dx
        : dx + path.speed * (time - path.ramp);
  const rampClock = Math.asinh(u) / properAcceleration;
  const shipYears =
    time <= path.ramp
      ? injectionClock + rampClock
      : remaining <= path.ramp
        ? path.properYears - rampClock
        : injectionClock + rampClock + (time - path.ramp) * Math.sqrt(1 - path.speed ** 2);
  return {
    fraction: position / (path.distance || 1),
    speed: u / Math.hypot(1, u),
    shipYears,
    phase: time < path.ramp ? 'Accelerating' : remaining < path.ramp ? 'Braking' : 'Cruising',
  };
}
export const add = (a, b) => a.map((n, i) => n + b[i]);
export const sub = (a, b) => a.map((n, i) => n - b[i]);
export const scale = (v, k) => v.map((n) => n * k);
export const length = (v) => Math.hypot(...v);
export const unit = (v) => scale(v, 1 / (length(v) || 1));
export const dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
export function systemLayout(random) {
  const mass = 0.7 + random() * 0.8;
  const bodies = ['Settlement', 'Refinery', 'Mine'].map((name, i) => ({
    name,
    radius: [1, 2.2, 3.7][i] * (0.83 + random() * 0.34),
    phase: random() * 2 * Math.PI,
    tilt: (random() - 0.5) * (0.3 + i * 0.38),
    node: random() * 2 * Math.PI,
  }));
  return { mass, bodies };
}
export function orbit(layout, index, month) {
  const b = layout.bodies[index],
    rate = (Math.PI / 6) * Math.sqrt(layout.mass / b.radius ** 3);
  const angle = b.phase + month * rate,
    u = [Math.cos(b.node), Math.sin(b.node), 0];
  const v = [
    -Math.sin(b.node) * Math.cos(b.tilt),
    Math.cos(b.node) * Math.cos(b.tilt),
    Math.sin(b.tilt),
  ];
  return {
    p: add(scale(u, b.radius * Math.cos(angle)), scale(v, b.radius * Math.sin(angle))),
    v: add(scale(u, -rate * b.radius * Math.sin(angle)), scale(v, rate * b.radius * Math.cos(angle))),
  };
}
// Earliest intersection of an isotropic signal with a sublight cruise segment.
export function catchSignal(path, sentYears, distanceAtEmission) {
  const gap = (t) => distanceAtEmission(cruiseState(path, t).fraction, t) - (t - sentYears);
  let lo = sentYears,
    hi = Math.max(lo, path.duration) + path.distance + 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) > 0) lo = mid;
    else hi = mid;
  }
  return hi;
}
