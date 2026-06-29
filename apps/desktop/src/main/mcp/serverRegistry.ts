/**
 * 内置 MCP server 注册表（W4 D4）
 *
 * 声明式描述桌宠内置的 MCP server：怎么启动、归哪个 Agent 用、能力简介。
 * bootstrap 据此「按需 spawn」——某个 Agent 第一次被路由命中时才拉起它的 server。
 *
 * - filesystem（stdio）：FileAgent 用，白名单限定在桌面目录（read 透传 / write 走审批）。
 * - system（local，进程内）：SystemAgent 用，剪贴板 / 通知（只能在主进程直接调）。
 *
 * （DevAgent / git server 暂不做，后续再加。）
 */
import { app } from 'electron'
import type { LocalServerConfig, McpServerConfig } from '@echopet/mcp-host'
import type { UtilityAgentName } from '@echopet/agent-core'
import { buildSystemServerConfig } from './systemTools'

export type BuiltinServerId = 'filesystem' | 'system'

interface BaseServerDef {
  id: BuiltinServerId
  label: string
  /** 用到该 server 的 Agent */
  agent: UtilityAgentName
  /** 能力一句话简介（Tools tab / 降级提示用） */
  capability: string
}

export interface StdioServerDef extends BaseServerDef {
  kind: 'stdio'
  /** 运行时构造启动配置（路径等延迟解析） */
  buildConfig: () => McpServerConfig
}

export interface LocalServerDef extends BaseServerDef {
  kind: 'local'
  /** 运行时构造进程内工具集 */
  buildLocal: () => LocalServerConfig
}

export type BuiltinServerDef = StdioServerDef | LocalServerDef

/** 桌面目录（filesystem 白名单根） */
export function desktopDir(): string {
  return app.getPath('desktop')
}

export const BUILTIN_SERVERS: readonly BuiltinServerDef[] = [
  {
    id: 'filesystem',
    kind: 'stdio',
    label: '文件系统（桌面）',
    agent: 'FileAgent',
    capability: '查看/读写桌面目录下的文件与文件夹',
    buildConfig: () => ({
      id: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', desktopDir()]
      // 不设 defaultScope —— scopeOf 按工具名推断（read 透传 / write_file 等触发审批）
    })
  },
  {
    id: 'system',
    kind: 'local',
    label: '系统（剪贴板/通知）',
    agent: 'SystemAgent',
    capability: '读写剪贴板、发送系统通知提醒',
    buildLocal: buildSystemServerConfig
  }
]

export function getServerDef(id: BuiltinServerId): BuiltinServerDef | undefined {
  return BUILTIN_SERVERS.find((s) => s.id === id)
}

/** 某个 Agent 需要的 server id 列表 */
export function serversForAgent(agent: UtilityAgentName): BuiltinServerId[] {
  return BUILTIN_SERVERS.filter((s) => s.agent === agent).map((s) => s.id)
}
