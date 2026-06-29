/**
 * SystemAgent 的进程内工具（W4 D6）
 *
 * 剪贴板 / 系统通知只能在 Electron 主进程里直接调，没法塞进独立 stdio 子进程，
 * 所以走 mcp-host 的「local server」：每个工具就是一个内联 handler。
 *
 * scope：read_clipboard 透传；write_clipboard / send_notification 视为 write → 走审批。
 */
import { Notification, clipboard } from 'electron'
import type { LocalServerConfig, LocalToolDef } from '@echopet/mcp-host'

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

const TOOLS: LocalToolDef[] = [
  {
    name: 'read_clipboard',
    description: '读取系统剪贴板当前的文本内容',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const text = clipboard.readText()
      return text.trim() ? text : '(剪贴板现在是空的)'
    }
  },
  {
    name: 'write_clipboard',
    description: '把一段文本写入系统剪贴板',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要写入剪贴板的文本' } },
      required: ['text'],
      additionalProperties: false
    },
    handler: (args) => {
      const text = asString(args.text)
      if (!text) throw new Error('没有要写入的文本')
      clipboard.writeText(text)
      return `已经把这段内容放到剪贴板啦（${text.length} 个字）`
    }
  },
  {
    name: 'send_notification',
    description: '发一条系统通知/提醒',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '通知标题（可选）' },
        body: { type: 'string', description: '通知正文' }
      },
      required: ['body'],
      additionalProperties: false
    },
    handler: (args) => {
      const body = asString(args.body)
      if (!body) throw new Error('通知内容不能为空')
      if (!Notification.isSupported()) {
        throw new Error('当前系统不支持桌面通知')
      }
      const title = asString(args.title) || '小桃提醒'
      new Notification({ title, body }).show()
      return `叮——已经弹了条通知：「${title}」`
    }
  }
]

export function buildSystemServerConfig(): LocalServerConfig {
  return { id: 'system', tools: TOOLS }
}
