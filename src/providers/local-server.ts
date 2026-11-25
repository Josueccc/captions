import { streamParams } from './deepgram';
import { t } from '../shared/i18n';
import { DeepgramStream, probe } from './deepgram-stream';
import type { ProviderDefinition, TranscriberConfig } from './types';

function target(config: TranscriberConfig) {
  const { url, token, extraParams } = config.options;
  const params = streamParams(config.language, extraParams);
  if (token) params.set('token', token);
  return {
    url: `${url}${url.includes('?') ? '&' : '?'}${params}`,
    connectError: t('errorLocalConnect', url),
  };
}

/**
 * WhisperLiveKit (or any server with a Deepgram-compatible /v1/listen
 * endpoint) running on this machine. See server/README.md.
 */
export const localServerProvider: ProviderDefinition = {
  id: 'local-server',
  label: t('providerLocalLabel'),
  description: t('providerLocalDescription'),
  fields: [
    {
      key: 'url',
      label: t('fieldServerUrl'),
      type: 'text',
      default: 'ws://localhost:8000/v1/listen',
      help: t('fieldServerUrlHelp'),
    },
    {
      key: 'token',
      label: t('fieldApiToken'),
      type: 'password',
      help: t('fieldApiTokenHelp'),
      advanced: true,
    },
    {
      key: 'extraParams',
      label: t('fieldExtraParams'),
      type: 'text',
      placeholder: 'endpointing=500',
      advanced: true,
    },
  ],
  test: (config) => probe(target(config)),
  create: (config, events) =>
    new DeepgramStream({ ...target(config), flush: 'reconnect', restartOnStall: true, idPrefix: 'local' }, events),
};
