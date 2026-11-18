# AIA iPGS+ 自动生成计划书使用说明

本 Skill 按香港友邦 iPGS+ 的危疾保障和储蓄保险两类参数模型动态选择具体产品，
可复用 Agency Corner 会话，未登录时等待用户手动登录，再完成 iPGS+ 填表和 PDF 保存。已完整
生成验证 OYS2、EOYS、GF 和 GP3；也可直接用已有储蓄险 PDF 生成 IRR 表、说明图
和多方案分析书，无需登录 AIA。

给 Windows WorkBuddy 或其它 Agent 只需这一句：

```text
请从 https://github.com/xiaoyisnail/aia-pgs-proposal 安装这个 Skill，并按 Skill 自动完成这台电脑的首次初始化。
```

Agent 安装后会自行判断 Windows/macOS、准备缺失的本地运行环境并引导三次必要的
安全人工操作，不需要给小白用户一串命令。

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
重疾险不会询问预算每年保费。储蓄险必须询问是否提领；选择提领时再询问起始
保单年度、终止保单年度或“最后年度”和每年目标金额。未成年受保人会继续询问
不同保单持有人的资料。

例外：美元年缴保费达到 50,000 时，Agent 只需告知将自动生成大单分析组合，
不再要求使用者选择一个单独提领方案；组合固定包含不提领和五档提领。

生成新计划书时，Agent 必须先运行参数校验，再检查设备环境。只有分别出现
`PARAMS_OK` 和 `SETUP_OK`，并确认香港网络已连接后，才会启动独立 Chrome 生成
计划书。用户直接提供 PDF 时则跳到第 4 节。使用者不需要自己编写 JSON 或操作网页。

## 1. 前置条件

- Windows 或 macOS
- Google Chrome；缺失时自动引导会尝试官方安装
- 生成新计划书时：可访问 AIA Agency Corner 的香港网络出口和 Agency Corner 账号
- 只处理现有 PDF 时：本地运行

自动化会启动自己的 Chrome 和持久化 profile。用户可以继续使用日常 Chrome；
脚本不会连接、关闭、重启、清 Cookie 或修改用户已经打开的 Chrome。

## 2. 下载与安装

让 Agent 从 GitHub 安装仓库为 Skill。Skill 根目录以同时存在 `SKILL.md` 和
`package.json` 为准，不依赖 WorkBuddy/Codex 的固定目录。

## 3. 首次配置

生成新计划书时按下方入口初始化。已有 PDF 模式按第 4 节执行。

```text
Windows: scripts\bootstrap.cmd
macOS:   bash scripts/bootstrap.sh
```

bootstrap 会准备 Node、锁定依赖和独立 Chrome，并在香港网络下验证 Agency 会话。
看到 `MANUAL_LOGIN_REQUIRED` 时，在独立 Chrome 手动登录，完成后自动继续。
看到 `ONBOARDING_OK` 即完成，之后启动会输出 `ONBOARDING_ALREADY_OK`。

每台新电脑都必须重新配置，不能复制其他电脑的密码文件或 Chrome profile。

## 4. 直接处理已有计划书 PDF

如果用户已经给出储蓄险计划书 PDF，Agent 直接走本节，不索要 Agency 账号，也
不要求 Outlook 登录或香港网络。首次根据平台执行：

```text
Windows: scripts\bootstrap.cmd --pdf-only
macOS:   bash scripts/bootstrap.sh --pdf-only
```

看到 `PDF_TOOLS_OK` 后，确认用户需要 IRR 表、简略收益说明图、分析书，或它们
的组合。单份 PDF 默认生成 IRR Excel 和说明图：

```bash
npm run from-pdf -- "/路径/计划书.pdf"
```

也可按需选择输出：

```bash
npm run from-pdf -- --irr "/路径/计划书.pdf"
npm run from-pdf -- --summary "/路径/计划书.pdf"
npm run from-pdf -- --all --output-dir "/路径/结果" \
  "/路径/不提领.pdf" "/路径/提领方案1.pdf" [...]
```

