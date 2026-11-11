# 界面主题框架（Theme Framework）

> 本文件是 **RUNCN 本地 fork 的主题规范**，不随 PR 提交上游。
> 两个单一事实源：`src/features/basic/theme-registry.ts`（主题元数据）、本文件（规则与流程）。
>
> **强制约定**：任何与主题相关的改动，**改之前必须先读本文件**；**改完必须同步更新 §4 有效规则库与 §7 修改台账**。
> 只改代码不写台账 = 本次改动未完成。此约定同时写在工作区长期记忆里，后续每个会话自动加载。

---

## 0. 一句话

**新增一套主题 = 在注册表加一行 + 按 `mode` 提供一份色板。**
id、设置页卡片、TypeScript 类型、引擎可识别集合、首屏防闪、图表取色、组件映射骨架全部自动跟随，不再需要手工同步 7 处。

改动前先确认要改的是哪一层：

| 想做的事 | 改哪里 | 要不要动引擎 |
|---|---|---|
| 加/删/改名主题、改卡片文案 | `theme-registry.ts` 一行 | 否 |
| 调某套现有主题的颜色 | 该主题的色板（`SKINS` 或 `--rp-cc-*` 块） | 否 |
| 加一套新浅色皮肤 | 注册表 + `SKINS` 一份色板 | 否 |
| 加一套精细多彩主题 | 注册表 + `refined-prun.css` 一份 `--rp-cc-*` 色板 | 否 |
| 改所有主题共用的行为 | 引擎 / 兜底 CSS / 本文件规则库 | **是，必须写台账** |

---

## 1. 三层架构

```
配置层   theme-registry.ts       主题元数据（id / label / desc / mode）★唯一事实源
         theme.ts  SKINS         skin 模式色板（--rp-skin-* 值 + 3 族映射 + status/indicator/progress）
         refined-prun.css        token 模式色板（html[data-rp-theme='<id>'] 里的 --rp-cc-*）
                                 + 全局兜底规则 1)~6)
         theme-ceramic.ts        buildCeramicSkin()（token→Skin）+ 组件映射骨架（与颜色无关）

引擎层   theme.ts                CSSOM 扫描 / 颜色重映射 / CONTROL_CSS / 注入与切换
         refined-prun-startup.ts 首屏防闪标记（token 模式）
         utils/chart-theme.ts    canvas 图表取色（token 模式）

消费层   XIT/SET/THEME.vue       卡片列表（从注册表生成）
         各组件                  var(--rp-skin-*, <原样回退>)、var(--rp-cc-*)
```

| 文件 | 职责 | 关键符号 |
|---|---|---|
| `src/features/basic/theme-registry.ts` | 元数据唯一事实源，**纯数据零依赖** | `THEMES` / `ThemeId` / `themeMode()` / `usesTokenPalette()` / `CUSTOM_THEME_ID_SET` |
| `src/features/basic/theme.ts` | 引擎内核 + `CONTROL_CSS` + light/paper 色板 | `SKINS` / `buildCss()` / `collect()` / `mapColor()` / `tokensFor()` / `apply()` |
| `src/features/basic/theme-ceramic.ts` | token 模式：组装 Skin + 组件映射骨架 | `buildCeramicSkin()` / `buildComponentCss(themeId)` |
| `src/refined-prun.css` | 全局兜底、token 色板、首屏底色 | `--rp-color-*` / `--rp-inv-cat-*-rgb` / 分节 1)~8) |
| `src/refined-prun-startup.ts` | 首屏防闪 | `needsStartupMarker()` |
| `src/utils/chart-theme.ts` | 图表取色 | `chartColors()` / `FALLBACK` |
| `src/features/XIT/SET/THEME.vue` | 设置页卡片 | `THEMES` |
| `src/store/user-data.types.d.ts` | `ThemeId`（从注册表派生） | `import('...').ThemeId` |
| `src/store/user-data-migrations.ts` | 历史数据迁移 | **id 必须硬编码**（见 R19） |

> 行号会随改动浮动，定位一律用上表的符号名 / 分节标题，不要依赖行号。

---

## 2. 三种主题模式

| | `native` | `skin` | `token` |
|---|---|---|---|
| 现例 | `default` 原样 | `light` 浅色明亮、`paper` 暖米纸 | `ceramic-colorful` 陶瓷白多彩 |
| 色板位置 | 无 | `theme.ts` 的 `SKINS[id]` | `refined-prun.css` 的 `html[data-rp-theme='<id>']` 块 |
| 色值形态 | — | TS 字面量，由 `tokensFor()` 注入 | CSS 字面量 `--rp-cc-*`，组件一律 `var()` 引用 |
| Skin 来源 | 不生成 | `SKINS[id]` | `buildCeramicSkin()` 从 CSS token 读 |
| 组件映射骨架 | — | 不启用 | `buildComponentCss(id)` 自动生成 100+ 条规则 |
| 首屏防闪标记 | 否 | 否 | **是**（色板在 CSS 里，React 首绘前必须就位） |
| 图表取色 | 默认色板 | 默认色板 | `--rp-cc-*` token |
| 适合 | 保持游戏原版 | 快速做一套新配色 | 精细主题：分类/图表/图标/状态分色 |

`mode` 是引擎唯一的分支依据。**禁止**再用 `theme === 'ceramic-colorful'` 之类的具名 id 做判断。
`CERAMIC_THEME_ID` 只是「当前 token 主题的默认 id」兼容常量，不是判断条件。

---

## 3. 引擎原理（不理解这 5 条必然踩坑）

### 3.1 注入顺序固定

`apply()` 生成的 `#rprun-theme` 内容顺序：

```
buildCss(skin)  →  tokensFor(theme, skin)  →  CONTROL_CSS  →  buildComponentCss(theme)
  覆盖表            主题变量                  通用控件规则      组件映射骨架（仅 token）
```

同特异性下**后面的赢**。`CONTROL_CSS` 三套主题共用、零主题分支；组件映射骨架最后，决定按钮/控件/表格最终外观。`buildCss()` 必须跳过 `#rprun-theme` 自己，否则反复切换会把已映射的颜色再次反转、累积失真。

### 3.2 CSSOM 扫描与 `TOKEN_RULE_RE`

`collect()` 遍历所有同源 `document.styleSheets`，把每条声明里的颜色字面量（`#hex` / `rgb()` / `hsl()`）按「角色 + 色相」重映射成主题色，输出全部带 `!important`。
只有选择器精确匹配 `^html\[data-rp-theme=[^\]]+\](\s+body)?$` 的规则会被跳过——**主题自己的 token 块靠这个正则免于被二次重映射**。

由此推出 R01：色板颜色**只能**放在精确 `html[data-rp-theme='<id>']` 块里。

### 3.3 `--rp-color-*` 为什么会被刷成近白

`refined-prun.css` 顶部在**裸 `html {}`** 里定义了 `--rp-color-green/text/orange/accent-primary` 等（给原样主题用）。裸 `html{}` 不匹配 `TOKEN_RULE_RE`，于是这些变量被当成「游戏原生颜色」参与重映射：
`#5cb85c` → 绿族 background `#e8f2eb`、`#ffc856` → 石板蓝 background `#e7eef4`、`#999` → `rgb(175,175,175)`。
组件拿它当**文字色**就是浅字压浅底（CONTS 曾 1.01:1）。

`--rp-skin-*` 不受影响有三重保护：注入在 `#rprun-theme` 内被跳过；token 模式的值全是 `var(--rp-cc-*)` 别名，没有颜色字面量；纯 RGB 三元组（`51, 86, 111`）也不匹配颜色正则。

### 3.4 特异性阶梯（文档顺序不可靠）

`#rprun-theme` 在 `<head>`，`refined-prun.css` 由 startup 挂在 `<html>` 末尾，文档顺序**晚于**引擎样式表。同特异性时全局兜底会反过来压掉主题规则，所以必须靠重复属性选择器显式抬级：

| 场景 | 前缀 | 特异性 |
|---|---|---|
| `CONTROL_CSS` 清窗口斜纹 | `html[data-rp-theme][data-rp-theme]` | (0,2,x) |
| 组件映射骨架 | `html[data-rp-theme='<id>'][data-rp-theme]` | (0,3,1) |
| 固定文字选中态 | `html[data-rp-theme] ×3` | (0,3,x) |
| 第 6) 组可读性兜底 | `html[data-rp-theme] ×3` + `:is(...)` | (0,5,x) |
| INV 分类头（token 覆盖） | `×5` | (0,5,x) |

### 3.5 token 值的三种合法形态

1. 精确 `html[data-rp-theme='<id>']` 块里的颜色字面量（被 `TOKEN_RULE_RE` 跳过）；
2. `var()` 别名，不含颜色字面量；
3. 纯 RGB 三元组 `51, 86, 111`（供 `rgb(var(--x))` 用），不匹配颜色正则。

**任何其它形态的颜色字面量都会被重映射。**

