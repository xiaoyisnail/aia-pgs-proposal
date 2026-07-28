---
name: aia-pgs-proposal
description: >
  自动生成香港友邦（AIA HK）ipgs+ 系统的产品计划书 PDF。
  从 Agency Corner 登录 → OTP 验证 → iPGS+ 重定向 → 填表 → 下载 PDF 全流程自动化。
  当用户提及「生成友邦计划书 / 建议书」「危疾 / 重疾险计划书」
  「储蓄险计划书」「愛伴航」「環宇盈活 / 环球盈活」「盈御3」「预算每年保费」
  「自动填 ipgs+ 受保人资料并下载 PDF」「AIA PGS 自动化」「aia-pgs-proposal」时触发。
  按危疾险和储蓄险两类参数模型动态选择具体产品；已完整验证 OYS2、EOYS、GF、GP3，
  其他同类产品使用实时产品卡匹配和字段能力检查。
  也用于在 macOS、Windows 或 Linux 新机器上安装依赖、向使用者索取 Agency
  用户编号、配置安全凭据并初始化 Outlook 登录；不依赖 Codex 或特定 Agent 软件。
  前置依赖：香港 VPN。Playwright 会自动管理独立的持久化 Chrome。
---

# AIA ipgs+ 计划书自动生成

通过 Playwright 管理独立的持久化 Chrome，**一键完成从 Agency Corner 登录到 PDF 下载的全流程**。

---

## 一、交互流程

### 最小入口与硬性执行顺序

使用者第一次只需说明一种险种，例如：

- “帮我出一份重疾险计划书”
- “帮我出一份储蓄险计划书”

这已经足以启动 Skill。不要要求使用者预先准备 JSON、命令或完整参数。Agent 必须
按以下状态顺序推进：

1. 识别险种，继续询问具体产品名称，并只询问该险种需要的业务参数。禁止把
   “重疾险”默认成 OYS2，或把“储蓄险”默认成 GF。
2. 将回答标准化并写入 Git 已忽略的 `params.json`。
3. 运行 `npm run params:check -- params.json`。只有出现 `PARAMS_OK` 才能继续；
   校验失败时说明具体字段，只追问缺失或错误的内容，禁止启动 Chrome。
4. 运行 `npm run setup:check`。只有出现 `SETUP_OK` 才能继续；逐项转述所有
   `❌` 和对应的“处理”指引，帮助使用者补齐环境。
5. 如果 `references/products.md` 标记该产品“未完整生成”，先运行
   `npm run product:inspect -- params.json` 检查基本计划字段；缺少分类共同必需
   字段时停止，不能直接生成。
6. 确认使用者已连接香港网络，然后运行 `npm run generate -- params.json`。
7. 只有脚本输出有效 PDF 路径才报告完成。

参数校验、本地环境校验和香港网络确认是三个独立的硬门，不能因为以前运行成功
而跳过。`setup:check` 不会启动 Chrome，也不能证明 Outlook 登录态仍有效；首次
部署必须再以 `npm run login:fresh` 完成真实登录验证。

### 第 0 步：新使用者交互规则

首次运行时，Agent 必须遵守：

1. 将同时包含 `SKILL.md` 与 `package.json` 的目录作为 Skill 根目录。不要假设
   `~/.codex`、`~/.workbuddy` 或任何 Agent 专属路径。
2. 如果尚未保存 Agency 用户编号，明确询问：
   **“请提供你的 Agency Corner 登录账号/用户编号（只提供账号，不要提供密码）。”**
3. 只允许在命令参数中使用该账号。绝不在聊天中索要、接收、复述或记录
   Agency 密码、Outlook 密码、MFA 或 OTP。
4. 运行 `npm run setup -- --username "<用户编号>"` 后，暂停让使用者在操作系统
   安全提示中输入 Agency 密码。
5. 运行 Outlook 初始化后，暂停让使用者在专用 Chrome 中自行输入 Outlook
   凭据及 MFA；Agent 不读取这些内容。
6. 如果当前 Agent 无法运行终端或无法让使用者操作可见 Chrome，给出下面的
   精确命令并暂停，不能改用聊天收集密码。
7. 所有浏览器操作都必须通过本 Skill 的 npm 脚本启动独立 Chrome。禁止使用
   Agent 自带的 Chrome 控制、CDP 或调试端口连接使用者已经打开的 Chrome。

### 第 0.1 步：首次部署（每台机器一次）

