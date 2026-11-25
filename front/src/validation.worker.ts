import { validate } from './validation.ts';
import type { ValidationProgress, ValidationResult } from './validation.ts';
import catalog from './catalog-2026.json' with { type: 'json' };

export interface ValidationRequest {
  file: File;
}

export type WorkerMessage =
  | { type: 'progress'; progress: ValidationProgress }
  | { type: 'complete'; result: ValidationResult; timing: { readMs: number; analysisMs: number } }
  | { type: 'error'; stage: 'leitura' | 'validação' };

addEventListener('message', async ({ data }: MessageEvent<ValidationRequest>) => {
  let buffer: ArrayBuffer;
  const started = performance.now();
  const send = (message: WorkerMessage) => postMessage(message);
  try {
    buffer = await data.file.arrayBuffer();
  } catch {
    send({ type: 'error', stage: 'leitura' });
    return;
  }
  const readMs = performance.now() - started;
  const analysisStarted = performance.now();
  try {
    const result = validate(new Uint8Array(buffer), catalog, progress => send({ type: 'progress', progress }));
    const analysisMs = performance.now() - analysisStarted;
    send({ type: 'complete', result, timing: { readMs, analysisMs } });
  } catch {
    send({ type: 'error', stage: 'validação' });
  }
});
