import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulate, travelMonths } from './engine.mjs';
import { frame, indexReplay, ledger, chronicle, header } from './replay.mjs';
import { actionProbabilities, feedbackValue, learnFeedback } from './policy.mjs';

const { models } = JSON.parse(readFileSync(new URL('./models.json', import.meta.url)));
const cfg = { seed: 29191, count: 8, systems: 32, years: 85, models };
const replay = simulate(cfg),
  index = indexReplay(replay);
test('recording and replay preserve all seeded survival outcomes', () => {
  assert.deepEqual(replay.metrics, simulate({ ...cfg, detail: false }).metrics);
  assert.deepEqual(replay.events, simulate(cfg).events);
  assert.equal(index.run.chart.length, 32);
  assert.ok(new Set(replay.chart.map((s) => s.z)).size > 1);
});
test('a six-light-year route distinguishes departure, receipt, and arrival', () => {
  assert.equal(travelMonths(6, 1), 72);
  assert.equal(travelMonths(6, 1 / 3), 216);
  assert.equal(travelMonths(6, 0.2), 360);
  for (const e of replay.events.filter((e) => e.report)) {
    const a = replay.chart[e.site],
      b = replay.chart[e.target];
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * replay.scale;
    assert.ok(e.t - e.origin >= travelMonths(d, 1));
  }
  for (const f of replay.flights) {
    const a = replay.chart[f.from],
      b = replay.chart[f.to];
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * replay.scale;
    const speed = f.kind === 'signal' ? 1 : ['survey', 'contest'].includes(f.kind) ? 1 / 3 : 0.2;
    assert.equal(f.end - f.start, f.path ? f.path.months : travelMonths(d, speed));
  }
});
test('local views begin without hidden settlements and reveal only delivered reports', () => {
  const start = frame(index, { month: 0, lens: 0 });
  assert.equal(start.stats, null);
  assert.equal(start.systems.filter((s) => s.known).length, 1);
  const first = index.bySite[0].find((e) => e.report && e.target !== 0);
  assert.ok(first);
  assert.equal(frame(index, { month: first.t - 1, lens: 0, site: first.target }).site.known, false);
  const received = frame(index, { month: first.t, lens: 0, site: first.target });
  assert.equal(received.site.known, true);
  assert.equal(received.site.received, first.t);
  assert.equal(received.decision, null);
  assert.equal(received.site.reserve, undefined);
  for (const f of [...received.fleets, ...received.signals]) assert.equal(f.from, 0);
});
test('branch changes one legal order and preserves the complete earlier record', () => {
  const d = replay.decisions.find((x) => x.t > 90 && x.options[x.chosen].kind !== 'wait');
  assert.ok(d);
  const alt = d.options.findIndex((o) => o.kind === 'wait');
  const b = simulate({ ...cfg, overrides: { [d.key]: alt } });
  assert.deepEqual(
    replay.events.filter((e) => e.t < d.t),
    b.events.filter((e) => e.t < d.t),
  );
  assert.deepEqual(
    replay.decisions.filter((x) => x.t < d.t),
    b.decisions.filter((x) => x.t < d.t),
  );
  const different = b.decisions.find((x) => x.key === d.key);
  assert.equal(different.chosen, alt);
  assert.notDeepEqual(replay.events, b.events);
});
test('receiving a delayed outcome updates only that controller and decays with age', () => {
  const first = new Map(),
    other = new Map();
  learnFeedback(first, 'trade', 2, 100, 1);
  assert.ok(feedbackValue(first, 'trade', 2, 100) > 0);
  assert.equal(feedbackValue(other, 'trade', 2, 100), 0);
  assert.equal(feedbackValue(first, 'trade', 3, 100), 0);
  assert.equal(feedbackValue(first, 'trade', 2, 196), feedbackValue(first, 'trade', 2, 100) / 2);
  learnFeedback(first, 'trade', 2, 198, -1);
  assert.ok(feedbackValue(first, 'trade', 2, 198) < 0);
});
test('every checkpoint assigns a finite probability to the legal menu', () => {
  const f = Array(12).fill(0.5),
    opts = ['trade', 'contest', 'wait', 'survey'].map((kind, target) => ({ kind, target, features: f }));
  assert.equal(models.length, 6);
  for (const model of models) {
    const p = actionProbabilities({ options: opts }, model);
    assert.ok(p.every((x) => Number.isFinite(x) && x > 0));
    assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-10);
  }
});
test('chronicle paging, annual census and inventory agree with the recorded timeline', () => {
  const m = cfg.years * 12,
    r = ledger(index, m);
  for (const row of r.rows) {
    const outcome = replay.metrics.byCiv[row.id];
    assert.equal(row.viable, outcome.viable);
    assert.equal(row.population, outcome.population);
  }
  const first = chronicle(index, { month: m, scope: 'all', filter: 'all' }),
    next = chronicle(index, { month: m, scope: 'all', filter: 'all', offset: 40 });
  assert.equal(first[40].id, next[0].id);
  assert.equal(first[0].id, replay.events.at(-1).id);
  assert.ok(replay.metrics.attacks > 0 && replay.metrics.trades > 0);
  for (const hist of replay.history)
    assert.ok(hist.every((x) => x.pop >= 0 && x.reserve >= 0 && x.guard >= 0 && x.work >= 0));
});
test('saved evaluation reproduces a held-out trained galaxy', () => {
  const report = JSON.parse(readFileSync(new URL('./balance-report.json', import.meta.url)));
  const world = report.smallWorlds[0];
  const { metrics } = simulate({
    seed: world.seed,
    years: world.years,
    count: world.civilizations,
    systems: 4 * world.civilizations,
    models,
    detail: false,
  });
  for (const k of ['attacks', 'trades', 'colonies']) assert.equal(metrics[k], world[k]);
});