支持 macOS、Windows 和 Linux。所有 Agent 软件使用相同 npm 命令：

```bash
npm install
npm run setup -- --username "<用户编号>"
npm run setup:outlook
npm run login:fresh
```

- Agent 先运行 `node --version` 和 `npm --version`。若命令不存在或 Node 低于
  20，明确告知当前结果，指导使用者安装 Node.js 20 或更高版本并重新打开终端。
- 机器必须安装正式版 Google Chrome。`npm run setup:check` 会显示检测到的 Chrome
  路径；若显示未找到，指导使用者安装 Chrome，或运行 `npm run setup:chrome`。
- 如果 `npm run setup` 报告未找到 Google Chrome，再运行
  `npm run setup:chrome`，然后重新运行 `npm run setup`。
- `npm run setup`：保存 Agency 用户编号；macOS 使用 Keychain，Windows 使用
  当前 Windows 用户绑定的 DPAPI 加密密码。Linux 不持久化密码，登录时由
  使用者在 Chrome 密码框手动输入。
- `npm run setup:outlook`：打开自动化专用 Chrome；在其中手动完成 Outlook 登录，
  直到终端显示 `OUTLOOK_OK`。登录 session 会保存在持久化 profile 中。
- `npm run login:fresh`：保留 Outlook session、清除 AIA session，完整验证
  Agency 用户名 → 密码 → Outlook OTP → Agency Corner home。成功标志为 `LOGIN_OK`。
- 任何步骤失败都先停止，不要继续生成计划书。可运行 `npm run setup:check`
  一次检查 Node、Chrome、Playwright、profile 隔离、用户编号、当前平台的密码
  模式和自动化 profile；它会列出全部未满足项及处理命令，而不是只报第一项。

不同机器不得复制密码文件或浏览器 profile；每台机器都重新执行 setup 和
Outlook 初始化。

### 第 0.2 步：每次运行前检查

1. **香港 VPN**：确认浏览器访问使用香港出口。
2. **持久化 Chrome profile**：默认使用 macOS
   `~/Library/Application Support/AIA-PGS-Automation`、Windows
   `%LOCALAPPDATA%\AIA-PGS-Automation` 或 Linux
   `~/.config/aia-pgs-automation`。旧 macOS 安装会继续复用已有 `Chrome-Debug`。
   这些都是自动化专用目录，不是使用者日常 Chrome 的 profile。
3. **环境自检**：

```bash
npm run setup:check
```

4. **登录验证**：

```bash
npm run login
```

### 第 1 步：确认险种
- 「**危疾**」/「**重疾**」→ `productType: "criticalIllness"`
- 「**储蓄**」→ `productType: "savings"`
- 两类都必须继续询问具体产品名称；`productCode` 可选，不能要求使用者提供
- 名称不明确时，在收集基础参数后运行 `npm run products:list -- params.json`，
  把当前分类的实时产品清单给使用者选择
- 其他险种 → 告知当前仅支持危疾保障和储蓄保险分类

### 第 2 步：收集参数

Agent 必须先收齐并复述确认通用业务参数，再按险种收集专属参数，最后写入
`params.json`：

| 通用参数 | 说明 | 示例 |
|----------|------|------|
| 具体产品 | 使用者看到的产品名称；不能只有分类 | 盈御3 |
| 受保人性别 | 男/女 | 女 |
| 受保人年龄 | 整数；脚本用运行当天的月日反推 DOB | 1 |
| 受保人地区 | 大陆/香港/澳门 | 大陆 |
| 受保人姓名 | 姓、名分开；演示可用 `vip` | vip / vip |
| 保单持有人 | 与受保人同一人/不同人 | 不同人 |

如果使用者只说“重疾险”，用一条紧凑消息询问：具体产品、受保人姓、名、性别、
年龄、地区、是否吸烟、保额（美元）、缴费年期、是否额外保费，以及保单持有人
是否与受保人相同。

危疾险必须收集：

| 参数 | 说明 | 示例 |
|------|------|------|
| 吸烟 | 是/否 | 否 |
| 保额 (USD) | 正整数，不带逗号 | 300000 |
| 缴费年期 | 产品页面实际提供的年期 | 25 |
| 额外保费 | 是/否；产品不提供时只能为否 | 否 |

储蓄险必须收集：

