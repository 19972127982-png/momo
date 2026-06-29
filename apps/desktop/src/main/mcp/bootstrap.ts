/**
 * MCP host 引导（W3 D6）
 *
 * 懒启动：第一次路由判到「实用模式」时才 spawn MCP server（避免拖慢应用启动 + 没 npx 也能正常陪聊）。
 * W3 只挂一个 filesystem server，白名单限制在用户「桌面」目录（只读用法）。
 *
 * 失败容忍：启动失败返回 null，chat handler 会降级为「我现在还查不了文件」之类的友好提示。
 */
import { app } from 'electron'
import { McpHost } from '@echopet/mcp-host'

let host: McpHost | null = null
let starting: Promise<McpHost | null> | null = null

/** 桌面目录（白名单根） */
export function desktopDir(): string {
  return app.getPath('desktop')
}

/** 拿到已就绪的 host；首次调用会 spawn filesystem server。失败返回 null。 */
export async function getMcpHost(): Promise<McpHost | null> {
  if (host) return host
  if (starting) return starting

  starting = (async () => {
    const h = new McpHost()
    try {
      await h.register({
        id: 'filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', desktopDir()],
        defaultScope: 'read'
      })
      host = h
      return host
    } catch (err) {
      console.error('[mcp] filesystem server 启动失败：', (err as Error).message)
      await h.close().catch(() => {})
      return null
    } finally {
      starting = null
    }
  })()

  return starting
}

export async function closeMcpHost(): Promise<void> {
  if (host) {
    const h = host
    host = null
    await h.close().catch(() => {})
  }
}
