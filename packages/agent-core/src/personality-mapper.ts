/**
 * 性格三维向量 → prompt 描述映射（PRD §4.7.2）
 *
 * 每个维度按 [-1, +1] 4 等分映射到一段描述文字。
 * 注意：维度的"软上限"由演化引擎（PRD §4.5）clamp（attachment ∈ [-0.5, +1.0] /
 * sensitivity ∈ [-0.6, +0.8] / energy 全开），但这里只关心区间 → 文本的映射，
 * 由演化引擎确保传进来的值在合理范围内。
 *
 * 映射边界采用左闭右开（`x < threshold`）+ 末段闭区间，以避免 0 / 0.5 等边界值的
 * 重复匹配。
 */
import type { PersonalityState } from './types'

export type DimensionLevel = 'low' | 'midLow' | 'midHigh' | 'high'

/** 把 [-1, +1] 范围内的一个分量映射成 4 档枚举 */
export function bucketDimension(value: number): DimensionLevel {
  if (value < -0.5) return 'low'
  if (value < 0) return 'midLow'
  if (value < 0.5) return 'midHigh'
  return 'high'
}

const ENERGY_DESCRIPTIONS: Record<DimensionLevel, string> = {
  low: '你性格安静内敛，喜欢安静陪伴，说话轻声细语',
  midLow: '你比较文静，偶尔活泼，不排斥玩闹',
  midHigh: '你性格开朗，喜欢和主人互动，会主动找话题',
  high: '你超级活泼好动，话多精力旺盛'
}

const ATTACHMENT_DESCRIPTIONS: Record<DimensionLevel, string> = {
  low: '你比较独立，不太主动找主人',
  midLow: '你有点傲娇，嘴上不说但很在意',
  midHigh: '你喜欢粘着主人，会主动找话题',
  high: '你超级粘人，时刻想得到关注'
}

const SENSITIVITY_DESCRIPTIONS: Record<DimensionLevel, string> = {
  low: '你钝感力强，不过度解读主人的情绪，给稳定踏实感',
  midLow: '你比较稳，能感知但不放大主人情绪',
  midHigh: '你敏感细腻，能察觉主人情绪的细微变化',
  high: '你高度共情，主人一个语气词就能让你联想很多'
}

export interface PersonalityDescriptionLines {
  energy: string
  attachment: string
  sensitivity: string
}

/** 把三维向量映射成 3 行描述，供 prompt 第二层动态修饰拼接 */
export function describePersonality(p: PersonalityState): PersonalityDescriptionLines {
  return {
    energy: ENERGY_DESCRIPTIONS[bucketDimension(p.energy)],
    attachment: ATTACHMENT_DESCRIPTIONS[bucketDimension(p.attachment)],
    sensitivity: SENSITIVITY_DESCRIPTIONS[bucketDimension(p.sensitivity)]
  }
}

/** 直接拼成 prompt 内嵌的 3 行文本（行首加破折号） */
export function formatPersonalityLines(p: PersonalityState): string {
  const d = describePersonality(p)
  return ['- ' + d.energy, '- ' + d.attachment, '- ' + d.sensitivity].join('\n')
}
