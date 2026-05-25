import type { ChatRequest } from "@openrouter/sdk/models/chatrequest.js";
import type {
  InferenceConfig,
  ProviderMessage,
  ToolDefinition,
} from "../types.js";
import { normalizeToolSchemaForProvider } from "../schema-normalizer.js";
import { mapMessages } from "./mappers.js";

export function buildOpenRouterParams(
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  config: InferenceConfig,
  stream: boolean,
): ChatRequest {
  const params: ChatRequest = {
    model: config.model,
    messages: mapMessages(messages),
    maxTokens: config.maxOutputTokens,
    ...(config.temperature !== undefined && { temperature: config.temperature }),
    ...(stream && { stream: true }),
  };

  if (tools.length > 0) {
    params.tools = tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: normalizeToolSchemaForProvider(tool.function.parameters),
      },
    }));
    params.toolChoice = "auto";
  }

  return params;
}
