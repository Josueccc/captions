import type { Segment, Word } from '../shared/types';
import { SAMPLE_RATE } from '../shared/types';
import type { Transcriber, TranscriberEvents } from './types';

/** Deepgram closes idle streams after ~10 s without audio. */
const KEEPALIVE_MS = 4000;
/** Cap on audio buffered while connecting (~30 s). */
const MAX_QUEUED_SAMPLES = SAMPLE_RATE * 30;
/** Text without timed words for this long, from the start of a stream, counts as stalled. */
const STALL_MS = 5000;
/** How long to wait for the server to flush and close after CloseStream. */
const CLOSE_TIMEOUT_MS = 10000;
/** Close a caption line that runs this long without a sentence end. */
const MAX_LINE_SECONDS = 8;

const SENTENCE_END = /[.!?…]["'»”)\]]*$/;
/** Abbreviations that end in a period but don't end a sentence. */
const ABBREVIATION = /^(M|Mme|Mlle|Dr|Pr|St|Ste|Mr|Mrs|Ms|Hr|Fr|Nr|bzw|z\.B|d\.h|usw|etc|vs|Sr|Sra|Srta)\.$/i;

/** Pieces some servers send as separate words: "don" + "'t", "word" + "?". */
const FRAGMENT = /^(['’][\p{L}]*|[,.!?;:…»)\]]+)$/u;

/** Glue fragments onto the word before them. */
export function mergeFragments(words: Word[]): Word[] {
  const merged: Word[] = [];
  for (const word of words) {
    const prev = merged[merged.length - 1];
    if (prev && FRAGMENT.test(word.text)) {
      merged[merged.length - 1] = { ...prev, text: prev.text + word.text, end: word.end, tentative: prev.tentative || word.tentative };
    } else {
      merged.push(word);
    }
  }
  return merged;
}

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

/** A server that speaks the Deepgram live-streaming protocol. */
export interface DeepgramTarget {
  /** Full WebSocket URL, query parameters included. */
  url: string;
  protocols?: string[];
  /**
   * How to finish the pending utterance when the audio jumps. Deepgram has a
   * Finalize message; WhisperLiveKit only flushes on CloseStream, so we close
   * that stream and continue on a fresh connection.
   */
  flush: 'finalize' | 'reconnect';
  /** Prefix for caption line ids. */
  idPrefix: string;
  /**
   * Reconnect when a stream sends text but never any timed words.
   * WhisperLiveKit sometimes starts a session in that state (~1 in 4 under
   * load) and never leaves it.
   */
  restartOnStall?: boolean;
  /** Shown when the connection fails without a reason (HTTP errors surface as code 1006). */
  connectError: string;
}

/**
 * One WebSocket stream. Times in its messages count from its own start, so
 * each connection carries the stream offset at which it was opened, and builds
 * its own caption line (a draining connection never mixes into a new one).
 */
class Connection {
  readonly ws: WebSocket;
  private queue: Int16Array<ArrayBuffer>[] = [];
  private queuedSamples = 0;
  private lastSentAt = 0;
  private keepAliveTimer?: ReturnType<typeof setInterval>;
  /** Closed on purpose (stop or flush-by-reconnect): don't report the close as an error. */
  closing = false;

  /** The caption line being built: confirmed words plus the latest interim guess. */
  private lineId?: string;
  private lineWords: Word[] = [];
  private interimWords: Word[] = [];
  private gotWords = false;
  private textOnlySince?: number;

  constructor(
    private readonly owner: DeepgramStream,
    private readonly target: DeepgramTarget,
    private readonly offset: number,
  ) {
    const ws = new WebSocket(target.url, target.protocols);
    this.ws = ws;

    ws.onopen = () => {
      owner.connected(this);
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
      this.closeLine();
      if (!this.closing) owner.failed(event.reason || (event.code === 1006 ? target.connectError : `Connection closed (code ${event.code}).`));
    };
  }

  pushAudio(pcm: Int16Array<ArrayBuffer>): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.send(pcm);
    } else if (this.ws.readyState === WebSocket.CONNECTING && this.queuedSamples < MAX_QUEUED_SAMPLES) {
      this.queue.push(pcm);
      this.queuedSamples += pcm.length;
    }
  }

  finalize(): void {
    this.sendJson({ type: 'Finalize' });
  }

  /** Ask the server to flush and close; results keep arriving until it does. */
  close(): void {
    this.closing = true;
    clearInterval(this.keepAliveTimer);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.sendJson({ type: 'CloseStream' });
      setTimeout(() => this.ws.close(), CLOSE_TIMEOUT_MS);
    } else {
      this.ws.close();
    }
  }

  private send(pcm: Int16Array<ArrayBuffer>): void {
    this.ws.send(pcm);
    this.lastSentAt = Date.now();
  }

  private sendJson(message: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private handleMessage(msg: DeepgramMessage): void {
    if (msg.type === 'UtteranceEnd') {
      this.closeLine();
      return;
    }
    if (msg.type === 'Error') {
      this.owner.failed(msg.description || msg.message || 'Transcription error');
      return;
    }
    if (msg.type !== 'Results') return;
    const alternative = msg.channel?.alternatives[0];
    if (alternative?.words.length) {
      this.gotWords = true;
    } else if (!this.gotWords && alternative?.transcript) {
      this.textOnlySince ??= Date.now();
      if (Date.now() - this.textOnlySince > STALL_MS) this.owner.stalled(this);
    }

    const words: Word[] = (alternative?.words ?? []).map((w) => ({
      text: w.punctuated_word ?? w.word,
      start: w.start + this.offset,
      end: w.end + this.offset,
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
    this.interimWords = [];
  }

  private emitLine(final: boolean): void {
    const words = mergeFragments(final ? this.lineWords : [...this.lineWords, ...this.interimWords]);
    if (words.length === 0) return;
    this.lineId ??= this.owner.nextLineId();
    const segment: Segment = {
      id: this.lineId,
      text: words.map((w) => w.text).join(' '),
      start: words[0].start,
      end: words[words.length - 1].end,
      words,
      final,
    };
    this.owner.events.segment(segment);
  }
}

/** Transcriber for any server speaking the Deepgram live-streaming protocol. */
export class DeepgramStream implements Transcriber {
  private connection?: Connection;
  private samplesPushed = 0;
  private lineCount = 0;
  private stopped = false;

  constructor(
    private readonly target: DeepgramTarget,
    readonly events: TranscriberEvents,
  ) {}

  start(): void {
    this.events.status('connecting');
    this.connection = new Connection(this, this.target, 0);
  }

  pushAudio(pcm: Int16Array<ArrayBuffer>): void {
    this.connection?.pushAudio(pcm);
    this.samplesPushed += pcm.length;
  }

  flush(): void {
    if (!this.connection || this.stopped) return;
    if (this.target.flush === 'finalize') this.connection.finalize();
    else this.reconnect();
  }

  stop(): void {
    this.stopped = true;
    this.connection?.close();
    this.connection = undefined;
  }

  /** Close the current stream (the server flushes it) and continue on a new one. */
  private reconnect(): void {
    this.connection!.close();
    this.connection = new Connection(this, this.target, this.samplesPushed / SAMPLE_RATE);
  }

  stalled(connection: Connection): void {
    if (connection !== this.connection || this.stopped || !this.target.restartOnStall) return;
    console.warn('[captions] transcription stream stalled; reconnecting');
    this.reconnect();
  }

  connected(connection: Connection): void {
    if (connection === this.connection) this.events.status('running');
  }

  failed(message: string): void {
    if (!this.stopped) this.events.status('error', message);
  }

  nextLineId(): string {
    return `${this.target.idPrefix}-${this.lineCount++}`;
  }
}