| 参数 | 说明 | 示例 |
|------|------|------|
| 缴费年期 | `premiumTerm`；必须是该产品页面提供的值 | 5 |
| 货币 | `currency`；必须是该产品页面提供的值 | 美元 |
| 预算每年保费 | `annualPremium`；正整数 | 50000 |

如果使用者只说“储蓄险”，用一条紧凑消息询问：具体产品、受保人姓、名、性别、
年龄、地区、货币、缴费年期、预算每年保费，以及保单持有人是否与受保人相同。
不要询问吸烟、危疾保额或额外保费。

受保人未满 18 岁时，iPGS+ 会锁定为“不同人”。Agent 还必须收集保单持有人的
性别、年龄、地区、姓和名，不能把 `sameAsInsured: true` 当成有效输入。
成年受保人选择“不同人”时也适用同一规则。

若回答中的受保人未满 18 岁，不再询问“是否同一持有人”，直接说明系统要求不同
持有人，并追问持有人的姓、名、性别、年龄和地区。成年且选择同一人时，不询问
重复的持有人资料。

### 第 3 步：确认并执行
1. 参数确认 → 保存 `params.json`
2. 在启动浏览器前校验：

```bash
npm run params:check -- params.json
npm run setup:check
```

必须分别看到 `PARAMS_OK` 和 `SETUP_OK`。任一命令失败，都按错误输出修正后重新
校验，不能直接尝试生成。

3. 确认香港网络已连接后运行：

```bash
npm run generate -- params.json
```

需要验证“全新 Agency 会话 → Outlook OTP → iPGS+ → PDF”时运行：

```bash
npm run generate:fresh -- params.json
```

`generate:fresh` 只清除 AIA 会话，保留已初始化的 Outlook session。

首次部署应使用 `npm run setup`。需要更新安全存储中的密码时运行：

```bash
npm run setup -- --username "<用户编号>" --reset-password
```

脚本不会输出密码或完整 OTP。

4. 失败时阅读带错误代码的输出，按下方“常见问题”排查。

### 参数映射

| 用户输入 | 内部值 |
|----------|--------|
| 重疾险/危疾险 | `productType: "criticalIllness"` |
| 储蓄险 | `productType: "savings"` |
| 产品名称 | `productName`；`productCode` 仅在同名/同代码多版本时用于消歧 |
| 大陆/内地 | `中華人民共和國` |
| 吸烟=是 | `smoking: true` |
| 未成年受保人 | `sameAsInsured: false` |

---

## 二、params.json

未成年危疾险受保人示例：

```json
{
  "productType": "criticalIllness",
  "gender": "女", "age": 1,
  "region": "中華人民共和國", "smoking": false,
  "sumAssured": 300000, "premiumTerm": 25,
  "extraPremium": false, "sameAsInsured": false,
  "insuredSurname": "vip", "insuredGivenName": "vip",
  "payorSurname": "vip", "payorGivenName": "vip",
  "payorGender": "男", "payorAge": 35,
  "payorRegion": "中華人民共和國",
  "productName": "愛伴航2", "productCode": "OYS2"
}
```

3 岁男童、每年预算 50,000 美元的 GF 储蓄险示例：

```json
{
  "productType": "savings",
  "gender": "男", "age": 3,
  "region": "中華人民共和國",
  "premiumTerm": 5, "annualPremium": 50000, "currency": "美元",
  "sameAsInsured": false,
  "insuredSurname": "vip", "insuredGivenName": "vip",
  "payorSurname": "vip", "payorGivenName": "vip",
  "payorGender": "男", "payorAge": 35,
  "payorRegion": "中華人民共和國",
  "productName": "環宇盈活", "productCode": "GF"
}
```

仓库中的 `examples/oys2-minor.json`、`examples/eoys-critical-minor.json`、
`examples/gf-savings-child.json` 和 `examples/gp3-savings-child.json` 可作为
两类字段模板；实际使用前必须替换客户资料。GP3 示例只给产品名，用于证明
使用者不需要知道内部代码。

---

## 三、输出
- 路径：`~/Downloads/`
- 危疾险：`{产品}_{性别}{年龄}岁_{地区}_USD{保额}_{年期}年缴.pdf`
- 储蓄险：`{产品}_{性别}{年龄}岁_{地区}_USD{预算每年保费}每年_{年期}年缴.pdf`

---

## 四、环境

