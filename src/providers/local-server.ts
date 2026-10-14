import { streamParams } from './deepgram';
import { DeepgramStream } from './deepgram-stream';
import type { ProviderDefinition } from './types';

/**
 * WhisperLiveKit (or any server with a Deepgram-compatible /v1/listen
 * endpoint) running on this machine. See server/README.md.
 */
export const localServerProvider: ProviderDefinition = {
  id: 'local-server',
  label: 'Local server (WhisperLiveKit)',
  description:
    'Whisper running on your own machine: free and private, but slower than the cloud. Start it with server/run.sh (see server/README.md in the repo).',
  fields: [
    {
      key: 'url',
      label: 'Server URL',
      type: 'text',
      default: 'ws://localhost:8000/v1/listen',
      help: 'Deepgram-compatible WebSocket endpoint.',
    },
    {
      key: 'token',
      label: 'API token',
      type: 'password',
      help: 'Only if the server was started with --api-token.',
    },
    {
      key: 'extraParams',
      label: 'Extra query parameters',
      type: 'text',
      placeholder: 'endpointing=500',
    },
  ],
  create(config, events) {
    const { url, token, extraParams } = config.options;
    const params = streamParams(config.language, extraParams);
    if (token) params.set('token', token);
    return new DeepgramStream(
      {
        url: `${url}${url.includes('?') ? '&' : '?'}${params}`,
        flush: 'reconnect',
        restartOnStall: true,
        idPrefix: 'local',
        connectError: `Could not connect to ${url}. Is the local server running?`,
      },
      events,
    );
  },
};
