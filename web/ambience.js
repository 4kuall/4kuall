// A generative ambient drone that breathes with the Oracle: the chord follows its
// mood, and the filter opens while it thinks. Pure Web Audio, no samples.
const CHORDS = {
  serene: [110, 164.81, 220, 329.63],
  compassionate: [130.81, 196, 261.63, 329.63],
  joyful: [146.83, 220, 293.66, 369.99],
  grave: [73.42, 110, 146.83, 174.61],
  fierce: [98, 146.83, 196, 233.08],
  curious: [123.47, 185, 246.94, 349.23],
  melancholic: [110, 130.81, 164.81, 220],
  awed: [87.31, 130.81, 174.61, 261.63],
};

export class Ambience {
  attach(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 600;
    this.filter.Q.value = 2;
    this.filter.connect(this.master);
    this.master.connect(ctx.destination);

    this.voices = CHORDS.serene.map((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain();
      g.gain.value = 0.16 / (i + 1);
      // Slow tremolo so the drone breathes.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.12;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.05 / (i + 1);
      lfo.connect(lfoGain).connect(g.gain);
      osc.connect(g).connect(this.filter);
      osc.start();
      lfo.start();
      return osc;
    });

    // Airy noise bed.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.012;
    noise.connect(bp).connect(ng).connect(this.master);
    noise.start();
  }

  toggle(on) {
    if (!this.ctx) return;
    this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 1.2);
  }

  setMood(mood) {
    if (!this.ctx) return;
    const chord = CHORDS[mood] || CHORDS.serene;
    this.voices.forEach((o, i) => o.frequency.setTargetAtTime(chord[i], this.ctx.currentTime, 2.5));
  }

  setState(state) {
    if (!this.ctx) return;
    const f = { thinking: 1400, speaking: 450, listening: 900 }[state] || 650;
    this.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.8);
  }
}
