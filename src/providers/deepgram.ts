import type { Segment, Word } from '../shared/types';
import { SAMPLE_RATE } from '../shared/types';
import type { ProviderDefinition, Transcriber, TranscriberConfig, TranscriberEvents } from './types';

const ENDPOINT = 'wss://api.deepgram.com/v1/listen';
/** Deepgram closes idle streams after ~10 s without audio. */
const KEEPALIVE_MS = 4000;
/** Cap on audio buffered while connecting (~30 s). */
const MAX_QUEUED_SAMPLES = SAMPLE_RATE * 30;
/** Close a caption line that runs this long without a sentence end. */
const MAX_LINE_SECONDS = 8;

const SENTENCE_END = /[.!?…]["'»”)\]]*$/;
/** Abbreviations that end in a period but don't end a sentence. */
const ABBREVIATION = /^(M|Mme|Mlle|Dr|Pr|St|Ste|Mr|Mrs|Ms|Hr|Fr|Nr|bzw|z\.B|d\.h|usw|etc|vs|Sr|Sra|Srta)\.$/i;

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
}

interface DeepgramMessage {
  type: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives: { transcript: string; words: DeepgramWord[] }[] };
  description?: string;
  message?: string;
}

class DeepgramTranscriber implements Transcriber {
  private ws?: WebSocket;
  private queue: Int16Array<ArrayBuffer>[] = [];
  private queuedSamples = 0;
  private lastSentAt = 0;
  private keepAliveTimer?: ReturnType<typeof setInterval>;
  private stopping = false;

  /** The caption line being built: confirmed words plus the latest interim guess. */
  private lineId?: string;
  private lineWords: Word[] = [];
  private interimWords: Word[] = [];
  private lineCount = 0;

  constructor(
    private readonly config: TranscriberConfig,
    private readonly events: TranscriberEvents,
  ) {}

  start(): void {
    const { apiKey, model, extraParams } = this.config.options;
    if (!apiKey) {
      this.events.status('error', 'Deepgram API key missing — set it in the extension options.');
      return;
    }

    const params = new URLSearchParams({
      model,
      language: this.config.language,
      encoding: 'linear16',
      sample_rate: String(SAMPLE_RATE),
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true',
      endpointing: '300',
      utterance_end_ms: '1000',
    });
    // Extra params override the defaults; keyterm/keywords may repeat.
    for (const [key, value] of new URLSearchParams(extraParams)) {
      if (key === 'keyterm' || key === 'keywords') params.append(key, value);
      else params.set(key, value);
    }

    this.events.status('connecting');
    // Browsers can't set an Authorization header on WebSockets; Deepgram
    // accepts the key as a subprotocol instead.
    const ws = new WebSocket(`${ENDPOINT}?${params}`, ['token', apiKey]);
    this.ws = ws;

    ws.onopen = () => {
      this.events.status('running');
      for (const chunk of this.queue) this.send(chunk);
      this.queue = [];
      this.queuedSamples = 0;
      this.keepAliveTimer = setInterval(() => {
        if (Date.now() - this.lastSentAt >= KEEPALIVE_MS) this.sendJson({ type: 'KeepAlive' });
      }, 1000);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') this.handleMessage(JSON.parse(event.data));
    };

    ws.onclose = (event) => {
      clearInterval(this.keepAliveTimer);
      if (this.stopping) return;
      // A failed handshake (bad key, unsupported model/language) shows up as
      // a 1006 close with no reason; Deepgram doesn't expose the HTTP status.
      const reason =
        event.reason ||
        (event.code === 1006
          ? 'Could not connect to Deepgram. Check the API key, and that the model supports this language.'
          : `Connection closed (code ${event.code}).`);
      this.events.status('error', reason);
    };
  }

  pushAudio(pcm: Int16Array<ArrayBuffer>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send(pcm);
    } else if (this.ws?.readyState === WebSocket.CONNECTING && this.queuedSamples < MAX_QUEUED_SAMPLES) {
      this.queue.push(pcm);
      this.queuedSamples += pcm.length;
    }
  }

  flush(): void {
    this.sendJson({ type: 'Finalize' });
  }

  stop(): void {
    this.stopping = true;
    clearInterval(this.keepAliveTimer);
    if (this.ws?.readyState === WebSocket.OPEN) this.sendJson({ type: 'CloseStream' });
    this.ws?.close();
  }

  private send(pcm: Int16Array<ArrayBuffer>): void {
    this.ws!.send(pcm);
    this.lastSentAt = Date.now();
  }

  private sendJson(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private handleMessage(msg: DeepgramMessage): void {
    if (msg.type === 'UtteranceEnd') {
      this.closeLine();
      return;
    }
    if (msg.type === 'Error') {
      this.events.status('error', msg.description || msg.message || 'Deepgram error');
      return;
    }
    if (msg.type !== 'Results') return;

    const words: Word[] = (msg.channel?.alternatives[0]?.words ?? []).map((w) => ({
      text: w.punctuated_word ?? w.word,
      start: w.start,
      end: w.end,
    }));

    if (!msg.is_final) {
      this.interimWords = words.map((w) => ({ ...w, tentative: true }));
      this.emitLine(false);
      return;
    }

    // Confirmed words: append to the line, breaking at sentence ends so each
    // caption is one sentence where possible.
    this.interimWords = [];
    for (const word of words) {
      this.lineWords.push(word);
      if (SENTENCE_END.test(word.text) && !ABBREVIATION.test(word.text)) this.closeLine();
    }

    const first = this.lineWords[0];
    const last = this.lineWords[this.lineWords.length - 1];
    if (msg.speech_final || (first && last.end - first.start > MAX_LINE_SECONDS)) {
      this.closeLine();
    } else {
      this.emitLine(false);
    }
  }

  private closeLine(): void {
    this.emitLine(true);
    this.lineId = undefined;
    this.lineWords = [];
  }

  private emitLine(final: boolean): void {
    const words = final ? this.lineWords : [...this.lineWords, ...this.interimWords];
    if (words.length === 0) return;
    this.lineId ??= `dg-${this.lineCount++}`;
    const segment: Segment = {
      id: this.lineId,
      text: words.map((w) => w.text).join(' '),
      start: words[0].start,
      end: words[words.length - 1].end,
      words,
      final,
    };
    this.events.segment(segment);
  }
}

export const deepgramProvider: ProviderDefinition = {
  id: 'deepgram',
  label: 'Deepgram (cloud)',
  description: 'Streaming speech-to-text API. Fast and accurate; needs an API key (deepgram.com, free credit on signup).',
  fields: [
    { key: 'apiKey', label: 'API key', type: 'password', required: true },
    {
      key: 'model',
      label: 'Model',
      type: 'select',
      default: 'nova-3',
      options: [
        ['nova-3', 'Nova-3 (best)'],
        ['nova-2', 'Nova-2 (more languages)'],
      ],
    },
    {
      key: 'extraParams',
      label: 'Extra query parameters',
      type: 'text',
      placeholder: 'keyterm=Paris&numerals=true',
      help: 'Appended to the request URL. See the Deepgram streaming docs.',
    },
  ],
  create: (config, events) => new DeepgramTranscriber(config, events),
};
