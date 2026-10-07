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
}


export interface AIProvider {
  chat(
    request:
      AIChatRequest,
  ): Promise<
    AIChatResponse
  >;
}