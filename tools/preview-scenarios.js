/*
 * App states that take too long to reach by hand, for tools/preview.mjs.
 *
 * Each scenario resets the save, seeds what it needs and renders one view into
 * `root`. The summary, for one, sits behind an 11-minute workout. Runs in the
 * browser; test/preview.test.js also runs every scenario under jsdom so they
 * keep up with the views they drive.
 *
 * App modules are imported inside each scenario, not at the top: they touch
 * the DOM on load, and tools/preview.mjs imports this file in Node just to
 * list the scenario names.
 */

const DAY = 86_400_000;

async function load() {
  const [store, { renderWorkout }, { renderHistory }] = await Promise.all([
    import('../js/state.js'), import('../js/workout.js'), import('../js/history.js'),
  ]);
  return { store, renderWorkout, renderHistory };
}

/** Completed sessions on each of the last `days` days, at the current level. */
function seedDays(store, days, missOn = null) {
  for (let d = days; d >= 1; d -= 1) {
    const when = new Date(Date.now() - d * DAY);
    const results = [true, true, d !== missOn, true, true];
    store.getSessions().push({
      ts: when.getTime(), date: store.todayKey(when), chartId: 1, levelIndex: 0,
      results, completed: results.every(Boolean),
    });
  }
}

function tap(root, label) {
  [...root.querySelectorAll('button')].find((b) => b.textContent === label).click();
}

/** Start the current exercise and end it at once, landing on its checkpoint. */
function endExercise(root) {
  tap(root, 'Start');
  tap(root, 'End exercise');
}

export const scenarios = {
  /** Workout summary with exercise 3 missed; flipping it unlocks the advance. */
  async summary(root) {
    const { store, renderWorkout } = await load();
    store.resetAll();
    store.updateSettings({ age: 30 }); // 4 days per level
    store.getProgress().levelStartedTs = Date.now() - 10 * DAY;
    seedDays(store, 3);
    renderWorkout(root, { onExit() {} });
    for (let i = 0; i < 5; i += 1) {
      endExercise(root);
      tap(root, i === 2 ? 'No' : 'Yes');
    }
  },

  /** Exercise 3's Start screen, with the button that redoes exercise 2. */
  async redo(root) {
    const { store, renderWorkout } = await load();
    store.resetAll();
    renderWorkout(root, { onExit() {} });
    for (let i = 0; i < 2; i += 1) {
      endExercise(root);
      tap(root, 'Yes');
    }
  },

  /** Exercise 2's checkpoint, with the button that redoes it. */
  async checkpoint(root) {
    const { store, renderWorkout } = await load();
    store.resetAll();
    renderWorkout(root, { onExit() {} });
    endExercise(root);
    tap(root, 'Yes');
    endExercise(root);
  },

  /** Progress view with a week of sessions, one of them partial. */
  async history(root) {
    const { store, renderHistory } = await load();
    store.resetAll();
    store.getProgress().levelStartedTs = Date.now() - 10 * DAY;
    seedDays(store, 7, 3);
    renderHistory(root, { onNav() {} });
  },
};
