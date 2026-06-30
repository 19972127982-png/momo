import { NextRequest } from 'next/server'
import { WEB_COMPANION_SYSTEM_PROMPT } from '@/lib/companion-prompt'
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---- 硬上限：控成本 + 防滥用 ----
const MAX_HISTORY = 12 // 只取最近 N 条
const MAX_CHARS_PER_MSG = 500 // 单条消息字符上限
const MAX_TOTAL_CHARS = 4000 // 全部输入字符上限
const MAX_TOKENS = 240 // 回复 token 上限（陪聊本就该短）

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

interface InMsg {
  role: 'user' | 'assistant'
  content: string
}

function sanitize(raw: unknown): InMsg[] | null {
  if (!Array.isArray(raw)) return null
  const out: InMsg[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    const trimmed = content.trim().slice(0, MAX_CHARS_PER_MSG)
    if (trimmed) out.push({ role, content: trimmed })
  }
  const recent = out.slice(-MAX_HISTORY)
  const total = recent.reduce((n, m) => n + m.content.length, 0)
  if (recent.length === 0 || total > MAX_TOTAL_CHARS) return null
  return recent
}

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

export async function POST(req: NextRequest): Promise<Response> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return err(503, '服务暂未配置（缺少 DEEPSEEK_API_KEY）')
  }

  const ip = clientIpFrom(req.headers)
  const rl = checkRateLimit(ip)
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: '聊得有点急，歇会儿再来找 EchoPet 吧～' }), {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(rl.retryAfterSec)
      }
    })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return err(400, '请求格式不对')
  }

  const messages = sanitize((body as { messages?: unknown })?.messages)
  if (!messages) return err(400, '消息太长或为空')

  const upstream = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      stream: true,
      temperature: 1.1,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'system', content: WEB_COMPANION_SYSTEM_PROMPT }, ...messages]
    })
  }).catch(() => null)

  if (!upstream || !upstream.ok || !upstream.body) {
    return err(502, 'EchoPet 走神了，稍后再试试～')
  }

  // 把 DeepSeek 的 SSE 流解析出 delta.content，转成纯文本块吐给前端
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') {
          controller.close()
          return
        }
        try {
          const json = JSON.parse(data)
          const delta: string | undefined = json?.choices?.[0]?.delta?.content
          if (delta) controller.enqueue(encoder.encode(delta))
        } catch {
          /* 跳过半截 / 非 JSON 行 */
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {})
    }
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no'
    }
  })
}
