// WebAudioSynthesizer — the whole soundscape of Solis Heat is manufactured live
// from oscillators and shaped noise; the game ships no audio assets at all.
// A sawtooth engine voice tracks the player's speed, a band of filtered noise
// becomes tyre screech under the handbrake, the SPD siren is a triangle wave
// whose wail rate the caller drives by proximity, gunfire is a noise burst
// with a different body for each weapon, and a quiet synthwave pad cycle
// (toggle with R) rolls underneath free-roam driving.
export class WebAudioSynthesizer {
  constructor() {
    this.context = null;
    this.master = null;
    this.sharedNoise = null;
    this.engine = null; // { osc, sub, filter, gain }
    this.skid = null; // { source, filter, gain }
    this.siren = null; // { osc, lfo, lfoGain, gain }
    this.radioOn = false;
    this.radioTimer = 0;
    this.radioStep = 0;
    this.radioNodes = [];
  }

  /** Build the context lazily on the first user gesture; safe to call often. */
  ensure() {
    if (this.context) {
      if (this.context.state === 'suspended') this.context.resume();
      return true;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.45;
    // A gentle bus compressor keeps stacked sirens, gunfire and the radio
    // from clipping the output on small speakers.
    const bus = this.context.createDynamicsCompressor();
    bus.threshold.value = -18;
    bus.ratio.value = 6;
    this.master.connect(bus);
    bus.connect(this.context.destination);
    return true;
  }

  /** One reusable white-noise buffer that every noise voice samples from. */
  noiseBuffer(seconds = 1) {
    if (this.sharedNoise) return this.sharedNoise;
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      // Slightly pinked noise reads less harsh through small speakers.
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[i] = last * 2.4;
    }
    this.sharedNoise = buffer;
    return buffer;
  }

  loopNoise() {
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer(1.6);
    source.loop = true;
    return source;
  }

