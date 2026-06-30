/**
 * electron-builder afterPack 钩子：对 macOS 产物做 ad-hoc 签名。
 *
 * 为什么需要：没有 Apple 开发者证书时，electron-builder 会「跳过签名」，
 * 于是 .app 沿用 Electron 自带的 ad-hoc 签名；但打包过程往 bundle 里塞了
 * asar / 资源，破坏了那份签名。Apple Silicon 上签名无效的 app 会直接「已损坏 /
 * 打不开」。这里在打 DMG 之前用 `codesign -s -` 重新做一份有效的 ad-hoc 签名。
 *
 * 注意：这仍是未签名（非 Developer ID / 未公证）分发，用户首次打开仍需绕过
 * Gatekeeper（右键打开 或 xattr 去 quarantine）。ad-hoc 只保证「能跑」。
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  console.log(`[afterPack] ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  })
  console.log('[afterPack] ad-hoc sign done')
}
