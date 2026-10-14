// Runs in the AudioWorkletGlobalScope, loaded via audioWorklet.addModule().
import { Downsampler } from '../shared/downsampler';
import { CHUNK_SAMPLES } from '../shared/types';

declare const sampleRate: number;
declare const AudioWorkletProcessor: { new (): { readonly port: MessagePort } };
declare function registerProcessor(name: string, processor: unknown): void;

class PcmDownsampler extends AudioWorkletProcessor {
  private readonly downsampler = new Downsampler(sampleRate, CHUNK_SAMPLES, (chunk) =>
    this.port.postMessage(chunk.buffer, [chunk.buffer]),
  );

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (input && input.length > 0) this.downsampler.process(input);
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
