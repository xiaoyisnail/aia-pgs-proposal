---
name: aia-pgs-proposal
version: 0.4.0
description: >
  自动生成香港友邦（AIA HK）ipgs+ 系统的产品计划书 PDF。
  从 Agency Corner 登录 → OTP 验证 → iPGS+ 重定向 → 填表 → 下载 PDF 全流程自动化。
  当用户提及「生成友邦计划书 / 建议书」「出愛伴航 / 危疾 / 重疾险计划书」
  「自动填 ipgs+ 受保人资料并下载 PDF」「AIA PGS 自动化」「aia-pgs-proposal」时触发。
  当前支持：危疾险（重疾险）— 愛伴航2（OYS2）。
  前置依赖：香港 VPN。Playwright 会自动管理独立的持久化 Chrome。
---

# AIA ipgs+ 计划书自动生成

通过 Playwright 管理独立的持久化 Chrome，**一键完成从 Agency Corner 登录到 PDF 下载的全流程**。

---

## 一、交互流程

### 第 0 步：检测环境
1. **香港 VPN**：确认浏览器访问使用香港出口。
2. **持久化 Chrome profile**：默认复用现有
   `~/Library/Application Support/Google/Chrome-Debug`；若不存在则自动创建
   `~/Library/Application Support/AIA-PGS-Automation`。
3. **Outlook 登录**：首次运行时在自动打开的 Chrome 中登录 Outlook。后续复用该 profile 的登录态。
4. 首次使用可先单独初始化 Outlook：

```bash
node scripts/login-agency.mjs --setup-outlook
```

5. 再单独验证 Agency 登录：

```bash
node scripts/login-agency.mjs
```

需要强制验证密码和 OTP 全流程时，只清除 AIA 会话并保留 Outlook 登录态：

```bash
node scripts/login-agency.mjs --fresh-login
```

### 第 1 步：确认险种
- 「**危疾**」/「**重疾**」→ 愛伴航2 (OYS2)
- 其他险种 → 告知当前仅支持危疾/重疾

### 第 2 步：收集参数

```
请提供以下参数：

| # | 参数 | 说明 | 示例 |
|---|------|------|------|
| 1 | 性别 | 男/女 | 女 |
| 2 | 年龄 | 整数 | 1 |
| 3 | 地区 | 大陆/香港/澳门 | 大陆 |
| 4 | 吸烟 | 是/否 | 否 |
| 5 | 保额(USD) | 不带逗号 | 300000 |
| 6 | 缴费年期 | 10/15/20/25... | 25 |
| 7 | 额外保费 | 是/否(一般否) | 否 |
| 8 | 同一人 | 是/否(一般是) | 是 |

回复按序号：1.女 2.1 3.大陆 4.否 5.300000 6.25 7.否 8.是
```

### 第 3 步：确认并执行
1. 参数确认 → 保存 `params.json`
2. 运行：

```bash
cd ~/.workbuddy/skills/aia-pgs-proposal
node scripts/generate-proposal.mjs params.json
```

也可用以下命令把密码存入 macOS 钥匙串；命令会安全提示输入，不会把密码写进 shell history：

```bash
security add-generic-password -U -a H3926 -s aia-pgs-agency -w
```

脚本不会输出密码或完整 OTP。

3. 失败时阅读带错误代码的输出，按下方"常见问题"排查。

### 参数映射
| 用户输入 | 内部值 |
|----------|--------|
| 大陆/内地 | `中華人民共和國` |
| 吸烟=是 | `smoking: true` |
| 姓名 | 自动填 "vip" |

---

## 二、params.json

```json
{
  "gender": "女", "age": 1,
  "region": "中華人民共和國", "smoking": false,
  "sumAssured": 300000, "premiumTerm": 25,
  "extraPremium": false, "sameAsInsured": true,
  "productName": "愛伴航2", "productCode": "OYS2"
}
```

---

## 三、输出
- 路径：`~/Downloads/`
- 命名：`{产品}_{性别}{年龄}岁_{地区}_USD{保额}_{年期}年缴.pdf`

---

## 四、环境

| 项目 | 值 |
|------|-----|
| Node | `~/.workbuddy/binaries/node/versions/22.22.2/bin/node` |
| Playwright | `~/.workbuddy/binaries/node/workspace/node_modules/playwright` |
| VPN | 必须（香港） |
| Chrome profile | `AIA_PGS_PROFILE_DIR` 可覆盖默认目录 |
| 登录测试 | `node scripts/login-agency.mjs` |

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

