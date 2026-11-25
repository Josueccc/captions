import { t } from '../shared/i18n';
import { SAMPLE_RATE } from '../shared/types';
import type { ProviderDefinition, Transcriber, TranscriberEvents } from './types';

const WINDOW_SECONDS = 2;
const SILENCE_DB = -60;

/**
 * Doesn't transcribe anything: shows the loudness of each 2-second window.
 * Use it to check that audio capture works on a site (DRM sites give silence).
 */
class TestSignalTranscriber implements Transcriber {
  private samples = 0;
  private sumSquares = 0;
  private windowStart = 0;
  private count = 0;

  constructor(private readonly events: TranscriberEvents) {}

  start(): void {
    this.events.status('running');
  }

  pushAudio(pcm: Int16Array<ArrayBuffer>): void {
    for (const sample of pcm) {
      const value = sample / 0x8000;
      this.sumSquares += value * value;
      this.samples++;
      if (this.samples === SAMPLE_RATE * WINDOW_SECONDS) this.emitWindow();
    }
  }

  flush(): void {}

  stop(): void {}

  private emitWindow(): void {
    const rms = Math.sqrt(this.sumSquares / this.samples);
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const start = this.windowStart;
    const end = start + WINDOW_SECONDS;
    const text =
      db < SILENCE_DB
        ? t('testSignalSilence', start.toFixed(0), end.toFixed(0))
        : t('testSignalLevel', db.toFixed(1), start.toFixed(0), end.toFixed(0));
    // One "word" spanning the window, so debug mode measures the pipeline's own delay.
    const words = [{ text, start, end }];
    this.events.segment({ id: `test-${this.count++}`, text, start, end, words, final: true });
    this.windowStart = end;
    this.samples = 0;
    this.sumSquares = 0;
  }
}

export const testSignalProvider: ProviderDefinition = {
  id: 'test-signal',
  label: t('providerTestLabel'),
  description: t('providerTestDescription'),
  fields: [],
  create: (_config, events) => new TestSignalTranscriber(events),
};
