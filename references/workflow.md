# iPGS+ 危疾险与储蓄险动态产品确定性流程

本文件是 `SKILL.md` 的页面状态与字段对照表。实现以真实页面状态为准：
每次操作后必须回读字段、路由或下一页面标志，不能仅以 click 没有抛错作为成功。

## 0. 环境与前置

新机器首次部署（与 Agent 软件无关）：

1. 确认 Node.js 20+ 和 npm 可用，再运行 `npm install` 安装锁定版本的 Playwright。
2. Agent 只向使用者索要 Agency Corner 用户编号，不索要任何密码或 OTP。
3. 禁止连接或控制使用者已经打开的 Chrome；只运行本 Skill 的 npm 命令，让
   `launchPersistentContext` 创建独立自动化实例。
4. 运行 `npm run setup -- --username "<用户编号>"`。macOS 密码进入 Keychain，
   Windows 密码使用 DPAPI 加密；Linux 由使用者稍后在 Chrome 手动输入。
5. 若提示缺少 Chrome，运行 `npm run setup:chrome` 后重试 setup。
6. 运行 `npm run setup:outlook`，让使用者在自动化 Chrome 中登录 Outlook，
   等待 `OUTLOOK_OK`；不要在聊天中收集 Outlook 凭据或 MFA。
7. 连接香港 VPN，运行 `npm run login:fresh`。
8. 看到 `LOGIN_OK` 后，Agency Corner 登录验证完成。

后续运行前：

1. 香港 VPN 已连接。
2. `npm run params:check -- params.json` 输出 `PARAMS_OK`；该命令不启动 Chrome。
3. `npm run setup:check` 列出的本地环境项全部通过并输出 `SETUP_OK`。
4. `npm run login` 可复用持久化 Chrome、Outlook 与有效的 Agency session。
5. 需要端到端验证时运行 `npm run generate:fresh -- params.json`；它只清除 AIA
   会话，保留 Outlook session。

`setup:check` 会一次报告 Node、Chrome、Playwright、profile 隔离、Agency 用户编号、
密码模式和自动化 profile。出现 `SETUP_NOT_READY` 时，逐项完成每个 `❌` 下的
“处理”指引，不得继续生成。它只检查本地状态；Outlook 登录态和香港网络仍需
`login:fresh` 实际验证。

## 1. 受保人资料（Step 1）

| 字段 | 操作 | 选择器 / 值 |
|------|------|-------------|
| 出生日期 | Playwright `fill` 后按 `Tab`，等待年龄回填 | 首个 DOB 输入框；`input[name="insuredAge"]` |
| 性别 | 点击对应 label，并验证 radio checked | 女=0 / 男=1 |
| 吸煙 | 危疾险按参数选择；储蓄险固定为非吸煙 | `insuredSmokeCode` |
| 職業 | 默认標準 | — |
| 居住地 | 按 label 找 MUI select，再选精确 option | `中華人民共和國` / `香港` / `澳門` |
| 声明与警告 | 只处理当前顶层可见弹窗 | `接受`、`確定` |

成功门：`insuredAge` 等于参数年龄，声明已接受，并出现产品分类页。

## 2. 选择产品（Step 2）

- 危疾险点击 `危疾保障`；储蓄险点击 `儲蓄保險`。
- 按 `productName` 或可选 `productCode` 筛选产品卡，只有唯一结果才点击「選擇」。
- 名称/代码找不到时返回当前分类候选；匹配多个版本时返回 `PRODUCT_AMBIGUOUS`。
- 使用者不确定名称时运行 `npm run products:list -- params.json`；当前清单和验证
  状态见 `references/products.md`。
- 等待产品确认弹窗或 `/basicInfo/` 路由；若有确认弹窗，点精确的 `確定`。
- 等待服务端 loading cycle 结束，确认基本计划字段已经挂载。

成功门：路由含 `/basicInfo/`，并存在 `ownerSameWithInsured` 与
`premiumPaymentPeriod`。

