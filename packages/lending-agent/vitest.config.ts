import { defineConfig } from 'vitest/config'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function loadDotenv (): Record<string, string> {
  const envPath = resolve(import.meta.dirname, '.env')
  if (!existsSync(envPath)) return {}
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const idx = line.indexOf('=')
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
      })
      .filter(([, v]) => v !== '')
  )
}

export default defineConfig({
  test: {
    env: loadDotenv()
  }
})