  /**
   * Engine + skid voice. `speedRatio` is 0..1 of the car's top speed;
   * call with active=false when the player is on foot to park both voices.
   */
  setEngine(active, speedRatio = 0, drifting = false) {
    if (!this.ensure()) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    if (!this.engine) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2.2;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start();
      sub.start();
      this.engine = { osc, sub, filter, gain };
      const skidSource = this.loopNoise();
      const skidFilter = ctx.createBiquadFilter();
      skidFilter.type = 'bandpass';
      skidFilter.frequency.value = 880;
      skidFilter.Q.value = 5.5;
      const skidGain = ctx.createGain();
      skidGain.gain.value = 0;
      skidSource.connect(skidFilter);
      skidFilter.connect(skidGain);
      skidGain.connect(this.master);
      skidSource.start();
      this.skid = { source: skidSource, filter: skidFilter, gain: skidGain };
    }
    const ratio = Math.max(0, Math.min(1, speedRatio));
    // Fake gear steps: the note climbs, drops back, climbs again.
    const gearSpan = 0.24;
    const inGear = (ratio % gearSpan) / gearSpan;
    const pitch = 52 + inGear * 74 + Math.floor(ratio / gearSpan) * 9;
    const e = this.engine;
    e.osc.frequency.setTargetAtTime(pitch, now, 0.06);
    e.sub.frequency.setTargetAtTime(pitch / 2, now, 0.06);
    e.filter.frequency.setTargetAtTime(240 + ratio * 1500, now, 0.08);
    e.gain.gain.setTargetAtTime(active ? 0.05 + ratio * 0.075 : 0, now, 0.09);
    this.skid.gain.gain.setTargetAtTime(active && drifting ? 0.11 : 0, now, 0.05);
    this.skid.filter.frequency.setTargetAtTime(760 + ratio * 480, now, 0.05);
  }

  /** SPD siren voice; `level` is 0..1 by the nearest unit's proximity. */
  setSiren(level) {
    if (!this.context) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    if (!this.siren) {
      if (level <= 0.01) return;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 830;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.65;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 190;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(this.master);
      osc.start();
      lfo.start();
      this.siren = { osc, lfo, lfoGain, gain };
    }
    const clamped = Math.max(0, Math.min(1, level));
    this.siren.gain.gain.setTargetAtTime(clamped * 0.055, now, 0.12);
    this.siren.lfo.frequency.setTargetAtTime(0.5 + clamped * 0.55, now, 0.2);
  }

  /** One gunshot, voiced per weapon id: pistol crack, SMG snap, shotgun boom. */
  shot(kind) {
    if (!this.ensure()) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const voice = (duration, filterFreq, type, peak) => {
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(1.6);
      source.playbackRate.value = 0.9 + Math.random() * 0.2;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = filterFreq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(peak, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(now, Math.random() * 0.4, duration + 0.05);
      source.stop(now + duration + 0.06);
    };
    if (kind === 'shotgun') {
      voice(0.34, 900, 'lowpass', 0.5);
      voice(0.12, 2600, 'highpass', 0.22);
    } else if (kind === 'smg') {
      voice(0.09, 3200, 'bandpass', 0.3);
    } else if (kind === 'unarmed') {
      voice(0.07, 500, 'lowpass', 0.2);
    } else {
      voice(0.16, 2100, 'bandpass', 0.38);
      voice(0.05, 4200, 'highpass', 0.16);
    }
  }

  /** Short UI / world blips: pickups, cash register ticks, mission stingers. */
  blip(kind = 'pickup') {
    if (!this.ensure()) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const tone = (freq, at, duration, type = 'sine', peak = 0.12) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(peak, now + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, now + at + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now + at);
      osc.stop(now + at + duration + 0.03);
    };
    if (kind === 'cash') {
      tone(1240, 0, 0.09, 'square', 0.07);
      tone(1860, 0.055, 0.12, 'square', 0.06);
    } else if (kind === 'mission') {
      tone(392, 0, 0.16, 'triangle', 0.14);
      tone(587, 0.1, 0.16, 'triangle', 0.14);
      tone(784, 0.2, 0.3, 'triangle', 0.15);
    } else if (kind === 'alarm') {
      tone(660, 0, 0.11, 'square', 0.1);
      tone(660, 0.16, 0.11, 'square', 0.1);
    } else if (kind === 'repaint') {
      tone(300, 0, 0.3, 'sawtooth', 0.05);
      tone(900, 0.05, 0.22, 'sine', 0.1);
    } else {
      tone(880, 0, 0.1, 'sine', 0.11);
      tone(1320, 0.06, 0.14, 'sine', 0.09);
    }
  }

  /** A low collision thump; `strength` scales volume and depth. */
  thud(strength = 1) {
    if (!this.ensure()) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const s = Math.max(0.2, Math.min(1.6, strength));
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120 * s, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22 * s, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.22);
    const crunch = ctx.createBufferSource();
    crunch.buffer = this.noiseBuffer(1.6);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const crunchGain = ctx.createGain();
    crunchGain.gain.setValueAtTime(0.1 * s, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    crunch.connect(filter);
    filter.connect(crunchGain);
    crunchGain.connect(this.master);
    crunch.start(now, Math.random() * 0.5, 0.12);
  }

  /** Toggle the coastal synthwave radio. Returns the new on/off state. */
  toggleRadio() {
    if (!this.ensure()) return false;
    this.radioOn = !this.radioOn;
    if (this.radioOn) {
      this.radioStep = 0;
      this.playRadioStep();
      this.radioTimer = window.setInterval(() => this.playRadioStep(), 1900);
    } else {
      window.clearInterval(this.radioTimer);
      this.radioTimer = 0;
    }
    return this.radioOn;
  }

  playRadioStep() {
    if (!this.radioOn || !this.context) return;
    // A slow sunset progression in A minor: Am — F — C — G, one chord a step,
    // with a soft sub bass walking the root notes beneath the pads.
    const chords = [
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [130.81, 164.81, 196.0],
      [196.0, 246.94, 293.66],
    ];
    const roots = [55.0, 43.65, 32.7, 49.0];
    const index = this.radioStep % chords.length;
    this.radioStep += 1;
    const ctx = this.context;
    const now = ctx.currentTime;
    for (const freq of chords[index]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.028, now + 0.5);
      gain.gain.setValueAtTime(0.028, now + 1.35);
      gain.gain.linearRampToValueAtTime(0, now + 1.95);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 2.0);
    }
    const bass = ctx.createOscillator();
    bass.type = 'sine';
    bass.frequency.value = roots[index] * 2;
    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(0.07, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 1.7);
    bass.connect(bassGain);
    bassGain.connect(this.master);
    bass.start(now);
    bass.stop(now + 1.75);
  }
}
