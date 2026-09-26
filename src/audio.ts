export class JellyAudio {
  muted = true;
  private context: AudioContext | null = null;
  private lastSound = 0;
  async enable() {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    this.muted = false;
    this.squish(0.7);
  }
  squish(strength = 1) {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (now - this.lastSound < 0.13) return;
    this.lastSound = now;
    const osc = this.context.createOscillator(),
      gain = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180 + Math.min(strength, 3) * 55, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.16);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(Math.min(0.055, strength * 0.025), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.context.destination);
    osc.start(now);
    osc.stop(now + 0.22);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  dispose() {
    void this.context?.close();
  }
}
