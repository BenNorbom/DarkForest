import { parentPort, workerData } from 'node:worker_threads';
import { frame, header, indexReplay, chronicle, ledger } from './replay.mjs';
const { simulate } = await import(workerData.engine);
const idx = indexReplay(simulate({ ...workerData.config, models: workerData.models, detail: true }));
const meta = header(idx);
parentPort.postMessage({ ready: meta });
parentPort.on('message', ({ id, op, args }) => {
  try {
    let data;
    if (op === 'frame') data = frame(idx, args);
    else if (op === 'log') data = chronicle(idx, args);
    else if (op === 'ledger') data = ledger(idx, args.month);
    else if (op === 'legal') {
      const d = idx.decision.get(args.key);
      data =
        !!d && Number.isInteger(args.option) && args.option !== d.chosen && !!d.options[args.option];
    } else if (op === 'trace') {
      // A comparison asks which locally recorded observations changed after intervention.
      const source = idx.bySite[args.site] ?? [];
      const local =
        args.lens >= 0 ? frame(idx, { month: args.month, site: args.site, lens: args.lens }).site : null;
      const offset = args.offset || 0;
      data = source
        .filter(
          (e) =>
            e.t >= args.start &&
            e.t <= args.month &&
            e.kind !== 'order' &&
            (!local || (local.owner !== null && local.owner === e.owner && e.t >= local.since)),
        )
        .slice(offset, offset + 4000)
        .map((e) => [e.t, e.kind, e.title, e.body, e.target, e.report?.owner, e.report?.guard]);
    } else throw new Error('Unknown replay operation');
    parentPort.postMessage({ id, data });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