test('observer highlights cross systems and keep the requested playback time', () => {
  const { track } = index;
  assert.ok(new Set(track.map((h) => h.e.site)).size > 5);
  for (const category of ['Conflict', 'Science', 'Diplomacy']) {
    assert.ok(track.some((h) => h.category === category));
  }
  const opening = header(index).openingHighlight;
  assert.ok(opening);
  const beat = track.find((h) => h.category === 'Conflict' && h.t < cfg.years * 12);
  const before = frame(index, { month: beat.t - 1, site: 0 });
  assert.equal(before.nextHighlight, beat.t);
  const after = frame(index, { month: beat.t + 1, followFrom: before.t, site: 0 });
  assert.equal(after.t, beat.t + 1);
  assert.equal(after.highlight.id, beat.e.id);
  assert.equal(after.selected, beat.e.site);
  assert.deepEqual(after.highlight.combat, beat.e.combat);
  assert.ok(beat.e.combat.attack > 0 && beat.e.combat.defense >= 0);
  const manual = frame(index, { month: beat.t, site: 0 });
  assert.equal(manual.selected, 0);
  const receiver = (beat.e.site + 1) % cfg.systems;
  const local = frame(index, {
    month: beat.t + 1,
    followFrom: before.t,
    site: receiver,
    lens: receiver,
    event: beat.e.id,
  });
  assert.equal(local.selected, receiver);
  assert.equal(local.currentEvent, null);
  assert.ok(!local.highlight || local.highlight.site === receiver);
  const archived = indexReplay({
    ...replay,
    chart: replay.chart.map(({ z, ...s }) => s),
    events: replay.events.map(({ combat, ...e }) => e),
  });
  const oldFrame = frame(archived, { month: beat.t, site: beat.e.site, event: beat.e.id });
  assert.equal(oldFrame.highlight.title, after.highlight.title);
  assert.ok(oldFrame.systems.every((s) => s.z === 0));
});

