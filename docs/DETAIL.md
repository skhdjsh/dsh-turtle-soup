# 海龟汤题库

装了这个插件，你的机器就是这套题的中心：题库、待审投稿、战绩都存在本机 `~/.dsh/turtle-soup/`。

## 玩法

跟模型说「来个海龟汤」就行，它调 `turtle_draw` 抽一道题：

- 可以点单：「来个红汤」「开个本格的」「来道五星的」「来清汤变格」；
- 返回汤面、汤底、提示，以及这局的提问上限和提示次数；
- 主持人是你或模型，只答「是」「不是」「跟这个没关系」「接近了」「猜对了」；
- 问满上限还没猜中，就揭晓；
- 一局结束用 `turtle_stats` 记战绩。

### 开局模式与提示次数

开局前可以选两个模式（`turtle_draw` 的参数）：

- `unlimitedQuestions: true` —— **不限提问次数模式**，问多少句都不算超；
- `unlimitedHints: true` —— **不限提示次数模式**，题目自带几条提示就能要几条。

两个都不选时，按难度给提示次数：

| 难度 | 提示次数 |
|---|---|
| ★☆☆☆☆ | 1 次 |
| ★★☆☆☆ / ★★★☆☆ | 2 次 |
| ★★★★☆ / ★★★★★ | 3 次 |

提问上限照旧：基础 10 句 + 每颗星 6 句（配置 `baseQuestions` / `perStarQuestions` 可调）。

「提示次数」指的是**能问几次提示**：题目自带的提示用完后，主持人手里有汤底，可以按汤底现说一条，次数由难度决定。

`turtle_get` 看单题时**不返回汤底**，避免提前剧透；但 `turtle_draw` 会返回，因为主持人必须知道答案。

### 计分（规则不公开）

猜中后 `turtle_score` 会给一个总分和段位：**摸鱼 → 新手 → 熟客 → 老饕 → 汤神**。

分数由难度星级、推理完成度、剩余提问次数、剩余提示次数、用时共同决定。**具体权重和公式故意不写进文档**，免得玩家照着参数刷分——想知道细则可以问维护者。

## 题库管理

| 工具 | 作用 |
|---|---|
| `turtle_bank` | 总数、类型分布、平均难度、待审数量、战绩 |
| `turtle_list` / `turtle_get` | 分页浏览、看单题（不含汤底） |
| `turtle_add` | 加题。汤面最多 1500 字、汤底最多 3000 字，长题也能存 |
| `turtle_edit` | 改题：标题、汤面、汤底、类型、难度、提示都能改 |
| `turtle_delete` | 删题（墓碑删除，同步时会传播到别人那里） |

## 别人交题：投稿码 + 审核

跨机器交题不需要服务器，走「投稿码」：

1. 对方拿到一道题，用 `turtle_export` 导出成一串 `TS1.…` 的投稿码（自带校验和，改一个字符就失效）；
2. 把码发给你；
3. 你用 `turtle_submit` 收进待审队列——**不会直接进题库**；
4. 用 `turtle_review`：
   - `list` 看待审队列（只有汤面，不含答案）；
   - `view` 看某一条的**汤面和汤底**——审核前必须看这个；
   - `approve` 通过入库 / `reject` 驳回。

装插件的人天然是管理员：只有他能加、改、删、审。投稿人只能生成码，碰不到你的题库。

## 题库共享

题库就是一份 JSON，三种共享方式：

1. **投稿码**（上面说的）：一对一，最稳。
2. **文件同步**：`turtle_snapshot` 导出整库 JSON，贴到 Gist / GitHub raw / 网盘；用 `turtle_sync` 填**直链**或**本地文件路径**拉取。
   合并按「标题 + updated 时间戳」：远端更新更晚才覆盖，删除以墓碑传播，本地更新更晚则保留本地并在结果里列成冲突。
3. **自建后端**：`server/` 里是 Cloudflare Workers + D1 的代码，部署后 `turtle_online` 直接交题、待审、审稿、拉题。

## 配置

`cordis.patch.yml` 的 `config`：

```yaml
serverUrl: ''      # 自建后端地址
submitToken: ''    # 投稿令牌（发给朋友，只能交题进待审）
adminToken: ''     # 管理员令牌（自己用，能审）
```

