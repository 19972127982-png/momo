import { describe, expect, it } from 'vitest'
import {
  buildSummaryPrompt,
  parseSummaryCards,
  shouldSummarize
} from '../src/episodic-summary'
import type { ConversationMessage } from '../src/types'

function msg(role: ConversationMessage['role'], content: string): ConversationMessage {
  return { id: Math.random().toString(36).slice(2), role, content, ts: Date.now() }
}

describe('shouldSummarize —— 触发判断', () => {
  it('新消息未达阈值不触发', () => {
    expect(shouldSummarize({ newMessagesSinceLastSummary: 7 })).toBe(false)
  })

  it('新消息达默认阈值 8 触发', () => {
    expect(shouldSummarize({ newMessagesSinceLastSummary: 8 })).toBe(true)
  })

  it('自定义阈值', () => {
    expect(
      shouldSummarize({ newMessagesSinceLastSummary: 4, everyNMessages: 4 })
    ).toBe(true)
    expect(
      shouldSummarize({ newMessagesSinceLastSummary: 3, everyNMessages: 4 })
    ).toBe(false)
  })
})

describe('buildSummaryPrompt', () => {
  it('包含对话转录（user/assistant 角色翻成中文标签）', () => {
    const prompt = buildSummaryPrompt([
      msg('user', '我下周三有面试'),
      msg('assistant', '会紧张吗？')
    ])
    expect(prompt).toContain('用户：我下周三有面试')
    expect(prompt).toContain('桌宠：会紧张吗？')
  })

  it('过滤掉 tool 角色', () => {
    const prompt = buildSummaryPrompt([
      msg('user', '列一下文件'),
      msg('tool', '{"files":["a.txt"]}')
    ])
    expect(prompt).not.toContain('a.txt')
  })

  it('要求输出 JSON 数组', () => {
    const prompt = buildSummaryPrompt([msg('user', '你好')])
    expect(prompt).toContain('JSON 数组')
  })
})

describe('parseSummaryCards', () => {
  it('解析裸 JSON 数组', () => {
    const cards = parseSummaryCards(
      '[{"summary":"用户下周三有面试，比较紧张","eventType":"工作","keywords":["面试","紧张"]}]'
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]).toEqual({
      summary: '用户下周三有面试，比较紧张',
      eventType: '工作',
      keywords: ['面试', '紧张']
    })
  })

  it('剥离 ```json 围栏', () => {
    const cards = parseSummaryCards(
      '```json\n[{"summary":"聊到喜欢的乐队","keywords":["音乐","乐队"]}]\n```'
    )
    expect(cards).toHaveLength(1)
    expect(cards[0].keywords).toEqual(['音乐', '乐队'])
    expect(cards[0].eventType).toBeUndefined()
  })

  it('容忍前后噪声文本', () => {
    const cards = parseSummaryCards('好的，结果是：[{"summary":"养了猫煤球","keywords":["猫"]}] 完毕')
    expect(cards).toHaveLength(1)
    expect(cards[0].summary).toBe('养了猫煤球')
  })

  it('空数组返回空', () => {
    expect(parseSummaryCards('[]')).toEqual([])
  })

  it('非法 JSON 返回空数组', () => {
    expect(parseSummaryCards('not json at all')).toEqual([])
    expect(parseSummaryCards('')).toEqual([])
  })

  it('丢弃缺 summary 的卡片', () => {
    const cards = parseSummaryCards('[{"keywords":["x"]},{"summary":"有效","keywords":[]}]')
    expect(cards).toHaveLength(1)
    expect(cards[0].summary).toBe('有效')
  })

  it('keywords 非数组时降级为空数组', () => {
    const cards = parseSummaryCards('[{"summary":"abc","keywords":"x"}]')
    expect(cards).toHaveLength(1)
    expect(cards[0].keywords).toEqual([])
  })

  it('过滤 keywords 里的非字符串 / 空串', () => {
    const cards = parseSummaryCards('[{"summary":"abc","keywords":["a","",123,"b"]}]')
    expect(cards[0].keywords).toEqual(['a', 'b'])
  })
})
