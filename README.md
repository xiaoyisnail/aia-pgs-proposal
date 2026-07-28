# AIA HK iPGS+ Proposal Automation

一个面向 AI Agent 的跨平台 Skill，用独立 Google Chrome 自动完成香港友邦
Agency Corner 登录、Outlook OTP、iPGS+ 填表和产品计划书 PDF 保存。

> 本项目不是 AIA 官方产品。仅供拥有合法 Agency Corner 与 iPGS+ 使用权限的人员
> 使用，并应遵守所属机构的安全、隐私与业务规范。

## 能做什么

- 自动登录 Agency Corner，并复用本机安全保存的账号配置。
- 从 Outlook 精确查找本轮参考编号对应的 OTP 邮件并提交验证码。
- 打开 iPGS+，按险种和产品名称动态匹配产品卡。
- 支持危疾险/重疾险计划书：
  - 受保人年龄、性别、地区、吸烟状态。
  - 保额、缴费年期、额外保费。
  - 未成年受保人与不同保单持有人资料。
- 支持储蓄险计划书：
  - 年龄、性别、地区、货币、缴费年期。
  - 通过“预算每年保费”弹窗输入目标年保费。
  - 不提领计划书。
  - 从指定保单年度到终止/最后年度，每年以相同目标金额提领。
  - 当前提领模式固定为 `0%` 增长率和“减少基本金额”。
- 自动验证关键页面状态，生成并保存有效 PDF 到本机 `Downloads`。
- Windows 与 macOS 首次运行自动检查并准备 Node、Playwright、Chrome 和登录环境。
- 使用独立的持久化 Chrome profile，不连接或影响用户日常 Chrome。

## 已验证范围

以下产品已完成真实端到端 PDF 生成：

| 分类 | 产品 | 状态 |
|------|------|------|
| 危疾保障 | OYS2「愛伴航」保險計劃 2 | 已验证 |
| 危疾保障 | EOYS「簡緻 • 愛伴航」保險計劃 | 已验证 |
| 储蓄保险 | GF 環宇盈活儲蓄保險計劃 | 已验证不提领与同额提领 |
| 储蓄保险 | GP3「盈御多元貨幣計劃 3」 | 已验证 |

iPGS+ 中其他危疾险和储蓄险产品会通过实时产品卡匹配与字段能力检查尝试处理，
但“已发现”不代表已经完成端到端验证。完整快照见
[产品清单与验证状态](references/products.md)。

## 给 WorkBuddy 或其他 Agent 的最短安装提示词

把下面整段发给 Agent：

```text
请自动安装并运行这个 Skill：https://github.com/xiaoyisnail/aia-pgs-proposal

请自行识别当前 Agent 的自定义 Skill 安装方式，完整克隆这个仓库；如果没有 Git 就下载 main 分支 ZIP。把同时包含 SKILL.md 和 package.json 的仓库根目录安装为 aia-pgs-proposal Skill，不要让我手工执行安装命令。

安装后立即调用 aia-pgs-proposal，严格按照 SKILL.md 自动完成本机环境检查、缺失环境准备和首次登录初始化，持续处理直到出现 ONBOARDING_OK。只有需要我进行系统安全密码输入、Outlook/MFA 登录或连接香港网络时再暂停提醒我。不要在聊天中索要、读取或记录任何密码、MFA、OTP，也不要连接、关闭或重启我日常使用的 Chrome。

初始化成功后，告诉我以后如何用一句话生成重疾险或储蓄险计划书。
```

## 首次初始化

Agent 会根据系统执行一个入口：

```text
Windows: scripts\bootstrap.cmd --username "<Agency 用户编号>"
macOS:   bash scripts/bootstrap.sh --username "<Agency 用户编号>"
```

用户不需要预先安装 Node 或逐条执行 npm 命令。bootstrap 会：

1. 识别系统和 CPU 架构。
2. 优先复用 Node 20+，否则在 `.runtime/node` 安装并校验 Skill 私有 Node 22。
3. 安装 `package-lock.json` 锁定的 Playwright。
4. 检查 Google Chrome；缺失时尝试官方安装。
5. 验证自动化 profile 与日常 Chrome 完全隔离。
6. 保存 Agency 用户编号，并通过 macOS Keychain 或 Windows DPAPI 保存密码。
7. 打开独立 Chrome，让用户自行完成 Outlook 登录与 MFA。
8. 在香港网络下验证 Agency 用户名、密码、OTP 和首页登录全流程。

首次成功会输出：

```text
ONBOARDING_OK
```

以后重复执行只做快速自检，并输出：

```text
ONBOARDING_ALREADY_OK
```

详细状态与恢复方法见[首次初始化参考](references/onboarding.md)。

## 日常使用

初始化完成后，用户只需说：

```text
帮我生成一份重疾险计划书
```

或：

```text
帮我生成一份储蓄险计划书
```