### C. 填表（Steps 1-9）
- **Step 1**: 受保人（DOB/性别/吸烟/居住地区）
- **Step 2**: 选产品（危疾→OYS2→確定）
- **Step 3**: 基本计划（年期/额外保费/年缴/保额）
- **Step 4**: 附加契约（跳过）
- **Step 5**: 概要（下一步）
- **Step 6**: 建议书选项（填姓名→下一步）
- **Steps 7-9**: **暴力推进循环**（最多 5 轮：点下一步+确认+检视，直到找到 PDF viewer iframe 并触发下载）

---

## 六、关键坑点（务必遵守）

### 🚫 导航
- **严禁 `page.goto()`**：PGS session 绑定标签页上下文，goto 触发 `/logout`。导航只靠按钮点击。

### 🎨 MUI 控件
- **Select**：`<div class="MuiSelect-select">` + listbox，不是真 `<select>`
- **Radio**：合成 click 不更新 MUI 状态，必须 `locator.click({ force: true })` 或 `evaluate`
- **Input**：原生 setter + dispatch `input`/`change` 事件（React 才识别）
- **`#aiaLoading` 蒙层**：步骤前用 `waitLoading()` 轮询
- **Dialog (`position:fixed`)**：`offsetParent` 永远 null；用 `getComputedStyle.dipslay` 判断可见性；按钮用 `evaluate(el.click())` 绕过视口限制

### 🔑 字段特殊处理
- **`payorName`/`payorFirst` 是 `type="search"`**：不能用 `type="text"` 筛选，必须 `input[name="fieldName"]` 精准定位
- **姓名默认值**：两个姓氏填 `vip` 即可通过表单验证

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
- Chrome 由 `launchPersistentContext` 管理，不使用 9223/CDP
- 自动化必须使用独立 profile，不能指向日常 Chrome 默认目录
- 同一个 profile 同时只允许一个自动化进程使用
- 不要用 `pkill` 清理 Playwright；若提示 `BROWSER_PROFILE_IN_USE`，关闭占用该 profile 的实例后重试

### ⏩ 速度优化
- 最小化 `sleep()` 值：关键等待 500-1500ms，非关键 200-500ms
- `waitLoading` 上限从 8000ms 降到 3000ms
- 登录阶段使用状态等待；OTP 搜索每轮重新执行精确查询
- 暴力推进每人轮 11-13s（含 2 秒 sleep）

---

## 七、常见问题

| 现象 | 原因 | 解法 |
|------|------|------|
| `BROWSER_PROFILE_IN_USE` | 同一自动化 profile 已被占用 | 关闭该 profile 的 Chrome 后重试 |
| `AGENCY_PASSWORD_REQUIRED` | 未配置密码且 Chrome 没有自动填充 | 设置环境变量或按上方命令存入钥匙串 |
| `OUTLOOK_NOT_READY` | Outlook 尚未登录或搜索框不可用 | 在自动化 Chrome 中完成 Outlook 登录 |
| `OTP_EMAIL_TIMEOUT` | 邮件未到或参考编号不匹配 | 核对 Outlook 收件箱及 SSO 当前参考编号 |
| `OTP_CHALLENGE_CHANGED` | 读取邮件期间验证码被重发 | 重新运行，避免手动重复点击 Send OTP |
| `page.goto()` 触发 logout | PGS session 绑定导航上下文 | PGS 内只用按钮点击导航 |
| payorName 验证失败 | `type="search"` 字段被过滤 | 已修复，用 `input[name="payorName"]` |
| 卡在 options 页 | 需要 2 次「下一步」+ 确认 | 暴力推进循环自动处理 |
| PDF viewer 找不到 | 可能在新标签页 | 已修复，跨标签页搜索 iframe |

---

## 八、脚本文件

| 文件 | 说明 |
|------|------|
| `scripts/generate-proposal.mjs` | **主脚本**：复用统一登录模块，再执行 iPGS+→填表→下载 |
| `scripts/login-agency.mjs` | 持久化 Chrome、Agency 登录状态机和 Outlook OTP |
| `scripts/start-chrome-debug.sh` | 兼容旧入口；现在等价于运行登录测试 |
| `tests/login-agency.test.mjs` | 参考编号、OTP 和 home URL 回归测试 |
| `references/workflow.md` | 流程图和步骤参考 |