| 项目 | 值 |
|------|-----|
| 操作系统 | macOS、Windows；Linux 使用手动密码模式 |
| Node | 20 或更高版本 |
| Playwright | `npm install` 安装锁定版本 |
| Chrome | 使用现有 Google Chrome；缺失时运行 `npm run setup:chrome` |
| VPN | 必须（香港） |
| Agency 用户编号 | `npm run setup` 保存；`AGENCY_USERNAME` 可临时覆盖 |
| Agency 密码 | macOS Keychain；Windows DPAPI；Linux 在 Chrome 手动输入 |
| 用户配置 | macOS/Linux `~/.config/aia-pgs`；Windows `%APPDATA%\aia-pgs` |
| Chrome profile | `AIA_PGS_PROFILE_DIR` 可覆盖默认目录 |
| 登录测试 | `npm run login:fresh` |

---

## 五、全流程说明

脚本 `generate-proposal.mjs` 是一个完整的自动化脚本，分三大阶段：

### A. Agency Corner 登录
1. 启动独立持久化 Chrome，检查 Agency Corner home 是否已有有效会话
2. 如果未登录：填用户名 → SSO 密码 → 发送 OTP
3. 读取 SSO 本轮参考编号，在 Outlook 中精确搜索发件人和参考编号
4. 打开匹配邮件，从正文提取 OTP；提交前再次确认 SSO 参考编号未改变
5. 仅在明确超时、过期或验证码错误时重试，最多 3 次
6. 偶尔**免验证码**直接跳转 home 页（脚本自动检测）

### B. 打开 iPGS+
1. 从 Agency Corner 导航到「電子服務」页
2. 用 `getByRole('link', { name: 'iPGS+', exact: true })` 获取隐藏 `<a>` 的 redirect URL
3. navigate 到 redirect URL → SSO 进 PGS

### C. 填表与验收（Steps 1-7）

- **Step 1**: 受保人（DOB/性别/吸烟/居住地区）
- **Step 2**: 按险种进入分类，再按产品名称或可选代码唯一选择产品卡
- **Step 3**: 填持有人资料，再按产品填写保额或“预算每年保费”
- **Step 4**: 附加契约（跳过）
- **Step 5**: 概要（核对后下一步）
- **Step 6**: 建议书选项（填姓名→下一步）
- **Step 7**: 完成页点击「檢視詳盡建議書」，等待 PDF.js 文档就绪并保存 PDF

每一步都必须验证预期路由、字段值或下一页面的唯一状态。禁止用固定次数循环
“试点所有按钮”，也不能把一次 DOM click 当作成功。

---

## 六、关键坑点（务必遵守）

### 🚫 导航
- **严禁 `page.goto()`**：PGS session 绑定标签页上下文，goto 触发 `/logout`。导航只靠按钮点击。

### 🎨 MUI 控件

- **Select**：`<div class="MuiSelect-select">` + listbox，不是真 `<select>`
- **Radio/Input/主流程按钮**：优先使用 Playwright 的真实 click/fill/Tab，并回读
  `checked`、输入值或路由；不要依赖 `force` 或合成 MouseEvent
- **`#aiaLoading` 蒙层**：等待完整的出现/消失周期；服务端计算可能晚于按钮点击
- **Dialog (`position:fixed`)**：`offsetParent` 可能为 null；以 computed style、几何尺寸
  和顶层命中测试判断可见性
- **按钮文本**：MUI 场景读取 `textContent`；不能依赖可能为空的 `innerText`

### 🔑 字段特殊处理

- **`payorName`/`payorFirst` 是 `type="search"`**：不能用 `type="text"` 筛选，必须 `input[name="fieldName"]` 精准定位
- **未成年持有人**：必须填写 `sex`、DOB/`age` 和居住地；`ownerSameWithInsured`
  由系统锁定为不同人
- **产品卡片**：按 `productName` 或可选 `productCode` 匹配最小卡片容器；只允许
  唯一结果。同代码多版本返回 `PRODUCT_AMBIGUOUS`，不能点击第一张猜测
- **实时产品清单**：需要确认当前名称/代码时运行 `npm run products:list -- params.json`；
  详细快照和验证状态见 `references/products.md`
- **分类字段能力**：危疾险的额外保费和危疾保障部分可能不适用于某些产品。
  控件存在时设置并回读；不存在且使用者选择“否”时跳过，使用者要求不支持的
  选项时返回 `PRODUCT_OPTION_UNAVAILABLE`
