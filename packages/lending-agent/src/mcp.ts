import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages.js'
import { ONEDELTA_MCP_URL, WDK_SERVER_PATH, RESULT_CHAR_LIMIT } from './config.js'

export type ToolRouter = (toolName: string, input: Record<string, unknown>) => Promise<string>

// ── Connect ───────────────────────────────────────────────────────────────────

export async function connectOneDelta (): Promise<Client> {
  const requestInit: RequestInit | undefined = process.env.ONEDELTA_API_KEY
    ? { headers: { Authorization: `Bearer ${process.env.ONEDELTA_API_KEY}` } }
    : undefined
  const transport = new StreamableHTTPClientTransport(new URL(ONEDELTA_MCP_URL), { requestInit })
  const client = new Client({ name: 'lending-agent-1delta', version: '1.0.0' })
  await client.connect(transport)
  return client
}

export async function connectWdk (): Promise<Client> {
  if (!process.env.WDK_SEED) {
    throw new Error('WDK_SEED environment variable is required for the WDK MCP server')
  }
  const transport = new StdioClientTransport({
    command: 'node',
    args: [WDK_SERVER_PATH],
    env: Object.fromEntries(
      Object.entries({ ...process.env, WDK_SEED: process.env.WDK_SEED })
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
  })
  const client = new Client({ name: 'lending-agent-wdk', version: '1.0.0' })
  await client.connect(transport)
  return client
}

// ── Tool helpers ──────────────────────────────────────────────────────────────

type McpContent = { type: string; text?: string }[]

function extractText (content: McpContent): string {
  return content
    .filter(c => c.type === 'text' && c.text)
    .map(c => c.text!)
    .join('\n')
}

function truncate (text: string): string {
  if (text.length <= RESULT_CHAR_LIMIT) return text
  return text.slice(0, RESULT_CHAR_LIMIT) +
    `\n[truncated — ${text.length - RESULT_CHAR_LIMIT} chars omitted]`
}

export async function callTool (client: Client, name: string, input: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: input })
  return truncate(extractText(result.content as McpContent))
}

// ── Anthropic tool format conversion ─────────────────────────────────────────

export function toAnthropicTools (mcpTools: Tool[]): AnthropicTool[] {
  return mcpTools.map(t => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema as AnthropicTool['input_schema']
  }))
}

// ── Docs loader ──────────────────────────────────────────────────────────────

const DOC_URIS = ['docs://tools', 'docs://chains', 'docs://lenders'] as const

export async function loadDocs (client: Client): Promise<string> {
  const sections: string[] = []
  for (const uri of DOC_URIS) {
    try {
      const result = await client.readResource({ uri })
      const text = (result.contents as { text?: string }[])
        .map(c => c.text ?? '')
        .join('\n')
        .trim()
      if (text) sections.push(text)
    } catch {
      // Non-fatal — agent still works without docs
    }
  }
  return sections.join('\n\n---\n\n')
}

// ── Router ────────────────────────────────────────────────────────────────────

export type LocalHandler = (input: Record<string, unknown>) => Promise<string>

export function createRouter (
  toolClientMap: Record<string, Client>,
  localHandlers: Record<string, LocalHandler> = {},
): ToolRouter {
  return async function route (toolName: string, input: Record<string, unknown>): Promise<string> {
    if (localHandlers[toolName]) return localHandlers[toolName](input)
    const client = toolClientMap[toolName]
    if (!client) throw new Error(`No MCP client registered for tool: ${toolName}`)
    return callTool(client, toolName, input)
  }
}
