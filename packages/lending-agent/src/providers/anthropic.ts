import Anthropic from '@anthropic-ai/sdk'
import type { AgentProvider, GenericTool } from './types.js'
import type { ToolRouter } from '../mcp.js'

const MAX_TURNS = 20

export class AnthropicProvider implements AgentProvider {
  async runAgentLoop(
    router: ToolRouter,
    systemPrompt: string,
    tools: GenericTool[],
    userMessage: string,
  ): Promise<string> {
    const anthropic = new Anthropic({ maxRetries: 5 })
    const model = process.env.MODEL ?? 'claude-opus-4-6'
    const supportsThinking = /opus-4|sonnet-4/.test(model)

    const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }))

    const cachedSystem: Anthropic.TextBlockParam[] = [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ]
    const cachedTools: Anthropic.Tool[] = anthropicTools.length === 0 ? [] : [
      ...anthropicTools.slice(0, -1),
      { ...anthropicTools[anthropicTools.length - 1], cache_control: { type: 'ephemeral' } },
    ]

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }]

    const makeParams = (): Anthropic.MessageCreateParamsNonStreaming => ({
      model,
      max_tokens: 8192,
      ...(supportsThinking ? { thinking: { type: 'adaptive' } } : {}),
      system: cachedSystem,
      tools: cachedTools,
      messages,
    })

    let response = await anthropic.messages.create(makeParams())
    let turns = 0

    while (response.stop_reason === 'tool_use' && turns < MAX_TURNS) {
      turns++
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type === 'thinking') {
          const preview = block.thinking?.slice(0, 300) ?? ''
          console.log(`[thinking] ${preview}${preview.length === 300 ? '…' : ''}`)
        } else if (block.type === 'tool_use') {
          console.log(`\n→ ${block.name}`)
          console.log('  input:', JSON.stringify(block.input))

          let resultText: string
          try {
            resultText = await router(block.name, block.input as Record<string, unknown>)
            const preview = resultText.slice(0, 400)
            console.log(`  result: ${preview}${resultText.length > 400 ? '…' : ''}`)
          } catch (err) {
            resultText = `Tool error: ${err instanceof Error ? err.message : String(err)}`
            console.error(`  error: ${resultText}`)
          }

          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultText })
        }
      }

      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })
      response = await anthropic.messages.create(makeParams())
    }

    if (turns >= MAX_TURNS) console.warn(`[agent] reached max turns (${MAX_TURNS})`)

    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
  }
}
