import OpenAI from 'openai'
import type { AgentProvider, GenericTool } from './types.js'
import type { ToolRouter } from '../mcp.js'

const MAX_TURNS = 20

export class OpenAIProvider implements AgentProvider {
  async runAgentLoop(
    router: ToolRouter,
    systemPrompt: string,
    tools: GenericTool[],
    userMessage: string,
  ): Promise<string> {
    const openai = new OpenAI()
    const model = process.env.MODEL ?? 'gpt-4o-mini'

    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }))

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]

    let response = await openai.chat.completions.create({
      model,
      max_completion_tokens: 8192,
      tools: openaiTools,
      messages,
    })

    let turns = 0

    while (response.choices[0].finish_reason === 'tool_calls' && turns < MAX_TURNS) {
      turns++
      const toolCalls = response.choices[0].message.tool_calls ?? []
      messages.push(response.choices[0].message)

      for (const tc of toolCalls) {
        if (tc.type !== 'function') continue
        console.log(`\n→ ${tc.function.name}`)
        console.log('  input:', tc.function.arguments)

        let resultText: string
        try {
          const input = JSON.parse(tc.function.arguments) as Record<string, unknown>
          resultText = await router(tc.function.name, input)
          const preview = resultText.slice(0, 400)
          console.log(`  result: ${preview}${resultText.length > 400 ? '…' : ''}`)
        } catch (err) {
          resultText = `Tool error: ${err instanceof Error ? err.message : String(err)}`
          console.error(`  error: ${resultText}`)
        }

        messages.push({ role: 'tool', tool_call_id: tc.id, content: resultText })
      }

      response = await openai.chat.completions.create({
        model,
        max_completion_tokens: 8192,
        tools: openaiTools,
        messages,
      })
    }

    if (turns >= MAX_TURNS) console.warn(`[agent] reached max turns (${MAX_TURNS})`)

    return response.choices[0].message.content ?? ''
  }
}