---

## 4. 有效规则库（历史踩坑固化）

> 每条都是「现象 → 根因 → 固化规则 → 落点 → 验证」。**新增规则或修改规则必须同步写 §7 台账。**

### A. 色板与 token

| ID | 现象 / 根因 | 固化规则（必须 / 禁止） | 落点 | 验证 |
|---|---|---|---|---|
| R01 | 色板颜色被扫描后压成中性灰 | **必须**把颜色字面量只放在精确 `html[data-rp-theme='<id>']` 块；**禁止**在组件规则里写裸色值 | `refined-prun.css` token 块 / `theme.ts TOKEN_RULE_RE` | `verify-ceramic-theme.mjs` 精确色值 |
| R02 | `--rp-color-*` 被二次重映射成近白，浅字压浅底 | **必须**在 XIT / 原生 FIN 窗口内把 6 个 `--rp-color-*` 局部重定义指向 `--rp-skin-*`；组件里用 `--rp-skin-*`，**禁止**用 `--rp-color-accent-primary` 当文字色。**`--rp-accent-rgb` 是装饰色（卡片底纹 / 分类头 / 边框 / 复选框 `accent-color`），同样禁止当文字色**：它是纯三元组不被重映射，但在 light/paper/ceramic 下是低饱和石板蓝 / 深棕 / 多彩强调色，配 `rgba(var(--rp-accent-rgb), 0.05)` 浅底只有 3.77~3.95:1；文字一律 `var(--rp-skin-ink, currentColor)` | `refined-prun.css` 第 6) 组；`CXOS.vue` / `NX.vue`；`GOVH.vue` | `verify-round25.mjs` 变量亮度 <0.4；`verify-govh-theme.mjs` |
| R03 | 分类头底色被重映射 | **必须**用纯 RGB 三元组存 `--rp-inv-cat-*-rgb` / `--rp-window-border-rgb`，**禁止**写成 `#hex` | `refined-prun.css` 分节 A/B | `verify-theme-cat-colors.mjs` |
| R04 | 同一颜色在多处重复定义，改一处漏一处 | **必须**保证每套主题只有一个颜色字面量来源：skin 模式在 `SKINS[id].vars`，token 模式在 `--rp-cc-*` 块，其余全部 `var()` 别名 | `theme-ceramic.ts buildCeramicSkin()` | 代码审查 |
| R05 | 图表 canvas 不认 `var()` | **必须**让 token 模式主题在 CSS 里提供 `--rp-cc-cat-1..8-chart` 等；非 token 模式一律返回 `FALLBACK`，保证原样/light/paper 图表一字不变 | `chart-theme.ts` | `verify-ceramic-real-dom.mjs` 画布取色 |

### B. 特异性与注入顺序

| ID | 现象 / 根因 | 固化规则 | 落点 | 验证 |
|---|---|---|---|---|
| R06 | 全局兜底被引擎 `!important` 规则压掉 | **必须**用重复 `html[data-rp-theme]` 抬特异性（见 §3.4），**禁止**依赖样式表文档顺序 | `theme.ts CONTROL_CSS` / `refined-prun.css` 第 6) 组 | `verify-round14-theme-fixes.mjs` |
| R07 | 反复切主题颜色累积失真 | `buildCss()` **必须**跳过 `#rprun-theme` 自身；跨域样式表 `try/catch` 跳过 | `theme.ts buildCss()` | 反复切换后取色 |
| R08 | 游戏启动后继续注入 CSS Modules 样式表，新表没被覆盖 | **必须**保留 `MutationObserver` + 250ms 防抖重算；原样主题时断开观察 | `theme.ts init()` | 切主题后新开窗口取色 |

### C. 可读性（三套自定义主题通用）

| ID | 现象 / 根因 | 固化规则 | 落点 | 验证 |
|---|---|---|---|---|
| R09 | 8~10px 小字在浅底不可读 | **必须** ≥11px；新增组件禁止引入 <11px 正文 | `refined-prun.css` 分节 D；各 SFC | `verify-round25.mjs` `small===0` |
| R10 | `opacity:0.3~0.85` 把文字压淡到 3~4:1 | **必须**在 XIT/FIN 窗口内 `opacity:1`，精确排除拖拽把手 / `dimmed` / 禁用态；**禁止**全局无差别覆盖 | `refined-prun.css` 第 6) 组 | `verify-round25.mjs` `faded===0` |
| R11 | 白半透明描边 / 遮罩在浅底消失或盖住数字 | **必须**把卡片线换成 `--rp-skin-border`、遮罩换成不透明语义色；预警层改不透明后**必须**给数字 `z-index:1` + `--rp-skin-ink` | `refined-prun.css` 第 6) 组；`theme-ceramic.ts` Overlay；`BURN/DaysCell.vue` | `verify-round25.mjs` |
| R12 | 表头透明、400 字重、细线，原生 FIN 与 XIT FINxx 格式分裂 | **必须**让第 6) 组作用域同时包含 `.rp-command-XIT`、`[class*='rp-command-FIN']`、`[class*='rp-command-CORPFIN']`；表头统一底色/600 字重/底线，td 补底线 | `refined-prun.css` 第 6) 组 | `verify-fin-style.mjs` 129 项 |
| R13 | ⓘ 图标被刷成近白，或改成深色后变成黑底白字 | **必须**用 `color: inherit` 自适应（**禁止**硬设深色：它常嵌在深蓝 LABEL 白字里）；Tooltip 容器必须透明无边框 | `refined-prun.css .rp-tooltip-icon`；`theme-ceramic.ts` Tooltip 段 | `verify-round25.mjs` / `verify-round14` |

### D. 布局与盒模型

