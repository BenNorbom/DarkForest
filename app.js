import { createStarMap } from './starfield.js';
const $ = (id) => document.getElementById(id);
const labels = {
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
const tech = [
  'Long-endurance drives',
  'Compact habitats',
  'Passive interferometry',
  'Autonomous fabrication',
];
const esc = (v) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const date = (t) =>
  'Year ' + Math.floor(t / 12) + ' · M' + String((((t % 12) + 12) % 12) + 1).padStart(2, '0');
const btn = (id, label) => '<button id="' + id + '">' + esc(label) + '</button>';
let runId,
  meta,
  branch,
  parent,
  month = 0,
  selected = 0,
  lens = -1,
  frame,
  tab = 'observatory',
  playing = false,
  carry = 0,
  prev = 0,
  requestNo = 0,
  loadNo = 0,
  logPage = 0,
  logToken = 0,
  playBusy = false,
  lastAdvance = 0,
  lastRender = 0;
let signalReplay = null,
  renderedLog = [],
  compareToken = 0;
let feature = null,
  directorFrom = 0;
const followEnabled = () => $('followAction').checked;
const nextHighlight = () => (followEnabled() ? frame?.nextHighlight : frame?.nextBeat);
const accents = {
  Conflict: '#ffae8c',
  Science: '#b8deff',
  Diplomacy: '#bde996',
  Expansion: '#97dfe6',
  Survival: '#edc18c',
};
const chart = createStarMap($('sky'), (id) => {
  if (!meta) return;
  openInspector();
  void selectSite(id).catch(showError);
});
const status = (text) => {
  $('status').textContent = text;
};
function showError(e) {
  $('notice').hidden = false;
  $('notice').textContent = e.message || String(e);
  status('Action unavailable');
}
async function api(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || response.statusText);
  return data;
}
function safely(fn) {
  return (...a) =>
    Promise.resolve()
      .then(() => fn(...a))
      .catch(showError);
}
const hook = (id, fn, event = 'click') => $(id).addEventListener(event, safely(fn));
const endpoint = (op, params = {}, id = runId) =>
  '/api/' + id + '/' + op + '?' + new URLSearchParams(params);
function stop() {
  playing = false;
  carry = 0;
  prev = 0;
  $('play').textContent = '▶ Play';
  $('play').setAttribute('aria-pressed', 'false');
}
function begin() {
  playing = true;
  prev = 0;
  $('play').textContent = 'Ⅱ Pause';
  $('play').setAttribute('aria-pressed', 'true');
  status('Playing');
}
function modal(html) {
  stop();
  $('dialogBody').innerHTML = html;
  if (!$('dialog').open) $('dialog').showModal();
}
function close() {
  if ($('dialog').open) $('dialog').close();
}
hook('closeDialog', close);
const optionText = (o) =>
  labels[o.kind] +
  (o.project !== undefined
    ? ' · ' + tech[o.project]
    : meta && ['settle', 'trade', 'escort', 'survey', 'contest', 'signal'].includes(o.kind)
      ? ' · ' + meta.chart[o.target].name
      : '');
