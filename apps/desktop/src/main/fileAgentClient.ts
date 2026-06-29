/**
 * DeepSeek 实现的 FunctionCallingClient（W3 D6 · FileAgent 用）
 *
 * 把 completeDeepSeekWithTools 包成 agent-core 约定的 FunctionCallingClient。
 * 无 key 时返回 error（不抛异常），FileAgent 会 yield error 让对话进 apologetic。
 */
import { completeDeepSeekWithTools } from './llm'
import type { FunctionCallingClient } from '@echopet/agent-core'

export function createDeepSeekFcClient(getApiKey: () => string | null): FunctionCallingClient {
  return {
    async complete({ messages, tools, temperature, maxTokens, signal }) {
      const apiKey = getApiKey()
      if (!apiKey) return { error: '尚未配置 DeepSeek API Key — 点齿轮配置' }
      return completeDeepSeekWithTools(messages, tools, apiKey, signal, {
        temperature,
        maxTokens
      })
    }
  }
}
