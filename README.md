# H5 游戏图片抓取工具

一个基于 Node.js + Playwright 的通用脚本，用于抓取一个或多个 H5 游戏页面在运行时实际加载的图片资源，并按规则分类、下载、输出报告。

脚本入口：

- [download-game-images.js](/C:/Users/Administrator/Documents/tools/scripts/download-game-images.js)

## 功能概览

- 支持抓取多个游戏入口 URL
- 支持运行时网络监听和 DOM 补扫
- 支持 `strict`、`smart`、`review` 三种模式
- 自动推导每个游戏的 `allowedOrigin` 和 `allowedBasePath`
- 自动过滤广告、统计、追踪、第三方营销资源
- 支持 CDN 候选打分、分类和报告输出
- 支持移动端模拟 `mobile emulation`
- 支持自动点击 `Start / Play / Tap to Start` 等常见入口
- 支持生成：
  - `report.json`
  - `candidates.txt`

## 目录结构

```text
.
├─ package.json
├─ README.md
└─ scripts/
   └─ download-game-images.js
```

## 环境要求

- Node.js 18 及以上
- npm
- Playwright 依赖可正常安装
- 首次运行前需要安装 Playwright 浏览器

推荐先确认版本：

```bash
node -v
npm -v
```

## 安装

### 1. 安装依赖

```bash
npm install
```

### 2. 安装 Playwright Chromium

```bash
npx playwright install chromium
```

### 3. Linux / WSL 额外依赖

如果你在 Linux 或 WSL 中运行，Playwright 浏览器可能缺少系统动态库。优先执行：

```bash
sudo npx playwright install-deps chromium
```

如果仍有缺库问题，再补装常见依赖，例如：

```bash
sudo apt-get update
sudo apt-get install -y libnspr4 libnss3
```

## 快速开始

### 使用默认目标运行

```bash
npm run download:game-images
```

### 指定单个游戏页面

```bash
npm run download:game-images -- --url="https://example.com/game/index.html"
```

### 指定多个游戏页面

```bash
npm run download:game-images -- --url="https://example.com/game1/index.html,https://example.com/game2/index.html"
```

### 指定输出目录

```bash
npm run download:game-images -- --out="./downloads"
```

## 参数说明

脚本支持以下命令行参数：

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--url="<url1>,<url2>"` | 指定一个或多个入口页面 URL，逗号分隔 | 默认两个内置游戏 |
| `--out="./downloads"` | 指定总输出目录 | `./downloads` |
| `--wait=30000` | 页面加载后的额外等待时长，单位毫秒 | `15000` |
| `--headless` | 启用无头模式 | `false` |
| `--mobile` | 使用移动端模拟打开页面 | `false` |
| `--device="iPhone 13"` | 指定 Playwright 设备配置名称 | `iPhone 13` |
| `--no-auto-start` | 禁用自动启动点击逻辑 | 自动开启 |
| `--auto-start-delay=3000` | 页面打开后延迟多久再尝试点击开始 | `3000` |
| `--mode=strict|smart|review` | 抓取模式 | `strict` |
| `--include-cdn` | 下载 `cdnCandidate` | `false` |
| `--include-uncertain` | 下载 `uncertain` | `false` |
| `--allow-domain=a.com,b.com` | 手动放行的域名列表 | 空 |
| `--block-domain=a.com,b.com` | 手动屏蔽的域名列表 | 空 |
| `--force` | 覆盖已存在文件 | `false` |
| `--help` | 显示帮助 | - |

## 抓取模式说明

### 1. `strict`

最安全模式。

只下载满足以下条件的图片：

- 是图片资源
- 与入口页面同源 `same origin`
- 位于入口页面目录及其子目录
- 未命中广告、统计、追踪黑名单

适合先做一轮低风险抓取。

示例：

```bash
npm run download:game-images -- --mode=strict
```

### 2. `smart`

在 `strict` 基础上增加 CDN 候选分析。

行为：

- 总是下载 `allowed`
- 只有传入 `--include-cdn` 才下载 `cdnCandidate`
- 只有传入 `--include-uncertain` 才下载 `uncertain`
- `blocked` 永远不下载
- 所有候选都会写入报告

示例：

```bash
npm run download:game-images -- --mode=smart --include-cdn
```

### 3. `review`

以审查报告为主。

行为：

- 默认下载 `allowed`
- 不自动下载 `cdnCandidate` / `uncertain`
- 重点生成 `report.json` 和 `candidates.txt`
- 如果显式传入 `--include-cdn` 或 `--include-uncertain`，也可下载这些分类

示例：

```bash
npm run download:game-images -- --mode=review
```

## 资源识别规则

以下任一条件满足即视为图片资源：

- `request.resourceType() === "image"`
- `response content-type` 以 `image/` 开头
- URL 扩展名为：
  - `png`
  - `jpg`
  - `jpeg`
  - `webp`
  - `gif`
  - `svg`
  - `avif`

脚本会正确处理带 `query` / `hash` 的 URL，但保存到本地时会去掉 `query` / `hash`。

## 自动允许范围推导

脚本不会为每个游戏写死规则，而是根据入口 URL 自动推导：

- `allowedOrigin = new URL(pageUrl).origin`
- `allowedBasePath = 入口页面所在目录`

示例：

| 页面 URL | allowedOrigin | allowedBasePath |
| --- | --- | --- |
| `https://jvliang.myfunmax.com/games/Soccer_Free_Kick/index.html` | `https://jvliang.myfunmax.com` | `/games/Soccer_Free_Kick/` |
| `https://threehey.myfunmax.com/2312/Shots/index.html` | `https://threehey.myfunmax.com` | `/2312/Shots/` |
| `https://example.com/a/b/c/index.html` | `https://example.com` | `/a/b/c/` |
| `https://example.com/a/b/c/` | `https://example.com` | `/a/b/c/` |

