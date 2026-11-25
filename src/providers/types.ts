import type { Segment, SessionStatus } from '../shared/types';

export interface SettingField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select';
  default?: string;
  options?: [value: string, label: string][];
  placeholder?: string;
  help?: string;
  required?: boolean;
  /** Rarely needed: shown under "Advanced options" on the settings page. */
  advanced?: boolean;
}

export interface TranscriberConfig {
  language: string;
  options: Record<string, string>;
}

export interface TranscriberEvents {
  /** Times are in stream seconds (seconds of audio pushed so far). */
  segment(segment: Segment): void;
  status(status: SessionStatus, message?: string): void;
}

/**
 * One live transcription session. Receives 16 kHz mono Int16 PCM, emits
 * segments. Implementations must buffer audio pushed while still connecting.
 */
export interface Transcriber {
  start(): void;
  pushAudio(pcm: Int16Array<ArrayBuffer>): void;
  /** Audio is about to jump; finalize whatever is pending. */
  flush(): void;
  stop(): void;
}

export interface ProviderDefinition {
  id: string;
  label: string;
  description: string;
  fields: SettingField[];
  /** Checks the settings without transcribing (settings page "Test connection"); rejects with a readable reason. */
  test?(config: TranscriberConfig): Promise<void>;
  create(config: TranscriberConfig, events: TranscriberEvents): Transcriber;
}

/** Field values from settings, falling back to each field's default. */
export function resolveOptions(
  provider: ProviderDefinition,
  stored: Record<string, string> | undefined,
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const field of provider.fields) {
    options[field.key] = stored?.[field.key] || field.default || '';
  }
  return options;
}
