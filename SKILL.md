---
name: aia-pgs-proposal
version: 0.3.0
description: >
  自动生成香港友邦（AIA HK）ipgs+ 系统的产品计划书 PDF。
  从 Agency Corner 登录 → OTP 验证 → iPGS+ 重定向 → 填表 → 下载 PDF 全流程自动化。
  当用户提及「生成友邦计划书 / 建议书」「出愛伴航 / 危疾 / 重疾险计划书」
  「自动填 ipgs+ 受保人资料并下载 PDF」「AIA PGS 自动化」「aia-pgs-proposal」时触发。
  当前支持：危疾险（重疾险）— 愛伴航2（OYS2）。
  前置依赖：香港 VPN + Chrome 调试实例（CDP 9223）。
---

# AIA ipgs+ 计划书自动生成

通过 **Chrome DevTools Protocol (CDP)** 接管已登录的 Chrome，**一键完成从 Agency Corner 登录到 PDF 下载的全流程**。

---

## 一、交互流程

### 第 0 步：检测环境
1. **CDP 连接**：`curl -s --noproxy '*' http://127.0.0.1:9223/json/version`
   - 失败 → 提示：「请先执行 `bash scripts/start-chrome-debug.sh`（需要香港 VPN）」
2. **Outlook 标签页**：检查是否存在 `outlook.office.com` 页面 → 需要收 OTP 验证码

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
AGENCY_PASSWORD='<your_password>' \
NODE_PATH=~/.workbuddy/binaries/node/workspace/node_modules \
~/.workbuddy/binaries/node/versions/22.22.2/bin/node \
scripts/generate-proposal.mjs params.json
```

3. 失败时阅读错误输出，按下方"常见问题"排查。

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
| CDP | `http://127.0.0.1:9223` |
| Node | `~/.workbuddy/binaries/node/versions/22.22.2/bin/node` |
| NODE_PATH | `~/.workbuddy/binaries/node/workspace/node_modules` |
| Playwright | `~/.workbuddy/binaries/node/workspace/node_modules/playwright` |
| VPN | 必须（香港） |
| Chrome 启动 | `bash scripts/start-chrome-debug.sh` |

---

## 五、全流程说明

脚本 `generate-proposal.mjs` 是一个完整的自动化脚本，分三大阶段：

### A. Agency Corner 登录
1. 在 CDP 中找到 Agency Corner 登录页或 home 页
2. 如果未登录：填用户名 → SSO 密码 → 发送 OTP
3. OTP：从 Outlook 邮件按**参考编号去重**，轮询等新邮件（4 秒/次，最多 2 分钟）
4. 最多 3 次重试（Resend OTP）
5. 偶尔**免验证码**直接跳转 home 页（脚本自动检测）

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
- **OTP 依赖 Outlook**：按参考编号（C622/P864 等）去重，轮询等新邮件
- **偶尔免验证码**：short session 直接跳 agency home

### 🌐 多语言
- SSO 按钮同时匹配中文和英文：
  - Login: `/^Login$|^登入$|^登录$/`
  - Send OTP: `/Send OTP|Resend OTP|發送|发送|重新發送/`
  - Confirm: `/Confirm|確認|确定|確定|驗證|验证|提交/`
- 弹窗匹配：`/^(接受|Accept|同意|Agree|OK|確認|Confirm|确定|確定)$/`

### 📡 CDP 稳定性
- **Chrome 136+ 必须独立 profile**：默认 profile 静默忽略 `--remote-debugging-port`
- **必须用 `open -a` 启动 Chrome**：WorkBuddy 沙箱内不能直接执行 Chrome binary
- **别 `pkill -9`**：会破坏 session cookie。改用 `osascript -e 'tell app "Google Chrome" to quit'`
- **CDP 僵死时**：`pkill -f "node.*playwright"` 清 WebSocket 锁后重试

### ⏩ 速度优化
- 最小化 `sleep()` 值：关键等待 500-1500ms，非关键 200-500ms
- `waitLoading` 上限从 8000ms 降到 3000ms
- OTP 轮询间隔从 5s 改为 4s
- 暴力推进每人轮 11-13s（含 2 秒 sleep）

---

## 七、常见问题

| 现象 | 原因 | 解法 |
|------|------|------|
| CDP 连不上 | Chrome 未用 debug 模式启动 | `bash scripts/start-chrome-debug.sh` |
| `page.goto()` 触发 logout | PGS session 绑定导航上下文 | 只用按钮点击导航 |
| OTP 超时 | Outlook 页未打开或未登录 | 检查 Outlook 标签页，确保已登录 |
| payorName 验证失败 | `type="search"` 字段被过滤 | 已修复，用 `input[name="payorName"]` |
| 卡在 options 页 | 需要 2 次「下一步」+ 确认 | 暴力推进循环自动处理 |
| PDF viewer 找不到 | 可能在新标签页 | 已修复，跨标签页搜索 iframe |

---

## 八、脚本文件

| 文件 | 说明 |
|------|------|
| `scripts/generate-proposal.mjs` | **主脚本**：单文件包含全部逻辑（登录→iPGS+→填表→下载） |
| `scripts/start-chrome-debug.sh` | 启动 Chrome 调试实例（用独立 profile 保留登录态） |
| `references/workflow.md` | 流程图和步骤参考 |