| ID | 现象 / 根因 | 固化规则 | 落点 | 验证 |
|---|---|---|---|---|
| R14 | `XIT SET THEME` 从 2×2 塌成单列 | **禁止**用 `border` 界定窗口层级：窗口宽高由游戏 inline style 精确控制，2px 实边框会把内容区 428px 挤到 426px，正好放不下两列。**必须**用 `box-shadow: 0 0 0 1px` + `border:0`；卡片 `minmax(200px, 1fr)` 留 10px 余量 | `theme-ceramic.ts` Window 段；`refined-prun.css` 窗口描边；`THEME.vue .grid` | `verify-round14-theme-fixes.mjs` `cols===2 && cards===4` |
| R15 | 灰色斜纹 / 斑马纹窗体 | **必须**清掉 `Window__window` 的 `background-image`；货物条改纯色轨道；NOTS 只补底线，**禁止**铺斑马纹底 | `theme.ts CONTROL_CSS`；`refined-prun.css` 第 4) 组；`InvBar.vue` / `FleetCargoBar.vue` | `verify-round14` `gradients===0` |
| R16 | 对顶双三角悬浮指示 | **必须**全局 `[data-tooltip]::after { display:none }`，保留 `::before` 文字框；`:is()` 里**禁止**写伪元素（会让整条分支失效） | `refined-prun.css` 第 5) 组 | `verify-round23.mjs` |
| R17 | 贯穿全屏的 TileDivider 竖条被染色 | 装饰线规则**必须** `:not([class*='TileDivider__'])`，且不能破坏 `cursor:col-resize` | `theme-ceramic.ts` 装饰线段 | `verify-round14` |
| R24 | 原样主题下 FB 面板 BS / BURN 出现宽白边，中间 INV 却没有 | 槽位 `.slot` 的 `var(--rp-skin-*, <回退>)` 回退值**必须**是 `transparent`，**禁止**写浅色裸值（原样主题没有 skin 变量，浅色回退会从四周露出）；**必须**清零所有内嵌 `Tile__tile` 的 6px 外边距，使各槽铺满（缝隙 ≤2px）。回退里也**禁止**出现颜色字面量，否则会被 CSSOM 扫描 | `FB.vue .slot` / `.slot [class*='Tile__tile']` | `verify-round26.mjs` 四槽 gap / 槽位底色 |
| R25 | INV / SHPI 右侧两套滚动条叠加；紧凑模式物料全显却强制出滚动条 | 游戏 ScrollView 同时画自绘 6px 轨道与浏览器滚动条；`overflow:scroll` 无溢出也画轨道。**必须**把 `ScrollView__view` 改 `overflow:auto`、在本作用域把 `scrollbar-width/color` 清回 `auto`、隐藏自绘 `track/thumb`、只留 `::-webkit-scrollbar` 4px 且 `::-webkit-scrollbar-button{display:none}`；**禁止**让主题全局 `scrollbar-color` 覆盖本作用域（会让 Chromium 忽略 webkit 细条改画 ≈10px 标准条）。此组是布局修复，**不带**主题前缀 | `refined-prun.css` 第 7) 组 | `verify-round26.mjs` `barWidth===0` / `tracks===0` / 溢出时细条出现 |
| R28 | XIT GOVH 自选表列错位：数字表头仍左对齐，`<td>` 被 flex 化后列宽跟着内容跑 | CSS Modules 里 `.table th, .table td` 特异性是 (0,1,1)，裸 `.numCell` / `.checkCol` / `.empty` 只有 (0,1,0)，**必须**写成 `.table .numCell` / `.table .checkCol` / `.table .empty` 才能生效；`.numCol` 必须显式定义 `text-align:right`。**禁止**把 `display:flex` 直接挂在 `<td>` 上（会破坏 table-cell 列宽），flex 只放在 `<td>` 内部 wrapper。新增的「计算过程」等派生文字**必须**走 `var(--rp-skin-ink, currentColor)`，不复用装饰色 `--rp-accent-rgb`（沿用 R02） | `GOVH.vue` `.numCol` / `.table .numCell` / `.materialCell` / `.needsCell` / `.calcCell` | `govh-verify-e2e.mjs` 断言数字右对齐、物料 td 为 `table-cell`、wrapper 为 `flex`、单价无 `input[inputmode=decimal]`；`verify-govh-theme.mjs` 三主题无低对比度 |
| R29 | XIT GOVH「本期 POPR 明细 + 六类需求」上下堆叠过长，改双栏又被表格撑破列宽 | 面板宽度由游戏窗口决定，**禁止**用 viewport `@media` 判断面板宽度。**必须**用 `grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr))`，窄面板自动落回单栏；表格外层 wrapper 必须 `min-width:0; overflow-x:auto`，列容器也必须 `min-width:0`，**禁止**在 grid 列上直接 `overflow:hidden` 截断表格。双栏紧凑表格用 `.table.miniTable` 抬特异性到 (0,2,1) 后才能覆盖 `.table th, td` 的 padding。新增小标题 / 项目行文字**必须**走 `var(--rp-skin-ink, currentColor)`，**禁止**裸色值与 `--rp-accent-rgb`（沿用 R02） | `GOVH.vue` `.reportGrid` / `.reportColumn` / `.miniTable` / `.subTitle` / `.projectLine` | `govh-verify-e2e.mjs` 断言明细 7 行 × 五类人口、双栏 `display:grid && children===2 && sameRow`、无 `Population__graph` DOM；`verify-govh-theme.mjs` 三主题 435 个文字节点 0 低对比度 / 0 小字 / 0 opacity 压淡 |
| R30 | XIT GOVH 20 行物料表每行重复建筑名，不同建筑之间边界不清；建筑列一旦 `rowspan` 合并，非组首行少一个 `<td>`，验收脚本按 `row.children[表头索引]` 取单元格必然错位；合并单元格还会被游戏原生 `!important` 规则刷成灰底 `rgb(240,240,240)`，做成「分组底色」会与原生的 hover / 选中态混在一起；把 `background` 挂在 `<tr>` 上又会让透明 `!important` 的合并单元格透出整行底色，勾选第一个物料时建筑 / 覆盖需求整块变色 | `buildOptions()` **必须**按 `UPKEEP_BUILDINGS` 顺序逐建筑连续 push，`solve()` / `filteredOptions` 只做 filter 保序；每行算出 `buildingStart` / `buildingSpan` / `groupIndex`，**建筑列与覆盖需求列都在组首渲染 `rowspan`**（覆盖需求显示该建筑组的需求并集，按 `INFRA_NEEDS` 排序，不含维生），组首行带 `data-govh-building-start="true"` 与 `data-govh-group`，**所有 td 必须带 `data-govh-col`**；验收**必须**按列属性定位，**禁止**用 `row.children[表头索引]`。**列顺序必须是 `建筑 \| 覆盖需求 \| 选 \| 物料 \| …`**，复选框与物料列排在两列合并单元格之后，非组首行从「选」列开始渲染即可，浏览器会自动把 rowspan 占住前两列。视觉分隔只允许三处：`.table tbody tr.groupStart td` 的 2px 上边框（`var(--rp-skin-border-strong, currentColor)`）、`.table .nameCell[rowspan]` 的 2px 左侧装饰色条（`rgb(var(--rp-accent-rgb))`）+ `vertical-align:middle`、组间上边框；另外「覆盖需求」合并列与「选」列之间**必须**有 2px 竖向边界：表头 `.needsHeader` 与合并单元格 `.needsCellMerged[rowspan]` 都写 `border-right: 2px solid var(--rp-skin-border-strong, currentColor) !important`，后者同时保留 `vertical-align: middle` 与 `background-color: transparent !important`。**禁止**交替淡底 / 斑马纹；为抵消游戏原生 `!important` 灰底，合并的 `.nameCell[rowspan]` / `.needsCellMerged[rowspan]` **必须**写 `background-color: transparent !important`，且验收要断言「无正 alpha 底色 + 各组底色一致 + 与普通 td 底色一致」。**禁止**再把 hover / selected 背景挂在 `<tr>` 上；改为只给 `td:not([data-govh-col='建筑']):not([data-govh-col='覆盖需求'])` 写 `background-color`：`tr:hover` 用 `rgba(var(--rp-accent-rgb), 0.08) !important`、`tr.rowSelected` 用 `rgba(var(--rp-accent-rgb), 0.1) !important`，两条规则都用 `!important` 压过游戏原生 td 底色，且 selected 规则写在 hover 之后保证强度不降。合并单元格因此始终不被染色。`--rp-accent-rgb` 仅作装饰，文字继续 `var(--rp-skin-ink, currentColor)`（沿用 R02），原样主题回退 `currentColor`。维生行角标只写文字「靠住房，补给无效」，**禁止**再用 `title` 浮窗重复下方说明；下方提示用 `「维生」需求` 强调，文字仍走 ink。表头两块原生 `<select>` 字号**必须**统一 `font-size: 11px`（R09 下限；游戏默认 13.33px 与面板控件不齐），占位文案固定 `选择自有基地星球`，**禁止**拼接星球数量（数量随账号变化会让占位忽长忽短且与下方选项重复） | `GOVH.vue` `materialRows` / `INFRA_NEEDS` / `data-govh-col` / `.groupStart` / `.nameCell[rowspan]` / `.needsCellMerged[rowspan]` / `.needsHeader` / `.rowSelected` / `.governmentSelect` / `.basePlanetSelect` / `.housingTag` / `.lifeNote`；`govh-verify-e2e.mjs` `layout.firstRowCols` / `grouping.mergedCellBgs` / `grouping.coverageHeaderBorderRight` / `selectionStyle` / `lifeSupportHint` / `basePlanetSelect.fontSize` / `placeholder` 断言；`verify-govh-theme.mjs` 完整面板 + 自定义模式合并测量 | `govh-verify-e2e.mjs` **77/77**（前四列顺序、5 个建筑组、建筑列与覆盖需求列均 rowspan 合并、组间粗线 + 色条 + 合并单元格透明底色、覆盖需求与选列 2px 边界、勾选前后合并单元格底色不变、选中行从复选框起向右 alpha 全 0.1 / 未选中行 0、无浮窗 / 无住房型号、自有基地星球下拉与手输兜底、下拉 11px / 占位无数量、焦点回弹守护、0 意外重载 / APEX 未断连）；`verify-govh-theme.mjs` **20/20**（三主题 n=273，low=0 / small=0 / faded=0，worstCR 6.11 / 5.63 / 6.18）；`govh-verify-remount.mjs` 8/8；`govh-verify-dom.mjs` 13/13；`govh-verify-cache-timing.mjs` 冷读 9805ms / 缓存 34ms / 强制 9008ms；`test-govh-model.mjs` 26/26；现场恢复 theme=light / compact=on / 0 残留窗口 / 0 测试标记 |

