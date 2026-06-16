export interface LlmCompleteOptions {
  system: string;
  prompt: string;
  jsonMode?: boolean;
}

export interface LlmProviderConfig {
  model: string;
  baseUrl: string;
  numCtx?: number;
  numPredict?: number;
}

export interface LlmProvider {
  readonly name: string;
  complete(options: LlmCompleteOptions): Promise<string>;
}
