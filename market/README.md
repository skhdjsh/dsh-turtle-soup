# 放进插件市场

DSH 没有「上传到官方商店」的入口——官方的插件目录由 DeepSeek 维护。**自建市场（market index）**才是能自助的路径：你托管一份 `index.json`，别人在 DSH 里加这个 URL，就能在 Discover 里看到并安装。

## 三步

### 1. 把插件推到 GitHub

仓库结构（`index.json` 里的 `path` 要和它对上）：

```
dsh-turtle-soup/          ← 仓库根
├── dsh-turtle-soup/      ← 插件包本体（package.json 所在）
├── turtle-server/        ← 可选，后端
└── ...
```

```bash
git init
git add .
git commit -m "turtle soup plugin"
git remote add origin https://github.com/<你>/dsh-turtle-soup.git
git push -u origin main

git rev-parse HEAD        # 记下这个 40 位 commit
```

### 2. 生成并校验 index.json

在 DSH 里跑（`DSH_INSTALL_DIR` 已经在环境里，脚本会用它加载 DSH 自带的校验器）：

```bash
node dsh-turtle-soup/market/build-index.mjs \
  --git-url https://github.com/<你>/dsh-turtle-soup \
  --commit <刚才的 40 位 sha>
```

成功后打印：

```
✔ 通过 format 1 校验
  包名  : @local/dsh-turtle-soup
  版本  : 1.2.0
  安装串: git+https://github.com/<你>/dsh-turtle-soup.git#<sha>&path:/dsh-turtle-soup
```

`--help` 看全部参数（标题、描述、作者、图标、npm 模式）。

### 3. 托管 index.json

三种都行，选最省事的：

- **GitHub 仓库 + raw 直链**：把生成的文件提交到仓库，用
  `https://raw.githubusercontent.com/<你>/dsh-turtle-soup/main/dsh-turtle-soup/market/index.json`
- **GitHub Pages**：仓库 Settings → Pages → 从 `main` 分支发布，地址形如 `https://<你>.github.io/dsh-turtle-soup/…`
- **任意静态托管**：网盘直链、对象存储都行，只要是 https 直链、能直接返回 JSON。

然后在 DSH 里：**Plugins → Discover → 添加 index 地址**，粘贴这个 URL。

## 注意

- **Discover 可能不在**：它由实验性的 `plugin-market` bundle 提供，部分 profile 默认没开。没有的话仍然可以装——用 **Plugins → Add plugin** 选本地目录，或者直接用第 2 步打印的安装串。
- **每次发版都要重跑**：改了代码 → 重新 commit → 重新生成 index（新的 `publishTimestamp` 和 `commit`）。commit 是钉死的，不重新生成就不会拉到新代码。
- **图标已经内联**进 index.json（`data:image/svg+xml;base64,…`），所以不依赖额外托管；也可以 `--icon https://…` 换成外链。
- **包名**现在是 `@local/dsh-turtle-soup`。`@local` 不是你在 npm 上的 scope，走 git 安装没问题；将来要发 npm，得改成你自己的 scope 或去掉 scope。
- `private: true` 只挡 `npm publish`，不影响 git 安装。

## 现在这份 index.json 是什么状态

`market/index.json` 是**模板**，commit 填的是 40 个 0，能过格式校验但装不上——把真实 commit 换进去才有意义。
