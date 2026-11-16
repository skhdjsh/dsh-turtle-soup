/**
 * 海龟汤后端（Cloudflare Worker + D1）
 *
 * 路由：
 *   GET  /          健康检查
 *   GET  /bank      已通过审核的题目（插件 turtle_online action=pull 用）
 *   POST /submit    交一道题进待审（需要投稿令牌或管理员令牌）
 *   GET  /pending   看待审队列（管理员）
 *   POST /review    通过/驳回（管理员）
 *
 * 鉴权：Authorization: Bearer <TOKEN>
 *   ADMIN_TOKEN     管理员，能看待审、能审
 *   SUBMIT_TOKEN    投稿令牌，只能交题；发给朋友
 */

const MAX_FACE = 1500
const MAX_TRUTH = 3000
const SOUPS = ['清汤', '红汤', '黑汤']
const STYLES = ['本格', '变格']

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  })
}

function tokenOf(req) {
  const raw = req.headers.get('authorization') ?? ''
  return raw.replace(/^Bearer\s+/i, '').trim()
}

function checkPuzzle(p) {
  if (!p || typeof p !== 'object') return '题目不是一个对象'
  const title = String(p.title ?? '').trim()
  const face = String(p.face ?? '').trim()
  const truth = String(p.truth ?? '').trim()
  if (title.length < 2 || title.length > 30) return '标题要 2-30 字'
  if (!SOUPS.includes(p.soup)) return 'soup 只能是清汤/红汤/黑汤'
  if (!STYLES.includes(p.style)) return 'style 只能是本格/变格'
  if (face.length < 5 || face.length > MAX_FACE) return `汤面要 5-${MAX_FACE} 字`
  if (truth.length < 10 || truth.length > MAX_TRUTH) return `汤底要 10-${MAX_TRUTH} 字`
  return null
}

function clean(p, submitter) {
  const hints = Array.isArray(p.hints)
    ? p.hints.map((h) => String(h).trim()).filter(Boolean).slice(0, 3)
    : []
  return {
    title: String(p.title).trim(),
    soup: p.soup,
    style: p.style,
    difficulty: Math.max(1, Math.min(5, Number(p.difficulty) || 3)),
    face: String(p.face).trim(),
    truth: String(p.truth).trim(),
    hints,
    author: String(p.author || submitter || '投稿').slice(0, 24),
    created: Number(p.created) || Date.now(),
    updated: Number(p.updated) || Date.now(),
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const token = tokenOf(req)
    const isAdmin = Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN
    const canSubmit = isAdmin || (Boolean(env.SUBMIT_TOKEN) && token === env.SUBMIT_TOKEN)
    const db = env.DB

    try {
      if (path === '/' && req.method === 'GET') {
        return json({ ok: true, service: 'turtle-soup', hasAdminToken: Boolean(env.ADMIN_TOKEN) })
      }

      if (path === '/bank' && req.method === 'GET') {
        const { results } = await db
          .prepare("SELECT payload FROM puzzles WHERE status = 'approved' ORDER BY decided DESC")
          .all()
        return json({ ok: true, puzzles: (results ?? []).map((r) => JSON.parse(r.payload)) })
      }

      if (path === '/submit' && req.method === 'POST') {
        if (!canSubmit) return json({ ok: false, error: '令牌无效' }, 401)
        const body = await req.json().catch(() => null)
        if (!body?.puzzle) return json({ ok: false, error: '缺少 puzzle' }, 400)
        const problem = checkPuzzle(body.puzzle)
        if (problem) return json({ ok: false, error: problem }, 400)

        const puzzle = clean(body.puzzle, body.submitter)
        const id = crypto.randomUUID().slice(0, 8)
        const now = Date.now()
        const exists = await db
          .prepare('SELECT status FROM puzzles WHERE title = ?')
          .bind(puzzle.title)
          .first()
        if (exists) {
          return json(
            { ok: false, error: exists.status === 'approved' ? '题库里已有这道题' : '待审里已经有这道题了' },
            409,
          )
        }
        await db
          .prepare(
            `INSERT INTO puzzles (id, title, payload, status, submitter, note, created, updated)
             VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
          )
          .bind(
            id,
            puzzle.title,
            JSON.stringify(puzzle),
            String(body.submitter ?? '匿名投稿').slice(0, 24),
            String(body.note ?? '').slice(0, 200),
            now,
            now,
          )
          .run()
        const count = await db
          .prepare("SELECT COUNT(*) AS n FROM puzzles WHERE status = 'pending'")
          .first()
        return json({ ok: true, id, pending: count?.n ?? 0 })
      }

      if (path === '/pending' && req.method === 'GET') {
        if (!isAdmin) return json({ ok: false, error: '需要管理员令牌' }, 401)
        const { results } = await db
          .prepare(
            "SELECT id, title, submitter, note, created, payload FROM puzzles WHERE status = 'pending' ORDER BY created",
          )
          .all()
        const items = (results ?? []).map((r) => {
          const p = JSON.parse(r.payload)
          return {
            id: r.id,
            title: r.title,
            submitter: r.submitter,
            note: r.note,
            created: r.created,
            soup: p.soup,
            style: p.style,
            difficulty: p.difficulty,
            face: p.face,
          }
        })
        return json({ ok: true, items })
      }

      if (path === '/review' && req.method === 'POST') {
        if (!isAdmin) return json({ ok: false, error: '需要管理员令牌' }, 401)
        const body = await req.json().catch(() => null)
        if (!body?.id) return json({ ok: false, error: '缺少 id' }, 400)
        if (!['approve', 'reject'].includes(body.decision)) {
          return json({ ok: false, error: 'decision 只能是 approve 或 reject' }, 400)
        }
        const row = await db
          .prepare("SELECT id, title, payload FROM puzzles WHERE id = ? AND status = 'pending'")
          .bind(body.id)
          .first()
        if (!row) return json({ ok: false, error: '没有这条待审' }, 404)
        if (body.decision === 'approve') {
          const puzzle = JSON.parse(row.payload)
          puzzle.updated = Date.now()
          const dup = await db
            .prepare("SELECT id FROM puzzles WHERE title = ? AND status = 'approved' AND id <> ?")
            .bind(row.title, row.id)
            .first()
          if (dup) return json({ ok: false, error: '题库里已有同名题目' }, 409)
          await db
            .prepare(
              "UPDATE puzzles SET status = 'approved', payload = ?, decided = ?, updated = ? WHERE id = ?",
            )
            .bind(JSON.stringify(puzzle), Date.now(), puzzle.updated, row.id)
            .run()
          return json({ ok: true, message: `通过了《${row.title}》` })
        }
        await db
          .prepare("UPDATE puzzles SET status = 'rejected', decided = ?, reason = ? WHERE id = ?")
          .bind(Date.now(), String(body.reason ?? ''), row.id)
          .run()
        return json({ ok: true, message: `驳回了《${row.title}》` })
      }

      return json({ ok: false, error: 'not found' }, 404)
    } catch (err) {
      return json({ ok: false, error: `服务器出错：${err?.message ?? err}` }, 500)
    }
  },
}
