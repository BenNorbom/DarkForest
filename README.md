# Dark Forest Observatory

A local interstellar strategy simulation with six pretrained machine-learning policies, independent settlement memories, delayed observations, and reproducible alternate histories. The opening scenario contains 64 civilizations and 240 star systems. Runs support up to 1,000 simulated years.

## Start

Use Node.js 22 or later. From this directory run:

```sh
npm start
```

Open **http://127.0.0.1:4173/**. The project uses Node built-ins and browser APIs. All six checkpoints ship in `models.json`. Change `PORT` to choose a different local port. Run `npm test` for the simulation and replay checks.

## Observe

The Vesper Passage opens at a recorded decision in a fully simulated galaxy. Click a system or select one from the inspector. Switch to **Local intelligence** to anchor the map and event feed to that receiver, then select another star to inspect the evidence available about it. Scroll to zoom, drag to pan, and use **Fit** for the entire galaxy.

**Follow action** starts on and moves the camera to selected battles, diplomatic developments, scientific breakthroughs, and other highlights. **Guided** playback slows around highlights while the clock keeps advancing. **Fixed** uses your selected rate in years per second. **Fullscreen** keeps the map, timeline, and playback controls together. Scrub to any month, step a month, or jump to the next highlight.

Battle highlights open an orbitable 3D reconstruction during playback. Use **Watch 3D battle** to return to it from a highlight or battle record. Fleets and effects illustrate the logged outcome. New runs also show the recorded starting strengths. The **Chronicle** shows past events at the chosen date. **Lineages** shows the annual galaxy census, including descendants who live under another civilization's control.

Inspect an order to see its local evidence, reserves, action probability, and alternatives. Choose a different order to create a branch. Scrub the alternate timeline to compare the original and alternate at the same date. **Compare received evidence** finds their first differing recorded local observation or outcome in the requested window.

Use **New run** to change seed, duration, population, and starting scenario. **Saved runs** restores previous simulations and branches. Local run recipes and matching engine, policy code, and weights are archived in `.runs/`. Reconstruction uses the pinned version and stable random draws. The worker reconstructs a branch from the seed and earlier interventions. Replays live in memory while viewed. Set `DARK_FOREST_STORE` to relocate the archive.

## Mechanics

The engine advances in months. Signals travel at light speed, fast expeditions at one-third light speed, and cargo at one-fifth. Unaffiliated observers receive delayed and noisy industrial or launch traces, supplemented by deep-sky observations. Departures, physical arrivals, and news of outcomes have separate dates. Reports from an earlier observation cannot overwrite a more recent observation.

Controllers decide from their local contacts, reserves, infrastructure, relations, and experience. Older production sites become less productive. Garrison upkeep competes with civilian supply. Colonists and military settlement contingents travel as part of the population ledger. An expedition can claim a poorly defended settlement or come home after meeting unexpected resistance. Capturing infrastructure keeps its residents and changes who can direct its resources.

Local market demand, cargo complementarity, prior relations, and passage grants influence exchange. Demand recovers over time. Technology programs have hidden seeded thresholds. Local industry, nearby destinations, travel commitments, and forecast risk determine which orders a controller can issue.

## Training and balance

`npm run train` retrains six factored stochastic policies using population-based evolutionary search against learned and scripted opponents, then writes the checkpoints and evaluation. Restart the server to generate new runs with new weights. `node train.mjs --evaluate` evaluates existing checkpoints. The trainer records the fitness function, seed sets, candidate calibration, survival comparisons, and behavior probes in `balance-report.json`.

The objective favors lineage survival and viable communities. Offline calibration screens for willingness to contest an advantageous emergency and trade with a credible stronger peer. During play, policy weights stay fixed. Each controller learns a decaying action preference for a destination from locally received mission outcomes. Returned intelligence also alters relative-strength estimates, trust, and beliefs about technology.

The simulation uses abstract site contests. Its diplomacy supports passage, protected settlement, trade, and relief. The interface reports policy probabilities and the evidence supplied to the model. The probabilities describe action selection, not predicted victory.
