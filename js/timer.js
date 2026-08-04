/*
 * Countdown timer driven by the wall clock rather than by accumulated ticks,
 * so it stays accurate if the tab is backgrounded, the phone sleeps, or the
 * interval is throttled — on resume it simply recomputes from Date.now().
 */

export class Countdown {
  /**
   * @param {number} seconds total duration
   * @param {(remaining:number, elapsed:number) => void} onTick
   * @param {() => void} onDone fired once when the clock reaches zero
   */
  constructor(seconds, onTick, onDone) {
    this.duration = seconds;
    this.onTick = onTick;
    this.onDone = onDone;
    this.elapsedBeforePause = 0;
    this.startedAt = null;
    this.finished = false;
    this.handle = null;
  }

  get elapsed() {
    const running = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    return Math.min(this.duration, this.elapsedBeforePause + running);
  }

  get remaining() {
    return Math.max(0, this.duration - this.elapsed);
  }

  get running() {
    return this.startedAt !== null;
  }

  start() {
    if (this.running || this.finished) return;
    this.startedAt = Date.now();
    // 200ms keeps the seconds display crisp without meaningful battery cost.
    this.handle = setInterval(() => this._tick(), 200);
    this._tick();
  }

  pause() {
    if (!this.running) return;
    this.elapsedBeforePause = this.elapsed;
    this.startedAt = null;
    clearInterval(this.handle);
    this.handle = null;
    this._emit();
  }

  toggle() {
    this.running ? this.pause() : this.start();
  }

  reset() {
    clearInterval(this.handle);
    this.handle = null;
    this.startedAt = null;
    this.elapsedBeforePause = 0;
    this.finished = false;
    this._emit();
  }

  /** Stop for good — used when the user ends an exercise early. */
  stop() {
    clearInterval(this.handle);
    this.handle = null;
    this.startedAt = null;
    this.finished = true;
  }

  _tick() {
    this._emit();
    if (this.remaining <= 0 && !this.finished) {
      this.finished = true;
      clearInterval(this.handle);
      this.handle = null;
      this.startedAt = null;
      this.onDone?.();
    }
  }

  _emit() {
    this.onTick?.(this.remaining, this.elapsed);
  }
}

/*
 * Screen Wake Lock — keeps the phone awake during the 6-minute run so the
 * screen doesn't lock mid-exercise. Not supported everywhere; every call is
 * best-effort and failures are ignored on purpose.
 */
let wakeLock = null;

export async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* denied or unsupported — harmless */ }
}

export function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// The OS drops the lock whenever the page is hidden; re-take it on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock === null) {
    if (document.body?.dataset.keepAwake === 'true') acquireWakeLock();
  }
});