- **储蓄险预算保费**：先选择产品提供的货币、缴费年期和年缴，再真实点击
  「預算每年保費」；
  在弹窗的 `input[name="budgetPremium"]` 输入目标金额并点「計算」。必须等待弹窗
  消失并回读系统计算出的 `input[name="sumAssured"]`，绝不能把每年保费直接写进
  `sumAssured`
- **金额舍入**：“预算每年保费”是计算目标，不保证 PDF 保费逐分相等。GF/GP3 实测输入
  50,000 后，系统算出基本金额 512,296，PDF 年缴保费为 50,000.09 美元
- **预算按钮点击**：「預算每年保費」使用 Playwright 可见且 enabled 的真实点击；
  页面几何顶层命中可能把可点击按钮误判为被遮挡，不能用该误判跳过按钮
- **PDF**：优先从 PDF.js `pdfDocument.getData()` 读取原始字节；保存后校验
  `%PDF-` 文件头和最小文件大小，UI 下载仅作为后备

### ⏰ 会话管理
- **PGS 会话 ~10 分钟**：必须每次运行时走 agency→iPGS+ 重定向刷新
- **OTP 依赖 Outlook**：严格匹配 SSO 本轮参考编号（C622/P864 等），不接受任意新六位数
- **偶尔免验证码**：short session 直接跳 agency home

### 🌐 多语言
- SSO 按钮同时匹配中文和英文：
  - Login: `/^Login$|^登入$|^登录$/`
  - Send OTP: `/Send OTP|Resend OTP|發送|发送|重新發送/`
  - Confirm: `/^(?:Confirm|確認|确认|确定|確定|提交)$/`
- 弹窗匹配：`/^(接受|Accept|同意|Agree|OK|確認|Confirm|确定|確定)$/`

### 📡 Chrome 稳定性

- Chrome 由 `launchPersistentContext` 新建和管理，不使用 9223/CDP，也不连接
  Agent 软件或使用者已经打开的 Chrome
- 自动化必须使用独立 profile；代码会拒绝日常 Chrome 用户目录本身、其任何
  子目录、其上级目录以及解析后指向这些位置的软链接
- 使用者可以保持日常 Chrome 打开；脚本只关闭自己创建的 browser context，
  不关闭、重启、清 Cookie 或修改日常 Chrome
- 正常自动流程不主动切换到自动化标签页；只有 Outlook 确认未就绪或没有可用
  的安全存储密码、必须人工输入时，才激活独立自动化窗口等待使用者操作
- 同一个 profile 同时只允许一个自动化进程使用
- 禁止使用 `pkill`、`killall` 或 `taskkill` 清理 Chrome。若提示
  `BROWSER_PROFILE_IN_USE`，只让使用者关闭本 Skill 启动的自动化 Chrome 后重试

### ⏩ 速度优化

- 登录阶段使用状态等待；OTP 搜索每轮重新执行精确查询
- iPGS+ 后半段按路由变化和 loading cycle 等待，不使用固定长 sleep
- 正常 DOM 诊断保持安静；只有失败状态才输出控件快照
- 已验证的 macOS 全新登录到 PDF：OYS2、EOYS、GF、GP3 均约 105–117 秒；网络、
  OTP 邮件到达和 iPGS+ 服务端计算会影响耗时

---

## 七、常见问题

