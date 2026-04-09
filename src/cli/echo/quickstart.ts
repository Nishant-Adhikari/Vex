export const QUICKSTART_PROMPT_FILE_NAME = "quickstart.prompt.md";
export const QUICKSTART_PROMPT_DESCRIPTION =
  "Starter text to paste into the AI after the MCP is connected.";

export function buildQuickstartPrompt(): string {
  return [
    "Use the connected EchoClaw MCP in read-only mode first.",
    "",
    "Before taking any action, read these EchoClaw MCP resources:",
    "- docs://overview",
    "- docs://tools",
    "- docs://protocols",
    "- surface://manifest",
    "- runtime://env",
    "",
    "Then do the following:",
    "1. Summarize what EchoClaw MCP can do, grouped into wallet, portfolio, knowledge, web, and protocol capabilities.",
    "2. Call discover_tools for these areas and summarize the relevant tools:",
    '   - namespace="solana"',
    '   - namespace="polymarket"',
    '   - query="0g"',
    "3. Separate the discovered capabilities into read-only vs mutating tools.",
    "4. Call out any env-gated or unavailable capabilities you can infer from runtime://env.",
    "5. If Polymarket trading is gated by missing credentials, note that polymarket_setup can enable it later. Do not ask me to edit POLYMARKET_API_KEY manually.",
    "",
    "Do not execute mutating tools, do not move funds, and do not write knowledge or documents unless I explicitly ask for it.",
  ].join("\n");
}
