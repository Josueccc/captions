import { SAMPLE_RATE } from '../shared/types';
import { t } from '../shared/i18n';
import { DeepgramStream, probe } from './deepgram-stream';
import type { ProviderDefinition, Transcriber, TranscriberConfig, TranscriberEvents } from './types';

const ENDPOINT = 'wss://api.deepgram.com/v1/listen';
const PROJECTS = 'https://api.deepgram.com/v1/projects';

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

function target(config: TranscriberConfig) {
  const { apiKey, model, extraParams } = config.options;
  const params = streamParams(config.language, extraParams, { model, punctuate: 'true', smart_format: 'true' });
  return {
    url: `${ENDPOINT}?${params}`,
    // Browsers can't set an Authorization header on WebSockets; Deepgram
    // accepts the key as a subprotocol instead.
    protocols: ['token', apiKey],
    // Deepgram doesn't expose the HTTP status of a failed handshake.
    connectError: t('errorDeepgramConnect'),
  };
}

/**
 * The streaming handshake fails the same way for a bad key and for a model that
 * doesn't support the language; a REST call tells the two apart.
 */
async function testDeepgram(config: TranscriberConfig): Promise<void> {
  if (!config.options.apiKey) throw new Error(t('errorDeepgramKeyMissing'));
  try {
    await probe(target(config));
  } catch (err) {
    let status = 0;
    try {
      status = (await fetch(PROJECTS, { headers: { Authorization: `Token ${config.options.apiKey}` } })).status;
    } catch {
      throw err; // Offline, or the REST API is unreachable: keep the original reason.
    }
    if (status === 401) throw new Error(t('errorDeepgramKeyInvalid'));
    throw new Error(t('errorDeepgramModelLanguage', config.options.model, config.language));
  }
}

function createDeepgram(config: TranscriberConfig, events: TranscriberEvents): Transcriber {
  if (!config.options.apiKey) {
    return {
      start: () => events.status('error', t('errorDeepgramKeyMissing')),
      pushAudio: () => {},
      flush: () => {},
      stop: () => {},
    };
  }
  return new DeepgramStream({ ...target(config), flush: 'finalize', idPrefix: 'dg' }, events);
}

export const deepgramProvider: ProviderDefinition = {
  id: 'deepgram',
  label: t('providerDeepgramLabel'),
  description: t('providerDeepgramDescription'),
  fields: [
    { key: 'apiKey', label: t('fieldApiKey'), type: 'password', required: true, help: t('fieldDeepgramKeyHelp') },
    {
      key: 'model',
      label: t('fieldModel'),
      type: 'select',
      default: 'nova-3',
      options: [
        ['nova-3', t('modelNova3')],
        ['nova-2', t('modelNova2')],
      ],
    },
    {
      key: 'extraParams',
      label: t('fieldExtraParams'),
      type: 'text',
      placeholder: 'keyterm=Paris&numerals=true',
      help: t('fieldDeepgramExtraHelp'),
      advanced: true,
    },
  ],
  test: testDeepgram,
  create: createDeepgram,
};
