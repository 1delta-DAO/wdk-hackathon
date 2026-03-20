import { createProvider } from './providers/index.js'
import type { GenericTool } from './providers/index.js'
import type { ToolRouter } from './mcp.js'

export async function runAgentLoop(
  router: ToolRouter,
  systemPrompt: string,
  tools: GenericTool[],
  userMessage: string,
): Promise<string> {
  const provider = createProvider()
  return provider.runAgentLoop(router, systemPrompt, tools, userMessage)
}