**令牌建议放 `~/.dsh/turtle-soup/tokens.json`**（插件优先读它，这个文件不在仓库里），而不是写进 `cordis.patch.yml`——后者随仓库公开：

```json
{ "adminToken": "…", "submitToken": "…" }
```

调用时传 `serverUrl` / `token` 可临时覆盖。改完 **重启 DSH** 生效。

## 数据与备份

```
~/.dsh/turtle-soup/
├── bank.json     题库（含墓碑）
├── pending.json  待审投稿
└── stats.json    战绩
```

- 备份就是拷这三个文件；换机器拷过去即可。
- `turtle_snapshot` 能把题库导出成一段可贴走的 JSON，适合长期存档。
- 想彻底重置：删掉整个目录，下次启动会重新播种内置的 13 道。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| `没配后端地址` | 没填 `serverUrl`；在配置里填，或调用时传 `serverUrl` |
| `没配管理员令牌` / `没配投稿令牌` | `pending`/`review` 要 `adminToken`，`submit` 要 `submitToken` |
| `令牌无效` | 后端 `ADMIN_TOKEN`/`SUBMIT_TOKEN` 和插件里填的不一致；`wrangler secret put` 重设后要重启 DSH |
| `投稿码校验失败` | 码被截断或改过，让对方重新导出 |
| `题库里已经有这道题了` | 同名题已存在；先 `turtle_get` 看看是不是已经有了 |
| `改完没过校验` | 汤面 5-1500 字、汤底 10-3000 字、类型只能红/黑/清 + 本格/变格 |
| `拉取失败：HTTP 404` | 直链不对；GitHub 要用 `raw.githubusercontent.com` 的地址，不是仓库网页地址 |

## 在线投稿：Issue 当投稿箱

不想靠人肉传码，可以让朋友在你仓库提 issue（GitHub 或 Gitee 都行），无需服务器：

1. issue 正文贴一行 `TS1.…` 投稿码，打上 `turtle-submission` 标签；
2. `turtle_issues` `action=pull` `provider=github`（或 `gitee`）→ 码解析后进待审；
3. 审核用 `turtle_review action=view` 看汤底；
4. `turtle_issues action=approve id=…` → 入库 + 关闭 issue + 回一句「已收录」；`action=reject` → 关闭并写理由。GitHub 上会自动关；Gitee 上关不掉，见下面「Gitee 只能手动关」。

**读 issue 不需要令牌，关 issue 需要。** 令牌放 `~/.dsh/turtle-soup/tokens.json`（不在仓库里）：

```json
{ "githubToken": "…", "giteeToken": "…" }
```

- GitHub：Settings → Developer settings → Personal access tokens，只授权这个仓库、勾 `Issues: Read and write`
- Gitee：设置 → 私人令牌，勾 `projects`（+ `issues`）

**Gitee 的 issue 关不掉，只能手动关。** Gitee 的 issue 写接口对个人令牌一律返回 `404 Not Found Project`（JSON 体、form 体、令牌放查询串、数字仓库 ID、显式 `repo` 参数都试过），而读 issue 正常。所以 Gitee 上的 `approve` / `reject` 会入库（或移出待审），然后在结果里提示「关 issue 失败，请手动关闭 gitee #编号」。Gitee 也不需要建标签，`pull` 时传 `label: "*"` 跳过筛选。

## 限制（如实说明）

- **投稿码要靠人传**：微信/邮件/任何聊天工具都行，没有内置点对点通道。
- **Gitee 的 issue 不能自动关闭**：Gitee 的 issue 写接口对个人令牌返回 404，`approve`/`reject` 之后需要手动去网页关帖。GitHub 不受影响。
- **抽题结果里有汤底**：工具结果在对话里可见，所以抽完题别让玩家翻那条工具卡片；要么由你当主持人，要么用另一个会话抽题，把汤面抄给玩家。
- 同一时间只维护一份本地题库，没有多用户权限分级；「管理员」就是装插件的那台机器。
- **`server/` 的后端代码没在真实 Cloudflare 账号上跑过**：接口和字段按官方文档写，首次部署可能要调。
