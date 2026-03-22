// Thin routing layer — no MCP SDK dependency.
// All tool calls are handled by local handlers registered at runtime.

export type ToolRouter = (toolName: string, input: Record<string, unknown>) => Promise<string>
export type LocalHandler = (input: Record<string, unknown>) => Promise<string>

export function createRouter (
  _unused: Record<string, never>,
  localHandlers: Record<string, LocalHandler> = {},
): ToolRouter {
  return async function route (toolName: string, input: Record<string, unknown>): Promise<string> {
    if (localHandlers[toolName]) return localHandlers[toolName](input)
    throw new Error(`No handler registered for tool: ${toolName}`)
  }
}
