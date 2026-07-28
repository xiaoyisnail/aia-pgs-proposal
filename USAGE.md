# AIA iPGS+ 自动生成计划书使用说明

本 Skill 当前支持香港友邦 iPGS+ 的危疾险「愛伴航」保險計劃 2（OYS2），
可自动完成 Agency Corner 登录、Outlook OTP、iPGS+ 填表和 PDF 保存。

## 1. 前置条件

- Node.js 20 或更高版本
- Google Chrome
- 可访问 AIA Agency Corner 的香港网络出口
- Agency Corner 账号
- 已能登录并接收 OTP 的 Outlook 邮箱

自动化会启动自己的 Chrome 和持久化 profile。用户可以继续使用日常 Chrome；
脚本不会连接、关闭、重启、清 Cookie 或修改用户已经打开的 Chrome。

## 2. 下载与安装

```bash
git clone https://github.com/xiaoyisnail/aia-pgs-proposal.git
cd aia-pgs-proposal
npm install
```

如果环境检查提示没有 Chrome：

```bash
npm run setup:chrome
```

## 3. 首次配置

Agent 只应向用户询问 Agency Corner 登录账号/用户编号，不得在聊天中询问密码、
Outlook 密码、MFA 或 OTP。

```bash
npm run setup -- --username "<Agency 用户编号>"
npm run setup:outlook
npm run login:fresh
```

各命令作用：

- `setup`：保存用户编号，并通过 macOS Keychain 或 Windows DPAPI 安全保存密码。
  Linux 不保存密码，登录时由用户在独立自动化 Chrome 中手动输入。
- `setup:outlook`：打开独立自动化 Chrome。用户在这个窗口完成 Outlook 登录和
  MFA，看到终端输出 `OUTLOOK_OK` 后即可关闭。
- `login:fresh`：保留 Outlook session，只清除 AIA session，验证用户名、密码、
  OTP 和 Agency Corner 首页全流程。成功标志为 `LOGIN_OK`。

每台新电脑都必须重新配置，不能复制其他电脑的密码文件或 Chrome profile。

## 4. 准备计划书参数

复制 `examples/oys2-minor.json` 的内容，建立不提交到 Git 的 `params.json`。
未成年受保人必须填写不同保单持有人的资料。

```json
{
  "gender": "女",
  "age": 1,
  "region": "中華人民共和國",
  "smoking": false,
  "sumAssured": 300000,
  "premiumTerm": 25,
  "extraPremium": false,
  "sameAsInsured": false,
  "insuredSurname": "vip",
  "insuredGivenName": "vip",
  "payorSurname": "vip",
  "payorGivenName": "vip",
  "payorGender": "男",
  "payorAge": 35,
  "payorRegion": "中華人民共和國",
  "productName": "愛伴航2",
  "productCode": "OYS2"
}
```

地区只接受 `中華人民共和國`、`香港` 或 `澳門`。当前只支持 `OYS2`。

## 5. 生成计划书

日常运行：

```bash
npm run setup:check
npm run generate -- params.json
```

需要重新验证完整登录、OTP 和生成链路时：

```bash
npm run generate:fresh -- params.json
```

`generate:fresh` 只清除 AIA session，不会清除 Outlook session，也不会影响用户
日常 Chrome。

PDF 默认保存到当前用户的 `Downloads` 目录，文件名格式为：

```text
{产品}_{性别}{年龄}岁_{地区}_USD{保额}_{年期}年缴.pdf
```

## 6. 实测耗时

在 macOS、Outlook 已初始化、每次重新走 Agency 登录和 OTP 的两轮真实测试中：

| 测试 | 脚本总耗时 |
|------|------------|
| 第 1 轮 | 107.2 秒 |
| 第 2 轮 | 110.7 秒 |
| 平均 | 约 109 秒 |

因此完整生成一份计划书通常按 **约 1 分 50 秒** 估算，建议预留 2 分钟。
网络、OTP 邮件到达速度和 iPGS+ 服务端计算会造成波动。首次 Outlook 登录及 MFA
所需的人工时间不包含在上述数据中。

## 7. Chrome 隔离规则

- 不要使用 CDP、9223 调试端口或 Agent 自带的 Chrome 控制连接用户现有 Chrome。
- 不要把 `AIA_PGS_PROFILE_DIR` 指向日常 Chrome 用户目录、其子目录或上级目录。
- 不要执行 `pkill`、`killall` 或 `taskkill` 清理 Chrome。
- 遇到 `BROWSER_PROFILE_IN_USE` 时，只关闭本 Skill 创建的自动化 Chrome。
- 遇到 `DEFAULT_CHROME_PROFILE_FORBIDDEN` 时，修正 profile 路径，不能绕过保护。

## 8. 验证与排错

```bash
npm run check
npm test
npm run setup:check
```

常见错误：

- `AGENCY_USERNAME_REQUIRED`：重新运行 `npm run setup`。
- `AGENCY_PASSWORD_REQUIRED`：macOS/Windows 重新运行 setup；Linux 在自动化窗口输入。
- `OUTLOOK_NOT_READY`：在自动化 Chrome 中重新完成 Outlook 登录。
- `OTP_EMAIL_TIMEOUT`：检查是否收到与页面参考编号一致的 OTP 邮件。
- `STEP3_*`：基本计划字段或持有人资料没有通过页面校验。
- `STEP6_CONFIRM_TIMEOUT`：iPGS+ 服务端没有完成计划书计算，不要连续点击下一步。
- `PDF_INVALID`：文件没有通过 PDF 头和大小检查，不应交付。

更详细的页面状态和字段对照见 `references/workflow.md`。
