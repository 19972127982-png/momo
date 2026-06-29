/**
 * 用户画像提取 —— 跨平台纯逻辑（PRD §4.3 用户画像）
 *
 * 这里只放「不依赖 IO」的部分，方便单测：
 *   - shouldExtractProfile：触发判断（关键词命中 OR 每 N 轮兜底）
 *   - buildProfileExtractionPrompt：拼 LLM 抽取 prompt
 *   - parseProfileExtraction：解析 LLM 返回的 JSON（容忍 ```json 围栏 / 噪声）
 *   - mergeUserProfile：把抽取到的新事实并入既有画像（dedup）
 *   - summarizeUserProfile：把结构化画像转成 prompt 注入用的文本摘要
 *
 * LLM 调用本身 + SQLite 落盘在 apps/desktop 的 profileExtractor.ts 里装配。
 */
import type { UserProfile } from './types'

// =====================================================================
// 1. 触发判断
// =====================================================================

/** 命中这些关键词时，强烈暗示用户在陈述「关于自己的事实」，立即触发抽取 */
const PROFILE_SIGNAL_PATTERNS: readonly RegExp[] = [
  /我(叫|的名字|的小名|的昵称)/,
  /(叫我|喊我|称呼我)/,
  /我是[^?？]{0,20}(人|工程师|学生|程序员|设计师|医生|老师|开发|的)/,
  /我(喜欢|爱|讨厌|害怕|不喜欢|最爱)/,
  /我(养了|有一只|有只|家的)/,
  /我(住在|来自|在.{0,10}工作|在.{0,10}上班|在.{0,10}上学)/,
  /我的(生日|纪念日|猫|狗|宠物|工作|专业)/,
  /(生日|纪念日)是/,
  /我(今年|马上)?\d{1,2}岁/,
  /[A-Za-z]{4}/ // 可能是 MBTI（INFP 等）—— 粗筛，由 LLM 再判断
]

export interface ShouldExtractInput {
  userInput: string
  /** 距离上次成功抽取经过的对话轮数 */
  turnsSinceLastExtraction: number
  /** 兜底间隔：即使没命中关键词，每 N 轮也跑一次（默认 5） */
  everyNTurns?: number
}

export function shouldExtractProfile(input: ShouldExtractInput): boolean {
  const everyN = input.everyNTurns ?? 5
  const text = input.userInput ?? ''

  for (const re of PROFILE_SIGNAL_PATTERNS) {
    if (re.test(text)) return true
  }
  if (input.turnsSinceLastExtraction >= everyN) return true
  return false
}

// =====================================================================
// 2. 抽取 prompt
// =====================================================================

export function buildProfileExtractionPrompt(
  userMsg: string,
  assistantReply: string,
  existing: UserProfile
): string {
  const known = JSON.stringify(existing ?? {}, null, 0)
  return `你是一个信息抽取器。从下面这轮对话里，抽取「关于用户本人的、值得长期记住的事实」。

已知画像（不要重复输出已知且未变化的内容）：
${known}

用户说：${userMsg.slice(0, 300)}
桌宠回复：${assistantReply.slice(0, 300)}

只输出一个 JSON 对象，字段从以下可选（没有就省略该字段，全都没有就输出 {}）：
- nickname: string（用户希望被怎么称呼 / 名字）
- petCalling: string（用户希望桌宠用什么自称或被叫什么）
- mbti: string（如 INFP，仅在明确提到时）
- importantDates: [{ "date": "MM-DD 或 YYYY-MM-DD", "label": "生日/纪念日等" }]
- preferences: { 任意键值，如 "喜欢的食物": "火锅" }
- pets: [{ "name": "煤球", "species": "猫", "note": "可选备注" }]

严格只输出 JSON，不要解释，不要 markdown 围栏以外的任何文字。`
}

// =====================================================================
// 3. 解析 LLM 返回
// =====================================================================

/** 从可能含 ```json 围栏 / 前后噪声的字符串里抠出第一个 JSON 对象 */
export function parseProfileExtraction(raw: string): Partial<UserProfile> | null {
  if (!raw) return null
  let text = raw.trim()

  // 去掉 ```json ... ``` / ``` ... ``` 围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence && fence[1]) text = fence[1].trim()

  // 抠出第一个 { 到最后一个 } 之间的内容
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

  return sanitizeProfilePatch(obj as Record<string, unknown>)
}

