# 爱学习

本项目是一个本地 CLI 工具，用 Chrome 浏览器辅助完成学习强国 PC 端的日常任务。

当前已实现：
- 登录状态检查与扫码登录提示
- 每日答题支持人工模式与半自动辅助模式
- 视频任务自动完成
- 文章任务自动完成
- 7 天历史去重

## 环境要求

- [Bun](https://bun.sh)
- Google Chrome
- macOS / Linux / Windows 之一

## 安装

```bash
bun install
```

## 运行

```bash
bun run src/index.ts
```

## 配置

配置文件为 `config.yaml`。

示例：

```yaml
viewport:
  width: 1920
  height: 1080

chromePath: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome

browserProfile:
  strategy: system
  profileDirectory: Default

logRetentionDays: 365
quiz:
  mode: manual
  videoPreviewSeconds: 20
```

配置项说明：

- `viewport.width` / `viewport.height`
  Chrome 窗口渲染尺寸。
- `chromePath`
  Chrome 可执行文件路径。留空时自动探测。
- `browserProfile.strategy`
  可选 `system` 或 `local`。
  `system` 表示优先复用系统 Chrome 用户数据目录；
  `local` 表示使用项目内独立数据目录。
- `browserProfile.userDataDir`
  可选，显式指定 Chrome 用户数据目录。
- `browserProfile.profileDirectory`
  可选，指定 Chrome Profile 名称，例如 `Default`、`Profile 1`。
- `logRetentionDays`
  日志文件保留天数，单位为天。默认 `365`。设为 `0` 时不保存日志文件。
- `quiz.mode`
  可选 `manual` 或 `semi-auto`。默认 `manual`。
- `quiz.videoPreviewSeconds`
  半自动答题检测到题中视频时，自动预播的秒数。

## Chrome Profile 策略

默认策略为 `system`，即优先复用系统 Chrome 的现有用户数据目录与指定 Profile。

这更贴近日常使用环境，但需要注意：

- 如果系统 Chrome 正在占用同一 Profile，启动可能失败或复用行为不稳定。
- 如果你想使用项目独立的浏览器数据目录，请设置：

```yaml
browserProfile:
  strategy: local
  userDataDir: ./chrome_data
  profileDirectory: Default
```

## 运行数据

运行时会使用这些目录：

- `data/history.json`
  文章和视频历史记录，保留 7 天。
- `chrome_data/`
  仅在 `browserProfile.strategy: local` 时使用。
- `logs/`
  每次运行完成后输出一份运行日志，目录结构为 `logs/YYYY-MM-DD/run-HHMMSS.log`。

这些运行时文件都应忽略，不提交到仓库。

## 测试

```bash
bun test
bunx tsc --noEmit
```

## 当前限制

- 每日答题的半自动模式目前只完成单题辅助：进入题页、读取题型、抓提示、输出建议答案，并在你确认后提交当前题目。
- 当前主要通过控制台输出运行状态。
- 日志在运行结束时落盘；如果 `logRetentionDays: 0`，则仅输出到终端。
