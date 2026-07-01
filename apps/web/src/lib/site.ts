/** 站点级常量：品牌、外链、下载地址。集中一处便于改。 */

export const SITE = {
  name: 'EchoPet',
  petName: 'EchoPet',
  tagline: '住在桌面的小伙伴',
  description:
    'EchoPet 是一只住在你电脑桌面上的小伙伴。会陪你聊天，记得你说过的话，还能帮你整理文件、设个提醒——动手前都会先问你一句。',
  url: 'https://echopet.app',
  github: 'https://github.com/19972127982-png/momo',
  releasesLatest: 'https://github.com/19972127982-png/momo/releases/latest',
  // macOS（Apple Silicon）直链 dmg；升级版本后同步改这里的文件名
  downloadMac:
    'https://github.com/19972127982-png/momo/releases/download/v0.1.0/EchoPet-0.1.0.dmg',
  // 暂无 Windows 产物，先落到 releases 页
  downloadWin: 'https://github.com/19972127982-png/momo/releases/latest'
} as const