## 3. 基本计划配置（Step 3）

### 3.1 通用持有人资料

| 项 | 字段 / 值 |
|----|-----------|
| 保单持有人 | `ownerSameWithInsured`: 同一人=1，不同人=0 |
| 持有人性别 | 不同人时填写 `sex`: 女=0，男=1 |
| 持有人 DOB/年龄 | 不同人时 fill DOB + Tab，并验证 `input[name="age"]` |
| 持有人居住地 | 不同人时按 label 选择 `payorRegion` |

受保人未满 18 岁时，无论输入如何都按不同人处理。每个 radio 点击后回读
`checked`。

### 3.2 危疾险

| 项 | 字段 / 值 |
|----|-----------|
| 繳付年期 | `premiumPaymentPeriod={premiumTerm}` |
| 額外保費 | 有 `paymentPatternOption` 时：是=1，否=0 |
| 繳費模式 | `paymentFrequency=1`（年繳） |
| 危疾保額部分 | `ciAdvancement=1`（100%） |
| 保额 | `input[name="sumAssured"]` |

`paymentPatternOption` 或 `ciAdvancement` 不存在时视为该产品不适用。使用者要求
额外保费=true 但控件不存在时返回 `PRODUCT_OPTION_UNAVAILABLE`；false 可以安全
跳过。保额 fill + Tab 后去掉逗号回读验证。OYS2 和 EOYS 已完整生成验证。

### 3.3 储蓄险

| 项 | 字段 / 值 |
|----|-----------|
| 货币 | MUI `貨幣` 下拉或固定 `currencyCode` |
| 保费缴付年期 | `premiumPaymentPeriod={premiumTerm}` |
| 缴费模式 | 多年缴=`paymentFrequency=1`；一次缴=`0` |
| 打开预算弹窗 | 点击可见且 enabled 的 `預算每年保費` |
| 预算每年保费 | `input[name="budgetPremium"]={annualPremium}` |
| 计算 | 点击弹窗中精确文本 `計算` |
| 系统计算的基本金额 | 等待弹窗关闭，回读 `input[name="sumAssured"]` |

货币和缴费年期必须是所选产品实际提供的值；选择年期后等待新
`paymentFrequency` 挂载并回读，不能接受重渲染前的旧状态。“预算每年保费”是
目标值，不是基本金额。禁止把 `annualPremium` 直接写入
`sumAssured`。实测目标 50,000 美元经系统计算得到基本金额 512,296，最终 PDF
年缴保费为 50,000.09 美元；这是产品计算的金额舍入，不应篡改基本金额强行抵消。

「預算每年保費」应使用 Playwright 的真实 click。页面几何顶层命中检查会在部分
渲染状态下错误地认为按钮被遮挡，不能据此跳过这个必要步骤。

GF 和 GP3 已完整生成验证。其他同类产品在共同字段不成立时必须报错停止。两类
产品都只有在「下一步」真实 enabled 时点击。

成功门：路由由 `/basicInfo/` 变为 `/rider/`。

## 4. 附加契约（Step 4）

默认全部不勾选，直接 `下一步`。

成功门：路由由 `/rider/` 变为 `/abstract/`。

## 5. 概要（Step 5）

展示計劃概覽表格（基本計劃 / 升級保障 / 附加契约 / 首年保費總額），核对后
`下一步`。

成功门：路由由 `/abstract/` 变为 `/setting/`。

## 6. 建议书选项（Step 6）

按稳定字段名填写，不按可见输入框顺序猜测：

| 字段 | 参数 |
|------|------|
| `lastName` | `insuredSurname` |
| `firstName` | `insuredGivenName` |
| `payorName` | `payorSurname` |
| `payorFirst` | `payorGivenName` |

其中 `payorName` / `payorFirst` 是 `type="search"`。全部 fill 后逐项回读，再点
「下一步」。服务端计算可能持续数十秒；等待真正出现的确认 dialog，点精确
`確認`，不要重复提交。

成功门：离开 `/setting/`，完成页出现「檢視詳盡建議書」。

