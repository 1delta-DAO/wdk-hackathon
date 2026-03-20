export type { GenericTool, AgentProvider } from './types.js'
export { AnthropicProvider } from './anthropic.js'
export { OpenAIProvider } from './openai.js'

import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'
import type { AgentProvider } from './types.js'

/**
 * Select provider based on AI_PROVIDER env var or MODEL name.
 * AI_PROVIDER=openai       → OpenAIProvider  (default model: gpt-4o-mini)
 * AI_PROVIDER=anthropic    → AnthropicProvider (default model: claude-opus-4-6)
 */
export function createProvider(): AgentProvider {
  const provider = process.env.AI_PROVIDER ?? ''
  const model = process.env.MODEL ?? ''
  if (provider === 'openai' || model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) {
    return new OpenAIProvider()
  }
  return new AnthropicProvider()
}
