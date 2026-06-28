/**
 * 用 Electron `safeStorage` 把 DeepSeek API Key 加密落盘到 userData。
 *
 * - macOS：底层是 Keychain Service；Windows：DPAPI；Linux：libsecret / gnome-keyring。
 * - encryptString 返回 Buffer，落地后是不可读密文，跨用户 / 跨机器都解不开。
 * - `safeStorage.isEncryptionAvailable()` 在 Linux 上某些 headless 环境会返回 false，
 *   这种情况我们退化为「内存里临时持有，重启就丢」并向上报错让 UI 提示用户。
 */

import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/ipcTypes'

const FILENAME = 'config.enc'
const SETTINGS_FILENAME = 'settings.json'

function configPath(): string {
  return path.join(app.getPath('userData'), FILENAME)
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

/**
 * encryptionAvailable=false 时（Linux 无 keyring 等）的内存回退 key。
 * UI 上会提示「重启会丢失」，符合不强制磁盘加密的设计。
 */
let memOnlyApiKey: string | null = null

export async function loadApiKey(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) {
    return memOnlyApiKey
  }
  try {
    const buf = await fs.readFile(configPath())
    const decrypted = safeStorage.decryptString(buf)
    return decrypted.trim() || null
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
  if (!safeStorage.isEncryptionAvailable()) {
    // 内存回退：本会话有效，重启丢失（UI 已警告用户）
    memOnlyApiKey = trimmed
    return
  }
  const enc = safeStorage.encryptString(trimmed)
  await atomicWrite(configPath(), enc)
}

export async function clearApiKey(): Promise<void> {
  memOnlyApiKey = null
  try {
    await fs.unlink(configPath())
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
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
