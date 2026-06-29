import { describe, expect, it } from 'vitest'
import {
  buildProfileExtractionPrompt,
  mergeUserProfile,
  parseProfileExtraction,
  profilePatchIsEmpty,
  shouldExtractProfile,
  summarizeUserProfile
} from '../src/profile-extraction'
import type { UserProfile } from '../src/types'

describe('shouldExtractProfile —— 触发判断', () => {
  it('命中「我叫」关键词立即触发', () => {
    expect(
      shouldExtractProfile({ userInput: '我叫小李', turnsSinceLastExtraction: 0 })
    ).toBe(true)
  })

  it('命中「叫我」触发', () => {
    expect(
      shouldExtractProfile({ userInput: '以后叫我老李吧', turnsSinceLastExtraction: 0 })
    ).toBe(true)
  })

  it('命中「我养了」触发', () => {
    expect(
      shouldExtractProfile({ userInput: '我养了一只布偶猫', turnsSinceLastExtraction: 1 })
    ).toBe(true)
  })

  it('命中「我喜欢」触发', () => {
    expect(
      shouldExtractProfile({ userInput: '我喜欢吃火锅', turnsSinceLastExtraction: 0 })
    ).toBe(true)
  })

  it('普通闲聊 + 未到兜底轮数 → 不触发', () => {
    expect(
      shouldExtractProfile({ userInput: '今天天气真好', turnsSinceLastExtraction: 2 })
    ).toBe(false)
  })

  it('未命中关键词但到达每 5 轮兜底 → 触发', () => {
    expect(
      shouldExtractProfile({ userInput: '嗯嗯', turnsSinceLastExtraction: 5 })
    ).toBe(true)
  })

  it('自定义 everyNTurns', () => {
    expect(
      shouldExtractProfile({ userInput: '哦', turnsSinceLastExtraction: 3, everyNTurns: 3 })
    ).toBe(true)
    expect(
      shouldExtractProfile({ userInput: '哦', turnsSinceLastExtraction: 2, everyNTurns: 3 })
    ).toBe(false)
  })
})

describe('parseProfileExtraction —— 解析 LLM 返回', () => {
  it('纯 JSON', () => {
    const r = parseProfileExtraction('{"nickname":"小李","mbti":"infp"}')
    expect(r).toEqual({ nickname: '小李', mbti: 'INFP' })
  })

  it('```json 围栏包裹', () => {
    const raw = '```json\n{"nickname":"阿明"}\n```'
    expect(parseProfileExtraction(raw)).toEqual({ nickname: '阿明' })
  })

  it('前后带噪声文字也能抠出 JSON', () => {
    const raw = '好的，这是抽取结果：{"petCalling":"桃酱"} 希望有用'
    expect(parseProfileExtraction(raw)).toEqual({ petCalling: '桃酱' })
  })

  it('空对象 → 返回空 patch（非 null）', () => {
    expect(parseProfileExtraction('{}')).toEqual({})
  })

  it('非法 JSON → null', () => {
    expect(parseProfileExtraction('not json at all')).toBe(null)
    expect(parseProfileExtraction('')).toBe(null)
  })

  it('过滤非法字段类型', () => {
    const raw = '{"nickname":123,"mbti":"enfp","unknownField":"x"}'
    // nickname 不是 string 被丢弃，mbti 保留并大写
    expect(parseProfileExtraction(raw)).toEqual({ mbti: 'ENFP' })
  })

  it('importantDates / pets 结构过滤', () => {
    const raw = JSON.stringify({
      importantDates: [
        { date: '03-15', label: '生日' },
        { date: '01-01' }, // 缺 label，丢弃
        'garbage'
      ],
      pets: [{ name: '煤球', species: '猫' }, { species: '狗' }]
    })
    const r = parseProfileExtraction(raw)
    expect(r?.importantDates).toEqual([{ date: '03-15', label: '生日' }])
    expect(r?.pets).toEqual([{ name: '煤球', species: '猫' }])
  })

  it('preferences 只保留标量值', () => {
    const raw = '{"preferences":{"食物":"火锅","复杂":{"x":1},"数字":3}}'
    const r = parseProfileExtraction(raw)
    expect(r?.preferences).toEqual({ 食物: '火锅', 数字: 3 })
  })
})

