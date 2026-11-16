#!/usr/bin/env node
/**
 * 生成 DSH 插件市场的 index.json（format 1），并用 DSH 自带的校验器验证。
 *
 * 用法（在 DSH 里执行时 DSH_INSTALL_DIR 已就绪）：
 *   node market/build-index.mjs --git-url https://github.com/你/仓库 --commit <40位sha>
 *   node market/build-index.mjs --npm --version 1.2.0        # 走 npm 发布时
 *   node market/build-index.mjs --help
 *
 * 校验器从 $DSH_INSTALL_DIR 里找；找不到就只生成、跳过校验并提示。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
// 图标内联成 data: URL：index 不依赖额外托管，校验也一定过
const iconData = `data:image/svg+xml;base64,${readFileSync(join(here, '..', 'icon.svg')).toString('base64')}`

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(`生成插件市场 index.json

  --name <包名>          默认取 package.json 的 name
  --version <版本>       默认取 package.json 的 version
  --git-url <仓库地址>    https 的仓库地址，如 https://github.com/you/dsh-turtle-soup
  --commit <sha>         必填（git 模式）：40 位小写 commit
  --path <目录>          包在仓库里的相对目录，默认 dsh-turtle-soup
  --npm                  走 npm 模式，source 为 {type:'npm'}
  --registry <地址>      npm 模式下的自定义 registry
  --timestamp <秒>       发布时间戳，默认现在
  --title-zh / --title-en / --desc-zh / --desc-en / --author / --homepage / --icon
  --out <文件>           默认 market/index.json
`)
  process.exit(0)
}

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const has = (name) => args.includes(`--${name}`)

const name = flag('name', pkg.name)
const version = flag('version', pkg.version)
const out = resolve(here, flag('out', 'index.json'))
const engines = pkg.engines?.dsh ? { dsh: pkg.engines.dsh } : {}
const timestamp = Number(flag('timestamp', String(Math.floor(Date.now() / 1000))))

const source = has('npm')
  ? { type: 'npm', ...(flag('registry') ? { registry: flag('registry') } : {}) }
  : (() => {
      const url = flag('git-url')
      const commit = flag('commit')
      if (!url || !commit) {
        console.error('git 模式需要 --git-url 和 --commit；走 npm 就加 --npm')
        process.exit(1)
      }
      return {
        type: 'git',
        url: url.replace(/\.git$/, ''),
        commit,
        path: flag('path', 'dsh-turtle-soup'),
      }
    })()

const index = {
  format: 1,
  title: { en: flag('title-en', 'Turtle soup bank'), zh: flag('title-zh', '海龟汤题库') },
  description: {
    en: flag('desc-en', 'Play turtle-soup puzzles, keep your own bank, and review submissions.'),
    zh: flag('desc-zh', '玩海龟汤、维护自己的题库、审核别人投的题。'),
  },
  metadata: {
    categories: { game: { title: { en: 'Games', zh: '游戏' } } },
    labels: {},
    sortKeys: {},
  },
  plugins: [
    {
      name,
      title: { en: flag('title-en', 'Turtle soup bank'), zh: flag('title-zh', '海龟汤题库') },
      description: {
        en: flag('desc-en', 'Play turtle-soup puzzles, keep your own bank, and review submissions.'),
        zh: flag('desc-zh', '玩海龟汤、维护自己的题库、审核别人提交的题。'),
      },
      icon: flag('icon', iconData),
      author: flag('author', pkg.author ?? ''),
      ...(flag('homepage', pkg.homepage) ? { homepage: flag('homepage', pkg.homepage) } : {}),
      repository: { url: pkg.repository.url.replace(/\.git$/, ''), directory: pkg.repository.directory },
      metadata: {
        category: 'game',
        keywords: pkg.keywords ?? [],
        labels: [],
        sortKeys: {},
      },
      versions: [{ version, publishTimestamp: timestamp, source, engines }],
    },
  ],
}

// 用 DSH 自带的校验器验一遍
let validator = null
const installDir = process.env.DSH_INSTALL_DIR
if (installDir) {
  const candidate = join(installDir, '..', 'dsh-plugin-market-index', 'lib', 'index.js')
  try {
    validator = await import(pathToFileURL(candidate).href)
  } catch (err) {
    console.warn(`[warn] 没能加载 DSH 校验器：${err.message}`)
  }
} else {
  console.warn('[warn] 没有 DSH_INSTALL_DIR，跳过校验')
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`, 'utf8')

if (validator) {
  try {
    const indexUrl = flag('index-url', 'https://example.com/index.json')
    const parsed = validator.parseMarketIndex(index, indexUrl)
    const spec = validator.marketInstallTarget(parsed.plugins[0].name, parsed.plugins[0].versions[0])
    console.log('✔ 通过 format 1 校验')
    console.log('  包名  :', parsed.plugins[0].name)
    console.log('  版本  :', parsed.plugins[0].versions[0].version)
    console.log('  安装串:', spec.spec)
    if (spec.registry) console.log('  registry:', spec.registry)
  } catch (err) {
    console.error('✘ 校验失败：', err.message)
    process.exit(1)
  }
}
console.log('已写入', out)
