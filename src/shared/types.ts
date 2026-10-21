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

/** A fix the popup can offer next to an error. */
export type Help = 'install-companion';

/** Downloads of the system-audio companion (companion/ in the repo). */
export const COMPANION_URL = 'https://github.com/zerathul/captions/releases/latest';

/**
 * Where the audio comes from: the page's <video> element, or the system-audio
 * companion (for DRM-protected videos, which the page can't capture).
 */
export type AudioRoute = 'page' | 'system';

/** Content script -> background, over the transcription port. */
export type ToBackground =
  /** title: the page title, which names the tab's audio stream for the companion. */
  | { type: 'start'; route: AudioRoute; source: CompanionSource; title: string }
  /** pcm: base64 of Int16 little-endian samples. mediaTime: video time at the first sample. */
  | { type: 'audio'; pcm: string; mediaTime: number; rate: number }
  /**
   * Video position at wall-clock time `at` (Date.now()), sent several times a
   * second in the system route so the background can place companion audio.
   */
  | { type: 'clock'; mediaTime: number; rate: number; playing: boolean; at: number; title: string }
  /** Audio is about to jump (pause/seek/new video): finish the current utterance. */
  | { type: 'flush' }
  | { type: 'ping' };

/** Background -> content script, over the transcription port. */
export type ToContent =
  | { type: 'segment'; segment: Segment }
  | { type: 'status'; status: SessionStatus; message?: string; help?: Help }
  /** Transient information for the overlay (e.g. what the companion is recording). */
  | { type: 'info'; message: string };

/** What the companion records: the tab's own audio stream, or everything the system plays. */
export type CompanionSource = 'tab' | 'system';

/** Popup/background -> content script, via tabs.sendMessage. */
export type TabRequest = { type: 'toggle' } | { type: 'get-state' };

export interface TabState {
  hasVideo: boolean;
  active: boolean;
  status: SessionStatus;
  message?: string;
  help?: Help;
}

/** Audio is sent in 100 ms chunks. */
export const CHUNK_SAMPLES = SAMPLE_RATE / 10;
