# 海龟汤题库（DSH 插件）

给 DeepSeek Harness 用的海龟汤插件：抽题、加题改题、按难度点汤、投稿码审核，还能连一个自建的免费后端做在线投稿。

## 能力

| 工具 | 作用 |
|---|---|
| `turtle_draw` | 抽题：按红/黑/清汤、本格/变格、难度区间筛，返回汤面 + 汤底 + 提示 + 可提问句数 |
| `turtle_bank` / `turtle_list` / `turtle_get` | 概览、分页、看单题（不返回汤底） |
| `turtle_add` / `turtle_edit` / `turtle_delete` | 加题、改题、删题（墓碑删除，同步时会传播） |
| `turtle_export` / `turtle_submit` / `turtle_review` | 导出投稿码、收进待审、`list`/`view` 看队列与答案、通过或驳回 |
| `turtle_snapshot` / `turtle_sync` | 导出整库 JSON、按 URL 或本地文件拉取并按「标题 + updated」合并 |
| `turtle_online` | 对接 `server/` 里的后端：交题、看待审、审稿、拉取 |
| `turtle_stats` | 记战绩 |

数据存在 `~/.dsh/turtle-soup/`，插件零依赖（不 import 任何 DSH 内部包）。

## 安装

**插件市场**：在 DSH 的 Plugins → Discover 里加一个 index 地址（见 `market/`），然后安装。

**本地目录**：Plugins → Add plugin → 选这个目录。

## 配置

`cordis.patch.yml` 的 `config`：

```yaml
serverUrl: ''      # 自建后端地址
submitToken: ''    # 投稿令牌（发给朋友）
adminToken: ''     # 管理员令牌（自己用）
```

改完重启 DSH 生效。注意配置是明文，且重装/更新插件会覆盖，更新前先备份这三个值。

## 数据与备份

```
~/.dsh/turtle-soup/
├── bank.json     题库（含墓碑）
├── pending.json  待审投稿
└── stats.json    战绩
```

拷贝这三个文件就是备份；删掉整个目录会重新播种内置的 13 道题。

## 常见问题

- **审稿为什么看不到答案？** 用 `turtle_review` 的 `view` 动作，`list` 只给汤面。
- **改了题怎么同步出去？** `turtle_edit` 会刷新 `updated`，别人 `turtle_sync` 时会覆盖旧版。
- **同步冲突了怎么办？** 本地 `updated` 更晚时保留本地，结果里会列出冲突标题，不会静默覆盖。
- **直链 404？** GitHub 要用 `raw.githubusercontent.com/...` 而不是仓库网页地址。

更细的说明（含故障排查表）见 `docs/DETAIL.md`。

## 目录

- `index.js` — 插件本体（工具注册、题库读写、合并、在线投稿）
- `cordis.patch.yml` — 插件行与默认配置
- `locale/{zh,en}.json` — 插件页标题/描述
- `docs/DETAIL.md` — 插件详情页正文
- `icon.svg` / `assets/icon-180.png` — 图标（后者给市场卡片用）
- `market/` — 插件市场 index 的模板和生成脚本
- `server/` — 可选的 Cloudflare Workers 后端（在线投稿）

## 许可

MIT
