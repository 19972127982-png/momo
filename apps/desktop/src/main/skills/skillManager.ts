/**
 * SkillManager（W4 D5）—— Skills 启用态的主进程门面
 *
 * 把 SkillRepo（持久态）+ agent-core 纯解析（启用集合 → server 并集 / prompt 增补）
 * 封成 chat:send 与设置面板都好用的接口：
 *   - list()             ：设置 Skills tab 渲染用
 *   - setEnabled()       ：tab 上切 ON/OFF
 *   - enabledServerIds() ：本轮允许 spawn 的 server（没启用对应 Skill 就不给工具）
 *   - promptAddon()      ：拼进实用 Agent 的 systemHint，传达 ta 的偏好
 */
import {
  promptAddonForEnabledSkills,
  serversForEnabledSkills
} from '@echopet/agent-core'
import { SkillRepo } from '../db/repo-skills'
import type { DB } from '../db/connection'

export interface SkillView {
  id: string
  name: string
  enabled: boolean
  servers: string[]
  promptAddon: string
}

export class SkillManager {
  private readonly repo: SkillRepo

  constructor(db: DB) {
    this.repo = new SkillRepo(db)
  }

  list(): SkillView[] {
    return this.repo.all().map((s) => ({
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      servers: s.includedServers,
      promptAddon: s.promptAddon
    }))
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return this.repo.setEnabled(id, enabled)
  }

  /** 当前启用的 Skill 解析出的 server id 并集（chat:send 据此门控可用工具）。 */
  enabledServerIds(): string[] {
    return serversForEnabledSkills(this.repo.enabledIds())
  }

  /** 当前启用 Skill 的 prompt 偏好增补（拼进 system prompt）。 */
  promptAddon(): string {
    return promptAddonForEnabledSkills(this.repo.enabledIds())
  }
}