## 广告 / 统计 / 追踪过滤

如果 URL 或相关上下文命中以下关键字，会被标记为 `blocked`：

- `googleads`
- `googlesyndication`
- `doubleclick`
- `adservice`
- `analytics`
- `gtag`
- `gstatic`
- `adsbygoogle`
- `pagead`
- `adtraffic`
- `tracking`
- `tracker`
- `collect`
- `beacon`
- `pixel`
- `facebook`
- `fbcdn`
- `tiktok`
- `bytedance`
- `adjust`
- `applovin`
- `unityads`
- `ironsource`
- `mintegral`
- `chartboost`
- `vungle`

如果命中 `--block-domain` 指定域名，也会被标记为 `blocked`。

## CDN 候选评分逻辑

对于不满足 `strict` 规则、但也未直接命中黑名单的图片，脚本会进入评分流程。

典型加分因素：

- `content-type` 为图片
- `resourceType` 为 `image`
- 路径包含 `assets / images / sprite / texture / res / static` 等特征
- URL 或路径包含当前游戏目录名
- 域名像静态资源域
- 请求来自主 frame
- frame 同源或处于同游戏目录
- 命中 `--allow-domain`

典型扣分因素：

- 路径包含 `ad / ads / banner / track / pixel / collect / beacon`
- 来源于跨 frame 非游戏上下文
- 域名或 frame 带明显广告 / 统计 / 社交追踪特征

分类规则：

- `allowed`: 满足 `strict`
- `cdnCandidate`: `score >= 70`
- `uncertain`: `40 <= score <= 69`
- `blocked`: 命中黑名单或 `score < 40`

## 输出目录规则

默认总输出目录：

```text
./downloads
```

每个游戏会生成独立子目录，目录名默认取入口页面目录最后一级：

- `/games/Soccer_Free_Kick/index.html` -> `Soccer_Free_Kick`
- `/2312/Shots/index.html` -> `Shots`
- `/a/b/c/index.html` -> `c`

如果目录名无法安全推导，则降级为 `hostname + timestamp`。

## 文件保存规则

### 1. `allowed`

保留游戏目录下的相对路径。

示例：

- 页面：`https://jvliang.myfunmax.com/games/Soccer_Free_Kick/index.html`
- 图片：`https://jvliang.myfunmax.com/games/Soccer_Free_Kick/images/a.png`
- 保存为：

```text
./downloads/Soccer_Free_Kick/images/a.png
```

### 2. `cdnCandidate`

保存到 `__cdn__` 目录下。

示例：

```text
./downloads/Soccer_Free_Kick/__cdn__/cdn.example.com/assets/images/a.png
```

### 3. `uncertain`

保存到 `__uncertain__` 目录下。

示例：

```text
./downloads/Soccer_Free_Kick/__uncertain__/static.example.com/media/thumb.png
```

## 报告文件

每个游戏目录下会生成：

- `report.json`
- `candidates.txt`

