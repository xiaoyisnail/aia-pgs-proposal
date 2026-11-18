# AIA HK iPGS+ Proposal Automation

一个面向 AI Agent 的跨平台 Skill：既能用独立 Google Chrome 自动完成香港友邦
Agency Corner 会话复用、iPGS+ 填表和计划书 PDF 保存，也能直接读取
用户已有的储蓄险计划书 PDF，生成 IRR Excel、收益说明图与多方案分析书。

当前版本：`v1.2.0`。

> 本项目不是 AIA 官方产品。仅供拥有合法 Agency Corner 与 iPGS+ 使用权限的人员
> 使用，并应遵守所属机构的安全、隐私与业务规范。

## 能做什么

- 复用独立 Chrome 中的 Agency Corner 会话。未登录时提醒用户手动完成登录。
- 已出生的受保人遇到「为未出生孩子购买保险」弹窗时选择「否」。
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
- 自动验证关键页面状态，按简体产品名归档有效 PDF。
- 储蓄险 PDF 生成后，自动提取“详细说明”逐年退保发还金额，生成同名 IRR
  Excel 表；危疾险不生成 IRR 表。
- 储蓄险额外生成一张适合查看和分享的 PNG 说明图；不提领和提领计划使用不同
  数据表与配色。
- 美元年缴保费达到 `50,000` 时自动进入大单模式：生成 1 份不提领和 5 份固定
  比例提领计划书、每份各自的 IRR 表、1 张不提领说明图，再汇总成一页储蓄险
  分析 PDF。
- 支持直接处理用户提供的现有储蓄险计划书 PDF：按要求生成 IRR Excel、简略
  收益说明图，或用多份计划书汇总分析 PDF，全程无需登录 AIA。
