/**
 * 性格演化引擎 —— 跨平台纯逻辑（PRD §4.5 性格演化）
 *
 * 每轮对话后异步跑一次：让 LLM 根据这轮互动给出一个「微小」的三维 delta，
 * clamp 后并入当前性格向量，并落 evolution_log（作品集漂移轨迹图数据源）。
 *
 * 这里只放不依赖 IO 的部分（prompt / 解析 / clamp 应用），LLM 调用 + 落库在
 * apps/desktop 的 personalityEngine.ts 里装配。
 *
 * 三维含义与软边界（与 types.ts / personality-mapper.ts 对齐）：
 *   - energy      ∈ [-1.0, +1.0]  安静内敛 ↔ 活泼好动
 *   - attachment  ∈ [-0.5, +1.0]  独立     ↔ 粘人
 *   - sensitivity ∈ [-0.6, +0.8]  钝感     ↔ 高敏感
 */
import type { PersonalityState } from './types'

/** 单维取值软边界 */
export const PERSONALITY_BOUNDS = {
  energy: { min: -1.0, max: 1.0 },
  attachment: { min: -0.5, max: 1.0 },
  sensitivity: { min: -0.6, max: 0.8 }
} as const

/** 单轮 delta 的最大幅度 —— 防止一轮对话把性格甩飞，保证「慢慢变化」 */
export const MAX_DELTA_PER_TURN = 0.15

export type PersonalityDelta = PersonalityState

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

// =====================================================================
// 1. 分析 prompt
// =====================================================================

export function buildEvolutionPrompt(
  state: PersonalityState,
  userMsg: string,
  replyMsg: string
): string {
  return `你是一个性格演化分析器。一只桌宠正在和主人相处，性格会随互动缓慢变化。
桌宠当前性格三维向量（每维 -1 到 1）：
- energy（安静 ↔ 活泼）：${state.energy.toFixed(2)}
- attachment（独立 ↔ 粘人）：${state.attachment.toFixed(2)}
- sensitivity（钝感 ↔ 高敏感）：${state.sensitivity.toFixed(2)}

这一轮互动：
主人说：${userMsg.slice(0, 200)}
桌宠回：${replyMsg.slice(0, 200)}

根据这一轮，判断桌宠性格应有的「微小」变化（每维 delta 在 -0.1 到 0.1 之间，绝大多数轮次应接近 0）。
- 主人热情/玩闹 → energy 略增；主人冷淡/疲惫 → energy 略减
- 主人频繁互动/示好 → attachment 略增；主人疏远 → 略减
- 主人表露情绪/被细腻回应认可 → sensitivity 略增

只输出一个 JSON 对象：{ "energy": 0.0, "attachment": 0.0, "sensitivity": 0.0 }
严格只输出 JSON，不要解释。`
}

// =====================================================================
// 2. 解析 delta
// =====================================================================

/** 从可能含围栏 / 噪声的字符串里抠出 delta，并把每维 clamp 到单轮上限 */
export function parsePersonalityDelta(raw: string): PersonalityDelta | null {
  if (!raw) return null
  let text = raw.trim()

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence && fence[1]) text = fence[1].trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null

  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null

  const o = obj as Record<string, unknown>
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0

  const delta: PersonalityDelta = {
    energy: clamp(num(o.energy), -MAX_DELTA_PER_TURN, MAX_DELTA_PER_TURN),
    attachment: clamp(num(o.attachment), -MAX_DELTA_PER_TURN, MAX_DELTA_PER_TURN),
    sensitivity: clamp(num(o.sensitivity), -MAX_DELTA_PER_TURN, MAX_DELTA_PER_TURN)
  }
  return delta
}

/** delta 是否可忽略（全为 0 —— 无需写库） */
export function deltaIsNegligible(delta: PersonalityDelta | null): boolean {
  if (!delta) return true
  return delta.energy === 0 && delta.attachment === 0 && delta.sensitivity === 0
}

// =====================================================================
// 3. 应用 delta（clamp 到软边界）
// =====================================================================

export function applyPersonalityDelta(
  state: PersonalityState,
  delta: PersonalityDelta
): PersonalityState {
  return {
    energy: clamp(
      state.energy + delta.energy,
      PERSONALITY_BOUNDS.energy.min,
      PERSONALITY_BOUNDS.energy.max
    ),
    attachment: clamp(
      state.attachment + delta.attachment,
      PERSONALITY_BOUNDS.attachment.min,
      PERSONALITY_BOUNDS.attachment.max
    ),
    sensitivity: clamp(
      state.sensitivity + delta.sensitivity,
      PERSONALITY_BOUNDS.sensitivity.min,
      PERSONALITY_BOUNDS.sensitivity.max
    )
  }
}

/** 两个性格向量的 L2 距离 —— 验收「30 轮漂移 ≥ 0.15」用 */
export function personalityL2(a: PersonalityState, b: PersonalityState): number {
  const de = a.energy - b.energy
  const da = a.attachment - b.attachment
  const ds = a.sensitivity - b.sensitivity
  return Math.sqrt(de * de + da * da + ds * ds)
}
