# 首次初始化参考

仅在新机器初始化、`ONBOARDING_*` 失败或环境发生变化时读取本文。

## 自动入口

在 Skill 根目录执行：

```text
Windows: scripts\bootstrap.cmd
macOS:   bash scripts/bootstrap.sh
```

bootstrap 可重复执行。已完成初始化的机器只快速检查本地环境。

如果用户只需要处理本地资料，例如已有计划书的 IRR、说明图、分析书，或用已有香港
重疾险计划书与内地 PDF／图片做对比，改用：

```text
Windows: scripts\bootstrap.cmd --pdf-only
macOS:   bash scripts/bootstrap.sh --pdf-only
```

该入口只准备 Node、锁定依赖和正式版 Chrome，输出 `PDF_TOOLS_OK` 后结束；不得
索要 Agency 账号，也不需要 Outlook、香港网络或完整 onboarding 标记。

## 确定性顺序

1. 识别 Windows/macOS 和 CPU 架构。
2. 优先使用系统 Node 20+；否则从 Node.js 官方 `latest-v22.x` 下载到
   Skill 根目录的 `.runtime/node`，按官方 `SHASUMS256.txt` 校验。
3. 对比本地 Playwright 与 `package.json` 锁定版本；缺失或不一致时运行 `npm ci`。
4. 检测正式版 Chrome；仅在完全未检测到时运行 `playwright install chrome`。
5. 拒绝任何与日常 Chrome 用户目录重叠的自动化 profile。
6. 检查本地环境并确认香港网络，在独立 Chrome 打开 Agency Corner。
7. 未登录时输出 `MANUAL_LOGIN_REQUIRED`。提醒使用者在该窗口完成登录，保持脚本
   运行，等待进入 Agency 首页并输出 `LOGIN_OK`。
8. 写入本机 onboarding 标记并输出 `ONBOARDING_OK`。

不同电脑不得复制 `.runtime`、密码文件或 Chrome profile；每台机器独立执行。

## 允许的人工动作

- 在独立自动化 Chrome 中完成 Agency Corner 登录及站点要求的扫码或验证。
- 连接香港 VPN/香港网络并在终端输入 `y`。

Agent 不得在聊天中索取或读取密码、MFA、OTP，不得关闭或重启日常 Chrome。

## 状态恢复

| 错误 | 处理 |
|------|------|
| `PLATFORM_UNSUPPORTED` | 自动初始化仅支持 Windows/macOS |
| `BOOTSTRAP_TOOL_REQUIRED` | macOS 系统工具缺失；先完成系统更新再重试 |
| `NODE_ARCHIVE_NOT_FOUND` | 当前架构没有官方 Node 22 包；停止，不使用第三方下载 |
| `NODE_CHECKSUM_MISMATCH` | 删除本次临时下载后重试；不得运行未通过校验的 Node |
| `DEPENDENCY_INSTALL_FAILED` | 检查访问 npm registry 的网络后重试 bootstrap |
| `CHROME_INSTALL_FAILED` / `CHROME_NOT_FOUND` | 从 Google 官方安装 Chrome 后重试 |
| `MANUAL_LOGIN_TIMEOUT` | 重新运行并在独立 Chrome 完成手动登录 |
| `HK_NETWORK_REQUIRED` | 连接香港网络后重新运行 bootstrap |
| `AGENCY_LOGIN_VERIFICATION_FAILED` | 检查独立 Chrome 是否能打开 Agency Corner 并完成手动登录 |
| `SETUP_CHECK_FAILED` | 按 `setup:check` 输出逐项修复，不开始生成 |
