export class FireAudio {
  muted = true;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  async toggle() {
    if (!this.context) {
      this.context = new AudioContext();
      const buffer = this.context.createBuffer(
        1,
        this.context.sampleRate * 8,
        this.context.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      let seed = 197,
        brown = 0;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      let crack = 0;
      for (let i = 0; i < samples.length; i++) {
        const noise = random() * 2 - 1;
        brown = (brown + noise * 0.035) / 1.025;
        if (random() > 0.9997) crack = 0.3 + random() * 0.6;
        crack *= 0.992;
        samples[i] = brown * 0.8 + noise * crack;
      }
      this.source = this.context.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = true;
      this.filter = this.context.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 3800;
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.source.connect(this.filter).connect(this.gain).connect(this.context.destination);
      this.source.start();
    }
    if (this.context.state === 'suspended') await this.context.resume();
    this.muted = !this.muted;
  }
  update(intensity: number, paused: boolean) {
    if (this.context && this.gain)
      this.gain.gain.setTargetAtTime(
        this.muted || paused ? 0 : Math.min(0.6, intensity * 0.42),
        this.context.currentTime,
        0.06,
      );
  }
  reset() {
    this.muted = true;
    this.update(0, true);
  }
  dispose() {
    this.source?.stop();
    this.source?.disconnect();
    this.filter?.disconnect();
    this.gain?.disconnect();
    void this.context?.close();
  }
}
