/**
 * 拖文件总结编排（W3 副线）
 *
 * 判类型 → 读文本 / OCR 图片 → 拼人格总结 prompt → streamDeepSeek 流式。
 * 通过 emit 回调把结果发出去（main/index.ts 接到 chat:chunk/chat:end/chat:error），
 * 复用现有气泡渲染。不直接依赖 electron，便于单测/复用。
 */
import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import {
  classifyDroppedFile,
  truncateForSummary,
  buildFileSummaryMessages,
  emptyImageTextReply,
  unsupportedFileReply
} from '@echopet/agent-core'
import { streamDeepSeek } from '../llm'
import { ocrImage } from './ocr'

/** 文本文件最多读取的字节数（防超大文件爆内存；之后还会按字符截断） */
const MAX_READ_BYTES = 2_000_000

export interface SummaryEmitter {
  chunk: (text: string) => void
  end: () => void
  error: (msg: string) => void
}

export interface SummarizeFileOptions {
  filePath: string
  settings: { petName: string; userNickname: string }
  apiKey: string
  signal: AbortSignal
  emit: SummaryEmitter
}

/** 把一段完整文本当作「一次性回复」发出去（非 LLM 路径：不支持类型 / 空 OCR） */
function emitWholeReply(emit: SummaryEmitter, text: string): void {
  emit.chunk(text)
  emit.end()
}

async function readTextHead(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath)
  if (stat.size <= MAX_READ_BYTES) {
    return fs.readFile(filePath, 'utf8')
  }
  const fd = await fs.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(MAX_READ_BYTES)
    const { bytesRead } = await fd.read(buf, 0, MAX_READ_BYTES, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fd.close()
  }
}

export async function summarizeFile(opts: SummarizeFileOptions): Promise<void> {
  const { filePath, settings, apiKey, signal, emit } = opts
  const personaName = settings.petName || '小桃'
  const userCalling = settings.userNickname?.trim() || undefined
  const filename = basename(filePath)
  const kind = classifyDroppedFile(filename)

  if (kind === 'unsupported') {
    emitWholeReply(emit, unsupportedFileReply(filename))
    return
  }

  // 读内容（文本直接读 / 图片 OCR）
  let rawContent: string
  try {
    if (kind === 'image') {
      rawContent = await ocrImage(filePath)
      if (!rawContent) {
        emitWholeReply(emit, emptyImageTextReply(personaName))
        return
      }
    } else {
      rawContent = await readTextHead(filePath)
      if (!rawContent.trim()) {
        emitWholeReply(emit, `「${filename}」好像是个空文件诶，里面没什么内容～`)
        return
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    emit.error(
      kind === 'image' ? `识别这张图的时候出错了：${detail}` : `读这个文件的时候出错了：${detail}`
    )
    return
  }

  const { text, truncated } = truncateForSummary(rawContent)
  const messages = buildFileSummaryMessages({
    personaName,
    userCalling,
    filename,
    kind,
    content: text,
    truncated
  })

  await streamDeepSeek(
    messages,
    apiKey,
    {
      onChunk: (t) => emit.chunk(t),
      onEnd: () => emit.end(),
      onError: (e) => emit.error(e)
    },
    signal,
    { temperature: 0.7, maxTokens: 400 }
  )
}