function eventList(items) {
  return items.length
    ? items
        .map(
          (e, i) =>
            '<button class="event" data-index="' +
            i +
            '"><span class="event-time">Y ' +
            Math.floor(e.t / 12) +
            '</span><span class="event-body"><strong>' +
            esc(e.title) +
            '</strong><small>' +
            esc(meta.chart[e.site].name) +
            ' · ' +
            esc(e.kind) +
            '</small></span></button>',
        )
        .join('')
    : '<p class="minor">No entries at this date.</p>';
}
function drawMap(year = month / 12) {
  if (!frame) return;
  const signals = signalReplay ? [...frame.signals, signalReplay] : frame.signals;
  chart.draw({
    ...frame,
    mapId: [meta.version, meta.seed, meta.scenario, meta.systems].join('/'),
    year,
    selected,
    signals,
    highlightSite: feature?.event.site,
    highlightColor: accents[feature?.event.category],
  });
}
function armFeature() {
  if (feature) feature.until = performance.now() + 3600;
}
function present(event, animate = true) {
  feature = { event, until: Infinity };
  if (playing && followEnabled()) armFeature();
  drawMap();
  chart.focus(event.site, { animate, zoom: 2.25 });
}
function clearFeature() {
  feature = null;
}
function updatePresentation(now) {
  if (playing && feature && now >= feature.until) {
    clearFeature();
    drawMap();
  }
}
function renderNews() {
  const list = $('newsFeed');
  $('newsScope').textContent = lens < 0 ? 'Galaxy overview' : 'Received at ' + meta.chart[lens].name;
  const scope = runId + '/' + lens;
  const key = [scope, ...frame.news.map((e) => e.id)].join('/');
  if (list.dataset.key === key) return;

  const sameScope = list.dataset.scope === scope;
  const front =
    sameScope && list.scrollTop > 4
      ? Array.from(list.children).find((row) => row.offsetTop + row.offsetHeight > list.scrollTop)
      : null;
  const offset = front ? front.offsetTop - list.scrollTop : 0;
  const focused =
    sameScope && list.contains(document.activeElement) ? document.activeElement.dataset.event : null;
  list.dataset.key = key;
  list.dataset.scope = scope;
  list.innerHTML = frame.news.length
    ? frame.news
        .map((e) => {
          let system = e.system;
          if (e.originSystem && ['trade', 'conflict'].includes(e.kind))
            system = e.originSystem + ' → ' + e.system;
          if (e.originSystem && e.kind === 'report') system += ' · Report on ' + e.originSystem;
          return `<button class="story" data-event="${e.id}" style="--story-accent:${accents[e.category] || 'var(--muted)'}">
            <span class="story-context"><span>${esc(e.category)}</span><span>${date(e.t)}</span></span>
            <strong>${esc(e.title)}</strong>
            <span class="story-system">${esc(system)}</span>
            <span class="story-body">${esc(e.body)}</span>
          </button>`;
        })
        .join('')
    : '<p class="minor news-empty">No news at this date.</p>';
  const anchor = front && list.querySelector('[data-event="' + front.dataset.event + '"]');
  list.scrollTop = anchor ? anchor.offsetTop - offset : 0;
  if (focused != null)
    list.querySelector('[data-event="' + focused + '"]')?.focus({ preventScroll: true });
}
function renderFrame() {
  const s = frame.site,
    d = frame.decision;
  $('clock').textContent = date(month);
  $('timeline').value = month;
  $('siteSelect').value = selected;
  $('mapLabel').textContent =
    lens < 0 ? '3D STAR MAP' : meta.chart[lens].name.toUpperCase() + ' RECEIVER';
  $('mapSub').textContent =
    lens < 0
      ? frame.stats.sites + ' occupied systems · ' + frame.stats.attacks + ' contest departures'
      : 'Evidence received through ' + date(month);
  const track =
    signalReplay ??
    (feature ? null : [...frame.fleets, ...frame.signals].find((f) => f.from === selected));
  const route = $('routeBrief');
  route.hidden = !track;
  if (track)
    route.textContent =
      (track.kind === 'evidence' ? 'Travelling evidence' : labels[track.kind]) +
      ' · ' +
      meta.chart[track.from].name +
      ' to ' +
      meta.chart[track.to].name +
      ' · ' +
      (track.end - frame.year).toFixed(1) +
      ' yr to arrival';
  $('runSummary').textContent =
    lens < 0
      ? meta.count + ' civilizations  /  ' + meta.systems + ' star systems  /  seed ' + meta.seed
      : meta.systems + ' mapped stars  /  ' + meta.chart[lens].name + ' intelligence';
  $('sysTitle').textContent = s.name;
  $('faction').textContent = s.known ? s.faction || 'Unoccupied system' : 'No local identification';
  const readouts = [
    ['Population', s.pop],
    ['Supply reserve', s.reserve],
    ['Local strength', s.guard],
    ['Industry', s.work],
  ];
  $('readouts').innerHTML = readouts
    .map(
      ([l, v]) =>
        '<div class="readout"><small>' +
        l +
        '</small><strong>' +
        (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })) +
        '</strong></div>',
    )
    .join('');
  const capabilities = s.tech == null ? [] : tech.filter((_, i) => s.tech & (1 << i));
  let facts = s.known
    ? s.owner == null
      ? 'No confirmed settlement.'
      : s.viable === undefined
        ? 'Last observation at ' + date(s.origin) + '.'
        : s.viable
          ? 'Viable community with renewable local supply.'
          : 'Community depends on reserves or outside support.'
    : 'This receiver has no report for this system.';
  if (capabilities.length) facts += ' Deployed capabilities include ' + capabilities.join(', ') + '.';
  $('siteFacts').textContent =
    facts + (s.t != null && s.owner != null ? ' Inventory dated ' + date(s.t) + '.' : '');
  $('policyLabel').textContent = s.model || '';
  const order = $('latestOrder'),
    orderKey = d ? `${runId}/${d.key}` : '';
  if (order.dataset.key !== orderKey) {
    order.dataset.key = orderKey;
    order.innerHTML = d
      ? '<span class="minor">' +
        date(d.t) +
        ' · ' +
        d.reports +
        ' local contact records</span><button id="inspectOrder">' +
        esc(optionText(d.options[d.chosen])) +
        '</button>'
      : '<span class="minor">No accessible order at this date.</span>';
    if (d) hook('inspectOrder', () => inspectOrder(d));
  }
  const feed = $('feed'),
    feedKey = `${runId}/${frame.feed.map((e) => e.id).join(',')}`;
  if (feed.dataset.key !== feedKey) {
    feed.dataset.key = feedKey;
    feed.innerHTML = eventList(frame.feed);
  }
  renderNews();
  $('nextBeat').disabled = nextHighlight() == null;
  $('step').disabled = month >= meta.years * 12;
  drawMap();
  if (tab === 'chronicle') void refreshLog().catch(showError);
  if (tab === 'lineages' && !playing) void showLedger().catch(showError);
  if (branch && $('inspector').open) void compare().catch(showError);
}
async function refresh(event = -1, followFrom) {
  if (!meta) return;
  const n = ++requestNo;
  const args = { month, site: selected, lens, event };
  if (followFrom !== undefined) args.followFrom = followFrom;
  const f = await api(endpoint('frame', args));
  if (n !== requestNo) return null;
  frame = f;
  if (followFrom !== undefined) {
    directorFrom = f.t;
    if (f.highlight?.t > followFrom) {
      selected = f.selected;
      present(f.highlight);
    }
  } else if (event !== -1 && f.highlight?.id === event) present(f.highlight);
  renderFrame();
  return f;
}
async function goto(t, ev = -1) {
  signalReplay = null;
  stop();
  clearFeature();
  month = Math.max(0, Math.min(meta.years * 12, t));
  directorFrom = month;
  status('Paused');
  return refresh(ev);
}
async function selectSite(id) {
  signalReplay = null;
  if (!meta) return;
  stop();
  clearFeature();
  selected = Number(id);
  directorFrom = month;
  logPage = 0;
  status('Paused');
  await refresh();
}
async function load(id, opts = {}) {
  signalReplay = null;
  const n = ++loadNo;
  ++requestNo;
  stop();
  clearFeature();
  close();
  $('notice').hidden = true;
  meta = null;
  frame = null;
  runId = id;
  $('runSummary').textContent = 'Computing the seeded timeline…';
  status('Generating replay…');
  let reply;
  for (;;) {
    reply = await api(endpoint('status'));
    if (n !== loadNo) return;
    if (reply.error) throw Error(reply.error);
    if (reply.ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  meta = reply.meta;
  parent = reply.parent;
  branch = reply.branch;
  if (branch) $('inspector').open = true;
  const opening =
    followEnabled() && !branch && opts.month == null && opts.lens == null ? meta.openingHighlight : null;
  month = Math.min(meta.years * 12, opts.month ?? (branch ? branch.t : (opening?.t ?? meta.opening)));
  selected = opts.site ?? branch?.site ?? opening?.site ?? 0;
  lens = opts.lens ?? -1;
  directorFrom = month;
  logPage = 0;
  $('lens').value = lens < 0 ? '-1' : 'local';
  $('runTitle').textContent =
    (meta.scenario === 'corridor' ? 'The Vesper Passage' : 'Open galaxy') +
    (branch ? ' · Alternate' : '');
  $('siteSelect').innerHTML = meta.chart
    .map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>')
    .join('');
  $('timeline').max = meta.years * 12;
  $('endTime').textContent = 'Year ' + meta.years;
  history.replaceState(null, '', '#' + runId);
  await refresh(opening?.id);
  if (n !== loadNo) return;
  if (!feature && (branch || opts.site != null)) chart.focus(selected);
  status(branch ? 'Alternate timeline' : 'Paused');
  $('comparison').hidden = !branch;
}
function inspectOrder(d) {
  const opt = d.options[d.chosen],
    rank = d.options.map((v, i) => ({ ...v, i })).sort((a, b) => b.p - a.p);
  modal(
    '<span class="section-label">Decision record</span><h2>' +
      esc(optionText(opt)) +
      '</h2><p>' +
      esc(meta.chart[d.site].name) +
      ' · ' +
      date(d.t) +
      '</p><div class="readout-grid"><div class="readout"><small>Local reserves</small><strong>' +
      d.reserve +
      '</strong></div><div class="readout"><small>Known contacts</small><strong>' +
      d.reports +
      '</strong></div></div><p>The controller selected this order with ' +
      Math.round(opt.p * 100) +
      '% policy probability. Local strength was ' +
      d.guard +
      '.</p><div class="row">' +
      btn('decisionSky', 'See its sky at decision time') +
      '</div><div class="tool-card"><h3>Replay an alternative</h3><label>Replacement order<select id="alternative">' +
      rank
        .filter((o) => o.i !== d.chosen)
        .map(
          (o) =>
            '<option value="' +
            o.i +
            '">' +
            esc(optionText(o)) +
            ' (' +
            (o.p * 100).toFixed(1) +
            '%)</option>',
        )
        .join('') +
      '</select></label><button id="makeFork" class="primary" ' +
      (rank.length < 2 ? 'disabled' : '') +
      '>Create alternate timeline</button><p id="forkStatus" role="status"></p></div>',
  );
  if (d.evidence || d.feedback != null) {
    const e = d.evidence,
      section = document.createElement('div');
    section.className = 'tool-card';
    section.innerHTML =
      '<h3>Evidence at commitment</h3><p>' +
      (e
        ? esc(e.source) +
          ' at ' +
          esc(meta.chart[opt.target].name) +
          ' estimated strength ' +
          e.guard +
          '. Its source observation was ' +
          ((d.t - e.origin) / 12).toFixed(1) +
          ' years old.'
        : opt.target === d.site
          ? 'The controller used its local inventory and received contact reports.'
          : 'The controller had no confirmed observation of this destination.') +
      '</p><p class="minor">Learned preference adjustment for this action and destination · ' +
      (d.feedback ?? 0).toFixed(1) +
      '</p>';
    $('decisionSky').parentElement.before(section);
  }
  hook('decisionSky', async () => {
    selected = d.site;
    lens = d.site;
    $('lens').value = 'local';
    close();
    await goto(d.t, d.why);
    chart.focus(selected);
  });
  hook('makeFork', async () => {
    $('makeFork').disabled = true;
    $('forkStatus').textContent = 'Computing alternate history…';
    try {
      const data = await api(endpoint('fork'), { key: d.key, option: Number($('alternative').value) });
      await load(data.id, { month: d.t, site: d.site, lens });
    } catch (e) {
      $('makeFork').disabled = false;
      $('forkStatus').textContent = e.message;
    }
  });
}
async function inspectEvent(e) {
  if (!e) return;
  stop();
  const f = await api(endpoint('frame', { month: e.t, site: e.site, lens, event: e.id }));
  if (!f.currentEvent) return;
  const canTrace =
    e.report &&
    e.origin >= 0 &&
    e.t > e.origin &&
    !e.title.startsWith('Expedition manifest') &&
    !e.title.startsWith('Expedition identified');
  modal(
    '<span class="section-label">' +
      esc(e.kind) +
      ' record</span><h2>' +
      esc(e.title) +
      '</h2><p>' +
      date(e.t) +
      ' · ' +
      esc(meta.chart[e.site].name) +
      '</p><p>' +
      esc(e.body) +
      '</p>' +
      (e.combat
        ? `<p class="minor">Recorded strength · Expedition ${e.combat.attack} · Garrison ${e.combat.defense}</p>`
        : '') +
      (e.origin != null
        ? '<p class="minor">Observed at source in ' +
          date(e.origin) +
          '. Evidence age at receipt was ' +
          ((e.t - e.origin) / 12).toFixed(1) +
          ' years.</p>'
        : '') +
      '<div class="row">' +
      btn('viewMoment', 'Show this moment') +
      (canTrace ? btn('traceLight', 'Follow signal in galaxy view') : '') +
      (e.decision ? btn('viewDecision', 'Inspect order') : '') +
      (f.source ? btn('viewCause', 'Open source event') : '') +
      '</div>',
  );
  hook('viewMoment', async () => {
    close();
    selected = e.site;
    changeTab('observatory');
    await goto(e.t, e.id);
    if (!feature) chart.focus(selected);
  });
  if (canTrace)
    hook('traceLight', async () => {
      close();
      changeTab('observatory');
      lens = -1;
      selected = e.site;
      $('lens').value = '-1';
      await goto(e.origin);
      signalReplay = {
        from: e.target,
        to: e.site,
        start: e.origin / 12,
        end: e.t / 12,
        kind: 'evidence',
        color: '#f4d785',
      };
      chart.focus(selected);
      renderFrame();
      begin();
      status('Following evidence');
    });
  if (e.decision && f.decision) hook('viewDecision', () => inspectOrder(f.decision));
  if (f.source) hook('viewCause', () => inspectEvent(f.source));
}
async function refreshLog() {
  if (!meta || tab !== 'chronicle') return;
  const n = ++logToken,
    scope = $('logScope').value,
    filter = $('logFilter').value;
  const rows = await api(
    endpoint('log', { month, lens, site: selected, scope, filter, offset: logPage * 40 }),
  );
  if (n !== logToken) return;
  renderedLog = rows.slice(0, 40);
  $('logRows').innerHTML = eventList(renderedLog);
  $('logBack').disabled = logPage === 0;
  $('logMore').disabled = rows.length < 41;
  $('logScope').disabled = lens >= 0;
  $('logCaption').textContent =
    (lens >= 0
      ? meta.chart[lens].name + ' receiver'
      : scope === 'region'
        ? meta.chart[selected].name
        : 'Galaxy record') +
    ' through ' +
    date(month);
}
function changeTab(which) {
  tab = which;
  stop();
  clearFeature();
  status('Paused');
  for (const b of document.querySelectorAll('[data-tab]')) {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
  }
  $('observatoryPanel').hidden = tab !== 'observatory';
  $('dock').scrollTop = 0;
  $('comparison').hidden = !branch;
  $('chroniclePanel').hidden = tab !== 'chronicle';
  $('guidePanel').hidden = tab !== 'guide';
  $('ledgerPanel').hidden = tab !== 'lineages';
  if (tab === 'lineages') void showLedger().catch(showError);
  if (tab === 'chronicle') void refreshLog().catch(showError);
  drawMap();
}
async function showLedger() {
  if (!meta) return;
  if (lens >= 0) {
    $('ledgerBody').innerHTML =
      '<p>Galaxy census requires the galaxy perspective.</p>' +
      btn('revealGalaxy', 'Switch to galaxy overview');
    hook('revealGalaxy', async () => {
      lens = -1;
      $('lens').value = '-1';
      await refresh();
      await showLedger();
    });
    return;
  }
  const record = await api(endpoint('ledger', { month }));
  if (!record) {
    $('ledgerBody').textContent = 'This archived ruleset predates annual lineage records.';
    return;
  }
  const rows = record.rows.sort((a, b) => b.viable - a.viable || b.population - a.population);
  $('ledgerBody').innerHTML =
    '<p>Annual census at ' +
    date(record.t) +
    ' · ' +
    rows.filter((r) => r.population >= 2).length +
    ' living lineages · ' +
    rows.filter((r) => r.viable > 0).length +
    ' with a viable community.</p><div class="table-wrap"><table><thead><tr><th>Lineage</th><th>Policy</th><th>Population</th><th>Viable refuges</th><th>Controlled sites</th><th>Contests launched</th><th>Trades completed</th></tr></thead><tbody>' +
    rows
      .map(
        (r) =>
          '<tr><td>' +
          (r.focus === null
            ? esc(r.name)
            : '<button data-focus="' + r.focus + '">' + esc(r.name) + '</button>') +
          '</td><td>' +
          esc(r.model) +
          '</td><td>' +
          r.population +
          '</td><td>' +
          r.viable +
          '</td><td>' +
          r.sites +
          '</td><td>' +
          r.attacks +
          '</td><td>' +
          r.trades +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table></div>';
  for (const b of $('ledgerBody').querySelectorAll('[data-focus]'))
    b.onclick = safely(async () => {
      openInspector();
      await selectSite(Number(b.dataset.focus));
      chart.focus(selected);
    });
}
for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => changeTab(b.dataset.tab);
function openInspector() {
  if (tab !== 'observatory') changeTab('observatory');
  $('inspector').open = true;
}
hook('inspector', () => {
  if ($('inspector').open && branch) return compare();
}, 'toggle');
hook('newsFeed', (e) => {
  const id = e.target.closest('[data-event]')?.dataset.event;
  return inspectEvent(frame?.news.find((story) => story.id === Number(id)));
});
hook('newsArchive', () => {
  logPage = 0;
  $('logScope').value = 'all';
  $('logFilter').value = 'major';
  changeTab('chronicle');
});
hook('feed', (e) => inspectEvent(frame?.feed[e.target.closest('[data-index]')?.dataset.index]));
hook('logRows', (e) => inspectEvent(renderedLog[e.target.closest('[data-index]')?.dataset.index]));
hook('allEvents', () => {
  logPage = 0;
  $('logFilter').value = 'all';
  $('logScope').value = 'region';
  changeTab('chronicle');
});
for (const id of ['logFilter', 'logScope'])
  hook(
    id,
    () => {
      logPage = 0;
      return refreshLog();
    },
    'change',
  );
hook('logBack', () => {
  logPage = Math.max(0, logPage - 1);
  return refreshLog();
});
hook('logMore', () => {
  logPage++;
  return refreshLog();
});
hook(
  'siteSelect',
  async () => {
    await selectSite($('siteSelect').value);
    chart.focus(selected);
  },
  'change',
);
hook(
  'lens',
  async () => {
    stop();
    clearFeature();
    signalReplay = null;
    lens = $('lens').value === 'local' ? selected : -1;
    directorFrom = month;
    logPage = 0;
    status('Paused');
    await refresh();
  },
  'change',
);
hook('zoomIn', () => chart.zoomBy(1.4));
hook('zoomOut', () => chart.zoomBy(1 / 1.4));
hook('fitMap', () => chart.reset());
const theater = $('theater');
const expanded = () =>
  document.fullscreenElement === theater || theater.classList.contains('map-expanded');
function fullscreenLabel() {
  $('fullscreenMap').textContent = expanded() ? 'Exit fullscreen' : 'Fullscreen';
  $('fullscreenMap').setAttribute('aria-pressed', String(expanded()));
}
function expandMap(value) {
  theater.classList.toggle('map-expanded', value);
  document.body.classList.toggle('map-expanded', value);
  fullscreenLabel();
}
document.addEventListener('fullscreenchange', fullscreenLabel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && theater.classList.contains('map-expanded') && !$('dialog').open)
    expandMap(false);
});
hook('fullscreenMap', async () => {
  if (document.fullscreenElement === theater) return document.exitFullscreen();
  if (expanded()) return expandMap(false);
  if (document.fullscreenEnabled && theater.requestFullscreen) {
    try {
      await theater.requestFullscreen();
      return;
    } catch {
      // Embedded previews can block native fullscreen.
    }
  }
  expandMap(true);
});
hook(
  'followAction',
  () => {
    directorFrom = month;
    clearFeature();
    $('nextBeat').textContent = followEnabled() ? 'Next highlight' : 'Next event';
    return refresh();
  },
  'change',
);
hook('play', async () => {
  if (!meta) return;
  if (playing) {
    stop();
    status('Paused');
    return;
  }
  if (month >= meta.years * 12) await goto(0);
  begin();
  if (followEnabled()) armFeature();
});
hook('step', () => meta && goto(month + 1));
hook('nextBeat', async () => {
  const next = nextHighlight();
  if (next == null) return;
  const wasPlaying = playing;
  if (!followEnabled()) {
    await goto(next);
    if (wasPlaying) begin();
    return;
  }
  clearFeature();
  signalReplay = null;
  carry = 0;
  month = next;
  await refresh(-1, next - 1);
});
hook('timeline', () => meta && goto(Number($('timeline').value)), 'input');
function tick(now) {
  requestAnimationFrame(tick);
  updatePresentation(now);
  if (!playing || !frame || !meta) {
    prev = 0;
    return;
  }
  const dt = prev ? Math.min(0.15, (now - prev) / 1000) : 0;
  prev = now;
  const follow = !signalReplay && followEnabled(),
    guided = follow && $('mode').value === 'Guided',
    next = frame.nextHighlight,
    base = signalReplay
      ? Math.max(0.25, (signalReplay.end - signalReplay.start) / 5)
      : Number($('speed').value);
  const near = next != null && next - month <= 15;
  const quiet = next == null || next - month > 60;
  const speed = !guided
    ? base
    : feature
      ? Math.min(base, 0.45)
      : near
        ? Math.min(base, 1.5)
        : quiet
          ? Math.max(base, 25)
          : base;
  carry += dt * speed * 12;
  if (!playBusy && frame.t === month && carry >= 1 && now - lastAdvance >= 65) {
    const receipt = signalReplay ? Math.round(signalReplay.end * 12) : Infinity;
    const from = month;
    const target = Math.min(month + Math.floor(carry), meta.years * 12, receipt);
    carry %= 1;
    month = target;
    if (month === receipt) {
      signalReplay = null;
      directorFrom = month;
      status('Evidence received');
    } else if (month === meta.years * 12) {
      stop();
      status('End of record');
    } else if (signalReplay) status('Following evidence');
    else status((guided ? 'Guided · ' : '') + speed + ' yr/s');
    const eligible =
      follow && !feature && (target >= (next ?? Infinity) || directorFrom < from);
    playBusy = true;
    lastAdvance = now;
    refresh(-1, eligible ? Math.max(directorFrom, target - 48) : undefined)
      .then((f) => {
        if (f && !feature && !eligible) directorFrom = f.t;
      })
      .catch((e) => {
        stop();
        showError(e);
      })
      .finally(() => {
        playBusy = false;
      });
  } else if (now - lastRender > 33) {
    drawMap(Math.min((frame.t + Math.min(1, carry)) / 12, meta.years));
    lastRender = now;
  }
}
requestAnimationFrame(tick);
async function newRun() {
  modal(
    '<span class="section-label">Experiment setup</span><h2>New simulation</h2><form id="runForm"><label>Theater<select name="scenario"><option value="galaxy">Open galaxy</option><option value="corridor">Vesper Passage</option></select></label><label>Civilizations<select name="count"><option>8</option><option>16</option><option>32</option><option selected>64</option></select></label><label>Duration<select name="years"><option>80</option><option selected>180</option><option>400</option><option>1000</option></select></label><label>World seed<input required type="number" min="0" max="2147483647" name="seed" value="' +
      Math.floor(Math.random() * 2000000000) +
      '"></label><div class="row"><button type="submit" class="primary">Generate simulation</button><button type="button" id="archive">Saved runs</button></div></form>',
  );
  $('runForm').onsubmit = safely(async (e) => {
    const data = Object.fromEntries(new FormData(e.target));
    for (const k of ['count', 'years', 'seed']) data[k] = Number(data[k]);
    e.target.querySelector('[type=submit]').disabled = true;
    const r = await api('/api/run', data);
    changeTab('observatory');
    await load(r.id, { month: 0 });
  });
  // Prevent native form navigation synchronously before the asynchronous handler.
  $('runForm').addEventListener('submit', (e) => e.preventDefault());
  hook('archive', async () => {
    const runs = await api('/api/archive');
    modal(
      '<span class="section-label">Local archive</span><h2>Saved runs</h2>' +
        runs
          .map(
            (r) =>
              '<div class="archive-row"><div>' +
              esc(r.scenario === 'galaxy' ? 'Open galaxy' : 'The Vesper Passage') +
              (r.parent ? ' · Alternate' : '') +
              '<small>Seed ' +
              r.seed +
              ' · ' +
              r.count +
              ' civilizations · ' +
              r.years +
              ' years</small></div><button data-id="' +
              r.id +
              '">Open</button></div>',
          )
          .join(''),
    );
    for (const b of $('dialogBody').querySelectorAll('[data-id]'))
      b.onclick = safely(() => {
        changeTab('observatory');
        return load(b.dataset.id);
      });
  });
}
hook('newRun', newRun);
async function compare() {
  if (!parent || !frame || tab !== 'observatory' || !$('inspector').open) return;
  const n = ++compareToken;
  const response = await api(endpoint('status', {}, parent));
  if (n !== compareToken) return;
  if (!response.ready) {
    $('compareBody').textContent = 'Reconstructing the original timeline…';
    setTimeout(() => {
      if (n === compareToken && parent) void compare().catch(showError);
    }, 400);
    return;
  }
  const a = await api(endpoint('frame', { month, site: selected, lens }, parent));
  if (n !== compareToken) return;
  const card = (title, f) =>
    '<section><span class="tag">' +
    title +
    '</span><p>' +
    esc(f.site.faction || 'Unidentified or unoccupied') +
    '</p><p class="minor">Population ' +
    (f.site.pop ?? 'unknown') +
    ' · Strength ' +
    (f.site.guard ?? 'unknown') +
    '</p><p>' +
    esc(f.feed[0]?.title || 'No received event') +
    '</p></section>';
  $('compareBody').innerHTML =
    '<p class="legend-line">' +
    esc(meta.chart[selected].name) +
    ' at ' +
    date(month) +
    ' · Order replaced at ' +
    date(branch.t) +
    '</p><div class="comparison-grid">' +
    card('Original', a) +
    card('Alternate', frame) +
    '</div>';
}
hook('switchBranch', () => load(parent, { month, site: selected, lens }));
hook('compareEvidence', async () => {
  const args = { site: lens < 0 ? selected : lens, start: branch.t, month, lens, offset: 0 };
  let a, b, i;
  do {
    [a, b] = await Promise.all([api(endpoint('trace', args, parent)), api(endpoint('trace', args))]);
    i = 0;
    while (i < Math.max(a.length, b.length) && JSON.stringify(a[i]) === JSON.stringify(b[i])) i++;
    args.offset += 4000;
  } while (i === 4000 && a.length === 4000 && b.length === 4000);
  const desc = (x) => (x ? date(x[0]) + ' · ' + esc(x[2]) : 'No corresponding event in this window.');
  modal(
    '<span class="section-label">Evidence comparison</span><h2>' +
      esc(meta.chart[args.site].name) +
      '</h2>' +
      (a[i] || b[i]
        ? '<p>Earliest differing local entry through ' +
          date(month) +
          '.</p><p>Original · ' +
          desc(a[i]) +
          '</p><p>Alternate · ' +
          desc(b[i]) +
          '</p>'
        : '<p>The available local entries match through ' +
          date(month) +
          '. Advance the synchronized date to examine later consequences.</p>'),
  );
});
api('/balance-report.json')
  .then((r) => {
    const worlds = r.smallWorlds;
    $('trainingReport').innerHTML =
      '<p>' +
      r.training.rollouts +
      ' training rollouts and ' +
      r.evaluationRollouts +
      ' held-out evaluation runs. Across ' +
      worlds.length +
      ' six-civilization test worlds, there were ' +
      Math.min(...worlds.map((w) => w.attacks)) +
      '–' +
      Math.max(...worlds.map((w) => w.attacks)) +
      ' contest departures and ' +
      Math.min(...worlds.map((w) => w.trades)) +
      '–' +
      Math.max(...worlds.map((w) => w.trades)) +
      ' completed trades per world.</p><div class="row"><button id="watchTrial">Watch a training evaluation</button><a href="/balance-report.json" target="_blank" rel="noopener">Full results</a></div>';
    hook('watchTrial', async () => {
      const trial = worlds[0];
      const saved = await api('/api/run', {
        seed: trial.seed,
        years: trial.years,
        count: trial.civilizations,
        scenario: 'galaxy',
      });
      changeTab('observatory');
      await load(saved.id);
    });
  })
  .catch(showError);
safely(async () => {
  const hash = location.hash.slice(1);
  await load(/^[a-f0-9]{20}$/.test(hash) ? hash : (await api('/api/default')).id);
})();
