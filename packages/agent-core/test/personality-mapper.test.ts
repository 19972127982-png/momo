import { describe, expect, it } from 'vitest'
import {
  bucketDimension,
  describePersonality,
  formatPersonalityLines
} from '../src/personality-mapper'
import type { PersonalityState } from '../src/types'

describe('bucketDimension —— [-1, +1] 4 等分', () => {
  it.each([
    [-1.0, 'low'],
    [-0.6, 'low'],
    [-0.5001, 'low'],
    [-0.5, 'midLow'],
    [-0.1, 'midLow'],
    [-0.0001, 'midLow'],
    [0, 'midHigh'],
    [0.3, 'midHigh'],
    [0.4999, 'midHigh'],
    [0.5, 'high'],
    [0.8, 'high'],
    [1.0, 'high']
  ] as const)('value=%s → %s', (value, expected) => {
    expect(bucketDimension(value)).toBe(expected)
  })
})

describe('describePersonality —— 三维向量 → 3 行描述', () => {
  it('PRD 锚点 (0, +0.2, -0.3) 映射「midHigh / midHigh / midLow」', () => {
    const p: PersonalityState = { energy: 0, attachment: 0.2, sensitivity: -0.3 }
    const d = describePersonality(p)
    expect(d.energy).toBe('你性格开朗，喜欢和主人互动，会主动找话题')
    expect(d.attachment).toBe('你喜欢粘着主人，会主动找话题')
    expect(d.sensitivity).toBe('你比较稳，能感知但不放大主人情绪')
  })

  it('低端组合 (-0.8, -0.7, -0.6) 全部走 low', () => {
    const d = describePersonality({ energy: -0.8, attachment: -0.7, sensitivity: -0.6 })
    expect(d.energy).toContain('安静内敛')
    expect(d.attachment).toContain('独立')
    expect(d.sensitivity).toContain('钝感力')
  })

  it('高端组合 (+0.9, +0.9, +0.8) 全部走 high', () => {
    const d = describePersonality({ energy: 0.9, attachment: 0.9, sensitivity: 0.8 })
    expect(d.energy).toContain('超级活泼好动')
    expect(d.attachment).toContain('超级粘人')
    expect(d.sensitivity).toContain('高度共情')
  })
})

describe('formatPersonalityLines —— prompt 第二层 3 行文本', () => {
  it('每行以「- 」开头并换行连接', () => {
    const txt = formatPersonalityLines({ energy: 0, attachment: 0.2, sensitivity: -0.3 })
    const lines = txt.split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(line.startsWith('- ')).toBe(true)
    }
  })
})
