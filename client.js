/**
 * 笔记本主题 — 客户端半（Desktop 专用）
 * ============================================================
 * 目标：把 dsh Desktop 界面铺成一张横线笔记本纸。
 *
 * 三层叠加：
 *   1. `ctx.theme.overrideTokens()` 覆盖语义 token（纸色底、墨蓝边框、朱红强调…）；
 *   2. 本文件注入一段全局 CSS，负责 token 表达不了的视觉层
 *      （横线纹理、纸纹噪点、朱红竖线、九宫格手绘勾线、批注交互）；
 *   3. 设置面板（settings.section）提供实时生效的可调项。
 *
 * 硬约束：
 *   - 仅 Desktop profile；不做 Web 端适配判断（Desktop 客户端同样走 web carrier）。
 *   - 只用 localStorage（设置）+ IndexedDB Blob（头像），不碰文件系统、不上传、无宿主服务。
 *   - 不注册暗色 token、不响应系统暗色；单亮色模式。
 *   - 所有注入的样式/DOM 都带可清理标记，卸载后完整恢复。
 */
window.__ModuleLoader__.load({
  id: 'dsh-theme-notebook-paper',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /* React 18+ 的 useSyncExternalStore；万一宿主 React 更旧则用 useState + useEffect 兜底 */
    const useStore =
      typeof React.useSyncExternalStore === 'function'
        ? React.useSyncExternalStore
        : (subscribe, getSnapshot) => {
            const [value, setValue] = useState(() => getSnapshot())
            useEffect(() => {
              const read = () => setValue(getSnapshot())
              read()
              return subscribe(read)
            }, [subscribe])
            return value
          }

    /* ────────────────────────────────────────────── 常量 ── */

    const PLUGIN_ID = 'dsh-theme-notebook-paper'
    const STYLE_KEY = PLUGIN_ID + '/notebook-paper.css'
    const TOKEN_SOURCE = PLUGIN_ID
    const SETTINGS_KEY = 'dsh.notebook-paper.v1'

    const IDB_NAME = 'dsh-notebook-paper'
    const IDB_VERSION = 1
    const IDB_STORE = 'assets'
    const IDB_AVATAR = 'avatar'
    const AVATAR_ROLES = ['user', 'assistant']
    const AVATAR_DEFAULT_CSS =
      'radial-gradient(circle at 32% 26%, #fdfdfd 0%, #ececec 52%, #d6d6d6 100%)'

    const LINE_GAPS = [40, 32, 24]
    const AVATAR_MIN = 24
    const AVATAR_MAX = 48
    const AVATAR_DEFAULT = 32

    const DEFAULT_STATE = Object.freeze({
      enabled: true,
      gap: 32,
      noise: true,
      showAvatar: true,
      avatarSize: AVATAR_DEFAULT,
    })

    /** 头像注入锚点：用户行 + 助手回合行（排除推理段）。 */
    const AVATAR_HOST =
      ':is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]), [data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"]), [class*="_userRow"][data-submission-echo]'

    /* ────────────────────────────────────────────── 文案 ── */

    const MESSAGES = {
      zh: {
        'section.label': '笔记本主题',
        'section.title': '笔记本主题',
        'section.desc':
          '把整个界面铺成一张横线笔记本纸：朱红竖线分开侧边栏与工作区，气泡与输入框是白色手绘勾线。所有调节即时生效并自动保存。',
        'master.label': '启用主题',
        'master.hint': '关闭后立即回到 DeepSeek Harness 默认外观，设置仍会保留。',
        'gap.label': '横线线距',
        'gap.hint': '横线为墨蓝色，铺满整页且不随滚动移动。',
        'gap.wide': '宽 40px',
        'gap.medium': '中 32px',
        'gap.narrow': '细 24px',
        'noise.label': '纸张纹理',
        'noise.hint': '极轻微的噪点纸纹，覆盖侧边栏、对话框与输入框内部。',
        'avatar.group': '消息头像',
        'avatar.label': '显示头像',
        'avatar.hint': '在气泡旁显示圆形头像；助手为默认灰白渐变圆。',
        'avatar.size': '头像尺寸',
        'avatar.size.hint': '直径 24–48px，气泡会自动让位。',
        'avatar.upload': '导入图片',
        'avatar.recrop': '重新裁剪',
        'avatar.remove': '移除',
        'avatar.none': '尚未导入头像，当前显示默认灰白渐变圆。',
        'avatar.ready': '已导入（保存在本机 IndexedDB）。',
        'avatar.mine': '我的头像',
        'avatar.mine.hint': '显示在你自己发的气泡右侧。',
        'avatar.theirs': '助手头像',
        'avatar.theirs.hint': '显示在回复卡片的左侧。',
        'crop.title': '裁剪头像',
        'crop.hint': '拖动图片调整位置，滚轮或滑块缩放。',
        'crop.zoom': '缩放',
        'crop.confirm': '使用此图',
        'crop.cancel': '取消',
        'crop.failed': '图片处理失败，请换一张图片试试。',
        'limits.title': '已知限制',
        'limits.body':
          '头像通过消息列表 DOM 注入；若 DeepSeek Harness 后续改动消息列表结构，头像可能不再显示（主题其余部分不受影响）。手绘勾线使用 SVG 九宫格 border-image，不同浏览器内核的拉伸细节可能有极细微差异。',
        'storage': '设置存于 localStorage，头像存于 IndexedDB，全部留在本机。',
      },
      en: {
        'section.label': 'Notebook',
        'section.title': 'Notebook theme',
        'section.desc':
          'Lays the whole shell over a ruled notebook page: a vermilion margin line splits the sidebar from the workspace, and bubbles plus the composer get hand-drawn outlines. Every control applies live and is saved automatically.',
        'master.label': 'Enable theme',
        'master.hint': 'Turning this off restores the default DeepSeek Harness look; your settings are kept.',
        'gap.label': 'Rule spacing',
        'gap.hint': 'Ink-blue rules drawn across the page; they stay put while content scrolls.',
        'gap.wide': 'Wide 40px',
        'gap.medium': 'Medium 32px',
        'gap.narrow': 'Narrow 24px',
        'noise.label': 'Paper grain',
        'noise.hint': 'Very faint noise texture across the sidebar, bubbles and composer.',
        'avatar.group': 'Message avatars',
        'avatar.label': 'Show avatars',
        'avatar.hint': 'A round avatar beside each bubble; the assistant falls back to a grey-white gradient.',
        'avatar.size': 'Avatar size',
        'avatar.size.hint': '24–48px across; the bubble makes room automatically.',
        'avatar.upload': 'Import image',
        'avatar.recrop': 'Re-crop',
        'avatar.remove': 'Remove',
        'avatar.none': 'No avatar imported yet; the default grey-white gradient is shown.',
        'avatar.ready': 'Imported and stored in this browser (IndexedDB).',
        'avatar.mine': 'My avatar',
        'avatar.mine.hint': 'Shown to the right of your own bubbles.',
        'avatar.theirs': 'Assistant avatar',
        'avatar.theirs.hint': 'Shown to the left of reply cards.',
        'crop.title': 'Crop avatar',
        'crop.hint': 'Drag to reposition, use the slider to zoom.',
        'crop.zoom': 'Zoom',
        'crop.confirm': 'Use image',
        'crop.cancel': 'Cancel',
        'crop.failed': 'Could not process that image. Try another one.',
        'limits.title': 'Known limitations',
        'limits.body':
          'Avatars are injected through the message list DOM; if DeepSeek Harness changes that structure the avatars may stop appearing (the rest of the theme is unaffected). Hand-drawn outlines use an SVG nine-slice border-image, so minute stretching differences between engines are possible.',
        'storage': 'Settings live in localStorage, the avatar in IndexedDB — all on this machine.',
      },
    }

    /* ─────────────────────────────────────── 主题 token 表 ── */

    /**
     * 单亮色主题：light / dark 填同值。
     * `ctx.theme.overrideTokens` 的类型要求两个槽位都是 string，但插件不注册暗色主题、
     * 也不响应系统暗色切换，所以 dark 槽位永远不会被真正用上。
     */
    const TOKEN_SPEC = {
      // 背景基色 / 纸色
      '--dsw-alias-bg-base': '#faf9f6',
      '--dsw-alias-bg-layer-1': '#ffffff',
      '--dsw-alias-bg-layer-2': '#ffffff',
      '--dsw-alias-bg-layer-3': '#ffffff',
      '--dsw-alias-bg-overlay': '#ffffff',
      '--dsw-alias-bg-module-platform': '#ffffff',
      // 侧边栏填充（与工作区同纸色，靠朱红竖线分隔）
      '--dsw-specific-sidebar-fill': '#faf9f6',
      '--dsw-specific-sidebar-nav-item-hover': 'rgba(26, 42, 74, 0.055)',
      '--dsw-specific-sidebar-nav-item-active': 'rgba(26, 42, 74, 0.09)',
      '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(192, 57, 43, 0.30)',
      // 输入框 / 对话框底色
      '--dsw-specific-bubble': '#ffffff',
      '--dsw-specific-bubble-highlight': 'rgba(192, 57, 43, 0.07)',
      '--dsw-specific-input-major': '#ffffff',
      '--dsw-specific-login-input': '#ffffff',
      '--dsw-specific-selector': '#ffffff',
      '--dsw-specific-menu': '#ffffff',
      '--dsw-specific-tip': 'rgba(26, 42, 74, 0.05)',
      '--dsw-alias-markdown-code-block': '#ffffff',
      '--dsw-alias-markdown-code-block-banner': '#faf9f6',
      '--dsw-alias-markdown-inline-code': 'rgba(26, 42, 74, 0.06)',
      // 文字
      '--dsw-alias-label-primary': '#1a1a1a',
      '--dsw-alias-label-primary-dimmed': '#1a1a1a',
      '--dsw-alias-label-secondary': '#6b6b6b',
      '--dsw-alias-label-tertiary': '#6b6b6b',
      '--dsw-alias-label-caption': '#8a8a8a',
      // 边框（墨蓝）
      '--dsw-alias-border-l1': 'rgba(26, 42, 74, 0.75)',
      '--dsw-alias-border-l2': 'rgba(26, 42, 74, 0.45)',
      '--dsw-alias-border-l3': 'rgba(26, 42, 74, 0.26)',
      '--dsw-alias-border-l4': 'rgba(26, 42, 74, 0.16)',
      // 主色 / 强调（朱红）
      '--dsw-alias-brand-primary': '#c0392b',
      '--dsw-alias-brand-primary-new-color': '#c0392b',
      '--dsw-alias-link': '#c0392b',
      '--dsw-alias-button-info-fill': '#c0392b',
      '--dsw-alias-button-info-hover': '#a53224',
      '--dsw-alias-button-primary-fill': '#c0392b',
      '--dsw-alias-button-primary-hover': '#a53224',
      // 交互态
      '--dsw-alias-interactive-bg-hover': 'rgba(26, 42, 74, 0.05)',
      '--dsw-alias-interactive-bg-hover-solid': 'rgba(26, 42, 74, 0.07)',
      '--dsw-alias-interactive-bg-active': 'rgba(26, 42, 74, 0.10)',
      '--dsw-alias-bg-skeleton': 'rgba(26, 42, 74, 0.06)',
      // 滚动条 / 浮层
      '--dsw-alias-scrollbar-bg-l1': 'rgba(26, 42, 74, 0.16)',
      '--dsw-alias-scrollbar-bg-l2': 'rgba(26, 42, 74, 0.16)',
      '--dsw-alias-scrollbar-hover-l1': 'rgba(26, 42, 74, 0.32)',
      '--dsw-alias-scrollbar-hover-l2': 'rgba(26, 42, 74, 0.32)',
      '--dsw-alias-tooltip-bg': '#1a2a4a',
      '--dsw-alias-tooltip-key-bg': 'rgba(255, 255, 255, 0.16)',
      '--dsw-alias-turn-trigger-bg': '#ffffff',
      '--dsw-alias-turn-trigger-bg-hover': 'rgba(26, 42, 74, 0.05)',
      '--dsw-menu-surface-fill': '#ffffff',
      '--dsw-alias-menu-group-header-fill': '#faf9f6',
    }

    const THEME_TOKENS = Object.entries(TOKEN_SPEC).map(([name, value]) => [name, { light: value, dark: value }])

    /* ───────────────────────────────────────── 持久化 ── */

    function clampNumber(value, min, max, fallback) {
      const num = Number(value)
      if (!Number.isFinite(num)) return fallback
      return Math.min(max, Math.max(min, num))
    }

    function sanitizeState(raw) {
      const state = { ...DEFAULT_STATE }
      if (!raw || typeof raw !== 'object') return state
      if (typeof raw.enabled === 'boolean') state.enabled = raw.enabled
      if (typeof raw.noise === 'boolean') state.noise = raw.noise
      if (typeof raw.showAvatar === 'boolean') state.showAvatar = raw.showAvatar
      const gap = Math.round(Number(raw.gap))
      if (LINE_GAPS.includes(gap)) state.gap = gap
      state.avatarSize = clampNumber(raw.avatarSize, AVATAR_MIN, AVATAR_MAX, AVATAR_DEFAULT)
      return state
    }

    function readSettings() {
      try {
        return sanitizeState(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || 'null'))
      } catch (error) {
        console.warn('[notebook-paper] 读取 localStorage 设置失败，使用默认值：', error)
        return { ...DEFAULT_STATE }
      }
    }

    function writeSettings(state) {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state))
      } catch (error) {
        console.warn('[notebook-paper] 写入 localStorage 失败（设置不会持久化）：', error)
      }
    }

    function createSettingsStore() {
      let state = readSettings()
      const listeners = new Set()
      return {
        get() {
          return state
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        patch(next) {
          state = sanitizeState({ ...state, ...next })
          writeSettings(state)
          for (const listener of Array.from(listeners)) listener(state)
        },
      }
    }

    /* ─────────────────────────────────── IndexedDB（头像） ── */

    function openDatabase() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('indexedDB unavailable'))
          return
        }
        const request = indexedDB.open(IDB_NAME, IDB_VERSION)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error || new Error('indexedDB open failed'))
      })
    }

    async function withStore(mode, run) {
      const db = await openDatabase()
      try {
        return await new Promise((resolve, reject) => {
          const transaction = db.transaction(IDB_STORE, mode)
          const store = transaction.objectStore(IDB_STORE)
          let result
          const request = run(store)
          if (request) {
            request.onsuccess = () => {
              result = request.result
            }
            request.onerror = () => reject(request.error || new Error('indexedDB request failed'))
          }
          transaction.oncomplete = () => resolve(result)
          transaction.onerror = () => reject(transaction.error || new Error('indexedDB transaction failed'))
          transaction.onabort = () => reject(transaction.error || new Error('indexedDB transaction aborted'))
        })
      } finally {
        db.close()
      }
    }

    function idbRead(key) {
      return withStore('readonly', (store) => store.get(key))
    }
    function idbWrite(key, value) {
      return withStore('readwrite', (store) => store.put(value, key))
    }
    function idbRemove(key) {
      return withStore('readwrite', (store) => store.delete(key))
    }

    function createAvatarStore() {
      const urls = { user: '', assistant: '' }
      let listeners = new Set()
      let version = 0

      const notify = () => {
        version += 1
        for (const listener of Array.from(listeners)) listener()
      }
      const release = (role) => {
        const url = urls[role]
        if (!url) return
        try {
          URL.revokeObjectURL(url)
        } catch (error) {
          /* 忽略：URL 已失效 */
        }
        urls[role] = ''
      }
      const adopt = (role, blob) => {
        release(role)
        urls[role] = URL.createObjectURL(blob)
      }

      return {
        getUrl(role) {
          return urls[role] || ''
        },
        getVersion() {
          return version
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        async hydrate() {
          for (const role of AVATAR_ROLES) {
            try {
              const record = await idbRead(IDB_AVATAR + ':' + role)
              if (record && record.blob) adopt(role, record.blob)
            } catch (error) {
              console.warn('[notebook-paper] 读取 IndexedDB 头像失败，使用默认头像：', error)
            }
          }
          // 旧版本只存一张图（key 为 "avatar"），迁移给「我的头像」一侧
          if (!urls.user) {
            try {
              const legacy = await idbRead(IDB_AVATAR)
              if (legacy && legacy.blob) adopt('user', legacy.blob)
            } catch (error) {
              /* 忽略：没有旧记录 */
            }
          }
          notify()
        },
        async save(role, blob) {
          await idbWrite(IDB_AVATAR + ':' + role, {
            blob,
            mime: blob.type || 'image/jpeg',
            updatedAt: Date.now(),
          })
          adopt(role, blob)
          notify()
          return urls[role]
        },
        async clear(role) {
          release(role)
          try {
            await idbRemove(IDB_AVATAR + ':' + role)
          } catch (error) {
            console.warn('[notebook-paper] 清除 IndexedDB 头像失败：', error)
          }
          notify()
        },
        dispose() {
          for (const role of AVATAR_ROLES) release(role)
          listeners = new Set()
        },
      }
    }

    /* ────────────────────────────────────────── 本地化 ── */

    function createI18n(ctx) {
      const service = ctx && ctx.locale ? ctx.locale : null

      const snapshot = () => {
        try {
          const value = service && typeof service.getSnapshot === 'function' ? service.getSnapshot() : null
          return value && typeof value === 'object' ? value : null
        } catch (error) {
          return null
        }
      }

      const active = () => {
        const snap = snapshot()
        const value = snap && typeof snap.active === 'string' ? snap.active : ''
        return value
      }

      const language = () => {
        const current = active()
        if (current) return current.toLowerCase().startsWith('zh') ? 'zh' : 'en'
        const nav = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en'
        return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      }

      return {
        t(key) {
          const lang = language()
          const table = MESSAGES[lang] || MESSAGES.en
          return table[key] || MESSAGES.en[key] || key
        },
        getVersion() {
          const snap = snapshot()
          return snap && typeof snap.revision === 'number' ? snap.revision + ':' + String(snap.active || '') : 'default'
        },
        subscribe(listener) {
          if (service && typeof service.subscribe === 'function') {
            try {
              return service.subscribe(listener)
            } catch (error) {
              return () => {}
            }
          }
          return () => {}
        },
      }
    }

    /* ────────────────────────────────────────────── 样式 ── */

    const CSS = [
      /* ── 变量：纸色 / 墨蓝 / 朱红 / 纹理 ── */
      ':root {',
      '  --np-paper: #faf9f6;',
      '  --np-card: #ffffff;',
      '  --np-ink: #1a2a4a;',
      '  --np-vermilion: #c0392b;',
      '  --np-text: #1a1a1a;',
      '  --np-muted: #6b6b6b;',
      '  --np-line-gap: 32px;',
      '  --np-avatar-size: 32px;',
      '  --np-gutter: calc(var(--np-avatar-size) + 16px);',
      '  --np-grain: none;',
      '  --np-lines: repeating-linear-gradient(to bottom,',
      '    transparent 0, transparent calc(var(--np-line-gap) - 1px),',
      '    var(--np-ink) calc(var(--np-line-gap) - 1px), var(--np-ink) var(--np-line-gap));',
      '  --np-page: var(--np-lines);',
      /* 半粗手绘分界线：略起伏的横线，粗细约为勾线边框的一半 */
      '  --np-rule: url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2740%27 height=%276%27 viewBox=%270 0 40 6%27 fill=%27none%27 stroke=%27%231a2a4a%27 stroke-width=%271.15%27 stroke-linecap=%27round%27%3E%3Cpath d=%27M0 3.2C5 2.6 9 3.6 14 3.1 19 2.6 23 3.7 28 3.2 33 2.7 37 3.5 40 3.1%27/%3E%3C/svg%3E");',
      '  --np-noise: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'150\' height=\'150\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'2\' stitchTiles=\'stitch\'/%3E%3CfeColorMatrix type=\'saturate\' values=\'0\'/%3E%3C/filter%3E%3Crect width=\'150\' height=\'150\' filter=\'url(%23n)\' opacity=\'0.055\'/%3E%3C/svg%3E");',
      '  /* 手绘勾线：72×72 抖动四边 + 第二道浅描边，九宫格 slice=18 → 10px 边框带宽（缩放 0.556） */',
      '  --np-sketch: url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2772%27 height=%2772%27 viewBox=%270 0 72 72%27 fill=%27none%27 stroke=%27%231a1a1a%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27>%3Cpath d=%27M5.8 12.2C13 7.4 21 13.4 29 8.6 37 4.4 45 12.6 53 8.2 59 4.8 64.2 10.6 66.4 7%27 stroke-width=%272.7%27/%3E%3Cpath d=%27M65.2 6.6C69.4 14 63.4 23 67.2 31 70.6 39 64 47 67.6 55 70 60 65.4 64.4 68.2 66.8%27 stroke-width=%272.7%27/%3E%3Cpath d=%27M66.6 66C58 70.2 50 64.4 42 68.8 34 73 26 64.2 18 68.4 12 71.4 7.8 65.8 5.6 68.6%27 stroke-width=%272.7%27/%3E%3Cpath d=%27M6.4 66.4C2.4 57.8 8.2 49.8 4.4 41.8 1.2 33.8 7.4 25.8 4 17.8 1.8 12.4 6.2 8.2 4.2 5.4%27 stroke-width=%272.7%27/%3E%3Cpath d=%27M6.4 9.8C14 5.6 22 11.2 30 7 38 3 46 11 54 6.8 60 3.8 64.8 8.8 66 7.8%27 stroke-width=%271.15%27 stroke-opacity=%27.4%27/%3E%3Cpath d=%27M66 8.4C69.8 15.6 64.2 24.4 67.8 32.4 71.2 40.4 64.8 48.4 68.2 56.4 70.4 61 66 64.8 66.6 65.4%27 stroke-width=%271.15%27 stroke-opacity=%27.4%27/%3E%3Cpath d=%27M66.2 64.4C57.6 68.6 49.6 62.8 41.6 67.2 33.6 71.4 25.6 62.6 17.6 66.8 11.6 69.8 7.4 64.2 5.2 66.6%27 stroke-width=%271.15%27 stroke-opacity=%27.4%27/%3E%3Cpath d=%27M7.2 65.2C3.2 56.6 9 48.6 5.2 40.6 2 32.6 8.2 24.6 4.8 16.6 2.6 11.2 7 7 5 5.2%27 stroke-width=%271.15%27 stroke-opacity=%27.4%27/%3E%3C/svg%3E");',
      '  /* 波浪线：一个周期的平铺单元（14×6），用于 hover 画出与进行中波动 */',
      '  --np-wave: url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2720%27 height=%277%27 viewBox=%270 0 20 7%27 fill=%27none%27 stroke=%27%231a1a1a%27 stroke-width=%271.3%27 stroke-linecap=%27round%27>%3Cpath d=%27M0 5.6C2 5.6 3 3 5 3 7 3 8 5.6 10 5.6 12 5.6 13 3 15 3 17 3 18 5.6 20 5.6%27/%3E%3C/svg%3E");',
      '  /* 选中圈：手绘朱红椭圆（拉伸到元素盒），多行时包住整段 */',
      '  --np-ellipse: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'80\' viewBox=\'0 0 200 80\' preserveAspectRatio=\'none\' fill=\'none\'%3E%3Cpath d=\'M16 40C14 20 56 7 104 6.4 152 5.8 189 18 190 39.4 191 61 148 74 97 73.4 46 72.8 18 61 16 40Z\' stroke=\'%23c0392b\' stroke-width=\'2.2\' stroke-linecap=\'round\' fill=\'rgba(192,57,43,0.045)\'/%3E%3Cpath d=\'M14 42C12 24 58 9 106 8.2 154 7.4 187 22 188 42 189 63 146 76 95 75.2 44 74.4 16 63 14 42Z\' stroke=\'%23c0392b\' stroke-width=\'1.2\' stroke-opacity=\'0.5\'/%3E%3C/svg%3E");',
      '}',
      'html[data-dsh-notebook][data-np-noise="on"] { --np-grain: var(--np-noise); }',
      'html[data-dsh-notebook][data-np-noise="on"] { --np-page: var(--np-noise), var(--np-lines); }',

      /* ── 整页纸面：只由 frame 一层画（多层叠加会让横线粗细不匀） ── */
      'html[data-dsh-notebook] div:has(> [data-shell-overlay]) {',
      '  background-color: var(--np-paper) !important;',
      '  background-image: var(--np-page) !important;',
      '  background-repeat: repeat !important;',
      '  background-attachment: fixed !important;',
      '}',
      /* frame 的每个直接子层（侧栏列 / 中间列 / 右栏 / 底栏）一律透明，
         横线只从 frame 那一层透上来；不依赖槽位嵌套深浅。 */
      'html[data-dsh-notebook] div:has(> [data-shell-overlay]) > *:not([data-shell-overlay]):not([data-shell-leading]):not([data-sidebar-mask]):not([class*="_drawerMask"]) {',
      '  background-color: transparent !important;',
      '  background-image: none !important;',
      '}',
      /* 其余各层一律透明：横线只从 frame 透上来 */
      'html[data-dsh-notebook] div:has(> [data-slot="sidebar"]),',
      'html[data-dsh-notebook] div:has(> [data-slot="main"]),',
      'html[data-dsh-notebook] [class*="_mainPanel"],',
      'html[data-dsh-notebook] [data-rightbar-col],',
      'html[data-dsh-notebook] [data-shell-bottom],',
      'html[data-dsh-notebook] [data-slot="main"] > *,',
      'html[data-dsh-notebook] [data-slot="main"] *:has([data-conversation-region]),',
      'html[data-dsh-notebook] [data-conversation-region],',
      'html[data-dsh-notebook] [data-conversation-scroll],',
      'html[data-dsh-notebook] [data-slot="sidebar"] > *,',
      'html[data-dsh-notebook] [data-slot="sidebar"] *:has([role="tree"]) {',
      '  background-color: transparent !important;',
      '  background-image: none !important;',
      '}',

      /* ── 顶栏：不铺横线，下边界一条加粗墨蓝横线 ── */
      'html[data-dsh-notebook][data-windows-titlebar] div:has(> [data-shell-overlay])::before {',
      '  background-color: var(--np-paper) !important;',
      '  background-image: var(--np-grain) !important;',
      '  border-bottom: 2px solid var(--np-ink);',
      '  box-sizing: border-box;',
      '}',

      /* ── 朱红竖线：侧边栏右缘，随折叠走 ── */
      'html[data-dsh-notebook] div:has(> [data-slot="sidebar"]) {',
      '  border-right: 2px solid var(--np-vermilion) !important;',
      '}',
      'html[data-dsh-notebook] div[data-sidebar-collapsed]:has(> [data-shell-overlay]) {',
      '  border-right: 0 !important;',
      '}',
      'html[data-dsh-notebook] div[data-sidebar-collapsed]:has(> [data-shell-overlay]) [data-slot="sidebar"] {',
      '  border-right: 2px solid var(--np-vermilion);',
      '}',

      /* ── 侧边栏会话行：不再逐行描框，整块由工作区大框兜住（框内纯纸底） ── */
      'html[data-dsh-notebook] [role="treeitem"][data-row-key] {',
      '  position: relative;',
      '  border: 0;',
      '  border-radius: 3px;',
      '  background-color: var(--np-paper);',
      '}',

      /* ── 批注交互：标题文字 hover 上移 + 波浪线 0.3s 画出 ── */
      'html[data-dsh-notebook] [role="treeitem"] [class$="_title"] {',
      '  position: relative;',
      '  display: inline-block;',
      '  max-width: 100%;',
      '  padding-bottom: 5px;',
      '  transition: transform 0.18s ease-out;',
      '}',
      'html[data-dsh-notebook] [role="treeitem"] [class$="_title"]::after {',
      '  content: "";',
      '  position: absolute;',
      '  left: 0;',
      '  right: 0;',
      '  bottom: 0;',
      '  height: 9px;',
      '  background-image: var(--np-wave);',
      '  background-repeat: repeat-x;',
      '  background-size: 20px 7px;',
      '  background-position: 0 0;',
      '  clip-path: inset(0 100% 0 0);',
      '  transition: clip-path 0.3s ease-out;',
      '  pointer-events: none;',
      '}',
      'html[data-dsh-notebook] [role="treeitem"]:hover [class$="_title"] { transform: translateY(-1px); }',
      'html[data-dsh-notebook] [role="treeitem"]:hover [class$="_title"]::after { clip-path: inset(0 0 0 0); }',
      /* 进行中：波浪线持续波动 */
      'html[data-dsh-notebook] [role="treeitem"]:has([data-state="ongoing"]) [class$="_title"]::after {',
      '  clip-path: none;',
      '  animation: np-wave-slide 0.9s linear infinite;',
      '}',
      /* 进行中 + 悬停：波浪线下方再加一条下划线 */
      'html[data-dsh-notebook] [role="treeitem"]:has([data-state="ongoing"]) [class$="_title"]:hover::after {',
      '  box-shadow: inset 0 -1px 0 var(--np-text);',
      '}',
      /* 完成：文字前打勾 */
      'html[data-dsh-notebook] [role="treeitem"]:has([data-state="done"]) [class$="_title"]::before {',
      '  content: "✓";',
      '  color: var(--np-vermilion);',
      '  font-weight: 700;',
      '  margin-inline-end: 3px;',
      '}',
      /* 选中：略倾斜的朱红手绘椭圆包住整段（多行 → 一个大椭圆） */
      'html[data-dsh-notebook] [role="treeitem"][data-row-key][aria-selected="true"]::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: -5px -6px;',
      '  z-index: 1;',
      '  background-image: var(--np-ellipse);',
      '  background-size: 100% 100%;',
      '  background-repeat: no-repeat;',
      '  transform: rotate(-1.1deg);',
      '  pointer-events: none;',
      '}',

      /* ── 工作区：整块纯纸底（不显横线）＋「工作区」标题上方一条半粗手绘分界线 ── */
      'html[data-dsh-notebook] [class$="_regionArea"] {',
      '  position: relative;',
      '  padding-top: 13px !important;',
      '  background-color: var(--np-paper) !important;',
      '  background-image: var(--np-grain) !important;',
      '  background-repeat: repeat !important;',
      '}',
      'html[data-dsh-notebook] [class$="_regionArea"]::before {',
      '  content: "";',
      '  position: absolute;',
      '  top: 4px;',
      '  left: 12px;',
      '  right: 12px;',
      '  height: 6px;',
      '  background-image: var(--np-rule);',
      '  background-repeat: repeat-x;',
      '  background-position: 0 50%;',
      '  pointer-events: none;',
      '}',

      /* ── 侧栏面板五项：行内批注交互（大框由 JS 注入的整块框承担） ── */
      /* 侧栏整块大框：JS 量出「插件组 + 工作区」并集后注入，这里只给样式 */
      'html[data-dsh-notebook] [data-np-frame] {',
      '  position: absolute;',
      '  z-index: -1;',
      '  background-color: var(--np-paper);',
      '  border: 10px solid transparent;',
      '  border-image-source: var(--np-sketch);',
      '  border-image-slice: 18;',
      '  border-image-width: 10px;',
      '  border-image-repeat: stretch;',
      '  pointer-events: none;',
      '}',
      'html[data-dsh-notebook] div[data-sidebar-collapsed="true"] [data-np-frame],',
      'html[data-dsh-notebook] [data-np-frame][hidden] { display: none !important; }',
      'html[data-dsh-notebook] nav[class$="_panelList"] {',
      '  position: relative;',
      '  margin-block: 4px;',
      '  padding: 10px 9px;',
      '  border-radius: 3px;',
      '  background-color: var(--np-paper) !important;',
      '  background-image: var(--np-grain) !important;',
      '  background-repeat: repeat !important;',
      '}',
      'html[data-dsh-notebook] nav[class$="_panelList"] button {',
      '  position: relative;',
      '  border-radius: 3px;',
      '  background-color: var(--np-paper) !important;',
      '  transition: background-color 0.15s ease-out, transform 0.18s ease-out;',
      '}',
      'html[data-dsh-notebook] nav[class$="_panelList"] button:hover {',
      '  background-color: #f2efe8 !important;',
      '}',
      'html[data-dsh-notebook] nav[class$="_panelList"] button[aria-current="page"]:hover {',
      '  background-color: transparent !important;',
      '}',
      'html[data-dsh-notebook] nav[class$="_panelList"] button[aria-current="page"] { background-color: transparent !important; }',
      'html[data-dsh-notebook] nav[class$="_panelList"] button[aria-current="page"]::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: -4px -5px;',
      '  z-index: 1;',
      '  background-image: var(--np-ellipse);',
      '  background-size: 100% 100%;',
      '  background-repeat: no-repeat;',
      '  transform: rotate(-1.1deg);',
      '  pointer-events: none;',
      '}',
      'html[data-dsh-notebook] nav[class$="_panelList"] button [class*="_panelTitle"] {',
      '  position: relative;',
      '  display: inline-block;',
      '  padding-bottom: 4px;',
      '  transition: transform 0.18s ease-out;',
      '}',
      'html[data-dsh-notebook] nav[class$="_panelList"] button [class*="_panelTitle"]::after {',
      '  content: "";',
      '  position: absolute;',
      '  left: 0;',
      '  right: 0;',
      '  bottom: 0;',
      '  height: 7px;',
      '  background-image: var(--np-wave);',
      '  background-repeat: repeat-x;',
      '  background-size: 20px 7px;',
      '  clip-path: inset(0 100% 0 0);',
      '  transition: clip-path 0.3s ease-out;',
      '  pointer-events: none;',
      '}',
      'html[data-dsh-notebook] nav[class$="_panelList"] button:hover [class*="_panelTitle"] { transform: translateY(-1px); }',
      'html[data-dsh-notebook] nav[class$="_panelList"] button:hover [class*="_panelTitle"]::after { clip-path: inset(0 0 0 0); }',

      /* ── 会话头部（标题行 + 标签行）：整块一个大框，框内纯纸底 ── */
      'html[data-dsh-notebook] [data-slot="main"] [class$="_header"]:has([class$="_tab"]) {',
      '  position: relative;',
      '  padding-top: 16px !important;',
      '  padding-bottom: 16px !important;',
      '  border-bottom: 0 !important;',
      '  background-color: var(--np-paper) !important;',
      '  background-image: var(--np-grain) !important;',
      '  background-repeat: repeat !important;',
      '}',
      'html[data-dsh-notebook] [data-slot="main"] [class$="_header"]:has([class$="_tab"])::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 4px 10px;',
      '  border: 10px solid transparent;',
      '  border-image-source: var(--np-sketch);',
      '  border-image-slice: 18;',
      '  border-image-width: 10px;',
      '  border-image-repeat: stretch;',
      '  pointer-events: none;',
      '}',

      /* ── 消息气泡：白底 + 手绘勾线 ── */
      'html[data-dsh-notebook] :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]),',
      'html[data-dsh-notebook] [data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"]) {',
      '  position: relative;',
      '  box-sizing: border-box;',
      '}',
      'html[data-dsh-notebook][data-np-avatar="on"] :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]) { padding-inline-end: var(--np-gutter); }',
      'html[data-dsh-notebook][data-np-avatar="on"] [data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"]) {',
      '  margin-inline-start: calc(var(--np-avatar-size) + 16px);',
      '}',
      /* 待发送回声（steering/user 提交的本地回声）：行自身让出右侧头像位 */
      'html[data-dsh-notebook][data-np-avatar="on"] [class*="_userRow"][data-submission-echo] {',
      '  position: relative;',
      '  padding-inline-end: var(--np-gutter);',
      '}',
      /* 用户气泡 */
      'html[data-dsh-notebook] :is([class*="_userRow"], [data-question-reply]) :is([class*="_bubble"], [data-message-bubble]) {',
      '  position: relative;',
      '  background-color: var(--np-card) !important;',
      '  background-image: var(--np-grain) !important;',
      '  border-radius: 3px !important;',
      '  color: var(--np-text);',
      '  box-shadow: none !important;',
      '}',
      'html[data-dsh-notebook] :is([class*="_userRow"], [data-question-reply]) :is([class*="_bubble"], [data-message-bubble])::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: -8px;',
      '  border: 10px solid transparent;',
      '  border-image-source: var(--np-sketch);',
      '  border-image-slice: 18;',
      '  border-image-width: 10px;',
      '  border-image-repeat: stretch;',
      '  pointer-events: none;',
      '}',
      /* 用户气泡 hover：文字略上移 + 波浪线画出 */
      'html[data-dsh-notebook] :is([class*="_userRow"], [data-question-reply]) :is([class*="_bubble"], [data-message-bubble]) {',
      '  transition: transform 0.18s ease-out;',
      '}',
      'html[data-dsh-notebook] :is([class*="_userRow"], [data-question-reply]):hover :is([class*="_bubble"], [data-message-bubble]) { transform: translateY(-1px); }',
      'html[data-dsh-notebook] :is([class*="_userRow"], [data-question-reply]) :is([class*="_bubble"], [data-message-bubble])::before {',
      '  content: "";',
      '  position: absolute;',
      '  left: 16px;',
      '  right: 16px;',
      '  bottom: 2px;',
      '  height: 7px;',
      '  background-image: var(--np-wave);',
      '  background-repeat: repeat-x;',
      '  background-size: 20px 7px;',
      '  clip-path: inset(0 100% 0 0);',
      '  transition: clip-path 0.3s ease-out;',
      '  pointer-events: none;',
      '}',
      'html[data-dsh-notebook] :is([class*="_userRow"], [data-question-reply]):hover :is([class*="_bubble"], [data-message-bubble])::before { clip-path: inset(0 0 0 0); }',
      /* 问答卡 / 计划评审卡（dsh-client-ui-user-questions）：白卡 + 手绘勾线 */
      'html[data-dsh-notebook] :is([data-question-key], [data-plan-review-key]) > section {',
      '  position: relative;',
      '  background-color: var(--np-card) !important;',
      '  background-image: var(--np-grain) !important;',
      '  border-radius: 3px !important;',
      '  box-shadow: none !important;',
      '  color: var(--np-text);',
      '}',
      'html[data-dsh-notebook] :is([data-question-key], [data-plan-review-key]) > section::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 2px;',
      '  border: 10px solid transparent;',
      '  border-image-source: var(--np-sketch);',
      '  border-image-slice: 18;',
      '  border-image-width: 10px;',
      '  border-image-repeat: stretch;',
      '  pointer-events: none;',
      '}',
      'html[data-dsh-notebook] :is([data-question-key], [data-plan-review-key]) > section > * { position: relative; }',
      /* 动作卡（dsh-client-ui-action-cards）：白卡 + 手绘勾线 */
      'html[data-dsh-notebook] [data-action-card] {',
      '  position: relative;',
      '  background-color: var(--np-card) !important;',
      '  background-image: var(--np-grain) !important;',
      '  border-color: transparent !important;',
      '  border-radius: 3px !important;',
      '  color: var(--np-text);',
      '}',
      'html[data-dsh-notebook] [data-action-card]::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 2px;',
      '  border: 10px solid transparent;',
      '  border-image-source: var(--np-sketch);',
      '  border-image-slice: 18;',
      '  border-image-width: 10px;',
      '  border-image-repeat: stretch;',
      '  pointer-events: none;',
      '}',
      'html[data-dsh-notebook] [data-action-card] > * { position: relative; }',
      /* 助手回合：白色卡片 + 手绘勾线 */
      'html[data-dsh-notebook] [data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"]) {',
      '  background-color: var(--np-card) !important;',
      '  background-image: var(--np-grain) !important;',
      '  background-repeat: repeat;',
      '  border-radius: 3px;',
      '  padding-block: 10px;',
      '  padding-inline: 14px;',
      '}',
      'html[data-dsh-notebook] [data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: -8px;',
      '  border: 10px solid transparent;',
      '  border-image-source: var(--np-sketch);',
      '  border-image-slice: 18;',
      '  border-image-width: 10px;',
      '  border-image-repeat: stretch;',
      '  pointer-events: none;',
      '}',
      /* 进行中（streaming）：卡片底边一条持续波动的波浪线 */
      'html[data-dsh-notebook] [data-chat-flow-kind="assistant-step"]:has([data-streaming]):not([data-chat-group-part="reasoning"])::before {',
      '  content: "";',
      '  position: absolute;',
      '  left: 12px;',
      '  right: 12px;',
      '  bottom: 1px;',
      '  height: 7px;',
      '  background-image: var(--np-wave);',
      '  background-repeat: repeat-x;',
      '  background-size: 20px 7px;',
      '  animation: np-wave-slide 0.9s linear infinite;',
      '  pointer-events: none;',
      '}',
      /* 完成：文字前打勾（无流式标记即视为完成） */
      'html[data-dsh-notebook] [data-chat-flow-kind="assistant-step"]:not(:has([data-streaming])):not([data-chat-group-part="reasoning"])::before {',
      '  content: "✓";',
      '  position: absolute;',
      '  left: -12px;',
      '  top: -12px;',
      '  z-index: 1;',
      '  color: var(--np-vermilion);',
      '  font-size: 16px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '  transform: rotate(-9deg);',
      '  pointer-events: none;',
      '}',

      /* ── 头像 ── */
      'html[data-dsh-notebook] [data-np-avatar-node] {',
      '  position: absolute;',
      '  top: -5px;',
      '  z-index: 2;',
      '  width: var(--np-avatar-size);',
      '  height: var(--np-avatar-size);',
      '  border-radius: 50%;',
      '  background-color: #f2f2f2;',
      '  background-image: var(--np-avatar-user-image, radial-gradient(circle at 32% 26%, #fdfdfd 0%, #ececec 52%, #d6d6d6 100%));',
      '  background-position: center;',
      '  background-repeat: no-repeat;',
      '  background-size: cover;',
      '  box-shadow: 0 0 0 1.5px var(--np-ink), 0 1px 2px rgba(26, 42, 74, 0.18);',
      '  pointer-events: none;',
      '}',
      'html[data-dsh-notebook] [data-np-avatar-node="assistant"] { left: calc(-1 * (var(--np-avatar-size) + 13px)); top: -4px; background-image: var(--np-avatar-assistant-image, radial-gradient(circle at 32% 26%, #fdfdfd 0%, #ececec 52%, #d6d6d6 100%)); }',
      'html[data-dsh-notebook] [data-np-avatar-node="user"] { right: 0; background-image: var(--np-avatar-user-image, radial-gradient(circle at 32% 26%, #fdfdfd 0%, #ececec 52%, #d6d6d6 100%)); }',
      /* 保险：关闭头像时即使节点清理还没跑到也不显示 */
      'html[data-dsh-notebook][data-np-avatar="off"] [data-np-avatar-node] { display: none !important; }',

      /* ── 输入框：白底 + 手绘勾线 ── */
      /* 输入框：白底 + 手绘勾线（编辑器是 Lexical，不是 textarea） */
      'html[data-dsh-notebook] [class*="_card"]:has([data-lexical-editor]) {',
      '  position: relative;',
      '  background-color: var(--np-card) !important;',
      '  background-image: var(--np-grain) !important;',
      '  background-repeat: repeat;',
      '  border-radius: 4px !important;',
      '  box-shadow: none !important;',
      '}',
      'html[data-dsh-notebook] [class*="_card"]:has([data-lexical-editor])::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: -8px;',
      '  border: 10px solid transparent;',
      '  border-image-source: var(--np-sketch);',
      '  border-image-slice: 18;',
      '  border-image-width: 10px;',
      '  border-image-repeat: stretch;',
      '  pointer-events: none;',
      '}',

      /* ── 浮层：菜单 / 弹窗统一白纸卡片 ── */
      'html[data-dsh-notebook] [role="menu"],',
      'html[data-dsh-notebook] [role="listbox"],',
      'html[data-dsh-notebook] [role="dialog"] {',
      '  background-color: var(--np-card) !important;',
      '  border: 1.4px solid var(--np-ink);',
      '  border-radius: 3px;',
      '}',
      'html[data-dsh-notebook] [role="menuitem"]:hover,',
      'html[data-dsh-notebook] [role="option"][aria-selected="true"] {',
      '  background-color: rgba(26, 42, 74, 0.06) !important;',
      '}',

      /* ── 动效 ── */
      '@keyframes np-wave-slide { from { background-position-x: 0; } to { background-position-x: 20px; } }',

      /* ── 设置面板（自绘，只用于本插件的 section） ── */
      '.np-panel { display: flex; flex-direction: column; gap: 16px; max-width: 640px; color: var(--np-text); font-size: 13px; line-height: 1.5; }',
      '.np-head { display: flex; flex-direction: column; gap: 6px; }',
      '.np-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--np-ink); letter-spacing: 0.01em; }',
      '.np-sub { margin: 0; color: var(--np-muted); font-size: 12px; }',
      '.np-card { position: relative; display: flex; flex-direction: column; gap: 14px; padding: 16px 18px; background-color: var(--np-card); background-image: var(--np-grain); background-repeat: repeat; border-radius: 3px; }',
      '.np-card::after { content: ""; position: absolute; inset: -8px; border: 10px solid transparent; border-image-source: var(--np-sketch); border-image-slice: 18; border-image-width: 10px; border-image-repeat: stretch; pointer-events: none; }',
      '.np-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; }',
      '.np-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
      '.np-label { color: var(--np-text); font-weight: 500; }',
      '.np-hint { color: var(--np-muted); font-size: 11px; line-height: 1.45; }',
      '.np-control { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }',
      '.np-switch { position: relative; width: 42px; height: 22px; padding: 0; border: 1.4px solid var(--np-ink); border-radius: 11px; background-color: var(--np-paper); cursor: pointer; transition: background-color 0.18s ease; }',
      '.np-switch[aria-checked="true"] { background-color: var(--np-vermilion); border-color: var(--np-vermilion); }',
      '.np-knob { position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background-color: var(--np-ink); transition: transform 0.18s ease, background-color 0.18s ease; }',
      '.np-switch[aria-checked="true"] .np-knob { transform: translateX(19px); background-color: #fff; }',
      '.np-seg { display: inline-flex; overflow: hidden; border: 1.4px solid var(--np-ink); border-radius: 3px; }',
      '.np-seg-btn { padding: 4px 10px; border: 0; background: transparent; color: var(--np-text); font-size: 12px; line-height: 1.4; cursor: pointer; }',
      '.np-seg-btn + .np-seg-btn { border-left: 1.4px solid var(--np-ink); }',
      '.np-seg-on { background-color: var(--np-ink); color: var(--np-paper); }',
      '.np-range { width: 130px; accent-color: var(--np-vermilion); }',
      '.np-value { min-width: 42px; color: var(--np-muted); font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }',
      '.np-avatar-row { display: flex; align-items: center; gap: 14px; }',
      '.np-avatar { flex: 0 0 auto; width: 46px; height: 46px; border-radius: 50%; border: 1.6px solid var(--np-ink); background-color: #f2f2f2; background-image: var(--np-avatar-user-image, radial-gradient(circle at 32% 26%, #fdfdfd 0%, #ececec 52%, #d6d6d6 100%)); background-position: center; background-size: cover; background-repeat: no-repeat; }',
      '.np-avatar-meta { display: flex; flex-direction: column; gap: 6px; min-width: 0; }',
      '.np-avatar-name { color: var(--np-text); font-size: 12.5px; font-weight: 600; }',
      '.np-avatar-state { color: var(--np-muted); font-size: 11px; }',
      '.np-actions { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.np-btn { padding: 4px 10px; border: 1.4px solid var(--np-ink); border-radius: 3px; background-color: var(--np-paper); color: var(--np-text); font-size: 12px; cursor: pointer; transition: background-color 0.15s ease; }',
      '.np-btn:hover { background-color: rgba(26, 42, 74, 0.06); }',
      '.np-btn[disabled] { opacity: 0.5; cursor: default; }',
      '.np-btn-danger { border-color: var(--np-vermilion); color: var(--np-vermilion); }',
      '.np-btn-danger:hover { background-color: rgba(192, 57, 43, 0.08); }',
      '.np-note { margin: 0; color: var(--np-muted); font-size: 11px; }',
      '.np-crop-mask { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background-color: rgba(26, 42, 74, 0.44); }',
      '.np-crop { position: relative; display: flex; flex-direction: column; gap: 12px; width: 300px; padding: 18px; border-radius: 3px; background-color: var(--np-card); background-image: var(--np-grain); background-repeat: repeat; }',
      '.np-crop::after { content: ""; position: absolute; inset: -8px; border: 10px solid transparent; border-image-source: var(--np-sketch); border-image-slice: 18; border-image-width: 10px; border-image-repeat: stretch; pointer-events: none; }',
      '.np-crop-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--np-ink); }',
      '.np-crop-stage { position: relative; width: 240px; height: 240px; margin: 0 auto; overflow: hidden; border: 1.6px solid var(--np-ink); border-radius: 50%; background-color: #fff; cursor: grab; touch-action: none; }',
      '.np-crop-stage:active { cursor: grabbing; }',
      '.np-crop-stage canvas { display: block; width: 100%; height: 100%; }',
      '.np-crop-hint { margin: 0; color: var(--np-muted); font-size: 11px; text-align: center; }',
      '.np-crop-actions { display: flex; justify-content: flex-end; gap: 8px; }',
    ].join('\n')

    /** 注入/复用样式表；返回清理函数（只移除本插件自己插入的那一个标签）。 */
    function ensureStyle(doc) {
      const existing = doc.querySelector('style[data-plugin-css="' + STYLE_KEY + '"]')
      if (existing) return () => {}
      const tag = doc.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = STYLE_KEY
      tag.textContent = CSS
      doc.head.appendChild(tag)
      return () => {
        if (tag.parentNode) tag.parentNode.removeChild(tag)
      }
    }

    /* ──────────────────────────────────── 头像 DOM 注入 ── */

    function collectAvatarHosts(doc) {
      return Array.from(doc.querySelectorAll(AVATAR_HOST))
    }

    /**
     * 幂等同步：移除失效/多余的 `[data-np-avatar-node]`，给缺头像的消息行补一个。
     * 卸载时以 `enabled=false` 调用即可清空。
     */
    function syncAvatars(doc, enabled) {
      const stray = doc.querySelectorAll('[data-np-avatar-node]')
      for (const node of Array.from(stray)) {
        if (node === doc.documentElement) continue
        const host = node.parentElement
        if (!enabled || !host || !host.matches(AVATAR_HOST)) node.remove()
      }
      if (!enabled) return

      for (const host of collectAvatarHosts(doc)) {
        const existing = host.querySelector(':scope > [data-np-avatar-node]')
        const kind = host.getAttribute('data-chat-flow-kind')
        const role = kind === 'user' || kind === 'steering' || host.hasAttribute('data-submission-echo') ? 'user' : 'assistant'
        if (existing) {
          if (existing.getAttribute('data-np-avatar-node') !== role) existing.setAttribute('data-np-avatar-node', role)
          continue
        }
        const node = doc.createElement('span')
        node.setAttribute('data-np-avatar-node', role)
        node.setAttribute('aria-hidden', 'true')
        host.appendChild(node)
      }
    }

    /*
     * 侧栏大框：`nav[class$="_panelList"]` 与 `[class$="_regionArea"]` 是兄弟节点，
     * 没有共同包裹层，所以量出两者 rect 的并集，注入一个绝对定位的框元素。
     * `enabled=false` 时移除，卸载无残留。
     */
    let frameRoot = null

    function releaseFrameRoot() {
      if (!frameRoot) return
      frameRoot.style.removeProperty('isolation')
      if (frameRoot.dataset.npFramePosition === '1') {
        frameRoot.style.removeProperty('position')
        delete frameRoot.dataset.npFramePosition
      }
      frameRoot = null
    }

    function syncSidebarFrame(doc, enabled) {
      const nav = doc.querySelector('nav[class$="_panelList"]')
      const region = doc.querySelector('[class$="_regionArea"]')
      const root = nav && nav.parentElement
      const existing = doc.querySelectorAll('[data-np-frame]')
      if (!enabled || !root || !region) {
        for (const node of Array.from(existing)) node.remove()
        releaseFrameRoot()
        return
      }
      let box = existing[0]
      for (const node of Array.from(existing)) if (node !== box) node.remove()
      if (!box) {
        box = doc.createElement('div')
        box.setAttribute('data-np-frame', 'sidebar')
        box.setAttribute('aria-hidden', 'true')
      }
      if (box.parentElement !== root) root.appendChild(box)
      if (frameRoot && frameRoot !== root) releaseFrameRoot()
      if (getComputedStyle(root).position === 'static') {
        root.style.position = 'relative'
        root.dataset.npFramePosition = '1'
      }
      root.style.isolation = 'isolate'
      frameRoot = root
      const navRect = nav.getBoundingClientRect()
      const regionRect = region.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      if (!navRect.height || !rootRect.height) { box.hidden = true; return }
      box.hidden = false
      const pad = 8
      const left = Math.min(navRect.left, regionRect.left) - rootRect.left - pad
      const top = navRect.top - rootRect.top - pad
      const right = rootRect.right - Math.max(navRect.right, regionRect.right) - pad
      const bottom = rootRect.bottom - regionRect.bottom - pad
      box.style.left = Math.max(left, -pad) + 'px'
      box.style.top = Math.max(top, -pad) + 'px'
      box.style.right = Math.max(right, -pad) + 'px'
      box.style.bottom = Math.max(bottom, -pad) + 'px'
    }

    /* ─────────────────────────────────────── 设置面板 UI ── */

    function Switch({ checked, onChange, label }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          className: 'np-switch',
          onClick: () => onChange(!checked),
        },
        h('span', { className: 'np-knob' }),
      )
    }

    function Segmented({ value, options, onChange, label }) {
      return h(
        'div',
        { className: 'np-seg', role: 'group', 'aria-label': label },
        options.map((option) =>
          h(
            'button',
            {
              key: String(option.value),
              type: 'button',
              className: 'np-seg-btn' + (option.value === value ? ' np-seg-on' : ''),
              'aria-pressed': option.value === value ? 'true' : 'false',
              onClick: () => onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    function Row({ label, hint, children }) {
      return h(
        'div',
        { className: 'np-row' },
        h('div', { className: 'np-row-text' }, h('span', { className: 'np-label' }, label), hint ? h('span', { className: 'np-hint' }, hint) : null),
        h('div', { className: 'np-control' }, children),
      )
    }

    /** 裁剪对话框：拖动 + 缩放，输出 256×256 JPEG Blob。 */
    function CropDialog({ src, onCancel, onConfirm, t }) {
      const STAGE = 240
      const [image, setImage] = useState(null)
      const [zoom, setZoom] = useState(1)
      const [offset, setOffset] = useState({ x: 0, y: 0 })
      const [busy, setBusy] = useState(false)
      const [failed, setFailed] = useState(false)
      const canvasRef = useRef(null)
      const dragRef = useRef(null)

      useEffect(() => {
        let alive = true
        const img = new Image()
        img.onload = () => {
          if (alive) setImage(img)
        }
        img.onerror = () => {
          if (!alive) return
          setFailed(true)
          console.warn('[notebook-paper] 头像图片解码失败')
        }
        img.src = src
        return () => {
          alive = false
          img.onload = null
          img.onerror = null
        }
      }, [src])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onCancel()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onCancel])

      const clampOffset = useCallback(
        (next, currentZoom) => {
          if (!image) return next
          const width = image.naturalWidth || image.width
          const height = image.naturalHeight || image.height
          const scale = (STAGE / Math.min(width, height)) * currentZoom
          const maxX = Math.max(0, (width * scale - STAGE) / 2)
          const maxY = Math.max(0, (height * scale - STAGE) / 2)
          return {
            x: Math.min(maxX, Math.max(-maxX, next.x)),
            y: Math.min(maxY, Math.max(-maxY, next.y)),
          }
        },
        [image],
      )

      const metrics = useMemo(() => {
        if (!image) return null
        const width = image.naturalWidth || image.width
        const height = image.naturalHeight || image.height
        const scale = (STAGE / Math.min(width, height)) * zoom
        const drawnWidth = width * scale
        const drawnHeight = height * scale
        return {
          w: drawnWidth,
          h: drawnHeight,
          x: (STAGE - drawnWidth) / 2 + offset.x,
          y: (STAGE - drawnHeight) / 2 + offset.y,
        }
      }, [image, zoom, offset])

      useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !image || !metrics) return
        const ratio = window.devicePixelRatio || 1
        const size = Math.round(STAGE * ratio)
        if (canvas.width !== size) {
          canvas.width = size
          canvas.height = size
        }
        const context = canvas.getContext('2d')
        if (!context) return
        context.clearRect(0, 0, size, size)
        context.save()
        context.scale(ratio, ratio)
        context.drawImage(image, metrics.x, metrics.y, metrics.w, metrics.h)
        context.restore()
      }, [image, metrics])

      const confirm = useCallback(async () => {
        if (!image || !metrics || busy) return
        setBusy(true)
        try {
          const out = 256
          const canvas = document.createElement('canvas')
          canvas.width = out
          canvas.height = out
          const context = canvas.getContext('2d')
          if (!context) throw new Error('canvas 2d unavailable')
          const k = out / STAGE
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, out, out)
          context.drawImage(image, metrics.x * k, metrics.y * k, metrics.w * k, metrics.h * k)
          const blob = await new Promise((resolve) => canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.92))
          if (!blob) throw new Error('toBlob returned null')
          await onConfirm(blob)
        } catch (error) {
          console.warn('[notebook-paper] 头像裁剪失败：', error)
          setFailed(true)
        } finally {
          setBusy(false)
        }
      }, [image, metrics, busy, onConfirm])

      return h(
        'div',
        {
          className: 'np-crop-mask',
          onClick: (event) => {
            if (event.target === event.currentTarget) onCancel()
          },
        },
        h(
          'div',
          { className: 'np-crop', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('crop.title') },
          h('h3', { className: 'np-crop-title' }, t('crop.title')),
          h(
            'div',
            {
              className: 'np-crop-stage',
              onPointerDown: (event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
              },
              onPointerMove: (event) => {
                const drag = dragRef.current
                if (!drag || drag.id !== event.pointerId) return
                setOffset(clampOffset({ x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) }, zoom))
              },
              onPointerUp: (event) => {
                if (dragRef.current && dragRef.current.id === event.pointerId) dragRef.current = null
                try {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                } catch (error) {
                  /* 忽略：指针可能已释放 */
                }
              },
            },
            h('canvas', { ref: canvasRef }),
          ),
          h('p', { className: 'np-crop-hint' }, failed ? t('crop.failed') : t('crop.hint')),
          h(
            'div',
            { className: 'np-row' },
            h('span', { className: 'np-hint' }, t('crop.zoom')),
            h('input', {
              className: 'np-range',
              type: 'range',
              min: 1,
              max: 3,
              step: 0.02,
              value: zoom,
              'aria-label': t('crop.zoom'),
              onChange: (event) => {
                const next = Number(event.target.value)
                setZoom(next)
                setOffset((current) => clampOffset(current, next))
              },
            }),
          ),
          h(
            'div',
            { className: 'np-crop-actions' },
            h('button', { type: 'button', className: 'np-btn', onClick: onCancel }, t('crop.cancel')),
            h('button', { type: 'button', className: 'np-btn', disabled: !image || busy, onClick: confirm }, t('crop.confirm')),
          ),
        ),
      )
    }

    function NotebookSettings({ api }) {
      const state = useStore(api.store.subscribe, api.store.get)
      const i18nVersion = useStore(api.i18n.subscribe, api.i18n.getVersion)
      const avatarVersion = useStore(api.avatar.subscribe, api.avatar.getVersion)
      const t = api.i18n.t
      const fileRefs = useRef({})
      const [crop, setCrop] = useState(null)

      // 临时 objectURL（刚选的本地文件）在裁剪结束或组件卸载时释放
      useEffect(() => {
        if (!crop || !crop.temp) return undefined
        return () => {
          try {
            URL.revokeObjectURL(crop.src)
          } catch (error) {
            /* 忽略 */
          }
        }
      }, [crop])

      const onPick = useCallback((role, event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file) return
        if (!file.type || !file.type.startsWith('image/')) {
          console.warn('[notebook-paper] 只接受图片文件：', file.type)
          return
        }
        setCrop({ role, src: URL.createObjectURL(file), temp: true })
      }, [])

      const closeCrop = useCallback(() => {
        setCrop(null)
      }, [])

      const onCropped = useCallback(
        async (blob) => {
          const role = crop ? crop.role : 'user'
          await api.avatar.save(role, blob)
          setCrop(null)
        },
        [api, crop],
      )

      const removeAvatar = useCallback(
        async (role) => {
          await api.avatar.clear(role)
        },
        [api],
      )

      // i18nVersion 只用于触发重渲染（语言切换），不参与渲染内容
      void i18nVersion
      void avatarVersion

      return h(
        'div',
        { className: 'np-panel' },
        h(
          'div',
          { className: 'np-head' },
          h('h2', { className: 'np-title' }, t('section.title')),
          h('p', { className: 'np-sub' }, t('section.desc')),
        ),
        h(
          'div',
          { className: 'np-card' },
          h(Row, {
            label: t('master.label'),
            hint: t('master.hint'),
            children: h(Switch, {
              checked: state.enabled,
              label: t('master.label'),
              onChange: (next) => api.store.patch({ enabled: next }),
            }),
          }),
          h(Row, {
            label: t('gap.label'),
            hint: t('gap.hint'),
            children: h(Segmented, {
              label: t('gap.label'),
              value: state.gap,
              options: [
                { value: 40, label: t('gap.wide') },
                { value: 32, label: t('gap.medium') },
                { value: 24, label: t('gap.narrow') },
              ],
              onChange: (next) => api.store.patch({ gap: next }),
            }),
          }),
          h(Row, {
            label: t('noise.label'),
            hint: t('noise.hint'),
            children: h(Switch, {
              checked: state.noise,
              label: t('noise.label'),
              onChange: (next) => api.store.patch({ noise: next }),
            }),
          }),
        ),
        h(
          'div',
          { className: 'np-card' },
          h(Row, {
            label: t('avatar.label'),
            hint: t('avatar.hint'),
            children: h(Switch, {
              checked: state.showAvatar,
              label: t('avatar.label'),
              onChange: (next) => api.store.patch({ showAvatar: next }),
            }),
          }),
          h(Row, {
            label: t('avatar.size'),
            hint: t('avatar.size.hint'),
            children: [
              h('input', {
                key: 'range',
                className: 'np-range',
                type: 'range',
                min: AVATAR_MIN,
                max: AVATAR_MAX,
                step: 1,
                value: state.avatarSize,
                'aria-label': t('avatar.size'),
                onChange: (event) => api.store.patch({ avatarSize: Number(event.target.value) }),
              }),
              h('span', { key: 'value', className: 'np-value' }, state.avatarSize + 'px'),
            ],
          }),
          ...AVATAR_ROLES.map((role) => {
            const url = api.avatar.getUrl(role)
            const isTheirs = role === 'assistant'
            const previewStyle = url
              ? { backgroundImage: 'url("' + url + '")' }
              : isTheirs
                ? { backgroundImage: 'var(--np-avatar-assistant-image, ' + AVATAR_DEFAULT_CSS + ')' }
                : undefined
            return h(
              'div',
              { className: 'np-avatar-row', key: role },
              h('span', { className: 'np-avatar', style: previewStyle, 'aria-hidden': 'true' }),
              h(
                'div',
                { className: 'np-avatar-meta' },
                h('span', { className: 'np-avatar-name' }, t(isTheirs ? 'avatar.theirs' : 'avatar.mine')),
                h(
                  'span',
                  { className: 'np-avatar-state' },
                  (url ? t('avatar.ready') : t('avatar.none')) +
                    ' ' +
                    t(isTheirs ? 'avatar.theirs.hint' : 'avatar.mine.hint'),
                ),
                h(
                  'div',
                  { className: 'np-actions' },
                  h('input', {
                    ref: (el) => {
                      fileRefs.current[role] = el
                    },
                    type: 'file',
                    accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml',
                    style: { display: 'none' },
                    onChange: (event) => onPick(role, event),
                  }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'np-btn',
                      onClick: () => {
                        const el = fileRefs.current[role]
                        if (el) el.click()
                      },
                    },
                    t('avatar.upload'),
                  ),
                  url
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'np-btn',
                          onClick: () => setCrop({ role, src: url, temp: false }),
                        },
                        t('avatar.recrop'),
                      )
                    : null,
                  url
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'np-btn np-btn-danger',
                          onClick: () => removeAvatar(role),
                        },
                        t('avatar.remove'),
                      )
                    : null,
                ),
              ),
            )
          }),
          h('p', { className: 'np-note' }, t('storage')),
        ),
        h(
          'div',
          { className: 'np-head' },
          h('span', { className: 'np-label' }, t('limits.title')),
          h('p', { className: 'np-note' }, t('limits.body')),
        ),
        crop
          ? h(CropDialog, {
              src: crop.src,
              t,
              onCancel: closeCrop,
              onConfirm: onCropped,
            })
          : null,
      )
    }

    /* ───────────────────────────────────── 安装 / 卸载 ── */

    function install(ctx, store, avatarStore, i18n) {
      const doc = document
      const root = doc.documentElement
      const teardown = []
      let tokenDisposer = null
      let observer = null
      let frame = 0

      const dropTokens = () => {
        if (!tokenDisposer) return
        try {
          tokenDisposer()
        } catch (error) {
          console.warn('[notebook-paper] 释放 token 覆盖失败：', error)
        }
        tokenDisposer = null
      }

      const engageTokens = () => {
        if (tokenDisposer) return
        const theme = ctx && ctx.theme
        if (!theme || typeof theme.overrideTokens !== 'function') {
          console.warn('[notebook-paper] ctx.theme.overrideTokens 不可用，已跳过 token 覆盖；CSS 视觉层继续生效（降级模式）')
          return
        }
        try {
          tokenDisposer = theme.overrideTokens(TOKEN_SOURCE, Object.fromEntries(THEME_TOKENS))
        } catch (error) {
          console.warn('[notebook-paper] token 覆盖失败，降级为纯 CSS 外观：', error)
          tokenDisposer = null
        }
      }

      const paint = (state) => {
        if (!state.enabled) {
          root.removeAttribute('data-dsh-notebook')
          root.removeAttribute('data-np-noise')
          root.removeAttribute('data-np-avatar')
          root.style.removeProperty('--np-line-gap')
          root.style.removeProperty('--np-avatar-size')
          dropTokens()
          syncAvatars(doc, false)
          syncSidebarFrame(doc, false)
          return
        }
        root.setAttribute('data-dsh-notebook', '')
        root.setAttribute('data-np-noise', state.noise ? 'on' : 'off')
        root.setAttribute('data-np-avatar', state.showAvatar ? 'on' : 'off')
        root.style.setProperty('--np-line-gap', state.gap + 'px')
        root.style.setProperty('--np-avatar-size', state.avatarSize + 'px')
        engageTokens()
        syncAvatars(doc, state.showAvatar)
        syncSidebarFrame(doc, true)
      }

      const applyAvatarUrl = () => {
        for (const role of AVATAR_ROLES) {
          const name = role === 'user' ? '--np-avatar-user-image' : '--np-avatar-assistant-image'
          const url = avatarStore.getUrl(role)
          if (url) root.style.setProperty(name, 'url("' + url + '")')
          else root.style.removeProperty(name)
        }
      }

      const scheduleSync = () => {
        if (frame) return
        frame = window.requestAnimationFrame(() => {
          frame = 0
          syncAvatars(doc, store.get().showAvatar)
          syncSidebarFrame(doc, store.get().enabled)
          applyAvatarUrl()
        })
      }

      // 1) 样式表
      teardown.push(ensureStyle(doc))

      // 2) 状态 → 根节点标记 / 变量 / token
      paint(store.get())
      applyAvatarUrl()
      teardown.push(store.subscribe(paint))
      teardown.push(avatarStore.subscribe(applyAvatarUrl))

      // 3) 头像图片从 IndexedDB 载入
      avatarStore.hydrate()

      // 4) 消息列表是动态渲染的：用 MutationObserver 维护头像节点
      const target = doc.body || root
      observer = new MutationObserver(scheduleSync)
      observer.observe(target, { childList: true, subtree: true })
      scheduleSync()

      return () => {
        if (frame) window.cancelAnimationFrame(frame)
        frame = 0
        if (observer) observer.disconnect()
        observer = null
        for (const fn of teardown.splice(0).reverse()) {
          try {
            fn()
          } catch (error) {
            console.warn('[notebook-paper] 清理步骤失败：', error)
          }
        }
        syncAvatars(doc, false)
        root.removeAttribute('data-dsh-notebook')
        root.removeAttribute('data-np-noise')
        root.removeAttribute('data-np-avatar')
        root.style.removeProperty('--np-line-gap')
        root.style.removeProperty('--np-avatar-size')
        root.style.removeProperty('--np-avatar-user-image')
        root.style.removeProperty('--np-avatar-assistant-image')
        dropTokens()
      }
    }

    /* ─────────────────────────────────────── 插件入口 ── */

    return {
      inject: ['slots', 'theme', 'locale'],
      apply(ctx) {
        const store = createSettingsStore()
        const i18n = createI18n(ctx)
        const avatarStore = createAvatarStore()
        const api = { store, i18n, avatar: avatarStore }

        ctx.effect(() => {
          const dispose = install(ctx, store, avatarStore, i18n)
          return () => {
            dispose()
            avatarStore.dispose()
          }
        }, PLUGIN_ID + ': notebook-paper')

        if (ctx.slots && typeof ctx.slots.inject === 'function') {
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'notebook-paper',
                order: 12,
                label: () => i18n.t('section.label'),
                inject: () => ({ api }),
              },
              NotebookSettings,
            ),
          )
        } else {
          console.warn('[notebook-paper] 缺少 settings.section 插槽，设置面板不会出现；主题与持久化仍生效')
        }
      },
    }
  },
})
