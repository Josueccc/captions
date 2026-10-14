/** Audio sent to providers is always 16 kHz mono signed 16-bit PCM. */
export const SAMPLE_RATE = 16000;

export const PORT_NAME = 'transcription';

export interface Word {
  text: string;
  start: number;
  end: number;
  /** Not yet confirmed by the provider; may still change. */
  tentative?: boolean;
}

/**
 * A caption line. Providers emit times in *stream* seconds (seconds of audio
 * sent so far); the background converts them to *media* seconds
 * (video.currentTime) before they reach the content script.
 * Re-emitting a segment with the same id replaces the previous version.
 */
export interface Segment {
  id: string;
  text: string;
  start: number;
  end: number;
  words?: Word[];
  final: boolean;
}

export type SessionStatus = 'idle' | 'connecting' | 'running' | 'error';

/** Content script -> background, over the transcription port. */
export type ToBackground =
  | { type: 'start' }
  /** pcm: base64 of Int16 little-endian samples. mediaTime: video time at the first sample. */
  | { type: 'audio'; pcm: string; mediaTime: number; rate: number }
  /** Audio is about to jump (pause/seek/new video): finish the current utterance. */
  | { type: 'flush' }
  | { type: 'ping' };

/** Background -> content script, over the transcription port. */
export type ToContent =
  | { type: 'segment'; segment: Segment }
  | { type: 'status'; status: SessionStatus; message?: string };

/** Popup/background -> content script, via tabs.sendMessage. */
export type TabRequest = { type: 'toggle' } | { type: 'get-state' };

export interface TabState {
  hasVideo: boolean;
  active: boolean;
  status: SessionStatus;
  message?: string;
}

/** Audio is sent in 100 ms chunks. */
export const CHUNK_SAMPLES = SAMPLE_RATE / 10;
