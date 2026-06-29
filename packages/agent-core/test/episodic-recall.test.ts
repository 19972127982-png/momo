import { describe, expect, it } from 'vitest'
import { scoreEpisodicRecall, tokenize } from '../src/episodic-recall'
import type { EpisodicMemory } from '../src/types'

function mem(
  summary: string,
  keywords: string[],
  opts: { id?: string; ts?: number } = {}
): EpisodicMemory {
  return {
    id: opts.id ?? Math.random().toString(36).slice(2),
    summary,
    ts: opts.ts ?? Date.now(),
    metadata: { keywords }
  }
}

describe('tokenize', () => {
  it('中文切 bigram', () => {
    const t = tokenize('明天考试')
    expect(t.has('明天')).toBe(true)
    expect(t.has('天考')).toBe(true)
    expect(t.has('考试')).toBe(true)
  })

  it('单个中文字保底产出单字 token', () => {
    expect(tokenize('猫').has('猫')).toBe(true)
  })

  it('英文整词小写', () => {
    const t = tokenize('I love JavaScript')
    expect(t.has('love')).toBe(true)
    expect(t.has('javascript')).toBe(true)
    // 单字母 i 被过滤
    expect(t.has('i')).toBe(false)
  })

  it('数字保留（含单字符数字）', () => {
    expect(tokenize('第3章').has('3')).toBe(true)
  })

  it('空文本返回空集合', () => {
    expect(tokenize('').size).toBe(0)
  })

  it('中英混排各自切分', () => {
    const t = tokenize('用 React 写界面')
    expect(t.has('react')).toBe(true)
    expect(t.has('界面')).toBe(true)
  })
})

describe('scoreEpisodicRecall', () => {
  const memories = [
    mem('用户下周三有面试，比较紧张', ['面试', '紧张'], { id: 'a' }),
    mem('聊到用户喜欢的乐队', ['音乐', '乐队'], { id: 'b' }),
    mem('用户养了一只猫叫煤球', ['猫', '煤球'], { id: 'c' })
  ]

  it('召回与 query 关键词重叠的卡片', () => {
    const got = scoreEpisodicRecall('面试好紧张啊', memories, 3)
    expect(got[0].id).toBe('a')
  })

  it('keywords 命中权重高于 summary', () => {
    // query「猫」命中 c 的 keyword（+2），不命中其它
    const got = scoreEpisodicRecall('我家的猫', memories, 3)
    expect(got[0].id).toBe('c')
  })

  it('无重叠返回空', () => {
    expect(scoreEpisodicRecall('今天天气真好', memories, 3)).toEqual([])
  })

  it('topK 截断', () => {
    const got = scoreEpisodicRecall('面试 乐队 猫', memories, 2)
    expect(got).toHaveLength(2)
  })

  it('topK <= 0 返回空', () => {
    expect(scoreEpisodicRecall('面试', memories, 0)).toEqual([])
  })

  it('空 query 返回空', () => {
    expect(scoreEpisodicRecall('', memories, 3)).toEqual([])
  })

  it('空候选返回空', () => {
    expect(scoreEpisodicRecall('面试', [], 3)).toEqual([])
  })

  it('同分时较新（ts 大）优先', () => {
    const a = mem('聊到面试', ['面试'], { id: 'old', ts: 1000 })
    const b = mem('又聊到面试', ['面试'], { id: 'new', ts: 2000 })
    const got = scoreEpisodicRecall('面试', [a, b], 1)
    expect(got[0].id).toBe('new')
  })

  it('没有 keywords 也能靠 summary 召回', () => {
    const m = mem('用户提到喜欢爬山', [], { id: 'hike' })
    const got = scoreEpisodicRecall('周末去爬山', [m], 1)
    expect(got[0].id).toBe('hike')
  })
})
