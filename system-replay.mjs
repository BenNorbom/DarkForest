// Re-execute the archived encounter solver from its ordered input log on demand.
export function systemReplay(run, args, physics) {
  if (!run.layouts || !physics) return { available: false };
  const site = Number(args.site),
    month = Math.min(run.years * 12, Math.max(0, Number(args.month) || 0));
  const layout = run.layouts[site];
  if (!layout) throw Error('Unknown system');
  const state = run.history[site].findLast((s) => s.t <= month);
  const local = Number(args.lens ?? -1) >= 0;
  const base = {
    available: true,
    name: run.chart[site].name,
    layout,
    month,
    frames: [],
    events: [],
    controllers: [],
    history: [],
    messages: [],
    facilities: null,
  };
  if (local && (Number(args.lens) !== site || state?.owner == null)) return base;
  const ruler = state?.ruler;
  const controller = local ? ruler : args.controller || null;
  const tapes = run.encounters[site].filter(
    (t) =>
      t.start <= month &&
      (!controller ||
        t.inputs.some((input) => input.time <= month && input.entry?.captain.id === controller)),
  );
  base.history = tapes.slice(-48).map((t) => ({ start: t.start, end: Math.min(t.end, month) }));
  const tape =
    args.start == null
      ? tapes.findLast((t) => t.end >= month)
      : tapes.find((t) => t.start === Number(args.start));
  base.facilities =
    state?.owner != null && (!controller || controller === ruler) ? state.facilities : null;
  base.ruler = !controller || controller === ruler ? ruler : null;
  const end = tape ? Math.min(tape.end, month) : month;
  base.messages = run.messages
    .filter((m) => m.time <= month && m.controller === (controller || ruler))
    .slice(-32);
  const profile = run.profiles?.[controller || ruler];
  if (profile && profile.born <= month && (base.ruler === profile.id || tapes.length)) {
    base.profile = { ...profile, promoted: profile.promoted <= month ? profile.promoted : null };
  }
  if (base.facilities) base.station = state.station;
  if (!tape) return base;
  base.start = tape.start;
  const first = Math.max(tape.start, end - 36, 0);
  const observe = (e) => {
    if (e.time >= first && e.time <= end && (!controller || e.controller === controller)) {
      base.events.push(controller ? { ...e, to: undefined, target: undefined } : e);
    }
  };
  const scene = physics.theater(layout, tape.start, observe);
  let owner = null,
    next = 0;
  while (scene.time <= end) {
    while (next < tape.inputs.length && tape.inputs[next].time <= scene.time) {
      const input = tape.inputs[next++];
      if (input.entry) {
        physics.deploy(scene, input.entry);
        const c = input.entry.captain;
        if (!controller || c.id === controller)
          base.controllers.push({ id: c.id, doctrine: c.doctrine });
      } else if (input.recall) {
        const m = scene.missions.find((m) => m.captain.id === input.recall);
        if (m) m.captain.recall = true;
      } else owner = input.owner;
    }
    if (scene.time >= first)
      base.frames.push({ time: scene.time, ships: physics.visibleShips(scene, controller) });
    if (scene.time === end) break;
    physics.advance(scene, owner);
  }
  return base;
}
