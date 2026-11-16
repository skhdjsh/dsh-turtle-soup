/**
 * 海龟汤题库（DSH 宿主插件）
 *
 * 装了这个插件的人就是「管理员」：题库、待审投稿都在他的机器上。
 * 别人不需要装插件也能交题——用 `turtle_export` 把题导出成一串投稿码，
 * 发给管理员，管理员 `turtle_submit` 收进待审，`turtle_review` 通过后才进题库。
 *
 * 数据放在 ~/.dsh/turtle-soup/ 下：bank.json / pending.json / stats.json。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 本地版 defineTool：把「属性表 + required:true 标记」的简写编译成 registry 要的原始 JSON Schema，
 * 并做最小参数校验。内联是为了让插件零依赖——本地目录安装时解析不到 dsh 内部包。
 */
function toJsonSchema(node) {
  if (!node || typeof node !== 'object') throw new Error('schema node must be an object')
  const out = {}
  for (const key of ['type', 'enum', 'description', 'minimum', 'maximum']) {
    if (node[key] !== undefined) out[key] = node[key]
  }
  if (node.type === 'object') {
    const required = []
    out.properties = {}
    for (const [key, value] of Object.entries(node.properties ?? {})) {
      const child = { ...value }
      if (child.required === true) {
        required.push(key)
        delete child.required
      }
      out.properties[key] = toJsonSchema(child)
    }
    if (required.length) out.required = required
    out.additionalProperties = node.additionalProperties ?? false
  } else if (node.type === 'array') {
    out.items = toJsonSchema(node.items)
  }
  return out
}

function defineTool(options) {
  const parameters = toJsonSchema({ type: 'object', properties: options.parameters ?? {} })
  const outputSchema = toJsonSchema(options.output.schema)
  const render = options.output.render
  const execute = options.execute
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: outputSchema,
      render: (args, value) => render(args, value),
    },
    async execute(args, exec) {
      return execute(args, exec)
    },
  }
}

export const name = 'turtle-soup'
export const inject = ['tools']

const SOUPS = ['清汤', '红汤', '黑汤']
const STYLES = ['本格', '变格']
const MAX_FACE = 1500
const MAX_TRUTH = 3000
const MAX_HINTS = 3
const CODE_PREFIX = 'TS1.'

const SEED = [
  ['海边的海龟汤', '红汤', '本格', 4,
    '一个男人走进海边的餐厅，点了一碗海龟汤。只喝了一口，他就放下勺子，回家自杀了。',
    '很多年前他和同伴海难漂流，同伴端来一碗「海龟汤」救了他。今天他喝到真正的海龟汤，发现味道完全不对——当年那碗，是同伴杀了另一个同伴做的。',
    ['他不是觉得汤难喝。']],
  ['葬礼上的男人', '红汤', '本格', 3,
    '一个女孩在母亲的葬礼上遇见一个陌生的男人，一见钟情。回家后她杀死了自己的姐姐。',
    '她觉得那个男人还会出现在葬礼上，所以她想再办一场葬礼。',
    ['她想再见到那个男人，而她想出的办法只有一种。']],
  ['十楼', '清汤', '本格', 2,
    '一个人住在十楼。每天回家他都坐电梯到七楼，再走楼梯上十楼。下雨天他会直接坐到十楼。',
    '他个子很矮，只够得到七楼的按钮。下雨天他带着伞，可以用伞尖按到十楼。',
    ['和他的身体有关，也和下雨天多出来的那样东西有关。']],
  ['沙漠里的半根火柴', '红汤', '本格', 4,
    '沙漠中央躺着一具尸体，赤身裸体，手里攥着半根火柴。周围没有别人的脚印。',
    '他们乘热气球飞越沙漠，气球漏气不断下降，必须减重。大家抽火柴，抽到半根的人得跳下去。',
    ['他不是走过来的。往天上想。']],
  ['水草', '红汤', '本格', 4,
    '一对情侣出海，女孩落水，男孩跳下去救她，只抓到一把水草，没能救上来。多年后他回到这里，一个老人告诉他：这片海里从来没有水草。',
    '他抓到的不是水草，是女孩的头发。是他自己没能把她拉上来——他一直以为的「水草」，就是她。',
    ['老人这句话，让他明白自己当年手里抓的到底是什么。']],
  ['隧道', '红汤', '本格', 3,
    '一个人坐火车，火车开进隧道的时候，他打开车门跳了下去。',
    '他刚做完眼睛手术，医生说这次能看到光。进隧道时一片漆黑，他以为自己还是瞎的，绝望之下跳了车。',
    ['他为什么偏偏挑进隧道的时候跳？']],
  ['手术室', '红汤', '本格', 2,
    '一对母女出了车祸，母亲当场死亡，女儿被送进手术室。主刀医生看了一眼说：我不能给她做手术，她是我女儿。',
    '主刀医生是女孩的另一个母亲——她和死去的母亲是一对。',
    ['医生不是父亲。']],
  ['擦墙', '清汤', '本格', 3,
    '一个人每天早上七点准时醒来，然后走到墙边，用手擦那面墙。',
    '他坐了二十年牢，那面墙以前是窗户。他习惯了每天早上擦窗户上的雾。',
    ['他在一个没有窗户的地方。']],
  ['关灯', '红汤', '本格', 3,
    '一个女人接了一个电话，挂掉之后，她把家里所有的灯都关了。',
    '她丈夫出海失踪，她每晚都开着灯等他回来。电话是救援队打来的，说找到遗体了。',
    ['这些灯原来是开给谁看的？']],
  ['镜子', '黑汤', '变格', 4,
    '她每天早上对着镜子梳头，镜子里的她总要慢半拍才抬手。',
    '镜子里映的是她死去的双胞胎姐姐。姐姐当年替她挡下一场车祸，魂魄留在镜子里，一直跟着她，总慢半拍。',
    ['那不是她自己的倒影。']],
  ['阁楼', '红汤', '本格', 3,
    '他住在顶楼，可每天半夜，楼上都会传来脚步声。',
    '他有个残疾的双胞胎弟弟，被他锁在楼顶的夹层里。半夜弟弟挪动身体找吃的。',
    ['楼上确实没有住人。']],
  ['地下通道', '清汤', '本格', 1,
    '他从来不带伞，可下再大的雨，回家时衣服都是干的。',
    '他上下班全程走地下通道，出口直接连到小区车库，一路淋不到雨。',
    ['他走的那段路，天上没有雨。']],
  ['钢琴', '清汤', '变格', 3,
    '他每天晚上都能听见隔壁传来钢琴声，可隔壁已经空了一整年。',
    '隔壁住的是他去世的妻子，她生前每晚弹琴。他没搬走，也一直听得见——只有他一个人听得见。',
    ['只有他一个人听得见。']],
]

function dataDir() {
  const dir = join(homedir(), '.dsh', 'turtle-soup')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 1), 'utf8')
  renameSync(tmp, file)
}

