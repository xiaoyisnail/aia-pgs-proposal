# AIA iPGS+ 自动生成计划书使用说明

本 Skill 按香港友邦 iPGS+ 的危疾保障和储蓄保险两类参数模型动态选择具体产品，
可自动完成 Agency Corner 登录、Outlook OTP、iPGS+ 填表和 PDF 保存。已完整
生成验证 OYS2、EOYS、GF 和 GP3；其他同类产品会在运行时检查共同字段和可选项。

## 最简使用方式

使用者开始时只需告诉 Agent：

```text
我要生成一份重疾险计划书
```

或：

```text
我要生成一份储蓄险计划书
```

Agent 会继续询问具体产品名称，再按险种询问相关参数。不能把“重疾险”默认成
OYS2，也不能把“储蓄险”默认成 GF。储蓄险不会询问吸烟、危疾保额或额外保费；
重疾险不会询问预算每年保费。未成年受保人会继续询问不同保单持有人的资料。

收到回答后，Agent 必须先运行参数校验，再检查设备环境。只有分别出现
`PARAMS_OK` 和 `SETUP_OK`，并确认香港网络已连接后，才会启动独立 Chrome 生成
计划书。使用者不需要自己编写 JSON 或操作网页。

## 1. 前置条件

- Node.js 20 或更高版本
- Google Chrome
- 可访问 AIA Agency Corner 的香港网络出口
- Agency Corner 账号
- 已能登录并接收 OTP 的 Outlook 邮箱

自动化会启动自己的 Chrome 和持久化 profile。用户可以继续使用日常 Chrome；
脚本不会连接、关闭、重启、清 Cookie 或修改用户已经打开的 Chrome。

Agent 应先运行：

```bash
node --version
npm --version
npm run setup:check
```

`setup:check` 会一次列出 Node、Chrome、Playwright、Chrome profile 隔离、Agency
账号配置和自动化 profile 的状态。每个不满足项都带有“处理”指引；看到
`SETUP_NOT_READY` 时不能继续生成。

如果 `node` 或 `npm` 命令不存在，先安装 Node.js 20 或更高版本并重新打开终端。
如果未找到 Chrome，先安装正式版 Google Chrome，或在 Skill 根目录运行
`npm run setup:chrome`。

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

复制对应产品的示例，建立不提交到 Git 的 `params.json`。未成年受保人必须填写
不同保单持有人的资料。`productName` 必填，`productCode` 可选；使用者不需要知道
内部代码。

如果产品名称不明确，可以运行：

```bash
npm run products:list -- params.json
```

命令会进入指定分类并输出当前可见产品卡后退出，不会选择产品或生成 PDF。同代码
存在多个货币版本时，脚本会要求更完整的名称，不能自动选择第一张。实时发现的
产品快照及验证状态见 `references/products.md`。

首次使用标记为“未完整生成”的产品时，先运行：

```bash
npm run product:inspect -- params.json
```

它会选择产品并输出基本计划字段后退出。缺少分类共同必需字段时应停止适配，不能
跳过页面校验直接生成。

### 危疾险示例

使用 `examples/oys2-minor.json`：

