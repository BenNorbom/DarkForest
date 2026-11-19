import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
const root = fileURLToPath(new URL('.', import.meta.url)),
  store = process.env.DARK_FOREST_STORE || path.join(root, '.runs');
const desktop = process.parentPort;
const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 20);
const read = (name) => readFile(path.join(root, name), 'utf8');
const rules = await Promise.all(
  ['engine.mjs', 'policy.mjs', 'flight.mjs', 'commanders.mjs', 'encounters.mjs', 'models.json'].map(
    async (name) => [name, await read(name)],
  ),
);
const models = JSON.parse(rules.at(-1)[1]).models,
  version = digest(JSON.stringify(rules)),
  bundle = path.join(store, 'rules', version);
await mkdir(bundle, { recursive: true });
await Promise.all(rules.map(([name, source]) => writeFile(path.join(bundle, name), source)));
const pool = new Map();
let serial = 0;
const defaultRun = {
  seed: 7819,
  count: 64,
  systems: 240,
  years: 180,
  scenario: 'corridor',
  overrides: {},
};
const assets = new Map(
  Object.entries({
    '/': 'index.html',
    '/flight.mjs': 'flight.mjs',
    '/system-view.js': 'system-view.js',
    '/app.js': 'app.js',
    '/observatory.css': 'observatory.css',
    '/starfield.js': 'starfield.js',
    '/balance-report.json': 'balance-report.json',
  }),
);
function integer(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max;
}
async function recipe(id) {
  if (!/^[a-f0-9]{20}$/.test(id)) throw Error('Invalid run ID');
  return JSON.parse(await readFile(path.join(store, id + '.json'), 'utf8'));
}
async function save(config, parent = null, branch = null, rev = version) {
  const id = digest(JSON.stringify([rev, config, parent, branch])),
    r = { id, version: rev, config, parent, branch };
  const dest = path.join(store, id + '.json'),
    tmp = dest + '.' + ++serial + '.tmp';
  await writeFile(tmp, JSON.stringify(r));
  await rename(tmp, dest);
  return r;
}
function release(h) {
  if (pool.get(h.recipe.id) === h) pool.delete(h.recipe.id);
  for (const { reject } of h.pending.values()) reject(Error('Replay closed'));
  h.pending.clear();
  void h.worker.terminate();
}
async function acquire(id) {
  const r = await recipe(id);
  let h = pool.get(id);
  if (h) {
    h.used = Date.now();
    return h;
  }
  const base = path.join(store, 'rules', r.version),
    roster = JSON.parse(await readFile(path.join(base, 'models.json'), 'utf8')).models;
  if (pool.has(id)) return pool.get(id);
  const idle = [...pool.values()]
    .filter((x) => x.meta && !x.pending.size)
    .sort((a, b) => a.used - b.used);
  while (pool.size >= 2 && idle.length) release(idle.shift());
  if (pool.size >= 3) throw Error('Simulation workers are busy. Try again shortly.');
  const w = new Worker(new URL('./worker.mjs', import.meta.url), {
    workerData: {
      engine: pathToFileURL(path.join(base, 'engine.mjs')).href,
      config: r.config,
      models: roster,
    },
  });
  h = { worker: w, recipe: r, pending: new Map(), meta: null, error: null, used: Date.now() };
  pool.set(id, h);
  w.on('message', (m) => {
    if (m.ready) {
      h.meta = m.ready;
      return;
    }
    const p = h.pending.get(m.id);
    if (p) {
      h.pending.delete(m.id);
      m.error ? p.reject(Error(m.error)) : p.resolve(m.data);
    }
  });
  w.on('error', (e) => {
    h.error = e.message;
    for (const p of h.pending.values()) p.reject(e);
    h.pending.clear();
  });
  return h;
}
function query(h, op, args) {
  if (!h.meta) throw Error(h.error || 'Replay is still being generated');
  const id = ++serial;
  return new Promise((resolve, reject) => {
    h.pending.set(id, { resolve, reject });
    h.worker.postMessage({ id, op, args });
  });
}
async function readBody(req) {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 8192) throw Error('Request too large');
  }
  return JSON.parse(s || '{}');
}
const welcome = await save(defaultRun);
const server = http.createServer(async (req, res) => {
  function send(data, code = 200, mime = 'application/json') {
    let buf = Buffer.from(mime === 'application/json' ? JSON.stringify(data) : data);
    const headers = {
      'Content-Type': mime + (mime.startsWith('text/') ? '; charset=utf-8' : ''),
      'Cache-Control': 'no-store',
    };
    if (desktop) {
      headers['Content-Security-Policy'] =
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
    }
    if (buf.length > 1800 && (req.headers['accept-encoding'] || '').includes('gzip')) {
      buf = gzipSync(buf, { level: 1 });
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(code, headers);
    res.end(buf);
  }
  try {
    if (desktop && req.headers.host !== '127.0.0.1:' + server.address().port)
      return send({ error: 'Local host required' }, 403);
    const url = new URL(req.url, 'http://127.0.0.1'),
      p = url.pathname;
    if (
      req.method === 'POST' &&
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    )
      return send({ error: 'Local origin required' }, 403);
    if (req.method === 'GET' && assets.has(p)) {
      const n = assets.get(p);
      if (n.endsWith('.json')) return send(JSON.parse(await read(n)));
      return send(
        await read(n),
        200,
        n.endsWith('html') ? 'text/html' : n.endsWith('js') ? 'text/javascript' : 'text/css',
      );
    }
    if (p === '/api/default') return send({ id: welcome.id });
    if (p === '/api/archive') {
      const ids = (await readdir(store)).filter((x) => /^[a-f0-9]{20}\.json$/.test(x));
      const list = await Promise.all(ids.map((x) => recipe(x.slice(0, -5))));
      return send(
        list.map(({ id, parent, config }) => ({
          id,
          parent,
          seed: config.seed,
          scenario: config.scenario,
          count: config.count,
          years: config.years,
        })),
      );
    }
    if (req.method === 'POST' && p === '/api/run') {
      const { seed, count, years, scenario } = await readBody(req);
      if (
        !integer(seed, 0, 2147483647) ||
        !integer(count, 4, 64) ||
        !integer(years, 40, 1000) ||
        !['galaxy', 'corridor'].includes(scenario)
      )
        throw Error('Choose 4–64 civilizations, 40–1000 years, and a valid numeric seed.');
      const r = await save({
        seed,
        count,
        systems: count === 64 ? 240 : count * 4,
        years,
        scenario,
        overrides: {},
      });
      await acquire(r.id);
      return send({ id: r.id });
    }
    const m = p.match(/^\/api\/([a-f0-9]{20})\/(status|frame|system|log|ledger|fork|trace)$/);
    if (!m) return send({ error: 'Not found' }, 404);
    const h = await acquire(m[1]),
      op = m[2];
    if (op === 'status')
      return send({
        ready: !!h.meta,
        error: h.error,
        meta: h.meta,
        parent: h.recipe.parent,
        branch: h.recipe.branch,
      });
    if (op === 'fork' && req.method === 'POST') {
      const { key, option } = await readBody(req);
      if (!(await query(h, 'legal', { key, option }))) throw Error('Choose a different legal order');
      const cut = Number(key.split('-')[0]),
        prefix = Object.fromEntries(
          Object.entries(h.recipe.config.overrides).filter(([k]) => Number(k.split('-')[0]) <= cut),
        );
      const config = { ...h.recipe.config, overrides: { ...prefix, [key]: option } };
      const b = await save(
        config,
        h.recipe.id,
        { key, option, t: Number(key.split('-')[0]), site: Number(key.split('-')[1]) },
        h.recipe.version,
      );
      await acquire(b.id);
      return send({ id: b.id });
    }
    const args = Object.fromEntries(url.searchParams);
    for (const k of ['month', 'site', 'lens', 'event', 'offset', 'start', 'followFrom'])
      if (k in args) {
        args[k] = Number(args[k]);
        if (!Number.isSafeInteger(args[k])) throw Error('Invalid replay coordinate');
      }
    if (['system', 'frame', 'log', 'trace', 'ledger'].includes(op))
      return send(await query(h, op, args));
    send({ error: 'Method not allowed' }, 405);
  } catch (e) {
    send({ error: e.code === 'ENOENT' ? 'Run or asset unavailable' : e.message }, 400);
  }
});
const port = desktop ? 0 : Number(process.env.PORT) || 4173;
server.on('error', (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const { port } = server.address();
  if (desktop) desktop.postMessage(port);
  else console.log('Dark Forest Observatory · http://127.0.0.1:' + port);
});