分析书接受 2–6 份 PDF：恰好 1 份不提领和 1–5 份每年同额提领计划。所有文件
必须属于同一美元储蓄产品，且货币、投保年龄、实际年缴保费和缴费年期一致。
文件顺序不限，脚本按内容识别和排序：

```bash
npm run from-pdf -- --analysis --insured-name "张先生" \
  "/路径/提领方案2.pdf" "/路径/不提领.pdf" "/路径/提领方案1.pdf"
```

默认输出到源 PDF 同目录；`--output-dir` 可统一指定结果目录，
`--analysis-output` 可指定分析书路径。脚本不会修改或移动源 PDF，也不会用
文件名或参考图估算缺失数据。6 份输入可完整呈现参考分析书的五档方案。

### 香港与内地重疾险对比

同时提供香港和内地友邦的两份重疾险 PDF，并说清楚换算汇率，例如「按 1 美元兑
6.66 元人民币生成重疾险对比图」。Agent 按 [对比图流程](references/workflow.md#重疾险对比图)
处理，交付三张 PNG：无产品名对比表、保额柱状图和退保发还金额柱状图。两张柱状图
均标注同年度退保 IRR，不能把保额当作计算 IRR 的收入。

如果只有内地方案图片，把图片和香港计划书 PDF 一起交给 Agent 即可。图片版默认
估算可补齐的缺值、标注估值和相关倍数，红字从第 35 年起。两种输入均使用香槟金深蓝版；
柱状图用斜纹及「估」标明估算金额，采用估值的倍数附「（估）」。
[图片取数、降级方式与参数](references/photo-comparison.md#自动出图)

## 5. 准备计划书参数

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
  "withdrawalPlan": {
    "enabled": false
  },
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

不提领必须明确使用 `"withdrawalPlan": { "enabled": false }`。同额提领使用
`examples/gf-savings-withdrawal-child.json`：

```json
{
  "withdrawalPlan": {
    "enabled": true,
    "startPolicyYear": 6,
    "endPolicyYear": "last",
    "annualAmount": 5000
  }
}
```

当前只支持“从起始保单年度到终止保单年度每年以相同目标金额提取”，固定使用
0% 提款增长率和“减少基本金额”。`"last"` 会读取该受保人及产品页面显示的最大
保单年度；例如 3 岁受保人的 GF 页面实测最大为第 97 保单年度，不能写死 99。
脚本会核对系统计算结果的首年、末年和完整年度数，再继续生成 PDF。

储蓄险的 `annualPremium` 是“预算每年保费”目标。脚本会点击页面上的
`預算每年保費`，在弹窗中输入金额并让 iPGS+ 计算基本金额；不会把该金额误填进
基本金额字段。产品计算可能产生小额舍入差异：实测目标 50,000 美元时，PDF
年缴保费为 50,000.09 美元。

当货币为美元且预算年缴达到 50,000 时，普通 `generate` 命令会自动进入大单
模式。它先生成不提领基准，从 PDF 读取实际年缴保费和缴费年期，再以实际总保费
的 6.4%、8.8%、11.6%、16.2%、22% 计算每年提领金额；五档分别从第
6、11、15、20、25 个保单年度开始，全部提领至页面最后年度。

地区只接受 `中華人民共和國`、`香港` 或 `澳門`。货币和缴费年期必须是所选产品
页面实际提供的值；不支持的组合会在填写阶段明确停止。

## 6. 生成计划书

Agent 将用户回答保存为 `params.json` 后，先执行不会启动浏览器的校验：

```bash
npm run params:check -- params.json
npm run setup:check
```

只有两个命令分别输出 `PARAMS_OK` 和 `SETUP_OK` 时，才进行日常生成：

```bash
npm run generate -- params.json
```

需要清除 AIA 会话并重新手动登录时：

```bash
npm run generate:fresh -- params.json
```

日常生成使用 `generate`。若打开页面时未登录，等待用户在独立 Chrome 完成登录。
已出生受保人遇到未出生投保弹窗时选「否」。未出生个案请在 iPGS+ 手动制作。

浏览器生成的新计划书默认保存到 Skill 根目录的 `计划书/{简体产品名}/`，目录名
和文件名统一使用简体字：

```text
危疾险: 计划书/{产品}/{产品}_{性别}{年龄}岁_{地区}_USD{保额}_{年期}年缴.pdf
储蓄险不提领: 计划书/{产品}/..._{年期}年缴_不提取.pdf
储蓄险同额提领: 计划书/{产品}/..._第{起始}至{终止/最后}年每年提取{货币代码}{金额}_减少基本金额.pdf
储蓄险 IRR: 与 PDF 同目录，{同一计划书文件名}_IRR表.xlsx
储蓄险 IRR 说明图: 与 PDF 同目录，{同一计划书文件名}_IRR说明图.png
美元大单分析书: 与不提领 PDF 同目录，{不提领计划书文件名}_大单储蓄分析书.pdf
```

储蓄险 PDF 保存后会自动生成 IRR 表。脚本从首页读取实际年缴保费和缴费年期，
从“详细说明”读取每个保单年度终结时的退保发还金额总额；假设每个保单年度
期初缴费、期末退保。预算 50,000 美元但 PDF 实际年缴保费为 50,000.09 美元时，
IRR 使用 50,000.09。

说明图统一显示“香港友邦储蓄保险计划”和投保年龄。不提领版展示静态回本期、
关键退保金额、总保费倍数和 IRR 里程碑。提领版使用另一套配色，展示提领期间、
每年提取、提取后退保金额、累计提取、合计总额、总保费倍数及综合 IRR。提领
Excel 仍按“详细说明”基础计划口径，不计入提取现金流并显著提示；提领说明图
则严格采用非悲观主情景的“现金提取后”逐年数据。需要重建配套文件时：

```bash
npm run irr -- "计划书/环宇盈活/某份计划书.pdf"
```

大单模式共生成 6 份计划书、6 份 IRR 表、1 张不提领说明图和 1 份分析书。五档
提领不单独生成说明图。分析书只在
六份 PDF 全部通过校验后生成；累计提取、终止年龄退保价值以及不提领方案的
第 30 保单年度、70/80/90/100 岁人寿保障和退保价值均读取自实际 PDF。

## 7. 实测耗时

以下为 macOS 历史端到端测试记录：

| 产品与测试 | 脚本总耗时 |
|------------|------------|
| OYS2 第 1 轮 | 107.2 秒 |
| OYS2 第 2 轮 | 110.7 秒 |
| OYS2 v0.8 回归 | 104.9 秒 |
| EOYS 完整生成 | 106.8 秒 |
| GF v0.8 回归 | 116.3 秒 |
| GP3 仅按“盈御3”名称匹配并完整生成 | 105.6 秒 |
| GF 第 6 年至最后年度每年提取 5,000 美元（两轮） | 137.1–139.1 秒 |
| GF 年缴 40,000 美元不提领最终验收 | 143.4 秒 |
| GF 年缴 40,000 美元、每年提取 5,000 美元最终验收 | 135.7 秒 |
| GF 大单六方案最终验收（无重试） | 14 分 14 秒 |

单份无提领与带提领通常按 **约 2–2.5 分钟** 估算。
大单六方案成功子流程合计约 **14–15 分钟**。一次真实整批回归因 iPGS+ 瞬态
触发 3 次自动重试，最终约 **21 分 42 秒**完成并输出分析书；日常应预留
**15–25 分钟**。
实际耗时随网络、手动登录和 iPGS+ 服务端计算而变化。

## 8. Chrome 隔离规则

- 不要使用 CDP、9223 调试端口或 Agent 自带的 Chrome 控制连接用户现有 Chrome。
- 不要把 `AIA_PGS_PROFILE_DIR` 指向日常 Chrome 用户目录、其子目录或上级目录。
- 不要执行 `pkill`、`killall` 或 `taskkill` 清理 Chrome。
- 遇到 `BROWSER_PROFILE_IN_USE` 时，只关闭本 Skill 创建的自动化 Chrome。
- 遇到 `DEFAULT_CHROME_PROFILE_FORBIDDEN` 时，修正 profile 路径，不能绕过保护。

## 9. 验证与排错

```bash
npm run check
npm test
npm run setup:check
```

常见错误：

- `MANUAL_LOGIN_REQUIRED`：在当前独立 Chrome 手动登录，脚本会等待并自动继续。
- `SETUP_NOT_READY`：逐项完成每个 `❌` 下面的“处理”指引。
- `PARAMS_*` / `PRODUCT_UNSUPPORTED`：修正输出指定的字段，重新运行
  `npm run params:check -- params.json`。
- `PRODUCT_CARD_NOT_FOUND`：运行 `products:list`，核对分类和产品名称。
- `PRODUCT_AMBIGUOUS`：提供更完整的名称、货币版本或输出中的产品代码。
- `PRODUCT_OPTION_UNAVAILABLE`：该产品没有使用者要求的可选项，不能绕过。
- `CURRENCY_NOT_AVAILABLE` / `PAYMENT_FREQUENCY_UNAVAILABLE`：修正为产品页面
  实际提供的货币、年期或缴费组合。
- `MANUAL_LOGIN_TIMEOUT`：重新运行并在独立 Chrome 完成手动登录。
- `STEP3_*`：基本计划字段或持有人资料没有通过页面校验。
- `ANNUAL_PREMIUM_BUTTON_NOT_FOUND`：该储蓄产品没有共同的“预算每年保费”流程。
- `WITHDRAWAL_YEAR_OUT_OF_RANGE`：起止年度超出页面实时显示的最早/最多年度。
- `WITHDRAWAL_*`：提领设置、部分退保确认或结果表核验未完成，不能绕过后继续。
- `ANNUAL_PREMIUM_NOT_SET`：预算弹窗没有成功回读金额。
- `ANNUAL_PREMIUM_CALCULATION_TIMEOUT`：预算计算后弹窗未关闭或基本金额为空。
- `STEP6_CONFIRM_TIMEOUT`：iPGS+ 服务端没有完成计划书计算，不要连续点击下一步。
- `STEP6_NAME_FIELD_MISSING`：`/setting/` 路由已变化但姓名表单 45 秒仍未完整
  挂载；保留诊断并重跑，不要按输入框顺序猜测。
- `PDF_INVALID`：文件没有通过 PDF 头和大小检查，不应交付。
- `IRR_REPORT_FAILED` / `IRR_*`：PDF 已保存，但首页保费、详细说明逐年表或 Excel
  生成未通过严格校验；保留 PDF，按错误信息修复，不能猜数。
- `IRR_WITHDRAWAL_*`：提领 PDF 没有完整、连续的主情景“现金提取后之退保发还
  金额”表；不能改用基础计划数据生成提领图。
- `IRR_IMAGE_*`：PDF 和 IRR Excel 已保存，但正式版 Chrome 未能渲染说明图；
  修复 Chrome 环境后重跑 `npm run irr`。
- `EXISTING_PDF_*`：输入 PDF 无效、重复或数量不符；按错误提示修正源文件列表。
- `SAVINGS_ANALYSIS_*`：多份方案存在缺件、基础字段不一致、提领数据不是同额、
  逐年数据不足或分析 PDF 渲染失败；保留已完成文件，修复原因后整批重跑，不能
  用估算值补齐分析书。

更详细的页面状态和字段对照见 `references/workflow.md`。
