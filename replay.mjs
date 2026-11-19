const lastIndex = (rows, t, field = 't') => {
  let lo = 0,
    hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rows[mid][field] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
};
const latest = (rows, t) => rows[lastIndex(rows, t)];
const isContest = (e) =>
  e?.kind === 'conflict' && ['Control transferred', 'Expedition repelled'].includes(e.title);
const isPassage = (e) => e.kind === 'report' && e.title.startsWith('Passage offer · ');
const isForeignTrade = (e) => e.kind === 'trade' && e.actor != null && e.actor !== e.previous;
const localPriority = (e) =>
  isContest(e) ? 4 : e.kind === 'discovery' || isPassage(e) ? 3 : e.first ? 1 : 2;

function highlightTrack(run) {
  const candidates = [],
    technologies = new Set(),
    exchanges = new Set();
  for (const e of run.events) {
    let category, weight;
    if (isContest(e)) {
      category = 'Conflict';
      weight = (e.title === 'Control transferred' ? 76 : 66) + (run.chart[e.site].home ? 9 : 0);
      weight += Math.min(18, ((e.combat?.attack ?? 0) + (e.combat?.defense ?? 0)) / 5);
    } else if (e.kind === 'discovery') {
      category = 'Science';
      const tech = `${e.owner}/${e.title}`;
      weight = technologies.has(tech) ? 41 : 69;
      technologies.add(tech);
    } else if (isPassage(e) || isForeignTrade(e)) {
      category = 'Diplomacy';
      const pair = [e.owner, isPassage(e) ? e.report.owner : e.actor].sort().join('/');
      weight = isPassage(e) ? 68 : exchanges.has(pair) ? 44 : 72;
      if (isForeignTrade(e)) exchanges.add(pair);
    } else if (e.kind === 'colony' || e.kind === 'collapse') {
      category = e.kind === 'colony' ? 'Expansion' : 'Survival';
      weight = e.kind === 'colony' ? 35 : run.chart[e.site].home ? 69 : 46;
    } else continue;
    candidates.push({ t: e.t, e, category, weight });
  }

  const track = [],
    types = new Map(),
    sites = new Map();
  for (let i = 0; i < candidates.length; ) {
    const start = candidates[i].t;
    const score = (c) =>
      c.weight -
      (start - (types.get(c.category) ?? -Infinity) < 85 ? 32 : 0) -
      (start - (sites.get(c.e.site) ?? -Infinity) < 62 ? 16 : 0);
    let best = candidates[i++];
    while (i < candidates.length && candidates[i].t <= start + 11) {
      const c = candidates[i++];
      if (score(c) > score(best)) best = c;
    }
    track.push(best);
    types.set(best.category, best.t);
    sites.set(best.e.site, best.t);
    while (i < candidates.length && candidates[i].t < best.t + 25) i++;
  }
  return track;
}

function describeHighlight(run, e, category) {
  if (!e) return null;
  return {
    ...e,
    category:
      category ??
      (e.kind === 'conflict'
        ? 'Conflict'
        : e.kind === 'discovery'
          ? 'Science'
          : isPassage(e) || e.kind === 'trade'
            ? 'Diplomacy'
            : e.kind === 'colony'
              ? 'Expansion'
              : e.kind === 'collapse'
                ? 'Survival'
                : 'Intelligence'),
    system: run.chart[e.site].name,
    originSystem: run.chart[e.target]?.name,
  };
}

