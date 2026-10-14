import type { Word } from '../shared/types';

const WINDOW = 50;

/**
 * Measures caption delay: how far playback has moved past a word's end by the
 * time the word first appears (interim or final).
 */
export class LatencyMeter {
  private latestEnd = -Infinity;
  private samples: number[] = [];

  record(words: Word[], now: number): void {
    for (const word of words) {
      if (word.end <= this.latestEnd) continue;
      this.latestEnd = word.end;
      const lag = now - word.end;
      // Negative or huge values come from replays and jumps, not live audio.
      if (lag >= 0 && lag < 10) this.samples.push(lag);
    }
    if (this.samples.length > WINDOW) this.samples.splice(0, this.samples.length - WINDOW);
  }

  /** Call when playback jumps, so words before the new position count again. */
  reset(): void {
    this.latestEnd = -Infinity;
  }

  get median(): number | undefined {
    if (this.samples.length === 0) return undefined;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  get count(): number {
    return this.samples.length;
  }
}
