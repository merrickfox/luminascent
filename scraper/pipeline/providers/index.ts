import type { PipelineConfig } from '../types.js';
import { ClaudeProvider } from './claude.js';
import { OllamaProvider } from './ollama.js';
import type { LlmProvider } from './types.js';

export function createProvider(config: PipelineConfig): LlmProvider {
  const providerConfig = {
    model: config.model,
    baseUrl: config.baseUrl,
    numCtx: config.numCtx,
    numPredict: config.numPredict,
  };

  switch (config.provider) {
    case 'claude':
      return new ClaudeProvider(providerConfig);
    case 'ollama':
    default:
      return new OllamaProvider(providerConfig);
  }
}