| 现象 | 原因 | 解法 |
|------|------|------|
| `AGENCY_USERNAME_REQUIRED` | 尚未配置当前使用者编号 | 运行 `npm run setup` |
| `SETUP_NOT_READY` | 一个或多个本地环境条件不满足 | 逐项执行输出中每个 `❌` 下方的“处理”指引 |
| `PARAMS_*` / `PRODUCT_UNSUPPORTED` | 参数缺失、格式错误或分类不支持 | 只修正错误字段，重新运行 `npm run params:check -- params.json` |
| `PRODUCT_CARD_NOT_FOUND` | 当前分类没有匹配的产品名称/代码 | 运行 `products:list`，让使用者从实时清单选择 |
| `PRODUCT_AMBIGUOUS` | 名称或代码匹配多个产品版本 | 询问更完整产品名、货币版本或使用输出中的代码 |
| `PRODUCT_OPTION_UNAVAILABLE` | 使用者要求了该产品没有的可选项 | 改为该产品支持的值，不能绕过 |
| `CURRENCY_NOT_AVAILABLE` / `PAYMENT_FREQUENCY_UNAVAILABLE` | 产品不提供指定货币或缴费组合 | 按页面实际选项修正参数 |
| `BROWSER_PROFILE_IN_USE` | 同一自动化 profile 已被占用 | 只关闭本 Skill 启动的自动化 Chrome；不得关闭日常 Chrome |
| `DEFAULT_CHROME_PROFILE_FORBIDDEN` | profile 与日常 Chrome 目录重叠 | 删除或修正 `AIA_PGS_PROFILE_DIR`，不要尝试绕过 |
| `AGENCY_PASSWORD_REQUIRED` | 未保存密码或未在 Chrome 手动输入 | macOS/Windows 运行 `npm run setup`；Linux 在 Chrome 输入 |
| `OUTLOOK_NOT_READY` | Outlook 尚未登录或搜索框不可用 | 在自动化 Chrome 中完成 Outlook 登录 |
| `OTP_EMAIL_TIMEOUT` | 邮件未到或参考编号不匹配 | 核对 Outlook 收件箱及 SSO 当前参考编号 |
| `OTP_CHALLENGE_CHANGED` | 读取邮件期间验证码被重发 | 重新运行，避免手动重复点击 Send OTP |
| `page.goto()` 触发 logout | PGS session 绑定导航上下文 | PGS 内只用按钮点击导航 |
| payorName 验证失败 | `type="search"` 字段被过滤 | 已修复，用 `input[name="payorName"]` |
| `STEP3_*` | 基本计划字段未生效或路由未变化 | 按错误码检查持有人、radio、保额和 loading |
| `ANNUAL_PREMIUM_BUTTON_NOT_FOUND` | 未找到可点击的“预算每年保费” | 确认产品属于共同储蓄险模型及货币/年期已生效 |
| `ANNUAL_PREMIUM_NOT_SET` | 弹窗金额未写入 | 检查 `budgetPremium` 的格式化回读值 |
| `ANNUAL_PREMIUM_CALCULATE_NOT_FOUND` | 弹窗中没有可点击的“计算” | 保留页面状态，检查 iPGS+ UI 是否变更 |
| `ANNUAL_PREMIUM_CALCULATION_TIMEOUT` | 计算后弹窗未关闭或基本金额为空 | 等待服务端恢复后重跑，不要改填 `sumAssured` |
| `STEP6_CONFIRM_TIMEOUT` | 服务端计算后未出现确认弹窗 | 保持页面不动并重跑；不要连续点击下一步 |
| `PDF_VIEWER_TIMEOUT` | 完成页未加载有效 PDF | 检查 quotation 是否生成，保留错误输出排查 |
| `PDF_INVALID` | 下载结果不是完整 PDF | 不交付该文件，重新生成并验证 |

---

## 八、脚本文件

| 文件 | 说明 |
|------|------|
| `USAGE.md` | 面向使用者和通用 Agent 的安装、配置、运行与耗时说明 |
| `package.json` / `package-lock.json` | Node 版本、Playwright 依赖和统一命令 |
| `scripts/setup.mjs` | 跨平台环境自检、用户编号和安全密码配置 |
| `scripts/runtime-platform.mjs` | macOS/Windows/Linux 配置、Chrome 与 profile 路径 |
| `scripts/credentials.mjs` | macOS Keychain、Windows DPAPI 和 Linux 手动密码策略 |
| `scripts/generate-proposal.mjs` | **主脚本**：复用统一登录模块，再执行 iPGS+→填表→下载 |
| `scripts/login-agency.mjs` | 持久化 Chrome、Agency 登录状态机和 Outlook OTP |
| `scripts/start-chrome-debug.sh` | macOS/Linux 旧入口；Windows 使用 npm 命令 |
| `tests/login-agency.test.mjs` | 参考编号、OTP 和 home URL 回归测试 |
| `tests/runtime-platform.test.mjs` | macOS/Windows/Linux 路径与密码模式测试 |
| `tests/workflow-gates.test.mjs` | 参数硬门与环境失败指引测试 |
| `examples/oys2-minor.json` | 未成年 OYS2 参数模板 |
| `examples/eoys-critical-minor.json` | 未成年 EOYS 危疾险参数模板 |
| `examples/gf-savings-child.json` | 未成年 GF 储蓄险参数模板 |
| `examples/gp3-savings-child.json` | 仅按名称选择 GP3 的储蓄险参数模板 |
| `references/products.md` | 实时发现的产品清单、代码和端到端验证状态 |
| `references/workflow.md` | 确定性页面状态、字段和路由参考 |
