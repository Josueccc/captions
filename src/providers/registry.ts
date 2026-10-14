import { deepgramProvider } from './deepgram';
import { localServerProvider } from './local-server';
import { testSignalProvider } from './test-signal';
import type { ProviderDefinition } from './types';

export const PROVIDERS: ProviderDefinition[] = [deepgramProvider, localServerProvider, testSignalProvider];

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
