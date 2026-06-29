/**
 * 情景记忆召回 —— 跨平台纯逻辑（PRD §4.3 情景记忆）
 *
 * W3 D4 走「关键词召回」路线（向量召回 = bge embedding + 向量库延后到 W5）：
 *   - tokenize：中文按 bigram（相邻两字）+ 英文/数字按整词，归一化小写
 *   - scoreEpisodicRecall：query 与每条情景卡片的 (summary + keywords) token 重叠打分，
 *     keywords 命中权重更高；返回按分降序的 Top-K（分 > 0）
 *
 * 设计取舍：
 *   - 候选量级小（单用户几十~几百条卡片），全量取出 + JS 打分足够，无需 SQLite FTS。
 *   - 刻意不依赖 SQLite FTS 的中文分词（unicode61 不分词 / trigram 噪声大），改用确定性
 *     bigram，纯逻辑、可单测、行为稳定。
 *   - 接口形状（query → Top-K EpisodicMemory）与未来向量召回一致，W5 替换实现零侵入上层。
 */
import type { EpisodicMemory } from './types'

/** 中文字符（含扩展）粗判：用于决定 bigram 还是 word 切分 */
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/
/** 连续的英文 / 数字 token */
const WORD_RE = /[a-z0-9]+/gi

/**
 * 把文本切成 token 集合：
 *   - 中文：相邻两字组成 bigram（「明天考试」→ 明天 / 天考 / 考试）；单字串也保底产出单字 token
 *   - 英文 / 数字：整词，小写
 *
 * 返回 Set 便于做交集；空文本返回空 Set。
 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  if (!text) return tokens

  const lower = text.toLowerCase()

  // 英文 / 数字整词
  for (const m of lower.matchAll(WORD_RE)) {
    if (m[0].length >= 2 || /\d/.test(m[0])) tokens.add(m[0])
  }

  // 中文 bigram：先抽出连续中文片段，再在片段内滑窗
  let run = ''
  const flushRun = (): void => {
    if (!run) return
    if (run.length === 1) {
      tokens.add(run)
    } else {
      for (let i = 0; i < run.length - 1; i++) {
        tokens.add(run.slice(i, i + 2))
      }
    }
    run = ''
  }
  for (const ch of text) {
    if (CJK_RE.test(ch)) run += ch
    else flushRun()
  }
  flushRun()

  return tokens
}

export interface RecallScored {
  memory: EpisodicMemory
  score: number
}

const SUMMARY_HIT_WEIGHT = 1
const KEYWORD_HIT_WEIGHT = 2

/** 从一条情景卡片里取出 keywords（约定存在 metadata.keywords，string[]） */
function keywordsOf(memory: EpisodicMemory): string[] {
  const kw = memory.metadata?.keywords
  if (!Array.isArray(kw)) return []
  return kw.filter((k): k is string => typeof k === 'string' && k.length > 0)
}

/**
 * 给所有情景卡片按与 query 的相关度打分，返回降序 Top-K（仅保留 score > 0）。
 *
 * 两路信号：
 *   - keywords：query 原串包含某个 keyword（子串匹配，大小写不敏感）计 +2。
 *     用子串而非 bigram 交集 —— 否则单字关键词（如「猫」）会被 bigram 切分漏掉。
 *   - summary：query 与 summary 的 bigram token 交集，每个交集 token 计 +1。
 */
export function scoreEpisodicRecall(
  query: string,
  memories: readonly EpisodicMemory[],
  topK: number
): EpisodicMemory[] {
  if (topK <= 0 || memories.length === 0) return []

  const queryLower = query.toLowerCase()
  const queryTokens = tokenize(query)
  if (!queryLower.trim()) return []

  const scored: RecallScored[] = []
  for (const memory of memories) {
    let score = 0

    for (const kw of keywordsOf(memory)) {
      if (queryLower.includes(kw.toLowerCase())) score += KEYWORD_HIT_WEIGHT
    }

    if (queryTokens.size > 0) {
      const summaryTokens = tokenize(memory.summary)
      for (const qt of queryTokens) {
        if (summaryTokens.has(qt)) score += SUMMARY_HIT_WEIGHT
      }
    }

    if (score > 0) scored.push({ memory, score })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // 同分时较新的优先（ts 大）
    return b.memory.ts - a.memory.ts
  })

  return scored.slice(0, topK).map((s) => s.memory)
}
