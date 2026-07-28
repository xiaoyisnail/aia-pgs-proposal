# ipgs+ 危疾险（愛伴航2 / OYS2）计划书生成流程细节

> 来源：2026-07-27 录屏 `/Users/ivanwu/Desktop/录屏2026-07-27 20.04.47.mov`
> 以及当日在 `/Users/ivanwu/WorkBuddy/atuo-pgs-pipeline/scripts/steps/` 下逐步验证的脚本。
> 本文件是 SKILL.md 的「实操对照表」，便于后续扩展或排查时逐帧对齐。

## 0. 环境与前置（每次运行前）
1. 香港 VPN 已连。
2. 调试版 Chrome 已用独立 profile 启动并监听 9223：
   `cp -Rc ~/Library/Application\ Support/Google/Chrome ~/Library/Application\ Support/Google/Chrome-Debug`（首次）
   再 `bash scripts/start-chrome-debug.sh`。
3. 在调试 Chrome 中登录 agency 并打开 ipgs+：`https://aiahk-apps-prd.aia.com.hk/pgs/a/`
4. 验证 CDP：`curl --noproxy '*' http://127.0.0.1:9223/json/version`

## 1. 受保人资料（Step 1）
| 字段 | 操作 | 选择器 / 值 |
|------|------|------|
| 出生日期 | `.first()` text input，fill `MM/DD/YYYY`（年龄反推，取今天月日、年=今年-年龄），`Tab` | `input[type="text"]` first |
| 性别 | force click MUI radio | `input[name="insuredSex"][value="0"]`（0=女 / 1=男） |
| 吸煙 | `smoking=false` 默认非吸煙不动；`true` 时 force click 吸煙 radio | `input[name="insuredSmokeCode"][value="1"]` |
| 職業 | 默认標準 | — |
| 居住地 | 点 `.MuiSelect-select` div → 弹 listbox → 点 option | `div.MuiSelect-select` first；option 文本 `中華人民共和國` |
| 警告弹框 | 部分情况出现，点 `確定` | `button` 文本匹配 `^確定$|^確認$` |

验证快照：`FINAL = { dob, age, sex, occ, residency, residencyText }`。

## 2. 选择产品（Step 2）
- 点击 `危疾保障` tab（`text=危疾保障` force click）。
- 在产品卡片中找到以 `OYS2` 开头且含 `愛伴航` 的元素 → 向上找带 `選擇` 按钮的卡片 → 点 `選擇`。
- 触发产品提示弹框 → 点 `確定`。

## 3. 基本计划配置（Step 3）
全部用「按 label 文本找 radio 根节点 → `r.click()`」：
| 项 | label 文本（动态取自参数） |
|----|----|
| 受保人 = 保单持有人 | `sameAsInsured ? '同一人' : '同一人'`（⚠️ 非同一人未实现） |
| 繳付年期 | `{premiumTerm}年`（如 `25年`） |
| 額外保費 | `extraPremium ? '是' : '否'` |
| 繳費模式 | `年繳` |
| 危疾保額部分 | `100%` |

保额：找 label 以 `保額` 开头的 `.MuiFormControl-root` → 其 `input` → 原生 setter 写入 `{sumAssured}` 并 dispatch `input`/`change`。

完成后点 `下一步` 进入附加契约页。

## 4. 附加契约（Step 4）
默认全部不勾选，直接 `下一步`。

## 5. 概要（Step 5）
展示計劃概覽表格（基本計劃 / 升級保障 / 附加契約 / 首年保費總額），核对后 `下一步`。

## 6. 建议书选项（Step 6）
可见 text input 顺序通常为：受保人姓氏、受保人名字、保单持有人姓氏、保单持有人名字……
用原生 setter 依次写入：
`[0]=insuredSurname, [1]=insuredGivenName, [2]=payorSurname, [3]=payorGivenName`。
点 `下一步` → 触发「请注意」确认弹框 → 点 `確認`。

## 7. 成功页（Step 7）
点 `檢視詳盡建議書`（正则 `檢視詳盡建議書`）。

## 8. PDF 预览与下载（Step 8–9）
- 页面内嵌 PDF.js viewer（`iframe` src 含 `viewer.html`）。
- 下载按钮 `#download`（在 `class="hiddenMediumView"` 内）→ 常规 click 报 "not visible"，用 `frame.locator('#download').evaluate(el => el.click())` 绕过。
- 监听 `page.waitForEvent('download')` → `download.path()` → `fs.copyFileSync` 到 `~/Downloads/{规范文件名}`。

## 9. 规范文件名
`{产品}_{性别}{年龄}岁_{地区}_{币种}{保额}_{年期年缴}.pdf`
- 地区映射：`中華人民共和國 → 大陆`、`香港 → 香港`
- 例：`愛伴航2_女1岁_大陆_USD300000_25年缴.pdf`

## 10. 排错速查
- 端口连不上 → 调试 Chrome 没启动 / profile 不是独立的（默认 profile 端口被静默忽略）。
- `下一步` 仍是 disabled → 上一步 radio 没真正选中（MUI 状态未更新，改用 force click / evaluate click）。
- 保额没生效 → 没用原生 setter 触发 React onChange。
- 下载无反应 → `#download` 被隐藏，必须 JS click。
- 沙箱内起不了 Chrome → 让用户在本地终端执行启动脚本。
- 遇验证码 / Cloudflare → 立即暂停转人工。
