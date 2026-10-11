export interface AIChatMessage {
  role:
    | "system"
    | "user"
    | "assistant";

  content:
    string;
}


export type AIChatTask =
  | "structured"
  | "response"
  | "reasoning";


export interface AIChatRequest {
  messages:
    AIChatMessage[];

  task?:
    AIChatTask;

  maxTokens?:
    number;

  temperature?:
    number;
}


export interface AIChatResponse {
  text:
    string;

  provider:
    string;

  model:
    string;

  finishReason?:
    string;

  truncated?:
    boolean;
}


export interface AIProvider {
  chat(
    request: AIChatRequest,
  ): Promise<AIChatResponse>;

  /**
   * Explicitly invoke the fallback provider when a
   * response retry must not repeat the primary model.
   */
  chatFallback?(
    request: AIChatRequest,
  ): Promise<AIChatResponse>;
}