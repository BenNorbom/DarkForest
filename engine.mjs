import { chooseAction, actionProbabilities, feedbackValue, learnFeedback } from './policy.mjs';

export const RULESET = 'parallax-1';
export const palette = [
  '#baf186',
  '#7bcafa',
  '#f2b274',
  '#c7a1f4',
  '#72d6bf',
  '#f392a4',
  '#c6ca7b',
  '#91a7ed',
];
export const programs = [
  'Long-endurance drives',
  'Compact habitats',
  'Passive interferometry',
  'Autonomous fabrication',
];
const roots =
  'Vesper Aster Nacre Serein Tethys Ardent Kepler Solace Morrow Carina Eidolon Cygnus Vale Tern Lyra Orison Cinder Halcyon Meridian Caelum Rook Seren Ithaca Corvus Altair Ember Vega Calyx Rhea Thales Selene Talus'.split(
    ' ',
  );
const suffixes = [
  '',
  ' Minor',
  ' Reach',
  ' B',
  ' Prime',
  ' Drift',
  ' Secundus',
  ' C',
  ' Deep',
  ' IX',
  ' Outer',
  ' Rim',
  ' Hollow',
  ' XII',
  ' Bay',
  ' Verge',
];
const society = [
  'Assembly',
  'Collective',
  'Accord',
  'Directorate',
  'Commonwealth',
  'League',
  'Union',
  'Compact',
];
export const names = {
  wait: 'Hold reserves',
  survey: 'Dispatch survey',
  settle: 'Establish refuge',
  trade: 'Exchange supplies',
  escort: 'Send relief',
  contest: 'Contest control',
  research: 'Fund research',
  secure: 'Raise readiness',
  signal: 'Offer passage',
};
export function hash(...args) {
  let h = 2166136261;
  for (const val of args) {
    const s = String(val);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    h = Math.imul(h ^ 31, 16777619);
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const round = (v) => Math.round(v * 10) / 10;
export const travelMonths = (distance, speed) => Math.max(1, Math.ceil((distance * 12) / speed - 1e-8));
export function simulate({
  seed = 7819,
  count = 64,
  systems = 240,
  years = 180,
  models = [],
  scenario = 'galaxy',
  detail = true,
  overrides = {},
} = {}) {
  count = Math.max(2, count | 0);
  systems = Math.max(count + 2, systems | 0);
  const rand = rng(hash(seed, 'map')),
    scale = (Math.sqrt(systems) * 3.25) / 100;
  const chart = Array.from({ length: systems }, (_, i) => ({
    id: i,
    name: roots[i % roots.length] + suffixes[Math.floor(i / roots.length) % suffixes.length],
    x: 4 + rand() * 92,
    y: 5 + rand() * 90,
    richness: 0.65 + rand() * 0.85,
    mineral: i % 3,
    home: i < count,
  }));
  if (scenario === 'corridor') {
    const set = (i, name, x, y) => Object.assign(chart[i], { name, x, y });
    set(0, 'Vesper', 43, 49);
    set(1, 'Orison', 43 + 6 / scale, 49);
    set(2, 'Nacre', 42, 49 + 7 / scale);
    set(count, 'Haven', 44 + 3 / scale, 49 + 2 / scale);
    set(count + 1, 'Lumen', 43 + 5 / scale, 49 - 3 / scale);
  }
  const seen = new Set();
  for (const s of chart) {
    if (seen.has(s.name)) s.name += ' Outer';
    seen.add(s.name);
  }
  const civs = chart.slice(0, count).map((s, i) => ({
    id: i,
    name: s.name + ' ' + society[i % society.length],
    color: palette[i % palette.length],
    model:
      models[i % Math.max(models.length, 1)]?.id ||
      models[i % Math.max(models.length, 1)]?.name ||
      'Reference',
    attacks: 0,
    trades: 0,
    colonies: 0,
    losses: 0,
    discoveries: 0,
  }));
  const dist = chart.map((a) => chart.map((b) => Math.hypot(a.x - b.x, a.y - b.y) * scale));
  const nearby = dist.map((row) =>
    row
      .map((_, i) => i)
      .sort((a, b) => row[a] - row[b])
      .slice(1),
  );
  const emitRoll = (...args) => hash(seed, ...args) / 4294967296;
  const sites = chart.map((s, i) => ({
    owner: i < count ? i : null,
    since: 0,
    pop: i < count ? 100 : 0,
    reserve: i < count ? 60 : 0,
    work: i < count ? 32 : 0,
    guard: i < count ? 6 : 0,
    tech: 0,
    progress: [0, 0, 0, 0],
    techLevel: 0,
    born: 0,
    depletion: Math.round((50 + rand() * 100) * 12),
    mature: i < count ? 60 : 0,
    next: 1 + Math.floor(rand() * 18),
    pulse: 12 + Math.floor(rand() * 30),
    epoch: 0,
    contacts: new Map(),
    relations: new Map(),
    transit: new Map(),
    grants: new Map(),
    market: new Map(),
    feedback: new Map(),
    lineages: i < count ? { [i]: 100 } : {},
    pending: 0,
  }));
  if (scenario === 'corridor') {
    sites[0].depletion = 600;
    sites[1].depletion = 120;
    sites[1].reserve = 24;
    sites[2].tech = 1;
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        if (a !== b)
          sites[a].contacts.set(b, {
            owner: b,
            guard: 5,
            pop: 100,
            t: -36,
            origin: -72,
            source: 'Archived survey',
          });
  }
  const events = [],
    decisions = [],
    flights = [],
    history = Array.from({ length: systems }, () => []),
    queue = new Map(),
    statistics = [],
    ledgers = [];
  const travellingPopulation = new Float64Array(count);
  let t = 0,
    eventId = 0;
  const schedule = (when, e) => {
    if (when > years * 12) return;
    const batch = queue.get(when);
    if (batch) batch.push(e);
    else queue.set(when, [e]);
  };
  function record(kind, site, owner, title, body, extra = {}) {
    if (!detail) return -1;
    const id = eventId++;
    events.push({ id, t, kind, site, owner, title, body, ...extra });
    return id;
  }
  function snapshot(i) {
    if (!detail) return;
    const s = sites[i],
      item = {
        t,
        owner: s.owner,
        since: s.since,
        pop: round(s.pop),
        reserve: round(s.reserve),
        work: round(s.work),
        guard: round(s.guard),
        tech: s.tech,
        viable: s.mature >= 60,
        lineages: Object.keys(s.lineages).map(Number),
      };
    if (history[i].at(-1)?.t === t) history[i].pop();
    history[i].push(item);
  }
  const intel = (i) => ({
    owner: sites[i].owner,
    guard: round(sites[i].guard),
    pop: round(sites[i].pop),
    tech: sites[i].tech,
  });
  function updateContact(i, j, data, origin, source, why = -1) {
    const s = sites[i];
    if (i === j || s.owner === null) return;
    const old = s.contacts.get(j);
    if (old && old.origin > origin) return;
    s.contacts.set(j, { ...data, t, origin, source });
    if (detail)
      record(
        'report',
        i,
        s.owner,
        source + ' · ' + chart[j].name,
        data.owner === null
          ? 'Survey found an unoccupied system.'
          : 'Signature attributed to ' +
              civs[data.owner].name +
              '. Estimated local strength ' +
              round(data.guard) +
              '.',
        { target: j, origin, sourceEvent: why, report: { ...data }, first: !old },
      );
  }
  function broadcast(i, source, why) {
    const s = sites[i],
      data = intel(i);
    for (const j of nearby[i]) {
      const d = dist[i][j];
      if (d > 18) break;
      const p = clamp((source === 'Launch trace' ? 1.05 : 0.75) - d / 24, 0.09, 0.9);
      const roll = emitRoll('sense', i, j, t, source);
      if (roll < p + 0.2)
        schedule(t + travelMonths(d, 1), {
          type: 'detect',
          i: j,
          j: i,
          data,
          origin: t,
          source,
          why,
          roll,
          p,
        });
    }
  }
  function options(i) {
    const s = sites[i],
      owner = s.owner,
      threat = [...s.contacts.entries()].reduce(
        (v, [j, c]) =>
          c.owner === null || c.owner === owner
            ? v
            : Math.max(
                v,
                clamp((c.guard + 3) / (s.guard + 8)) *
                  (1 - clamp(dist[i][j] / 24)) *
                  (0.6 + 0.4 * clamp((t - c.origin) / 180)),
              ),
        0,
      );
    const pressure = clamp(
      0.14 +
        0.48 * clamp((t - s.born) / s.depletion) +
        0.32 * (1 - clamp(s.reserve / 50)) +
        0.18 * threat,
    );
    const opts = [];
    const add = (kind, target, vals, project) =>
      opts.push({
        kind,
        target,
        features: [1, ...vals.map((x) => clamp(x))],
        feedback: feedbackValue(s.feedback, kind, target, t),
        ...(project === undefined ? {} : { project }),
      });
    add('wait', i, [
      pressure,
      0.12,
      0.06,
      threat,
      0.15,
      0.5,
      0.05,
      1 - clamp(s.reserve / 24),
      0.3,
      0,
      1,
    ]);
    if (s.work >= 5)
      add('secure', i, [
        pressure,
        clamp(0.56 + threat - s.guard / 26),
        0.18,
        threat,
        0.22,
        0.5,
        0.24,
        clamp(threat + 0.25 - s.guard / 30),
        0.8,
        0.08,
        1,
      ]);
    const projects = [0, 1, 2, 3].filter((p) => !(s.tech & (1 << p)));
    if (s.work >= 7 && projects.length) {
      const p = projects[(i + Math.floor(t / 120)) % projects.length];
      add('research', i, [pressure, 0.64, 0.12, 0.12, 0.4, 0.5, 0.35, pressure * 0.6, 0.72, 0.9, 1], p);
    }
    const range = s.tech & 1 ? 12 : 8;
    for (const j of nearby[i]) {
      const d = dist[i][j];
      if (d > range) break;
      if (opts.length > 36) break;
      const c = s.contacts.get(j),
        known = !!c,
        empty = known && c.owner === null,
        other = known && !empty && c.owner !== owner,
        own = known && c.owner === owner;
      const stale = known ? clamp((t - c.origin) / 240) : 1,
        reach = 1 - (0.65 * d) / range;
      const trust = other ? clamp(0.48 + (s.relations.get(c.owner) || 0)) : 0.5;
      const lead =
        c?.tech == null ? 0 : [1, 2, 4, 8].filter((bit) => c.tech & bit && !(s.tech & bit)).length;
      const power = clamp((c?.guard ?? 5) / (s.guard + 5)),
        opp = other ? clamp(power + 0.2 * stale + 0.08 * lead) : 0.18;
      const gain = clamp(chart[j].richness / 1.6),
        comp = chart[j].mineral !== chart[i].mineral ? 1 : 0.36;
      if ((s.transit.get(j) || 0) > t) continue;
      if (!known && s.work >= 3)
        add('survey', j, [pressure, 0.57 + 0.24 * gain, 0.18, 0.16, 1, 0.5, 0.13, 0.4, 0.7, 1, reach]);
      if (
        (!known || empty) &&
        s.pop >= 29 &&
        (s.lineages[owner] || 0) >= 10 &&
        s.reserve >= 9 &&
        s.work >= (s.tech & 2 ? 6 : 12)
      )
        add('settle', j, [
          pressure,
          clamp(0.53 + 0.24 * gain + 0.22 * pressure),
          0.57,
          opp,
          known ? stale : 0.7,
          0.5,
          0.52,
          pressure,
          0.68,
          known ? 0.63 : 0.95,
          reach,
        ]);
      if (other) {
        if (s.reserve >= 7 && s.work >= 3)
          add('trade', j, [
            pressure,
            0.34 + 0.44 * comp,
            0.37,
            opp,
            stale,
            trust,
            0.22,
            pressure * 0.8,
            0.7,
            0.34,
            reach,
          ]);
        if (s.guard >= 3.8 && s.reserve >= 6 && s.work >= 6) {
          const leverage = clamp((s.guard * 0.8 + 2) / (c.guard + 3.3));
          add('contest', j, [
            pressure,
            clamp(0.28 + 0.27 * gain + 0.31 * leverage + 0.18 * (1 - trust)),
            0.8,
            opp,
            stale,
            trust,
            0.59,
            clamp(0.32 + pressure * 0.5 + threat * 0.24),
            leverage,
            0.4,
            reach,
          ]);
        }
        if ((s.grants.get(c.owner) ?? -1) < t && s.work >= 2)
          add('signal', j, [
            pressure,
            0.52 * comp,
            0.54,
            opp,
            stale,
            trust,
            0.09,
            0.25,
            0.57,
            0.52,
            reach,
          ]);
      }
      if (own && s.reserve >= 12 && s.work >= 3)
        add('escort', j, [
          pressure,
          0.4 + 0.35 * (1 - clamp(c.guard / 10)),
          0.38,
          0.16,
          stale,
          0.95,
          0.3,
          0.49,
          0.74,
          0.12,
          reach,
        ]);
    }
    return opts;
  }
  function embark(i, opt, key, why) {
    const s = sites[i],
      j = opt.target,
      k = opt.kind,
      owner = s.owner;
    const speed = k === 'contest' || k === 'survey' ? 1 / 3 : 0.2;
    const end = t + travelMonths(dist[i][j], speed);
    const troops = k === 'contest' ? s.guard * 0.72 : k === 'escort' ? Math.min(2, s.guard * 0.25) : 0;
    const settlers =
      k === 'settle'
        ? Math.min(20, s.lineages[owner] || 0)
        : k === 'contest'
          ? Math.min(7, (s.lineages[owner] || 0) * 0.14)
          : 0;
    if (k === 'settle' && settlers < 1) return;
    const cost = { settle: s.tech & 2 ? 6 : 12, contest: 6, trade: 3, survey: 3, escort: 3 }[k];
    s.work -= cost;
    s.reserve -= { settle: 9, contest: 6, trade: 7, survey: 0, escort: 12 }[k];
    s.guard -= troops;
    if (settlers) {
      s.pop -= settlers;
      s.lineages[owner] -= settlers;
      travellingPopulation[owner] += settlers;
    }
    s.transit.set(j, end + 12);
    s.pending++;
    if (k === 'contest') civs[owner].attacks++;
    const data = intel(i),
      flight = {
        type: 'arrival',
        i: j,
        j: i,
        k,
        owner,
        troops,
        settlers,
        data,
        origin: t,
        key,
        why,
        tech: s.tech,
      };
    schedule(end, flight);
    if (detail) flights.push({ from: i, to: j, start: t, end, owner, kind: k, why });
    broadcast(i, 'Launch trace', why);
  }
  function act(i, opt, opts, prob, key) {
    const s = sites[i],
      owner = s.owner,
      k = opt.kind,
      j = opt.target;
    const why = record(
      'order',
      i,
      owner,
      names[k],
      k === 'research'
        ? programs[opt.project] + ' receives local industrial work.'
        : k === 'wait'
          ? 'Local reserves retained.'
          : k === 'secure'
            ? 'Industrial work moves into local defense.'
            : chart[i].name + ' to ' + chart[j].name + '.',
      { target: j, decision: key, action: k },
    );
    if (detail)
      decisions.push({
        key,
        t,
        site: i,
        owner,
        why,
        chosen: opts.indexOf(opt),
        options: opts.map((o, n) => ({
          kind: o.kind,
          target: o.target,
          p: Math.round(prob[n] * 1000) / 1000,
          project: o.project,
        })),
        reserve: round(s.reserve),
        guard: round(s.guard),
        reports: s.contacts.size,
        evidence: j === i ? null : s.contacts.get(j) || null,
        feedback: round(opt.feedback),
        opposition: round(opt.features[4]),
        urgency: round(opt.features[8]),
      });
    if (k === 'research') {
      s.work -= 7;
      const p = opt.project;
      s.progress[p] += 7;
      const threshold = 6 - 17 * Math.log(Math.max(0.003, 1 - emitRoll('research', i, owner, p)));
      if (s.progress[p] >= threshold) {
        s.tech |= 1 << p;
        civs[owner].discoveries++;
        record('discovery', i, owner, programs[p], chart[i].name + ' can now deploy this technology.');
      }
    } else if (k === 'secure') {
      s.work -= 5;
      s.guard += 2.8;
    } else if (k === 'signal') {
      s.work -= 2;
      const peer = s.contacts.get(j)?.owner;
      s.grants.set(peer, t + 360);
      const end = t + travelMonths(dist[i][j], 1);
      schedule(end, { type: 'offer', i: j, j: i, data: intel(i), origin: t, why });
      if (detail) flights.push({ from: i, to: j, start: t, end, owner, kind: 'signal', why });
    } else if (k !== 'wait') embark(i, opt, key, why);
    snapshot(i);
  }
  function arrive(e) {
    const { i, j, k, owner } = e,
      s = sites[i],
      from = sites[j],
      previous = s.owner;
    if (from.owner === owner) from.pending = Math.max(0, from.pending - 1);
    let kind = 'arrival',
      title = 'Survey completed',
      body = chart[i].name + ' was surveyed.',
      reply = 'Survey return',
      bonus = 0;
    const defense = k === 'contest' && previous !== null && previous !== owner ? s.guard : null;
    if (k === 'settle') {
      if (s.owner === null) {
        Object.assign(s, {
          owner,
          since: t,
          born: t,
          pop: e.settlers,
          reserve: 17,
          work: 8,
          guard: 2,
          mature: 0,
          tech: e.tech,
          next: t + 18,
          pulse: t + 24,
          pending: 0,
          lineages: { [owner]: e.settlers },
        });
        s.contacts.clear();
        s.relations.clear();
        s.grants.clear();
        s.transit.clear();
        s.market.clear();
        s.feedback.clear();
        travellingPopulation[owner] -= e.settlers;
        civs[owner].colonies++;
        kind = 'colony';
        title = 'Refuge established';
        body = civs[owner].name + ' founded a settlement at ' + chart[i].name + '.';
      } else if (s.owner === owner || (s.grants.get(owner) ?? -1) >= t) {
        s.lineages[owner] = (s.lineages[owner] || 0) + e.settlers;
        s.pop += e.settlers;
        travellingPopulation[owner] -= e.settlers;
        title = 'Settlers received';
        body = chart[i].name + ' accepted ' + round(e.settlers) + ' population units.';
      } else {
        title = 'Landing refused';
        body = 'The expedition is returning to ' + chart[j].name + '.';
        schedule(t + travelMonths(dist[i][j], 0.2), { type: 'return', i: j, owner, pop: e.settlers });
      }
    }
    if (k === 'trade') {
      const access = (s.grants.get(owner) ?? -1) >= t,
        trust = s.relations.get(owner) || 0;
      const accepted =
        s.owner !== null &&
        s.work >= 2 &&
        (s.owner === owner ||
          access ||
          (trust > -0.24 && emitRoll('market', i, j, t) < clamp(0.66 + trust, 0.1, 0.94)));
      if (accepted) {
        const commodity = chart[j].mineral,
          demand = clamp((t - (s.market.get(commodity) ?? -120)) / 90, 0.25, 1);
        s.work -= 2;
        s.market.set(commodity, t);
        s.reserve += 5;
        bonus = 4 + demand * (chart[i].mineral !== commodity ? 10 : 3);
        civs[owner].trades++;
        s.relations.set(owner, clamp(trust + 0.12, -0.8, 0.5));
        kind = 'trade';
        title = 'Exchange completed';
        body =
          'Cargo exchanged. ' + round(bonus) + ' supply units are returning to ' + chart[j].name + '.';
      } else {
        title = 'Exchange declined';
        body = 'The carrier found no willing trading partner.';
      }
    }
    if (k === 'escort') {
      if (s.owner === owner) {
        s.reserve += 10;
        s.guard += e.troops;
        title = 'Relief convoy arrived';
        body = 'Stores and escort strength transferred to the settlement.';
      } else {
        title = 'Convoy recalled';
        body = 'Control at the destination changed.';
        schedule(t + travelMonths(dist[i][j], 0.2), { type: 'return', i: j, owner, troops: e.troops });
      }
    }
    if (k === 'contest') {
      kind = 'conflict';
      if (s.owner === owner) {
        s.guard += e.troops;
        title = 'Reinforcements arrived';
        body = 'The site is now under friendly control.';
      } else if (s.owner !== null && e.troops >= 1.25 * Math.max(0.5, s.guard)) {
        civs[s.owner].losses++;
        s.owner = owner;
        s.since = t;
        s.epoch++;
        s.guard = Math.max(1, e.troops - 0.55 * s.guard);
        s.reserve *= 0.84;
        s.pending = 0;
        s.contacts.clear();
        s.relations.clear();
        s.transit.clear();
        s.grants.clear();
        s.feedback.clear();
        s.relations.set(previous, -0.64);
        title = 'Control transferred';
        body =
          civs[owner].name + ' took control of ' + chart[i].name + '. Resident lineages remain on site.';
        reply = 'Control confirmed';
      } else {
        const defended = s.owner !== null;
        s.guard = Math.max(0, s.guard - e.troops * 0.48);
        if (defended) s.relations.set(owner, -0.72);
        title = defended ? 'Expedition repelled' : 'Expedition withdrew';
        body = defended
          ? 'The local garrison retained control. Survivors are returning.'
          : 'The site was unoccupied when the expedition arrived.';
        reply = title;
        schedule(t + travelMonths(dist[i][j], 1 / 3), {
          type: 'return',
          i: j,
          owner,
          troops: e.troops * (defended ? 0.42 : 1),
          pop: e.settlers,
        });
      }
      if (s.owner === owner && e.settlers) {
        s.pop += e.settlers;
        s.lineages[owner] = (s.lineages[owner] || 0) + e.settlers;
        travellingPopulation[owner] -= e.settlers;
      }
    }
    const local = record(kind, i, s.owner ?? owner, title, body, {
      actor: owner,
      target: j,
      action: k,
      sourceEvent: e.why,
      previous,
      ...(detail && defense !== null
        ? { combat: { attack: round(e.troops), defense: round(defense) } }
        : {}),
    });
    if (s.owner !== null && s.owner !== owner)
      updateContact(i, j, e.data, e.origin, 'Expedition identified', e.why);
    if (s.owner === owner) updateContact(i, j, e.data, e.origin, 'Expedition manifest', e.why);
    if (k !== 'survey') reply = title + ' · mission report';
    const outcome =
      k === 'trade'
        ? bonus > 7
          ? 0.9
          : -0.6
        : k === 'contest'
          ? s.owner === owner
            ? 1
            : -1
          : k === 'settle'
            ? s.owner === owner
              ? 1
              : -0.6
            : k === 'escort'
              ? s.owner === owner
                ? 0.7
                : -0.6
              : 0.35;
    schedule(t + travelMonths(dist[i][j], 1), {
      type: 'reply',
      i: j,
      j: i,
      data: intel(i),
      origin: t,
      owner,
      k,
      outcome,
      source: reply,
      why: local,
      relation: k === 'contest' ? -0.32 : k === 'trade' && bonus ? 0.12 : 0,
    });
    if (bonus)
      schedule(t + travelMonths(dist[i][j], 0.2), { type: 'return', i: j, owner, supply: bonus });
    snapshot(i);
  }
  function deliver(e) {
    const s = sites[e.i];
    if (e.type === 'arrival') {
      arrive(e);
      return;
    }
    if (e.type === 'return' && e.pop) travellingPopulation[e.owner] -= e.pop;
    if (e.type === 'detect') {
      if (e.roll < e.p + (s.tech & 4 ? 0.2 : 0)) {
        const noise = s.tech & 4 ? 0.12 : 0.35;
        const estimated = {
          ...e.data,
          guard: Math.max(
            0,
            Math.round(e.data.guard * (1 + (2 * emitRoll('estimate', e.i, e.j, e.origin) - 1) * noise)),
          ),
          pop: Math.round(e.data.pop / 10) * 10,
          tech: null,
        };
        updateContact(e.i, e.j, estimated, e.origin, e.source, e.why);
      }
    } else if (e.type === 'offer' && s.owner !== null) {
      updateContact(e.i, e.j, e.data, e.origin, 'Passage offer', e.why);
      s.relations.set(e.data.owner, clamp((s.relations.get(e.data.owner) || 0) + 0.07, -0.8, 0.5));
    } else if (s.owner === e.owner) {
      if (e.type === 'reply') {
        learnFeedback(s.feedback, e.k, e.j, t, e.outcome);
        if ((s.contacts.get(e.j)?.origin ?? -Infinity) > e.origin)
          record(
            'receipt',
            e.i,
            s.owner,
            e.source,
            'The mission outcome reached the controller after a newer observation of this site.',
            { target: e.j, origin: e.origin, sourceEvent: e.why },
          );
        updateContact(e.i, e.j, e.data, e.origin, e.source, e.why);
        if (e.data.owner !== null && e.relation)
          s.relations.set(
            e.data.owner,
            clamp((s.relations.get(e.data.owner) || 0) + e.relation, -0.8, 0.5),
          );
      }
      if (e.type === 'return') {
        s.reserve += e.supply || 0;
        s.guard += e.troops || 0;
        if (e.pop) {
          s.pop += e.pop;
          s.lineages[e.owner] = (s.lineages[e.owner] || 0) + e.pop;
        }
        snapshot(e.i);
      }
    }
  }
  function lineageLedger() {
    const rows = civs.map((c) => ({
      id: c.id,
      population: Math.max(0, travellingPopulation[c.id]),
      viable: 0,
      sites: 0,
      focus: null,
      attacks: c.attacks,
      trades: c.trades,
    }));
    sites.forEach((s, i) => {
      if (s.owner === null) return;
      const ruler = rows[s.owner];
      ruler.sites++;
      ruler.focus ??= i;
      for (const [id, pop] of Object.entries(s.lineages)) {
        const row = rows[id];
        row.population += pop;
        if (pop >= 2 && s.mature >= 60) row.viable++;
      }
    });
    for (const row of rows) row.population = round(row.population);
    ledgers.push({ t, rows });
  }
  for (let i = 0; i < systems; i++) snapshot(i);
  if (detail) lineageLedger();
  if (detail && scenario === 'corridor')
    for (let i = 0; i < 3; i++)
      for (const [j, c] of sites[i].contacts)
        record(
          'report',
          i,
          i,
          'Archived survey · ' + chart[j].name,
          'Last survey estimates precede the opening of this record.',
          {
            target: j,
            origin: c.origin,
            report: { owner: c.owner, guard: c.guard, pop: c.pop, tech: 0 },
          },
        );
  for (t = 1; t <= years * 12; t++) {
    const due = queue.get(t);
    if (due) {
      due.sort(
        (a, b) =>
          (a.type === 'arrival') - (b.type === 'arrival') ||
          hash(seed, t, a.i, a.j, a.k, a.type) - hash(seed, t, b.i, b.j, b.k, b.type),
      );
      for (const e of due) deliver(e);
      queue.delete(t);
    }
    const orders = [];
    for (let i = 0; i < systems; i++) {
      const s = sites[i];
      if (s.owner === null) continue;
      const age = t - s.born,
        capacity =
          clamp(1.22 - (0.79 * age) / s.depletion, 0.24, 1.22) *
          chart[i].richness *
          (s.tech & 8 ? 1.45 : 1);
      const supplyProduction = capacity * Math.min(1.6, s.pop / 60);
      s.reserve = Math.min(110, s.reserve + supplyProduction - 0.012 * s.pop - 0.018 * s.guard);
      if (s.reserve < 0) {
        const lost = Math.min(s.pop, Math.max(0.04, -s.reserve * 0.8));
        const factor = 1 - lost / Math.max(0.01, s.pop);
        for (const id of Object.keys(s.lineages)) s.lineages[id] *= factor;
        s.pop -= lost;
        s.guard *= 0.987;
        s.reserve = 0;
      } else if (s.reserve > 16 && s.pop < 125) {
        const growth = 0.0012 * s.pop;
        for (const id of Object.keys(s.lineages)) s.lineages[id] *= 1.0012;
        s.pop += growth;
      }
      s.work = Math.min(64, s.work + 0.17 + 1.12 * Math.min(1.3, s.pop / 95));
      s.mature =
        s.reserve >= 0.012 * s.pop * 12 && supplyProduction >= s.pop * 0.012
          ? Math.min(60, s.mature + 1)
          : 0;
      if (s.pop < 2) {
        record(
          'collapse',
          i,
          s.owner,
          'Settlement lost',
          'Local stores and population fell below the recovery threshold.',
        );
        s.owner = null;
        s.pop = 0;
        s.guard = 0;
        s.lineages = {};
        s.contacts.clear();
        s.mature = 0;
        snapshot(i);
        continue;
      }
      if (t >= s.pulse) {
        broadcast(i, 'Industrial trace', -1);
        s.pulse = t + 36 + Math.floor(emitRoll('pulse', t, i) * 48);
      }
      if ((t + 17 * i) % 576 === 0) {
        const data = intel(i);
        for (const j of nearby[i].slice(0, Math.max(6, Math.ceil(systems / count) * 3)))
          schedule(t + travelMonths(dist[i][j], 1), {
            type: 'detect',
            i: j,
            j: i,
            data,
            origin: t,
            source: 'Deep-sky survey',
            why: -1,
            roll: 0,
            p: 1,
          });
      }
      if (t >= s.next) {
        const opts = options(i),
          key = [t, i, s.owner].join('-'),
          m = models[s.owner % Math.max(models.length, 1)],
          random = rng(hash(seed, 'policy', key));
        let ix = chooseAction({ options: opts }, m, random);
        const replace = overrides[key];
        if (Number.isInteger(replace) && opts[replace]) ix = replace;
        const prob = detail ? actionProbabilities({ options: opts }, m) : [];
        orders.push([i, opts[ix] ?? opts[0], opts, prob, key]);
        s.next = t + 24 + Math.floor(emitRoll('review', i, t) * 18);
      }
      if (t % 12 === 0) snapshot(i);
    }
    for (const args of orders) act(...args);
    if (detail && t % 12 === 0) {
      lineageLedger();
      statistics.push({
        t,
        sites: sites.filter((s) => s.owner !== null).length,
        population: Math.round(sites.reduce((a, s) => a + s.pop, 0)),
        attacks: civs.reduce((a, c) => a + c.attacks, 0),
        trades: civs.reduce((a, c) => a + c.trades, 0),
      });
    }
  }
  const byCiv = civs.map((c) => {
    const owned = sites.filter((s) => s.owner === c.id),
      viable = sites.filter((s) => s.mature >= 60 && (s.lineages[c.id] || 0) >= 2).length,
      population = sites.reduce(
        (a, s) => a + (s.lineages[c.id] || 0),
        Math.max(0, travellingPopulation[c.id]),
      );
    return {
      ...c,
      alive: population >= 2,
      viable,
      settlements: owned.length,
      population: round(population),
    };
  });
  const metrics = {
    byCiv,
    ...Object.fromEntries(
      ['attacks', 'trades', 'colonies', 'losses', 'discoveries'].map((k) => [
        k,
        civs.reduce((a, c) => a + c[k], 0),
      ]),
    ),
  };
  return detail
    ? {
        version: RULESET,
        seed,
        count,
        years,
        scenario,
        chart,
        civs: civs.map(({ id, name, color, model }) => ({ id, name, color, model })),
        scale,
        events,
        flights,
        decisions,
        history,
        statistics,
        ledgers,
        metrics,
      }
    : { metrics };
}
