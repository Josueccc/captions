import type { Segment } from '../shared/types';

/** Live captions arrive ~1–2 s late, so keep the latest line up a while. */
const LIVE_HOLD_SECONDS = 4;
/** When replaying cached lines, hold a line briefly after its last word. */
const REPLAY_HOLD_SECONDS = 1.5;
const MIN_OVERLAP_SECONDS = 0.2;

/** Caption lines for one video, in media time, sorted by start. */
export class CaptionStore {
  private segments: Segment[] = [];
  /** Ids received since the last newRun(); lines from earlier runs get replaced on overlap. */
  private runIds = new Set<string>();

  /** Call when the audio jumps (seek, pause), so re-transcribed lines replace the cached ones. */
  newRun(): void {
    this.runIds.clear();
  }

  upsert(segment: Segment): void {
    this.runIds.add(segment.id);
    this.segments = this.segments.filter(
      (s) =>
        s.id !== segment.id &&
        (this.runIds.has(s.id) ||
          Math.min(s.end, segment.end) - Math.max(s.start, segment.start) < MIN_OVERLAP_SECONDS),
    );
    let i = this.segments.length;
    while (i > 0 && this.segments[i - 1].start > segment.start) i--;
    this.segments.splice(i, 0, segment);
  }

  /** The line to show at media time t. */
  at(t: number): Segment | undefined {
    let i = this.segments.length - 1;
    while (i >= 0 && this.segments[i].start > t + 0.05) i--;
    if (i < 0) return undefined;
    const segment = this.segments[i];
    const next = this.segments[i + 1];
    const until = next ? Math.min(next.start, segment.end + REPLAY_HOLD_SECONDS) : segment.end + LIVE_HOLD_SECONDS;
    return t <= until ? segment : undefined;
  }
}
