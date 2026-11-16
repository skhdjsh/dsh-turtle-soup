# 海龟汤后端（Cloudflare Workers + D1）

给 `@local/dsh-turtle-soup` 插件配套的在线投稿后端。**免费额度**：Workers 每天 10 万次请求、D1 免费 5 GB，玩海龟汤这辈子用不完。

## 一次部署（约 10 分钟）

需要：一个 Cloudflare 账号（免费）、Node.js。

```bash
cd server
npm i -g wrangler          # 或者每条命令前面加 npx
wrangler login             # 浏览器里点一下授权

# 1. 建数据库，把打印出来的 database_id 粘到 wrangler.toml 里
wrangler d1 create turtle-soup

# 2. 建表
wrangler d1 execute turtle-soup --file=schema.sql --remote

# 3. 两个令牌：管理员用 ADMIN_TOKEN，发给朋友的用 SUBMIT_TOKEN
wrangler secret put ADMIN_TOKEN
wrangler secret put SUBMIT_TOKEN

# 4. 上线
wrangler deploy
```

部署完会给你一个地址，形如 `https://turtle-soup.<你的子域>.workers.dev`。

## 插件里怎么用

- 交题：`turtle_online` `action=submit`，`serverUrl` 填上面的地址，`token` 填 **SUBMIT_TOKEN**，`code` 填 `TS1.` 投稿码。
- 审题：`action=pending` 看待审；`action=review` 配 `id` + `decision=approve|reject`，`token` 用 **ADMIN_TOKEN**。
- 拉题：`action=pull`（ADMIN 或任意有效令牌都行，读 `/bank` 不校验），把通过的题合并进本地题库。

## 安全提醒

- **SUBMIT_TOKEN 发给朋友就等于允许他们往待审里塞题**（塞不进题库，要你审）。不想要了就 `wrangler secret put SUBMIT_TOKEN` 换一个新的。
- `ADMIN_TOKEN` 不要外传：拿到它就能直接审自己的题。
- 令牌以明文存在 DSH 的插件配置/对话里，别把带令牌的截图发出去。
- 后端不存任何个人信息，只有题目、署名、附言。

## 接口一览

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/` | 无 | 健康检查 |
| GET | `/bank` | 无 | 已通过审核的题库 |
| POST | `/submit` | SUBMIT/ADMIN | 交题进待审 |
| GET | `/pending` | ADMIN | 看待审队列 |
| POST | `/review` | ADMIN | 通过或驳回 |

## 没验证的部分

这套代码是按 Cloudflare 的 D1 接口写的，但**没有在真实账号上跑过**（我这边没有你的 Cloudflare 凭据）。第一次部署如果报错，把 `wrangler deploy` 的输出发我，我改。
