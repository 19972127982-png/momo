import { describe, expect, it } from 'vitest'
import { deriveGrowthStage, describeGrowthStage } from '../src/growth-stage'

describe('deriveGrowthStage —— PRD §4.5.3 阈值映射', () => {
  it.each([
    [0, '初识'],
    [1, '初识'],
    [29, '初识'],
    [30, '熟悉'],
    [99, '熟悉'],
    [100, '亲密'],
    [249, '亲密'],
    [250, '挚友'],
    [1000, '挚友']
  ] as const)('interactions=%s → %s', (n, expected) => {
    expect(deriveGrowthStage(n)).toBe(expected)
  })
})

describe('describeGrowthStage —— 4 个阶段都有非空描述', () => {
  for (const stage of ['初识', '熟悉', '亲密', '挚友'] as const) {
    it(`${stage} 有描述`, () => {
      const text = describeGrowthStage(stage)
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(5)
    })
  }
})
