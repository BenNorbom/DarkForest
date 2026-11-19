# Dark Forest Observatory

A local interstellar strategy simulation with six pretrained machine-learning policies, independent settlement memories, delayed observations, and reproducible alternate histories. The opening scenario contains 64 civilizations and 240 star systems. Runs support up to 1,000 simulated years.

## Install on Windows

Download [Dark-Forest-Setup.exe](https://github.com/BenNorbom/DarkForest/releases/latest/download/Dark-Forest-Setup.exe) for Windows x64, run it, and open **Dark Forest** from the Start menu. The app includes its own runtime and runs simulations offline. The installer is unsigned, so Windows may show a SmartScreen prompt.

Open **Updates** in the top bar and select **Check for updates**. When a newer version is available, select **Download update**, then **Restart and install**. Saved runs are kept in the Windows app’s user data folder across updates.

## Run from source

Use Node.js 22 or later. From this directory run:

```sh
npm start
```

Open **http://127.0.0.1:4173/**. The project uses Node built-ins and browser APIs. All six checkpoints ship in `models.json`. Change `PORT` to choose a different local port. Run `npm test` for the simulation and replay checks.

On Windows, run `npm ci` with Node.js 24, then `npm run desktop` to open the desktop app or `npm run dist:win` to build the installer in `dist/`. A successful Windows release workflow on `main` publishes the installer and update metadata to [GitHub Releases](https://github.com/BenNorbom/DarkForest/releases). The published version uses the package’s major and minor version and the workflow run number as its patch version.

## Observe

The Vesper Passage opens at a recorded decision in a fully simulated galaxy. Drag the 3D map to orbit, Shift-drag to pan, scroll to zoom, and use **Fit** to reset the view. Click a system or select one from **System intelligence**. Switch to **Local intelligence** to anchor the map and news feed to that receiver, then select another star to inspect the evidence available about it.

Enable **Follow action** to move the camera to selected contests, diplomatic developments, scientific breakthroughs, and other highlights. **Guided** playback slows around highlights while the clock keeps advancing. **Fixed** uses your selected rate in years per second. **Fullscreen** keeps the map, sidebar, and playback controls together. Scrub to any month, step a month, or jump to the next event.

The sidebar news feed follows the simulation clock, newest first. Open a headline for the full record and a shortcut to the event on the map. Contest records include the outcome and recorded strengths when available. The **Chronicle** shows past events at the chosen date. **Lineages** shows the annual galaxy census, including descendants who live under another civilization's control.

Inspect an order to see its local evidence, reserves, action probability, and alternatives. Choose a different order to create a branch. Scrub the alternate timeline to compare the original and alternate at the same date. **Compare received evidence** finds their first differing recorded local observation or outcome in the requested window.

Use **New run** to change seed, duration, population, and starting scenario. **Saved runs** restores previous simulations and branches. Run recipes and matching engine, policy code, and weights are archived in `.runs/` when running from source in the browser, or in `%APPDATA%\Dark Forest\runs` in the Windows app. Reconstruction uses the pinned version and stable random draws. The worker reconstructs a branch from the seed and earlier interventions. Replays live in memory while viewed. Set `DARK_FOREST_STORE` to relocate the archive.

## Mechanics

The engine advances in months. Three-dimensional distances govern expedition range, travel time, and signal delays. Signals travel at light speed, fast expeditions at one-third light speed, and cargo at one-fifth. Unaffiliated observers receive delayed and noisy industrial or launch traces, supplemented by deep-sky observations. Departures, physical arrivals, and news of outcomes have separate dates. Reports from an earlier observation cannot overwrite a more recent observation. Saved runs from the original ruleset retain their flat geometry and original timelines.

Controllers decide from their local contacts, reserves, infrastructure, relations, and experience. Older production sites become less productive. Garrison upkeep competes with civilian supply. Colonists and military settlement contingents travel as part of the population ledger. An expedition can claim a poorly defended settlement or come home after meeting unexpected resistance. Capturing infrastructure keeps its residents and changes who can direct its resources.

Local market demand, cargo complementarity, prior relations, and passage grants influence exchange. Demand recovers over time. Technology programs have hidden seeded thresholds. Local industry, nearby destinations, travel commitments, and forecast risk determine which orders a controller can issue.

## Training and balance

`npm run train` retrains six factored stochastic policies using population-based evolutionary search against learned and scripted opponents, then writes the checkpoints and evaluation. Restart the server to generate new runs with new weights. `node train.mjs --evaluate` evaluates existing checkpoints. The trainer records the fitness function, seed sets, candidate calibration, survival comparisons, and behavior probes in `balance-report.json`.

The objective favors lineage survival and viable communities. Offline calibration screens for willingness to contest an advantageous emergency and trade with a credible stronger peer. During play, policy weights stay fixed. Each controller learns a decaying action preference for a destination from locally received mission outcomes. Returned intelligence also alters relative-strength estimates, trust, and beliefs about technology.

The simulation uses abstract site contests. Its diplomacy supports passage, protected settlement, trade, and relief. The interface reports policy probabilities and the evidence supplied to the model. The probabilities describe action selection, not predicted victory.
