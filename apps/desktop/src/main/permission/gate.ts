/**
 * 权限闸（W4 D2）—— 工具调用前的放行 / 需审批判定
 *
 * D2：只接判定 + 落地授权，**不接审批 UI**（D3 接）。当前无 grant 时 write/exec/network
 * 一律 needs-approval，调用方据此 auto-deny，用来验证闸门本身工作正常（read 透传）。
 *
 * 判定纯逻辑在 agent-core/permission；本层桥接 GrantStore（持有授权）+ 目标提取。
 */
import {
  evaluatePermission,
  type GrantGrade,
  type PermissionDecision,
  type PermissionRequest
} from '@echopet/agent-core'
import { GrantStore } from './grantStore'
import type { DB } from '../db/connection'

export class PermissionGate {
  readonly store: GrantStore

  constructor(db: DB) {
    this.store = new GrantStore(db)
  }

  check(req: PermissionRequest, now: number = Date.now()): PermissionDecision {
    return evaluatePermission(req, this.store.activeGrants(now), now)
  }

  /** 用户审批后落地授权（once/deny 不留痕）。 */
  grant(req: PermissionRequest, grade: GrantGrade, now: number = Date.now()): void {
    this.store.apply(req, grade, now)
  }
}

/**
 * 从工具入参里抽出「目标」字符串，用于 grant 匹配 + 审批文案 + 审计。
 * 覆盖 filesystem / git 等常见 server 的路径类字段；取不到时返回空串（只按 scope 匹配）。
 */
export function extractTarget(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const o = args as Record<string, unknown>
  const candidates = [
    'path',
    'file_path',
    'filepath',
    'source',
    'destination',
    'directory',
    'dir',
    'repo_path',
    'cwd'
  ]
  for (const key of candidates) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  // filesystem 的多路径入参
  const paths = o.paths
  if (Array.isArray(paths) && typeof paths[0] === 'string') return paths[0]
  return ''
}
