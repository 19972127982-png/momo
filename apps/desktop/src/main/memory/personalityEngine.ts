/**
 * 性格演化引擎（桌面端装配，W3 D5）
 *
 * 把 agent-core 的纯逻辑（prompt / 解析 / clamp）和 IO（LLM 调用 + SQLite）接起来：
 * 每轮对话后异步跑一次 → 拿 LLM 给的微小 delta → clamp 并入向量 → 写 pet_personality
 * + 追加 evolution_log（作品集漂移轨迹图数据源）。
 *
 * 调用时机：chat handler 在主回复 stream 完成后异步触发（不阻塞用户感知延迟）。
 * 失败容忍：任何异常都 swallow —— 性格分析失败绝不能影响对话（PRD §4.5）。
 */
import {
  applyPersonalityDelta,
  buildEvolutionPrompt,
  deltaIsNegligible,
  parsePersonalityDelta,
  type MemoryStore
} from '@echopet/agent-core'
import { completeDeepSeek } from '../llm'

export interface MaybeEvolveParams {
  userMsg: string
  assistantReply: string
  store: MemoryStore
  getApiKey: () => string | null
  signal: AbortSignal
}

export interface MaybeEvolveResult {
  attempted: boolean
  /** 是否真的写了库（产生了非 0 漂移） */
  evolved: boolean
}

export async function maybeEvolvePersonality(
  params: MaybeEvolveParams
): Promise<MaybeEvolveResult> {
  const { userMsg, assistantReply, store, getApiKey, signal } = params

  const apiKey = getApiKey()
  if (!apiKey) return { attempted: false, evolved: false }

  try {
    const state = await store.getPersonality()
    const prompt = buildEvolutionPrompt(state, userMsg, assistantReply)

    const raw = await completeDeepSeek(
      [{ role: 'user', content: prompt }],
      apiKey,
      signal,
      { temperature: 0.3, maxTokens: 80 }
    )

    const delta = parsePersonalityDelta(raw)
    if (deltaIsNegligible(delta)) {
      return { attempted: true, evolved: false }
    }

    const next = applyPersonalityDelta(state, delta!)
    await store.updatePersonality(next)
    await store.appendEvolutionLog({
      ts: Date.now(),
      delta: delta!,
      stateAfter: next,
      triggerMsgSnippet: userMsg.slice(0, 50)
    })
    return { attempted: true, evolved: true }
  } catch (err) {
    console.warn('[personalityEngine] swallow:', (err as Error).message)
    return { attempted: true, evolved: false }
  }
}
