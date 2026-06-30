/**
 * DeepSeek API Key 的本地存储。
 *
 * 为什么不用 `safeStorage`（Keychain）：
 *   safeStorage 在 macOS 底层走 Keychain，授权绑定到 app 的代码签名。未签名 /
 *   ad-hoc 分发的 app 没有稳定签名身份，导致每次启动都弹「输入登录钥匙串密码」，
 *   严重影响「拿到就能用」。这里改为落盘到 userData 下的本地文件：
 *     - base64 轻混淆（防一眼瞄到，不是强加密）
 *     - chmod 0600，仅当前用户可读写
 *   key 只存在用户自己机器的私有目录里（性质同 ~/.npmrc / ~/.aws/credentials）。
 *   将来若接入 Apple Developer ID 签名+公证，可再切回 safeStorage。
 */

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/ipcTypes'

const KEY_FILENAME = 'apikey.dat'
const LEGACY_ENC_FILENAME = 'config.enc'
const SETTINGS_FILENAME = 'settings.json'

function keyPath(): string {
  return path.join(app.getPath('userData'), KEY_FILENAME)
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILENAME)
}

/**
 * 原子写：先写到 `.tmp.<pid>` 再 rename。
 * - rename 在同一文件系统内是原子的，能保证读端永远拿到完整文件
 * - 防 crash 中途写半截：旧文件保留，新文件作废
 */
async function atomicWrite(filePath: string, data: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp.${process.pid}`
  try {
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, filePath)
  } catch (err) {
    try {
      await fs.unlink(tmp)
    } catch {
      /* tmp may not exist */
    }
    throw err
  }
}

export async function loadApiKey(): Promise<string | null> {
  try {
    const text = await fs.readFile(keyPath(), 'utf-8')
    const decoded = Buffer.from(text.trim(), 'base64').toString('utf-8')
    return decoded.trim() || null
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[configStore] failed to load api key:', err)
    }
    return null
  }
}

export async function saveApiKey(key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('API Key 不能为空')
  const encoded = Buffer.from(trimmed, 'utf-8').toString('base64')
  await atomicWrite(keyPath(), encoded)
  // 收紧权限：仅当前用户可读写（best-effort，失败不影响功能）
  try {
    await fs.chmod(keyPath(), 0o600)
  } catch {
    /* 某些文件系统不支持 chmod，忽略 */
  }
}

export async function clearApiKey(): Promise<void> {
  // 一并清掉旧版 safeStorage 密文文件，避免残留
  const targets = [keyPath(), path.join(app.getPath('userData'), LEGACY_ENC_FILENAME)]
  for (const f of targets) {
    try {
      await fs.unlink(f)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw err
    }
  }
}

/**
 * 应用设置（非密文）：宠物名字 / 用户称呼。
 * 用普通 JSON 落盘，不走 safeStorage —— 这些字段不敏感，
 * 普通 JSON 可读、可手动编辑，便于调试。
 */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const text = await fs.readFile(settingsPath(), 'utf-8')
    const obj = JSON.parse(text) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...obj }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[configStore] failed to load settings:', err)
    }
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings()
  const next: AppSettings = { ...current, ...patch }
  await atomicWrite(settingsPath(), JSON.stringify(next, null, 2))
  return next
}
