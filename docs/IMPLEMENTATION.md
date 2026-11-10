# 实现说明

本文记录「笔记本主题」的实现方式与踩过的坑，供后续维护与适配新版本 Harness 时参考。

## 结构

- **宿主半** `index.js`：纯外观插件，`apply()` 为空，没有任何宿主侧服务、文件读写或网络请求。
- **客户端半** `client.js`：`window.__ModuleLoader__.load({ id, factory })` 形式，`inject: ['slots', 'theme', 'locale']`，`apply(ctx)` 里做四件事——覆盖语义 token、注入一段全局 CSS、注册设置面板、注入头像节点。

## token 覆盖

`ctx.theme.overrideTokens(source, tokens)`，约 45 个语义 token：

- 基础色：`--dsw-alias-bg-base`(纸色)、`--dsw-specific-sidebar-fill`(纸色)、`--dsw-specific-bubble`(白)、`--dsw-specific-input-major`(白)、`--dsw-specific-menu`(白)、`--dsw-alias-label-primary/secondary/tertiary/caption`
- 线条：`--dsw-alias-border-l1..l4`（墨蓝的透明度阶梯）
- 强调：`--dsw-alias-brand-primary`、`--dsw-alias-link`、`--dsw-alias-button-info-fill/-hover`（朱红）
- 其余：滚动条、骨架屏、代码块、悬浮层等约 20 项

要点：

1. 每项都写成 `{ light, dark }` 且两值相同——类型上满足 `ThemeTokenModes`，行为上等于「只有亮色」。插件**不注册暗色主题**、不监听系统配色。
2. 覆盖的是 `document.body` 上的内联 CSS 变量（宿主 presenter 的行为），所以优先级高于任何样式表。
3. **不要**覆盖 `--dsw-alias-state-business-primary`：会话标签、引用、鲸鱼人设等其它插件的蓝色元素共用它，全局改红会误伤。发送按钮单独走 `--dsw-alias-button-info-fill`。

## CSS 视觉层

注入 `<style data-plugin="dsh-theme-notebook-paper" data-plugin-css="dsh-theme-notebook-paper/notebook-paper.css">`，与宿主自己的注入方式一致，卸载时按这两个标记移除。所有页面级规则都收在 `html[data-dsh-notebook]` 之下；开关关闭时移除该属性即整体失效。

### 纸面只画一层

横线噪声只由最外层 frame 绘制一次：

```css
html[data-dsh-notebook] div:has(> [data-shell-overlay]) {
  background-color: var(--np-paper) !important;
  background-image: var(--np-page) !important;   /* repeating-linear-gradient */
  background-attachment: fixed !important;       /* 跨栏对齐、滚动不动 */
}
```

frame 的每个直接子层（`sidebarCol` / `centerCol` / `rightbarCol` / `bottomRow`）一律透明，再往下由 `:has([data-conversation-region])` / `*:has([role="tree"])` 沿祖先链清掉会话容器与侧栏根的自带底色：

```css
html[data-dsh-notebook] div:has(> [data-shell-overlay]) > *:not([data-shell-overlay]):not([data-shell-leading]):not([data-sidebar-mask]):not([class*="_drawerMask"]) {
  background-color: transparent !important;
  background-image: none !important;
}
```

排除 `_drawerMask` 是为了保住新版本「侧栏抽屉」的遮罩：它自带 `background: var(--dsw-alias-bg-mask-1)` 与 `backdrop-filter`，被清成透明后抽屉打开时就没有压暗效果了。

> 只按「`div:has(> [data-slot="main"])` 就是中间列」来清透明是脆的：DSH 后来把中间列改成 `centerCol > .mP3x-q_mainPanel > [data-slot="main"]`，那条选择器于是只命中 `.mainPanel`，真正带不透明底的 `centerCol` 逃掉了 —— 现象就是「整页纸色，但一条横线都没有」。改成「frame 的直接子层全部透明」后与嵌套深浅解耦。

> 早先的做法是「每一层都铺同一张 fixed 纸」，在非整数 DPR 下会因为像素对不齐叠出粗细不匀的横线，已弃用。

### 手绘勾线（SVG 九宫格）

- 72×72 的 SVG：四条边各一笔主描边 + 一笔低透明度副描边，线条抖动、直角处略微过头
- `border-image-slice: 18`、`border-image-width: 10px`、`border-image-repeat: stretch`
- 画在卡片的 `::after{ inset: -8px }` 上，只描边、不占布局
- 长边中段被横向拉伸成缓慢起伏的手画线——这正是「不完美」的来源；静态渲染，无动画

### 波浪线与朱红椭圆

- `--np-wave`：20×7 的正弦 tile（stroke 1.3、振幅约 2.6px）；悬停用 `clip-path: inset(0 100% 0 0)` → `inset(0)` 做 0.3s 从左画出；进行中用 `@keyframes np-wave-slide` 平移 `background-position-x`
- 波浪带放在标题盒的下内边距里（`padding-bottom: 5px`，`::after{ bottom: 0; height: 9px }`），否则会被宿主标题的 `overflow: hidden` 裁掉
- `--np-ellipse`：一张抖动椭圆，`background-size: 100% 100%` 铺满伪元素，天然支持「多行一个大椭圆」，再叠 `rotate(-1.1deg)` 做出手画的歪斜

