import type { Segment } from '../shared/types';

interface Mark {
  streamTime: number;
  mediaTime: number;
  rate: number;
}

/**
 * Maps stream time (seconds of audio sent to the provider) to media time
 * (video.currentTime). Every audio chunk records where it sat in the video and
 * at what playback rate, so pauses, seeks and 0.75× playback all map back
 * correctly.
 */
export class MediaClock {
  private marks: Mark[] = [];

  add(streamTime: number, mediaTime: number, rate: number): void {
    this.marks.push({ streamTime, mediaTime, rate });
  }

  toMedia(streamTime: number): number {
    const marks = this.marks;
    if (marks.length === 0) return streamTime;
    // Last mark at or before streamTime.
    let lo = 0;
    let hi = marks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (marks[mid].streamTime <= streamTime) lo = mid;
      else hi = mid - 1;
    }
    const mark = marks[lo];
    return mark.mediaTime + (streamTime - mark.streamTime) * mark.rate;
  }

  toMediaSegment(segment: Segment): Segment {
    return {
      ...segment,
      start: this.toMedia(segment.start),
      end: this.toMedia(segment.end),
      words: segment.words?.map((w) => ({ ...w, start: this.toMedia(w.start), end: this.toMedia(w.end) })),
    };
  }
}
