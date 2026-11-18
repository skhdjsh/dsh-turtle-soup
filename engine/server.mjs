#!/usr/bin/env node
/**
 * 海龟汤常驻引擎：网页 / QQ / 公众号都连它。
 *
 *   node engine/server.mjs            # 默认 127.0.0.1:8800
 *   PORT=9000 node engine/server.mjs
 *   PUBLIC=1 node engine/server.mjs   # 监听 0.0.0.0（隧道/VPS 用）
 *
 * 题库、计分、评分全部复用插件本体（../index.js），数据仍在 ~/.dsh/turtle-soup/。
 * 汤底只留在服务端，绝不下发给客户端。
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  dataDir, readJson, writeJson, activeBank, findByKey, stars, budgetOf,
  hintsAllowedFor, clamp, qualityOf, needsReview, weightedPick, scoreOf, loadBank,
} from '../index.js'

const PORT = Number(process.env.PORT || 8800)
const HOST = process.env.PUBLIC === '1' ? '0.0.0.0' : '127.0.0.1'
const KEY_FILE = process.env.DEEPSEEK_KEY_FILE || 'C:\\dafeiyu\\private\\deepseek-key.txt'

const SESSIONS = () => join(dataDir(), 'engine-sessions.json')
const LEDGER = () => join(dataDir(), 'engine-ledger.json')

// ---------- 小工具 ----------

const loadSessions = () => readJson(SESSIONS(), {})
const saveSessions = (s) => writeJson(SESSIONS(), s)
const loadLedger = () => readJson(LEDGER(), {})

function userOf(req, body) {
  const id = String(body?.userId || req.headers['x-user-id'] || '').trim()
  if (!id || id.length > 64) throw new Error('缺 userId')
  return id
}

function apiKey() {
  if (process.env.DEEPSEEK_KEY) return process.env.DEEPSEEK_KEY.trim()
  try {
    return readFileSync(KEY_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

async function chat(system, prompt, temperature = 0.2, maxTokens = 300) {
  const key = apiKey()
  if (!key) throw new Error('没有 DeepSeek key，判题/提示不可用')
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
    }),
  })
  if (!r.ok) throw new Error(`模型请求失败 HTTP ${r.status}`)
  const j = await r.json()
  return j.choices?.[0]?.message?.content?.trim() ?? ''
}

// ---------- 判题 ----------

const JUDGE_SYSTEM = `你是海龟汤游戏的主持人，只负责判断，不负责解释。

这局的类型：{soup}·{style}
汤面：{face}
汤底（只有你知道，绝对不能说出来）：{truth}

玩家会问一个是否问题、给一个猜测，或者问这局属于哪一类。
你只输出下面五个词里的一个，不要标点、不要解释、不要括号、不要别的字：
是
不是
无关
接近了
猜对了

判断标准：
- 玩家的问题答案是「对」→ 是
- 答案是「不对」→ 不是
- 问题和这个案子无关、或者问的是汤面里已经写明的 → 无关
- 玩家的猜测方向对但不完整 → 接近了
- 玩家的猜测基本说出了汤底的关键 → 猜对了
- 拿不准时按「不是」或「无关」，不要给「猜对了」

【圈内黑话】
- 汤面：谜面。汤底：答案。喝汤：玩这个。
- 清汤（白汤）：没有死亡、血腥，结局温和。
- 红汤：涉及死亡、血腥、暴力。
- 黑汤：比红汤更暗，涉及灵异、超自然、变态、伦理禁忌。
- 本格：现实逻辑，没有超自然。变格：有灵异、超自然、异常心理或不现实设定。
- 玩家问「这是红汤吗」「是变格吗」，按上面定义和「这局的类型」照实回答。
- 注意类型可以叠加：红汤可能是本格，也可能是变格。`

function parseVerdict(text) {
  const s = (text || '').replace(/[\s\n]/g, '')
  if (s.includes('猜对')) return 'guess'
  if (s.includes('接近')) return 'near'
  if (s.includes('无关') || s.includes('没关系')) return 'irrelevant'
  const head = s.slice(0, 6)
  if (head.includes('不是')) return 'no'
  if (head.includes('是')) return 'yes'
  return 'unknown'
}

async function judge(game, text) {
  const sys = JUDGE_SYSTEM
    .replace('{soup}', game.soup).replace('{style}', game.style)
    .replace('{face}', game.face).replace('{truth}', game.truth)
  return parseVerdict(await chat(sys, text, 0.1, 20))
}

const EXTRA_HINT_SYSTEM = `你在主持海龟汤。
汤面：{face}
真正的汤底：{truth}

玩家要一句提示。要求：不超过 25 字，指向汤底的关键方向，但绝对不能说出答案本身。
只输出这一句提示，不要引号，不要解释。`

// ---------- 业务 ----------

function drawPuzzle(body) {
  let pool = activeBank()
  const soup = String(body.soup || '').trim()
  const style = String(body.style || '').trim()
  const min = Number(body.minDifficulty) || 1
  const max = Number(body.maxDifficulty) || 5
  pool = pool.filter((p) => p.difficulty >= min && p.difficulty <= max)
  if (soup) pool = pool.filter((p) => p.soup === soup)
  if (style) pool = pool.filter((p) => p.style === style)
  if (!pool.length) throw new Error('没有符合这些条件的题目，放宽松一点')
  if (body.avoidTitle) {
    const rest = pool.filter((p) => p.title !== body.avoidTitle)
    if (rest.length) pool = rest
  }
  return weightedPick(pool)
}

function gameView(g) {
  return {
    title: g.title, kind: `${g.soup}·${g.style}`, difficulty: g.difficulty,
    face: g.face, budget: g.budget, hintsAllowed: g.hintsAllowed,
    budgetLeft: g.budget > 0 ? Math.max(0, g.budget - g.asked) : null,
    hintsLeft: g.hintsAllowed > 0 ? Math.max(0, g.hintsAllowed - g.hintsUsed) : null,
    questionsUnlimited: g.budget <= 0,
    hintsUnlimited: g.hintsAllowed <= 0,
    paused: !!g.paused,
    asked: g.asked,
  }
}

function finishScore(g, completeness) {
  const { score, rank } = scoreOf({
    stars: g.difficulty,
    completeness,
    asked: g.asked,
    budget: g.budget,
    hintsUsed: g.hintsUsed,
    hintsAllowed: g.hintsAllowed,
    seconds: Math.round((Date.now() - g.started) / 1000),
    unlimitedQuestions: g.budget <= 0,
    unlimitedHints: g.hintsAllowed <= 0,
  })
  const file = join(dataDir(), 'stats.json')
  const saved = readJson(file, { played: 0, solved: 0, recent: [] })
  saved.played = (Number(saved.played) || 0) + 1
  if (completeness >= 0.85) saved.solved = (Number(saved.solved) || 0) + 1
  saved.recent = [...(saved.recent ?? []), {
    title: g.title, solved: completeness >= 0.85, asked: g.asked,
    seconds: Math.round((Date.now() - g.started) / 1000),
    difficulty: g.difficulty, score, rank, at: Date.now(),
  }].slice(-200)
  writeJson(file, saved)
  return { score, rank }
}

// ---------- HTTP ----------

const hits = new Map()
function rateLimit(key, limit = 120, windowMs = 60_000) {
  const now = Date.now()
  const rec = hits.get(key) ?? []
  const fresh = rec.filter((t) => now - t < windowMs)
  if (fresh.length >= limit) return false
  fresh.push(now)
  hits.set(key, fresh)
  return true
}

function send(res, code, body) {
  const payload = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-user-id, x-engine-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 200_000) {
        reject(new Error('请求体太大'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const url = new URL(req.url ?? '/', 'http://x')
  const ip = req.socket.remoteAddress ?? '?'
  try {
    if (!rateLimit(ip)) return send(res, 429, { ok: false, error: '太频繁了，歇一会' })

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(html)
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, bank: activeBank().length, model: !!apiKey() })
    }
    if (req.method === 'GET' && url.pathname === '/bank') {
      const bank = activeBank()
      const byKind = {}
      let sum = 0
      for (const p of bank) {
        const k = `${p.soup}·${p.style}`
        byKind[k] = (byKind[k] ?? 0) + 1
        sum += p.difficulty
      }
      return send(res, 200, {
        ok: true, total: bank.length, byKind,
        averageDifficulty: bank.length ? sum / bank.length : 0,
        lowRated: bank.filter(needsReview).map((p) => p.title),
      })
    }
    if (req.method === 'GET' && url.pathname === '/list') {
      const page = Math.max(1, Number(url.searchParams.get('page') || 1))
      const per = 12
      const bank = activeBank()
      const rows = bank.slice((page - 1) * per, page * per).map((p, i) => ({
        index: (page - 1) * per + i + 1, title: p.title, stars: p.difficulty,
        kind: `${p.soup}·${p.style}`, author: p.author ?? '',
        rating: qualityOf(p).count > 3 ? Number(qualityOf(p).average.toFixed(1)) : null,
      }))
      return send(res, 200, { ok: true, page, pages: Math.max(1, Math.ceil(bank.length / per)), total: bank.length, rows })
    }

    if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'not found' })
    const body = await readBody(req)

    if (url.pathname === '/draw') {
      const userId = userOf(req, body)
      const p = drawPuzzle(body)
      const unlimitedQ = body.unlimitedQuestions === true
      const unlimitedH = body.unlimitedHints === true
      const g = {
        title: p.title, soup: p.soup, style: p.style, difficulty: p.difficulty,
        face: p.face, truth: p.truth, hints: p.hints ?? [],
        hintsUsed: 0, asked: 0, started: Date.now(), paused: false,
        budget: unlimitedQ ? 0 : budgetOf(p.difficulty, { baseQuestions: 10, perStarQuestions: 6 }),
        hintsAllowed: unlimitedH ? 0 : hintsAllowedFor(p.difficulty),
      }
      const all = loadSessions()
      all[userId] = g
      saveSessions(all)
      return send(res, 200, { ok: true, game: gameView(g) })
    }

    if (url.pathname === '/ask') {
      const userId = userOf(req, body)
      const all = loadSessions()
      const g = all[userId]
      if (!g) return send(res, 409, { ok: false, error: '现在没有进行中的局' })
      if (g.paused) return send(res, 409, { ok: false, error: '这局暂停中，先继续' })
      const text = String(body.text || '').trim()
      if (!text || text.length > 200) return send(res, 400, { ok: false, error: '问题太短或太长' })
      if (Date.now() - (g.lastAsk || 0) < 800) return send(res, 429, { ok: false, error: '慢点，一个一个来' })
      g.lastAsk = Date.now()
      g.asked += 1
      const verdict = await judge(g, text)
      if (verdict === 'guess') {
        const { score, rank } = finishScore(g, 1)
        const truth = g.truth
        delete all[userId]
        saveSessions(all)
        return send(res, 200, {
          ok: true, verdict, score, rank, truth,
          asked: g.asked, seconds: Math.round((Date.now() - g.started) / 1000),
        })
      }
      if (g.budget > 0 && g.asked >= g.budget) {
        const { score, rank } = finishScore(g, 0.5)
        const truth = g.truth
        delete all[userId]
        saveSessions(all)
        return send(res, 200, {
          ok: true, verdict, exhausted: true, score, rank, truth,
          asked: g.asked, seconds: Math.round((Date.now() - g.started) / 1000),
        })
      }
      saveSessions(all)
      return send(res, 200, { ok: true, verdict, ...gameView(g) })
    }

    if (url.pathname === '/hint') {
      const userId = userOf(req, body)
      const all = loadSessions()
      const g = all[userId]
      if (!g) return send(res, 409, { ok: false, error: '现在没有进行中的局' })
      const allowed = Number(g.hintsAllowed) || 0
      const used = Number(g.hintsUsed) || 0
      if (allowed > 0 && used >= allowed) return send(res, 409, { ok: false, error: `提示次数用完了（这题 ${allowed} 次）` })
      let hint = (g.hints ?? [])[used]
      if (!hint) {
        const sys = EXTRA_HINT_SYSTEM.replace('{face}', g.face).replace('{truth}', g.truth)
        hint = (await chat(sys, '给一句提示', 0.5, 80)).replace(/^["“]|["”]$/g, '').slice(0, 80)
          || '再想想汤面里最反常的地方。'
      }
      g.hintsUsed = used + 1
      saveSessions(all)
      return send(res, 200, { ok: true, hint, used: g.hintsUsed, allowed: allowed || null })
    }

    if (url.pathname === '/pause' || url.pathname === '/resume') {
      const userId = userOf(req, body)
      const all = loadSessions()
      const g = all[userId]
      if (!g) return send(res, 409, { ok: false, error: '现在没有进行中的局' })
      g.paused = url.pathname === '/pause'
      saveSessions(all)
      return send(res, 200, { ok: true, paused: g.paused, ...gameView(g) })
    }

    if (url.pathname === '/end') {
      const userId = userOf(req, body)
      const all = loadSessions()
      const g = all[userId]
      if (!g) return send(res, 409, { ok: false, error: '现在没有进行中的局' })
      const reveal = body.reveal === true
      const out = { ok: true, title: g.title, revealed: reveal }
      if (reveal) {
        const { score, rank } = finishScore(g, 0.5)
        out.score = score
        out.rank = rank
        out.truth = g.truth
      }
      out.asked = g.asked
      out.seconds = Math.round((Date.now() - g.started) / 1000)
      delete all[userId]
      saveSessions(all)
      return send(res, 200, out)
    }

    if (url.pathname === '/rate') {
      const userId = userOf(req, body)
      const bank = loadBank()
      const hit = findByKey(bank.puzzles.filter((p) => !p.deleted), body.key)
      if (!hit) return send(res, 404, { ok: false, error: '没找到这道题' })
      const target = hit.puzzle
      const ledger = loadLedger()
      const perTitle = ledger[target.title] ?? {}
      const prev = perTitle[userId]
      if (prev) {
        return send(res, 200, {
          ok: true, duplicate: true, title: target.title,
          message: '你已经评过这道题了',
          ...(qualityOf(target).count > 3 ? { average: Number(qualityOf(target).average.toFixed(1)) } : {}),
          likes: qualityOf(target).likes, dislikes: qualityOf(target).dislikes,
        })
      }
      const score = body.score === undefined || body.score === null ? null : Math.round(clamp(1, 10, Number(body.score)))
      const vote = String(body.vote || 'none')
      if (score === null && (vote === 'none' || !vote)) return send(res, 400, { ok: false, error: '至少给个分数或赞踩' })
      if (score !== null) target.ratings = [...(Array.isArray(target.ratings) ? target.ratings : []), score].slice(-500)
      if (vote === 'like') target.likes = (Number(target.likes) || 0) + 1
      if (vote === 'dislike') target.dislikes = (Number(target.dislikes) || 0) + 1
      target.updated = Date.now()
      writeJson(join(dataDir(), 'bank.json'), bank)
      perTitle[userId] = { score, vote, at: Date.now() }
      ledger[target.title] = perTitle
      writeJson(LEDGER(), ledger)
      const q = qualityOf(target)
      return send(res, 200, {
        ok: true, title: target.title, count: q.count,
        ...(q.count > 3 ? { average: Number(q.average.toFixed(1)) } : {}),
        likes: q.likes, dislikes: q.dislikes, lowRated: needsReview(target),
      })
    }

    return send(res, 404, { ok: false, error: 'not found' })
  } catch (err) {
    return send(res, 400, { ok: false, error: err?.message ?? String(err) })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[engine] listening on http://${HOST}:${PORT} | bank=${activeBank().length} | model=${apiKey() ? 'ok' : '缺 key'}`)
})