| R31 | XIT GOVH 维生由住房决定、政府补给改不了：原实现把 POPR 维生现值固定为封顶基线，采购层按 `target` 全额备货、预览层却按当前维生封顶、告警还写「无效超买」，三处口径分裂；`allTargetsMet()` 用含封顶的满足度判达标，维生低于目标时恒 false，导致 Phase2 每个待剔除物料都被立刻加回（冗余剔除完全失效）。默认 100% 维生预期下「封顶」列整列恒为「—」，三段说明堆在右栏表格脚下与左栏底部参差；顶部「目标满足度 70%/100%」与默认「预计补齐 100%」的维生预期叠在同一目标上，形成两个互相冲突的旋钮（70% 只把幸福度压到迁入阈值，并不减少二次采购） | **必须**在 `govh-model.ts` 用 `lifeSupportAssumption`（`current` / `full`）成对派生 `lifeBaseline`（POPR 现值 / 1.0）与 `effectiveTarget`（`min(target, 维生现值)` / `target`），Phase1 缺口 / Phase2 达标判据 / 预览 / `achievable` 全部走同一组；`NeedState` 拆 `fulfillment`（按假设的预测值）与 `displayNow`（游戏此刻实际显示值），预览格用 11px 小字标「当前 XX%」；`limitingNeed` 仍按原 `target` 诊断，UI 只在 `!achievable` 时告警，**禁止**再写「无效超买」。运行时默认 `full`（`useTileState('govh-life-assumption', 'full')`），纯函数缺省 `current` 保持向后兼容；肥沃星球维生 100% 时两档等价、按钮禁用。**必须**删除恒为空的「封顶」列（六类需求表保留 5 列）；说明区**必须**移出右栏，用与 `reportGrid` 同款 `auto-fit + minmax(min(100%, 330px), 1fr)` 栅格排成「两段注记左右对齐 + 成本对照 `grid-column: 1 / -1` 整宽收尾」，**禁止**堆在右栏表格下方。「XX% 封顶」强调**必须**只用 `var(--rp-skin-danger, currentColor)` 改文字色 + 字重，**禁止**铺底色、用 `--rp-accent-rgb` 当文字色或写裸色值（R02 / R27）；新增派生文字统一 11px + `opacity:1`（R09 / R10）。顶部**必须**删除「目标满足度 70%/100%」档位，目标固定 `TARGET = 1`（模型 `target` 仍支持任意 0~1，要恢复省钱档只需加回 UI）；控件区**必须**收成一排：维生预期与动作按钮同行，`刷新数据/更新价格` 包进 `.actions` 且 `margin-left:auto` 靠右收尾，**禁止**把维生预期挤到第二排 | `GOVH.vue` `lifeAssumption` / `solveBase` / `assumptionCosts` / `assumptionNoteParts` / `.notes` / `.noteCost` / `.lifeCap` / `.previewNow`；`govh-model.ts` `LifeSupportAssumption` / `cappingFromProvided` / `allTargetsMet` / `solve`；`govh-verify-e2e.mjs` `assumption` / `notes` / `needHeaders` 采集 | `govh-verify-e2e.mjs` **89/89**（维生预期两档按钮与默认 full、full / current 说明与双口径、两档成本对照含差额 0 等价文案、删除封顶列后 5 列、说明区同栅格且成本整宽、警示文字色 `rgb(156,59,59)` 且背景透明、目标档已移除 / 顶部单排控件而动作组靠右）；`test-govh-model.mjs` **32/32**（缺省 current、有效目标 / 基线派生、预测与实际分离、两档成本、肥沃等价、Phase2 回归）；`verify-govh-theme.mjs` **20/20**（三主题 n=274，0 低对比度 / 0 小字 / 0 opacity，worstCR 5.63 / 5.05 / 6.18） |

### E. 语义色与数字

| ID | 现象 / 根因 | 固化规则 | 落点 | 验证 |
|---|---|---|---|---|
| R18 | 期限告警黄/红被收敛成石板蓝；选中态与未选中态分不出 | **必须**保留 `statusOverride()`（warning/danger）与 `semanticOverride()`（指示器、`<progress>` 容量条）；选中态拉回深色 | `theme.ts statusOverride / semanticOverride` + `Skin.status/indicator/progress` | `verify-theme-fixes.mjs` |
| R19 | 正负数字色被 `:is(td,th)` 统一文字色压成中性灰 | **必须** `:is(td, th):not([class*='ColoredValue'])`；原生 FIN 的语义色挂在 span、XIT FINBS 挂在 td，两类都要保留语义绿/红 | `theme-ceramic.ts` 表格段；`refined-prun.css` 第 6) 组 | `verify-fin-style.mjs` 正数颜色一致 |
| R20 | 缓存窗口边框从石板蓝→橙色→深蓝反复改 | 边框色**必须**走 `--rp-window-border-rgb`（纯三元组），用 `box-shadow` 不占盒模型；当前定值深蓝 `25, 60, 105` | `refined-prun.css` 分节 A/N | 真机取色 |
| R26 | 原生命令执行状态斜纹（运行中橙滚动 / 完成绿静止）在自定义主题下发白 | 游戏原生把颜色**写死在 `repeating-linear-gradient` 字面量**里，`collect()` 判 `gradient` 角色后换成 `palette.*.gradient` 近白；与 `--rp-color-*` 被污染是**两条独立路径**，第 6) 组的变量重定义覆盖不到，且 `COGCPEX` 等原生窗口不在 XIT/FIN 作用域。**必须**按 `ActionFeedback__progress/success/error` 类名直接覆盖 `background-image` / `background-color`，用 `color-mix(in srgb, var(--rp-skin-action-*) …, transparent)`（整条值不含颜色字面量，不会被扫描）；**禁止**改 `animation` / `background-position`（保留滚动与静止的区别）；**禁止**写裸色回退；规则带 `html[data-rp-theme]` 前缀，原样主题不受影响 | `refined-prun.css` 第 8) 组 | `verify-round26.mjs` 三主题 × 两态取色 + 原样 `styleLen===0` |
| R27 | BRA「所需材料」里仓库不够的数量角标本该是红的，实际显示成墨色 | 游戏自己用 `MaterialIcon__danger` 标记缺料，但主题的 `html[data-rp-theme] [class*=MaterialIcon__indicator]` 统一角标文字色（墨色 + `!important`）把它压掉了。**必须**给 danger 角标单独补一条更高特异性的规则恢复语义红；颜色**必须**走新 token `--rp-skin-danger`（skin 模式给字面量、token 模式别名 `--rp-cc-status-danger-text`），**禁止**写裸色值；作用域只到 `[class*=rp-command-BRA]`，其它面板角标不动 | `theme.ts` CONTROL_CSS 角标段 + `SKINS.light/paper.vars` + `theme-ceramic.ts vars` | `verify-bra-material-red.mjs`（danger 角标为红、非 danger 角标仍为墨色、原样主题不变） |
| R32 | CXPO 底部「买入（success）/ 卖出（danger）」在自定义主题下与中性按钮同色：CONTROL_CSS 把所有 `Button__btn` 统一成中性 panel 色，但只补了 `Button__primary` / `Button__disabled` 规则，缺 `Button__success` 与 `Button__danger` 规则；陶瓷白 `buildComponentCss` 有 `Button__danger`（深红）却缺 `Button__success`，买按钮落中性色。用户要求恢复绿 / 红语义但深度降到约原主题 1/3（浅底 + 深语义字） | 三套主题都必须给 `Button__success` 与 `Button__danger` 单独着色：light/paper 走新增 `--rp-skin-success*` / `--rp-skin-danger-bg/border`（浅底深字）；陶瓷白走 `--rp-cc-status-success-*` / `--rp-cc-status-danger-*`（本就是浅底深字，即 1/3 深度）。hover 仅加深边框、保持浅底；active 用边框 / 文字色作按压反馈。**陶瓷 danger 由深红 `btn-danger` 改为浅红 `status-danger`**，与所有 danger 按钮（删除等）一致（沿用 R27 的 `--rp-skin-danger` 语义） | `theme.ts CONTROL_CSS`（success/danger 段 + `SKINS.light/paper.vars`）；`theme-ceramic.ts buildComponentCss`（success 段 + danger 段改 status token） | 真机三主题 CXPO AIR.IC1 取色：买入≈绿浅底深字、卖出≈红浅底深字，与中性按钮区分；hover/active 可见 |
| R33 | XIT FLT 燃料条（`<progress>` + `ProgressBar.primary` STL / `ProgressBar.secondary` FTL）在浅色自定义主题下过重：填充取 `skin.progress.primary/secondary`，原色（light `#33566f` / paper `#8a5a1c`、ceramic `cat-1/cat-2-chart` 实色）深度偏高 | 进度主 / 次填充各减半深度（light `#99abb7` / `#c5b193`、paper `#c5ad8e` / `#9fb5b8`）；ceramic 新增专用 token `--rp-cc-progress-primary` / `--rp-cc-progress-secondary`（由 cat-1 / cat-2 chart 减半），与图表实色**分离**（改进度色不影响图表序列配色），`buildCeramicSkin` 与陶瓷 `ProgressBar__primary ::-webkit-progress-value` 直接规则都指向它。`warning/success/danger` 进度色保持原对比度不动 | `theme.ts SKINS.light/paper.progress`；`refined-prun.css` 新增 `--rp-cc-progress-*`；`theme-ceramic.ts buildComponentCss.progress` + 直接 CSS 规则 | 真机三主题 FLT 燃料条取色明显变浅；图表序列色不受影响 |

### F. 原样主题与历史数据