/** 把任意对象按 UserProfile 形状过滤，丢弃非法字段 / 类型 */
function sanitizeProfilePatch(o: Record<string, unknown>): Partial<UserProfile> {
  const out: Partial<UserProfile> = {}

  if (typeof o.nickname === 'string' && o.nickname.trim()) out.nickname = o.nickname.trim()
  if (typeof o.petCalling === 'string' && o.petCalling.trim()) out.petCalling = o.petCalling.trim()
  if (typeof o.mbti === 'string' && o.mbti.trim()) out.mbti = o.mbti.trim().toUpperCase()

  if (Array.isArray(o.importantDates)) {
    const dates = o.importantDates
      .filter(
        (d): d is { date: string; label: string } =>
          typeof d === 'object' &&
          d !== null &&
          typeof (d as Record<string, unknown>).date === 'string' &&
          typeof (d as Record<string, unknown>).label === 'string'
      )
      .map((d) => ({ date: d.date.trim(), label: d.label.trim() }))
    if (dates.length) out.importantDates = dates
  }

  if (Array.isArray(o.pets)) {
    const pets = o.pets
      .filter(
        (p): p is { name: string; species?: string; note?: string } =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as Record<string, unknown>).name === 'string'
      )
      .map((p) => {
        const pet: { name: string; species?: string; note?: string } = { name: p.name.trim() }
        if (typeof p.species === 'string' && p.species.trim()) pet.species = p.species.trim()
        if (typeof p.note === 'string' && p.note.trim()) pet.note = p.note.trim()
        return pet
      })
    if (pets.length) out.pets = pets
  }

  if (
    typeof o.preferences === 'object' &&
    o.preferences !== null &&
    !Array.isArray(o.preferences)
  ) {
    const prefs: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o.preferences as Record<string, unknown>)) {
      if (k.trim() && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
        prefs[k.trim()] = v
      }
    }
    if (Object.keys(prefs).length) out.preferences = prefs
  }

  return out
}

// =====================================================================
// 4. 合并（dedup）
// =====================================================================

export function mergeUserProfile(
  existing: UserProfile,
  patch: Partial<UserProfile>
): UserProfile {
  const base: UserProfile = { ...(existing ?? {}) }

  if (patch.nickname) base.nickname = patch.nickname
  if (patch.petCalling) base.petCalling = patch.petCalling
  if (patch.mbti) base.mbti = patch.mbti

  if (patch.importantDates?.length) {
    const merged = [...(base.importantDates ?? [])]
    for (const d of patch.importantDates) {
      const dup = merged.some((x) => x.date === d.date && x.label === d.label)
      if (!dup) merged.push(d)
    }
    base.importantDates = merged
  }

  if (patch.pets?.length) {
    const merged = [...(base.pets ?? [])]
    for (const p of patch.pets) {
      const idx = merged.findIndex((x) => x.name === p.name)
      if (idx === -1) merged.push(p)
      else merged[idx] = { ...merged[idx], ...p } // 同名宠物 → 补充信息
    }
    base.pets = merged
  }

  if (patch.preferences) {
    base.preferences = { ...(base.preferences ?? {}), ...patch.preferences }
  }

  return base
}

/** patch 是否真的带来了新信息（避免无意义写库） */
export function profilePatchIsEmpty(patch: Partial<UserProfile> | null): boolean {
  if (!patch) return true
  return (
    !patch.nickname &&
    !patch.petCalling &&
    !patch.mbti &&
    !(patch.importantDates && patch.importantDates.length) &&
    !(patch.pets && patch.pets.length) &&
    !(patch.preferences && Object.keys(patch.preferences).length)
  )
}

// =====================================================================
// 5. 摘要（注入 prompt 用）
// =====================================================================

/**
 * 把结构化画像转成 prompt 注入用的中文摘要（确定性，不调 LLM）。
 * 空画像返回空串 —— PromptBuilder 会因此跳过「你对 ta 的了解」段。
 */
export function summarizeUserProfile(profile: UserProfile): string {
  if (!profile) return ''
  const parts: string[] = []

  if (profile.nickname) parts.push(`ta 希望被叫「${profile.nickname}」`)
  if (profile.petCalling) parts.push(`ta 希望你自称/被叫「${profile.petCalling}」`)
  if (profile.mbti) parts.push(`MBTI 是 ${profile.mbti}`)

  if (profile.pets?.length) {
    const petStr = profile.pets
      .map((p) => `${p.name}${p.species ? `（${p.species}）` : ''}`)
      .join('、')
    parts.push(`养了 ${petStr}`)
  }

  if (profile.importantDates?.length) {
    const dateStr = profile.importantDates.map((d) => `${d.label}:${d.date}`).join('、')
    parts.push(`重要日期：${dateStr}`)
  }

  if (profile.preferences && Object.keys(profile.preferences).length) {
    const prefStr = Object.entries(profile.preferences)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('、')
    parts.push(`偏好：${prefStr}`)
  }

  return parts.join('；')
}
