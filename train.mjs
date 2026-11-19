import { existsSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import {
  initialModel,
  baselineModel,
  actionProbabilities,
  feedbackValue,
  learnFeedback,
} from './policy.mjs';
import { simulate, RULESET as simulatorVersion } from './engine.mjs';

// All model selection uses the training seeds. Held-out runs are evaluated only
// after selecting checkpoints. Every competing policy receives the same sensor data.
const RULESET = 'lineage-crossplay-2';
const trainingSeed = 792773;
const populationSize = 6;
const rounds = 7;
const challengers = 3;
const trialsPerRound = 4;
const testSeeds = Array.from({ length: 24 }, (_, i) => 3619009 + i * 271);
const controls = ['turtle', 'raider', 'trader', 'disperser', 'random'].map(baselineModel);
const packageFile = new URL('./models.json', import.meta.url);
const reportFile = new URL('./balance-report.json', import.meta.url);

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let word = Math.imul(state ^ (state >>> 15), 1 | state);
    word = (word + Math.imul(word ^ (word >>> 7), 61 | word)) ^ word;
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  };
}
const bound = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const rounded = (x) => Math.round(x * 1e4) / 1e4;
const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
function mutate(parent, random, scale) {
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const child = structuredClone(parent);
  for (const key of ['weights', 'bias', 'context']) {
    child[key] = child[key].map((v, i) => {
      if (key === 'weights' && i === 0) return 0;
      return rounded(bound(v + normal() * scale, -3.5, 3.5));
    });
  }
  child.aptitude = (parent.aptitude || [0.5, 0.45, 0.4, 0.65, 0.55, 0.45]).map((v) =>
    rounded(bound(v + normal() * scale, 0, 1)),
  );
  child.temperature = rounded(bound(child.temperature * Math.exp(normal() * scale * 0.35), 0.18, 0.6));
  child.feedbackGain = rounded(bound(child.feedbackGain + normal() * scale * 0.22, 0.2, 1.35));
  return child;
}

// Deployment checks use synthetic, publicly specified dilemmas with locally
// available evidence. No alternative is forced during training or simulation.
function readiness(model) {
  const option = (kind, features) => ({ kind, features });
  const threatened = [
    option('contest', [1, 0.95, 1, 0.8, 0.1, 0.1, 0.16, 0.59, 1, 1, 0.4, 0.96]),
    option('secure', [1, 0.95, 0.01, 0.18, 0.7, 0.22, 0.5, 0.24, 0.12, 0.8, 0.08, 1]),
    option('trade', [1, 0.95, 0.39, 0.37, 0.1, 0.1, 0.16, 0.22, 0.76, 0.7, 0.34, 0.96]),
    option('wait', [1, 0.95, 0.12, 0.06, 0.7, 0.15, 0.5, 0.05, 0.4, 0.3, 0, 1]),
  ];
  const opening = [
    option('trade', [1, 0.7, 0.86, 0.37, 0.82, 0.17, 0.94, 0.22, 0.56, 0.7, 0.34, 0.95]),
    option('contest', [1, 0.7, 0.55, 0.8, 0.96, 0.17, 0.94, 0.59, 0.68, 0.34, 0.4, 0.95]),
    option('secure', [1, 0.7, 0.39, 0.18, 0.55, 0.22, 0.5, 0.24, 0.28, 0.8, 0.08, 1]),
    option('wait', [1, 0.7, 0.12, 0.06, 0.55, 0.15, 0.5, 0.05, 0.48, 0.3, 0, 1]),
  ];
  return {
    contestedRefuge: actionProbabilities({ options: threatened }, model)[0],
    trustedTrade: actionProbabilities({ options: opening }, model)[0],
  };
}
function qualifiedMutation(parent, random, scale) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = mutate(parent, random, scale);
    const probe = readiness(candidate);
    if (probe.contestedRefuge >= 0.25 && probe.trustedTrade >= 0.2) return candidate;
  }
  return structuredClone(parent);
}

function fitness(civ) {
  // Survival dominates. The bounded tie-breaker estimates resilience when both
  // lineages survive. Attacks, trades, and empire size earn no intrinsic reward.
  const alive = Number(Boolean(civ.alive));
  const viable = Number(civ.viable);
  if (!alive) return 0;
  const refuge = Math.min(1, Math.log1p(viable) / Math.log(6));
  const reserves = Math.min(1, Math.log1p(civ.population) / Math.log(401));
  return 4 * alive + 6 * Number(viable > 0) + 0.6 * refuge + 0.4 * reserves;
}

