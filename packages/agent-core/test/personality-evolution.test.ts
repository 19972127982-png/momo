import { describe, expect, it } from 'vitest'
import {
  applyPersonalityDelta,
  buildEvolutionPrompt,
  deltaIsNegligible,
  MAX_DELTA_PER_TURN,
  parsePersonalityDelta,
  PERSONALITY_BOUNDS,
  personalityL2
} from '../src/personality-evolution'
import type { PersonalityState } from '../src/types'

const anchor: PersonalityState = { energy: 0, attachment: 0.2, sensitivity: -0.3 }

describe('buildEvolutionPrompt', () => {
  it('包含当前向量与本轮互动，要求输出 JSON', () => {
    const prompt = buildEvolutionPrompt(anchor, '今天好累', '辛苦了，歇会儿')
    expect(prompt).toContain('0.20')
    expect(prompt).toContain('今天好累')
    expect(prompt).toContain('辛苦了')
    expect(prompt).toContain('JSON')
  })
})

describe('parsePersonalityDelta', () => {
  it('解析裸 JSON delta', () => {
    const d = parsePersonalityDelta('{"energy":0.05,"attachment":0.02,"sensitivity":-0.01}')
    expect(d).toEqual({ energy: 0.05, attachment: 0.02, sensitivity: -0.01 })
  })

  it('剥离 ```json 围栏', () => {
    const d = parsePersonalityDelta('```json\n{"energy":0.1,"attachment":0,"sensitivity":0}\n```')
    expect(d?.energy).toBe(0.1)
  })

  it('超过单轮上限的 delta 被 clamp', () => {
    const d = parsePersonalityDelta('{"energy":0.9,"attachment":-0.8,"sensitivity":0.5}')
    expect(d?.energy).toBe(MAX_DELTA_PER_TURN)
    expect(d?.attachment).toBe(-MAX_DELTA_PER_TURN)
    expect(d?.sensitivity).toBe(MAX_DELTA_PER_TURN)
  })

  it('缺失字段按 0 处理', () => {
    const d = parsePersonalityDelta('{"energy":0.03}')
    expect(d).toEqual({ energy: 0.03, attachment: 0, sensitivity: 0 })
  })

  it('非数字字段按 0 处理', () => {
    const d = parsePersonalityDelta('{"energy":"a lot","attachment":0.02}')
    expect(d?.energy).toBe(0)
    expect(d?.attachment).toBe(0.02)
  })

  it('非法输入返回 null', () => {
    expect(parsePersonalityDelta('garbage')).toBeNull()
    expect(parsePersonalityDelta('')).toBeNull()
    expect(parsePersonalityDelta('[1,2,3]')).toBeNull()
  })
})

describe('deltaIsNegligible', () => {
  it('全 0 视为可忽略', () => {
    expect(deltaIsNegligible({ energy: 0, attachment: 0, sensitivity: 0 })).toBe(true)
  })
  it('null 视为可忽略', () => {
    expect(deltaIsNegligible(null)).toBe(true)
  })
  it('有非 0 分量不可忽略', () => {
    expect(deltaIsNegligible({ energy: 0.01, attachment: 0, sensitivity: 0 })).toBe(false)
  })
})

describe('applyPersonalityDelta', () => {
  it('正常叠加', () => {
    const next = applyPersonalityDelta(anchor, {
      energy: 0.1,
      attachment: 0.1,
      sensitivity: 0.1
    })
    expect(next.energy).toBeCloseTo(0.1)
    expect(next.attachment).toBeCloseTo(0.3)
    expect(next.sensitivity).toBeCloseTo(-0.2)
  })

  it('clamp 到 energy 上界 +1', () => {
    const next = applyPersonalityDelta(
      { energy: 0.95, attachment: 0, sensitivity: 0 },
      { energy: 0.15, attachment: 0, sensitivity: 0 }
    )
    expect(next.energy).toBe(PERSONALITY_BOUNDS.energy.max)
  })

  it('clamp 到 attachment 下界 -0.5', () => {
    const next = applyPersonalityDelta(
      { energy: 0, attachment: -0.45, sensitivity: 0 },
      { energy: 0, attachment: -0.15, sensitivity: 0 }
    )
    expect(next.attachment).toBe(PERSONALITY_BOUNDS.attachment.min)
  })

  it('clamp 到 sensitivity 上界 +0.8', () => {
    const next = applyPersonalityDelta(
      { energy: 0, attachment: 0, sensitivity: 0.75 },
      { energy: 0, attachment: 0, sensitivity: 0.15 }
    )
    expect(next.sensitivity).toBe(PERSONALITY_BOUNDS.sensitivity.max)
  })
})

describe('personalityL2', () => {
  it('相同向量距离为 0', () => {
    expect(personalityL2(anchor, anchor)).toBe(0)
  })
  it('计算欧氏距离', () => {
    const d = personalityL2(
      { energy: 0, attachment: 0, sensitivity: 0 },
      { energy: 0.3, attachment: 0.4, sensitivity: 0 }
    )
    expect(d).toBeCloseTo(0.5)
  })
})