export function indexReplay(run) {
  const bySite = run.chart.map(() => []),
    orders = run.chart.map(() => []),
    reports = run.chart.map(() => new Map());
  const decision = new Map(),
    salient = [],
    localBeats = run.chart.map(() => []),
    localNews = run.chart.map(() => []),
    globalLog = [];
  for (const e of run.events) {
    bySite[e.site].push(e);
    if (e.report) {
      let list = reports[e.site].get(e.target);
      if (!list) reports[e.site].set(e.target, (list = []));
      list.push(e);
    }
    const major =
      ['conflict', 'colony', 'collapse', 'discovery', 'trade'].includes(e.kind) || isPassage(e);
    if (major || e.first) localBeats[e.site].push(e);
    if (
      major || e.first || e.kind === 'receipt' ||
      (e.kind === 'report' && /mission report|Survey return/.test(e.title)) ||
      ['Relief convoy arrived', 'Convoy recalled'].includes(e.title)
    )
      localNews[e.site].push(e);
    if (major) salient.push(e);
    if (e.kind !== 'report' || e.first) globalLog.push(e);
  }
  for (const d of run.decisions) {
    orders[d.site].push(d);
    decision.set(d.key, d);
  }
  const maxFlight = run.flights.reduce((v, f) => Math.max(v, f.end - f.start), 0);
  return {
    run,
    bySite,
    orders,
    reports,
    decision,
    salient,
    localBeats,
    localNews,
    globalLog,
    maxFlight,
    track: highlightTrack(run),
  };
}
function pickRecent(list, t, limit, filter = () => true, offset = 0) {
  const result = [];
  let skip = offset;
  for (let i = lastIndex(list, t); i >= 0 && result.length < limit; i--) {
    const e = list[i];
    if (!filter(e)) continue;
    if (skip) {
      skip--;
      continue;
    }
    result.push(e);
  }
  return result;
}
export function header(idx) {
  const r = idx.run;
  const opening =
    idx.bySite[0].find(
      (e) =>
        e.t >= 48 &&
        e.t < 500 &&
        (e.kind === 'conflict' || (e.kind === 'order' && e.action === 'contest')),
    ) ?? idx.bySite[0].find((e) => e.t >= 48 && e.kind === 'order');
  const upcoming = lastIndex(idx.track, opening?.t ?? 0) + 1;
  const openingHighlight =
    idx.track.slice(upcoming, upcoming + 4).find((h) => h.category === 'Conflict') ??
    idx.track[upcoming] ??
    idx.track.at(-1);
  return {
    version: r.version,
    seed: r.seed,
    years: r.years,
    count: r.count,
    scenario: r.scenario,
    systems: r.chart.length,
    opening: opening?.t ?? 0,
    openingHighlight: openingHighlight
      ? { t: openingHighlight.t, site: openingHighlight.e.site, id: openingHighlight.e.id }
      : null,
    chart: r.chart.map(({ id, name }) => ({ id, name })),
  };
}
export function frame(idx, { month = 0, site = 0, lens = -1, event = -1, followFrom } = {}) {
  const r = idx.run,
    t = Math.min(Math.max(0, month | 0), r.years * 12);
  site = r.chart[site] ? site : 0;
  lens = r.chart[lens] ? lens : -1;
  const anchor = lens < 0 ? null : latest(r.history[lens], t);
  const canSee = (e) =>
    lens < 0 ||
    (e.site === lens && anchor?.owner !== null && e.owner === anchor.owner && e.t >= anchor.since);
  const log = idx.localBeats[lens < 0 ? site : lens];
  let last = lastIndex(log, t);
  while (last >= 0 && !canSee(log[last])) last--;
  let localEvent = log[last];
  if (lens >= 0 && localEvent) {
    for (let i = last - 1; log[i]?.t === localEvent.t; i--) {
      if (canSee(log[i]) && localPriority(log[i]) > localPriority(localEvent)) localEvent = log[i];
    }
  }
  const globalBeat = lens < 0 ? lastIndex(idx.track, t) : -1;
  const highlight = lens < 0 ? idx.track[globalBeat] : { t: localEvent?.t, e: localEvent };
  const crossed = followFrom != null && highlight?.t > followFrom;
  if (crossed) site = highlight.e.site;
  const info = r.chart.map((c, i) => {
    if (lens < 0 || i === lens)
      return { ...latest(r.history[i], t), known: true, stale: 0, home: c.home };
    const ev = latest(idx.reports[lens].get(i) ?? [], t);
    if (ev && canSee(ev))
      return {
        ...ev.report,
        known: true,
        stale: Math.max(0, (t - ev.origin) / 12),
        origin: ev.origin,
        received: ev.t,
        source: ev.title,
        home: false,
      };
    return { owner: null, known: false, stale: 0, home: false };
  });
  const systems = r.chart.map(({ id, x, y, z = 0, name }, i) => {
    const { owner, known, stale, home } = info[i];
    return { id, x, y, z, name, owner, known, stale, home, color: r.civs[owner]?.color };
  });
  const active = [];
  for (let i = lastIndex(r.flights, t, 'start'); i >= 0; i--) {
    const f = r.flights[i];
    if (f.start < t - idx.maxFlight) break;
    if (
      f.end > t &&
      (lens < 0 || (f.from === lens && f.start >= anchor.since && f.owner === anchor.owner))
    )
      active.push({ ...f, color: r.civs[f.owner]?.color, start: f.start / 12, end: f.end / 12 });
  }
  const scoped = lens < 0 ? site : lens;
  const feed = pickRecent(
    idx.bySite[scoped],
    t,
    8,
    (e) =>
      canSee(e) &&
      (e.kind !== 'report' ||
        e.first ||
        !['Industrial trace', 'Launch trace'].some((x) => e.title.startsWith(x))),
  );
  const selected = r.events[event],
    allowed = selected && selected.t <= t && canSee(selected);
  const chosen =
    allowed && selected.decision ? idx.decision.get(selected.decision) : latest(idx.orders[site], t);
  const visibleDecision =
    chosen &&
    (lens < 0 || (chosen.site === lens && chosen.owner === anchor.owner && chosen.t >= anchor.since))
      ? chosen
      : null;
  const from = lastIndex(log, t) + 1;
  let next = null;
  for (let i = from; i < log.length; i++) {
    if (lens < 0 || canSee(log[i])) {
      next = log[i].t;
      break;
    }
  }
  const nextHighlight = lens < 0 ? (idx.track[globalBeat + 1]?.t ?? null) : next;
  const localMoment = allowed ? selected : crossed || highlight?.t === t ? highlight.e : null;
  const state = info[site],
    civ = r.civs[state.owner];
  return {
    t,
    systems,
    year: t / 12,
    selected: site,
    view: lens < 0 ? 'galaxy' : 'local',
    fleets: active.filter((f) => f.kind !== 'signal'),
    signals: active.filter((f) => f.kind === 'signal'),
    site: {
      ...state,
      name: r.chart[site].name,
      faction: civ?.name,
      model: lens < 0 || site === lens ? civ?.model : null,
    },
    feed,
    news: pickRecent(lens < 0 ? idx.salient : idx.localNews[lens], t, 24, canSee)
      .map((e) => describeHighlight(r, e)),
    decision: visibleDecision,
    nextBeat: next,
    nextHighlight,
    highlight: describeHighlight(
      r,
      localMoment,
      localMoment === highlight?.e ? highlight.category : null,
    ),
    lastBeat: last >= 0 ? log[last].t : null,
    currentEvent: allowed ? selected : null,
    source:
      allowed && r.events[selected.sourceEvent] && canSee(r.events[selected.sourceEvent])
        ? r.events[selected.sourceEvent]
        : null,
    stats:
      lens < 0
        ? (latest(r.statistics, t) ?? {
            sites: r.count,
            population: r.count * 100,
            attacks: 0,
            trades: 0,
          })
        : null,
  };
}
export function chronicle(
  idx,
  { month, site = 0, lens = -1, filter = 'major', scope = 'region', offset = 0 },
) {
  const r = idx.run,
    t = Math.min(month ?? r.years * 12, r.years * 12);
  const anchor = lens >= 0 ? latest(r.history[lens] ?? [], t) : null;
  const source =
    lens >= 0
      ? idx.bySite[lens]
      : scope === 'region'
        ? idx.bySite[site]
        : filter === 'major'
          ? idx.salient
          : r.events;
  return pickRecent(
    source ?? [],
    t,
    41,
    (e) =>
      (!anchor || (anchor.owner !== null && anchor.owner === e.owner && anchor.since <= e.t)) &&
      (filter === 'all' ||
        (filter === 'major'
          ? ['conflict', 'trade', 'colony', 'discovery', 'collapse'].includes(e.kind) ||
            e.first ||
            isPassage(e)
          : e.kind === filter)),
    offset,
  );
}
export function ledger(idx, month) {
  const item = latest(idx.run.ledgers ?? [], month);
  return item
    ? { t: item.t, rows: item.rows.map((row) => ({ ...idx.run.civs[row.id], ...row })) }
    : null;
}