| ID | 现象 / 根因 | 固化规则 | 落点 | 验证 |
|---|---|---|---|---|
| R21 | 自定义主题规则误伤原样主题 | **必须**保证所有覆盖规则带 `html[data-rp-theme]` 前缀；`default` 时清空 `style.textContent` + `delete dataset.rpTheme` + 断开 observer；组件一律 `var(--rp-skin-*, <原样深色回退>)`；`chartColors()` 对非 token 模式返回 `FALLBACK`；固定文字选中态要有 `:not([data-rp-theme])` 并列分支 | `theme.ts apply()`；全库 `var()` 回退 | `verify-fin-style.mjs`（`data-rp-theme` 不存在、表头透明、字重 400）；`verify-ceramic-theme.mjs`（`styleLen===0`） |
| R22 | 迁移引用注册表导致旧数据被误改 | **禁止**在 `user-data-migrations.ts` 里 import 注册表；历史 id（如 `mint`）与回退目标**必须**硬编码。迁移描述「当时的数据」，不能随注册表变化；**删除主题必须补一条迁移** | `user-data-migrations.ts` | 迁移单测 / 真机旧档 |
| R23 | 反色滤镜方案残留 | **禁止**再引入 `invert()` / `hue-rotate()` / `darkMode`；主题一律「直接改颜色」 | `theme.ts` 引擎 | 代码审查 |

---

## 5. 新增主题 SOP

### 5.1 `skin` 模式（最快，适合「再做一套别的颜色」）

1. `src/features/basic/theme-registry.ts` → `THEMES` 加一项：
   `{ id: '<新id>', label: '…', desc: '…', mode: 'skin' }`。
2. `src/features/basic/theme.ts` → `SKINS` 加同名 key，**完整复制** `light` 的 `Skin` 结构后改色：
   `vars`（全部 `--rp-skin-*`，含 4 个 bridge）、`palette` 三族、`neutralShift`、`status`、`indicator`、`progress`。
   缺任何一组都会让 `mapColor()` 拿到 `undefined`。
3. `src/refined-prun.css` → 分节 B 加 `html[data-rp-theme='<新id>']` 的 4 类 `--rp-inv-cat-*-rgb`（纯 RGB 三元组）。
   若沿用全局兜底值可不改，但**要确认四类在该底色上对比度 ≥4.5**。
4. 完成。`ThemeId`、设置卡片、引擎集合、feature 描述自动跟随；首屏防闪与图表保持默认（与原样/light/paper 一致）。

### 5.2 `token` 模式（精细多彩主题）

1. 注册表加一项 `mode: 'token'`。
2. `src/refined-prun.css` 新增 `html[data-rp-theme='<新id>'] { ... }` 色板块，**照抄现有 `--rp-cc-*` 变量名全量定义**（约 90 个）：背景/文字/边框/5 类按钮×3 态/控件/表格/4 类状态/分类 1..8 各 4 个/图表 token。变量名必须完全同名，`buildCeramicSkin()` 与 `buildComponentCss()` 才能复用。
3. 同文件加 `html[data-rp-theme='<新id>'] body { ... }` 首屏底色与正文色。
4. 完成。首屏防闪、图表取色、8 色相带 Skin、100+ 条组件映射骨架全部自动生效。
5. **必须**跑 `prun-cdp/verify-ceramic-contrast.mjs` 的等价校验（把脚本读的色板块换成新 id），逐项确认 WCAG 2.1 ≥4.5。

### 5.3 两种模式都要做的收尾

- 跑 §8 全部验收；特别断言**原样主题**未受影响（R21）。
- 在 §7 台账追加一行，写清「为什么选这个 mode / 色板怎么定的」。
- 若改了任何共用规则，先更新 §4 对应条目再改代码。
- 若**删除**主题：删注册表项 + 删色板 + **必须补迁移**（R22）。

---

## 6. 原样主题红线（回归红线，一条都不能破）

1. `default` 不写 `data-rp-theme`、`#rprun-theme` 内容为空、observer 断开。
2. 所有覆盖规则带 `html[data-rp-theme]` 前缀；token 色板块只在精确 id 下生效。
3. 组件的 `var(--rp-skin-*, <回退>)` 回退值必须是游戏原生深色，不能删。
4. 首屏只对 `needsStartupMarker()` 为真的主题提前打标记。
5. 图表对非 token 模式返回 `FALLBACK`。
6. 固定文字选中态要有 `:not([data-rp-theme])` 并列分支，且**只留下划线**，不加底色、不改文字色/字重。

---

## 7. 修改台账（append-only）

> **这就是「以后再有修改，修改逻辑也写进固化里面」的落点。**
> 每次主题改动追加一行，四列必填：`改了什么` / `为什么（修改逻辑）` / `固化为哪条规则` / `怎么验的`。
> 若改动**新增或推翻**了一条规则，同时更新 §4 对应条目（不要只写台账不改规则库）。
> 只追加，不改历史行。

