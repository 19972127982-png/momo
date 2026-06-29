/**
 * 互动总数 → 成长阶段映射（PRD §4.5.3）
 *
 * | 阶段 | 阈值 | 桌宠状态 |
 * |---|---|---|
 * | 初识 | < 30   | 好奇、拘谨，慢慢了解 |
 * | 熟悉 | < 100  | 展现真实性格，相处自在 |
 * | 亲密 | < 250  | 完全信任，会撒娇会任性 |
 * | 挚友 | ≥ 250  | 主动关心，深度了解 |
 *
 * 数字相对 ai-pet (10/50/150) 上调，因为桌宠是高频日常应用，单日交互数十次。
 */
import type { GrowthStage } from './types'

const STAGE_THRESHOLDS: ReadonlyArray<{ max: number; stage: GrowthStage }> = [
  { max: 30, stage: '初识' },
  { max: 100, stage: '熟悉' },
  { max: 250, stage: '亲密' }
]

const STAGE_DESCRIPTIONS: Record<GrowthStage, string> = {
  初识: '你和主人才刚认识，对他/她还有些好奇和拘谨。说话留点克制，慢慢了解 ta',
  熟悉: '你和主人已经相处熟了，可以展现真实性格，对话自然放松',
  亲密: '你和主人完全信任彼此，可以撒娇、可以任性，关系紧密',
  挚友: '你是主人最懂他/她的小伙伴，会主动关心，也理解 ta 不说出口的情绪'
}

export function deriveGrowthStage(totalInteractions: number): GrowthStage {
  for (const entry of STAGE_THRESHOLDS) {
    if (totalInteractions < entry.max) return entry.stage
  }
  return '挚友'
}

export function describeGrowthStage(stage: GrowthStage): string {
  return STAGE_DESCRIPTIONS[stage]
}