function run(seed, models, years, scenario = 'galaxy') {
  const result = simulate({
    seed,
    models,
    count: models.length,
    systems: models.length * 4,
    years,
    detail: false,
    scenario,
  });
  return result.metrics;
}
function opponentTable(champions, round, trial, family) {
  const count = 7;
  const seat = (round + trial * 2 + family) % count;
  const opponents = Array.from({ length: count }, (_, i) =>
    i % 2
      ? controls[(i + round + trial) % controls.length]
      : champions[(i + family + round) % champions.length],
  );
  return { seat, opponents, seed: 1301 + 101 * round + 19 * trial, years: [65, 100, 135, 165][trial] };
}

function train() {
  const random = seeded(trainingSeed);
  let champions = Array.from({ length: populationSize }, () =>
    qualifiedMutation(initialModel(), random, 0.4),
  );
  const history = [];
  let rollouts = 0;
  for (let round = 0; round < rounds; round++) {
    const delta = [];
    const next = champions.map((incumbent, family) => {
      const candidates = [incumbent];
      const scale = 0.52 / (1 + round * 0.16);
      while (candidates.length <= challengers)
        candidates.push(qualifiedMutation(incumbent, random, scale));
      const trials = Array.from({ length: trialsPerRound }, (_, j) =>
        opponentTable(champions, round, j, family),
      );
      const scores = candidates.map((model) =>
        mean(
          trials.map(({ opponents, seed, seat, years }) => {
            const table = [...opponents];
            table[seat] = model;
            rollouts++;
            return fitness(run(seed, table, years).byCiv[seat]);
          }),
        ),
      );
      const winner = scores.indexOf(Math.max(...scores));
      delta.push({
        family,
        improved: winner !== 0,
        gain: rounded(scores[winner] - scores[0]),
        score: rounded(scores[winner]),
      });
      return candidates[winner];
    });
    champions = next;
    history.push(delta);
    console.log(
      'Generation',
      round + 1,
      'rollouts',
      rollouts,
      'selected challengers',
      delta.filter((x) => x.improved).length,
    );
  }
  return {
    version: 1,
    algorithm: 'Population-based evolutionary policy search',
    training: {
      version: RULESET,
      simulatorVersion,
      seed: trainingSeed,
      rounds,
      rollouts,
      populationSize,
      trialsPerRound,
      challengers,
      trainingWorlds: rounds * trialsPerRound,
      trainingHorizons: [65, 100, 135, 165],
      history,
      objective:
        '4 × surviving lineage + 6 × viable community + bounded population and viable-refuge resilience (0–1). Extinct lineages score zero.',
      deploymentProbes: {
        description:
          'Candidate policies retain at least 25% contest probability in the tested desperate, advantageous contest and 20% trade probability for the tested trusted, superior partner. Selection among eligible candidates uses lineage survival. During play every action is sampled from the policy without quotas.',
        checkpoints: champions.map(readiness),
      },
      adaptation:
        'Decision weights are frozen during play. Locally delivered observations and remembered encounters change the scores of available actions.',
    },
    models: champions.map((m, i) => ({
      ...m,
      id: 'DF-' + String(i + 1).padStart(2, '0'),
      name: 'Checkpoint ' + String(i + 1).padStart(2, '0'),
    })),
  };
}

function record(civ) {
  return {
    alive: +Boolean(civ.alive),
    viable: +(civ.viable > 0),
    fitness: fitness(civ),
    population: civ.population,
    settlements: civ.settlements,
    attacks: civ.attacks,
    trades: civ.trades,
    colonies: civ.colonies,
    losses: civ.losses,
  };
}
function summarize(records) {
  return Object.fromEntries(
    Object.keys(records[0]).map((key) => [key, rounded(mean(records.map((x) => x[key])))]),
  );
}
function pairedInterval(differences) {
  const random = seeded(554192);
  const bootstrap = Array.from({ length: 1600 }, () => {
    let sum = 0;
    for (let i = 0; i < differences.length; i++)
      sum += differences[Math.floor(random() * differences.length)];
    return sum / differences.length;
  }).sort((a, b) => a - b);
  return {
    mean: rounded(mean(differences)),
    lower95: rounded(bootstrap[40]),
    upper95: rounded(bootstrap[1559]),
  };
}