| 日期 / 提交 | 改了什么 | 修改逻辑（为什么这么改） | 固化为 | 验收 |
|---|---|---|---|---|
| 早期 `5a2aad2e` | 反色滤镜 `invert + hue-rotate` | 初版做法，图片/图表一起被反色、语义色失真 → 已废弃 | R23（禁止） | — |
| `245c485a` / `2dbef90d` | 主题系统重写：改为 CSSOM 扫描、按角色重映射颜色 | 只改颜色不动布局/数据；每套皮肤只换一组 token | §3.1、R07、R23 | 三主题基础取色 |
| `cb4d22ea` | 窗口深蓝描边、FB/INV 排版、BRN 分类分色 | 缓存窗口边界在浅底不清；橙边框视觉突兀 → 深蓝 + box-shadow 不占盒模型 | R20、R14 | `verify-theme-cat-colors.mjs` |
| `1fcc70e3` | CXOS 强调文字改 `--rp-skin-selection`（1.03→6.94） | `--rp-color-accent-primary` 被主题引擎刷成近白，浅字压浅底 | R02、R03 | CXOS 对比度 |
| `288261d8` | 全库 XIT 可读性整改：小字 ≥11px、opacity 归 1、状态色改 `--rp-skin-*`、半透明遮罩兜底、warm paper 深色化 | 三套自定义主题下浅底把细线/淡字/白半透明全部冲淡；统一走不受扫描影响的 `--rp-skin-*` | R09、R10、R11、R04 | `verify-round25.mjs` 三主题 × 8 面板 106/106 |
| 2026-11-09（未提交） | 原生 `FIN*` 与 `XIT FIN*` 格式统一；陶瓷白 `:is(td,th)` 排除 `ColoredValue` | 第 6) 组原只挂 `.rp-command-XIT`，原生财务窗口一条没吃到 → 表头/线条/数字色分裂；td 上的正负色类被统一表格文字色压成中性灰 | R12、R19 | `verify-fin-style.mjs` 129/129（三主题 × 6 类窗口 + 原样主题） |
| 2026-11-09（未提交） | **本框架固化**：注册表、三种 mode、组件映射骨架参数化、本文件 | 主题 id/描述散在 7 处手工同步；105 处硬编码 `ceramic-colorful` 前缀使新主题必须整段复制；20+ 条踩坑修正只存在于代码注释与验收脚本，没有单一事实源 | §0~§6 全部；R01、R04、R22 补充 | 类型检查 + 完整构建链 + 真机三主题回归（见 §8） |
| 2026-11-09（未提交） | FB 槽位白边、INV 双滚动条 / 紧凑强制滚动条、原生状态斜纹发白，共 4 项 | ① FB 槽位浅色 `var()` 回退 + 原生 6px 外边距 → 原样主题 BS/BURN 露出 14px 宽白边，INV 已铺满所以看不到；② `overflow:scroll` 无溢出也画轨道、紧凑模式清零负 margin 暴露第二套，主题全局 `scrollbar-color` 又让细条变 ≈10px 标准条；③ 游戏原生斜纹颜色是 `repeating-linear-gradient` 里的**字面量**，被 CSSOM 的 gradient 角色映射刷白，与 `--rp-color-*` 污染无关，第 6) 组变量兜底覆盖不到。一律选**局部 CSS 兜底**而非改引擎 `semanticOverride()`：后者只处理 `background-color`、不处理 `background-image`，要扩展需动 Skin 接口 + 三份色板，回归面最大；槽位改透明回退 + 清零外边距比改盒模型高度更安全；滚动条只隐藏自绘轨道、保留 4px webkit 细条，`overflow:auto` 天然按需 | 新增 R24、R25、R26 | `verify-round26.mjs`（三主题 + 原样真机）、完整构建链、既有主题回归脚本 |
| 2026-11-10（未提交） | 新增 `--rp-skin-danger`（light `#9c3b3b` / paper `#9b4741` / ceramic `var(--rp-cc-status-danger-text)`）；CONTROL_CSS 角标段补 BRA 的 danger 角标规则 | 用户反馈 BRA「所需材料」缺料看不出红：游戏靠 `MaterialIcon__danger` 标缺料，但统一角标文字色规则（墨色 `!important`）把它压成 rgb(38,51,61)。选「补一条更高特异性规则 + 新语义 token」而不是放宽统一角标规则：统一角标色是上一轮为可读性定的，放宽会连带改所有面板图标角标；也不写裸色值（R01），只在三套色板各加一个 token。作用域收到 BRA，避免波及 INV/SHPI 紧凑角标 | 新增 R27 | `verify-bra-material-red.mjs`：BRA danger 角标 `rgb(156,59,59)`、同排非 danger 角标仍为墨色、`default` 主题无 `#rprun-theme` 样式 |
| 2026-11-11（未提交） | 新增 XIT GOVH 面板自带 CSS；`.statValue`/`.buildingLevel`/`.emptyState code` 文字色从 `rgb(var(--rp-accent-rgb))` 改为 `var(--rp-skin-ink, currentColor)` | 三主题回归发现暖米纸 / 陶瓷白多彩下五类人口幸福度大数字对比度只有 3.95 / 3.77（<4.5）：`--rp-accent-rgb` 是**装饰色**（该主题为深棕/多彩强调）且 `.statCell` 正用它的 0.05 透明底，同色字压同色浅底必然不够。它虽是纯三元组不被 CSSOM 重映射，但本质上不是文字 token。R02 原只点名 `--rp-color-accent-primary`，本次把 `--rp-accent-rgb` 一并列入禁止当文字色，文字统一走 `--rp-skin-ink`。装饰用途（边框 / 复选框 `accent-color` / 卡片底纹）保留不变 | R02 补充（明确 `--rp-accent-rgb` 禁止当文字色） | `verify-govh-theme.mjs`：三主题 × GOVH 面板 0 低对比度 / 0 小字 / 0 opacity 压淡；原样主题现场（url/主题/紧凑态/窗口集合）恢复一致 |
| 2026-11-11（未提交） | GOVH 表头从手输星球改为「我管理的政府」下拉；新增本地读取层 `govh-governments.ts`，面板内用原生 `<select>` + 显式「自定义编码…」兜底 | 用户希望不用手输星球编码。运行时不能连 FIO，也不能硬编码账号数据；`userDataStore.contexts` 只有 `GOVERNMENT` 类型和 context id，没有星球字段。实机「视图」菜单的 `a[href*="context="]` 同时带 context id 和内层 span 的 `星球名 (naturalId)`，两边按 context id 关联即可得到纯本地映射；只认 `GOVERNMENT` 避免把公司上下文混进下拉。自定义编码保留为显式兜底，不默认显示输入框，避免面板自身 DOM 更新通过 MutationObserver 触发无意义刷新。新增的 `select` 文字走 `var(--rp-skin-ink, currentColor)`，继续遵守 R02，不用 `--rp-accent-rgb` | 沿用 R02（无新规则） | `vue-tsc` + 完整构建链；`govh-verify-e2e.mjs` 39/39（下拉选项 / 公司上下文排除 / 切换政府自动重读 / 自定义编码大小写回正 / 无默认输入框 / 零外部请求 / 无残留窗口）；`verify-govh-theme.mjs` 17/17（下拉 `select` 文字纳入对比度测量，三主题 worstCR 6.02 / 5.33 / 6.18） |
| 2026-11-11（未提交） | GOVH「补给方案 · 全部物料自选」表：`.numCol` 显式右对齐，裸 `.numCell` / `.checkCol` / `.empty` 改成 `.table .xx` 抬特异性；`<td>` 的 `display:flex` 挪进内部 wrapper；新增「计算过程」列（30 天毛量 − 下一次消耗 − 储备 = 待补）；单价改只读文本并复用 BPC/BMAT/CBUY 的本地订单簿口径；底部删两个购物车按钮；五类人口卡片去掉「人口 0/1/…」前缀 | 用户反馈表头/单元格错位、单价不该手填、数量要扣基建内部两栏存量。CSS Modules 的 `.table th, .table td` 特异性 (0,1,1) 会压掉裸类 (0,1,0)，`<td display:flex>` 会破坏 table-cell 列宽；手填单价会脱离 BPC/BMAT/CBUY 的同一口径；基地仓库与「库存/贡献」不是用户要扣的设施内部空间。新增派生文字继续走 `var(--rp-skin-ink, currentColor)`，不碰装饰色 `--rp-accent-rgb`（沿用 R02），原样主题继续回退 `currentColor` | 新增 R28；沿用 R02 | `scripts/test-govh-model.mjs` 22/22；`govh-verify-e2e.mjs` **47/47**（数字列右对齐、td=`table-cell` / wrapper=`flex`、单价无 `input[inputmode=decimal]`、20 行计算过程含两栏存量、底部仅两个按钮、零外部请求、无残留窗口）；`govh-verify-dom.mjs` 13/13（POPID progress 当前值）；`verify-govh-theme.mjs` **17/17**（三主题 0 低对比度 / 0 小字 / 0 opacity 压淡，现场恢复一致） |
| 2026-11-11（未提交） | GOVH「现状与目标预览」：新增本期 POPR 报告明细（人口 / 变更 / 移民 / 教育（增/减）/ 幸福 / 失业 / 待聘 × 五类人口，含报告编号与项目说明，不含折线图），与六类需求表改左右双栏；删除底部会循环打开自身的 `XIT GOVH <planet>` 链接；新增会话级快照缓存与价格订阅去重 | 用户反馈现状栏目只有人口、六类需求表太占高；POPR 原生明细是 7 行表格，折线图 DOM（`Population__graph` / `PopulationChart__container`）不纳入。面板宽度由游戏窗口决定，viewport 媒体查询不可靠，故用 `auto-fit + minmax(min(100%, 330px), 1fr)` 让窄面板自动落回单栏；表格各自 `overflow-x:auto` 不挤压列宽。底部 `PrunLink` 指向当前命令本身，点击会再开一个 GOVH 面板，直接删除。每次打开 / 切回都重开 POPR + POPI + 5 座 POPID hidden 窗口约 10s，改为 `sessionStorage` 按星球缓存 5 分钟（「刷新数据」强制绕过并覆写）；价格订阅按 `ticker.exchange` 去重，「更新价格」等待订阅结束回收提示 | 新增 R29；沿用 R02 | `govh-verify-e2e.mjs` **58/58**（7 行明细、双栏 `sameRow`、无折线图 DOM、无自链接、首开冷读、切回命中缓存、刷新数据强制重读、更新价格提示回收）；`govh-verify-dom.mjs` 13/13；`verify-govh-theme.mjs` **17/17**（435 个文字节点 0 低对比度 / 0 小字 / 0 opacity）；`govh-verify-cache-timing.mjs` 冷读 9.6~14.7s → 缓存切回 35ms，强制刷新 9.6s |
| 2026-11-11（未提交） | GOVH 五类人口大卡片删除重复的人口数量行（只留等级 + 幸福度），移除 `.statSub` 死样式；快照恢复从 `onMounted` 异步读缓存前移到 `setup` 同步恢复（`restoreFromCache()`），根元素加 `data-govh-restored=cache\|cold` 标记；`onMounted` 命中缓存时跳过 `refreshData` 重读 | 用户反馈两件事：① 上方人口卡片的人口数与下方 POPR 报告明细「人口」行重复；② 每次切换 / 激活 GOVH 都要重新载入计算过程、卡。实测定位：`solve()` 仅 0.109ms、静止 6s DOM 零 mutation，故非算法慢亦非订单簿推送；真因是切换视图重建 XIT 磁贴 → 组件重新挂载 → `snapshot` 初始 undefined → 首绘空态 → `onMounted` 读缓存赋新引用 → 20 行 × 11 列整表（含计算过程长文本）二次重建。选在 `setup` 阶段同步恢复 `sessionStorage` 快照，让首次渲染即完整，而非改 XIT 挂载框架（影响所有命令、回归面大）；价格仍走 `cxobStore` 实时源不进缓存，「刷新数据」仍强制重读，不牺牲可刷新性。删除的 `.statSub` 用裸灰值但仅此一处、随元素一并移除；保留的卡片文字继续走 `var(--rp-skin-ink, currentColor)`（沿用 R02），原样主题回退 `currentColor` | 沿用 R02 / R29（无新规则） | `govh-verify-e2e.mjs` **60/60**（人口卡片只 2 行含 %、无独立人口数字行）；`govh-verify-remount.mjs` **8/8**（`force` 新建实例首帧 130ms 即 20 行完整、`data-govh-restored=cache`、无冷读、无「0→20 行」二次重建）；`govh-verify-theme.mjs` **17/17**（429 节点，少 5 个人口数字，三主题 0 低对比度 / 0 小字 / 0 opacity）；`govh-verify-dom.mjs` 13/13；`govh-verify-cache-timing.mjs` 冷读 8709ms / 缓存切回 **9ms** / 强制 8208ms |
| 2026-11-11（未提交） | GOVH 补给方案：同一建筑列 `rowspan` 合并（5 组，rowspan 3/3/5/4/5）；组首行 2px 上边框，合并建筑单元格 2px 左色条 + 交替组淡底；所有 `<td>` 加 `data-govh-col`，e2e 改按列属性定位；`TextInput` 复用 `focus-on-mount` 修复自定义编码模式无法直接输入；`govh-verify-remount.mjs` 修复 docked 磁贴漏标导致的假失败 | 用户反馈建筑列每行重复、不同建筑之间边界不清，并要求「就是合并单元格，并且加上视觉上的可分辨性」；另一条反馈是选「自定义编码…」后键盘输入被原生 `<select>` 的 type-ahead 吞掉。`buildOptions()` 已按 `UPKEEP_BUILDINGS` 连续 push 且 `solve()` / filter 保序，故同建筑行天然相邻，`rowspan` 合并不需要改求解顺序，避免影响推荐结果。`rowspan` 会让非组首行少一个 `<td>`，`row.children[表头索引]` 必然错位，改用 `data-govh-col` 语义定位。视觉分隔选「组间粗线 + 建筑列装饰色条 + 仅合并单元格淡底」，而不是整行斑马纹：游戏原生给每个 td 上了不透明背景，整行底色会被压掉，且会与 hover / 选中态冲突；色条与淡底只作装饰，文字继续 `var(--rp-skin-ink, currentColor)`，`--rp-accent-rgb` 不作文字色（R02）。自定义模式不新写聚焦逻辑，直接复用组件已有的 `focus-on-mount` | 新增 R30；沿用 R02 | `vue-tsc` + 完整构建链 + 扩展 reload；`scripts/test-govh-model.mjs` 26/26；`govh-verify-e2e.mjs` **64/64**（5 组 rowspan 匹配、组间粗线 / 色条 / 淡底、所有 td 带列属性、选完自定义编码自动聚焦并直接输入 `ZZ-777y`）；`verify-govh-theme.mjs` **17/17**（三主题 n=399，low=0 / small=0 / faded=0，worstCR 5.46 / 5.54 / 6.18）；`govh-verify-dom.mjs` 13/13；`govh-verify-remount.mjs` 8/8；`node status.mjs` 无残留测试窗口，主题 `light` / 紧凑态 `on` 恢复原样 |

