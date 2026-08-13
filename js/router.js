/*
 * View routing on top of the browser's session history.
 *
 * Every screen past Home gets its own history entry, so the Android hardware
 * back button walks back through the app. Home stays the root entry: back from
 * there falls out to the launcher, which is what a user expects.
 */

export function createRouter({ views, window: win = globalThis.window }) {
  const home = 'home';
  /*
   * The views behind us, rooted at Home — our mirror of the history entries
   * this app owns. Each entry's state carries its depth, which is how a
   * popstate tells us where in the stack the user has landed.
   */
  let stack = [home];
  let showing = null;
  let teardown = null;
  let confirmLeave = () => true;

  /*
   * A view returns nothing, a teardown function, or — when leaving it is
   * destructive — { teardown, confirmLeave }. confirmLeave() is asked before
   * *any* departure, so a back press and an on-screen quit button get the
   * same answer.
   */
  function render(name) {
    teardown?.();
    win.scrollTo(0, 0);
    win.document.body.dataset.view = name;
    showing = name;

    const mounted = views[name]() ?? {};
    const view = typeof mounted === 'function' ? { teardown: mounted } : mounted;
    teardown = view.teardown ?? null;
    confirmLeave = view.confirmLeave ?? (() => true);
  }

  /*
   * Navigating to a screen we came from is a *back* move, however it was
   * triggered — an on-screen "Back" button included. Popping keeps the two
   * ways out of a screen in agreement; pushing a second Home entry would make
   * the next back press appear to go forwards.
   */
  function go(name) {
    if (name === showing) return;
    const behind = stack.lastIndexOf(name);
    if (behind !== -1) win.history.go(behind - (stack.length - 1));
    else {
      stack.push(name);
      win.history.pushState({ view: name, depth: stack.length - 1 }, '');
      render(name);
    }
  }

  win.addEventListener('popstate', (event) => {
    const { view = home, depth = 0 } = event.state ?? {};

    // The entry is already gone by the time we hear about it, so a refusal
    // has to put it back — otherwise the next back press would skip past the
    // screen the user just chose to stay on.
    if (!confirmLeave()) {
      win.history.pushState({ view: showing, depth: stack.length - 1 }, '');
      return;
    }

    stack = stack.slice(0, depth).concat(view);
    render(view);
  });

  function start() {
    stack = [home];
    win.history.replaceState({ view: home, depth: 0 }, '');
    render(home);
  }

  return { go, start, get showing() { return showing; } };
}