function bankPath() {
  return join(dataDir(), 'bank.json')
}

function pendingPath() {
  return join(dataDir(), 'pending.json')
}

/** 令牌优先从本机私有文件读，避免写进随仓库公开的 cordis.patch.yml。 */
function readTokens() {
  try {
    return JSON.parse(readFileSync(join(dataDir(), 'tokens.json'), 'utf8'))
  } catch {
    return {}
  }
}

function stars(n) {
  const v = Math.max(1, Math.min(5, Number(n) || 3))
  return '★'.repeat(v) + '☆'.repeat(5 - v)
}

function budgetOf(difficulty, config) {
  const base = Number(config?.baseQuestions ?? 10)
  const per = Number(config?.perStarQuestions ?? 6)
  return base + per * Math.max(1, Math.min(5, Number(difficulty) || 3))
}

/** 按难度给提示次数：1 星 1 次，2-3 星 2 次，4-5 星 3 次。 */
function hintsAllowedFor(difficulty) {
  const d = Math.max(1, Math.min(5, Number(difficulty) || 3))
  if (d === 1) return 1
  if (d <= 3) return 2
  return 3
}

const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo))

/**
 * 一局的分数。公式对玩家保密，只对外报分数和段位。
 * 设计目标：难度值钱、推理完整度决定性、省问题/省提示/快有加成，但单项都压不过难度与完整度。
 */
function scoreOf({ stars, completeness, asked, budget, hintsUsed, hintsAllowed,
  seconds, unlimitedQuestions, unlimitedHints }) {
  const d = clamp(1, 5, Number(stars) || 3)
  const D = 1 + 0.25 * (d - 1)                       // 1★1.00 → 5★2.00
  const C = clamp(0.5, 1, Number(completeness))       // 推理完成度（蒙对也算，下限 0.5）
  const Q = unlimitedQuestions
    ? 0.90
    : 0.85 + 0.15 * clamp(0, 1, budget > 0 ? (budget - asked) / budget : 0)
  const H = unlimitedHints ? 0.90 : (hintsAllowed > 0 ? 0.90 + 0.10 * clamp(0, 1, (hintsAllowed - hintsUsed) / hintsAllowed) : 1)
  const timeBudget = 90 + 60 * d                      // 秒：1★ 150 → 5★ 390
  const T = clamp(0.90, 1.08, 1.08 - 0.18 * clamp(0, 1, (Number(seconds) || 0) / timeBudget))
  const score = Math.round(100 * D * C * Q * H * T)
  return {
    score,
    rank: rankOf(score, d, {
      asked, seconds, timeBudget, questionBudget: budget,
      hintsUsed, hintsAllowed, completeness: C, unlimitedQuestions,
    }),
  }
}

/**
 * 段位：五个正式档 + 一堆彩蛋。
 * 彩蛋按优先级判定，只有撞上了才出现，玩家得自己发现。
 */
function rankOf(score, stars, info = {}) {
  const d = Number(stars) || 3
  const asked = Number(info.asked) || 0
  const seconds = Number(info.seconds) || 0
  const tb = Number(info.timeBudget) || 0
  const qb = Number(info.questionBudget) || 0
  const used = Number(info.hintsUsed) || 0
  const allowed = Number(info.hintsAllowed) || 0
  const c = Number(info.completeness) || 0
  const allHints = allowed > 0 && used >= allowed
  const fast = tb > 0 && seconds <= tb * 0.3

  if (d === 5 && score >= 170) return '汤神'                // 5 星 + 够分
  if (d === 4 && score >= 170) return '半步汤神'             // 4 星做到汤神的分
  if (info.unlimitedQuestions === true && asked >= 60) return '永动机' // 不限次数还能问 60 句
  if (asked === 0) return '张嘴就来'                        // 一句没问就猜中
  if (tb > 0 && seconds >= tb * 2) return '文火慢炖'         // 超时一倍还硬推出来
  if (score < 40) return '重在参与'                          // 低分彩蛋：垫底也有名字
  if (c <= 0.5 && allHints && qb > 0 && asked >= qb * 0.9) return '白给' // 蒙对 + 提示用光 + 问满
  if (c <= 0.5 && fast) return '鱼的直觉'                    // 蒙对而且极快
  if (c >= 0.85 && allHints) return '原汤化原食'             // 提示全用光，还是完整推出来了
  if (d === 1 && score >= 95) return '一星神童'              // 1 星题打出接近满分

  if (score >= 120) return '老饕'
  if (score >= 90) return '熟客'
  if (score >= 60) return '新手'
  return '摸鱼'
}

function normalize(raw, author) {
  if (!raw || typeof raw !== 'object') return null
  const title = String(raw.title ?? '').trim()
  const soup = String(raw.soup ?? '').trim()
  const style = String(raw.style ?? '').trim()
  const face = String(raw.face ?? '').trim()
  const truth = String(raw.truth ?? '').trim()
  if (title.length < 2 || title.length > 30) return null
  if (!SOUPS.includes(soup) || !STYLES.includes(style)) return null
  if (face.length < 5 || face.length > MAX_FACE) return null
  if (truth.length < 10 || truth.length > MAX_TRUTH) return null
  const hints = (Array.isArray(raw.hints) ? raw.hints : [])
    .map((h) => String(h).trim())
    .filter(Boolean)
    .slice(0, MAX_HINTS)
  return {
    title,
    soup,
    style,
    difficulty: Math.max(1, Math.min(5, Number(raw.difficulty) || 3)),
    face,
    truth,
    hints,
    author: String(author ?? raw.author ?? '内置').slice(0, 24),
    created: Number(raw.created) || Date.now(),
    updated: Number(raw.updated) || Number(raw.created) || Date.now(),
    ...(raw.deleted === true ? { deleted: true } : {}),
  }
}