| 2026-11-11（未提交） | GOVH 补给方案：建筑列与覆盖需求列按建筑 `rowspan` 合并并去掉交替淡底；维生行去掉 `title` 浮窗、下方改为「维生」需求定稿；自定义模式新增「自有基地星球」下拉（一星球一基地，不显示数量）；修复选完原生 `<select>` 后焦点被游戏 Frame 抢走导致手输框打不进字 | 用户反馈：建筑栏不要底色区分，只留粗线；维生角标 tooltip 与下方说明重复且措辞要改写；自定义星球应只给已有基地的星球，不要全量列表。真机诊断：合并单元格被游戏原生 `!important` 刷成灰底 `rgb(240,240,240)`，普通 `background:transparent` 压不住，必须同用 `!important`；GOVH 根容器没有 `tabindex`，且真人鼠标点原生 select 时游戏全局 click 会在 `TextInput` 单次 `nextTick` focus 后把焦点抢回，故需要 600ms 守护式聚焦（focusout + 轮询，遇到用户主动切到其它可交互控件立即放手）。有基地星球只来自本地 `sitesStore` + `planetsStore`，运行时零外部请求，按 naturalId 去重即可（游戏约束一星球一基地），选项不再显示基地数量 | 修改 R30；沿用 R02 | `vue-tsc` + 完整构建链 + 扩展 reload；`scripts/test-govh-model.mjs` **26/26**；`govh-verify-e2e.mjs` **71/71**（建筑列与覆盖需求列 rowspan / 粗线 / 色条 / 透明底色、无浮窗 / 无住房型号、自有基地星球下拉与 sitesStore 一一对应、焦点回弹守护、零外部请求）；`verify-govh-theme.mjs` **20/20**（三主题 n=273，0 低对比度 / 0 小字 / 0 opacity，worstCR 6.11 / 5.63 / 6.18）；`govh-verify-dom.mjs` 13/13；`govh-verify-remount.mjs` 8/8；`govh-verify-cache-timing.mjs` 冷读 9520ms / 缓存切回 12ms / 强制 8724ms；`node status.mjs` + 只读现场检查：theme=light / compact=on / 0 窗口 / 0 测试标记 |

| 2026-11-11（未提交） | GOVH 补给方案：前四列改为 `建筑 \| 覆盖需求 \| 选 \| 物料`；hover / selected 背景从 `<tr>` 下沉到「选」及其后的 `<td>`，两列合并单元格不再被染色；「覆盖需求」表头与合并单元格补 2px 右边界；政府 / 自有基地星球两个 `<select>` 统一 11px，占位文案去掉星球数量；`govh-verify-e2e.mjs` 新增断言至 77 项并加入 APEX 断连归因 | 用户连续反馈：勾选每个建筑的第一个物料时合并单元格「整块变色」不协调；覆盖需求列与「选」列之间没有边界；自有基地星球下拉字体 13.33px 太大、占位里的星球数量多余。真因是 `<tr>` 级背景会透过合并单元格的 `transparent !important` 显出来，故把着色下沉到 td 并用 `:not([data-govh-col='建筑']):not([data-govh-col='覆盖需求'])` 排除两列，强度保持 hover 0.08 / selected 0.1 不变；同时把复选框与物料列移到两列合并单元格之后，让被染色的列在视觉上连成一片。边界走 `--rp-skin-border-strong, currentColor` 且同用 `!important`，原样主题回退 `currentColor`（R30 / R02）；字号取 R09 下限 11px 与面板原生控件一致，占位不拼数量避免随账号变化。另确认一次 58/19 **不是**脚本 frame 选择回归：只读探测到页面正文「无法连接到APEX网络」、`navType=reload`、窗口数归零，是服务器维护导致 SPA 重载清空 GOVH 面板，故只加导航计数 / 断连 WARN 归因，不改交互逻辑 | 修改 R30；沿用 R02 / R09 | `vue-tsc` + 完整构建链 + `test-govh-model.mjs` **26/26**；列顺序 / 着色阶段 `govh-verify-e2e.mjs` **74/74**、边界阶段 **75/75**，服务器恢复后**最终 77/77 全绿**（0 外部请求 / 0 页面异常 / `unexpectedNavigations=0` / `apexOffline=false`）；同期 `verify-govh-theme.mjs` 20/20、`govh-verify-dom.mjs` 13/13、`govh-verify-remount.mjs` 8/8、`govh-verify-cache-timing.mjs` 冷读 9805ms / 缓存 34ms / 强制 9008ms 全绿；现场 theme=light / compact=on / 0 残留窗口 / 0 测试标记 |

| 2026-11-11（未提交） | GOVH 新增「维生预期」两档（`按当前 XX%` / `预计补齐 100%`，默认 full）；`govh-model.ts` 统一 Phase1 / Phase2 / 预览 / `achievable` 的封顶基线与有效目标，修复维生低于目标时 Phase2 冗余剔除失效；六类需求表删「封顶」列、说明区移出右栏改同栅格双列 + 整宽成本行；「XX% 封顶」改语义警示文字色 | 用户提出政府改不了维生、但一个人口报告周期内住房通常会补齐，应按 100% 维生提前备货。读码发现采购层本就按 `target` 买满，不一致的是预览 / 告警口径；更严重的是 `allTargetsMet()` 含封顶判据在维生 < target 时恒 false，让 Phase2 全部回滚（真 bug）。选「显式假设 + 一组派生量贯穿全流程」而非新增一套乐观算法：`lifeBaseline` 与 `effectiveTarget` 成对派生，`NeedState` 拆预测值 / 实际显示值，避免把预测当事实。删封顶列是因为默认 full 下整列恒「—」，其信息已被预览格「当前 XX%」小字与说明覆盖；说明区移出右栏是为了让左右两栏底部不再参差，仍沿用 R29 的 auto-fit 栅格。强调色走 R27 已固化的 `--rp-skin-danger`，不铺底色、不用装饰色当文字色（R02），11px + `opacity:1` 满足 R09 / R10 | 新增 R31；沿用 R02 / R09 / R10 / R27 / R29 / R30 | `vue-tsc` + 完整构建链 + `test-govh-model.mjs` **32/32**；`govh-verify-e2e.mjs` **88/88**、零 FAIL 零 WARN；`verify-govh-theme.mjs` **20/20**（三主题 n=275，0 低对比度 / 0 小字 / 0 opacity）；`govh-verify-dom.mjs` 13/13；`govh-verify-remount.mjs` 8/8；`govh-verify-cache-timing.mjs` 冷读 12460ms / 缓存 82ms / 强制 12759ms；`status.mjs` / `check-residual.mjs` 正常，现场 theme=light / compact=on / 0 残留窗口 |

