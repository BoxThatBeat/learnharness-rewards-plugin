# Rewards (LearnHarness plugin)

Streaks, achievements, gold stars, reminders and celebrations for your learning in
LearnHarness. It is standalone: it only reads LearnHarness's own session records and
knowledge graph, and needs no other plugin.

## Features

- **Rewards sidebar page**
  - A streak flame showing your current streak, your best streak, freezes held,
    today's status and total gold stars.
  - Your next milestones, with progress bars.
  - **Calendar:** a month view where a line runs across the days of each streak. The
    line wraps at the end of each week row, turns ice-blue where a freeze was used,
    and shows a dashed segment when today still needs activity. Active days get a
    dot and a star count. In weekly mode each Sunday also shows that week's count.
  - **Achievements:** a badge cabinet. Unlocked badges are in colour with their date;
    locked ones show progress.
- **Streaks:** choose **daily** (study every day) or **weekly** (meet a goal of N
  active days per Monday–Sunday week).
  - An active day is any real learning: a message you sent, a question you answered,
    or a practice submission. Opening the app doesn't count.
  - Today, or the current week, never breaks a streak until it is over.
- **Freezes:** you earn 1 freeze per 7-day streak (daily mode) or per 4 counted weeks
  (weekly mode), holding at most 2. A missed day or week uses one automatically.
- **Gold stars**
  - **Automatic:** for every correct quiz answer and every finished practice problem.
  - **From the teacher:** the `award_star` tool, for genuinely excellent work, with a
    per-session cap (default 3). These appear in the chat as an animated gold star
    card with the reason.
- **Achievements:** milestones for concepts in your knowledge graph, streak length,
  stars, questions answered, practice problems, and sessions. Also Perfect run,
  Early bird and Night owl.
- **Celebrations:** a short confetti overlay when you unlock something. Close it with
  a click or Escape, or wait about 4 s. It respects reduced motion. An optional chime
  is off by default.
- **Reminders:** at a time you choose, if your streak needs activity today, you get a
  reminder inside LearnHarness and, optionally, a desktop notification. These only
  work while the app is running. Use **Test notification** in Settings to check
  whether your system allows notifications.
- **Teacher awareness** (optional): the teacher and practice agents see your streak
  and nearest milestones, so they can encourage you briefly.

## How it counts

The plugin reads LearnHarness's session records and builds every count from them, so
nothing is counted twice.

- Results are kept even if you later delete a session.
- The first time it runs, badges your existing history already qualifies for are
  unlocked quietly, with no confetti.
- **Rebuild from history** in Settings rescans every session.

## Data

`<plugin data>/rewards.json` holds your settings, the per-session counts and the
unlocked badges.
- Writes are atomic.
- If the file is unreadable or uses a newer format, the plugin leaves it untouched
  and shows the error.

## Install from GitHub

Requires LearnHarness 0.6.1 or later, and Node.js with npm for the build. Clone into
the plugins directory shown in **Settings → Community plugins**. The folder must be
named `rewards`.

```sh
git clone https://github.com/BoxThatBeat/learnharness-rewards-plugin.git "<plugins directory>/rewards"
cd "<plugins directory>/rewards"
npm ci
npm run build
```

Refresh the Community plugins list and enable **Rewards**. To update later, run
`git pull && npm ci && npm run build`, then restart LearnHarness.

## Develop elsewhere

```sh
npm ci
npm run typecheck
npm test          # unit, backend and happy-dom frontend integration tests
npm run install:local -- "<plugins directory>"
```

`.sdk/` is the type-only LearnHarness plugin SDK (API v1, from app 0.6.1).

## License

AGPL-3.0-only (see `LICENSE`). The bundled `.sdk/` types and
`scripts/install-plugin-local.mjs` come from the LearnHarness plugin authoring kit,
which is AGPL-3.0.
