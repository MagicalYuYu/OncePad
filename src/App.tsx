import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import './i18n'
import type { Note, NoteIndexEntry, NoteColor, NoteType, NoteFormat, Workspace, Tag, NoteQuery, TrashNoteEntry, AppInfo } from './types'
import { renderMarkdown, detectMarkdownSyntax } from './lib/markdown'
import { matchShortcut, formatShortcut, detectShortcutConflict } from './lib/shortcuts'
import { sortNotes, isExpiringSoon, DRAFT_TTL_MS, type SortBy } from './lib/notes'
import { DEFAULT_TOGGLE_SHORTCUT, DEFAULT_NEW_SHORTCUT, DEFAULT_COPY_SHORTCUT, NOTE_COLORS, COLOR_HEX } from './lib/constants'
import { useAutoSave } from './hooks/useAutoSave'
import { SettingsPanel, type SettingsTab, type ShortcutTarget } from './components/SettingsPanel'
import { NotesPanel, type NoteFilter } from './components/NotesPanel'
import { EditorArea, type OutlineItem } from './components/EditorArea'

function App() {
  const { t, i18n } = useTranslation()
  // === 编辑器状态 ===
  const [text, setText] = useState('')
  // === 编辑器模式：code=代码编辑模式，preview=MD 渲染阅读模式 ===
  const [editorMode, setEditorMode] = useState<'code' | 'preview'>('code')
  // === 当前编辑器内容的格式：plain=纯文本，md=Markdown ===
  const [editorFormat, setEditorFormat] = useState<NoteFormat>('plain')
  // === 文件模式状态（通过双击 .md 文件打开时） ===
  const [fileInfo, setFileInfo] = useState<{ filePath: string; fileName: string } | null>(null)
  // === 笔记状态 ===
  const [notes, setNotes] = useState<NoteIndexEntry[]>([])
  const [currentNote, setCurrentNote] = useState<Note | null>(null)
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null)
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('draft')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('updated')
  const [showNotes, setShowNotes] = useState(false)
  // 按标签筛选：选中标签 ID 后只显示使用该标签的笔记（空字符串=不筛选）
  const [filterTagId, setFilterTagId] = useState<string>('')
  // === 回收站状态 ===
  const [trashNotes, setTrashNotes] = useState<TrashNoteEntry[]>([])
  // 回收站视图开关：点击侧边栏垃圾桶图标切换
  const [showTrashView, setShowTrashView] = useState(false)
  // === 工作区状态 ===
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('')
  // 默认新建笔记工作区：新建笔记时自动归入此工作区（空字符串=默认工作区）
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState<string>('')
  const [showNewWorkspace, setShowNewWorkspace] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newWorkspaceIcon, setNewWorkspaceIcon] = useState('📁')
  // 工作区右键菜单：{ wsId, x, y } | null
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<{ wsId: string; wsName: string; x: number; y: number } | null>(null)
  // 笔记列表右键菜单：{ entry, x, y } | null
  const [noteContextMenu, setNoteContextMenu] = useState<{ entry: NoteIndexEntry; x: number; y: number } | null>(null)
  // === 标签状态 ===
  const [tags, setTags] = useState<Tag[]>([])
  const [tagInput, setTagInput] = useState('')
  const [showTagSuggest, setShowTagSuggest] = useState(false)
  // === 颜色选择器 ===
  const [showColorPicker, setShowColorPicker] = useState(false)
  // === 大纲（标题跳转列表） ===
  const [showOutline, setShowOutline] = useState(false)
  // === 设置/通用状态（保留） ===
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [toggleShortcut, setToggleShortcut] = useState('')
  const [toggleShortcutInput, setToggleShortcutInput] = useState('')
  const [newShortcut, setNewShortcut] = useState('')
  const [newShortcutInput, setNewShortcutInput] = useState('')
  const [copyShortcut, setCopyShortcut] = useState('')
  const [copyShortcutInput, setCopyShortcutInput] = useState('')
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  // 关闭最后一个窗口时的行为：hide=隐藏到托盘，confirm=弹窗确认退出，quit=直接退出
  const [closeLastWindowBehavior, setCloseLastWindowBehavior] = useState<'hide' | 'confirm' | 'quit'>('hide')
  // 草稿自动清理时长（天）：1/2/3/7，默认 3 天
  const [draftTtlDays, setDraftTtlDays] = useState<number>(3)
  // 开机自启：默认关闭
  const [autoLaunch, setAutoLaunch] = useState(false)
  // 开机自启后隐藏到后台
  const [autoLaunchHidden, setAutoLaunchHidden] = useState(false)
  // 失焦自动隐藏：窗口失去焦点时自动隐藏到托盘
  const [blurToHide, setBlurToHide] = useState(false)
  // 行号显示：在编辑区最左侧显示行号（默认关闭）
  const [showLineNumbers, setShowLineNumbers] = useState(false)
  // 行号模式：logical=逻辑行号（按换行符分割），visual=视觉行号（软换行后每行都编号）
  const [lineNumberMode, setLineNumberMode] = useState<'logical' | 'visual'>('logical')
  // 编辑器行高（默认 1.7，范围 1.2-2.4）
  const [editorLineHeight, setEditorLineHeight] = useState(1.7)
  // 编辑器内边距（默认 24，范围 8-48）
  const [editorPadding, setEditorPadding] = useState(24)
  // 缩略图（minimap）：编辑区右侧显示文档缩略图，支持快速跳转
  const [showMinimap, setShowMinimap] = useState(false)
  // 导航栏按钮显示/隐藏配置（用户可自定义导航栏上哪些按钮可见）
  const [navbarButtons, setNavbarButtons] = useState({
    pin: true, color: true, newBtn: true,
    copy: true, notes: true, settings: true,
  })
  // v1.1.0：调试面板显示开关（默认 false，管理标签页→高级中启用）
  const [showDebugTab, setShowDebugTab] = useState(false)
  // v1.1.0：序号补全开关（VS Code 风格 inline suggestion，默认 false，用户在设置中手动开启）
  const [enableSequenceSuggestion, setEnableSequenceSuggestion] = useState(false)
  // v1.1.0：序号补全接受方式（方案 B：仅 Tab/Enter，移除"继续输入即接受"）
  const [seqAcceptOnTab, setSeqAcceptOnTab] = useState(true)
  const [seqAcceptOnEnter, setSeqAcceptOnEnter] = useState(false)
  // v1.1.0：文件菜单下拉
  const [showFileMenu, setShowFileMenu] = useState(false)
  // v1.1.0：关于对话框
  const [showAboutDialog, setShowAboutDialog] = useState(false)
  // v1.1.0：应用信息（关于对话框使用）
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  // v1.1.0：未保存修改对话框（文件模式下关闭/新建/打开时触发）
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  // v1.1.0：上次保存到文件的内容（用于检测 dirty 状态）
  const [lastSavedText, setLastSavedText] = useState('')
  const [recordingTarget, setRecordingTarget] = useState<ShortcutTarget | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  // Toast 消息：用于编辑区内的操作反馈（如复制成功）
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [indentType, setIndentType] = useState<'space' | 'tab'>('space')
  const [indentSize, setIndentSize] = useState(2)
  const [fontEn, setFontEn] = useState('SF Mono')
  const [fontCn, setFontCn] = useState('Microsoft YaHei')
  const [fontSize, setFontSize] = useState(14)
  const [fontSplit, setFontSplit] = useState(false)
  const [uiScale, setUiScale] = useState(100)
  // uiScalePreview 用于滑块拖动时的即时预览值，不触发实际缩放
  const [uiScalePreview, setUiScalePreview] = useState(100)
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [language, setLanguage] = useState('zh-CN')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // MD 预览区引用，用于切换模式时同步滚动位置
  const previewRef = useRef<HTMLDivElement>(null)
  // 光标行号跟踪（用于模式切换时定位）
  const cursorLineRef = useRef<number>(0)
  // 高亮行号（切换模式后短暂高亮，自动消失）
  const [highlightLine, setHighlightLine] = useState<number>(-1)
  // 预览区高亮带Y坐标（用于模式切换时显示位置指示）
  const [highlightBandY, setHighlightBandY] = useState<number>(-1)
  // 编辑区行高亮Y坐标（预览→编辑切换时，高亮目标行，与预览模式高亮效果对齐）
  const [editorHighlightY, setEditorHighlightY] = useState<number>(-1)
  // 编辑区行高亮信息（用于 scroll 时动态更新高亮条位置，使其跟随内容滚动）
  const editorHighlightInfoRef = useRef<{ line: number; lineHeight: number; paddingTop: number } | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // searchKeyword 的 ref，供 reloadNotes 读取最新值而无需进入依赖
  const searchKeywordRef = useRef('')
  // v1.1.0：未保存对话框确认后要执行的回调（close/new/open 等）
  const pendingActionRef = useRef<(() => void) | null>(null)

  // === 定时器泄漏防护：统一跟踪所有 setTimeout/requestAnimationFrame，组件卸载时清理 ===
  const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const pendingRafsRef = useRef<Set<number>>(new Set())
  // 安全 setTimeout：自动记录 ID，卸载时统一清理
  const safeTimeout = useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(() => {
      pendingTimeoutsRef.current.delete(id)
      fn()
    }, delay)
    pendingTimeoutsRef.current.add(id)
    return id
  }, [])
  // 安全 requestAnimationFrame：自动记录 ID，卸载时统一清理
  const safeRaf = useCallback((fn: () => void) => {
    const id = requestAnimationFrame(() => {
      pendingRafsRef.current.delete(id)
      fn()
    })
    pendingRafsRef.current.add(id)
    return id
  }, [])

  // 检测当前内容是否包含 Markdown 语法（用于决定是否显示模式切换按钮）
  // 笔记已标记为 md 格式 或 内容检测到 MD 语法时，都应显示按钮
  const hasMarkdownSyntax = useMemo(() => detectMarkdownSyntax(text), [text])

  // === 调试系统 ===
  const [debugMode, setDebugMode] = useState(false)
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const debugLogsRef = useRef<string[]>([])
  const debugLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const entry = `[${ts}] ${msg}`
    // 仅在 debugMode 开启时写入文件和更新 UI，避免每次按键都触发文件 I/O
    if (!debugMode) return
    try {
      window.electronAPI.writeDebugLog(msg)
    } catch {}
    debugLogsRef.current = [...debugLogsRef.current, entry]
    if (debugLogsRef.current.length > 200) {
      debugLogsRef.current = debugLogsRef.current.slice(-200)
    }
    setDebugLogs([...debugLogsRef.current])
  }, [debugMode])

  useEffect(() => {
    searchKeywordRef.current = searchKeyword
  }, [searchKeyword])

  // 组件卸载时清理所有待处理的定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      pendingTimeoutsRef.current.forEach(id => clearTimeout(id))
      pendingTimeoutsRef.current.clear()
      pendingRafsRef.current.forEach(id => cancelAnimationFrame(id))
      pendingRafsRef.current.clear()
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
        searchTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    document.documentElement.className = theme === 'light' ? 'light' : ''
    localStorage.setItem('theme', theme)
  }, [theme])

  // 动态应用字体：根据 fontSplit 开关选择统一字体或分离字体
  useEffect(() => {
    const root = document.documentElement
    const styleId = 'oncepad-font-face'
    let style = document.getElementById(styleId) as HTMLStyleElement | null

    if (fontSplit) {
      if (!style) {
        style = document.createElement('style')
        style.id = styleId
        document.head.appendChild(style)
      }
      style.textContent = `
        @font-face {
          font-family: 'OncePadEditor';
          src: local('${fontEn}');
          unicode-range: U+0000-007F, U+00A0-00FF, U+2000-206F, U+2E00-2E7F, U+1E00-1EFF;
        }
        @font-face {
          font-family: 'OncePadEditor';
          src: local('${fontCn}');
          unicode-range: U+3000-303F, U+4E00-9FFF, U+FF00-FFEF, U+3400-4DBF, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F, U+2B820-2CEAF, U+3040-309F, U+30A0-30FF, U+AC00-D7AF;
        }
      `
      root.style.setProperty('--editor-font', "'OncePadEditor', monospace")
    } else {
      if (style) {
        style.textContent = ''
      }
      root.style.setProperty('--editor-font', `'${fontCn}', sans-serif`)
    }

    root.style.setProperty('--editor-font-size', `${fontSize}px`)
  }, [fontEn, fontCn, fontSize, fontSplit])

  // 动态应用编辑器行高和内边距（通过 CSS 变量传递给 .editor 和 .editor-gutter）
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--editor-line-height', String(editorLineHeight))
    root.style.setProperty('--editor-padding-y', `${editorPadding}px`)
  }, [editorLineHeight, editorPadding])

  // 全局 UI 缩放：仅在 main-area 上生效，标题栏不受影响（防止 zoom 干扰 CSS Grid 行高计算）
  // 根因：document.documentElement.style.zoom 会缩放整个文档，导致 Grid 的 minmax(0,1fr) 行计算异常
  //       当 textarea 加载大量内容时，标题栏行（44px）被推出视口
  // 修复：zoom 仅作用于 main-area，标题栏始终保持原始 44px 高度
  const [mainAreaZoom, setMainAreaZoom] = useState('100%')
  useEffect(() => {
    setMainAreaZoom(`${uiScale}%`)
  }, [uiScale])

  // 初始化：加载工作区、标签、配置（不再加载旧 history）
  useEffect(() => {
    window.electronAPI.getWorkspaces().then(setWorkspaces)
    window.electronAPI.getTags().then(setTags)
    window.electronAPI.getConfig().then((config) => {
      setToggleShortcut(config.shortcut)
      setToggleShortcutInput(config.shortcut)
      setNewShortcut(config.newShortcut)
      setNewShortcutInput(config.newShortcut)
      setCopyShortcut(config.copyShortcut)
      setCopyShortcutInput(config.copyShortcut)
      setAlwaysOnTop(config.alwaysOnTop)
      setCloseLastWindowBehavior(config.closeLastWindowBehavior || 'hide')
      setDraftTtlDays(config.draftTtlDays || 3)
      setAutoLaunch(config.autoLaunch === true)
      setAutoLaunchHidden(config.autoLaunchHidden === true)
      setBlurToHide(config.blurToHide === true)
      setShowLineNumbers(config.showLineNumbers === true)
      setLineNumberMode(config.lineNumberMode === 'visual' ? 'visual' : 'logical')
      setEditorLineHeight(config.editorLineHeight ?? 1.7)
      setEditorPadding(config.editorPadding ?? 24)
      setShowMinimap(config.showMinimap === true)
      // v1.1.0：序号补全开关（默认关闭，用户在设置中手动开启）
      setEnableSequenceSuggestion(config.enableSequenceSuggestion === true)
      // v1.1.0：序号补全接受方式（方案 B：仅 Tab/Enter）
      setSeqAcceptOnTab(config.seqAcceptOnTab !== false)
      setSeqAcceptOnEnter(config.seqAcceptOnEnter === true)
      // 导航栏按钮配置（兼容旧配置，缺失字段默认 true）
      setNavbarButtons({
        pin: config.navbarButtons?.pin !== false,
        color: config.navbarButtons?.color !== false,
        newBtn: config.navbarButtons?.newBtn !== false,
        copy: config.navbarButtons?.copy !== false,
        notes: config.navbarButtons?.notes !== false,
        settings: config.navbarButtons?.settings !== false,
      })
      // v1.1.0：加载调试面板显示配置
      setShowDebugTab(config.showDebugTab === true)
      setDefaultWorkspaceId(config.defaultWorkspaceId || '')
      setIndentType(config.indentType)
      setIndentSize(config.indentSize)
      setFontEn(config.fontEn)
      setFontCn(config.fontCn)
      setFontSize(config.fontSize)
      setFontSplit(config.fontSplit)
      setUiScale(config.uiScale)
      setUiScalePreview(config.uiScale)
      setLanguage(config.language)
      i18n.changeLanguage(config.language)
    })
    window.electronAPI.getSystemFonts().then(setSystemFonts)
  }, [])

  // === Task 12: 文件模式启动检测 ===
  // 检测 URL query parameter ?file=xxx，如果有则通过 IPC 加载文件内容
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const filePath = params.get('file')
    if (filePath) {
      // v1.1.0：文件模式 — 加载文本文件内容到编辑区（支持任意纯文本格式）
      window.electronAPI.openFile(filePath).then((result) => {
        if (result) {
          setText(result.content)
          // v1.1.0：根据文件后缀名判断格式（md/markdown 为 MD 格式，其他为纯文本）
          const ext = result.fileName.toLowerCase().match(/\.([^.]+)$/)?.[1] || ''
          const isMd = ext === 'md' || ext === 'markdown'
          setEditorFormat(isMd ? 'md' : 'plain')
          // v1.1.0：MD 文件默认浏览模式（用户打开 MD 首要意图是浏览），其他格式默认编辑模式
          setEditorMode(isMd ? 'preview' : 'code')
          setFileInfo({ filePath: result.filePath, fileName: result.fileName })
          // v1.1.0：记录已保存内容（启动时加载的文件视为已保存状态）
          setLastSavedText(result.content)
          window.electronAPI.setWindowFile(result.filePath)
        }
      })
    }
  }, [])

  useEffect(() => {
    window.electronAPI.syncText(text)
    // 调试：监控布局状态 + 检查标题栏是否被覆盖（始终记录到文件）
    const titlebar = document.querySelector('.titlebar') as HTMLElement
    if (titlebar) {
      const rect = titlebar.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const elementsAtPoint = document.elementsFromPoint(centerX, centerY)
      const topElement = elementsAtPoint.length > 0 ? elementsAtPoint[0] : null
      const topElementInfo = topElement
        ? `${topElement.tagName}${topElement.className ? '.' + topElement.className.toString().split(' ').join('.') : ''}`
        : 'null'
      const isCovered = topElement !== titlebar && !titlebar.contains(topElement)
      debugLog(`text.length=${text.length} titlebar.h=${titlebar.offsetHeight} top=${rect.top} visible=${rect.top >= 0 && rect.top < window.innerHeight} topElement=${topElementInfo} covered=${isCovered} elemCount=${elementsAtPoint.length}`)
    }
  }, [text])

  // 调试：定期检查标题栏状态（每3秒）
  // v1.1.2 修复 Bug M-4：用 debugMode 包裹，生产环境不运行（避免每3秒 DOM 测量 + IPC 写入）
  useEffect(() => {
    if (!debugMode) return
    const interval = setInterval(() => {
      const titlebar = document.querySelector('.titlebar') as HTMLElement
      if (!titlebar) {
        debugLog(`PERIODIC: titlebar element not found in DOM!`)
        return
      }
      const rect = titlebar.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const elementsAtPoint = document.elementsFromPoint(centerX, centerY)
      const topElement = elementsAtPoint.length > 0 ? elementsAtPoint[0] : null
      const topElementInfo = topElement
        ? `${topElement.tagName}${topElement.className ? '.' + topElement.className.toString().split(' ').join('.') : ''}`
        : 'null'
      const isCovered = topElement !== titlebar && !titlebar.contains(topElement)
      const computedStyle = window.getComputedStyle(titlebar)
      debugLog(`PERIODIC: editorMode=${editorMode} titlebar.h=${titlebar.offsetHeight} top=${rect.top} display=${computedStyle.display} visibility=${computedStyle.visibility} opacity=${computedStyle.opacity} zIndex=${computedStyle.zIndex} bgColor=${computedStyle.backgroundColor} topElement=${topElementInfo} covered=${isCovered}`)
    }, 3000)
    return () => clearInterval(interval)
  }, [editorMode, debugMode])

  // === 跟踪光标行号（用于模式切换时定位） ===
  const updateCursorLine = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart
    const lines = textarea.value.slice(0, pos).split('\n')
    cursorLineRef.current = lines.length - 1
  }, [])

  useEffect(() => {
    if (!showNotes && !showSettings) {
      textareaRef.current?.focus()
    }
  }, [showNotes, showSettings])

  // === 重新加载笔记列表 ===
  // keywordOverride 用于搜索时传入最新关键词（绕过 state 异步更新）
  const reloadNotes = useCallback(async (keywordOverride?: string) => {
    const kw = keywordOverride !== undefined ? keywordOverride : searchKeywordRef.current
    if (kw.trim()) {
      // 搜索模式：调用全文搜索，再按当前标签页+标签筛选过滤
      let results = await window.electronAPI.searchNotes(kw.trim())
      results = results.filter(n => n.type === noteFilter)
      if (filterTagId) {
        results = results.filter(n => n.tags.includes(filterTagId))
      }
      setNotes(sortNotes(results, sortBy))
      return
    }
    // 普通模式：按工作区 + 类型 + 标签查询
    const query: NoteQuery = {
      type: noteFilter,
      workspaceId: selectedWorkspaceId || undefined,
      tagId: filterTagId || undefined,
    }
    const list = await window.electronAPI.getNotes(query)
    setNotes(sortNotes(list, sortBy))
  }, [noteFilter, selectedWorkspaceId, sortBy, filterTagId])

  // 当面板可见或筛选/排序/工作区/标签筛选变化时重新加载笔记
  useEffect(() => {
    if (showNotes) reloadNotes()
  }, [showNotes, noteFilter, sortBy, selectedWorkspaceId, filterTagId, reloadNotes])

  // === 确保存在当前笔记（工具栏操作前置：无当前笔记时先把草稿文本落盘） ===
  const ensureCurrentNote = useCallback(async (): Promise<Note | null> => {
    if (currentNote) return currentNote
    if (!text.trim()) return null
    const now = new Date()
    // 新建笔记工作区分配：优先当前选中工作区，若为"全部"则使用默认工作区
    const noteWorkspace = selectedWorkspaceId || defaultWorkspaceId
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: text.trim().split('\n')[0].slice(0, 100),
      content: text,
      type: 'draft',
      tags: [],
      color: 'default',
      workspace: noteWorkspace,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
      format: editorFormat,
    }
    await window.electronAPI.saveNote(newNote)
    setCurrentNote(newNote)
    setCurrentNoteId(newNote.id)
    await reloadNotes()
    return newNote
  }, [currentNote, text, selectedWorkspaceId, defaultWorkspaceId, editorFormat, reloadNotes])

  // === 保存当前笔记（更新或新建） ===
  const saveCurrentNote = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    const now = new Date()
    if (currentNote) {
      // 内容未变化则跳过，避免无谓写入与时间戳抖动
      const newTitle = trimmed.split('\n')[0].slice(0, 100)
      if (text === currentNote.content && newTitle === currentNote.title) return
      const updated: Note = {
        ...currentNote,
        title: newTitle,
        content: text,
        updatedAt: now.toISOString(),
      }
      await window.electronAPI.saveNote(updated)
      setCurrentNote(updated)
    } else {
      // 新建草稿：工作区分配同 ensureCurrentNote
      const noteWorkspace = selectedWorkspaceId || defaultWorkspaceId
      const newNote: Note = {
        id: crypto.randomUUID(),
        title: trimmed.split('\n')[0].slice(0, 100),
        content: text,
        type: 'draft',
        tags: [],
        color: 'default',
        workspace: noteWorkspace,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
        format: editorFormat,
      }
      await window.electronAPI.saveNote(newNote)
      setCurrentNote(newNote)
      setCurrentNoteId(newNote.id)
    }
    await reloadNotes()
  }, [text, currentNote, selectedWorkspaceId, defaultWorkspaceId, editorFormat, reloadNotes])

  // === 自动保存（定时防抖 + beforeunload 强制保存）===
  useAutoSave({
    text,
    fileInfo,
    currentNote,
    selectedWorkspaceId,
    editorFormat,
    saveCurrentNote,
  })

  const handleNew = useCallback(async () => {
    // v1.1.3 修复：文件模式下不新建草稿（避免把文件内容误存为笔记）
    // 只有笔记模式下才调用 saveCurrentNote 保存当前笔记
    if (!fileInfo) {
      await saveCurrentNote()
    }
    setText('')
    setCurrentNote(null)
    setCurrentNoteId(null)
    setEditorFormat('plain')
    setEditorMode('code')
    setFileInfo(null) // 清除文件模式
    textareaRef.current?.focus()
  }, [saveCurrentNote, fileInfo])

  const handleCopy = useCallback(async () => {
    if (!text.trim()) return
    await window.electronAPI.copyToClipboard(text)
    setCopyFeedback(true)
    // 编辑区内 toast 反馈
    setToastMessage(t('editor.copied'))
    safeTimeout(() => {
      setCopyFeedback(false)
      setToastMessage(null)
    }, 1500)
  }, [text, t])

  // === 选中笔记：加载完整内容到编辑区 ===
  const handleSelectNote = useCallback(async (id: string) => {
    // v1.1.3 修复：文件模式下不调用 saveCurrentNote（避免把文件内容误存为草稿）
    // 只有笔记模式下才保存当前笔记
    if (!fileInfo) {
      await saveCurrentNote()
    }
    const note = await window.electronAPI.getNote(id)
    if (note) {
      setText(note.content)
      setCurrentNote(note)
      setCurrentNoteId(note.id)
      setEditorFormat(note.format)
      setEditorMode('code')
      setFileInfo(null) // 清除文件模式
      // 加载后从顶部开始浏览，而非跳到末尾
      // focus() 默认将光标置于文本末尾导致滚动到底部，需显式重置光标和滚动位置
      safeTimeout(() => {
        const textarea = textareaRef.current
        if (textarea) {
          textarea.selectionStart = 0
          textarea.selectionEnd = 0
          textarea.scrollTop = 0
          textarea.focus()
        }
      }, 0)
    }
  }, [saveCurrentNote, fileInfo])

  // === 删除笔记 ===
  const handleDeleteNote = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // 删除确认：避免误操作（移入回收站，可恢复）
    if (!window.confirm(t('notes.deleteConfirm'))) return
    await window.electronAPI.deleteNote(id)
    // 若删除的是当前笔记，清空编辑器
    if (currentNoteId === id) {
      setText('')
      setCurrentNote(null)
      setCurrentNoteId(null)
    }
    await reloadNotes()
  }, [currentNoteId, reloadNotes, t])

  // === 回收站相关处理函数（回收站机制新增） ===

  // 加载回收站笔记列表
  const reloadTrashNotes = useCallback(async () => {
    const trash = await window.electronAPI.getTrashNotes()
    setTrashNotes(trash)
  }, [])

  // 从回收站恢复笔记
  const handleRestoreNote = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await window.electronAPI.restoreNote(id)
    await reloadTrashNotes()
    await reloadNotes()
  }, [reloadTrashNotes, reloadNotes])

  // 永久删除回收站中的笔记
  const handlePermanentDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(t('trash.deleteConfirm'))) return
    await window.electronAPI.permanentlyDeleteNote(id)
    await reloadTrashNotes()
  }, [reloadTrashNotes, t])

  // 清空回收站
  const handleEmptyTrash = useCallback(async () => {
    if (!confirm(t('trash.emptyConfirm'))) return
    await window.electronAPI.emptyTrash()
    await reloadTrashNotes()
  }, [reloadTrashNotes, t])

  // 清空所有草稿：批量移入回收站
  const handleClearAllDrafts = useCallback(async () => {
    if (!confirm(t('notes.clearAllDraftsConfirm'))) return
    // 获取当前所有草稿（notes 已经过滤为草稿列表）
    for (const entry of notes) {
      await window.electronAPI.deleteNote(entry.id)
    }
    // 若当前笔记是草稿之一，清空编辑器
    if (currentNoteId && notes.some(n => n.id === currentNoteId)) {
      setText('')
      setCurrentNote(null)
      setCurrentNoteId(null)
    }
    await reloadNotes()
  }, [notes, currentNoteId, reloadNotes])

  // 切换到回收站视图时加载回收站数据
  useEffect(() => {
    if (showNotes && showTrashView) {
      reloadTrashNotes()
    }
  }, [showNotes, showTrashView, reloadTrashNotes])

  // 点击垃圾桶图标：切换回收站视图
  const handleToggleTrash = useCallback(() => {
    setShowTrashView(prev => !prev)
  }, [])

  // === 收藏 / 取消收藏（编辑器工具栏按钮） ===
  const togglePin = useCallback(async () => {
    const note = await ensureCurrentNote()
    if (!note) return
    if (note.type === 'draft') {
      // 草稿转收藏：调用 pinNote，后端清除 expiresAt
      const pinned = await window.electronAPI.pinNote(note.id)
      if (pinned) {
        setCurrentNote(pinned)
      }
    } else {
      // 收藏转草稿：重新设置过期时间为 now + 3 天，清除置顶状态
      const now = new Date()
      const updated: Note = {
        ...note,
        type: 'draft',
        expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
        updatedAt: now.toISOString(),
        pinned: undefined,
      }
      await window.electronAPI.saveNote(updated)
      setCurrentNote(updated)
    }
    await reloadNotes()
  }, [ensureCurrentNote, reloadNotes])

  // === 修改颜色标记 ===
  const changeColor = useCallback(async (color: NoteColor) => {
    const note = await ensureCurrentNote()
    if (!note) return
    const now = new Date().toISOString()
    const updated: Note = { ...note, color, updatedAt: now }
    await window.electronAPI.saveNote(updated)
    setCurrentNote(updated)
    setShowColorPicker(false)
    await reloadNotes()
  }, [ensureCurrentNote, reloadNotes])

  // === 添加标签（自动补全 + 回车创建） ===
  const addTag = useCallback(async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const note = await ensureCurrentNote()
    if (!note) return
    // 标签是全局的：按名称查找已有标签（不区分工作区）
    let tag = tags.find(tg => tg.name.toLowerCase() === trimmed.toLowerCase())
    if (!tag) {
      // 创建新标签（全局生效）
      const updatedTags = await window.electronAPI.createTag(trimmed, '#89b4fa')
      setTags(updatedTags)
      tag = updatedTags.find(tg => tg.name.toLowerCase() === trimmed.toLowerCase())
    }
    if (!tag) return
    if (note.tags.includes(tag.id)) {
      setTagInput('')
      setShowTagSuggest(false)
      return
    }
    const now = new Date().toISOString()
    const updated: Note = { ...note, tags: [...note.tags, tag.id], updatedAt: now }
    await window.electronAPI.saveNote(updated)
    setCurrentNote(updated)
    setTagInput('')
    setShowTagSuggest(false)
    await reloadNotes()
    // 重新加载标签以刷新 usageCount（后端动态统计）
    const refreshedTags = await window.electronAPI.getTags()
    setTags(refreshedTags)
  }, [ensureCurrentNote, tags, reloadNotes])

  // === 移除标签 ===
  const removeTag = useCallback(async (tagId: string) => {
    if (!currentNote) return
    const now = new Date().toISOString()
    const updated: Note = { ...currentNote, tags: currentNote.tags.filter(tg => tg !== tagId), updatedAt: now }
    await window.electronAPI.saveNote(updated)
    setCurrentNote(updated)
    await reloadNotes()
    // 重新加载标签以刷新 usageCount（后端动态统计）
    const refreshedTags = await window.electronAPI.getTags()
    setTags(refreshedTags)
  }, [currentNote, reloadNotes])

  // === 搜索输入（防抖 250ms） ===
  const handleSearchChange = useCallback((value: string) => {
    setSearchKeyword(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => reloadNotes(value), 250)
  }, [reloadNotes])

  // === 标签自动补全建议（全局，不按工作区过滤） ===
  const tagSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase()
    if (!q) return []
    return tags.filter(tg =>
      tg.name.toLowerCase().includes(q) &&
      !currentNote?.tags.includes(tg.id)
    ).slice(0, 5)
  }, [tagInput, tags, currentNote])

  // === 新建工作区 ===
  const handleCreateWorkspace = useCallback(async () => {
    const name = newWorkspaceName.trim()
    if (!name) return
    const icon = newWorkspaceIcon.trim() || '📁'
    const updated = await window.electronAPI.createWorkspace(name, icon)
    setWorkspaces(updated)
    setShowNewWorkspace(false)
    setNewWorkspaceName('')
    setNewWorkspaceIcon('📁')
    // 自动选中新工作区
    const created = updated.find(w => w.name === name)
    if (created) setSelectedWorkspaceId(created.id)
  }, [newWorkspaceName, newWorkspaceIcon])

  // 工作区右键菜单：记录鼠标位置和工作区信息
  const handleWorkspaceContextMenu = useCallback((e: React.MouseEvent, ws: Workspace) => {
    e.preventDefault()
    e.stopPropagation()
    setWorkspaceContextMenu({ wsId: ws.id, wsName: ws.name, x: e.clientX, y: e.clientY })
  }, [])

  // 删除工作区：后端会将该工作区下的笔记 workspace 字段置空（移到默认区）
  const handleDeleteWorkspace = useCallback(async (wsId: string, wsName: string) => {
    setWorkspaceContextMenu(null)
    const confirmMsg = t('workspace.deleteConfirm', { name: wsName, defaultValue: '确定要删除工作区「{{name}}」吗？该工作区下的笔记将移至默认工作区。' })
    if (!confirm(confirmMsg)) return
    const updated = await window.electronAPI.deleteWorkspace(wsId)
    setWorkspaces(updated)
    // 若删除的是当前选中工作区，切换回默认区
    if (selectedWorkspaceId === wsId) {
      setSelectedWorkspaceId('')
    }
    // 若删除的是默认工作区，重置为空
    if (defaultWorkspaceId === wsId) {
      setDefaultWorkspaceId('')
    }
    // 重新加载标签（删除工作区会将其下标签移至默认区）
    const updatedTags = await window.electronAPI.getTags()
    setTags(updatedTags)
    await reloadNotes()
  }, [selectedWorkspaceId, defaultWorkspaceId, reloadNotes, t])

  // === 工作区管理：重命名 ===
  const handleRenameWorkspace = useCallback(async (id: string, name: string) => {
    const updated = await window.electronAPI.renameWorkspace(id, name)
    setWorkspaces(updated)
  }, [])

  // === 工作区管理：更换图标 ===
  const handleUpdateWorkspaceIcon = useCallback(async (id: string, icon: string) => {
    const updated = await window.electronAPI.updateWorkspaceIcon(id, icon)
    setWorkspaces(updated)
  }, [])

  // === 工作区管理：设置默认工作区 ===
  const handleSetDefaultWorkspace = useCallback(async (workspaceId: string) => {
    setDefaultWorkspaceId(workspaceId)
    await window.electronAPI.setDefaultWorkspace(workspaceId)
  }, [])

  // === 移动笔记到工作区 ===
  const handleMoveNoteToWorkspace = useCallback(async (noteId: string, workspaceId: string) => {
    const updatedNotes = await window.electronAPI.moveNoteToWorkspace(noteId, workspaceId)
    // 重新加载笔记列表（由 reloadNotes 内部处理 query）
    await reloadNotes()
    // 若移动的是当前笔记，更新 currentNote 的 workspace 字段
    if (currentNoteId === noteId && currentNote) {
      setCurrentNote({ ...currentNote, workspace: workspaceId })
    }
  }, [reloadNotes, currentNoteId, currentNote])

  // === 标签管理：重命名 ===
  const handleRenameTag = useCallback(async (id: string, name: string) => {
    const updated = await window.electronAPI.renameTag(id, name)
    setTags(updated)
  }, [])

  // === 标签管理：更换颜色 ===
  const handleUpdateTagColor = useCallback(async (id: string, color: string) => {
    const updated = await window.electronAPI.updateTagColor(id, color)
    setTags(updated)
  }, [])

  // === 标签管理：删除标签（设置面板中） ===
  const handleDeleteTagFromSettings = useCallback(async (id: string, name: string) => {
    const confirmMsg = t('tag.deleteConfirm', { name, defaultValue: '确定要删除标签「{{name}}」吗？该标签将从所有笔记中移除。' })
    if (!confirm(confirmMsg)) return
    const updated = await window.electronAPI.deleteTag(id)
    setTags(updated)
    await reloadNotes()
  }, [reloadNotes, t])

  // 笔记列表右键菜单
  const handleNoteContextMenu = useCallback((e: React.MouseEvent, entry: NoteIndexEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setNoteContextMenu({ entry, x: e.clientX, y: e.clientY })
  }, [])

  // 从右键菜单操作：根据笔记状态执行不同操作
  // 草稿 → 收藏（type: draft→pin）
  // 收藏且未置顶 → 置顶（pinned: false→true）
  // 收藏且已置顶 → 取消置顶（pinned: true→false）
  const handleTogglePinFromMenu = useCallback(async (entry: NoteIndexEntry) => {
    setNoteContextMenu(null)
    if (entry.type === 'draft') {
      // 草稿 → 收藏
      await window.electronAPI.pinNote(entry.id)
    } else if (entry.pinned === true) {
      // 收藏且已置顶 → 取消置顶（不影响收藏状态）
      await window.electronAPI.setNotePinned(entry.id, false)
    } else {
      // 收藏且未置顶 → 置顶
      await window.electronAPI.setNotePinned(entry.id, true)
    }
    await reloadNotes()
  }, [reloadNotes])

  // 从右键菜单删除笔记
  const handleDeleteNoteFromMenu = useCallback(async (entry: NoteIndexEntry) => {
    setNoteContextMenu(null)
    // 删除确认：避免误操作（移入回收站，可恢复）
    if (!window.confirm(t('notes.deleteConfirm'))) return
    await window.electronAPI.deleteNote(entry.id)
    if (currentNoteId === entry.id) {
      setText('')
      setCurrentNote(null)
      setCurrentNoteId(null)
    }
    await reloadNotes()
  }, [currentNoteId, reloadNotes, t])

  // 笔记列表键盘导航：上下箭头切换选中项，Enter 打开笔记
  const handleNoteListKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const nextIndex = Math.min(index + 1, notes.length - 1)
      const nextNote = notes[nextIndex]
      if (nextNote) handleSelectNote(nextNote.id)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prevIndex = Math.max(index - 1, 0)
      const prevNote = notes[prevIndex]
      if (prevNote) handleSelectNote(prevNote.id)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const note = notes[index]
      if (note) handleSelectNote(note.id)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      const note = notes[index]
      if (note) handleDeleteNote(note.id, e as unknown as React.MouseEvent)
    }
  }, [notes, handleSelectNote, handleDeleteNote])

  // 全局键盘导航：笔记面板打开时，拦截箭头键切换笔记（不依赖焦点在笔记项上）
  useEffect(() => {
    if (!showNotes || showTrashView || notes.length === 0) return
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 焦点在输入框/textarea 中时不拦截
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter' && e.key !== 'Delete') return
      // 找到当前选中笔记的索引
      const currentIndex = notes.findIndex(n => n.id === currentNoteId)
      const index = currentIndex >= 0 ? currentIndex : 0
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const nextIndex = Math.min(index + 1, notes.length - 1)
        if (nextIndex !== index) handleSelectNote(notes[nextIndex].id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prevIndex = Math.max(index - 1, 0)
        if (prevIndex !== index) handleSelectNote(notes[prevIndex].id)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleSelectNote(notes[index].id)
      } else if (e.key === 'Delete') {
        e.preventDefault()
        handleDeleteNote(notes[index].id, { stopPropagation: () => {} } as unknown as React.MouseEvent)
      }
    }
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [showNotes, showTrashView, notes, currentNoteId, handleSelectNote, handleDeleteNote])

  // === 标签输入键盘事件 ===
  const handleTagInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (tagInput.trim()) addTag(tagInput)
    } else if (e.key === 'Escape') {
      // 阻止事件冒泡，避免 Escape 同时关闭整个笔记面板
      e.stopPropagation()
      setTagInput('')
      setShowTagSuggest(false)
    }
  }, [tagInput, addTag])

  // 标签输入框失焦：延迟关闭建议列表（150ms），允许鼠标点击建议项
  const handleTagInputBlur = useCallback(() => {
    safeTimeout(() => setShowTagSuggest(false), 150)
  }, [safeTimeout])

  const handleShortcutKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (recordingTarget === null) return
    e.preventDefault()
    e.stopPropagation()

    const modifierKeys = ['Control', 'Alt', 'Shift', 'Meta']
    if (modifierKeys.includes(e.key)) return

    const parts: string[] = []
    if (e.metaKey) parts.push('Command')
    if (e.ctrlKey) parts.push('Control')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')

    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
    parts.push(key)
    const recorded = parts.join('+')

    if (recordingTarget === 'toggle') {
      setToggleShortcutInput(recorded)
    } else if (recordingTarget === 'new') {
      setNewShortcutInput(recorded)
    } else if (recordingTarget === 'copy') {
      setCopyShortcutInput(recorded)
    }
    setRecordingTarget(null)
  }, [recordingTarget])

  const handleSaveToggleShortcut = useCallback(async () => {
    if (toggleShortcutInput.trim()) {
      // 冲突检测：检查是否与 new/copy 快捷键冲突
      const conflict = detectShortcutConflict(toggleShortcutInput, [newShortcut, copyShortcut])
      if (conflict) {
        window.alert(t('settings.shortcutConflict', { conflict: formatShortcut(conflict) }))
        return
      }
      const success = await window.electronAPI.setShortcut(toggleShortcutInput)
      if (success) {
        setToggleShortcut(toggleShortcutInput)
      }
    }
  }, [toggleShortcutInput, newShortcut, copyShortcut, t])

  const handleSaveNewShortcut = useCallback(async () => {
    // v1.1.0：允许空字符串（禁用快捷键）
    if (newShortcutInput === '' || newShortcutInput.trim()) {
      // 冲突检测：检查是否与 toggle/copy 快捷键冲突（空字符串不冲突）
      if (newShortcutInput.trim()) {
        const conflict = detectShortcutConflict(newShortcutInput, [toggleShortcut, copyShortcut])
        if (conflict) {
          window.alert(t('settings.shortcutConflict', { conflict: formatShortcut(conflict) }))
          return
        }
      }
      const success = await window.electronAPI.setLocalShortcut('new', newShortcutInput)
      if (success) {
        setNewShortcut(newShortcutInput)
      }
    }
  }, [newShortcutInput, toggleShortcut, copyShortcut, t])

  const handleSaveCopyShortcut = useCallback(async () => {
    // v1.1.0：允许空字符串（禁用快捷键）
    if (copyShortcutInput === '' || copyShortcutInput.trim()) {
      // 冲突检测：检查是否与 toggle/new 快捷键冲突（空字符串不冲突）
      if (copyShortcutInput.trim()) {
        const conflict = detectShortcutConflict(copyShortcutInput, [toggleShortcut, newShortcut])
        if (conflict) {
          window.alert(t('settings.shortcutConflict', { conflict: formatShortcut(conflict) }))
          return
        }
      }
      const success = await window.electronAPI.setLocalShortcut('copy', copyShortcutInput)
      if (success) {
        setCopyShortcut(copyShortcutInput)
      }
    }
  }, [copyShortcutInput, toggleShortcut, newShortcut, t])

  // 快捷键恢复默认
  const handleResetToggleShortcut = useCallback(async () => {
    const success = await window.electronAPI.setShortcut(DEFAULT_TOGGLE_SHORTCUT)
    if (success) {
      setToggleShortcut(DEFAULT_TOGGLE_SHORTCUT)
      setToggleShortcutInput(DEFAULT_TOGGLE_SHORTCUT)
    }
  }, [])

  const handleResetNewShortcut = useCallback(async () => {
    const success = await window.electronAPI.setLocalShortcut('new', DEFAULT_NEW_SHORTCUT)
    if (success) {
      setNewShortcut(DEFAULT_NEW_SHORTCUT)
      setNewShortcutInput(DEFAULT_NEW_SHORTCUT)
    }
  }, [])

  const handleResetCopyShortcut = useCallback(async () => {
    const success = await window.electronAPI.setLocalShortcut('copy', DEFAULT_COPY_SHORTCUT)
    if (success) {
      setCopyShortcut(DEFAULT_COPY_SHORTCUT)
      setCopyShortcutInput(DEFAULT_COPY_SHORTCUT)
    }
  }, [])

  // 快捷键清空
  const handleClearToggleShortcut = useCallback(async () => {
    // 清空输入框但不清空已保存的快捷键（需要保存才生效）
    setToggleShortcutInput('')
  }, [])

  const handleClearNewShortcut = useCallback(async () => {
    setNewShortcutInput('')
  }, [])

  const handleClearCopyShortcut = useCallback(async () => {
    setCopyShortcutInput('')
  }, [])

  const handleAlwaysOnTopChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked
    const applied = await window.electronAPI.setAlwaysOnTop(next)
    setAlwaysOnTop(applied)
  }, [])

  const handleCloseLastWindowBehaviorChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as 'hide' | 'confirm' | 'quit'
    await window.electronAPI.setCloseLastWindowBehavior(next)
    setCloseLastWindowBehavior(next)
  }, [])

  // 草稿自动清理时长变更
  const handleDraftTtlDaysChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = Number(e.target.value)
    const success = await window.electronAPI.setDraftTtlDays(next)
    if (success) {
      setDraftTtlDays(next)
    }
  }, [])

  const handleIndentTypeChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.target.value as 'space' | 'tab'
    setIndentType(newType)
    await window.electronAPI.setIndent(newType, indentSize)
  }, [indentSize])

  const handleIndentSizeChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSize = Number(e.target.value)
    setIndentSize(newSize)
    await window.electronAPI.setIndent(indentType, newSize)
  }, [indentType])

  const handleFontEnChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const font = e.target.value
    setFontEn(font)
    await window.electronAPI.setFontEn(font)
  }, [])

  const handleFontCnChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const font = e.target.value
    setFontCn(font)
    await window.electronAPI.setFontCn(font)
  }, [])

  const handleFontSizeChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const size = Number(e.target.value)
    setFontSize(size)
    await window.electronAPI.setFontSize(size)
  }, [])

  const handleFontSplitChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked
    setFontSplit(next)
    await window.electronAPI.setFontSplit(next)
  }, [])

  // UI 缩放：onChange 只更新预览值（不触发缩放），onMouseUp/onTouchEnd 才真正应用
  const handleUiScaleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUiScalePreview(Number(e.target.value))
  }, [])

  const applyUiScale = useCallback(async (scale: number) => {
    setUiScale(scale)
    await window.electronAPI.setUiScale(scale)
  }, [])

  // 开机自启开关变更（提取自 SettingsPanel JSX 内联 onChange）
  const handleAutoLaunchChange = useCallback((enabled: boolean) => {
    setAutoLaunch(enabled)
    // 关闭开机自启时同步关闭隐藏选项
    if (!enabled) setAutoLaunchHidden(false)
    window.electronAPI.setAutoLaunch(enabled, enabled ? autoLaunchHidden : false)
  }, [autoLaunchHidden])

  // 开机自启后隐藏到后台（提取自 SettingsPanel JSX 内联 onChange）
  const handleAutoLaunchHiddenChange = useCallback((hidden: boolean) => {
    setAutoLaunchHidden(hidden)
    window.electronAPI.setAutoLaunch(true, hidden)
  }, [])

  // 失焦自动隐藏开关
  const handleBlurToHideChange = useCallback((enabled: boolean) => {
    setBlurToHide(enabled)
    window.electronAPI.setBlurToHide(enabled)
  }, [])

  // 行号显示开关：同步到主进程持久化
  const handleShowLineNumbersChange = useCallback((enabled: boolean) => {
    setShowLineNumbers(enabled)
    window.electronAPI.setShowLineNumbers(enabled)
  }, [])

  // 行号模式切换：同步到主进程持久化
  const handleLineNumberModeChange = useCallback((mode: 'logical' | 'visual') => {
    setLineNumberMode(mode)
    window.electronAPI.setLineNumberMode(mode)
  }, [])

  // 编辑器行高调整：同步到主进程持久化 + 实时更新 CSS 变量
  const handleEditorLineHeightChange = useCallback((value: number) => {
    setEditorLineHeight(value)
    window.electronAPI.setEditorLineHeight(value)
  }, [])

  // 编辑器内边距调整：同步到主进程持久化 + 实时更新 CSS 变量
  const handleEditorPaddingChange = useCallback((value: number) => {
    setEditorPadding(value)
    window.electronAPI.setEditorPadding(value)
  }, [])

  // 缩略图（minimap）开关：同步到主进程持久化
  const handleShowMinimapChange = useCallback((enabled: boolean) => {
    setShowMinimap(enabled)
    window.electronAPI.setShowMinimap(enabled)
  }, [])

  // 导航栏按钮显示/隐藏：同步到主进程持久化
  const handleNavbarButtonChange = useCallback((key: string, enabled: boolean) => {
    setNavbarButtons(prev => ({ ...prev, [key]: enabled }))
    window.electronAPI.setNavbarButton(key, enabled)
  }, [])

  // v1.1.0：调试面板显示开关
  const handleShowDebugTabChange = useCallback((enabled: boolean) => {
    setShowDebugTab(enabled)
    window.electronAPI.setShowDebugTab(enabled)
  }, [])

  // v1.1.0：序号补全开关（VS Code 风格 inline suggestion）
  const handleEnableSequenceSuggestionChange = useCallback((enabled: boolean) => {
    setEnableSequenceSuggestion(enabled)
    window.electronAPI.setEnableSequenceSuggestion(enabled)
  }, [])

  // v1.1.0：序号补全接受方式变更（方案 B：仅 tab / enter）
  const handleSeqAcceptModeChange = useCallback((mode: 'tab' | 'enter', enabled: boolean) => {
    if (mode === 'tab') setSeqAcceptOnTab(enabled)
    else if (mode === 'enter') setSeqAcceptOnEnter(enabled)
    window.electronAPI.setSeqAcceptMode(mode, enabled)
  }, [])

  // 调试模式开关（提取自 SettingsPanel JSX 内联 onChange）
  const handleDebugModeChange = useCallback((enabled: boolean) => {
    setDebugMode(enabled)
    if (!enabled) {
      debugLogsRef.current = []
      setDebugLogs([])
    }
  }, [])

  // 清空调试日志（提取自 SettingsPanel JSX 内联 onClick）
  const handleClearDebugLogs = useCallback(() => {
    debugLogsRef.current = []
    setDebugLogs([])
  }, [])

  const handleLanguageChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value
    setLanguage(lang)
    await i18n.changeLanguage(lang)
    await window.electronAPI.setLanguage(lang)
  }, [i18n])

  const adjustFontSize = useCallback(async (delta: number) => {
    const newSize = Math.min(24, Math.max(12, fontSize + delta))
    if (newSize === fontSize) return
    setFontSize(newSize)
    await window.electronAPI.setFontSize(newSize)
  }, [fontSize])

  // Ctrl+滚轮缩放字号
  const handleWheel = useCallback((e: React.WheelEvent<HTMLTextAreaElement>) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    adjustFontSize(e.deltaY < 0 ? 1 : -1)
  }, [adjustFontSize])

  // === 编辑器滚动监听：高亮期间使高亮条跟随内容滚动 ===
  const handleEditorScroll = useCallback(() => {
    const info = editorHighlightInfoRef.current
    if (!info) return
    const textarea = textareaRef.current
    if (!textarea) return
    const { line, lineHeight, paddingTop } = info
    const newY = paddingTop + line * lineHeight - textarea.scrollTop
    setEditorHighlightY(newY)
  }, [])

  // === 标记当前笔记为 MD 格式 ===
  const markAsMarkdown = useCallback(() => {
    setEditorFormat('md')
    if (currentNote) {
      setCurrentNote({ ...currentNote, format: 'md' })
    }
  }, [currentNote])

  // === 包裹选中文本（用于粗体、斜体、行内代码快捷标记） ===
  const wrapSelection = useCallback((before: string, after: string, placeholder: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = textarea.value
    const selected = value.slice(start, end)
    const content = selected || placeholder
    const newValue = value.slice(0, start) + before + content + after + value.slice(end)
    setText(newValue)
    markAsMarkdown()
    safeRaf(() => {
      if (selected) {
        // 有选中文本：选中包裹后的整体
        textarea.selectionStart = start
        textarea.selectionEnd = start + before.length + content.length + after.length
      } else {
        // 无选中：选中占位符文本（方便直接替换）
        textarea.selectionStart = start + before.length
        textarea.selectionEnd = start + before.length + content.length
      }
    })
  }, [markAsMarkdown])

  // === 插入链接模板（Ctrl+K） ===
  const insertLink = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = textarea.value
    const selected = value.slice(start, end)
    const placeholder = t('editor.linkPlaceholder')
    if (selected) {
      // 有选中文本：变为 [选中文本](url)，选中 url 部分便于替换
      const newValue = value.slice(0, start) + `[${selected}](url)` + value.slice(end)
      setText(newValue)
      markAsMarkdown()
      safeRaf(() => {
        const urlStart = start + selected.length + 3 // `[${selected}](` 的长度
        textarea.selectionStart = urlStart
        textarea.selectionEnd = urlStart + 3 // 'url' 的长度
      })
    } else {
      // 无选中：插入 [链接文本](url)，选中"链接文本"部分
      const newValue = value.slice(0, start) + `[${placeholder}](url)` + value.slice(end)
      setText(newValue)
      markAsMarkdown()
      safeRaf(() => {
        textarea.selectionStart = start + 1 // `[` 之后
        textarea.selectionEnd = start + 1 + placeholder.length
      })
    }
  }, [t, markAsMarkdown])

  const handleTabKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.nativeEvent.isComposing) return
    e.preventDefault()
    const textarea = e.currentTarget
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = textarea.value

    if (e.shiftKey) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const linePrefix = value.slice(lineStart, start)
      let removeCount = 0
      if (indentType === 'tab' && linePrefix.startsWith('\t')) {
        removeCount = 1
      } else {
        const match = linePrefix.match(/^ +/)
        if (match) {
          removeCount = Math.min(match[0].length, indentSize)
        }
      }
      if (removeCount > 0) {
        const newValue = value.slice(0, lineStart) + value.slice(lineStart + removeCount)
        setText(newValue)
        const newPos = Math.max(lineStart, start - removeCount)
        safeRaf(() => {
          textarea.selectionStart = newPos
          textarea.selectionEnd = Math.max(lineStart, end - removeCount)
        })
      }
    } else {
      const indent = indentType === 'tab' ? '\t' : ' '.repeat(indentSize)
      const newValue = value.slice(0, start) + indent + value.slice(end)
      setText(newValue)
      const newPos = start + indent.length
      safeRaf(() => {
        textarea.selectionStart = newPos
        textarea.selectionEnd = newPos
      })
    }
  }, [indentType, indentSize])

  // === Task 12: 保存到文件（文件模式下 Ctrl+S 保存到原文件路径） ===
  const handleSaveToFile = useCallback(async () => {
    if (!fileInfo) return
    const result = await window.electronAPI.saveFile(fileInfo.filePath, text)
    if (!result.success) {
      // 保存失败时提示用户，而非仅 console.error（用户无感知）
      alert(`保存文件失败：${result.error || '未知错误'}`)
    } else {
      // v1.1.0：更新 lastSavedText 以清除 dirty 状态
      setLastSavedText(text)
      // v1.1.1 修复 Bug 2：保存成功后显示 toast 反馈，避免用户无感知
      setToastMessage(t('editor.saved'))
      safeTimeout(() => { setToastMessage(null) }, 1500)
    }
  }, [fileInfo, text, t])

  // v1.1.0：文件是否已修改（dirty 状态检测）
  const isFileDirty = fileInfo && text !== lastSavedText

  // v1.1.3 修复 Bug M-2：state ref 镜像，让 checkUnsavedAndExecute 读取最新 state 而非闭包捕获值
  // 根因：checkUnsavedAndExecute 依赖 [fileInfo, isFileDirty, currentNote, text, saveCurrentNote]，
  //   每次 state 变化都会重建，导致依赖它的 loadFileFromExternal/handleCloseWithCheck 也重建，
  //   进而触发 useEffect 重新注册 IPC 监听器。即使已修复监听器移除，频繁重建仍浪费性能。
  //   改用 ref 后 checkUnsavedAndExecute 依赖稳定（空数组），监听器只注册一次。
  const fileInfoRef = useRef(fileInfo)
  const isFileDirtyRef = useRef(isFileDirty)
  const currentNoteRef = useRef(currentNote)
  const textRef = useRef(text)
  const saveCurrentNoteRef = useRef(saveCurrentNote)
  useEffect(() => {
    fileInfoRef.current = fileInfo
    isFileDirtyRef.current = isFileDirty
    currentNoteRef.current = currentNote
    textRef.current = text
    saveCurrentNoteRef.current = saveCurrentNote
  })

  // v1.1.3 修复 Bug 2：检查未保存修改并执行动作
  // 设计原则：笔记模式（草稿/收藏）永远实时保存，不弹窗、不丢弃
  // - 文件模式（fileInfo 存在）且有修改：弹窗询问是否保存文件
  // - 笔记模式（fileInfo 为空）且有修改：自动保存笔记后执行 action（不弹窗）
  // - 无修改：直接执行 action
  // v1.1.3 修复 Bug M-2：改用 ref 读取最新 state，依赖数组稳定为空，避免闭包捕获过期 state
  const checkUnsavedAndExecute = useCallback((action: () => void) => {
    const fi = fileInfoRef.current
    const dirty = isFileDirtyRef.current
    const cn = currentNoteRef.current
    const tx = textRef.current
    if (fi && dirty) {
      // 文件模式且有修改：弹窗询问是否保存文件
      pendingActionRef.current = action
      setShowUnsavedDialog(true)
    } else if (!fi && cn && tx !== cn.content) {
      // 笔记模式且有修改：自动保存笔记（不弹窗，不丢弃）
      saveCurrentNoteRef.current().then(() => action())
    } else {
      action()
    }
  }, [])

  // v1.1.1：在已有窗口中加载外部文件（双击文件复用窗口场景）
  // 主进程 second-instance 事件中，优先复用已有窗口而非创建新窗口，减少 Electron 进程启动开销
  // v1.1.3 修复 Bug 2/5：清除 currentNote/currentNoteId，避免后续自动保存覆盖旧笔记
  const loadFileFromExternal = useCallback((filePath: string) => {
    checkUnsavedAndExecute(async () => {
      const result = await window.electronAPI.openFile(filePath)
      if (result) {
        // 清除笔记关联，避免后续自动保存用文件内容覆盖旧笔记
        setCurrentNote(null)
        setCurrentNoteId(null)
        setText(result.content)
        // 根据文件后缀名判断格式（md/markdown 为 MD 格式，其他为纯文本）
        const ext = result.fileName.toLowerCase().match(/\.([^.]+)$/)?.[1] || ''
        const isMd = ext === 'md' || ext === 'markdown'
        setEditorFormat(isMd ? 'md' : 'plain')
        // MD 文件默认浏览模式，其他格式默认编辑模式
        setEditorMode(isMd ? 'preview' : 'code')
        setFileInfo({ filePath: result.filePath, fileName: result.fileName })
        setLastSavedText(result.content)
        window.electronAPI.setWindowFile(result.filePath)
      }
    })
  }, [checkUnsavedAndExecute])

  // v1.1.0：未保存对话框 - 保存
  // v1.1.3 修复 Bug 2：区分文件模式和笔记模式
  // - 文件模式：保存到文件
  // - 笔记模式：保存到笔记数据库（理论上不会走到这里，因为 checkUnsavedAndExecute 会自动保存笔记）
  //   但作为防御性代码保留，避免边界情况下数据丢失
  const handleUnsavedDialogSave = useCallback(async () => {
    setShowUnsavedDialog(false)
    if (fileInfo) {
      const result = await window.electronAPI.saveFile(fileInfo.filePath, text)
      if (result.success) {
        setLastSavedText(text)
      } else {
        // v1.1.2 修复 Bug S-3：保存失败时中止后续动作，避免数据丢失
        alert(`保存失败：${result.error || '未知错误'}`)
        return
      }
    } else if (currentNote || text.trim()) {
      // 笔记模式：保存到笔记数据库
      await saveCurrentNote()
    }
    const action = pendingActionRef.current
    pendingActionRef.current = null
    if (action) action()
  }, [fileInfo, text, currentNote, saveCurrentNote])

  // v1.1.0：未保存对话框 - 不保存
  const handleUnsavedDialogDiscard = useCallback(() => {
    setShowUnsavedDialog(false)
    const action = pendingActionRef.current
    pendingActionRef.current = null
    if (action) action()
  }, [])

  // v1.1.0：未保存对话框 - 取消
  const handleUnsavedDialogCancel = useCallback(() => {
    setShowUnsavedDialog(false)
    pendingActionRef.current = null
  }, [])

  // v1.1.0：关闭窗口（含未保存检查）
  const handleCloseWithCheck = useCallback(() => {
    checkUnsavedAndExecute(() => {
      window.electronAPI.closeWindow()
    })
  }, [checkUnsavedAndExecute])

  // v1.1.0：通过对话框打开文件
  const handleOpenFileViaDialog = useCallback(async () => {
    checkUnsavedAndExecute(async () => {
      const result = await window.electronAPI.openFileDialog()
      if (result) {
        setCurrentNote(null)
        setCurrentNoteId(null)
        setText(result.content)
        // v1.1.0：根据文件后缀名判断格式（md/markdown 为 MD 格式，其他为纯文本）
        const ext = result.fileName.toLowerCase().match(/\.([^.]+)$/)?.[1] || ''
        const isMd = ext === 'md' || ext === 'markdown'
        setEditorFormat(isMd ? 'md' : 'plain')
        // v1.1.0：MD 文件默认浏览模式，其他格式默认编辑模式
        setEditorMode(isMd ? 'preview' : 'code')
        setFileInfo({ filePath: result.filePath, fileName: result.fileName })
        setLastSavedText(result.content)
        window.electronAPI.setWindowFile(result.filePath)
      }
    })
  }, [checkUnsavedAndExecute])

  // v1.1.0：另存为
  const handleSaveAs = useCallback(async () => {
    const suggestedName = fileInfo?.fileName || 'untitled.md'
    const result = await window.electronAPI.saveFileAs(text, suggestedName)
    if (result.success && result.filePath && result.fileName) {
      setFileInfo({ filePath: result.filePath, fileName: result.fileName })
      setLastSavedText(text)
      window.electronAPI.setWindowFile(result.filePath)
      // v1.1.1 修复 Bug 2：另存为成功后也显示 toast 反馈
      setToastMessage(t('editor.saved'))
      safeTimeout(() => { setToastMessage(null) }, 1500)
    } else if (!result.success && result.error !== '用户取消') {
      alert(`另存为失败：${result.error || '未知错误'}`)
    }
  }, [fileInfo, text, t])

  // v1.1.0：关闭文件（退出文件模式，回到笔记模式）
  const handleCloseFile = useCallback(() => {
    checkUnsavedAndExecute(() => {
      setFileInfo(null)
      setLastSavedText('')
      setText('')
      setEditorFormat('plain')
      setEditorMode('code')
      window.electronAPI.setWindowFile(null)
    })
  }, [checkUnsavedAndExecute])

  // v1.1.0：显示关于对话框
  const handleAbout = useCallback(async () => {
    const info = await window.electronAPI.getAppInfo()
    setAppInfo(info)
    setShowAboutDialog(true)
  }, [])

  // v1.1.0：新建（含未保存检查，用于文件菜单和标题栏新建按钮）
  const handleNewWithCheck = useCallback(() => {
    checkUnsavedAndExecute(async () => {
      await handleNew()
      setLastSavedText('')
      window.electronAPI.setWindowFile(null)
    })
  }, [checkUnsavedAndExecute, handleNew])

  // v1.1.0：监听主进程的关闭请求（Alt+F4 / 系统关闭按钮触发）
  // 主进程会拦截 close 事件并通过 IPC 通知渲染进程执行未保存检查
  // v1.1.3 修复 Bug M-2：useEffect cleanup 中移除监听器，避免监听器累积
  //   根因：onRequestClose 内部 ipcRenderer.on() 每次注册新监听器，旧监听器不会被移除。
  //   当 checkUnsavedAndExecute 随 state 变化重建时，useEffect 重新执行注册新监听器，
  //   旧监听器闭包捕获过期 state（如 isFileDirty=true），导致后续触发误弹窗。
  useEffect(() => {
    const removeListener = window.electronAPI.onRequestClose(() => {
      handleCloseWithCheck()
    })
    return () => removeListener()
  }, [handleCloseWithCheck])

  // v1.1.1：监听主进程"在已有窗口加载文件"请求（双击文件复用窗口场景）
  // 主进程 second-instance 事件中，优先复用已有窗口而非创建新窗口
  // v1.1.3 修复 Bug M-2：useEffect cleanup 中移除监听器，避免监听器累积（同上）
  useEffect(() => {
    const removeListener = window.electronAPI.onLoadFileInWindow((filePath: string) => {
      loadFileFromExternal(filePath)
    })
    return () => removeListener()
  }, [loadFileFromExternal])

  // v1.1.1：渲染进程全局错误捕获
  // 捕获 window.onerror 和 unhandledrejection，通过 IPC 转发到主进程写入日志文件
  // 主进程已捕获 uncaughtException/unhandledRejection/renderer-process-gone，这里补充前端错误
  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      const detail = event.error?.stack || event.message || 'Unknown error'
      window.electronAPI.writeErrorLog(`Window Error: ${detail} @ ${event.filename}:${event.lineno}:${event.colno}`)
    }
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error
        ? (event.reason.stack || event.reason.message)
        : String(event.reason)
      window.electronAPI.writeErrorLog(`Unhandled Rejection: ${reason}`)
    }
    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => {
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  // === 拖拽文件打开：v1.1.0 扩展，支持拖拽任意文本文件到编辑器区域打开 ===
  // 后缀名未收录时，由主进程 validateFilePath 检测内容是否为纯文本
  // v1.1.3 修复 Bug 2：统一使用 checkUnsavedAndExecute，确保笔记模式下自动保存当前笔记
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    const file = files[0]
    // Electron 中 File 对象的 path 属性包含文件系统路径
    const filePath = (file as File & { path?: string }).path
    if (!filePath) return
    checkUnsavedAndExecute(async () => {
      const result = await window.electronAPI.openFile(filePath)
      if (result) {
        // 清除笔记关联，避免后续自动保存用文件内容覆盖旧笔记
        setCurrentNote(null)
        setCurrentNoteId(null)
        setText(result.content)
        // v1.1.0：根据文件后缀名判断格式（md/markdown 为 MD 格式，其他为纯文本）
        const ext = result.fileName.toLowerCase().match(/\.([^.]+)$/)?.[1] || ''
        const isMd = ext === 'md' || ext === 'markdown'
        setEditorFormat(isMd ? 'md' : 'plain')
        // v1.1.0：MD 文件默认浏览模式，其他格式默认编辑模式
        setEditorMode(isMd ? 'preview' : 'code')
        setFileInfo({ filePath: result.filePath, fileName: result.fileName })
        // v1.1.0：记录已保存内容 + 同步主进程窗口文件状态
        setLastSavedText(result.content)
        window.electronAPI.setWindowFile(result.filePath)
      }
    })
  }, [checkUnsavedAndExecute])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // 必须 preventDefault 才能触发 drop 事件
    e.preventDefault()
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (matchShortcut(e, newShortcut)) {
      e.preventDefault()
      // v1.1.3 修复 Bug M-4：newShortcut 改走 handleNewWithCheck，统一经过未保存检查
      //   根因：原代码直接调用 handleNew()，绕过 checkUnsavedAndExecute，
      //   文件模式下未保存的修改会被静默丢弃（不弹窗、不保存）。
      handleNewWithCheck()
      return
    }
    if (matchShortcut(e, copyShortcut)) {
      e.preventDefault()
      handleCopy()
      return
    }
    if (e.key === 's' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      // v1.1.3 修复 Bug 3：笔记模式（草稿/收藏）Ctrl+S 保存到笔记数据库，不弹出文件保存框
      // 文件模式 Ctrl+S 保存到原文件
      if (fileInfo) {
        handleSaveToFile()
      } else {
        saveCurrentNote()
        setToastMessage(t('editor.saved'))
        safeTimeout(() => { setToastMessage(null) }, 1500)
      }
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      // MD 快捷标记：仅在代码模式下且焦点在 textarea 时生效
      if (editorMode === 'code' && e.target === textareaRef.current) {
        const lowerKey = e.key.toLowerCase()
        if (lowerKey === 'b') {
          e.preventDefault()
          wrapSelection('**', '**', 'bold')
          return
        }
        if (lowerKey === 'i') {
          e.preventDefault()
          wrapSelection('*', '*', 'italic')
          return
        }
        if (e.key === '`') {
          e.preventDefault()
          wrapSelection('`', '`', 'code')
          return
        }
        if (lowerKey === 'k') {
          e.preventDefault()
          insertLink()
          return
        }
      }
      // 字号快捷键：仅在焦点在 textarea 时生效，避免在设置输入框中误触发
      if (e.target === textareaRef.current) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          adjustFontSize(1)
          return
        }
        if (e.key === '-') {
          e.preventDefault()
          adjustFontSize(-1)
          return
        }
        if (e.key === '0') {
          e.preventDefault()
          setFontSize(14)
          window.electronAPI.setFontSize(14)
          return
        }
      }
    }
    if (e.key === 'Escape') {
      // Escape 行为优化：按优先级关闭浮层，全部关闭后才隐藏窗口
      if (showColorPicker) {
        setShowColorPicker(false)
      } else if (showOutline) {
        setShowOutline(false)
      } else if (noteContextMenu) {
        setNoteContextMenu(null)
      } else if (workspaceContextMenu) {
        setWorkspaceContextMenu(null)
      } else if (showSettings) {
        setShowSettings(false)
      } else if (showNotes) {
        setShowNotes(false)
      } else {
        window.electronAPI.hideWindow()
      }
    }
  }, [showNotes, showSettings, showColorPicker, showOutline, noteContextMenu, workspaceContextMenu, saveCurrentNote, handleNewWithCheck, handleCopy, newShortcut, copyShortcut, adjustFontSize, editorMode, wrapSelection, insertLink, fileInfo, handleSaveToFile, handleSaveAs])

  // 当前笔记的标签徽章（解析 tagId → 名称）
  const currentNoteTags = useMemo(() => {
    if (!currentNote) return []
    return currentNote.tags
      .map(tagId => tags.find(tg => tg.id === tagId))
      .filter((tg): tg is Tag => !!tg)
  }, [currentNote, tags])

  // === MD 渲染 HTML（仅在预览模式下计算） ===
  const renderedHtml = useMemo(() => {
    if (editorMode !== 'preview') return ''
    return renderMarkdown(text)
  }, [editorMode, text])

  // === 大纲：解析 Markdown 标题（h1-h6）用于跳转 ===
  const outlineItems = useMemo(() => {
    if (!text) return []
    const lines = text.split('\n')
    const items: OutlineItem[] = []
    let inCodeBlock = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // 跳过代码块内的内容
      if (line.trimStart().startsWith('```')) {
        inCodeBlock = !inCodeBlock
        continue
      }
      if (inCodeBlock) continue
      const match = line.match(/^(#{1,6})\s+(.+)$/)
      if (match) {
        items.push({
          level: match[1].length,
          text: match[2].trim(),
          line: i
        })
      }
    }
    return items
  }, [text])

  // === 跳转到指定行（大纲点击时调用） ===
  const jumpToLine = useCallback((line: number) => {
    if (editorMode === 'code') {
      const textarea = textareaRef.current
      if (!textarea) return
      const lines = text.split('\n')
      let pos = 0
      for (let i = 0; i < line && i < lines.length; i++) {
        pos += lines[i].length + 1
      }
      textarea.selectionStart = pos
      textarea.selectionEnd = pos
      textarea.focus()
      const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20
      textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 3)
    } else {
      // 预览模式：通过 data-source-line 查找对应元素
      const preview = previewRef.current
      if (!preview) return
      const targetLine = line + 1 // 1-based
      const sourceLineElements = Array.from(preview.querySelectorAll('[data-source-line]'))
      let bestElement: HTMLElement | null = null
      let bestLine = 0
      for (const el of sourceLineElements) {
        const elLine = parseInt(el.getAttribute('data-source-line') || '0', 10)
        if (elLine <= targetLine && elLine >= bestLine) {
          bestLine = elLine
          bestElement = el as HTMLElement
        }
      }
      if (bestElement) {
        const previewRect = preview.getBoundingClientRect()
        const elementRect = bestElement.getBoundingClientRect()
        const offset = elementRect.top - previewRect.top + preview.scrollTop - preview.clientHeight / 3
        preview.scrollTop = Math.max(0, offset)
        bestElement.classList.add('md-highlight-target')
        safeTimeout(() => {
          bestElement?.classList.remove('md-highlight-target')
        }, 3000)
      }
    }
    setShowOutline(false)
  }, [editorMode, text])

  // === 切换编辑器模式（基于 data-source-line 精确行号映射 + 高亮标识） ===
  const toggleEditorMode = useCallback(() => {
    debugLog(`mode-toggle START: editorMode=${editorMode} text.length=${text.length}`)
    if (editorMode === 'code') {
      // 代码 → 预览：记录光标行号，通过 data-source-line 精确定位预览元素
      const textarea = textareaRef.current
      let targetLine = 0

      if (textarea) {
        const pos = textarea.selectionStart
        const linesBefore = textarea.value.slice(0, pos).split('\n').length - 1
        cursorLineRef.current = linesBefore
        targetLine = linesBefore + 1 // data-source-line 是 1-based
      }

      setEditorMode('preview')
      setHighlightLine(targetLine)

      safeTimeout(() => {
        const preview = previewRef.current
        if (!preview) {
          debugLog(`mode-toggle code→preview DONE: preview is null!`)
          return
        }

        // 通过 data-source-line 属性精确查找对应的预览元素
        const sourceLineElements = Array.from(preview.querySelectorAll('[data-source-line]'))
        let bestElement: HTMLElement | null = null
        let bestLine = 0

        for (const el of sourceLineElements) {
          const line = parseInt(el.getAttribute('data-source-line') || '0', 10)
          // 找到不超过 targetLine 的最大行号元素
          if (line <= targetLine && line >= bestLine) {
            bestLine = line
            bestElement = el as HTMLElement
          }
        }

        if (bestElement) {
          // 滚动到对应元素，使其在视口上方 1/3 处
          const previewRect = preview.getBoundingClientRect()
          const elementRect = bestElement.getBoundingClientRect()
          const offset = elementRect.top - previewRect.top + preview.scrollTop - preview.clientHeight / 3
          preview.scrollTop = Math.max(0, offset)

          // 高亮该元素
          bestElement.classList.add('md-highlight-target')
          debugLog(`mode-toggle code→preview DONE: found element data-source-line=${bestLine} targetLine=${targetLine}`)
        } else {
          // 没找到对应元素，回退到比例方案
          const totalLines = text.split('\n').length
          const ratio = totalLines > 1 ? (targetLine - 1) / (totalLines - 1) : 0
          if (preview.scrollHeight > preview.clientHeight) {
            preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight)
          }
          debugLog(`mode-toggle code→preview DONE: no element found, fallback to ratio=${ratio.toFixed(3)}`)
        }

        // 3秒后清除高亮
        safeTimeout(() => {
          setHighlightLine(-1)
          setHighlightBandY(-1)
          // 清除所有高亮类
          preview.querySelectorAll('.md-highlight-target').forEach(el => {
            el.classList.remove('md-highlight-target')
          })
        }, 3000)
      }, 200)
    } else {
      // 预览 → 代码：通过视口 1/3 处的 data-source-line 元素获取对应行号
      // 使用 1/3 处而非中心，与编辑→预览的滚动目标（视口 1/3 处）对称，保证双向切换定位一致
      const preview = previewRef.current
      let targetLine = cursorLineRef.current

      if (preview) {
        // 遍历所有 data-source-line 元素，找到视口 1/3 处对应的行号
        // 不使用 elementFromPoint（返回的元素起始行号可能偏上），而是精确计算
        const previewRect = preview.getBoundingClientRect()
        const referenceY = previewRect.top + preview.clientHeight / 3
        const sourceLineElements = Array.from(preview.querySelectorAll('[data-source-line]'))

        let targetLineFromPreview = 0
        let minDistance = Infinity

        for (const el of sourceLineElements) {
          const elRect = (el as HTMLElement).getBoundingClientRect()
          const elCenterY = elRect.top + elRect.height / 2
          const distance = Math.abs(elCenterY - referenceY)
          if (distance < minDistance) {
            minDistance = distance
            const line = parseInt(el.getAttribute('data-source-line') || '0', 10)
            if (line > 0) {
              targetLineFromPreview = line - 1 // 转回 0-based
            }
          }
        }

        if (targetLineFromPreview > 0) {
          targetLine = targetLineFromPreview
          cursorLineRef.current = targetLine
          debugLog(`mode-toggle preview→code: found 1/3 element line=${targetLineFromPreview + 1}`)
        } else {
          // 回退到比例方案：使用 1/3 处而非中心
          if (preview.scrollHeight > preview.clientHeight) {
            const refScroll = preview.scrollTop + preview.clientHeight / 3
            const ratio = refScroll / preview.scrollHeight
            const totalLines = text.split('\n').length
            targetLine = Math.round(ratio * (totalLines - 1))
            cursorLineRef.current = targetLine
          }
          debugLog(`mode-toggle preview→code: no element found, fallback to ratio`)
        }
      }

      setEditorMode('code')
      setHighlightBandY(-1)
      setEditorHighlightY(-1)

      safeTimeout(() => {
        const textarea = textareaRef.current
        if (!textarea) {
          debugLog(`mode-toggle preview→code DONE: textarea is null!`)
          return
        }

        // 将光标定位到对应行
        const lines = text.split('\n')
        let pos = 0
        for (let i = 0; i < targetLine && i < lines.length; i++) {
          pos += lines[i].length + 1
        }
        textarea.selectionStart = pos
        textarea.selectionEnd = pos
        textarea.focus()

        // 确保光标行可见
        const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20
        const desiredScroll = targetLine * lineHeight - textarea.clientHeight / 2
        textarea.scrollTop = Math.max(0, desiredScroll)

        // 计算目标行在编辑器容器中的 Y 坐标，用于行级高亮 overlay
        // 行 Y = padding-top + targetLine * lineHeight - scrollTop
        const paddingTop = parseFloat(getComputedStyle(textarea).paddingTop) || 24
        const lineY = paddingTop + targetLine * lineHeight - textarea.scrollTop
        setEditorHighlightY(lineY)
        // 保存高亮信息到 ref，供 scroll 时动态更新位置（使高亮条跟随内容滚动）
        editorHighlightInfoRef.current = { line: targetLine, lineHeight, paddingTop }

        debugLog(`mode-toggle preview→code DONE: targetLine=${targetLine} pos=${pos} lineHeight=${lineHeight} highlightY=${lineY}`)
        // 3秒后清除高亮（与预览模式高亮时长一致）
        safeTimeout(() => {
          setEditorHighlightY(-1)
          editorHighlightInfoRef.current = null
          setHighlightLine(-1)
        }, 3000)
      }, 200)
    }
  }, [editorMode, text])

  return (
    <div className="app" onKeyDown={handleKeyDown}>
      {/* Titlebar */}
      <div className="titlebar">
        <div className="titlebar-left">
          {/* v1.1.0：文件菜单按钮 */}
          <div className="file-menu-wrap">
            <button
              className={`btn btn-file ${showFileMenu ? 'active' : ''}`}
              onClick={() => setShowFileMenu(!showFileMenu)}
              title={t('titlebar.file', '文件')}
              aria-label={t('titlebar.file', '文件')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </button>
            {showFileMenu && (
              <>
                {createPortal(
                  <div className="popover-backdrop" onClick={() => setShowFileMenu(false)} />,
                  document.body
                )}
                <div className="file-menu">
                  <button className="context-menu-item" onClick={() => { setShowFileMenu(false); handleNewWithCheck() }}>
                    {t('titlebar.fileNew', '新建')}
                  </button>
                  <button className="context-menu-item" onClick={() => { setShowFileMenu(false); handleOpenFileViaDialog() }}>
                    {t('titlebar.fileOpen', '打开...')}
                  </button>
                  <button className="context-menu-item" onClick={() => { setShowFileMenu(false); handleSaveToFile() }} disabled={!fileInfo}>
                    {t('titlebar.fileSave', '保存')}
                  </button>
                  <button className="context-menu-item" onClick={() => { setShowFileMenu(false); handleSaveAs() }}>
                    {t('titlebar.fileSaveAs', '另存为...')}
                  </button>
                  {fileInfo && (
                    <button className="context-menu-item" onClick={() => { setShowFileMenu(false); handleCloseFile() }}>
                      {t('titlebar.fileClose', '关闭文件')}
                    </button>
                  )}
                  <div className="context-menu-separator" />
                  <button className="context-menu-item" onClick={() => { setShowFileMenu(false); handleAbout() }}>
                    {t('titlebar.about', '关于 {{name}}', { name: 'OncePad' })}
                  </button>
                </div>
              </>
            )}
          </div>
          {/* 收藏按钮（可根据设置隐藏） */}
          {navbarButtons.pin && (
          <button
            className={`btn btn-pin ${currentNote?.type === 'pin' ? 'pinned' : ''}`}
            onClick={togglePin}
            title={currentNote?.type === 'pin' ? t('editor.unpin') : t('editor.pin')}
          >
            {currentNote?.type === 'pin' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            )}
          </button>
          )}
          {/* 颜色标记按钮（可根据设置隐藏） */}
          {navbarButtons.color && (
          <div className="color-picker-wrap">
            <button
              className="btn btn-color"
              onClick={() => setShowColorPicker(!showColorPicker)}
              title={t('editor.color')}
              aria-label={t('editor.color')}
            >
              {currentNote && currentNote.color !== 'default' ? (
                <span className="color-dot" style={{ background: COLOR_HEX[currentNote.color] }} />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" />
                  <circle cx="12" cy="7.5" r="1.2" fill="currentColor" />
                  <circle cx="16.5" cy="10.5" r="1.2" fill="currentColor" />
                </svg>
              )}
            </button>
            {showColorPicker && (
              <>
                <div className="popover-backdrop" onClick={() => setShowColorPicker(false)} />
                <div className="color-picker">
                  {NOTE_COLORS.map(c => (
                    <button
                      key={c}
                      className={`color-swatch ${c}`}
                      style={c === 'default' ? undefined : { background: COLOR_HEX[c] }}
                      onClick={() => changeColor(c)}
                      title={t(`color.${c}`)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          )}
        </div>
        <span className="titlebar-text">{fileInfo ? fileInfo.fileName : t('titlebar.title')}</span>
        <div className="titlebar-buttons">
          {navbarButtons.newBtn && (
          <button
            className="btn btn-new"
            onClick={handleNewWithCheck}
            title={newShortcut ? t('titlebar.newWithShortcut', { shortcut: formatShortcut(newShortcut) }) : t('titlebar.new')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </button>
          )}
          {navbarButtons.copy && (
          <button
            className={`btn btn-copy ${copyFeedback ? 'copied' : ''}`}
            onClick={handleCopy}
            title={copyShortcut ? t('titlebar.copyWithShortcut', { shortcut: formatShortcut(copyShortcut) }) : t('titlebar.copy')}
          >
            {copyFeedback ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          )}
          {navbarButtons.notes && (
          <button
            className={`btn btn-notes ${showNotes ? 'active' : ''}`}
            onClick={() => { setShowNotes(!showNotes); setShowSettings(false) }}
            title={t('titlebar.notes')}
            aria-label={t('titlebar.notes')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="8" y1="13" x2="16" y2="13" />
              <line x1="8" y1="17" x2="13" y2="17" />
            </svg>
          </button>
          )}
          {/* 设置按钮禁止隐藏（防止用户隐藏后无法打开设置面板恢复） */}
          <button
            className={`btn btn-settings ${showSettings ? 'active' : ''}`}
            onClick={() => { setShowSettings(!showSettings); setShowNotes(false) }}
            title={t('titlebar.settings')}
            aria-label={t('titlebar.settings')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            className="btn btn-theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={t('titlebar.toggleTheme')}
            aria-label={t('titlebar.toggleTheme')}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          {/* 关闭窗口按钮：手动关闭当前窗口（支持多窗口场景） */}
          <button
            className="btn btn-close-window"
            onClick={handleCloseWithCheck}
            title={t('titlebar.close', '关闭')}
            aria-label={t('titlebar.close', '关闭')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="main-area" style={{ zoom: mainAreaZoom }}>
        {(showSettings || showNotes) && (
          <div className="panel-backdrop" onClick={() => { setShowSettings(false); setShowNotes(false) }} />
        )}

        {/* 编辑器区域 — 拆分为独立组件 EditorArea，所有 state/handlers 通过 props 传入 */}
        <EditorArea
          textareaRef={textareaRef}
          previewRef={previewRef}
          text={text}
          editorMode={editorMode}
          editorFormat={editorFormat}
          hasMarkdownSyntax={hasMarkdownSyntax}
          renderedHtml={renderedHtml}
          indentSize={indentSize}
          highlightBandY={highlightBandY}
          editorHighlightY={editorHighlightY}
          outlineItems={outlineItems}
          showOutline={showOutline}
          onTextChange={setText}
          onToggleOutline={() => setShowOutline(!showOutline)}
          onCloseOutline={() => setShowOutline(false)}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onTabKey={handleTabKey}
          onWheel={handleWheel}
          onEditorScroll={handleEditorScroll}
          onUpdateCursorLine={updateCursorLine}
          onToggleEditorMode={toggleEditorMode}
          onJumpToLine={jumpToLine}
          toastMessage={toastMessage}
          showLineNumbers={showLineNumbers}
          lineNumberMode={lineNumberMode}
          showMinimap={showMinimap}
          enableSequenceSuggestion={enableSequenceSuggestion}
          seqAcceptOnTab={seqAcceptOnTab}
          seqAcceptOnEnter={seqAcceptOnEnter}
          debugMode={debugMode}
        />

        {/* 笔记面板 — 拆分为独立组件 NotesPanel，所有 state/handlers 通过 props 传入 */}
        {showNotes && (
          <NotesPanel
            workspaces={workspaces}
            selectedWorkspaceId={selectedWorkspaceId}
            onSelectWorkspace={setSelectedWorkspaceId}
            showNewWorkspace={showNewWorkspace}
            onToggleNewWorkspace={() => setShowNewWorkspace(!showNewWorkspace)}
            newWorkspaceName={newWorkspaceName}
            newWorkspaceIcon={newWorkspaceIcon}
            onNewWorkspaceNameChange={setNewWorkspaceName}
            onNewWorkspaceIconChange={setNewWorkspaceIcon}
            onCreateWorkspace={handleCreateWorkspace}
            onWorkspaceContextMenu={handleWorkspaceContextMenu}
            workspaceContextMenu={workspaceContextMenu}
            onCloseWorkspaceContextMenu={() => setWorkspaceContextMenu(null)}
            onDeleteWorkspace={handleDeleteWorkspace}
            showTrashView={showTrashView}
            onToggleTrash={handleToggleTrash}
            noteContextMenu={noteContextMenu}
            onCloseNoteContextMenu={() => setNoteContextMenu(null)}
            onTogglePinFromMenu={handleTogglePinFromMenu}
            onDeleteNoteFromMenu={handleDeleteNoteFromMenu}
            notes={notes}
            searchKeyword={searchKeyword}
            onSearchChange={handleSearchChange}
            sortBy={sortBy}
            onSortChange={setSortBy}
            noteFilter={noteFilter}
            onNoteFilterChange={setNoteFilter}
            currentNoteId={currentNoteId}
            onSelectNote={handleSelectNote}
            onNoteContextMenu={handleNoteContextMenu}
            onNoteListKeyDown={handleNoteListKeyDown}
            onDeleteNote={handleDeleteNote}
            onClearAllDrafts={handleClearAllDrafts}
            onMoveNoteToWorkspace={handleMoveNoteToWorkspace}
            tags={tags}
            filterTagId={filterTagId}
            onFilterTagChange={setFilterTagId}
            trashNotes={trashNotes}
            onRestoreNote={handleRestoreNote}
            onPermanentDelete={handlePermanentDelete}
            onEmptyTrash={handleEmptyTrash}
            currentNote={currentNote}
            currentNoteTags={currentNoteTags}
            tagInput={tagInput}
            showTagSuggest={showTagSuggest}
            tagSuggestions={tagSuggestions}
            onTagInputChange={setTagInput}
            onTagInputFocus={() => setShowTagSuggest(true)}
            onTagInputBlur={handleTagInputBlur}
            onTagInputKeyDown={handleTagInputKeyDown}
            onAddTag={addTag}
            onRemoveTag={removeTag}
          />
        )}

        {/* Settings panel — 拆分为独立组件 SettingsPanel，所有 state/handlers 通过 props 传入 */}
        {showSettings && (
          <SettingsPanel
            activeTab={settingsTab}
            onTabChange={setSettingsTab}
            language={language}
            onLanguageChange={handleLanguageChange}
            alwaysOnTop={alwaysOnTop}
            onAlwaysOnTopChange={handleAlwaysOnTopChange}
            closeLastWindowBehavior={closeLastWindowBehavior}
            onCloseLastWindowBehaviorChange={handleCloseLastWindowBehaviorChange}
            draftTtlDays={draftTtlDays}
            onDraftTtlDaysChange={handleDraftTtlDaysChange}
            autoLaunch={autoLaunch}
            autoLaunchHidden={autoLaunchHidden}
            onAutoLaunchChange={handleAutoLaunchChange}
            onAutoLaunchHiddenChange={handleAutoLaunchHiddenChange}
            blurToHide={blurToHide}
            onBlurToHideChange={handleBlurToHideChange}
            showLineNumbers={showLineNumbers}
            onShowLineNumbersChange={handleShowLineNumbersChange}
            lineNumberMode={lineNumberMode}
            onLineNumberModeChange={handleLineNumberModeChange}
            editorLineHeight={editorLineHeight}
            editorPadding={editorPadding}
            onEditorLineHeightChange={handleEditorLineHeightChange}
            onEditorPaddingChange={handleEditorPaddingChange}
            showMinimap={showMinimap}
            onShowMinimapChange={handleShowMinimapChange}
            theme={theme}
            onThemeChange={setTheme}
            indentType={indentType}
            indentSize={indentSize}
            onIndentTypeChange={handleIndentTypeChange}
            onIndentSizeChange={handleIndentSizeChange}
            fontEn={fontEn}
            fontCn={fontCn}
            fontSize={fontSize}
            fontSplit={fontSplit}
            systemFonts={systemFonts}
            uiScale={uiScale}
            uiScalePreview={uiScalePreview}
            onFontEnChange={handleFontEnChange}
            onFontCnChange={handleFontCnChange}
            onFontSizeChange={handleFontSizeChange}
            onFontSplitChange={handleFontSplitChange}
            onUiScaleChange={handleUiScaleChange}
            onApplyUiScale={applyUiScale}
            navbarButtons={navbarButtons}
            onNavbarButtonChange={handleNavbarButtonChange}
            toggleShortcut={toggleShortcut}
            toggleShortcutInput={toggleShortcutInput}
            newShortcut={newShortcut}
            newShortcutInput={newShortcutInput}
            copyShortcut={copyShortcut}
            copyShortcutInput={copyShortcutInput}
            recordingTarget={recordingTarget}
            onSetRecordingTarget={setRecordingTarget}
            onShortcutKeyDown={handleShortcutKeyDown}
            onSaveToggleShortcut={handleSaveToggleShortcut}
            onSaveNewShortcut={handleSaveNewShortcut}
            onSaveCopyShortcut={handleSaveCopyShortcut}
            onResetToggleShortcut={handleResetToggleShortcut}
            onResetNewShortcut={handleResetNewShortcut}
            onResetCopyShortcut={handleResetCopyShortcut}
            onClearToggleShortcut={handleClearToggleShortcut}
            onClearNewShortcut={handleClearNewShortcut}
            onClearCopyShortcut={handleClearCopyShortcut}
            debugMode={debugMode}
            debugLogs={debugLogs}
            onDebugModeChange={handleDebugModeChange}
            onClearDebugLogs={handleClearDebugLogs}
            showDebugTab={showDebugTab}
            onShowDebugTabChange={handleShowDebugTabChange}
            enableSequenceSuggestion={enableSequenceSuggestion}
            onEnableSequenceSuggestionChange={handleEnableSequenceSuggestionChange}
            seqAcceptOnTab={seqAcceptOnTab}
            seqAcceptOnEnter={seqAcceptOnEnter}
            onSeqAcceptModeChange={handleSeqAcceptModeChange}
            workspaces={workspaces}
            tags={tags}
            defaultWorkspaceId={defaultWorkspaceId}
            onRenameWorkspace={handleRenameWorkspace}
            onUpdateWorkspaceIcon={handleUpdateWorkspaceIcon}
            onDeleteWorkspace={handleDeleteWorkspace}
            onSetDefaultWorkspace={handleSetDefaultWorkspace}
            onRenameTag={handleRenameTag}
            onUpdateTagColor={handleUpdateTagColor}
            onDeleteTag={handleDeleteTagFromSettings}
          />
        )}
      </div>

      {/* v1.1.0：关于对话框 */}
      {showAboutDialog && appInfo && createPortal(
        <>
          <div className="popover-backdrop" onClick={() => setShowAboutDialog(false)} />
          <div className="about-dialog">
            <div className="about-dialog-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="13" y2="17" />
              </svg>
            </div>
            <h2 className="about-dialog-title">OncePad</h2>
            <p className="about-dialog-version">v{appInfo.version}</p>
            <p className="about-dialog-desc">{t('about.description', '一款轻量级随叫随到的临时笔记本')}</p>
            <div className="about-dialog-info">
              <div className="about-info-row"><span>Electron</span><span>{appInfo.electron}</span></div>
              <div className="about-info-row"><span>Chrome</span><span>{appInfo.chrome}</span></div>
              <div className="about-info-row"><span>Node.js</span><span>{appInfo.node}</span></div>
              <div className="about-info-row"><span>Platform</span><span>{appInfo.platform} {appInfo.arch}</span></div>
            </div>
            <p className="about-dialog-license">
              GPL-3.0 ·{' '}
              <a
                href="https://github.com/MagicalYuYu/OncePad"
                onClick={(e) => {
                  e.preventDefault()
                  window.electronAPI.openExternal('https://github.com/MagicalYuYu/OncePad')
                }}
                style={{ color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer' }}
              >
                GitHub: MagicalYuYu/OncePad
              </a>
            </p>
            <button className="about-dialog-close" onClick={() => setShowAboutDialog(false)}>
              {t('about.close', '关闭')}
            </button>
          </div>
        </>,
        document.body
      )}

      {/* v1.1.0：未保存修改对话框 */}
      {showUnsavedDialog && createPortal(
        <>
          <div className="popover-backdrop" />
          <div className="unsaved-dialog">
            <p className="unsaved-dialog-message">
              {fileInfo
                ? t('unsaved.messageFile', '文件 "{{fileName}}" 已修改但未保存，是否保存？', { fileName: fileInfo.fileName })
                : t('unsaved.message', '文件内容已修改但未保存，是否保存？')}
            </p>
            <div className="unsaved-dialog-buttons">
              <button className="unsaved-btn-save" onClick={handleUnsavedDialogSave}>
                {t('unsaved.save', '保存')}
              </button>
              <button className="unsaved-btn-discard" onClick={handleUnsavedDialogDiscard}>
                {t('unsaved.discard', '不保存')}
              </button>
              <button className="unsaved-btn-cancel" onClick={handleUnsavedDialogCancel}>
                {t('unsaved.cancel', '取消')}
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

export default App