| 2026-11-11（未提交） | GOVH 顶部删除「目标满足度 70% / 100%」两档，目标固定 `TARGET = 1`；「维生预期」与「刷新数据 / 更新价格」收成一排，动作按钮包进 `.actions` 并 `margin-left:auto` 靠右；`govh-verify-e2e.mjs` 改 89 项（新增「目标档已移除」「顶部单排控件 / 动作组靠右」断言，删掉 70%↔100% 切换用例） | 用户提出：默认维生预期已经是「预计补齐 100%」，再保留 70% 档等于在同一个目标上开两个互相冲突的旋钮，且顶部两排按钮视觉冗余。核对设计文档确认 70% 的原始含义只是「把幸福度压在迁入阈值上省钱」（游戏 H>70% 才迁入），并不会减少后续二次采购；面板定位是「一个报告周期备足」，因此固定 100% 更符合默认假设。模型层仍保留任意 `target`，删除的只是 UI 档位，日后要恢复省钱档不必改求解器。顺带把动作按钮成组右对齐，避免窗口变窄时「维生预期」被单独挤到第二排 | 修改 R31；沿用 R02 / R09 / R10 / R27 / R29 | `vue-tsc` + 完整构建链 + `test-govh-model.mjs` **32/32**；`govh-verify-e2e.mjs` **89/89**（零 FAIL 零 WARN，含目标档移除 / 单排控件 / 动作组靠右）；`verify-govh-theme.mjs` **20/20**（三主题 n=274，low=0 / small=0 / faded=0）；`govh-verify-dom.mjs` 13/13；`govh-verify-remount.mjs` 8/8；`govh-verify-cache-timing.mjs` 缓存命中 16 / 40ms、强制刷新 12184 / 19342ms（冷读标记本次未采到，脚本判 -1）；status / residual 正常 |

| 2026-11-11（未提交） | 三主题 CXPO 买入/卖出按钮与 FLT 燃料条：① CONTROL_CSS 新增 `Button__success` / `Button__danger` 规则（light/paper 走新增 `--rp-skin-success*` / `--rp-skin-danger-bg/border` 浅底深字；陶瓷白 success 走 `--rp-cc-status-success-*`、danger 由深红 `btn-danger` 改为浅红 `status-danger`）；② `SKINS.light/paper.progress.primary/secondary` 减半（`#99abb7`/`#c5b193`、`#c5ad8e`/`#9fb5b8`），ceramic 新增 `--rp-cc-progress-primary/secondary` 专用 token（`buildCeramicSkin` 与 `ProgressBar__primary` 直接规则均指向），与图表 cat-1/cat-2 实色分离 | 用户反馈：CXPO 买/卖按钮在自定义主题下同为中性色（失去绿/红语义），要求恢复语义但 1/3 深度；FLT 燃料条在浅色主题下过重，要求减半并同步三主题。根因分别是 CONTROL_CSS / 陶瓷组件 CSS 缺 `Button__success` 规则、且 danger 在浅色下无单独规则；进度填充深度偏高。选「补按钮语义规则 + 进度专用浅色 token」而不是改引擎 `semanticOverride()` 的通用映射：后者只处理 `background-color` 且会波及无关进度条，专用 token 还能与图表色解耦。陶瓷 danger 改为浅红是为与所有 danger 按钮（删除等）一致（沿用 R27 语义红），避免深红按钮在浅色陶瓷下过重 | 新增 R32、R33；沿用 R27 | `vue-tsc --noEmit` + 完整构建链（vite build ×2 + fix-innerHTML）全绿；待真机三主题 CXPO AIR.IC1 与 FLT 取色验收 |

**新行模板**

```
| YYYY-MM-DD（提交/未提交） | 改了哪些文件、什么行为 | 出现的问题 → 根因 → 为什么选这个修法、否掉了什么方案 | 新增/修改 R__ | 跑了哪些脚本、结果 |
```

---

## 8. 验收清单

**构建链**（每次改完固定流程，见工作区长期记忆）：

```
./node_modules/.bin/vue-tsc --noEmit
./node_modules/.bin/vite build --emptyOutDir=false
./node_modules/.bin/vite build --config vite.content.config.mts
node scripts/fix-innerHTML.mjs
cd ../prun-cdp && node reload-ext.mjs && node refresh-page.mjs
```

`--emptyOutDir=false` 是本环境 safe-delete 保护下的固定写法（Vite 官方开关），避免清空 `dist/virtual` 时被拦截；内容脚本构建配置本身就是 `emptyOutDir: false`。刷新后 SPA 可能自行跳 screen，**不要擅自切回**，如实告知用户。

**离线**：`prun-cdp/verify-ceramic-contrast.mjs`（色板 WCAG 2.1 60+ 组）。

**真机（后台 CDP，不抢前台、不触发真实库存动作）**：

| 脚本 | 覆盖 |
|---|---|
| `verify-ceramic-theme.mjs` | token 模式精确色值、按钮 5 类、表头/斑马纹、Tooltip、分类、图表、焦点环、刷新持久化与首屏无闪帧、**原样主题 `styleLen===0`** |
| `verify-round14-theme-fixes.mjs` | 4 主题：斑马纹、2×2 卡片、ⓘ 非黑底、窗口 `border=0`、TileDivider |
| `verify-round25.mjs` | 三主题 × 8 个 XIT 面板：0 低对比度 / 0 小字 / 0 opacity 压淡 |
| `verify-fin-style.mjs` | 三主题 × 原生 FIN + XIT FIN：表头/线条/数字色一致，**原样主题不受影响** |
| `verify-theme-cat-colors.mjs` | light/paper × compact on/off × 独立 INV：分类头底色未被重映射、≥4.5 |
| `verify-round24.mjs` / `verify-round23.mjs` | BRN 四色、CXOS 无裸硬编码、悬浮三角全消失、XIT 表头 |
| `verify-round26.mjs` | FB 四槽 gap / 槽位底色（含原样）、INV 双轨消除与按需 4px 细条、三主题 × 状态斜纹运行/完成/失败取色、原样主题红线 |
| `govh-verify-e2e.mjs` | GOVH 端到端 **89 项**：政府下拉 / 自动重读 / 自有基地星球下拉与手输兜底 / 焦点回弹守护、POPR+POPI+POPID 取数、7 行本期报告明细 × 五类人口、明细与六类需求双栏且无折线图、无自链接、首开冷读 / 切回命中缓存 / 刷新数据强制重读 / 更新价格提示回收、20 行物料表布局与计算过程、建筑列与覆盖需求列 `rowspan` 合并 / 组间粗线 + 色条 + 合并单元格透明底色 / 所有 td 带 `data-govh-col`、维生角标无浮窗与下方定稿说明、只读统一单价、70%/100%、CBUY / 复制 JSON、前四列顺序与仅从「选」起向右染色、覆盖需求与选列 2px 边界、自有基地星球下拉 11px / 占位无数量、维生预期两档（默认 full）与预测值 / 实际显示双口径、两档成本对照（含差额 0 等价文案）、目标档已移除且顶部仅一排控件 / 动作组靠右、删封顶列后 5 列、说明区同栅格 + 成本整宽、警示文字色无底色、零外部请求、无残留窗口、中途重载 / APEX 断连归因（WARN）；**现场复跑 89/89 全绿**（0 外部请求 / 0 页面异常 / 0 意外重载 / APEX 未断连） |
| `govh-verify-dom.mjs` | GOVH DOM 取数 13 项：五类人口 / 六类满足度 / 14 座建筑等级 / POPID「下一次消耗 + 储备」progress 当前值，不读库存 / 贡献 |
| `verify-govh-theme.mjs` | GOVH 三主题可读性 **20 项**（完整面板 + 自定义模式合并测量，n=273，0 低对比度 / 0 小字 / 0 opacity）+ 原样现场（url / 主题 / 紧凑态 / 窗口集合）恢复 |
| `govh-verify-cache-timing.mjs` | GOVH 加载计时：冷读 / 会话缓存切回 / 强制刷新三段耗时与 info 文案，验证缓存不牺牲可刷新性 |
| `govh-verify-remount.mjs` | GOVH 重新挂载首绘即完整 8 项：`force` 新建实例首帧即 `data-govh-restored=cache` + 20 行物料表、无冷读、无「0→20 行」二次重建、≤1.5s 完整；只关闭本脚本新建窗口 |

**结束必须**：恢复 url / screen / 主题 / 紧凑态 / 窗口集合，断言无残留测试窗口。

---

## 9. 维护约定

1. **改主题前**：读本文件 → 确认改动落在哪一层（§0 表）→ 确认没有触碰 §6 红线。
2. **改主题后**：更新 §4 规则库（若规则有变）→ 追加 §7 台账 → 跑 §8 验收 → 恢复现场。
3. **新增主题**：按 §5 SOP，收尾同样要写台账。
4. **本文件与 `theme-registry.ts` 是唯一事实源**：不要在别处再写一份主题 id 列表、描述文案或 id 联合类型；历史迁移例外（R22）。
5. **不往源码注释里写历史叙事**：上游 `docs/project-rules.md` 要求源码注释只保留当前不变量；「为什么改过、走过哪些弯路」写进本文件的规则库与台账。
6. **本文件不随 PR 提交上游**（本地 fork 规范）；若以后决定贡献给上游，先按 `docs/contributing.md` 精简成纯当前规范。
