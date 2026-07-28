# iPGS+ 危疾险（愛伴航2 / OYS2）确定性流程

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
2. `npm run setup:check` 通过。
3. `npm run login` 可复用持久化 Chrome、Outlook 与有效的 Agency session。
4. 需要端到端验证时运行 `npm run generate:fresh -- params.json`；它只清除 AIA
   会话，保留 Outlook session。

## 1. 受保人资料（Step 1）

| 字段 | 操作 | 选择器 / 值 |
|------|------|-------------|
| 出生日期 | Playwright `fill` 后按 `Tab`，等待年龄回填 | 首个 DOB 输入框；`input[name="insuredAge"]` |
| 性别 | 点击对应 label，并验证 radio checked | 女=0 / 男=1 |
| 吸煙 | 默认非吸煙；吸煙时点击对应 label | `insuredSmokeCode` |
| 職業 | 默认標準 | — |
| 居住地 | 按 label 找 MUI select，再选精确 option | `中華人民共和國` / `香港` / `澳門` |
| 声明与警告 | 只处理当前顶层可见弹窗 | `接受`、`確定` |

成功门：`insuredAge` 等于参数年龄，声明已接受，并出现产品分类页。

## 2. 选择产品（Step 2）

- 点击 `危疾保障` 分类。
- 按文本中的产品代码 `OYS2` 定位叶节点，向上找包含且只包含一个「選擇」按钮
  的最小产品卡片，再点击这个按钮。
- 等待产品确认弹窗或 `/basicInfo/` 路由；若有确认弹窗，点精确的 `確定`。
- 等待服务端 loading cycle 结束，确认基本计划字段已经挂载。

成功门：路由含 `/basicInfo/`，并存在 `ownerSameWithInsured` 与
`premiumPaymentPeriod`。

## 3. 基本计划配置（Step 3）

| 项 | 字段 / 值 |
|----|-----------|
| 保单持有人 | `ownerSameWithInsured`: 同一人=1，不同人=0 |
| 持有人性别 | 不同人时填写 `sex`: 女=0，男=1 |
| 持有人 DOB/年龄 | 不同人时 fill DOB + Tab，并验证 `input[name="age"]` |
| 持有人居住地 | 不同人时按 label 选择 `payorRegion` |
| 繳付年期 | `premiumPaymentPeriod={premiumTerm}` |
| 額外保費 | `paymentPatternOption`: 是=1，否=0 |
| 繳費模式 | `paymentFrequency=1`（年繳） |
| 危疾保額部分 | `ciAdvancement=1`（100%） |
| 保额 | `input[name="sumAssured"]` |

受保人未满 18 岁时，无论输入如何都按不同人处理。每个 radio 点击后回读
`checked`；保额 fill + Tab 后去掉逗号回读验证。只有「下一步」真实 enabled 时点击。

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

`{产品}_{性别}{年龄}岁_{地区}_{币种}{保额}_{年期年缴}.pdf`

- 地区映射：`中華人民共和國 → 大陆`、`香港 → 香港`
- 例：`愛伴航2_女1岁_大陆_USD300000_25年缴.pdf`

## 10. 排错速查

- `BROWSER_PROFILE_IN_USE` → 只关闭本 Skill 创建的自动化 Chrome 后重试；禁止
  `pkill`、`killall`、`taskkill` 或关闭使用者日常 Chrome。
- `DEFAULT_CHROME_PROFILE_FORBIDDEN` → `AIA_PGS_PROFILE_DIR` 与日常 Chrome
  用户目录重叠；改回独立目录，不能绕过。
- `OUTLOOK_NOT_READY` → 在自动化 Chrome 中完成 Outlook 登录。
- `OTP_EMAIL_TIMEOUT` → 检查 Outlook 是否收到与 SSO 当前参考编号一致的邮件。
- `STEP3_NEXT_NOT_CLICKED` → 回查各 radio 的 checked 和保额实际值，不要 force click。
- `STEP6_CONFIRM_TIMEOUT` → 不要连续点击下一步；保留页面与错误输出检查服务端响应。
- `PDF_INVALID` → 文件不是完整 PDF，不得交付；重新生成并检查 quotation/PDF response。
- 遇验证码 / Cloudflare → 立即暂停转人工。
