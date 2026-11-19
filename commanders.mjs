export const doctrines = ['Expedition', 'Sentinel', 'Pathfinder'];
export const defaultAptitude = [0.5, 0.45, 0.4, 0.65, 0.55, 0.45];
export function commission(id, parent, mission, model, knowledge, random) {
  const weights = [...(model?.aptitude || defaultAptitude)];
  const scores = [
    weights[0] + (mission === 'contest' ? 0.32 : 0),
    weights[1] + (mission === 'escort' ? 0.6 : 0),
    weights[2] + (mission === 'survey' ? 0.55 : 0),
  ].map((x) => x + random() * 0.42);
  const doctrine = scores.indexOf(Math.max(...scores));
  return {
    id,
    parent,
    mission,
    doctrine: doctrines[doctrine],
    weights,
    knowledge: knowledge ? { ...knowledge } : null,
    order: {
      objective: mission,
      authorized:
        mission === 'contest'
          ? ['Intercept', 'Screen', 'Raid', 'Rendezvous', 'Withdraw']
          : ['Screen', 'Rendezvous', 'Withdraw'],
      reserve: [0.12, 0.28, 0.21][doctrine],
      reviewMonths: 22,
    },
    reserve: [0.12, 0.28, 0.21][doctrine],
    preferences: {},
    sequence: 0,
    role: 'commander',
  };
}
export function adapt(captain, action, reward) {
  captain.preferences[action] = 0.7 * (captain.preferences[action] || 0) + 0.3 * reward;
}
export function directive(captain, message, time) {
  if (message.sequence <= captain.sequence) return 'superseded';
  captain.sequence = message.sequence;
  if (time > message.expires || captain.role === 'ruler') return 'rejected';
  captain.recall = true;
  return 'accepted';
}
