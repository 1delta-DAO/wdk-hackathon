import type { ToolRouter } from '../mcp.js'

export interface GenericTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface AgentProvider {
  runAgentLoop(
    router: ToolRouter,
    systemPrompt: string,
    tools: GenericTool[],
    userMessage: string,
  ): Promise<string>
}