function evaluate(pkg) {
  const roster = pkg.models;
  const tested = [
    'pretrained',
    'initial',
    'random',
    'turtle',
    'fortress',
    'raider',
    'trader',
    'disperser',
  ];
  const observations = Object.fromEntries(tested.map((name) => [name, []]));
  const smallWorlds = [];
  let rollouts = 0;
  for (let n = 0; n < testSeeds.length; n++) {
    const seed = testSeeds[n];
    const world = run(seed, roster, 160);
    rollouts++;
    smallWorlds.push({
      seed,
      years: 160,
      civilizations: roster.length,
      attacks: world.attacks,
      trades: world.trades,
      colonies: world.colonies,
      alive: world.byCiv.filter((c) => c.alive).length,
      viable: world.byCiv.filter((c) => c.viable > 0).length,
    });
    for (const name of tested) {
      const focal = [];
      for (let j = 0; j < 2; j++) {
        const table = [
          roster[(n + 1) % 6],
          controls[0],
          controls[1],
          roster[(n + 2) % 6],
          controls[2],
          controls[3],
          roster[(n + 4) % 6],
        ];
        const seat = (n + j * 3) % table.length;
        table[seat] =
          name === 'pretrained'
            ? roster[(n + j) % 6]
            : name === 'initial'
              ? initialModel()
              : baselineModel(name);
        focal.push(record(run(seed, table, 160).byCiv[seat]));
        rollouts++;
      }
      observations[name].push(summarize(focal));
    }
  }
  const comparison = {};
  for (const name of tested) {
    comparison[name] = summarize(observations[name]);
    if (name !== 'pretrained')
      comparison[name].pairedFitnessAdvantageOfTrained = pairedInterval(
        observations.pretrained.map((r, i) => r.fitness - observations[name][i].fitness),
      );
  }
  const probes = {};
  for (const [label, receipt, opposition] of [
    ['freshContact', 0, 0.45],
    ['successfulTrade', 1, 0.45],
    ['refusedTrade', -1, 0.45],
    ['strongerFoe', 0, 0.93],
  ]) {
    const memory = new Map();
    if (receipt) learnFeedback(memory, 'trade', 1, 100, receipt);
    const options = [
      {
        kind: 'trade',
        target: 1,
        feedback: feedbackValue(memory, 'trade', 1, 100),
        features: [1, 0.6, 0.8, 0.4, 0.4, 0.4, 0.5, 0.3, 0.5, 0.7, 0.3, 0.9],
      },
      {
        kind: 'contest',
        target: 1,
        features: [1, 0.6, 0.8, 0.6, opposition, 0.4, 0.5, 0.5, 0.7, 0.94 - opposition * 0.5, 0.3, 0.9],
      },
      {
        kind: 'secure',
        target: 0,
        features: [1, 0.6, 0.5, 0.2, 0.4, 0.2, 0.5, 0.24, 0.6, 0.8, 0.08, 1],
      },
    ];
    const policies = roster.map((m) => actionProbabilities({ options }, m));
    probes[label] = Object.fromEntries(
      options.map((o, i) => [o.kind, rounded(mean(policies.map((p) => p[i])))]),
    );
  }
  const previous = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;
  const pilot =
    previous?.pilot ??
    (previous?.ruleset === 'lineage-crossplay-1'
      ? {
          label: 'Initial rules and pretraining, before balance adjustments',
          seeds: previous.independentSeeds,
          horizonYears: previous.horizonYears,
          smallWorlds: previous.smallWorlds,
          crossplay: previous.crossplay,
        }
      : null);
  const calibrationReplays = (pilot?.smallWorlds ?? []).map((before) => {
    const after = run(before.seed, roster, before.years);
    return {
      seed: before.seed,
      initialContests: before.attacks,
      finalContests: after.attacks,
      initialTrades: before.trades,
      finalTrades: after.trades,
    };
  });
  return {
    version: 2,
    ruleset: RULESET,
    simulatorVersion,
    evaluationRollouts: rollouts,
    independentSeeds: testSeeds.length,
    horizonYears: 160,
    method:
      'Each focal policy occupies the same two rotating seats against the same mixed opponents per seed. Comparisons average seats within seed, then bootstrap paired differences across seeds. Outcome counters are per focal civilization.',
    fitness: pkg.training.objective,
    crossplay: comparison,
    smallWorlds,
    training: pkg.training,
    pilot,
    calibrationReplays,
    adaptationProbe: {
      method:
        'Illustrative fixed action menu, varying only acknowledged trade feedback or opposing strength. Values are mean action probabilities across the six checkpoints.',
      probabilities: probes,
    },
  };
}

function save(file, data) {
  const staged = new URL(file.href + '.tmp');
  writeFileSync(staged, JSON.stringify(data, null, 2) + '\n');
  renameSync(staged, file);
}
const evaluationOnly = process.argv.includes('--evaluate');
const pkg = evaluationOnly ? JSON.parse(readFileSync(packageFile, 'utf8')) : train();
if (!evaluationOnly) save(packageFile, pkg);
const report = evaluate(pkg);
save(reportFile, report);
console.table(report.crossplay);
console.table(report.smallWorlds);
