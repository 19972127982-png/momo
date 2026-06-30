/**
 * 极简内存滑动窗口限流（best-effort）。
 *
 * 说明：serverless 是多实例 + 会冷启动，内存计数无法全局精确——
 * 这只是「挡住单 IP 短时间猛刷」的轻量护栏，配合路由里的硬上限
 *（消息条数 / 单条长度 / max_tokens）一起控成本。要严格全局限流，
 * 后续可换 Upstash Redis，接口保持不变即可。
 */

type Bucket = number[]

const WINDOW_MS = 5 * 60 * 1000 // 5 分钟
const MAX_HITS = 15 // 每 IP 每窗口最多 15 次

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSec: number
}

export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now()
  const cutoff = now - WINDOW_MS
  const hits = (buckets.get(ip) ?? []).filter((t) => t > cutoff)

  if (hits.length >= MAX_HITS) {
    const oldest = hits[0]
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000))
    buckets.set(ip, hits)
    return { ok: false, remaining: 0, retryAfterSec }
  }

  hits.push(now)
  buckets.set(ip, hits)

  // 顺手清理过期 key，避免 Map 无限增长
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      const live = v.filter((t) => t > cutoff)
      if (live.length === 0) buckets.delete(k)
      else buckets.set(k, live)
    }
  }

  return { ok: true, remaining: MAX_HITS - hits.length, retryAfterSec: 0 }
}

export function clientIpFrom(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return headers.get('x-real-ip') ?? '0.0.0.0'
}
