/**
 * LLM zero-shot 意图分类器（一级路由的语义兜底）
 *
 * 仅在关键词路由判 companion、但句子带「弱任务信号」时被 HybridIntentRouter 调用，
 * 用一次极短的非流式补全判 utility / companion。设计上必须「廉价 + 不挡路」：
 *   - maxTokens 极小（只要一个词）、temperature 0（要确定性）、6s 超时；
 *   - 任何失败 / 超时 / 无 key / 解析不出 → 返回 null，路由退回关键词结果。
 */
import type { ChatCompletionMessage, KeywordIntentResult, LlmIntentClassifier } from '@echopet/agent-core'
import { completeDeepSeek } from './llm'

const SYSTEM_PROMPT = `你是一个意图分类器。判断用户这句话是想让桌面助手「操作文件 / 桌面 / 系统」（记为 utility），还是只是「闲聊 / 情感陪伴 / 普通提问」（记为 companion）。
判 utility 的例子：新建/写入/读取/整理/重命名/移动/删除文件或文件夹、看桌面有什么、用工具帮我做某事。
判 companion 的例子：打招呼、聊心情、问知识、闲扯。
只输出一个词：utility 或 companion，不要任何多余内容。`

export function createLlmIntentClassifier(
  getApiKey: () => string | null
): LlmIntentClassifier {
  return {
    async classify(userInput, signal): Promise<KeywordIntentResult | null> {
      const apiKey = getApiKey()
      if (!apiKey) return null

      const messages: ChatCompletionMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userInput }
      ]

      try {
        const out = await completeDeepSeek(
          messages,
          apiKey,
          signal ?? new AbortController().signal,
          { temperature: 0, maxTokens: 8, timeoutMs: 6_000 }
        )
        const lower = out.toLowerCase()
        const utility = lower.includes('utility')
        const companion = lower.includes('companion')
        // 两个都没命中（或都命中）→ 判定不可靠，交回关键词
        if (utility === companion) return null
        if (utility) {
          return { mode: 'utility', confidence: 0.75, agentName: 'FileAgent', intent: 'file' }
        }
        return { mode: 'companion', confidence: 0.7 }
      } catch {
        return null
      }
    }
  }
}
