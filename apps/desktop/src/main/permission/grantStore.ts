/**
 * 授权存储（W4 D2）—— 会话内存层 + 永久持久层（permission_grants 表）
 *
 * - 会话授权（grade=session）：进程存活期间有效，存内存，不落库。
 * - 永久授权（grade=forever）：写 permission_grants 表 + 进内存缓存。
 * - 启动时从表载入仍有效的永久授权进缓存，避免每次查库。
 *
 * 纯匹配逻辑全在 agent-core/permission；本层只管「持有 + 增删 + 提供当前有效集合」。
 */
import {
  buildGrantFromDecision,
  grantIsActive,
  type GrantGrade,
  type PermissionGrant,
  type PermissionRequest
} from '@echopet/agent-core'
import { GrantRepo } from '../db/repo-grants'
import type { DB } from '../db/connection'

export class GrantStore {
  private readonly repo: GrantRepo
  private session: PermissionGrant[] = []
  private persistent: PermissionGrant[]

  constructor(db: DB, now: number = Date.now()) {
    this.repo = new GrantRepo(db)
    this.persistent = this.repo.listActive(now)
  }

  /** 当前仍有效的授权（会话 + 永久），喂给 agent-core evaluatePermission。 */
  activeGrants(now: number = Date.now()): PermissionGrant[] {
    return [...this.session, ...this.persistent].filter((g) => grantIsActive(g, now))
  }

  /**
   * 按用户选择落地授权。once/deny 不留痕（返回 null）。
   * session → 内存；forever → 表 + 缓存。
   */
  apply(req: PermissionRequest, grade: GrantGrade, now: number = Date.now()): void {
    const grant = buildGrantFromDecision(req, grade, now)
    if (!grant) return
    if (grade === 'session') {
      this.session.push(grant)
    } else if (grade === 'forever') {
      this.repo.insert(grant)
      this.persistent.push(grant)
    }
  }

  /** Permissions tab：列全部永久授权（含已撤销/过期）。 */
  listPersistent(): ReturnType<GrantRepo['listAll']> {
    return this.repo.listAll()
  }

  /** 撤销一条永久授权 + 刷新缓存。 */
  revoke(id: number, now: number = Date.now()): boolean {
    const ok = this.repo.revoke(id, now)
    if (ok) this.persistent = this.repo.listActive(now)
    return ok
  }

  /** 一键撤销所有永久授权 + 清会话授权。 */
  revokeAll(now: number = Date.now()): number {
    const n = this.repo.revokeAll(now)
    this.persistent = this.repo.listActive(now)
    this.session = []
    return n
  }
}