describe('mergeUserProfile —— 合并 dedup', () => {
  it('标量字段被 patch 覆盖', () => {
    const merged = mergeUserProfile({ nickname: '旧名' }, { nickname: '新名' })
    expect(merged.nickname).toBe('新名')
  })

  it('importantDates 去重追加', () => {
    const existing: UserProfile = { importantDates: [{ date: '03-15', label: '生日' }] }
    const merged = mergeUserProfile(existing, {
      importantDates: [
        { date: '03-15', label: '生日' }, // dup
        { date: '12-25', label: '纪念日' }
      ]
    })
    expect(merged.importantDates).toEqual([
      { date: '03-15', label: '生日' },
      { date: '12-25', label: '纪念日' }
    ])
  })

  it('同名宠物补充信息而非重复', () => {
    const existing: UserProfile = { pets: [{ name: '煤球' }] }
    const merged = mergeUserProfile(existing, { pets: [{ name: '煤球', species: '猫' }] })
    expect(merged.pets).toEqual([{ name: '煤球', species: '猫' }])
  })

  it('新宠物追加', () => {
    const existing: UserProfile = { pets: [{ name: '煤球', species: '猫' }] }
    const merged = mergeUserProfile(existing, { pets: [{ name: '旺财', species: '狗' }] })
    expect(merged.pets).toHaveLength(2)
  })

  it('preferences 浅合并', () => {
    const existing: UserProfile = { preferences: { 食物: '火锅' } }
    const merged = mergeUserProfile(existing, { preferences: { 颜色: '蓝' } })
    expect(merged.preferences).toEqual({ 食物: '火锅', 颜色: '蓝' })
  })

  it('空 existing 也安全', () => {
    const merged = mergeUserProfile({}, { nickname: '小李' })
    expect(merged.nickname).toBe('小李')
  })
})

describe('profilePatchIsEmpty', () => {
  it('null / {} → true', () => {
    expect(profilePatchIsEmpty(null)).toBe(true)
    expect(profilePatchIsEmpty({})).toBe(true)
  })
  it('有任意字段 → false', () => {
    expect(profilePatchIsEmpty({ nickname: 'x' })).toBe(false)
    expect(profilePatchIsEmpty({ pets: [{ name: '煤球' }] })).toBe(false)
    expect(profilePatchIsEmpty({ preferences: { a: 1 } })).toBe(false)
  })
  it('空数组 / 空对象字段 → true', () => {
    expect(profilePatchIsEmpty({ importantDates: [], pets: [], preferences: {} })).toBe(true)
  })
})

describe('summarizeUserProfile —— prompt 注入摘要', () => {
  it('空画像 → 空串', () => {
    expect(summarizeUserProfile({})).toBe('')
  })

  it('完整画像拼成中文摘要', () => {
    const profile: UserProfile = {
      nickname: '小李',
      mbti: 'INFP',
      pets: [{ name: '煤球', species: '猫' }],
      importantDates: [{ date: '03-15', label: '生日' }],
      preferences: { 食物: '火锅' }
    }
    const s = summarizeUserProfile(profile)
    expect(s).toContain('小李')
    expect(s).toContain('INFP')
    expect(s).toContain('煤球（猫）')
    expect(s).toContain('生日:03-15')
    expect(s).toContain('食物=火锅')
  })
})

describe('buildProfileExtractionPrompt', () => {
  it('包含已知画像 + 当前对话 + JSON 指令', () => {
    const prompt = buildProfileExtractionPrompt('我叫小李', '你好小李', { mbti: 'INFP' })
    expect(prompt).toContain('INFP') // 已知画像
    expect(prompt).toContain('我叫小李')
    expect(prompt).toContain('你好小李')
    expect(prompt).toContain('只输出一个 JSON')
  })

  it('超长输入被截断到 300 字', () => {
    const long = '我'.repeat(500)
    const prompt = buildProfileExtractionPrompt(long, 'ok', {})
    // 用户消息部分不应包含完整 500 字
    expect(prompt).not.toContain('我'.repeat(301))
  })
})