function readSeedFile() {
  try {
    const file = new URL('./bank-seed.json', import.meta.url)
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const list = Array.isArray(data) ? data : data?.puzzles
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function seedBank() {
  const fromFile = readSeedFile()
  const puzzles = fromFile.length
    ? fromFile.map((p) => normalize(p, p?.author || '内置')).filter(Boolean)
    : SEED.map(([title, soup, style, difficulty, face, truth, hints]) =>
        normalize({ title, soup, style, difficulty, face, truth, hints }, '内置')).filter(Boolean)
  const data = { version: 2, puzzles }
  writeJson(bankPath(), data)
  return data
}

function loadBank() {
  const data = readJson(bankPath(), null)
  if (!data || !Array.isArray(data.puzzles)) return seedBank()
  return data
}

function activeBank() {
  return loadBank().puzzles.filter((p) => !p.deleted)
}

function loadPending() {
  const data = readJson(pendingPath(), null)
  if (!data || !Array.isArray(data.items)) return { version: 1, items: [] }
  return data
}

function idOf(text) {
  return createHash('sha1').update(String(text)).digest('hex').slice(0, 10)
}

function encodeCode(puzzle) {
  const payload = {
    title: puzzle.title,
    soup: puzzle.soup,
    style: puzzle.style,
    difficulty: puzzle.difficulty,
    face: puzzle.face,
    truth: puzzle.truth,
    hints: puzzle.hints ?? [],
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sum = createHash('sha256').update(body).digest('hex').slice(0, 8)
  return `${CODE_PREFIX}${sum}.${body}`
}

function decodeCode(code) {
  const text = String(code ?? '').trim()
  if (!text.startsWith(CODE_PREFIX)) throw new Error('这不是投稿码（应以 TS1. 开头）')
  const rest = text.slice(CODE_PREFIX.length)
  const dot = rest.indexOf('.')
  if (dot <= 0) throw new Error('投稿码不完整')
  const sum = rest.slice(0, dot)
  const body = rest.slice(dot + 1)
  if (createHash('sha256').update(body).digest('hex').slice(0, 8) !== sum) {
    throw new Error('投稿码校验失败，可能被截断或改过')
  }
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
}

function findByKey(puzzles, key) {
  const k = String(key ?? '').trim()
  if (!k) return null
  const num = /^#?(\d+)$/.exec(k)
  if (num) {
    const i = Number(num[1]) - 1
    return i >= 0 && i < puzzles.length ? { index: i, puzzle: puzzles[i] } : null
  }
  const exact = puzzles.findIndex((p) => p.title === k)
  if (exact >= 0) return { index: exact, puzzle: puzzles[exact] }
  const hits = puzzles.map((p, i) => ({ p, i })).filter((x) => x.p.title.includes(k))
  return hits.length === 1 ? { index: hits[0].i, puzzle: hits[0].p } : null
}

function text(t) {
  return [{ type: 'text', text: t }]
}

export async function apply(ctx, config) {
  const cfg = config ?? {}
  // 后端相关配置：填在 cordis.patch.yml 的 config 里，调用时传参可临时覆盖
  const serverUrl = String(cfg.serverUrl ?? '').trim().replace(/\/+$/, '')
  const submitToken = String(cfg.submitToken ?? '').trim()
  const adminToken = String(cfg.adminToken ?? '').trim()

  const bankTool = defineTool({
    name: 'turtle_bank',
    description: '概览本地海龟汤题库：总数、红黑清与格局的分布、平均难度、待审投稿数量、战绩。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          byKind: { type: 'object', required: true, additionalProperties: true },
          averageDifficulty: { type: 'number', required: true },
          pending: { type: 'integer', required: true },
          played: { type: 'integer', required: true },
          solved: { type: 'integer', required: true },
          bestScore: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text(
        `题库 ${v.total} 道，平均 ${v.averageDifficulty.toFixed(1)} 星；待审投稿 ${v.pending} 条。\n`
        + Object.entries(v.byKind).map(([k, n]) => `${k} ${n}`).join('、') + '\n'
        + `战绩：开局 ${v.played} 次，猜中 ${v.solved} 次`
        + (v.bestScore > 0 ? `，最高分 ${v.bestScore}。` : '。')),
    },
    async execute() {
      const bank = activeBank()
      const pending = loadPending().items.length
      const stats = readJson(join(dataDir(), 'stats.json'), { played: 0, solved: 0 })
      const byKind = {}
      let sum = 0
      for (const p of bank) {
        const key = `${p.soup}·${p.style}`
        byKind[key] = (byKind[key] ?? 0) + 1
        sum += p.difficulty
      }
      const bestScore = Math.max(0, ...(stats.recent ?? []).map((r) => Number(r.score) || 0))
      return {
        total: bank.length,
        byKind,
        averageDifficulty: bank.length ? sum / bank.length : 0,
        pending,
        played: Number(stats.played) || 0,
        solved: Number(stats.solved) || 0,
        bestScore,
      }
    },
  })
  ctx.tools.register(bankTool)

  const listTool = defineTool({
    name: 'turtle_list',
    description: '分页列出题库里的题目：序号、标题、难度星、类型、作者。每页 12 道。',
    parameters: {
      page: { type: 'integer', description: '页码，从 1 开始，默认 1' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page: { type: 'integer', required: true },
          pages: { type: 'integer', required: true },
          total: { type: 'integer', required: true },
          rows: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_a, v) => text(`题库第 ${v.page}/${v.pages} 页，共 ${v.total} 道\n${v.rows.join('\n')}`),
    },
    async execute(args) {
      const bank = activeBank()
      const per = 12
      const page = Math.max(1, Number(args.page) || 1)
      const pages = Math.max(1, Math.ceil(bank.length / per))
      const start = (page - 1) * per
      const rows = bank.slice(start, start + per).map((p, i) =>
        `${start + i + 1}. ${p.title} ${stars(p.difficulty)} ${p.soup}·${p.style}　${p.author}`)
      return { page, pages, total: bank.length, rows }
    },
  })
  ctx.tools.register(listTool)

  ctx.tools.register(defineTool({
    name: 'turtle_get',
    description: '看某道题的汤面、类型、难度、作者、提示条数（不返回汤底，避免剧透）；序号或标题都能查。',
    parameters: {
      key: { type: 'string', required: true, description: '题号（如 3 或 #3）或标题关键词' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          difficulty: { type: 'integer', required: true },
          author: { type: 'string', required: true },
          hints: { type: 'integer', required: true },
          face: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(
        `第 ${v.index} 道《${v.title}》${stars(v.difficulty)} ${v.kind}\n作者：${v.author}，提示 ${v.hints} 条\n汤面：${v.face}`),
    },
    async execute(args) {
      const bank = activeBank()
      const hit = findByKey(bank, args.key)
      if (!hit) throw new Error('没找到这道题，用 turtle_list 看序号')
      const p = hit.puzzle
      return {
        index: hit.index + 1,
        title: p.title,
        kind: `${p.soup}·${p.style}`,
        difficulty: p.difficulty,
        author: p.author ?? '内置',
        hints: (p.hints ?? []).length,
        face: p.face,
      }
    },
  }))

  const drawTool = defineTool({
    name: 'turtle_draw',
    description: '抽一道题开局。可以按红/黑/清汤、本格/变格、难度区间筛选，也可以开局前选不限次数模式。返回汤面和汤底（汤底给主持人看，念出来就剧透了），以及这局的提问上限和提示次数。',
    parameters: {
      soup: { type: 'string', enum: [...SOUPS], description: '汤的类型，不填就随机' },
      style: { type: 'string', enum: [...STYLES], description: '本格或变格，不填就随机' },
      minDifficulty: { type: 'integer', description: '最低星数 1-5' },
      maxDifficulty: { type: 'integer', description: '最高星数 1-5' },
      avoidTitle: { type: 'string', description: '上次抽到的标题，避免连着抽同一道' },
      unlimitedQuestions: { type: 'boolean', description: '不限提问次数模式：这局问多少句都不算超' },
      unlimitedHints: { type: 'boolean', description: '不限提示次数模式：提示可以随便要，题目自带的用完后主持人按汤底现说' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          difficulty: { type: 'integer', required: true },
          budget: { type: 'integer', required: true },
          questionsUnlimited: { type: 'boolean', required: true },
          hintsUnlimited: { type: 'boolean', required: true },
          hintsAllowed: { type: 'integer', required: true },
          face: { type: 'string', required: true },
          truth: { type: 'string', required: true },
          hints: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_a, v) => {
        const q = v.questionsUnlimited ? '提问不限次数' : `最多问 ${v.budget} 句`
        const h = v.hintsUnlimited
          ? `提示不限次数（题目自带 ${v.hints.length} 条，用完后按汤底现说）`
          : `提示最多 ${v.hintsAllowed} 次（题目自带 ${v.hints.length} 条，用完后按汤底现说）`
        return text(
          `《${v.title}》${stars(v.difficulty)} ${v.kind}　${q}　${h}\n`
          + `汤面：${v.face}\n\n`
          + `—— 以下是汤底，主持人看，别念 ——\n${v.truth}`)
      },
    },
    async execute(args) {
      const all = activeBank()
      const min = Number(args.minDifficulty) || 1
      const max = Number(args.maxDifficulty) || 5
      let pool = all.filter((p) => p.difficulty >= min && p.difficulty <= max)
      if (args.soup) pool = pool.filter((p) => p.soup === args.soup)
      if (args.style) pool = pool.filter((p) => p.style === args.style)
      if (!pool.length) throw new Error('没有符合这些条件的题目，放宽松一点')
      let candidates = pool
      if (args.avoidTitle) {
        const rest = pool.filter((p) => p.title !== args.avoidTitle)
        if (rest.length) candidates = rest
      }
      const p = candidates[Math.floor(Math.random() * candidates.length)]
      const stats = readJson(join(dataDir(), 'stats.json'), { played: 0, solved: 0 })
      stats.played = (Number(stats.played) || 0) + 1
      writeJson(join(dataDir(), 'stats.json'), stats)
      const unlimitedQ = args.unlimitedQuestions === true
      const unlimitedH = args.unlimitedHints === true
      const hints = p.hints ?? []
      return {
        title: p.title,
        kind: `${p.soup}·${p.style}`,
        difficulty: p.difficulty,
        budget: unlimitedQ ? 0 : budgetOf(p.difficulty, cfg),
        questionsUnlimited: unlimitedQ,
        hintsUnlimited: unlimitedH,
        hintsAllowed: unlimitedH ? 0 : hintsAllowedFor(p.difficulty),
        face: p.face,
        truth: p.truth,
        hints,
      }
    },
  })
  ctx.tools.register(drawTool)

  ctx.tools.register(defineTool({
    name: 'turtle_add',
    description: '直接往题库里加一道题（管理操作，装插件的人才有）。加完立刻能抽到。',
    parameters: {
      title: { type: 'string', required: true, description: '标题，2-30 字，不能和已有重复' },
      soup: { type: 'string', required: true, enum: [...SOUPS], description: '清汤/红汤/黑汤' },
      style: { type: 'string', required: true, enum: [...STYLES], description: '本格/变格' },
      difficulty: { type: 'integer', required: true, description: '难度 1-5 星' },
      face: { type: 'string', required: true, description: '汤面，5-1500 字' },
      truth: { type: 'string', required: true, description: '汤底，10-3000 字' },
      hints: { type: 'array', items: { type: 'string' }, description: '提示，最多 3 条' },
      author: { type: 'string', description: '作者署名，默认「本机」' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          index: { type: 'integer', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`已入库：《${v.title}》，题库现在 ${v.total} 道。`),
    },
    async execute(args) {
      const bank = loadBank()
      const puzzle = normalize({ ...args, author: args.author || '本机' }, args.author || '本机')
      if (!puzzle) throw new Error('没过校验：检查标题长度、类型、汤面/汤底字数')
      if (bank.puzzles.some((p) => p.title === puzzle.title)) throw new Error('已经有同名题目')
      bank.puzzles.push(puzzle)
      writeJson(bankPath(), bank)
      return { total: bank.puzzles.length, index: bank.puzzles.length, title: puzzle.title }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'turtle_edit',
    description: '改一道已入库的题：标题、汤面、汤底、类型、难度、提示都能改，不用删了重加。改完 updated 会更新，同步时能覆盖别处的旧版。',
    parameters: {
      key: { type: 'string', required: true, description: '要改的题：序号或标题' },
      title: { type: 'string', description: '新标题；不能和别的题重名' },
      soup: { type: 'string', enum: [...SOUPS], description: '新的汤类型' },
      style: { type: 'string', enum: [...STYLES], description: '新的格局' },
      difficulty: { type: 'integer', description: '新的难度 1-5' },
      face: { type: 'string', description: '新的汤面' },
      truth: { type: 'string', description: '新的汤底' },
      hints: { type: 'array', items: { type: 'string' }, description: '替换提示，最多 3 条；传空数组表示清空' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          changed: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_a, v) => text(
        v.changed.length
          ? `改好了：《${v.title}》，动了 ${v.changed.join('、')}。`
          : `《${v.title}》没变（没给要改的字段）。`),
    },
    async execute(args) {
      const bank = loadBank()
      const active = activeBank()
      const hit = findByKey(active, args.key)
      if (!hit) throw new Error('没找到，用 turtle_list 看序号')
      const target = bank.puzzles.find((p) => p.title === hit.puzzle.title)
      const next = { ...target }
      const changed = []
      for (const field of ['title', 'soup', 'style', 'difficulty', 'face', 'truth', 'hints']) {
        if (args[field] !== undefined) {
          next[field] = args[field]
          changed.push(field)
        }
      }
      const q = normalize(next, next.author)
      if (!q) throw new Error('改完没过校验：检查标题长度、类型、汤面/汤底字数')
      if (q.title !== target.title && bank.puzzles.some((p) => p.title === q.title)) {
        throw new Error(`新标题《${q.title}》和已有题目重名`)
      }
      q.created = target.created || q.created
      q.updated = Date.now()
      q.deleted = false
      bank.puzzles[bank.puzzles.indexOf(target)] = q
      writeJson(bankPath(), bank)
      return { title: q.title, changed }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'turtle_delete',
    description: '从题库删掉一道题（管理操作）。用序号或标题指定。',
    parameters: {
      key: { type: 'string', required: true, description: '题号（如 3）或标题' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          total: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text(`删掉了《${v.title}》，还剩 ${v.total} 道。`),
    },
    async execute(args) {
      const bank = loadBank()
      const active = activeBank()
      const hit = findByKey(active, args.key)
      if (!hit) throw new Error('没找到，用 turtle_list 看序号')
      const target = bank.puzzles.find((p) => p.title === hit.puzzle.title)
      target.deleted = true
      target.updated = Date.now()
      writeJson(bankPath(), bank)
      return { title: target.title, total: active.length - 1 }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'turtle_export',
    description: '把一道题导出成投稿码（一串以 TS1. 开头的文本）。发给别人，别人用 turtle_submit 交给你审。',
    parameters: {
      key: { type: 'string', required: true, description: '题号或标题' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          code: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`《${v.title}》的投稿码：\n${v.code}`),
    },
    async execute(args) {
      const hit = findByKey(activeBank(), args.key)
      if (!hit) throw new Error('没找到这道题')
      return { title: hit.puzzle.title, code: encodeCode(hit.puzzle) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'turtle_submit',
    description: '收下一串投稿码，放进待审队列（不会直接进题库）。审稿用 turtle_review。',
    parameters: {
      code: { type: 'string', required: true, description: '别人发来的投稿码，以 TS1. 开头' },
      submitter: { type: 'string', description: '投稿人署名' },
      note: { type: 'string', description: '投稿附言' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          pending: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text(`已收进待审：《${v.title}》（编号 ${v.id}），待审共 ${v.pending} 条。`),
    },
    async execute(args) {
      const raw = decodeCode(args.code)
      const puzzle = normalize(raw, args.submitter || '匿名投稿')
      if (!puzzle) throw new Error('投稿码里的内容没过校验')
      const pending = loadPending()
      if (pending.items.some((it) => it.puzzle.title === puzzle.title)) {
        throw new Error('待审里已经有同名题目了')
      }
      if (activeBank().some((p) => p.title === puzzle.title)) {
        throw new Error('题库里已经有这道题了')
      }
      const item = {
        id: idOf(`${puzzle.title}|${Date.now()}`),
        puzzle,
        submitter: String(args.submitter || '匿名投稿').slice(0, 24),
        note: String(args.note || '').slice(0, 200),
        at: Date.now(),
      }
      pending.items.push(item)
      writeJson(pendingPath(), pending)
      return { id: item.id, title: puzzle.title, pending: pending.items.length }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'turtle_review',
    description: '审投稿：列出待审、通过入库、或驳回。通过后才进题库。',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'view', 'approve', 'reject'], description: 'list 看队列，view 看某条的汤面和汤底，approve 通过，reject 驳回' },
      id: { type: 'string', description: 'approve/reject 时的待审编号或标题' },
      reason: { type: 'string', description: '驳回理由' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          done: { type: 'string', required: true },
          pending: { type: 'integer', required: true },
          total: { type: 'integer', required: true },
          rows: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_a, v) => text(
        `${v.done}\n待审 ${v.pending} 条，题库 ${v.total} 道。`
        + (v.rows.length ? `\n${v.rows.join('\n')}` : '')),
    },
    async execute(args) {
      const pending = loadPending()
      const bank = loadBank()
      const action = args.action
      if (action === 'list') {
        const rows = pending.items.map((it) =>
          `${it.id} 《${it.puzzle.title}》${stars(it.puzzle.difficulty)} ${it.puzzle.soup}·${it.puzzle.style}　by ${it.submitter}`)
        return { done: '待审队列：', pending: pending.items.length, total: bank.puzzles.length, rows }
      }
      if (action === 'view') {
        const key = String(args.id ?? '').trim()
        if (!key) throw new Error('要指定待审编号或标题')
        const it = pending.items.find((x) => x.id === key || x.puzzle.title === key)
        if (!it) throw new Error('待审里没有这条')
        const p = it.puzzle
        return {
          done: `待审 ${it.id}《${p.title}》${stars(p.difficulty)} ${p.soup}·${p.style}　by ${it.submitter}`,
          pending: pending.items.length,
          total: bank.puzzles.length,
          rows: [
            `汤面：${p.face}`,
            `汤底：${p.truth}`,
            `提示：${(p.hints ?? []).length ? p.hints.join(' / ') : '（无）'}`,
            ...(it.note ? [`附言：${it.note}`] : []),
          ],
        }
      }
      const key = String(args.id ?? '').trim()
      if (!key) throw new Error('要指定待审编号或标题')
      const idx = pending.items.findIndex((it) => it.id === key || it.puzzle.title === key)
      if (idx < 0) throw new Error('待审里没有这条')
      const item = pending.items[idx]
      if (action === 'approve') {
        if (bank.puzzles.some((p) => p.title === item.puzzle.title)) {
          pending.items.splice(idx, 1)
          writeJson(pendingPath(), pending)
          throw new Error('题库里已有同名题目，已从待审移除')
        }
        bank.puzzles.push(item.puzzle)
        writeJson(bankPath(), bank)
        pending.items.splice(idx, 1)
        writeJson(pendingPath(), pending)
        return { done: `通过了《${item.puzzle.title}》，已入库。`, pending: pending.items.length, total: bank.puzzles.length, rows: [] }
      }
      pending.items.splice(idx, 1)
      writeJson(pendingPath(), pending)
      return {
        done: `驳回了《${item.puzzle.title}》${args.reason ? `：${args.reason}` : ''}`,
        pending: pending.items.length,
        total: bank.puzzles.length,
        rows: [],
      }
    },
  }))

  const scoreTool = defineTool({
    name: 'turtle_score',
    description: '一局猜中后计分：按难度、推理完成度、剩余提问、剩余提示、用时算一个总分和段位，并把战绩记下来。计分规则对玩家保密——不要解释怎么算的，只报分数、段位和这局的基本数据。',
    parameters: {
      title: { type: 'string', required: true, description: '这局的题目标题，用来查难度' },
      completeness: { type: 'number', required: true, description: '推理完成度 0.5-1：0.5 基本对、0.7 主要对、0.85 很接近、1 完全说中' },
      asked: { type: 'integer', required: true, description: '一共问了几句' },
      budget: { type: 'integer', required: true, description: '这局的提问上限；不限次数模式传 0' },
      hintsUsed: { type: 'integer', required: true, description: '要了几次提示' },
      hintsAllowed: { type: 'integer', required: true, description: '这局的提示次数上限；不限提示模式传 0' },
      seconds: { type: 'integer', required: true, description: '从开局到猜中用了多少秒' },
      unlimitedQuestions: { type: 'boolean', description: '是不是不限提问次数模式' },
      unlimitedHints: { type: 'boolean', description: '是不是不限提示次数模式' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          score: { type: 'integer', required: true },
          rank: { type: 'string', required: true },
          stats: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`本局得分 ${v.score}　段位：${v.rank}\n${v.stats}`),
    },
    async execute(args) {
      const hit = activeBank().find((p) => p.title === String(args.title || '').trim())
      const stars = hit ? hit.difficulty : 3
      const seconds = Math.max(0, Number(args.seconds) || 0)
      const { score, rank } = scoreOf({
        stars,
        completeness: args.completeness,
        asked: Math.max(0, Number(args.asked) || 0),
        budget: Math.max(0, Number(args.budget) || 0),
        hintsUsed: Math.max(0, Number(args.hintsUsed) || 0),
        hintsAllowed: Math.max(0, Number(args.hintsAllowed) || 0),
        seconds,
        unlimitedQuestions: args.unlimitedQuestions === true,
        unlimitedHints: args.unlimitedHints === true,
      })
      const mm = Math.floor(seconds / 60)
      const ss = seconds % 60
      const stats = `问了 ${args.asked} 句、用了 ${args.hintsUsed} 次提示、用时 ${mm} 分 ${ss} 秒`
      const file = join(dataDir(), 'stats.json')
      const saved = readJson(file, { played: 0, solved: 0, recent: [] })
      saved.played = (Number(saved.played) || 0) + 1
      saved.solved = (Number(saved.solved) || 0) + 1
      saved.recent = [...(saved.recent ?? []), {
        title: String(args.title || '').slice(0, 40),
        solved: true,
        asked: Number(args.asked) || 0,
        seconds,
        difficulty: stars,
        score,
        rank,
        at: Date.now(),
      }].slice(-200)
      writeJson(file, saved)
      return { score, rank, stats }
    },
  })
  ctx.tools.register(scoreTool)

  ctx.tools.register(defineTool({
    name: 'turtle_stats',
    description: '记一局战绩（猜中或放弃），写进本地统计。',
    parameters: {
      title: { type: 'string', required: true, description: '这道题的标题' },
      solved: { type: 'boolean', required: true, description: '是否猜中' },
      asked: { type: 'integer', description: '问了几句' },
      seconds: { type: 'integer', description: '用了多少秒' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          played: { type: 'integer', required: true },
          solved: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text(`记下了。共开局 ${v.played} 次，猜中 ${v.solved} 次。`),
    },
    async execute(args) {
      const file = join(dataDir(), 'stats.json')
      const stats = readJson(file, { played: 0, solved: 0, recent: [] })
      stats.played = (Number(stats.played) || 0) + 1
      if (args.solved) stats.solved = (Number(stats.solved) || 0) + 1
      stats.recent = [...(stats.recent ?? []), {
        title: args.title,
        solved: Boolean(args.solved),
        asked: Number(args.asked) || 0,
        seconds: Number(args.seconds) || 0,
        at: Date.now(),
      }].slice(-200)
      writeJson(file, stats)
      return { played: stats.played, solved: stats.solved }
    },
  }))

  // ---------------- 共享：合并 / 同步 / 在线投稿 ----------------

  /** 把远端题库按「标题 + updated」并进本地。远端更新更晚才覆盖，删除以墓碑形式传播。 */
  function mergeRemote(remotePuzzles) {
    const bank = loadBank()
    const localByTitle = new Map(bank.puzzles.map((p) => [p.title, p]))
    let added = 0
    let updated = 0
    let removed = 0
    let skipped = 0
    const conflicts = []
    for (const raw of remotePuzzles) {
      const incoming = normalize(raw, raw?.author ?? '同步')
      if (!incoming) {
        skipped += 1
        continue
      }
      const local = localByTitle.get(incoming.title)
      if (!local) {
        bank.puzzles.push(incoming)
        localByTitle.set(incoming.title, incoming)
        added += 1
        continue
      }
      if (incoming.updated > (local.updated ?? 0)) {
        if (incoming.deleted) removed += 1
        else updated += 1
        Object.assign(local, incoming)
      } else if (incoming.updated < (local.updated ?? 0) && !incoming.deleted) {
        conflicts.push(incoming.title)
      } else {
        skipped += 1
      }
    }
    writeJson(bankPath(), bank)
    return { added, updated, removed, skipped, conflicts: conflicts.slice(0, 10) }
  }

  function parseBankJson(text) {
    let data
    try {
      data = JSON.parse(text)
    } catch (err) {
      throw new Error(`题库内容不是合法 JSON：${err.message}`)
    }
    const list = Array.isArray(data) ? data : data?.puzzles
    if (!Array.isArray(list)) throw new Error('不是题库文件（要 {version,puzzles} 或数组）')
    return list
  }

  async function fetchBank(url) {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`拉取失败：HTTP ${res.status}`)
    return parseBankJson(await res.text())
  }

  function readBankFile(path) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch (err) {
      throw new Error(`读不到这个文件：${err.message}`)
    }
    return parseBankJson(text)
  }

  ctx.tools.register(defineTool({
    name: 'turtle_snapshot',
    description: '把整份本地题库导出成一段 JSON 文本，用来贴到 Gist / GitHub / 网盘，给别人同步。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          json: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`题库快照（${v.count} 道）：\n${v.json}`),
    },
    async execute() {
      const puzzles = loadBank().puzzles
      return {
        count: puzzles.filter((p) => !p.deleted).length,
        json: JSON.stringify({ version: 2, exportedAt: Date.now(), puzzles }, null, 0),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'turtle_sync',
    description: '把别处的一份题库并进本地：给直链就拉取，给本地文件路径就读文件。按标题对齐，远端 updated 更晚才覆盖，删除会传播。返回新增/更新/移除/跳过/冲突数量。',
    parameters: {
      url: { type: 'string', description: '题库 JSON 的直链（Gist raw、GitHub raw、网盘直链）' },
      file: { type: 'string', description: '或者给一个本地 json 路径；url 和 file 二选一' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          added: { type: 'integer', required: true },
          updated: { type: 'integer', required: true },
          removed: { type: 'integer', required: true },
          skipped: { type: 'integer', required: true },
          total: { type: 'integer', required: true },
          conflicts: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_a, v) => text(
        `同步完成：新增 ${v.added}、更新 ${v.updated}、移除 ${v.removed}、跳过 ${v.skipped}，本地共 ${v.total} 道。`
        + (v.conflicts.length ? `\n本地更新更晚、已保留本地：${v.conflicts.join('、')}` : '')),
    },
    async execute(args) {
      if (!args.url && !args.file) throw new Error('要给 url 或 file 其中一个')
      const list = args.file ? readBankFile(String(args.file)) : await fetchBank(String(args.url))
      const r = mergeRemote(list)
      return { ...r, total: activeBank().length }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'turtle_online',
    description: '连自建的海龟汤后端：submit 交一道题进服务端待审，pending 看待审，review 通过或驳回，pull 把已通过的题并进本地。地址和令牌优先用插件配置里的 serverUrl / submitToken / adminToken；调用时传 serverUrl 或 token 可临时覆盖。',
    parameters: {
      action: { type: 'string', required: true, enum: ['submit', 'pending', 'review', 'pull'], description: '要做的动作' },
      serverUrl: { type: 'string', description: '后端地址，如 https://turtle.xxx.workers.dev' },
      token: { type: 'string', description: '令牌：交题用投稿令牌，审稿用管理员令牌' },
      code: { type: 'string', description: 'submit 时的投稿码（TS1. 开头）' },
      submitter: { type: 'string', description: 'submit 时的投稿人署名' },
      note: { type: 'string', description: 'submit 时的附言' },
      id: { type: 'string', description: 'review 时的待审编号' },
      decision: { type: 'string', enum: ['approve', 'reject'], description: 'review 时的决定' },
      reason: { type: 'string', description: 'review 驳回理由' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          done: { type: 'string', required: true },
          rows: { type: 'array', required: true, items: { type: 'string' } },
          merged: { type: 'object', additionalProperties: true },
        },
      },
      render: (_a, v) => text(
        v.done + (v.rows.length ? `\n${v.rows.join('\n')}` : '')
        + (v.merged ? `\n并入库：新增 ${v.merged.added}、更新 ${v.merged.updated}、跳过 ${v.merged.skipped}` : '')),
    },
    async execute(args) {
      const base = String(args.serverUrl || serverUrl || '').replace(/\/+$/, '')
      if (!base) {
        throw new Error('没配后端地址：在插件 config 里填 serverUrl（或者调用时传 serverUrl）')
      }
      const needAdmin = args.action === 'pending' || args.action === 'review'
      const local = readTokens()
      const token = String(
        args.token
          || (needAdmin
            ? (adminToken || local.adminToken)
            : (submitToken || local.submitToken))
          || '',
      ).trim()
      if (!token && args.action !== 'pull') {
        throw new Error(needAdmin
          ? '没配管理员令牌：在插件 config 里填 adminToken（或者调用时传 token）'
          : '没配投稿令牌：在插件 config 里填 submitToken（或者调用时传 token）')
      }
      const headers = token
        ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
        : { 'content-type': 'application/json' }
      const call = async (path, body) => {
        const res = await fetch(`${base}${path}`, {
          method: body ? 'POST' : 'GET',
          headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        return data
      }
      if (args.action === 'submit') {
        const puzzle = normalize(decodeCode(args.code), args.submitter || '匿名投稿')
        if (!puzzle) throw new Error('投稿码内容没过校验')
        const r = await call('/submit', {
          puzzle,
          submitter: args.submitter || '匿名投稿',
          note: args.note || '',
        })
        return { done: `已交给服务器，编号 ${r.id}，当前待审 ${r.pending} 条。`, rows: [] }
      }
      if (args.action === 'pending') {
        const r = await call('/pending')
        const rows = (r.items ?? []).map((it) =>
          `${it.id} 《${it.title}》${stars(it.difficulty)} ${it.soup}·${it.style}　by ${it.submitter}`)
        return { done: `服务端待审 ${rows.length} 条：`, rows }
      }
      if (args.action === 'review') {
        if (!args.id) throw new Error('要给待审编号')
        const r = await call('/review', { id: args.id, decision: args.decision, reason: args.reason || '' })
        return { done: r.message || '已处理', rows: [] }
      }
      const r = await call('/bank')
      const merged = mergeRemote(r.puzzles ?? [])
      return { done: `已把服务端通过审核的 ${(r.puzzles ?? []).length} 道拉下来合并。`, rows: [], merged }
    },
  }))

  // ---------------- 投稿箱：GitHub / Gitee Issues ----------------

  function issueConfig(provider) {
    const tk = readTokens()
    if (provider === 'gitee') {
      const repo = String(cfg.giteeRepo || '').trim()
      if (!repo) throw new Error('没配 giteeRepo（形如 owner/repo），填上再用')
      return { repo, token: String(cfg.giteeToken || tk.giteeToken || '').trim() }
    }
    if (provider === 'github') {
      const repo = String(cfg.githubRepo || '').trim()
      if (!repo) throw new Error('没配 githubRepo（形如 owner/repo），填上再用')
      return { repo, token: String(cfg.githubToken || tk.githubToken || '').trim() }
    }
    throw new Error('provider 只能是 github 或 gitee')
  }

  const CODE_RE = /TS1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

  async function listIssues(provider, label) {
    const { repo, token } = issueConfig(provider)
    if (provider === 'gitee') {
      const qs = ['state=open', 'per_page=50']
      if (label) qs.push(`labels=${encodeURIComponent(label)}`)
      if (token) qs.push(`access_token=${encodeURIComponent(token)}`)
      const res = await fetch(`https://gitee.com/api/v5/repos/${repo}/issues?${qs.join('&')}`)
      if (!res.ok) throw new Error(`Gitee 拉取失败：HTTP ${res.status}`)
      const arr = await res.json()
      return (Array.isArray(arr) ? arr : []).map((it) => ({
        provider, number: it.number, title: it.title || '', body: it.body || '',
        user: it.user?.login || '',
      }))
    }
    const qs = ['state=open', 'per_page=50']
    if (label) qs.push(`labels=${encodeURIComponent(label)}`)
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-turtle-soup' }
    if (token) headers.authorization = `Bearer ${token}`
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?${qs.join('&')}`, { headers })
    if (!res.ok) throw new Error(`GitHub 拉取失败：HTTP ${res.status}`)
    const arr = await res.json()
    return (Array.isArray(arr) ? arr : [])
      .filter((it) => !it.pull_request)
      .map((it) => ({
        provider, number: it.number, title: it.title || '', body: it.body || '',
        user: it.user?.login || '',
      }))
  }

  async function closeIssue(provider, number, comment) {
    const { repo, token } = issueConfig(provider)
    if (!token) {
      throw new Error(`没配 ${provider} 令牌，关不了 issue（在 tokens.json 里加 ${provider}Token）`)
    }
    const jsonHeaders = { 'content-type': 'application/json' }
    if (provider === 'gitee') {
      const t = encodeURIComponent(token)
      const closed = await fetch(`https://gitee.com/api/v5/repos/${repo}/issues/${number}?access_token=${t}`, {
        method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ state: 'closed' }),
      })
      if (!closed.ok) throw new Error(`Gitee 关闭失败：HTTP ${closed.status}`)
      if (comment) {
        await fetch(`https://gitee.com/api/v5/repos/${repo}/issues/${number}/comments?access_token=${t}`, {
          method: 'POST', headers: jsonHeaders, body: JSON.stringify({ body: comment }),
        })
      }
      return
    }
    const headers = {
      accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
      'user-agent': 'dsh-turtle-soup', ...jsonHeaders,
    }
    const closed = await fetch(`https://api.github.com/repos/${repo}/issues/${number}`, {
      method: 'PATCH', headers, body: JSON.stringify({ state: 'closed' }),
    })
    if (!closed.ok) throw new Error(`GitHub 关闭失败：HTTP ${closed.status}`)
    if (comment) {
      await fetch(`https://api.github.com/repos/${repo}/issues/${number}/comments`, {
        method: 'POST', headers, body: JSON.stringify({ body: comment }),
      })
    }
  }

  ctx.tools.register(defineTool({
    name: 'turtle_issues',
    description: '拿 GitHub 或 Gitee 的 Issue 当投稿箱：pull 把 issue 里的 TS1 投稿码收进待审；approve 通过并尝试关掉 issue；reject 驳回并尝试关掉。GitHub 能自动关闭；Gitee 的关闭接口目前返回 404，只能手动关闭（结果里会提示）。读 issue 不需要令牌，关 issue 需要（tokens.json 里的 githubToken / giteeToken）。',
    parameters: {
      action: { type: 'string', required: true, enum: ['pull', 'approve', 'reject'], description: 'pull 拉取，approve 通过，reject 驳回' },
      provider: { type: 'string', enum: ['github', 'gitee'], description: '用哪个平台，默认 github' },
      label: { type: 'string', description: 'pull 时按这个标签筛 issue，默认用配置里的 issueLabel；填 * 表示不筛（Gitee 没建标签时用）' },
      id: { type: 'string', description: 'approve/reject 时的待审编号' },
      reason: { type: 'string', description: 'reject 时写进 issue 的理由' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          done: { type: 'string', required: true },
          rows: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_a, v) => text(v.done + (v.rows.length ? `\n${v.rows.join('\n')}` : '')),
    },
    async execute(args) {
      const provider = args.provider === 'gitee' ? 'gitee' : 'github'
      const pending = loadPending()
      if (args.action === 'pull') {
        const rawLabel = args.label !== undefined ? args.label : cfg.issueLabel
        let label = String(rawLabel ?? 'turtle-submission').trim()
        if (label === '*' || label === '-') label = '' // 不按标签筛（Gitee 没建标签时用）
        const issues = await listIssues(provider, label)
        const bank = activeBank()
        const rows = []
        let added = 0
        for (const it of issues) {
          const codes = String(it.body).match(CODE_RE) || []
          if (!codes.length) {
            rows.push(`#${it.number} 里没有投稿码，跳过`)
            continue
          }
          for (const code of codes) {
            let puzzle
            try {
              puzzle = normalize(decodeCode(code), it.user || '匿名投稿')
            } catch (err) {
              rows.push(`#${it.number} 的码无效：${err.message}`)
              continue
            }
            if (!puzzle) {
              rows.push(`#${it.number} 的码内容没过校验`)
              continue
            }
            if (bank.some((p) => p.title === puzzle.title)
              || pending.items.some((x) => x.puzzle.title === puzzle.title)) {
              rows.push(`#${it.number}《${puzzle.title}》重复，跳过`)
              continue
            }
            const item = {
              id: idOf(`${puzzle.title}|${it.provider}|${it.number}|${Date.now()}`),
              puzzle,
              submitter: it.user || '匿名投稿',
              note: `来自 ${it.provider} #${it.number}`,
              at: Date.now(),
              issue: { provider: it.provider, number: it.number },
            }
            pending.items.push(item)
            added += 1
            rows.push(`#${it.number}《${puzzle.title}》进待审（${item.id}）`)
          }
        }
        writeJson(pendingPath(), pending)
        return { done: `${provider} 上有 ${issues.length} 个 issue，新增 ${added} 条待审。`, rows }
      }

      const key = String(args.id ?? '').trim()
      if (!key) throw new Error('要给待审编号')
      const idx = pending.items.findIndex((x) => x.id === key || x.puzzle.title === key)
      if (idx < 0) throw new Error('待审里没有这条')
      const item = pending.items[idx]
      const bank = loadBank()
      if (args.action === 'approve') {
        if (bank.puzzles.some((p) => p.title === item.puzzle.title)) throw new Error('题库里已有同名题目')
        bank.puzzles.push(item.puzzle)
        writeJson(bankPath(), bank)
        pending.items.splice(idx, 1)
        writeJson(pendingPath(), pending)
        const rows = []
        if (item.issue) {
          try {
            await closeIssue(item.issue.provider, item.issue.number, `已收录《${item.puzzle.title}》，谢谢！`)
            rows.push(`已关闭 ${item.issue.provider} #${item.issue.number}`)
          } catch (err) {
            rows.push(`已入库，但关 issue 失败：${err.message}（请手动关闭 ${item.issue.provider} #${item.issue.number}）`)
          }
        }
        return { done: `通过了《${item.puzzle.title}》，已入库。`, rows }
      }
      pending.items.splice(idx, 1)
      writeJson(pendingPath(), pending)
      const rows = []
      if (item.issue) {
        try {
          await closeIssue(item.issue.provider, item.issue.number, `驳回：${args.reason || '未通过审核'}`)
          rows.push(`已关闭 ${item.issue.provider} #${item.issue.number}`)
        } catch (err) {
          rows.push(`已从待审移除，但关 issue 失败：${err.message}（请手动关闭 ${item.issue.provider} #${item.issue.number}）`)
        }
      }
      return { done: `驳回了《${item.puzzle.title}》。`, rows }
    },
  }))

  // ---------------- 本地 HTTP 桥：给 AstrBot 的 QQ 端调用 ----------------
  // 大肥鱼在另一个进程里，只能通过网络拿题和交分。只监听 127.0.0.1。
  if (cfg.bridgeEnabled !== false) {
    const port = Number(cfg.bridgePort ?? 8799)
    const token = String(cfg.bridgeToken || readTokens().bridgeToken || '').trim()

    const readBody = (req) => new Promise((resolve, reject) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 1_000_000) {
          reject(new Error('请求体太大'))
          req.destroy()
        }
      })
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {})
        } catch (err) {
          reject(new Error(`JSON 解析失败：${err.message}`))
        }
      })
      req.on('error', reject)
    })

    const reply = (res, code, body) => {
      const payload = JSON.stringify(body)
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
      })
      res.end(payload)
    }

    const server = createServer(async (req, res) => {
      try {
        if (token && String(req.headers['x-bridge-token'] ?? '') !== token) {
          return reply(res, 401, { ok: false, error: '令牌无效' })
        }
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (req.method === 'GET' && url.pathname === '/health') {
          return reply(res, 200, { ok: true, bank: activeBank().length })
        }
        if (req.method === 'GET' && url.pathname === '/bank') {
          return reply(res, 200, { ok: true, ...(await bankTool.execute({}, {})) })
        }
        if (req.method === 'GET' && url.pathname === '/list') {
          const page = Number(url.searchParams.get('page') || 1)
          return reply(res, 200, { ok: true, ...(await listTool.execute({ page }, {})) })
        }
        if (req.method === 'POST' && url.pathname === '/draw') {
          return reply(res, 200, { ok: true, ...(await drawTool.execute(await readBody(req), {})) })
        }
        if (req.method === 'POST' && url.pathname === '/score') {
          return reply(res, 200, { ok: true, ...(await scoreTool.execute(await readBody(req), {})) })
        }
        return reply(res, 404, { ok: false, error: 'not found' })
      } catch (err) {
        return reply(res, 400, { ok: false, error: err?.message ?? String(err) })
      }
    })
    server.on('error', () => {})
    server.listen(port, '127.0.0.1')
    ctx.effect(() => () => {
      try {
        server.close()
      } catch {
        /* 已经关了 */
      }
    }, 'turtle-soup: local bridge')
  }
}
