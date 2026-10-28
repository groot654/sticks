// All sounds are synthesised with WebAudio (filtered noise + a few partials),
// so there are no audio assets to ship or license.

export class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const sr = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, sr * 2, sr);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.55;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // A shaped burst of filtered noise; the building block for every paper sound.
  burst({ at = 0, dur = 0.05, freq = 3000, q = 1, type = 'bandpass', gain = 0.3, attack = 0.002 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    src.connect(filter).connect(env).connect(this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + dur + 0.05);
  }

  tone({ at = 0, freq, dur, gain }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // A tiny crinkle while the adhesive lets go, scaled by how fast the corner moves.
  peelTick(amount) {
    const n = Math.min(3, Math.floor(amount / 6));
    for (let i = 0; i < n; i++) {
      this.burst({ at: Math.random() * 0.03, dur: 0.012 + Math.random() * 0.02, freq: 2500 + Math.random() * 4000, q: 2, gain: 0.05 + Math.random() * 0.06 });
    }
  }

  // The sticky "zzip" when the glue strip finally releases.
  rip() {
    for (let i = 0; i < 14; i++) {
      this.burst({ at: i * 0.011 + Math.random() * 0.006, dur: 0.02, freq: 1800 + Math.random() * 3500, q: 3, gain: 0.12 + Math.random() * 0.1 });
    }
    this.burst({ dur: 0.16, freq: 5000, q: 0.7, gain: 0.08 });
  }

  crumple(duration = 0.6) {
    const grains = Math.round(duration * 70);
    for (let i = 0; i < grains; i++) {
      const at = Math.pow(Math.random(), 0.8) * duration;
      const loud = 0.08 + Math.random() * 0.22 * (1 - at / duration * 0.5);
      this.burst({ at, dur: 0.01 + Math.random() * 0.035, freq: 900 + Math.random() * 6000, q: 1.5 + Math.random() * 3, gain: loud });
    }
    this.burst({ dur: duration, freq: 2500, q: 0.4, gain: 0.05, attack: 0.05 });
  }

  // Paper hitting a wall/floor: a soft, dull tap.
  tap(strength) {
    const g = Math.min(0.35, 0.04 + strength * 0.025);
    this.burst({ dur: 0.05, freq: 700, q: 0.8, type: 'lowpass', gain: g });
    this.burst({ dur: 0.02, freq: 3000, q: 1, gain: g * 0.4 });
  }

  // Paper ball clipping the metal rim of the bin.
  tink(strength) {
    const g = Math.min(0.25, 0.05 + strength * 0.02);
    for (const [f, d] of [[1240, 0.35], [2790, 0.25], [4130, 0.15], [5920, 0.1]]) {
      this.tone({ freq: f * (0.98 + Math.random() * 0.04), dur: d, gain: g / (f / 1240) });
    }
    this.tap(strength * 0.5);
  }

  // Landing inside the bin: hollow thump plus a rattle of the mesh.
  inBin() {
    this.burst({ dur: 0.18, freq: 220, q: 1.2, type: 'lowpass', gain: 0.5 });
    this.tone({ freq: 140, dur: 0.18, gain: 0.18 });
    for (let i = 0; i < 6; i++) this.burst({ at: 0.02 + i * 0.025, dur: 0.02, freq: 1800 + Math.random() * 1200, q: 4, gain: 0.05 });
  }

  whoosh(speed) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(1600, t + 0.15);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.35);
    const env = ctx.createGain();
    const g = Math.min(0.25, speed * 0.006);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(g, t + 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    src.connect(filter).connect(env).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.45);
  }

  // Re-sticking a note: a flat pat of paper against the screen.
  pat() {
    this.burst({ dur: 0.06, freq: 500, q: 0.7, type: 'lowpass', gain: 0.35 });
    this.burst({ dur: 0.03, freq: 2400, q: 1, gain: 0.06 });
  }

  // Ticking a checklist box: a quick pencil scratch.
  tick() {
    this.burst({ dur: 0.025, freq: 3800, q: 2, gain: 0.12 });
    this.burst({ at: 0.035, dur: 0.04, freq: 2600, q: 1.5, gain: 0.1 });
  }

  flap() {
    this.burst({ dur: 0.08, freq: 1200, q: 0.6, gain: 0.08 });
  }
}