- 用香港和内地友邦重疾险 PDF 加指定汇率生成对比图，第 40 年起红字标注退保和
  保障金额倍数。[输入格式和命令](references/workflow.md#重疾险对比图)
- 只有内地方案图片时，也可用香港 PDF 加图片出对比图。可估算的缺值和用到估值的
  倍数会单独标明。[图片识别与平台说明](references/photo-comparison.md#自动出图)
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

## 运行环境与依赖

| 项目 | 要求 |
|------|------|
| AI Agent | 能读取本地 Skill、操作文件并执行命令行；可用于 WorkBuddy、Codex、Claude Code 等，不依赖 Agent 自带浏览器 |
| 操作系统 | macOS（Apple Silicon 或 Intel）或 Windows（ARM64 或 x64） |
| Google Chrome | 必须安装正式版 Chrome；自动化使用自己的 profile，不连接用户日常 Chrome |
| Node.js | Node.js 20 或以上；没有时 bootstrap 会下载并校验 Skill 私有 Node.js 22 |
| npm 依赖 | bootstrap 按 `package-lock.json` 自动安装 Playwright、PDF、Excel 和简繁转换依赖 |
| 业务网络 | 仅生成新计划书时需要香港网络；直接处理现有 PDF 不需要 |
| 业务账号 | 生成新计划书时需要可手动登录的 Agency Corner 账号 |
| 人工操作 | 生成新计划书时确认香港网络，遇到登录页时在独立 Chrome 完成登录 |
| Office/PDF 软件 | 生成时不需要安装 Microsoft Excel 或 Adobe Acrobat；仅在用户查看文件时需要相应阅读软件 |

首次安装需要访问 GitHub、`nodejs.org` 和 npm 软件源。生成新计划书还需要访问
AIA 网站。

## 安装方式

### 推荐：让 Agent 自动安装

让 Agent 克隆本仓库，并把包含 `SKILL.md` 和 `package.json` 的仓库根目录作为
`aia-pgs-proposal` Skill。不同 Agent 的 Skill 目录不一样，因此优先让 Agent
自行识别安装位置，不要把仓库只复制到它无法读取的普通下载目录。

## 给 WorkBuddy 或其他 Agent 的最短安装提示词

把下面整段发给 Agent：

```text
请自动安装并运行这个 Skill：https://github.com/xiaoyisnail/aia-pgs-proposal

请自行识别当前 Agent 的自定义 Skill 安装方式，完整克隆这个仓库；如果没有 Git 就下载 main 分支 ZIP。把同时包含 SKILL.md 和 package.json 的仓库根目录安装为 aia-pgs-proposal Skill，不要让我手工执行安装命令。

安装后按 SKILL.md 根据我的请求运行。生成新计划书时自动准备环境，看到 MANUAL_LOGIN_REQUIRED 就暂停自动操作，提醒我在独立 Chrome 手动登录，登录后继续。如果我提供已有储蓄险计划书 PDF，请走 PDF 模式，直到出现 PDF_TOOLS_OK。不要在聊天中索要任何密码、MFA 或 OTP，也不要操作我日常使用的 Chrome。

初始化成功后，告诉我以后如何用一句话生成新计划书，或直接提交 PDF 生成配套文件。
```

### 手动安装

已经安装 Git 时：

```bash
git clone https://github.com/xiaoyisnail/aia-pgs-proposal.git
cd aia-pgs-proposal
```

没有 Git 时，可从 GitHub 下载 `main` 分支 ZIP 并完整解压。不要只下载
`SKILL.md`，脚本、锁定依赖、模板和资源文件都必须保留。

生成新计划书的首次初始化根据系统只运行一个入口：

```text
Windows CMD:
scripts\bootstrap.cmd

Windows PowerShell:
.\scripts\bootstrap.cmd

macOS Terminal:
bash scripts/bootstrap.sh
```

用户不需要预先安装 Node 或逐条执行 npm 命令。bootstrap 会：

1. 识别系统和 CPU 架构。
2. 优先复用 Node 20+，否则在 `.runtime/node` 安装并校验 Skill 私有 Node 22。
3. 安装 `package-lock.json` 锁定的 Playwright。
4. 检查 Google Chrome；缺失时尝试官方安装。
5. 验证自动化 profile 与日常 Chrome 完全隔离。
6. 在香港网络下打开 Agency Corner。已有会话直接继续，未登录时等待用户在
   独立 Chrome 手动登录。

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

美元年缴达到 50,000 时无需选择单一提领方案：脚本会自动生成参考分析所需的
不提领基准与五档提领方案。

### 储蓄险交付规则

| 用户需求 | 最终交付 |
|----------|----------|
| 美元年缴低于 50,000、不提领 | 1 份无提领计划书 PDF、1 份详细 IRR Excel、1 张无提领收益说明图 |
| 美元年缴低于 50,000、同额提领 | 1 份带提领计划书 PDF、1 份详细 IRR Excel、1 张带提领收益说明图 |
| 美元年缴达到或超过 50,000 | 6 份计划书 PDF（不提领 + 五档提领）、6 份详细 IRR Excel、1 张无提领收益说明图、1 份大单储蓄分析 PDF |

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

# 清除独立 Chrome 的 AIA 会话，手动登录后生成
npm run generate:fresh -- params.json

# 为已有储蓄险 PDF 生成或重建 IRR 配套文件
npm run irr -- "计划书/环宇盈活/某份计划书.pdf"
```

## 直接处理用户提供的计划书 PDF

这种模式不会登录 Agency Corner、Outlook 或 iPGS+，也不需要香港网络；只启动
独立的 Chrome 后台进程来渲染 PNG/PDF，不连接用户日常 Chrome。首次使用按平台
运行轻量初始化：

```text
Windows: scripts\bootstrap.cmd --pdf-only
macOS:   bash scripts/bootstrap.sh --pdf-only
```

出现 `PDF_TOOLS_OK` 后即可处理。单份 PDF 默认生成详细 IRR 表和对应类型的
简略收益说明图：

```bash
npm run from-pdf -- "/路径/某份储蓄险计划书.pdf"
```

也可只生成用户指定的结果：

```bash
npm run from-pdf -- --irr "/路径/计划书.pdf"
npm run from-pdf -- --summary --output-dir "/路径/结果" "/路径/计划书.pdf"
```

分析书需要用户提供 2–6 份 PDF：恰好 1 份不提领基准和 1–5 份“每年相同金额
提领”计划。脚本按 PDF 内容自动识别基准/提领并按实际起始年度排序，输入顺序
不限；所有计划必须是同一美元储蓄产品，且货币、投保年龄、实际年缴保费和缴费
年期一致。6 份（基准 + 5 档）最完整地对应参考分析书版式。

```bash
npm run from-pdf -- --analysis --insured-name "张先生" \
  "/路径/不提领.pdf" "/路径/提领方案1.pdf" "/路径/提领方案2.pdf"
```

如需同时为每份 PDF 生成 IRR 表、说明图并汇总分析书：

```bash
npm run from-pdf -- --all --output-dir "/路径/结果" \
  "/路径/不提领.pdf" "/路径/提领方案1.pdf" [...]
```

默认输出在源 PDF 同目录，`--output-dir` 可统一指定结果目录，
`--analysis-output "/路径/分析书.pdf"` 可单独指定分析书文件名。脚本不会修改
或移动源 PDF；输入无效、混入不同方案或字段不一致时会明确报错，不会估算补数。

浏览器生成的新计划书默认保存到 Skill 根目录的 `计划书/{简体产品名}/`，目录名
和文件名全部使用简体字：

```text
危疾险:
计划书/{产品}/{产品}_{性别}{年龄}岁_{地区}_USD{保额}_{年期}年缴.pdf

储蓄险不提领:
计划书/{产品}/{产品}_{性别}{年龄}岁_{地区}_{货币代码}{预算年保费}每年_{年期}年缴_不提取.pdf

储蓄险同额提领:
..._第{起始}至{终止/最后}年每年提取{货币代码}{金额}_减少基本金额.pdf

储蓄险 IRR:
{同一份计划书文件名（不含.pdf）}_IRR表.xlsx

储蓄险 IRR 说明图:
{同一份计划书文件名（不含.pdf）}_IRR说明图.png

美元大单储蓄分析书:
{不提领计划书文件名（不含.pdf）}_大单储蓄分析书.pdf
```

IRR 使用 PDF 首页的实际年缴保费和缴费年期，而不是文件名里的预算金额；逐年
退保价值取自“详细说明”的“退保发还金额总额”。现金流口径为保单年度期初缴费、
期末退保。含提领安排的 PDF 当前仍按“详细说明”基础计划口径计算，不把提取金额
计入 Excel 的基础计划 IRR，工作簿内会明确提示。说明图不显示具体产品名，统一
显示“香港友邦储蓄保险计划”和投保年龄。不提领图展示回本期、关键退保金额及
IRR 里程碑；提领图读取主情景“现金提取后之退保发还金额”，展示提领期间、每年
提取、累计提取、合计总额、总保费倍数及包含提取现金流的综合 IRR。

美元年缴达到 50,000 时，`npm run generate` 会先从不提领 PDF 读取实际年缴保费，
再以实际总保费的 `6.4% / 8.8% / 11.6% / 16.2% / 22%` 计算五档每年提领金额，
分别从第 `6 / 11 / 15 / 20 / 25` 个保单年度开始并提领至最后年度。分析书中的
累计提取、终止年龄退保价值、人寿保障和退保价值全部来自 6 份实际计划书；缺少
任一份或逐年数据不连续时不会生成分析书。大单五档提领只供分析书汇总，不再
分别生成五张提领说明图。

参考 PDF 底部的产品特点图只适用于“环宇盈活”；其他储蓄产品沿用相同数值版式和
配色，但改用中性条款提示，避免把环宇盈活的专属权益错误套到其他产品。

## 安全设计

- 不使用 CDP、9223 调试端口或 Agent 自带浏览器连接日常 Chrome。
- 自动化 Chrome 使用独立 profile；代码会拒绝日常 Chrome 目录及重叠路径。
- 不执行 `pkill`、`killall` 或 `taskkill` 清理 Chrome。
- 账号、密码及站点要求的验证均由用户在独立 Chrome 中完成。
- `params.json`、`.runtime/`、`计划书/`、PDF、XLSX、`.env` 和本地凭据文件均被
  Git 忽略。

不同机器不得复制密码文件或 Chrome profile；每台机器应独立完成首次初始化。

## 限制与业务前提

- 运行环境必须满足上方“运行环境与依赖”中的要求。
- 当前仅支持危疾保障和储蓄保险分类。
- 当前储蓄险提领只支持同额提领、0% 增长率和“减少基本金额”。
- iPGS+ 页面与产品可能更新；未通过路由、字段或 PDF 校验时流程会停止，不会猜测。

## 实测耗时

以下为 macOS 历史端到端测试记录：

- 单份无提领或同额提领通常约 `2–2.5` 分钟。
- 最终验收中，GF 年缴 40,000 美元无提领为 `143.4` 秒，同额提领为 `135.7` 秒。
- 大单六方案无重试最终验收为 `14 分 14 秒`；另一次真实整批回归因 iPGS+
  瞬态触发 3 次自动重试，最终用时约 `21 分 42 秒` 并成功输出分析书。
- 已完成初始化后的 bootstrap 快速自检约 `0.6` 秒。

当前流程耗时取决于网络、手动登录和 iPGS+ 服务端计算。

## 开发与验证

```bash
npm run check
npm test
python3 /path/to/skill-creator/scripts/quick_validate.py .
```

当前自动测试覆盖 OTP 提取、登录状态、Windows/macOS 路径与凭据模式、Chrome
profile 隔离、首次初始化脚本、参数硬门、产品分类流程、简体归档规则、IRR
现金流、说明图节点选择、五档比例、已有 PDF 分流和分析书真实数据汇总。

## 项目结构

| 路径 | 用途 |
|------|------|
| [`SKILL.md`](SKILL.md) | Agent 的核心执行规则 |
| [`USAGE.md`](USAGE.md) | 完整使用说明、示例与排错 |
| [`scripts/onboard.mjs`](scripts/onboard.mjs) | 幂等首次初始化状态机 |
| [`scripts/login-agency.mjs`](scripts/login-agency.mjs) | Agency 会话检测与手动登录等待 |
| [`scripts/generate-proposal.mjs`](scripts/generate-proposal.mjs) | iPGS+ 填表与 PDF 生成 |
| [`scripts/generate.mjs`](scripts/generate.mjs) | 单份/大单六方案自动分流 |
| [`scripts/generate-large-savings.mjs`](scripts/generate-large-savings.mjs) | 六份计划书顺序生成与结果验收 |
| [`scripts/savings-analysis.mjs`](scripts/savings-analysis.mjs) | 五档方案汇总与分析 PDF 渲染 |
| [`scripts/irr-report.mjs`](scripts/irr-report.mjs) | 储蓄险 PDF 解析与 IRR Excel 生成 |
| [`scripts/process-existing-proposals.mjs`](scripts/process-existing-proposals.mjs) | 已有 PDF 的 IRR、说明图和分析书统一入口 |
| [`scripts/irr-summary-image.mjs`](scripts/irr-summary-image.mjs) | 不提领/提领两套数据说明图渲染 |
| [`scripts/proposal-files.mjs`](scripts/proposal-files.mjs) | 简体命名与产品目录规则 |
| [`scripts/organize-proposals.mjs`](scripts/organize-proposals.mjs) | 现有计划书归档工具 |
| [`references/onboarding.md`](references/onboarding.md) | 初始化细节与错误恢复 |
| [`references/products.md`](references/products.md) | 产品发现与验证状态 |
| [`references/workflow.md`](references/workflow.md) | 页面状态和字段参考 |
| [`examples/`](examples/) | 两类计划书参数模板 |
| [`tests/`](tests/) | 自动化回归测试 |

更多参数示例与错误代码见 [USAGE.md](USAGE.md)。