### 选择器稳定性（踩过的坑）

1. **类名用子串匹配**。宿主用 `clsx(card, cond && cardWorkspaceTrigger)` 拼类名，条件态下 class 属性结尾并不是 `_card`，`[class$="_card"]` 会失效。统一写 `[class*="_card"]` / `[class*="_panelTitle"]`。
2. **面板行不能只用子选择器**。`PanelRow` 把 `button` 包在 `primitives.Tooltip` 里，`nav > button` 永远不成立，要写 `nav button`。
3. **插槽出口是 `display: contents`**。`[data-slot="..."]` 只是包装，不能给它设背景或边框，只能当 `:has()` 锚点。
4. **输入框不是 textarea**。编辑器是 Lexical（`[data-lexical-editor]`），锚点是「类名含 `_card` 且内有 Lexical 编辑器」的卡片。
5. **侧栏大框跨两个兄弟节点**。`nav._panelList` 与 `._regionArea` 没有共同父级，框由脚本量出两者 rect 的并集、注入绝对定位的 `[data-np-frame]`，在 rAF 里跟随布局更新；`z-index: -1` + 侧栏根 `isolation: isolate` 让纸底垫在所有行下面，折叠时隐藏。
6. **「我的」气泡不止 `data-chat-flow-kind="user"`**。中途插话的 steering 行是 `data-chat-flow-kind="steering"`，但它和用户行共用同一个 `UserStyleBubble`（`MessageItem` 的 `.userRow`）；还没落盘的回声行连 kind 都没有，只有 `data-submission-echo` / `data-pending-steering`。所以气泡白卡与手绘框按 `[class*="_userRow"] :is([class*="_bubble"], [data-message-bubble])` 命中（三种都在内），只有「让出头像位」那几条按 kind 写，回声行单独补一条。
7. **气泡本体后来搬进了 primitives**。DSH 改用 `primitives.UserMessageBubble` 渲染气泡，元素上带 `data-message-bubble` 但类名不再保证含 `_bubble`。锚点写成 `:is([class*="_bubble"], [data-message-bubble])` 两头兜住。
8. **`@deepseek-ai/dsh-client-ui-user-questions` 是独立的新包**（问答回顾、交互问答卡、计划评审卡），完全不在 chat/conversation 里。回顾卡的行是 `div[data-question-reply]`（不是 `_userRow`），所以气泡的行锚点扩张成 `:is([class*="_userRow"], [data-question-reply])`；两张交互卡分别是 `div[data-question-key] > section` 与 `div[data-plan-review-key] > section`（直接子节点，无需哈希类名），手绘框用 `inset: 2px` 画在卡内——它们带 `overflow: hidden`，`inset: -8px` 会被裁掉。

## 头像注入

- `MutationObserver`（`childList` + `subtree`）+ `requestAnimationFrame` 合并刷新
- 给 `:is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"])`、`[class*="_userRow"][data-submission-echo]` 与 `[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])` 补 `<span data-np-avatar-node="user|assistant">`（角色判定：kind 为 `user`/`steering` 或带 `data-submission-echo` 即「我的」）
- 头像节点属性名与根节点开关（`data-np-avatar="on"`）刻意区分，清理循环还会跳过 `document.documentElement`——否则会把 `<html>` 整个删掉
- 两张图分别写进根节点 CSS 变量 `--np-avatar-user-image` / `--np-avatar-assistant-image`，未导入时退回默认灰白渐变
- 助手侧用 `margin-inline-start` 而不是 `padding-inline-start`，让头像落在手绘框外面

## 持久化

- 设置：`localStorage` 键 `dsh.notebook-paper.v1`，读写都包在 try/catch 里
- 头像：IndexedDB `dsh-notebook-paper` / store `assets`，记录 `avatar:user`、`avatar:assistant`；旧版本单图记录键 `avatar` 会在首次加载时迁移给「我的头像」

## 实时预览

调节项不重新注入样式表，只改根节点的属性与内联变量：

- `html[data-dsh-notebook]`、`[data-np-noise="on|off"]`、`[data-np-avatar="on|off"]`
- `--np-line-gap`（24/32/40px）、`--np-avatar-size`（24–48px）

CSS 全部读这些变量，所以拖动滑块当帧即生效。

## 降级

- `ctx.theme.overrideTokens` 不存在：`console.warn` 后跳过 token 覆盖，CSS 层照常生效
- `ctx.slots` / `settings.section` 缺失：`console.warn`，设置面板不出现，主题与持久化仍工作
- `ctx.locale` 缺失：退回 `navigator.language`
- `localStorage` / IndexedDB 不可用（隐私模式等）：静默降级，设置只在当前会话生效

## 卸载清理

注入的 `<style>`、`[data-np-avatar-node]`、`[data-np-frame]` 与加在 `html` / 侧栏根上的属性、内联变量全部按标记回收；`overrideTokens` 的返回值（disposer）在清理时调用；侧栏根上的 `position` / `isolation` 由 `releaseFrameRoot()` 还原。
