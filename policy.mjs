// Serializable, dependency-free policy shared by the simulator and offline trainer.
export const ACTIONS = Object.freeze([
  'wait',
  'survey',
  'settle',
  'trade',
  'escort',
  'contest',
  'research',
  'secure',
  'signal',
]);
const indexOfAction = Object.fromEntries(ACTIONS.map((name, index) => [name, index]));
const initialBias = [-0.13, 0.08, 0.13, 0.15, 0.01, 0.07, 0.03, 0.03, -0.03];
const initialWeights = [0, 1.2, 1.15, -0.55, -0.65, -0.35, 0.37, -0.74, 0.85, 0.45, 0.22, 0.34];
const initialContext = [0.45, 0.5, 0.8, 0.5, 0.7, 0.55, 0.45, 0.65, 0.5];

export function initialModel() {
  return {
    type: 'contextual',
    bias: [...initialBias],
    weights: [...initialWeights],
    context: [...initialContext],
    temperature: 0.29,
    feedbackGain: 0.75,
  };
}

export function baselineModel(name) {
  if (!['random', 'turtle', 'fortress', 'raider', 'trader', 'disperser'].includes(name))
    throw new RangeError('Unknown baseline policy');
  return { type: 'baseline', name };
}

const defaultModel = initialModel();

// Local evidence has an eight-year half-life. A receipt updates an action at a
// particular destination; another colony cannot read this controller's memory.
export function feedbackValue(memory, kind, target, month) {
  const entry = memory.get(kind + ':' + target);
  if (!entry) return 0;
  return entry.value * 2 ** (-Math.max(0, month - entry.month) / 96);
}
export function learnFeedback(memory, kind, target, month, outcome) {
  const current = feedbackValue(memory, kind, target, month);
  memory.set(kind + ':' + target, {
    month,
    value: 0.58 * current + 0.42 * Math.max(-1, Math.min(1, outcome)),
  });
}
function interaction(i, f) {
  const [
    ,
    need,
    gain,
    exposure,
    opposition,
    uncertainty,
    trust,
    cost,
    urgency,
    support,
    novelty,
    reach,
  ] = f;
  switch (i) {
    case 0:
      return (1 - urgency) * (1 - need);
    case 1:
      return uncertainty * novelty;
    case 2:
      return need * reach;
    case 3:
      return trust * gain - opposition * uncertainty;
    case 4:
      return urgency * exposure;
    case 5:
      return support * (gain + urgency * uncertainty) - opposition * uncertainty - trust * gain;
    case 6:
      return novelty * (1 - urgency);
    case 7:
      return urgency * uncertainty;
    case 8:
      return reach * novelty - exposure * cost;
    default:
      return 0;
  }
}

function baselineScore(model, kind, f) {
  if (model.name === 'random') return 0;
  const [, need, gain, , opposition, , trust, cost, urgency, support] = f;
  if (model.name === 'turtle')
    return kind === 'secure' ? 6 : kind === 'research' ? 3 : kind === 'wait' ? 2 : -12;
  if (model.name === 'fortress') {
    if (kind === 'secure') return 2 + 2.75 * gain + 4.1 * urgency;
    if (kind === 'research') return 4.2 + gain;
    if (kind === 'wait') return 3.2 + urgency;
    return -12;
  }
  const primary = { raider: 'contest', trader: 'trade', disperser: 'settle' }[model.name];
  if (kind === primary) return 6 + gain + support - opposition;
  if (kind === 'survey') return 2.6 + gain - cost;
  if (kind === 'secure') return 2.25 + urgency + need;
  return gain + trust - cost;
}

function candidateScore(model, option) {
  const i = indexOfAction[option.kind];
  if (i === undefined) return -1e6;
  if (model.type === 'baseline') return baselineScore(model, option.kind, option.features);
  let score =
    model.bias[i] +
    interaction(i, option.features) * model.context[i] +
    (option.feedback ?? 0) * (model.feedbackGain ?? 0.75);
  for (let j = 1; j < 12; j++) score += option.features[j] * model.weights[j];
  return score;
}

// Pick a target within each available verb, then select the verb. This keeps ten
// equivalent trade partners from counting as ten independent votes for trade.
export function actionProbabilities(observation, model = defaultModel) {
  model ??= defaultModel;
  const options = observation.options;
  const scores = new Float64Array(options.length);
  const best = new Float64Array(ACTIONS.length).fill(-Infinity);
  const sums = new Float64Array(ACTIONS.length);
  const temperature = model.type === 'baseline' ? 0.28 : model.temperature;
  let overallBest = -Infinity;
  for (let j = 0; j < options.length; j++) {
    const score = candidateScore(model, options[j]);
    const k = indexOfAction[options[j].kind];
    scores[j] = score;
    best[k] = Math.max(best[k], score);
    overallBest = Math.max(overallBest, score);
  }
  let verbSum = 0;
  for (const value of best) verbSum += Math.exp((value - overallBest) / temperature);
  for (let j = 0; j < scores.length; j++) {
    const k = indexOfAction[options[j].kind];
    scores[j] = Math.exp((scores[j] - best[k]) / temperature);
    sums[k] += scores[j];
  }
  for (let j = 0; j < scores.length; j++) {
    const k = indexOfAction[options[j].kind];
    scores[j] *= Math.exp((best[k] - overallBest) / temperature) / (verbSum * sums[k]);
  }
  return scores;
}

export function chooseAction(observation, model, random) {
  if (!observation.options.length) return -1;
  const distribution = actionProbabilities(observation, model);
  let threshold = random();
  for (let j = 0; j < distribution.length; j++) {
    threshold -= distribution[j];
    if (threshold < 0) return j;
  }
  return distribution.length - 1;
}
