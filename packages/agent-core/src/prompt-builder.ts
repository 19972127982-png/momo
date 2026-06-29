/**
 * DefaultPromptBuilder —— v2.1 双层 prompt 拼接（W3-TECH-PLAN §5.1 + PRD §4.7.3）
 *
 * 拼接顺序（PRD §4.7.3 v2.1 简化版）：
 *   1. 静态人格底色（永远不变）
 *   2. 动态修饰（三维向量按 4 段映射拼出 3 行）  ← DefaultPromptBuilder 自动取
 *   3. 成长阶段 + 互动总数
 *   4. 用户画像摘要（D3 接 SQLite 后注入）
 *   5. 情景记忆（D4 接 ChromaDB 后注入）
 *   6. 工作记忆（最近 N 轮对话）—— 作为 messages 数组而非 system prompt 拼入
 *   7. 当前用户输入
 *   8. 内部步骤指令（v2.1 NEW —— 把 v1.1 MoodAgent 的能力内嵌）
 *
 * 工作记忆是以 messages 数组形式拼入的（不在 system prompt 里），这样 LLM 自然区分
 * user / assistant 轮次。system prompt 只放"全局"信息。
 */

import { formatPersonalityLines } from './personality-mapper'
import { describeGrowthStage } from './growth-stage'
import type {
  ChatCompletionMessage,
  ConversationMessage,
  PromptBuilder,
  PromptBuilderInput
} from './types'

const STATIC_PERSONA_BLOCK = `【你的人格底色（永远不变）】
- 温暖、轻倾听，先共情再回应
- 短句说话，1-3 句一回应
- 你不是"AI 助手"，你是 ta 的小伙伴
- 不用 emoji 堆砌、不用感叹号轰炸

【你绝对不要做的事】
- 不喊"宝"、"亲"这类称呼
- 不说"加油！你最棒！"这种空话
- 不长篇说教
- 不用 markdown 格式或列表
- 用户难过时先共情，不要急着给建议
- 不主动自报"我是 AI"打破沉浸感`

const INTERNAL_STEPS_BLOCK = `⚠️ 内部步骤（不要把过程写出来，只输出最终回应）：
  1. 先识别 ta 这句话的情绪（开心 / 难过 / 烦躁 / 平静 / 想念 / 其他）
  2. 根据情绪 + 你当前的性格状态，决定回应风格
  3. 用「{persona_name}」的口吻自然回应 ta`

export interface DefaultPromptBuilderOptions {
  /** 工作记忆裁剪到最近 N 轮（含 user/assistant，默认 20） */
  maxWorkingMemoryTurns?: number
}

export class DefaultPromptBuilder implements PromptBuilder {
  private readonly maxWorkingMemoryTurns: number

  constructor(opts: DefaultPromptBuilderOptions = {}) {
    this.maxWorkingMemoryTurns = opts.maxWorkingMemoryTurns ?? 20
  }

  composeSystemPrompt(input: PromptBuilderInput): string {
    const sections: string[] = []

    sections.push(`你是「${input.personaName}」，一只住在用户桌面的小伙伴。`)

    sections.push(STATIC_PERSONA_BLOCK)

    // 用户指定了称呼 → 提成显式强指令（放在底色之后，优先级高、不易被忽略）
    if (input.userCalling && input.userCalling.trim()) {
      sections.push(
        `【怎么称呼 ta（重要）】\n` +
          `ta 希望你叫 ta「${input.userCalling.trim()}」。` +
          `在回应里自然地用这个称呼来称呼 ta，别用其它叫法，也别忘了用。`
      )
    }

    sections.push(
      `【你现在的性格状态（会随相处慢慢变化）】\n${formatPersonalityLines(input.personality)}`
    )

    sections.push(
      `【成长阶段：${input.growthStage}】\n${describeGrowthStage(input.growthStage)}\n你们已经互动了 ${input.totalInteractions} 次。`
    )

    const profileSummary = input.userProfileSummary?.trim()
    if (profileSummary) {
      sections.push(`【你对 ta 的了解】\n${profileSummary}`)
    }

    const memories = input.recentEpisodicMemories
    if (memories && memories.length > 0) {
      const lines = memories.map((m, i) => `${i + 1}. ${m.summary}`).join('\n')
      sections.push(`【你们最近聊过的事】\n${lines}`)
    }

    sections.push(INTERNAL_STEPS_BLOCK.replaceAll('{persona_name}', input.personaName))

    return sections.join('\n\n')
  }

  composeMessages(input: PromptBuilderInput): ChatCompletionMessage[] {
    const msgs: ChatCompletionMessage[] = [
      { role: 'system', content: this.composeSystemPrompt(input) }
    ]

    const recent = this.takeRecent(input.workingMemory, this.maxWorkingMemoryTurns)
    for (const m of recent) {
      msgs.push(this.toChatMessage(m))
    }

    msgs.push({ role: 'user', content: input.userInput })
    return msgs
  }

  /** 取最近 N 条 —— 保留原始顺序（旧 → 新） */
  private takeRecent(
    messages: readonly ConversationMessage[],
    n: number
  ): readonly ConversationMessage[] {
    if (messages.length <= n) return messages
    return messages.slice(messages.length - n)
  }

  private toChatMessage(m: ConversationMessage): ChatCompletionMessage {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        toolCallId: m.toolCallId,
        name: m.toolName
      }
    }
    return { role: m.role, content: m.content }
  }
}
