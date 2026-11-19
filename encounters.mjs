import { orbit, add, sub, scale, length, unit, dot } from './flight.mjs';
import { adapt } from './commanders.mjs';

const dt = 1 / 8,
  lightSpeed = 5269; // AU per simulation month
const distance = (a, b) => length(sub(a, b));
function blocked(a, b, bodies) {
  const ray = sub(b, a),
    size = dot(ray, ray);
  return [[0, 0, 0], ...bodies.map((b) => b.p)].some((center, i) => {
    const f = dot(sub(center, a), ray) / (size || 1);
    return f > 0.01 && f < 0.99 && distance(add(a, scale(ray, f)), center) < (i ? 0.015 : 0.045);
  });
}
export function theater(layout, start, observe) {
  return { layout, time: start, ships: [], missions: [], observe, shots: [], serial: 0 };
}
function mark(s, kind, ship, description, target) {
  s.observe?.({
    time: s.time,
    kind,
    ship: ship.id,
    controller: ship.controller,
    description,
    target: target?.id,
    at: ship.p,
    to: target?.p,
  });
}
export function deploy(s, entry) {
  const c = structuredClone(entry.captain),
    defense = entry.kind === 'defend';
  const mission = { ...entry, captain: c, held: 0, start: s.time, ships: [] };
  const n = entry.strength > 0 ? Math.min(5, Math.max(1, Math.ceil(entry.strength / 2))) : 1;
  const base = orbit(s.layout, entry.station || 0, s.time);
  for (let i = 0; i < n; i++) {
    const id = c.id + '/' + s.serial++,
      role = defense ? (i === 0 ? 'Battery' : 'Patrol') : i === 0 ? 'Command' : 'Escort';
    const offset = [0, 0.035 * i, 0.027 * i];
    const ship = {
      id,
      controller: c.id,
      owner: entry.owner,
      role,
      mission,
      p: add(defense ? base.p : scale(entry.direction, 5.4), offset),
      v: defense ? base.v.slice() : [0, 0, 0],
      hull: 1,
      drive: 1,
      sensor: 1,
      heat: 0,
      fuel: 16,
      power: entry.strength / n,
      action: 'Approach',
      clock: entry.clock || 0,
      tracks: new Map(),
      contacts: new Set(),
    };
    mission.ships.push(ship);
    s.ships.push(ship);
    mark(s, 'arrival', ship, role + ' entered the local plot');
  }
  s.missions.push(mission);
}
export function advance(s, owner) {
  const bodies = s.layout.bodies.map((_, i) => orbit(s.layout, i, s.time));
  const moves = [],
    damage = [],
    living = s.ships.filter((h) => h.hull > 0);
  for (const h of living) {
    const m = h.mission,
      c = m.captain,
      defend = m.kind === 'defend';
    const armed = h.power > 0,
      hostile = defend || m.kind === 'contest';
    // Each observer receives an emission before it can guide this ship or a wingmate.
    for (const other of living) {
      if (other.owner === h.owner || !(hostile || other.mission.kind === 'contest')) continue;
      const separation = distance(h.p, other.p);
      if (
        h.sensor <= 0 ||
        separation > h.sensor * (1.6 + 1.5 * h.sensor) ||
        blocked(h.p, other.p, bodies)
      )
        continue;
      for (const receiver of m.ships) {
        if (receiver.hull <= 0) continue;
        const delay = (separation + distance(h.p, receiver.p)) / lightSpeed;
        const track = receiver.tracks.get(other.id) || {};
        if (!track.pending || track.pending.time > s.time + delay)
          track.pending = {
            time: s.time + delay,
            p: other.p,
            v: other.v,
            observed: s.time,
            id: other.id,
            role: other.role,
          };
        receiver.tracks.set(other.id, track);
      }
    }
    const contacts = [];
    for (const track of h.tracks.values()) {
      if (track.pending?.time <= s.time) {
        track.last = track.pending;
        track.pending = null;
      }
      if (track.last && s.time - track.last.observed < 0.5)
        contacts.push({
          ...track.last,
          p: add(track.last.p, scale(track.last.v, s.time - track.last.observed)),
        });
    }
    contacts.sort((a, b) => distance(h.p, a.p) - distance(h.p, b.p));
    const enemy = contacts[0];
    if (enemy && !h.contacts.has(enemy.id)) {
      h.contacts.add(enemy.id);
      mark(s, 'contact', h, 'Acquired ' + enemy.role, enemy);
    }
    const opposition = Math.min(1, (c.knowledge?.guard || 0) / (m.strength + 1));
    const raidScore =
      c.weights[4] * opposition + (c.doctrine === 'Pathfinder' ? 0.48 : 0) + (c.preferences.Raid || 0);
    const landScore = c.weights[0] + (c.preferences.Rendezvous || 0);
    const observedOwner = distance(h.p, bodies[0].p) < 0.3 * h.sensor ? owner : c.knowledge?.owner;
    const raid = m.kind === 'contest' && observedOwner !== h.owner && raidScore > landScore;
    const facility = defend ? m.station : raid ? (c.doctrine === 'Sentinel' ? 2 : 1) : 0;
    let goal = bodies[facility || 0],
      action = defend ? 'Screen' : raid ? 'Raid' : 'Rendezvous';
    if (
      enemy &&
      h.role !== 'Battery' &&
      armed &&
      (defend || h.role === 'Escort') &&
      c.weights[3] + (c.preferences.Intercept || 0) > c.weights[5] * h.heat + 0.14
    ) {
      action = 'Intercept';
      goal = enemy;
    }
    if (!defend && (c.recall || h.fuel < c.reserve * 3 || s.time - m.start > c.order.reviewMonths)) {
      action = 'Withdraw';
      goal = { p: scale(m.direction, 6), v: [0, 0, 0] };
    }
    if (action !== h.action) {
      h.action = action;
      mark(
        s,
        'maneuver',
        h,
        action + ' · ' + (enemy ? 'contact in range' : s.layout.bodies[facility || 0].name),
      );
    }
    const delta = sub(goal.p, h.p),
      range = length(delta);
    const closure = Math.min(1.6, Math.sqrt(2.4 * range), range * 2);
    const want = add(goal.v, scale(unit(delta), closure));
    const gravity = scale(
      h.p,
      (-((Math.PI / 6) ** 2) * s.layout.mass) / Math.max(0.2, length(h.p)) ** 3,
    );
    const request = sub(scale(sub(want, h.v), 1 / dt), gravity);
    const burn = Math.min(length(request), 1.8 * h.drive, h.fuel / dt);
    const acceleration = add(gravity, scale(unit(request), burn));
    moves.push({
      h,
      p: add(add(h.p, scale(h.v, dt)), scale(acceleration, (dt * dt) / 2)),
      v: add(h.v, scale(acceleration, dt)),
      burn,
    });
    h.heat = Math.max(0, h.heat - dt * 0.8);
    if (enemy && armed && h.heat < 0.72 && distance(h.p, enemy.p) < 0.78) {
      const ray = sub(enemy.p, h.p),
        flight = length(ray) / lightSpeed;
      const target = living.find((k) => k.id === enemy.id);
      if (!target) continue;
      const miss = distance(add(target.p, scale(target.v, flight)), enemy.p);
      s.shots.push({
        at: s.time + flight,
        target,
        source: h,
        hit: miss < 0.0002,
        amount: 0.1 + 0.085 * Math.sqrt(h.power),
      });
      h.heat += 0.45;
      mark(s, 'pulse', h, 'Pulse emitted', enemy);
    }
  }
  for (const shot of s.shots)
    if (shot.at <= s.time + dt && shot.hit && shot.target.hull > 0) damage.push(shot);
  s.shots = s.shots.filter((p) => p.at > s.time + dt);
  for (const { h, p, v, burn } of moves) {
    h.p = p;
    h.v = v;
    h.burn = burn;
    h.fuel -= burn * dt;
    h.clock += dt * Math.sqrt(1 - Math.min(0.999, length(v) ** 2 / lightSpeed ** 2));
  }
  s.time += dt;
  for (const { target: h, amount, source } of damage) {
    h.hull = Math.max(0, h.hull - amount);
    h.drive = h.hull < 0.32 ? 0 : h.hull;
    h.sensor = h.hull < 0.18 ? 0 : Math.sqrt(h.hull);
    mark(
      s,
      'impact',
      h,
      h.hull === 0 ? 'Hull lost' : h.drive === 0 ? 'Drive disabled' : 'Subsystem damage',
      source,
    );
    adapt(source.mission.captain, source.action, 0.6);
  }
  const done = [];
  const port = orbit(s.layout, 0, s.time);
  for (const m of s.missions.filter((m) => m.kind !== 'defend')) {
    const ship = m.ships[0],
      action = ship.action;
    const target =
      action === 'Raid' ? orbit(s.layout, m.captain.doctrine === 'Sentinel' ? 2 : 1, s.time) : port;
    const docked = distance(ship.p, target.p) < 0.2 && distance(ship.v, target.v) < 0.45;
    const opposed = living.some(
      (k) => k.hull > 0 && k.owner !== ship.owner && k.power > 0 && distance(k.p, port.p) < 0.34,
    );
    m.held =
      action !== 'Withdraw' && docked && (!opposed || m.kind !== 'contest' || action === 'Raid')
        ? m.held + dt
        : 0;
    const lost = ship.hull <= 0,
      timeout = s.time - m.start >= 30;
    let result = lost
      ? 'lost'
      : m.held >= 0.375
        ? action === 'Raid'
          ? 'raid'
          : 'dock'
        : action === 'Withdraw' && (length(ship.p) > 5.2 || timeout)
          ? 'withdraw'
          : timeout
            ? 'missed'
            : null;
    if (result) {
      mark(
        s,
        'outcome',
        ship,
        {
          dock: 'Rendezvous secured',
          raid: 'Facility disabled',
          withdraw: 'Expedition withdrew',
          lost: 'Command ship lost',
          missed: 'Rendezvous missed',
        }[result],
      );
      adapt(m.captain, action, result === 'dock' || result === 'raid' ? 1 : -1);
      done.push({
        mission: m,
        result,
        facility: action === 'Raid' ? (m.captain.doctrine === 'Sentinel' ? 2 : 1) : 0,
      });
    }
  }
  for (const outcome of done) {
    const m = outcome.mission;
    if (m.kind === 'escort' && m.owner === owner && outcome.result === 'dock') {
      const patrol = { ...m, kind: 'defend', station: 0 };
      for (const ship of m.ships) ship.mission = patrol;
      s.missions.push(patrol);
      outcome.reinforced = true;
    }
  }
  const finished = new Set(done.map((x) => x.mission));
  s.missions = s.missions.filter((m) => !finished.has(m));
  s.ships = s.ships.filter((h) => !finished.has(h.mission));
  return done;
}
export function visibleShips(s, controller) {
  const own = s.ships.filter((h) => h.controller === controller && h.hull > 0);
  const tracks = new Map();
  for (const ship of own)
    for (const [id, track] of ship.tracks) {
      if (track.last && s.time - track.last.observed < 0.5) tracks.set(id, track.last);
    }
  return s.ships
    .filter((h) => !controller || h.controller === controller || tracks.has(h.id))
    .map((h) => {
      if (controller && h.controller !== controller) {
        const seen = tracks.get(h.id);
        return { id: h.id, role: seen.role, p: seen.p, v: seen.v, observed: seen.observed };
      }
      return {
        id: h.id,
        owner: h.owner,
        role: h.role,
        p: h.p,
        v: h.v,
        controller: h.controller,
        hull: h.hull,
        heat: h.heat,
        burn: h.burn || 0,
        drive: h.drive,
        sensor: h.sensor,
        fuel: h.fuel,
        action: h.action,
        doctrine: h.mission.captain.doctrine,
        clock: h.clock,
        evidence: h.contacts.size,
        reserve: h.mission.captain.reserve,
        objective: h.mission.captain.mission,
      };
    });
}
