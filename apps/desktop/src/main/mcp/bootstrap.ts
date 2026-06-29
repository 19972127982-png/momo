/**
 * MCP host 引导（W3 D6 / W4 D4）
 *
 * 懒启动：第一次路由判到「实用模式」时才创建 host；具体 server 再按命中的 Agent 按需 spawn
 * （FileAgent → filesystem，DevAgent → git），避免拖慢启动 + 没装运行时也能正常陪聊。
 *
 * scope 按工具名推断：read 类透传、write_file / git commit 等触发权限审批。
 *
 * 失败容忍：server spawn 失败（如没装 uvx）记到 failedServers 不再重试，chat 层据「哪些 server
 * 就绪」决定走实用还是降级提示。
 */
import { McpHost } from '@echopet/mcp-host'
import {
  BUILTIN_SERVERS,
  desktopDir as registryDesktopDir,
  getServerDef,
  type BuiltinServerId
} from './serverRegistry'

let host: McpHost | null = null
const failedServers = new Set<BuiltinServerId>()

/** 桌面目录（白名单根）—— 转发自 serverRegistry，兼容既有 import 路径 */
export function desktopDir(): string {
  return registryDesktopDir()
}

/** 拿到 host 单例（不 spawn 任何 server，纯创建对象，不会失败）。 */
export async function getMcpHost(): Promise<McpHost> {
  if (!host) host = new McpHost()
  return host
}

/**
 * 确保给定 server 已启动。返回最终就绪的 id 列表（失败的被跳过）。
 * 已注册的直接跳过；曾失败的（failedServers）也跳过，避免每条消息都重试慢启动。
 */
export async function ensureServers(
  ids: readonly BuiltinServerId[]
): Promise<BuiltinServerId[]> {
  const h = await getMcpHost()
  const ready: BuiltinServerId[] = []
  for (const id of ids) {
    if (h.isRegistered(id)) {
      ready.push(id)
      continue
    }
    if (failedServers.has(id)) continue
    const def = getServerDef(id)
    if (!def) continue
    try {
      await h.register(def.buildConfig())
      ready.push(id)
    } catch (err) {
      failedServers.add(id)
      console.error(`[mcp] server「${def.label}」启动失败：`, (err as Error).message)
    }
  }
  return ready
}

/** 某 server 是否处于「曾尝试但失败」状态（chat 层做降级文案用）。 */
export function serverFailed(id: BuiltinServerId): boolean {
  return failedServers.has(id)
}

/** 内置 server 元信息（Tools tab / 降级提示用） */
export { BUILTIN_SERVERS }

export async function closeMcpHost(): Promise<void> {
  if (host) {
    const h = host
    host = null
    failedServers.clear()
    await h.close().catch(() => {})
  }
}