```json
{
  "productType": "criticalIllness",
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

EOYS「簡緻 • 愛伴航」使用 `examples/eoys-critical-minor.json`，字段模型相同；
EOYS 不提供“额外保费”控件，参数为 `false` 时脚本会验证后跳过。

### 储蓄险示例

使用 `examples/gf-savings-child.json`：

```json
{
  "productType": "savings",
  "gender": "男",
  "age": 3,
  "region": "中華人民共和國",
  "premiumTerm": 5,
  "annualPremium": 50000,
  "currency": "美元",
  "sameAsInsured": false,
  "insuredSurname": "vip",
  "insuredGivenName": "vip",
  "payorSurname": "vip",
  "payorGivenName": "vip",
  "payorGender": "男",
  "payorAge": 35,
  "payorRegion": "中華人民共和國",
  "productName": "環宇盈活",
  "productCode": "GF"
}
```

GP3“盈御3”使用 `examples/gp3-savings-child.json`。该示例只提供
`productName: "盈御3"`，脚本会动态匹配页面上的 GP3 产品卡。

储蓄险的 `annualPremium` 是“预算每年保费”目标。脚本会点击页面上的
`預算每年保費`，在弹窗中输入金额并让 iPGS+ 计算基本金额；不会把该金额误填进
基本金额字段。产品计算可能产生小额舍入差异：实测目标 50,000 美元时，PDF
年缴保费为 50,000.09 美元。

地区只接受 `中華人民共和國`、`香港` 或 `澳門`。货币和缴费年期必须是所选产品
页面实际提供的值；不支持的组合会在填写阶段明确停止。

## 5. 生成计划书

Agent 将用户回答保存为 `params.json` 后，先执行不会启动浏览器的校验：

```bash
npm run params:check -- params.json
npm run setup:check
```

只有两个命令分别输出 `PARAMS_OK` 和 `SETUP_OK` 时，才进行日常生成：

```bash
npm run generate -- params.json
```

需要重新验证完整登录、OTP 和生成链路时：

```bash
npm run generate:fresh -- params.json
```

`generate:fresh` 只清除 AIA session，不会清除 Outlook session，也不会影响用户
日常 Chrome。

PDF 默认保存到当前用户的 `Downloads` 目录：

```text
危疾险: {产品}_{性别}{年龄}岁_{地区}_USD{保额}_{年期}年缴.pdf
储蓄险: {产品}_{性别}{年龄}岁_{地区}_USD{预算每年保费}每年_{年期}年缴.pdf
```

## 6. 实测耗时

在 macOS、Outlook 已初始化、重新走 Agency 登录和 OTP 的真实测试中：

| 产品与测试 | 脚本总耗时 |
|------------|------------|
| OYS2 第 1 轮 | 107.2 秒 |
| OYS2 第 2 轮 | 110.7 秒 |
| OYS2 v0.8 回归 | 104.9 秒 |
| EOYS 完整生成 | 106.8 秒 |
| GF v0.8 回归 | 116.3 秒 |
| GP3 仅按“盈御3”名称匹配并完整生成 | 105.6 秒 |

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
- `SETUP_NOT_READY`：逐项完成每个 `❌` 下面的“处理”指引。
- `PARAMS_*` / `PRODUCT_UNSUPPORTED`：修正输出指定的字段，重新运行
  `npm run params:check -- params.json`。
- `PRODUCT_CARD_NOT_FOUND`：运行 `products:list`，核对分类和产品名称。
- `PRODUCT_AMBIGUOUS`：提供更完整的名称、货币版本或输出中的产品代码。
- `PRODUCT_OPTION_UNAVAILABLE`：该产品没有使用者要求的可选项，不能绕过。
- `CURRENCY_NOT_AVAILABLE` / `PAYMENT_FREQUENCY_UNAVAILABLE`：修正为产品页面
  实际提供的货币、年期或缴费组合。
- `AGENCY_PASSWORD_REQUIRED`：macOS/Windows 重新运行 setup；Linux 在自动化窗口输入。
- `OUTLOOK_NOT_READY`：在自动化 Chrome 中重新完成 Outlook 登录。
- `OTP_EMAIL_TIMEOUT`：检查是否收到与页面参考编号一致的 OTP 邮件。
- `STEP3_*`：基本计划字段或持有人资料没有通过页面校验。
- `ANNUAL_PREMIUM_BUTTON_NOT_FOUND`：该储蓄产品没有共同的“预算每年保费”流程。
- `ANNUAL_PREMIUM_NOT_SET`：预算弹窗没有成功回读金额。
- `ANNUAL_PREMIUM_CALCULATION_TIMEOUT`：预算计算后弹窗未关闭或基本金额为空。
- `STEP6_CONFIRM_TIMEOUT`：iPGS+ 服务端没有完成计划书计算，不要连续点击下一步。
- `PDF_INVALID`：文件没有通过 PDF 头和大小检查，不应交付。

更详细的页面状态和字段对照见 `references/workflow.md`。