test('news tracks the timeline and respects the local receiver', () => {
  const month = cfg.years * 12;
  const galaxy = frame(index, { month });
  assert.deepEqual(
    galaxy.news.map((e) => e.id),
    index.salient
      .slice(-24)
      .reverse()
      .map((e) => e.id),
  );
  assert.ok(new Set(galaxy.news.map((e) => e.site)).size > 1);
  assert.ok(galaxy.systems.every((s) => s.z === replay.chart[s.id].z));
  const first = index.localNews[0][0];
  assert.equal(frame(index, { month: first.t - 1, lens: 0 }).news.length, 0);
  const local = frame(index, { month: first.t, lens: 0, site: 1 });
  assert.ok(local.news.some((e) => e.id === first.id));
  assert.ok(local.news.every((e) => e.site === 0 && e.t <= first.t));
});

import {
  cruise,
  cruiseState,
  catchSignal,
  systemLayout,
  orbit,
  departurePath,
  routePosition,
} from './flight.mjs';
import { theater, deploy, advance, visibleShips } from './encounters.mjs';
import { commission, directive, adapt } from './commanders.mjs';
import { systemReplay } from './system-replay.mjs';
import { rng } from './engine.mjs';

test('cruise clocks, sublight velocities, moving receivers and orbital periods', () => {
  for (const d of [0.001, 6]) {
    const path = cruise(d, 1 / 3);
    assert.ok(path.properYears < path.duration && path.duration > d * 3);
    for (const t of [path.ramp, path.duration - path.ramp]) {
      const before = cruiseState(path, t - 1e-8),
        after = cruiseState(path, t + 1e-8);
      assert.ok(
        Math.abs(before.speed - after.speed) < 1e-6 && Math.abs(before.fraction - after.fraction) < 1e-5,
      );
      assert.ok(after.speed < 1);
    }
    const sent = path.duration * 0.25,
      received = catchSignal(path, sent, (x) => x * d);
    assert.ok(Math.abs(received - sent - cruiseState(path, received).fraction * d) < 1e-9);
    assert.equal(cruiseState(path, path.duration).fraction, 1);
  }
  const layout = systemLayout(rng(17)),
    period = 12 * Math.sqrt(layout.bodies[0].radius ** 3 / layout.mass);
  assert.ok(orbit(layout, 0, period).p.every((n, i) => Math.abs(n - orbit(layout, 0, 0).p[i]) < 1e-10));
});

function engagement(start, multi = false) {
  const events = [],
    layout = systemLayout(rng(17)),
    scene = theater(layout, start, (e) => events.push(e));
  const send = (id, owner, kind, strength, direction, raid = false) => {
    const captain = commission(id, 'home', kind, {}, raid ? { guard: 80 } : null, () => 0.5);
    if (raid) {
      captain.doctrine = 'Pathfinder';
      captain.weights[4] = 1;
    }
    deploy(scene, { captain, owner, kind, strength, direction, station: 0 });
  };
  send('home', 1, 'defend', 6, [1, 0, 0]);
  send('exp', 0, 'contest', 7, [1, 0, 0], multi);
  if (multi) send('rival', 2, 'contest', 4, [0, 0, 1]);
  const results = [];
  let drift = false;
  for (let i = 0; i < 250; i++) {
    if (i === 5 && multi) send('relief', 1, 'escort', 2, [-1, 0, 0]);
    const disabled = scene.ships.find((h) => h.drive === 0 && h.hull > 0);
    const position = disabled?.p;
    results.push(...advance(scene, 1));
    if (disabled && disabled.p !== position && disabled.p.some((v, j) => v !== position[j]))
      drift = true;
  }
  return { events, results, drift };
}
test('changing orbital phase changes interceptions and landing with identical fleets', () => {
  const a = engagement(0),
    b = engagement(16);
  assert.equal(a.results[0].result, 'dock');
  assert.equal(b.results[0].result, 'lost');
  assert.notDeepEqual(
    a.events.find((e) => e.kind === 'contact').at,
    b.events.find((e) => e.kind === 'contact').at,
  );
});
test('simultaneous rivals, relief, drifting damaged hulls and an independent raid', () => {
  const e = engagement(0, true);
  assert.ok(e.drift);
  assert.ok(e.results.some((r) => r.mission.kind === 'escort' && r.result === 'dock'));
  assert.ok(e.results.some((r) => r.result === 'raid' && r.facility === 1));
  assert.ok(e.events.some((event) => event.kind === 'impact'));
});
test('a promoted controller retains private adaptation and rejects a late recall', () => {
  const c = commission('exp', 'home', 'contest', {}, { guard: 3 }, () => 0.5);
  adapt(c, 'Intercept', 1);
  const memory = { ...c.preferences };
  c.role = 'ruler';
  assert.equal(directive(c, { sequence: 2, expires: 200 }, 100), 'rejected');
  assert.equal(directive(c, { sequence: 1, expires: 200 }, 101), 'superseded');
  assert.equal(c.recall, undefined);
  assert.deepEqual(c.preferences, memory);
});
test('orbital replay respects receiver, timestamps, archived runs and stable commander identity', () => {
  const physics = { theater, advance, deploy, visibleShips };
  const event = replay.events.find((e) => e.encounter != null && e.combat);
  const args = { site: event.site, month: event.t, start: event.encounter, lens: -1 };
  const full = systemReplay(replay, args, physics);
  assert.ok(full.frames.length > 1 && full.events.length);
  assert.ok(full.events.every((e) => e.time <= event.t));
  assert.ok(full.frames.some((f) => f.ships.some((s) => s.controller === event.commander)));
  const privateView = systemReplay(replay, { ...args, controller: event.commander }, physics);
  assert.ok(privateView.events.every((e) => e.controller === event.commander));
  assert.ok(
    privateView.frames.every((f) =>
      f.ships.every((s) => s.controller === event.commander || s.fuel === undefined),
    ),
  );
  const remote = systemReplay(replay, { ...args, lens: (event.site + 1) % cfg.systems }, physics);
  assert.deepEqual(remote.frames, []);
  assert.equal(remote.facilities, null);
  assert.deepEqual(systemReplay({}, args, null), { available: false });
  const transfer = replay.events.find((e) => e.title === 'Control transferred');
  assert.ok(transfer && replay.profiles[transfer.commander].promoted === transfer.t);
  assert.equal(
    replay.history[transfer.site].findLast((h) => h.t <= transfer.t).ruler,
    transfer.commander,
  );
});

