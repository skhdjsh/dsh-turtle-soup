# 海龟汤题库（DSH 插件）

给 DeepSeek Harness 用的海龟汤插件：抽题、加题、删题、按难度点汤、投稿码审核，还能连一个自建的免费后端做在线投稿。

## 能力

| 工具 | 作用 |
|---|---|
| `turtle_draw` | 抽题：按红/黑/清汤、本格/变格、难度区间筛，返回汤面 + 汤底 + 提示 + 可提问句数 |
| `turtle_bank` / `turtle_list` / `turtle_get` | 概览、分页、看单题（不返回汤底） |
| `turtle_add` / `turtle_delete` | 加题、删题（墓碑删除，同步时会传播） |
| `turtle_export` / `turtle_submit` / `turtle_review` | 导出投稿码、收进待审、通过或驳回 |
| `turtle_snapshot` / `turtle_sync` | 导出整库 JSON、按 URL 拉取并按「标题 + updated」合并 |
| `turtle_online` | 对接自建后端：交题、看待审、审稿、拉取 |
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

## 目录

- `index.js` — 插件本体（工具注册、题库读写、合并、在线投稿）
- `cordis.patch.yml` — 插件行与默认配置
- `locale/{zh,en}.json` — 插件页标题/描述
- `docs/DETAIL.md` — 插件详情页正文
- `icon.svg` — 图标
- `market/` — 插件市场 index 的模板和生成脚本

## 许可

MIT
