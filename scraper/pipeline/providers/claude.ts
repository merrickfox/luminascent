import type { LlmCompleteOptions, LlmProvider, LlmProviderConfig } from './types.js';

/**
 * Stub for future Anthropic Claude integration.
 * Set provider to "claude" and ANTHROPIC_API_KEY in the environment.
 */
export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude';

  constructor(private readonly config: LlmProviderConfig) {}

  async complete(_options: LlmCompleteOptions): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Claude provider requires ANTHROPIC_API_KEY. Implementation pending — use provider "ollama" for now.',
      );
    }

    throw new Error(
      `Claude provider not yet implemented. Model: ${this.config.model}, baseUrl: ${this.config.baseUrl}`,
    );
  }
}
