/**
 * 用户画像提取器（桌面端装配，W3 D3）
 *
 * 把 agent-core 的纯逻辑（触发判断 / prompt / 解析 / 合并）和 IO（LLM 调用 + SQLite）接起来。
 *
 * 调用时机：chat handler 在主回复 stream 完成后异步触发（不阻塞用户感知延迟）。
 * 失败容忍：任何异常都 swallow —— 画像提取失败绝不能影响对话。
 */

import {
  buildProfileExtractionPrompt,
  mergeUserProfile,
  parseProfileExtraction,
  profilePatchIsEmpty,
  shouldExtractProfile,
  type MemoryStore
} from '@echopet/agent-core'
import { completeDeepSeek } from '../llm'

export interface MaybeExtractParams {
  userMsg: string
  assistantReply: string
  /** 距上次成功提取的轮数 */
  turnsSinceLastExtraction: number
  store: MemoryStore
  getApiKey: () => string | null
  signal: AbortSignal
}

export interface MaybeExtractResult {
  /** 是否真的触发了 LLM 抽取 */
  attempted: boolean
  /** 是否产生了画像更新（写库） */
  updated: boolean
}

export async function maybeExtractProfile(
  params: MaybeExtractParams
): Promise<MaybeExtractResult> {
  const { userMsg, assistantReply, turnsSinceLastExtraction, store, getApiKey, signal } = params

  if (!shouldExtractProfile({ userInput: userMsg, turnsSinceLastExtraction })) {
    return { attempted: false, updated: false }
  }

  const apiKey = getApiKey()
  if (!apiKey) return { attempted: false, updated: false }

  try {
    const existing = await store.getUserProfile()
    const prompt = buildProfileExtractionPrompt(userMsg, assistantReply, existing)

    const raw = await completeDeepSeek(
      [{ role: 'user', content: prompt }],
      apiKey,
      signal,
      { temperature: 0.2, maxTokens: 256 }
    )

    const patch = parseProfileExtraction(raw)
    if (profilePatchIsEmpty(patch)) {
      return { attempted: true, updated: false }
    }

    const merged = mergeUserProfile(existing, patch!)
    await store.updateUserProfile(merged)
    return { attempted: true, updated: true }
  } catch (err) {
    console.warn('[profileExtractor] swallow:', (err as Error).message)
    return { attempted: true, updated: false }
  }
}
