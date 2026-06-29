/**
 * 权限授权 repo —— permission_grants（W4 D1）
 *
 * 只存「永久」授权；一次性不落库、会话级在内存层（PermissionGate.grantStore）。
 * 行形状（snake_case）↔ agent-core PermissionGrant（camelCase）互转。
 */
import type { PermissionGrant, ToolScope } from '@echopet/agent-core'
import type { DB } from './connection'

interface GrantRow {
  id: number
  scope: string
  target_pattern: string
  agent_name: string | null
  server_id: string | null
  granted_at: number
  expires_at: number | null
  revoked_at: number | null
}

/** 带库内自增主键的 grant（撤销时按 id 操作） */
export interface StoredGrant extends PermissionGrant {
  id: number
}

function rowToGrant(row: GrantRow): StoredGrant {
  return {
    id: row.id,
    scope: row.scope as ToolScope,
    targetPattern: row.target_pattern,
    agentName: row.agent_name ?? undefined,
    serverId: row.server_id ?? undefined,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  }
}

export class GrantRepo {
  constructor(private readonly db: DB) {}

  /** 写入一条永久授权，返回库内 id。 */
  insert(grant: PermissionGrant): number {
    const info = this.db
      .prepare(
        `INSERT INTO permission_grants (
           scope, target_pattern, agent_name, server_id, granted_at, expires_at, revoked_at
         ) VALUES (@scope, @target, @agent, @server, @granted, @expires, @revoked)`
      )
      .run({
        scope: grant.scope,
        target: grant.targetPattern,
        agent: grant.agentName ?? null,
        server: grant.serverId ?? null,
        granted: grant.grantedAt,
        expires: grant.expiresAt ?? null,
        revoked: grant.revokedAt ?? null
      })
    return Number(info.lastInsertRowid)
  }

  /** 仍有效（未撤销 + 未过期）的授权，供 PermissionGate 启动时载入缓存。 */
  listActive(now: number): StoredGrant[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM permission_grants
          WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > @now)
          ORDER BY granted_at DESC`
      )
      .all({ now }) as GrantRow[]
    return rows.map(rowToGrant)
  }

  /** 全部授权（含已撤销/过期），供 Permissions tab 展示。 */
  listAll(): StoredGrant[] {
    const rows = this.db
      .prepare(`SELECT * FROM permission_grants ORDER BY granted_at DESC`)
      .all() as GrantRow[]
    return rows.map(rowToGrant)
  }

  /** 撤销一条；返回是否命中（仅撤销尚未撤销的行）。 */
  revoke(id: number, now: number): boolean {
    const info = this.db
      .prepare(
        `UPDATE permission_grants SET revoked_at = @now WHERE id = @id AND revoked_at IS NULL`
      )
      .run({ id, now })
    return info.changes > 0
  }

  /** 一键撤销所有未撤销授权（PRD §8.1「撤销所有权限」），返回撤销条数。 */
  revokeAll(now: number): number {
    const info = this.db
      .prepare(`UPDATE permission_grants SET revoked_at = @now WHERE revoked_at IS NULL`)
      .run({ now })
    return info.changes
  }
}
