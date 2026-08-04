/*
 * Audio + haptic cues, synthesised with WebAudio so there are no sound files
 * to download. Needed because exercise 5 runs for six minutes and the screen
 * won't be in view.
 *
 * Browsers block audio until a user gesture, so unlock() is called from the
 * Start button's click handler.
 */

let ctx = null;

export function unlockAudio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function tone(frequency, startOffset, duration, gain = 0.25) {
  if (!ctx || ctx.state !== 'running') return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;

  const t0 = ctx.currentTime + startOffset;
  // Short ramps instead of hard starts/stops, which would click audibly.
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  amp.gain.setValueAtTime(gain, t0 + duration - 0.04);
  amp.gain.linearRampToValueAtTime(0, t0 + duration);

  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function vibrate(pattern) {
  navigator.vibrate?.(pattern);
}

/** Exercise time is up — deliberately hard to miss. */
export function cueTimeUp() {
  [0, 0.28, 0.56].forEach((offset) => tone(880, offset, 0.22, 0.3));
  tone(660, 0.84, 0.5, 0.3);
  vibrate([220, 120, 220, 120, 420]);
}

/** Interval cue: time for the block of jumps mid-run. */
export function cueInterval() {
  tone(1046, 0, 0.14);
  tone(1318, 0.16, 0.24);
  vibrate([140, 90, 140]);
}

/** Light acknowledgement for taps/state changes. */
export function cueBlip() {
  tone(660, 0, 0.08, 0.15);
  vibrate(35);
}
