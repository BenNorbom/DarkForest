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
});
test('a six-light-year route distinguishes departure, receipt, and arrival', () => {
  assert.equal(travelMonths(6, 1), 72);
  assert.equal(travelMonths(6, 1 / 3), 216);
  assert.equal(travelMonths(6, 0.2), 360);
  for (const e of replay.events.filter((e) => e.report)) {
    const a = replay.chart[e.site],
      b = replay.chart[e.target];
    const d = Math.hypot(a.x - b.x, a.y - b.y) * replay.scale;
    assert.ok(e.t - e.origin >= travelMonths(d, 1));
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
  for (const category of ['Battle', 'Science', 'Diplomacy']) {
    assert.ok(track.some((h) => h.category === category));
  }
  const opening = header(index).openingHighlight;
  assert.ok(opening);
  const beat = track.find((h) => h.category === 'Battle' && h.t < cfg.years * 12);
  const before = frame(index, { month: beat.t - 1, site: 0 });
  assert.equal(before.nextHighlight, beat.t);
  const after = frame(index, { month: beat.t + 1, followFrom: before.t, site: 0 });
  assert.equal(after.t, beat.t + 1);
  assert.equal(after.highlight.id, beat.e.id);
  assert.equal(after.selected, beat.e.site);
  assert.deepEqual(after.highlight.battle.strength, beat.e.combat);
  assert.ok(beat.e.combat.attack > 0 && beat.e.combat.defense >= 0);
  assert.equal(after.highlight.battle.captured, beat.e.title === 'Control transferred');
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
  const archived = indexReplay({ ...replay, events: replay.events.map(({ combat, ...e }) => e) });
  const olderBattle = frame(archived, { month: beat.t, site: beat.e.site, event: beat.e.id });
  assert.equal(olderBattle.highlight.battle.captured, after.highlight.battle.captured);
  assert.equal(olderBattle.highlight.battle.strength, null);
});
