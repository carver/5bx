#!/usr/bin/env node
/*
 * Sanity-checks js/config.js after you edit it, plus the progression rules in
 * js/state.js. Zero dependencies — just `node tools/verify-config.mjs`.
 *
 * This is a development convenience only. Nothing here ships to the browser,
 * and the app itself neither builds nor installs anything.
 *
 * The most useful check is the monotonicity one: rep targets must never drop
 * as levels rise, which catches most transposition slips when you retune the
 * bird-dog columns.
 */

// state.js persists through localStorage, which doesn't exist in Node.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const cfg = await import('../js/config.js');
const store = await import('../js/state.js');

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) return;
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ shape */

check('6 charts', cfg.CHARTS.length === 6, `got ${cfg.CHARTS.length}`);
check('12 levels', cfg.LEVELS.length === 12, `got ${cfg.LEVELS.length}`);
check('11 minutes total', cfg.TOTAL_SECONDS === 660,
  `got ${cfg.TOTAL_SECONDS}s — check TIMING_SECONDS`);
check('5 timings', cfg.TIMING_SECONDS.length === 5);

for (const chart of cfg.CHARTS) {
  const id = chart.id;
  check(`chart ${id}: 5 exercises`, chart.exercises.length === 5,
    `got ${chart.exercises.length}`);
  check(`chart ${id}: exercise 5 counts steps`,
    chart.exercises[4].unit === 'steps');
  check(`chart ${id}: exercise 5 has an interval cue`,
    Number.isInteger(chart.exercises[4].interval?.every) &&
    Number.isInteger(chart.exercises[4].interval?.count));

  chart.exercises.forEach((ex, i) => {
    check(`chart ${id} ex${i + 1}: has a name`,
      typeof ex.name === 'string' && ex.name.length > 0);
    check(`chart ${id} ex${i + 1}: has instructions`,
      typeof ex.text === 'string' && ex.text.length > 20);
    check(`chart ${id} ex${i + 1}: has a unit`,
      ex.unit === 'reps' || ex.unit === 'steps', String(ex.unit));
  });

  const levels = Object.keys(chart.reps);
  check(`chart ${id}: one rep row per level`, levels.length === 12,
    `got ${levels.length}`);

  for (const level of cfg.LEVELS) {
    const row = chart.reps[level];
    check(`chart ${id} ${level}: row exists`, Array.isArray(row));
    if (!Array.isArray(row)) continue;
    check(`chart ${id} ${level}: 5 targets`, row.length === 5,
      JSON.stringify(row));
    check(`chart ${id} ${level}: positive whole numbers`,
      row.every((n) => Number.isInteger(n) && n > 0), JSON.stringify(row));
  }

  // Targets must never decrease as levels rise.
  for (let i = 1; i < cfg.LEVELS.length; i += 1) {
    const prev = chart.reps[cfg.LEVELS[i - 1]];
    const curr = chart.reps[cfg.LEVELS[i]];
    if (!prev || !curr) continue;
    const dropped = curr
      .map((n, j) => (n < prev[j] ? `exercise ${j + 1}` : null))
      .filter(Boolean);
    check(`chart ${id}: ${cfg.LEVELS[i]} is not easier than ${cfg.LEVELS[i - 1]}`,
      dropped.length === 0, dropped.join(', '));
  }
}

/* ------------------------------------------------------- age & progression */

const ageCases = [[16, 1], [20, 1], [21, 2], [29, 2], [30, 4], [39, 4],
                  [40, 7], [49, 7], [50, 8], [59, 8], [60, 10], [85, 10]];
for (const [age, expected] of ageCases) {
  check(`age ${age} requires ${expected} day(s)`,
    cfg.minDaysForAge(age) === expected, `got ${cfg.minDaysForAge(age)}`);
}

check('level advances within a chart',
  cfg.nextPosition(1, 0)?.levelIndex === 1);
check('A+ rolls over to the next chart',
  cfg.nextPosition(1, 11)?.chartId === 2 &&
  cfg.nextPosition(1, 11)?.levelIndex === 0);
check('top of the program has no next level',
  cfg.nextPosition(6, 11) === null);

/* ------------------------------------------------------------ state rules */

store.resetAll();
store.updateSettings({ age: 30 });
check('required days follow the age table', store.requiredDays() === 4,
  `got ${store.requiredDays()}`);
store.updateSettings({ minDaysOverride: 3 });
check('override beats the age table', store.requiredDays() === 3);
store.updateSettings({ minDaysOverride: null });

store.getProgress().levelStartedTs -= 1000; // see daysAtLevel() on the boundary
store.logSession([true, true, true, true, true]);
store.logSession([true, true, true, true, true]);
check('two sessions on one day count as one day', store.daysAtLevel() === 1,
  `got ${store.daysAtLevel()}`);
check('advance blocked before the minimum days', store.canAdvance() === false);

store.getProgress().levelStartedTs -= 10 * 86400000;
for (let d = 1; d <= 3; d += 1) {
  const when = new Date(Date.now() - d * 86400000);
  store.getSessions().push({
    ts: when.getTime(), date: store.todayKey(when), chartId: 1, levelIndex: 0,
    results: [true, true, true, true, true], completed: true,
  });
}
check('distinct days accumulate', store.daysAtLevel() === 4,
  `got ${store.daysAtLevel()}`);
check('advance unlocked at the minimum', store.canAdvance() === true);
store.advanceLevel();
check('advancing resets the day counter', store.daysAtLevel() === 0,
  `got ${store.daysAtLevel()}`);

/* ------------------------------------------------------------------- done */

if (failures === 0) {
  const total = cfg.CHARTS.length * cfg.LEVELS.length;
  console.log(`config.js looks good — ${cfg.CHARTS.length} charts, ` +
    `${total} levels, ${cfg.TOTAL_SECONDS / 60} minutes per session.`);
} else {
  console.log(`\n${failures} problem(s) found.`);
}
process.exit(failures === 0 ? 0 : 1);