### `report.json`

每条资源包含至少以下字段：

- `url`
- `normalizedUrl`
- `localPath`
- `origin`
- `hostname`
- `pathname`
- `contentType`
- `resourceType`
- `frameUrl`
- `category`
- `score`
- `reasons`
- `blockedReason`
- `downloaded`
- `downloadError`

### `candidates.txt`

按分类输出：

- `allowed`
- `cdnCandidate`
- `uncertain`
- `blocked`

每条记录至少包含：

- `score`
- `url`
- `reasons`

## 移动端模拟

某些 H5 游戏只在移动端布局下显示开始按钮、横屏提示或特定资源。

可以使用移动端模拟打开页面：

```bash
npm run download:game-images -- --mobile
```

指定具体设备：

```bash
npm run download:game-images -- --device="iPhone 13"
```

```bash
npm run download:game-images -- --device="Pixel 7"
```

移动端模拟使用 Playwright 的设备描述配置，通常会同时设置：

- `viewport`
- `userAgent`
- `isMobile`
- `hasTouch`
- `deviceScaleFactor`

## 自动启动点击

很多 H5 游戏在首屏不会立即进入游戏，而是要求用户点击：

- `Start`
- `Play`
- `Tap to Start`
- `Continue`

如果不点击，可能会漏掉后续懒加载的图片资源。

脚本默认会自动尝试启动游戏，策略如下：

1. 等待一段时间，默认 `3000ms`
2. 点击包含常见开始文本的元素
3. 点击按钮元素
4. 点击 `canvas` 中心
5. 点击页面中心

### 调整自动启动延迟

```bash
npm run download:game-images -- --auto-start-delay=5000
```

### 禁用自动启动

```bash
npm run download:game-images -- --no-auto-start
```

## 常用命令示例

### 1. 默认抓取

```bash
npm run download:game-images
```

### 2. 抓取单个游戏，输出到自定义目录

```bash
npm run download:game-images -- --url="https://example.com/game/index.html" --out="./downloads"
```

### 3. 移动端模拟 + 可视浏览器 + 自动启动

```bash
npm run download:game-images -- --mobile --wait=30000
```

### 4. review 模式，只做候选审查

```bash
npm run download:game-images -- --mode=review
```

### 5. smart 模式并下载 CDN 候选

```bash
npm run download:game-images -- --mode=smart --include-cdn
```

### 6. smart 模式并显式允许某些域名

```bash
npm run download:game-images -- --mode=smart --include-cdn --allow-domain="cdn.example.com,static.example.com"
```

### 7. 屏蔽特定域名

```bash
npm run download:game-images -- --block-domain="ads.example.com,tracker.example.com"
```

### 8. 覆盖已存在文件

```bash
npm run download:game-images -- --force
```

## 如果浏览器无法启动

### Linux / WSL 缺依赖

优先执行：

```bash
sudo npx playwright install-deps chromium
npx playwright install chromium
```

### 已有系统 Chrome / Chromium

可以指定现成浏览器：

```bash
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/google-chrome npm run download:game-images
```

或：

```bash
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser npm run download:game-images
```

## 自测与验证建议

当前脚本已经内置纯函数和报告生成自测逻辑，但真实验证仍建议这样做：

1. 先用 `strict` 跑一遍，确认低风险资源抓取结果
2. 再用 `review` 查看 `report.json` 和 `candidates.txt`
3. 最后按需开启：
   - `--include-cdn`
   - `--include-uncertain`
4. 如果页面需要启动交互，优先开启：
   - `--mobile`
   - 合适的 `--auto-start-delay`
   - 更长的 `--wait`

推荐验证命令：

```bash
npm run download:game-images -- --mobile --mode=review --wait=30000
```

## 已知限制

- 自动点击是通用启发式策略，不保证命中所有游戏的真实开始按钮
- 某些游戏可能需要多次点击、特定坐标或自定义 selector
- 某些资源可能依赖签名 URL、登录态、防盗链或 Service Worker，导致二次下载失败
- DOM 补扫不会深度解析所有外链 CSS 文件规则，网络监听仍是主数据源

## 维护建议

- 优先保持 `strict` 和 `review` 作为日常排查入口
- 遇到 CDN 误杀或漏抓时，先从 `report.json` 判断是评分问题还是黑名单问题
- 新增特定游戏适配时，优先通过参数扩展而不是写死站点规则

