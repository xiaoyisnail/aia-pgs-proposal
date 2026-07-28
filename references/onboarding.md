# 首次初始化参考

仅在新机器初始化、`ONBOARDING_*` 失败或环境发生变化时读取本文。

## 自动入口

在 Skill 根目录执行：

```text
Windows: scripts\bootstrap.cmd --username "<Agency 用户编号>"
macOS:   bash scripts/bootstrap.sh --username "<Agency 用户编号>"
```

账号已保存时省略 `--username`。不要要求使用者先安装 Node 或手动运行多条 npm
命令。bootstrap 可重复执行；成功机器只快速检查，不重复 Outlook 初始化。

## 确定性顺序

1. 识别 Windows/macOS 和 CPU 架构。
2. 优先使用系统 Node 20+；否则从 Node.js 官方 `latest-v22.x` 下载到
   Skill 根目录的 `.runtime/node`，按官方 `SHASUMS256.txt` 校验。
3. 对比本地 Playwright 与 `package.json` 锁定版本；缺失或不一致时运行 `npm ci`。
4. 检测正式版 Chrome；仅在完全未检测到时运行 `playwright install chrome`。
5. 拒绝任何与日常 Chrome 用户目录重叠的自动化 profile。
6. 保存 Agency 用户编号。密码只进入 macOS Keychain 或当前 Windows 用户绑定的
   DPAPI 文件，聊天、命令参数和日志都不得包含密码。
7. 启动独立 Chrome，等待使用者完成 Outlook 登录/MFA，直到 `OUTLOOK_OK`。
8. 等使用者确认香港网络后，清除 AIA Cookie、保留 Outlook session，完成一次
   用户名→密码→OTP→Agency Corner home 验证，直到 `LOGIN_OK`。
9. `setup:check` 输出 `SETUP_OK` 后写入本机 onboarding 标记并输出
   `ONBOARDING_OK`。

不同电脑不得复制 `.runtime`、密码文件或 Chrome profile；每台机器独立执行。

## 允许的人工动作

- 提供 Agency 用户编号；它不是密码。
- 在操作系统安全输入框中输入 Agency 密码。
- 在独立自动化 Chrome 中输入 Outlook 凭据及 MFA。
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
| `ACCOUNT_SETUP_FAILED` | 只修正账号格式；密码仍由安全输入框收集 |
| `OUTLOOK_SETUP_FAILED` | 在独立 Chrome 完成 Outlook 登录/MFA |
| `HK_NETWORK_REQUIRED` | 连接香港网络后重新运行 bootstrap |
| `AGENCY_LOGIN_VERIFICATION_FAILED` | 保留 Outlook session，检查 Agency 凭据与 OTP 邮件 |
| `SETUP_CHECK_FAILED` | 按 `setup:check` 输出逐项修复，不开始生成 |
