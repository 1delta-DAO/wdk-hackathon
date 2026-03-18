import Anthropic from '@anthropic-ai/sdk'
import type { ToolRouter } from './mcp.js'

const MAX_TURNS = 20

export async function runAgentLoop (
  router: ToolRouter,
  systemPrompt: string,
  allTools: Anthropic.Tool[],
  messages: Anthropic.MessageParam[]
): Promise<Anthropic.Message> {
  const anthropic = new Anthropic({ maxRetries: 5 })

  const model = process.env.MODEL ?? 'claude-opus-4-6'
  const supportsThinking = /opus-4|sonnet-4/.test(model)

  const cachedSystem: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }
  ]
  const cachedTools: Anthropic.Tool[] = allTools.length === 0 ? [] : [
    ...allTools.slice(0, -1),
    { ...allTools[allTools.length - 1], cache_control: { type: 'ephemeral' } }
  ]

  const createParams = (): Anthropic.MessageCreateParamsNonStreaming => {
    return {
      model,
      max_tokens: 8192,
      ...(supportsThinking ? { thinking: { type: 'adaptive' } } : {}),
      system: cachedSystem,
      tools: cachedTools,
      messages
    }
  }

  let response = await anthropic.messages.create(createParams())
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
    response = await anthropic.messages.create(createParams())
  }

  if (turns >= MAX_TURNS) {
    console.warn(`[agent] reached max turns (${MAX_TURNS})`)
  }

  return response
}