## 7. 成功页（Step 7）

点 `檢視詳盡建議書`。

## 8. PDF 预览与保存

1. 跨当前页和新标签页等待 PDF.js：`PDFViewerApplication.pdfDocument.numPages > 0`。
2. 优先调用 `pdfDocument.getData()` 获取原始字节并写入目标文件。
3. 如果站点改为直接 PDF response 或 base64 JSON，使用网络响应作为后备。
4. 最后才尝试 viewer 的 `#download` 并监听 Playwright download。
5. 保存后必须验证文件至少 10 KB 且以 `%PDF-` 开头；失败时删除无效文件并报错。

## 9. 规范文件名

- 危疾险：`{产品}_{性别}{年龄}岁_{地区}_USD{保额}_{年期}年缴.pdf`
- 储蓄险：`{产品}_{性别}{年龄}岁_{地区}_USD{预算每年保费}每年_{年期}年缴.pdf`

- 地区映射：`中華人民共和國 → 大陆`、`香港 → 香港`
- OYS2 例：`愛伴航2_女1岁_大陆_USD300000_25年缴.pdf`
- EOYS 例：`簡緻愛伴航_女1岁_大陆_USD300000_25年缴.pdf`
- GF 例：`環宇盈活_男3岁_大陆_USD50000每年_5年缴.pdf`
- GP3 例：`盈御3_男3岁_大陆_USD50000每年_5年缴.pdf`

## 10. 排错速查

- `BROWSER_PROFILE_IN_USE` → 只关闭本 Skill 创建的自动化 Chrome 后重试；禁止
  `pkill`、`killall`、`taskkill` 或关闭使用者日常 Chrome。
- `DEFAULT_CHROME_PROFILE_FORBIDDEN` → `AIA_PGS_PROFILE_DIR` 与日常 Chrome
  用户目录重叠；改回独立目录，不能绕过。
- `OUTLOOK_NOT_READY` → 在自动化 Chrome 中完成 Outlook 登录。
- `SETUP_NOT_READY` → 按输出的全部 `❌` 和“处理”指引补齐本地环境。
- `PARAMS_*` / `PRODUCT_UNSUPPORTED` → 修正对应字段，再运行
  `npm run params:check -- params.json`；不要通过启动浏览器试错。
- `PRODUCT_CARD_NOT_FOUND` → 运行 `products:list` 并核对分类和产品名称。
- `PRODUCT_AMBIGUOUS` → 使用更完整名称、货币版本或候选中的代码。
- `PRODUCT_OPTION_UNAVAILABLE` → 使用者要求了该产品没有的可选项，不能绕过。
- `CURRENCY_NOT_AVAILABLE` / `PAYMENT_FREQUENCY_UNAVAILABLE` → 修正为页面提供的组合。
- `OTP_EMAIL_TIMEOUT` → 检查 Outlook 是否收到与 SSO 当前参考编号一致的邮件。
- `STEP3_NEXT_NOT_CLICKED` → 回查各 radio 的 checked 和保额实际值，不要 force click。
- `ANNUAL_PREMIUM_BUTTON_NOT_FOUND` → 该产品可能不属于共同储蓄险字段模型；停止适配。
- `ANNUAL_PREMIUM_NOT_SET` → 回查 `budgetPremium` 格式化后的数字。
- `ANNUAL_PREMIUM_CALCULATE_NOT_FOUND` → 保留弹窗状态，检查“计算”按钮是否改版。
- `ANNUAL_PREMIUM_CALCULATION_TIMEOUT` → 等待 iPGS+ 服务恢复后重跑；不要改为直接
  填写 `sumAssured`。
- `STEP6_CONFIRM_TIMEOUT` → 不要连续点击下一步；保留页面与错误输出检查服务端响应。
- `PDF_INVALID` → 文件不是完整 PDF，不得交付；重新生成并检查 quotation/PDF response。
- 遇验证码 / Cloudflare → 立即暂停转人工。
