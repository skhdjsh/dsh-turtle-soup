# 海龟汤题库（DSH 插件）

给 DeepSeek Harness 用的海龟汤插件：抽题、加题改题、按难度点汤、投稿码审核，还能连一个自建的免费后端做在线投稿。

## 能力

| 工具 | 作用 |
|---|---|
| `turtle_draw` | 抽题：按类型/难度筛，开局前可选「不限提问」「不限提示」模式；返回汤面 + 汤底 + 提示 + 提问上限 + 提示次数 |
| `turtle_bank` / `turtle_list` / `turtle_get` | 概览、分页、看单题（不返回汤底） |
| `turtle_add` / `turtle_edit` / `turtle_delete` | 加题、改题、删题（墓碑删除，同步时会传播） |
| `turtle_export` / `turtle_submit` / `turtle_review` | 导出投稿码、收进待审、`list`/`view` 看队列与答案、通过或驳回 |
| `turtle_issues` | 把 GitHub / Gitee 的 Issue 当投稿箱：`pull` 拉取、`approve` 通过并尝试关 issue（Gitee 关不掉，需手动）、`reject` 驳回 |
| `turtle_snapshot` / `turtle_sync` | 导出整库 JSON、按 URL 或本地文件拉取并按「标题 + updated」合并 |
| `turtle_online` | 对接 `server/` 里的后端：交题、看待审、审稿、拉取 |
| `turtle_stats` | 记战绩 |
| `turtle_score` | 猜中后计分：按难度、推理完成度、剩余提问、剩余提示、用时算总分和段位（规则不公开） |
| `turtle_game` | 局内控制：`status` 看进度、`hint` 要提示、`asked` 记句数、`pause`/`resume` 暂停恢复、`end` 结束（`reveal=true` 才揭汤底，带 `completeness` 就顺带算分） |

数据存在 `~/.dsh/turtle-soup/`，插件零依赖（不 import 任何 DSH 内部包）。

## 安装

**插件市场**：在 DSH 的 Plugins → Discover 里加一个 index 地址（见 `market/`），然后安装。

**本地目录**：Plugins → Add plugin → 选这个目录。

## 配置

`cordis.patch.yml` 的 `config`：

```yaml
serverUrl: ''      # 自建后端地址（不敏感，放这里没问题）
submitToken: ''    # 投稿令牌（发给朋友）——建议留空，见下
adminToken: ''     # 管理员令牌（自己用）——建议留空，见下
```

**两个令牌别写进这个文件**：它跟着仓库公开，写进去就等于公开。插件会优先读本机私有文件 `~/.dsh/turtle-soup/tokens.json`（不在仓库里）：

```json
{ "adminToken": "…", "submitToken": "…" }
```

配置里那两项只是兜底；调用时传 `token` 也能临时覆盖。改完重启 DSH 生效。

## 开局模式与提示次数

开局前可以选两个模式（`turtle_draw` 的参数）：

- `unlimitedQuestions: true` —— 不限提问次数，问多少句都不算超；
- `unlimitedHints: true` —— 不限提示次数（题目自带几条就能要几条）。

两个都不选时，按难度给提示次数：

| 难度 | 提示次数 |
|---|---|
| ★☆☆☆☆ | 1 次 |
| ★★☆☆☆ / ★★★☆☆ | 2 次 |
| ★★★★☆ / ★★★★★ | 3 次 |

提问上限照旧：基础 10 句 + 每颗星 6 句（配置里的 `baseQuestions` / `perStarQuestions` 可调）。

「提示次数」指的是**能问几次提示**：题目自带的提示用完后，主持人手里有汤底，可以按汤底现说一条，次数由难度决定。

## 在线投稿：Issue 当投稿箱

不需要服务器，也不需要域名：

1. 朋友在你仓库提一个 issue，正文贴一行 `TS1.…` 投稿码（`turtle_export` 导出的那种），打上 `turtle-submission` 标签；
2. 你调 `turtle_issues`，`action=pull`、`provider=github` → 码解析后进待审；
3. 审核时用 `turtle_review action=view` 看汤底；
4. `turtle_issues action=approve id=…` → 入库，并自动关闭 issue、回一句「已收录」；`action=reject` 则关闭并写明理由。

Gitee 用同一套工具：`provider=gitee`，再配上 `giteeRepo`；Gitee 不需要建标签，`pull` 时传 `label: "*"` 跳过筛选。

**但 Gitee 的 issue 关不掉，只能手动关。** Gitee 的 issue 写接口对个人令牌返回 `404 Not Found Project`，试过 JSON 体、form 体、令牌放查询串、数字仓库 ID、显式 `repo` 参数，全部一样；而读 issue 是正常的。

所以 Gitee 上的流程是：

- `pull`、审核看汤底、通过入库 —— 都正常；
- 通过或驳回后，结果会提示「关 issue 失败（请手动关闭 gitee #编号）」，你去网页点一下关闭即可；
- 如果你的朋友主要在 Gitee，建议直接告诉他们「收录后会手动关帖」。

**读 issue 不需要令牌，关 issue 需要。** 令牌放 `~/.dsh/turtle-soup/tokens.json`：

```json
{ "githubToken": "…", "giteeToken": "…" }
```

- GitHub：https://github.com/settings/tokens 建 fine-grained token，只授权这个仓库、勾 `Issues: Read and write`
- Gitee：设置 → 私人令牌，勾 `projects`（+ `issues`）

## 数据与备份

```
~/.dsh/turtle-soup/
├── bank.json     题库（含墓碑）
├── pending.json  待审投稿
└── stats.json    战绩
```

拷贝这三个文件就是备份；删掉整个目录会重新播种内置的 100 道题（`bank-seed.json` 随包发布：22 道是网络流传的经典题重写，51 道是过审的生成题，其余是内置题与大肥鱼题库）。

## 常见问题

- **审稿为什么看不到答案？** 用 `turtle_review` 的 `view` 动作，`list` 只给汤面。
- **改了题怎么同步出去？** `turtle_edit` 会刷新 `updated`，别人 `turtle_sync` 时会覆盖旧版。
- **同步冲突了怎么办？** 本地 `updated` 更晚时保留本地，结果里会列出冲突标题，不会静默覆盖。
- **直链 404？** GitHub 要用 `raw.githubusercontent.com/...` 而不是仓库网页地址。

更细的说明（含故障排查表）见 `docs/DETAIL.md`。

## 目录

- `index.js` — 插件本体（工具注册、题库读写、合并、在线投稿）
- `bank-seed.json` — 首次运行铺开的 100 道题
- `cordis.patch.yml` — 插件行与默认配置
- `locale/{zh,en}.json` — 插件页标题/描述
- `docs/DETAIL.md` — 插件详情页正文
- `icon.svg` / `assets/icon-180.png` — 图标（后者给市场卡片用）
- `market/` — 插件市场 index 的模板和生成脚本
- `server/` — 可选的 Cloudflare Workers 后端（在线投稿）

## 许可

MIT
