import { SAMPLE_RATE } from '../shared/types';
import { DeepgramStream } from './deepgram-stream';
import type { ProviderDefinition, Transcriber, TranscriberConfig, TranscriberEvents } from './types';

const ENDPOINT = 'wss://api.deepgram.com/v1/listen';

/** Streaming parameters shared by Deepgram and Deepgram-compatible servers. */
export function streamParams(language: string, extraParams: string, defaults: Record<string, string> = {}): URLSearchParams {
  const params = new URLSearchParams({
    language,
    encoding: 'linear16',
    sample_rate: String(SAMPLE_RATE),
    channels: '1',
    interim_results: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
    ...defaults,
  });
  // Extra params override the defaults; keyterm/keywords may repeat.
  for (const [key, value] of new URLSearchParams(extraParams)) {
    if (key === 'keyterm' || key === 'keywords') params.append(key, value);
    else params.set(key, value);
  }
  return params;
}

function createDeepgram(config: TranscriberConfig, events: TranscriberEvents): Transcriber {
  const { apiKey, model, extraParams } = config.options;
  if (!apiKey) {
    return {
      start: () => events.status('error', 'Deepgram API key missing — set it in the extension options.'),
      pushAudio: () => {},
      flush: () => {},
      stop: () => {},
    };
  }
  const params = streamParams(config.language, extraParams, { model, punctuate: 'true', smart_format: 'true' });
  return new DeepgramStream(
    {
      url: `${ENDPOINT}?${params}`,
      // Browsers can't set an Authorization header on WebSockets; Deepgram
      // accepts the key as a subprotocol instead.
      protocols: ['token', apiKey],
      flush: 'finalize',
      idPrefix: 'dg',
      // Deepgram doesn't expose the HTTP status of a failed handshake.
      connectError: 'Could not connect to Deepgram. Check the API key, and that the model supports this language.',
    },
    events,
  );
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
  create: createDeepgram,
};