test('a capture report travels home while the promoted commander governs independently', () => {
  const r = simulate({ seed: 1, scenario: 'corridor', count: 8, systems: 32, years: 150 });
  const win = r.events.find(
    (e) =>
      e.title === 'Control transferred' &&
      r.messages.some(
        (m) => m.controller === e.commander && m.status === 'Recall rejected' && m.time >= e.t,
      ),
  );
  assert.ok(win);
  const captain = r.profiles[win.commander];
  const delivered = r.messages.find(
    (m) =>
      m.controller === captain.parent &&
      m.source === captain.id &&
      m.status.includes('Control transferred'),
  );
  assert.ok(delivered);
  const a = r.chart[win.site],
    b = r.chart[win.target];
  const delay = travelMonths(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * r.scale, 1);
  assert.equal(delivered.time, win.t + delay);
  const council = r.messages.find((m) => m.status === 'Council directive received');
  assert.ok(council);
  const sent = r.messages.find(
    (m) =>
      m.controller === council.source &&
      m.source === council.controller &&
      m.status === 'Council directive sent' &&
      m.time < council.time,
  );
  assert.ok(sent);
  assert.equal(r.history[win.site].findLast((h) => h.t <= win.t).ruler, captain.id);
});

test('interstellar braking joins the local system at its actual entry position and velocity', () => {
  const layout = systemLayout(rng(9)),
    a = { x: 0, y: 1, z: 2 },
    b = { x: 4, y: 5, z: 7 },
    mapScale = 0.34;
  const path = departurePath(a, b, layout, 17, mapScale, 1 / 3);
  assert.deepEqual(routePosition(path, 0), path.start);
  const entry = routePosition(path, path.duration),
    center = [b.x, b.y, b.z];
  assert.ok(
    entry.every(
      (v, i) => Math.abs((v - center[i]) * mapScale * 63241.077 - 5.4 * path.direction[i]) < 1e-7,
    ),
  );
  assert.equal(cruiseState(path, path.duration).speed, 0);
  assert.ok(path.speed <= 1 / 3);
});