Skill 会按险种追问必要参数、检查输入、生成本地 `params.json`，然后自动完成浏览器
流程。用户无需自己操作 iPGS+。

### 危疾险参数

- 具体产品名称。
- 受保人姓、名、性别、年龄、地区。
- 是否吸烟。
- 保额（美元）。
- 缴费年期。
- 是否额外保费。
- 保单持有人是否与受保人相同；未成年受保人必须提供不同持有人的资料。

### 储蓄险参数

- 具体产品名称。
- 受保人姓、名、性别、年龄、地区。
- 货币、缴费年期、预算每年保费。
- 是否提领。
- 如提领：起始保单年度、终止保单年度或“最后年度”、每年目标金额。
- 保单持有人是否与受保人相同；未成年受保人必须提供不同持有人的资料。

## 手动命令

通常应由 Agent 运行这些命令：

```bash
# 检查本机状态
npm run setup:check

# 检查参数，不启动 Chrome
npm run params:check -- params.json

# 查看当前分类的实时产品
npm run products:list -- params.json

# 检查未完整验证产品的表单能力
npm run product:inspect -- params.json

# 日常生成
npm run generate -- params.json

# 清除 AIA session、保留 Outlook session，重新验证完整链路后生成
npm run generate:fresh -- params.json
```

PDF 默认保存到当前用户的 `Downloads`：

```text
危疾险:
{产品}_{性别}{年龄}岁_{地区}_USD{保额}_{年期}年缴.pdf

储蓄险不提领:
{产品}_{性别}{年龄}岁_{地区}_USD{预算年保费}每年_{年期}年缴_不提取.pdf

储蓄险同额提领:
..._第{起始}至{终止/最后}年每年提取USD{金额}_减少基本金额.pdf
```

## 安全设计

- 不使用 CDP、9223 调试端口或 Agent 自带浏览器连接日常 Chrome。
- 自动化 Chrome 使用独立 profile；代码会拒绝日常 Chrome 目录及重叠路径。
- 不执行 `pkill`、`killall` 或 `taskkill` 清理 Chrome。
- Agency 密码只进入 macOS Keychain 或当前 Windows 用户绑定的 DPAPI。
- Outlook 密码与 MFA 只由用户在独立 Chrome 中输入。
- OTP 必须同时匹配本轮 SSO 参考编号，不接受任意六位数字。
- 脚本不输出密码或完整 OTP。
- `params.json`、`.runtime/`、PDF、`.env` 和本地凭据文件均被 Git 忽略。

不同机器不得复制密码文件或 Chrome profile；每台机器应独立完成首次初始化。

## 环境与限制

- 支持 Windows 与 macOS。
- 必须能够使用 Google Chrome。
- 必须拥有有效的 Agency Corner 账号和可接收 OTP 的 Outlook 邮箱。
- 访问 iPGS+ 需要香港网络出口。
- 当前仅支持危疾保障和储蓄保险分类。
- 当前储蓄险提领只支持同额提领、0% 增长率和“减少基本金额”。
- iPGS+ 页面与产品可能更新；未通过路由、字段或 PDF 校验时流程会停止，不会猜测。

## 实测耗时

在 macOS、Outlook 已初始化且重新走 Agency 登录与 OTP 的测试中：

- 无提领计划书约 `105–117` 秒。
- GF 第 6 年至最后年度每年提取 USD 5,000 约 `137–139` 秒。
- 已完成初始化后的 bootstrap 快速自检约 `0.6` 秒。

网络、OTP 邮件和 iPGS+ 服务端计算会影响耗时。

## 开发与验证

```bash
npm run check
npm test
python3 /path/to/skill-creator/scripts/quick_validate.py .
```

当前自动测试覆盖 OTP 提取、登录状态、Windows/macOS 路径与凭据模式、Chrome
profile 隔离、首次初始化脚本、参数硬门和产品分类流程。

## 项目结构

| 路径 | 用途 |
|------|------|
| [`SKILL.md`](SKILL.md) | Agent 的核心执行规则 |
| [`USAGE.md`](USAGE.md) | 完整使用说明、示例与排错 |
| [`scripts/onboard.mjs`](scripts/onboard.mjs) | 幂等首次初始化状态机 |
| [`scripts/login-agency.mjs`](scripts/login-agency.mjs) | Agency 登录与 Outlook OTP |
| [`scripts/generate-proposal.mjs`](scripts/generate-proposal.mjs) | iPGS+ 填表与 PDF 生成 |
| [`references/onboarding.md`](references/onboarding.md) | 初始化细节与错误恢复 |
| [`references/products.md`](references/products.md) | 产品发现与验证状态 |
| [`references/workflow.md`](references/workflow.md) | 页面状态和字段参考 |
| [`examples/`](examples/) | 两类计划书参数模板 |
| [`tests/`](tests/) | 自动化回归测试 |

更多参数示例与错误代码见 [USAGE.md](USAGE.md)。
