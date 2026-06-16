import type { LlmCompleteOptions, LlmProvider, LlmProviderConfig } from './types.js';

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';

  constructor(private readonly config: LlmProviderConfig) {}

  async complete(options: LlmCompleteOptions): Promise<string> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/api/chat`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        stream: false,
        format: options.jsonMode ? 'json' : undefined,
        options: {
          num_ctx: this.config.numCtx ?? 8192,
          num_predict: this.config.numPredict ?? 2048,
        },
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.prompt },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { message?: { content?: string } };
    const content = data.message?.content?.trim();
    if (!content) {
      throw new Error('Ollama returned empty response');
    }
    return content;
  }
}
