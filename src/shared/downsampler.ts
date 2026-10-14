import { SAMPLE_RATE } from './types';

/**
 * Mixes to mono and downsamples to 16 kHz by averaging each window of input
 * samples (a box filter — crude, but plenty for speech recognition), then
 * emits fixed-size Int16 chunks. Shared by the AudioWorklet and the
 * ScriptProcessor fallback.
 */
export class Downsampler {
  private readonly ratio: number;
  private acc = 0;
  private accCount = 0;
  private pos = 0;
  private out: Int16Array;
  private outCount = 0;

  constructor(
    inputRate: number,
    private readonly chunkSize: number,
    private readonly onChunk: (chunk: Int16Array) => void,
  ) {
    this.ratio = inputRate / SAMPLE_RATE;
    this.out = new Int16Array(chunkSize);
  }

  process(channels: Float32Array[]): void {
    if (channels.length === 0) return;
    const frames = channels[0].length;
    for (let i = 0; i < frames; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      this.acc += sample / channels.length;
      this.accCount++;
      this.pos++;
      if (this.pos < this.ratio) continue;

      this.pos -= this.ratio;
      const value = Math.max(-1, Math.min(1, this.acc / this.accCount));
      this.acc = 0;
      this.accCount = 0;
      this.out[this.outCount++] = value < 0 ? value * 0x8000 : value * 0x7fff;
      if (this.outCount === this.chunkSize) {
        this.onChunk(this.out);
        this.out = new Int16Array(this.chunkSize);
        this.outCount = 0;
      }
    }
  }
}
