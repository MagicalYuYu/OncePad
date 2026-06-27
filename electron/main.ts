import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, dialog, Menu, Tray, nativeImage, screen, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import fontList from 'font-list'

process.env.DIST = path.join(__dirname, '../dist-renderer')

// ===== 多窗口管理器（Task 12-13 新增） =====
// 窗口集合：以 BrowserWindow.id 为键
const windows = new Map<number, BrowserWindow>()
// 托盘实例：全局持有，避免被垃圾回收导致托盘消失
let tray: Tray | null = null
// 每个窗口对应的编辑器文本（替代原全局 currentText）
const windowTexts = new Map<number, string>()
// 每个窗口加载的文件路径（通过双击 .md 文件打开的窗口才有值）
const windowFiles = new Map<number, string>()
// v1.1.0：强制关闭标记（用户确认未保存对话框后，跳过未保存检查直接关闭）
const forceClose = new Set<number>()

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

// v1.1.0：支持 --user-data-dir 命令行参数，用于测试版与日常版数据隔离
// 用法：OncePad.exe --user-data-dir=D:\test-data 或 --user-data-dir D:\test-data
// 必须在 app.getPath('userData') 首次调用前设置，否则路径不会生效
const customUserDataDir = app.commandLine.getSwitchValue('user-data-dir')
if (customUserDataDir) {
  app.setPath('userData', customUserDataDir)
} else if (VITE_DEV_SERVER_URL) {
  // v1.1.0 修复：dev 模式自动使用独立 userData 路径，避免与打包版单实例锁冲突
  // 问题根因：requestSingleInstanceLock() 基于 userData 路径创建锁，
  //   打包版和 dev 模式使用相同默认路径时，dev 进程会因获取锁失败而退出。
  // 解决方案：dev 模式自动切换到 OncePad-Dev 路径，实现数据隔离 + 锁隔离。
  // app.getPath('appData') 返回系统级路径（不依赖 userData），此处调用安全。
  const devUserDataPath = path.join(app.getPath('appData'), 'OncePad-Dev')
  app.setPath('userData', devUserDataPath)
}

// Config and history file paths
const configPath = path.join(app.getPath('userData'), 'config.json')
const historyPath = path.join(app.getPath('userData'), 'history.json')

// ===== 笔记存储路径（Task 1 新增） =====
const notesDir = path.join(app.getPath('userData'), 'notes')
const indexPath = path.join(notesDir, 'index.json')
const workspacesPath = path.join(app.getPath('userData'), 'workspaces.json')
const tagsPath = path.join(app.getPath('userData'), 'tags.json')
// ===== 回收站路径（回收站机制新增） =====
const trashDir = path.join(app.getPath('userData'), 'trash')
const trashIndexPath = path.join(trashDir, 'index.json')
// 回收站自动清理时间：24 小时
const TRASH_TTL_MS = 24 * 60 * 60 * 1000

// ===== v1.1.1 异常日志系统 =====
// 日志存储目录：%APPDATA%\OncePad\logs\
// 日志文件命名：oncepad-YYYY-MM-DD.log（按天分割，便于排查）
// 捕获范围：主进程未捕获异常 / Promise 未处理拒绝 / 渲染进程崩溃 / GPU 崩溃 / 渲染进程前端错误
const logsDir = path.join(app.getPath('userData'), 'logs')

/**
 * 获取当前日期的日志文件路径（按天分割）
 */
function getCurrentLogFile(): string {
  const today = new Date().toISOString().slice(0, 10)
  return path.join(logsDir, `oncepad-${today}.log`)
}

/**
 * 写入错误日志（同步写入，避免日志丢失）
 * 日志格式：[ISO 时间戳] [级别] 消息
 * 安全策略：写入失败时仅 console.error，不再抛出异常（避免递归崩溃）
 */
function writeErrorLog(level: string, message: string): void {
  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }
    const ts = new Date().toISOString()
    const logLine = `[${ts}] [${level}] ${message}\n`
    fs.appendFileSync(getCurrentLogFile(), logLine)
    // 同时输出到控制台，便于 dev 模式调试
    console.error(logLine)
  } catch (err) {
    // 日志写入失败时仅 console.error，避免递归崩溃
    console.error('Failed to write error log:', err)
  }
}

const defaultMod = 'Control'
// v1.1.0：默认快捷键调整为 Alt+Q（单手可触），新建/复制默认为空（用户按需配置）
const defaultShortcut = 'Alt+Q'
const defaultNewShortcut = ''
const defaultCopyShortcut = ''

const shortcutValidator = /^(Command|Control|Alt|Shift|Meta|Super)(\+(Command|Control|Alt|Shift|Meta|Super))*\+[A-Za-z0-9]$/

interface Config {
  shortcut: string
  newShortcut: string
  copyShortcut: string
  alwaysOnTop: boolean
  indentType: 'space' | 'tab'
  indentSize: number
  fontEn: string
  fontCn: string
  fontSize: number
  fontSplit: boolean
  uiScale: number
  language: string
  // 窗口尺寸/位置记忆（用户调整后持久化，下次启动恢复）
  windowBounds?: { x: number; y: number; width: number; height: number }
  // 关闭最后一个窗口时的行为：hide=隐藏到托盘（默认），confirm=弹窗确认退出，quit=直接退出
  closeLastWindowBehavior?: 'hide' | 'confirm' | 'quit'
  // 草稿自动清理时长（天）：1/2/3/7，默认 3 天
  draftTtlDays?: number
  // 开机自启：默认关闭，用户勾选后系统开机时自动启动
  autoLaunch?: boolean
  // 开机自启后隐藏到后台：仅当 autoLaunch=true 时生效，启动后不显示窗口
  autoLaunchHidden?: boolean
  // 失焦自动隐藏：窗口失去焦点时自动隐藏到托盘（可配置，默认关闭）
  blurToHide?: boolean
  // 默认新建笔记工作区 ID（空字符串=默认工作区，新建笔记自动归入此工作区）
  defaultWorkspaceId?: string
  // 行号显示：在编辑区最左侧显示行号（默认关闭，方便代码类文件阅读）
  showLineNumbers?: boolean
  // 行号模式：logical=逻辑行号（按换行符分割，不回车算同行，适合代码），visual=视觉行号（软换行后每行都编号，适合阅读）
  lineNumberMode?: 'logical' | 'visual'
  // 编辑器行高：默认 1.7，范围 1.2-2.4
  editorLineHeight?: number
  // 编辑器内边距（px）：默认 24，范围 8-48
  editorPadding?: number
  // 缩略图（minimap）：在编辑区右侧显示文档缩略图，支持快速跳转（默认关闭）
  showMinimap?: boolean
  // 导航栏按钮显示/隐藏配置：用户可自定义导航栏上哪些按钮可见
  // 所有按钮默认显示，用户可在设置面板"外观"中关闭不需要的按钮
  navbarButtons?: {
    pin: boolean      // 收藏按钮
    color: boolean    // 颜色标记按钮
    newBtn: boolean   // 新建按钮
    copy: boolean     // 复制按钮
    notes: boolean    // 笔记列表按钮
    settings: boolean // 设置按钮
  }
  // v1.1.0：是否显示调试面板（默认 false，用户在管理标签页启用）
  showDebugTab?: boolean
  // v1.1.0：序号补全开关（VS Code 风格 inline suggestion，默认 false，用户手动开启）
  enableSequenceSuggestion?: boolean
  // v1.1.0：序号补全接受方式（方案 B：仅 Tab/Enter，移除"继续输入即接受"）
  // Tab 键接受建议
  seqAcceptOnTab?: boolean
  // Enter 键接受建议（注意：启用后双回车退出列表行为将改变）
  seqAcceptOnEnter?: boolean
}

interface HistoryEntry {
  id: string
  text: string
  createdAt: string
}

// ===== 笔记存储相关类型（Task 1 新增，与 types.d.ts 保持一致） =====
type NoteColor = 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'
type NoteType = 'draft' | 'pin'
type NoteFormat = 'plain' | 'md'

interface Note {
  id: string              // UUID v4
  title: string           // 自动截取首行，可手动修改
  content: string         // 正文内容
  type: NoteType          // 草稿 / 收藏
  tags: string[]          // 标签 ID 数组
  color: NoteColor        // 颜色标记
  workspace: string       // 所属工作区 ID（空字符串=默认区）
  createdAt: string       // ISO 8601
  updatedAt: string       // ISO 8601
  expiresAt: string | null // 草稿=创建时间+3天，收藏=null
  format: NoteFormat      // 纯文本 / Markdown
}

interface NoteIndexEntry {
  id: string
  title: string
  type: NoteType
  color: NoteColor
  tags: string[]
  workspace: string
  updatedAt: string
  expiresAt: string | null
}

// ===== 回收站条目类型（回收站机制新增） =====
// 笔记删除后移入回收站，保留 24 小时，过期后自动永久删除
interface TrashNoteEntry {
  id: string              // 原笔记 ID
  title: string
  type: NoteType
  color: NoteColor
  tags: string[]
  workspace: string
  format: NoteFormat
  deletedAt: string       // 删除时间（ISO 8601）
  expiresAt: string       // 回收站过期时间（deletedAt + 24h）
}

interface Workspace {
  id: string
  name: string
  icon: string            // emoji 图标
  createdAt: string
}

interface Tag {
  id: string
  name: string
  color: string
  usageCount: number
}

interface NoteQuery {
  workspaceId?: string
  type?: NoteType
  tagId?: string
  searchKeyword?: string
}

function loadConfig(): Config {
  try {
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      // v1.1.0 迁移：旧默认 Control+J → 新默认 Alt+Q
      const migratedShortcut = saved.shortcut === `${defaultMod}+J` ? defaultShortcut : (saved.shortcut || defaultShortcut)
      return {
        shortcut: migratedShortcut,
        newShortcut: typeof saved.newShortcut === 'string' && saved.newShortcut === ''
          ? '' // 空字符串允许（v1.1.0 新建/复制默认为空）
          : (typeof saved.newShortcut === 'string' && shortcutValidator.test(saved.newShortcut)
            ? saved.newShortcut
            : defaultNewShortcut),
        copyShortcut: typeof saved.copyShortcut === 'string' && saved.copyShortcut === ''
          ? '' // 空字符串允许（v1.1.0 新建/复制默认为空）
          : (typeof saved.copyShortcut === 'string' && shortcutValidator.test(saved.copyShortcut)
            ? saved.copyShortcut
            : defaultCopyShortcut),
        alwaysOnTop: saved.alwaysOnTop === true,
        indentType: saved.indentType === 'tab' ? 'tab' : 'space',
        indentSize: [2, 4, 6, 8].includes(Number(saved.indentSize)) ? Number(saved.indentSize) : 2,
        fontEn: typeof saved.fontEn === 'string' && saved.fontEn ? saved.fontEn : 'SF Mono',
        fontCn: typeof saved.fontCn === 'string' && saved.fontCn ? saved.fontCn : 'Microsoft YaHei',
        fontSize: Number.isFinite(Number(saved.fontSize)) && Number(saved.fontSize) >= 12 && Number(saved.fontSize) <= 24
          ? Number(saved.fontSize)
          : 14,
        fontSplit: saved.fontSplit === true,
        uiScale: Number.isFinite(Number(saved.uiScale)) && Number(saved.uiScale) >= 80 && Number(saved.uiScale) <= 200
          ? Number(saved.uiScale)
          : 100,
        language: typeof saved.language === 'string' && ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'pt-BR', 'ru', 'it'].includes(saved.language) ? saved.language : 'zh-CN',
        windowBounds: saved.windowBounds && typeof saved.windowBounds === 'object'
          && Number.isFinite(saved.windowBounds.width) && saved.windowBounds.width >= 300
          && Number.isFinite(saved.windowBounds.height) && saved.windowBounds.height >= 200
          ? { x: saved.windowBounds.x, y: saved.windowBounds.y, width: saved.windowBounds.width, height: saved.windowBounds.height }
          : undefined,
        closeLastWindowBehavior: ['hide', 'confirm', 'quit'].includes(saved.closeLastWindowBehavior)
          ? saved.closeLastWindowBehavior
          : 'hide',
        draftTtlDays: [1, 2, 3, 7].includes(Number(saved.draftTtlDays)) ? Number(saved.draftTtlDays) : 3,
        autoLaunch: saved.autoLaunch === true,
        autoLaunchHidden: saved.autoLaunchHidden === true,
        // 修复：必须显式加载 blurToHide 字段，否则 newWin.on('blur') 读取时始终为 undefined
        blurToHide: saved.blurToHide === true,
        // 修复：必须显式加载 defaultWorkspaceId 字段，否则新建笔记时无法使用默认工作区
        defaultWorkspaceId: typeof saved.defaultWorkspaceId === 'string' ? saved.defaultWorkspaceId : '',
        // 行号显示：从配置加载，默认关闭
        showLineNumbers: saved.showLineNumbers === true,
        // 行号模式：默认 logical（逻辑行号），适合代码编辑
        lineNumberMode: saved.lineNumberMode === 'visual' ? 'visual' : 'logical',
        // 编辑器行高：默认 1.7，范围 1.2-2.4
        editorLineHeight: Number.isFinite(Number(saved.editorLineHeight)) && Number(saved.editorLineHeight) >= 1.2 && Number(saved.editorLineHeight) <= 2.4
          ? Number(saved.editorLineHeight)
          : 1.7,
        // 编辑器内边距：默认 24，范围 8-48
        editorPadding: Number.isFinite(Number(saved.editorPadding)) && Number(saved.editorPadding) >= 8 && Number(saved.editorPadding) <= 48
          ? Number(saved.editorPadding)
          : 24,
        // 缩略图（minimap）开关
        showMinimap: saved.showMinimap === true,
        // 导航栏按钮显示/隐藏配置（兼容旧配置，缺失字段默认 true）
        navbarButtons: {
          pin: saved.navbarButtons?.pin !== false,
          color: saved.navbarButtons?.color !== false,
          newBtn: saved.navbarButtons?.newBtn !== false,
          copy: saved.navbarButtons?.copy !== false,
          notes: saved.navbarButtons?.notes !== false,
          settings: saved.navbarButtons?.settings !== false,
        },
        // v1.1.0：调试面板开关（默认 false）
        showDebugTab: saved.showDebugTab === true,
        // v1.1.0：序号补全开关（默认 false，用户手动开启）
        enableSequenceSuggestion: saved.enableSequenceSuggestion === true,
        // v1.1.0：序号补全接受方式（方案 B：仅 Tab/Enter，移除"继续输入即接受"）
        seqAcceptOnTab: saved.seqAcceptOnTab !== false,
        seqAcceptOnEnter: saved.seqAcceptOnEnter === true,
      }
    }
  } catch {}
  return {
    shortcut: defaultShortcut,
    newShortcut: defaultNewShortcut,
    copyShortcut: defaultCopyShortcut,
    alwaysOnTop: false,
    indentType: 'space',
    indentSize: 2,
    fontEn: 'SF Mono',
    fontCn: 'Microsoft YaHei',
    fontSize: 14,
    fontSplit: false,
    uiScale: 100,
    language: 'zh-CN',
    closeLastWindowBehavior: 'hide',
    draftTtlDays: 3,
    autoLaunch: false,
    autoLaunchHidden: false,
    // 默认关闭失焦自动隐藏（用户需手动在设置中开启）
    blurToHide: false,
    // 默认工作区为空字符串（=默认工作区）
    defaultWorkspaceId: '',
    // 行号显示默认关闭
    showLineNumbers: false,
    // 默认逻辑行号模式
    lineNumberMode: 'logical',
    // 默认行高 1.7
    editorLineHeight: 1.7,
    // 默认内边距 24px
    editorPadding: 24,
    // 默认关闭缩略图
    showMinimap: false,
    // 默认所有导航栏按钮可见
    navbarButtons: {
      pin: true,
      color: true,
      newBtn: true,
      copy: true,
      notes: true,
      settings: true,
    },
  }
}

function saveConfig(config: Config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

function loadHistory(): HistoryEntry[] {
  try {
    if (fs.existsSync(historyPath)) {
      return JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
    }
  } catch {}
  return []
}

function saveHistory(history: HistoryEntry[]) {
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2))
}

// ===== Task 1: notes/ 目录管理函数 =====

// 首次启动时创建 notes/ 目录、空 index.json、workspaces.json（含默认工作区）、tags.json
function initNotesDir() {
  try {
    // 创建 notes/ 目录
    if (!fs.existsSync(notesDir)) {
      fs.mkdirSync(notesDir, { recursive: true })
    }
    // 创建空 index.json
    if (!fs.existsSync(indexPath)) {
      saveNoteIndex([])
    }
    // 创建 workspaces.json（含默认工作区）
    if (!fs.existsSync(workspacesPath)) {
      const defaultWorkspaces: Workspace[] = [
        {
          id: 'default',
          name: '默认工作区',
          icon: '📝',
          createdAt: new Date().toISOString(),
        },
      ]
      saveWorkspaces(defaultWorkspaces)
    }
    // 创建空 tags.json
    if (!fs.existsSync(tagsPath)) {
      saveTags([])
    }
    // 创建 trash/ 目录和空 trash/index.json
    if (!fs.existsSync(trashDir)) {
      fs.mkdirSync(trashDir, { recursive: true })
    }
    if (!fs.existsSync(trashIndexPath)) {
      saveTrashIndex([])
    }
  } catch (e) {
    console.error('初始化 notes 目录失败:', e)
  }
}

// 读取 index.json
function loadNoteIndex(): NoteIndexEntry[] {
  try {
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
    }
  } catch (e) {
    console.error('读取笔记索引失败:', e)
  }
  return []
}

// 写入 index.json
function saveNoteIndex(index: NoteIndexEntry[]) {
  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
  } catch (e) {
    console.error('写入笔记索引失败:', e)
  }
}

// 读取 {id}.json
function loadNote(id: string): Note | null {
  // 安全校验：id 必须是合法的 UUID 格式，防止路径遍历攻击
  if (!isValidNoteId(id)) {
    console.error(`非法笔记 ID: ${id}`)
    return null
  }
  try {
    const notePath = path.join(notesDir, `${id}.json`)
    if (fs.existsSync(notePath)) {
      return JSON.parse(fs.readFileSync(notePath, 'utf-8'))
    }
  } catch (e) {
    console.error(`读取笔记 ${id} 失败:`, e)
  }
  return null
}

// 写入 {id}.json，同时更新 index.json 中对应条目
function saveNote(note: Note) {
  // 安全校验：note.id 必须是合法的 UUID 格式，防止路径遍历攻击
  if (!isValidNoteId(note.id)) {
    console.error(`非法笔记 ID: ${note.id}`)
    return
  }
  try {
    const notePath = path.join(notesDir, `${note.id}.json`)
    fs.writeFileSync(notePath, JSON.stringify(note, null, 2))
    // 同步更新 index.json
    const index = loadNoteIndex()
    const entry: NoteIndexEntry = {
      id: note.id,
      title: note.title,
      type: note.type,
      color: note.color,
      tags: note.tags,
      workspace: note.workspace,
      updatedAt: note.updatedAt,
      expiresAt: note.expiresAt,
      pinned: note.pinned === true ? true : undefined,
    }
    const existIdx = index.findIndex(e => e.id === note.id)
    if (existIdx >= 0) {
      index[existIdx] = entry
    } else {
      index.unshift(entry)
    }
    saveNoteIndex(index)
  } catch (e) {
    console.error(`保存笔记 ${note.id} 失败:`, e)
  }
}

// 删除 {id}.json，从 index.json 移除
function deleteNote(id: string) {
  // 安全校验：id 必须是合法的 UUID 格式，防止路径遍历攻击
  if (!isValidNoteId(id)) {
    console.error(`非法笔记 ID: ${id}`)
    return
  }
  // 回收站机制：删除笔记时移入回收站而非直接删除，24 小时后自动永久清理
  // 如果移入回收站失败（如文件不存在），回退到直接删除
  if (!moveNoteToTrash(id)) {
    try {
      const notePath = path.join(notesDir, `${id}.json`)
      if (fs.existsSync(notePath)) {
        fs.unlinkSync(notePath)
      }
      const index = loadNoteIndex()
      const newIndex = index.filter(e => e.id !== id)
      if (newIndex.length !== index.length) {
        saveNoteIndex(newIndex)
      }
    } catch (e) {
      console.error(`删除笔记 ${id} 失败:`, e)
    }
  }
}

// 读取 workspaces.json
function loadWorkspaces(): Workspace[] {
  try {
    if (fs.existsSync(workspacesPath)) {
      return JSON.parse(fs.readFileSync(workspacesPath, 'utf-8'))
    }
  } catch (e) {
    console.error('读取工作区失败:', e)
  }
  return []
}

// 写入 workspaces.json
function saveWorkspaces(workspaces: Workspace[]) {
  try {
    fs.writeFileSync(workspacesPath, JSON.stringify(workspaces, null, 2))
  } catch (e) {
    console.error('写入工作区失败:', e)
  }
}

// 读取 tags.json
function loadTags(): Tag[] {
  try {
    if (fs.existsSync(tagsPath)) {
      const tags: Tag[] = JSON.parse(fs.readFileSync(tagsPath, 'utf-8'))
      return tags
    }
  } catch (e) {
    console.error('读取标签失败:', e)
  }
  return []
}

// 读取标签并动态统计每个标签被多少笔记使用（覆盖 usageCount，不持久化）
// 所有返回给前端的 IPC handler 都应使用此函数，保证 usageCount 始终准确
function getTagsWithUsage(): Tag[] {
  const tags = loadTags()
  const index = loadNoteIndex()
  const usageMap = new Map<string, number>()
  for (const entry of index) {
    for (const tagId of entry.tags) {
      usageMap.set(tagId, (usageMap.get(tagId) || 0) + 1)
    }
  }
  return tags.map(tag => ({
    ...tag,
    usageCount: usageMap.get(tag.id) || 0,
  }))
}

// 写入 tags.json
function saveTags(tags: Tag[]) {
  try {
    fs.writeFileSync(tagsPath, JSON.stringify(tags, null, 2))
  } catch (e) {
    console.error('写入标签失败:', e)
  }
}

// ===== 回收站管理函数（回收站机制新增） =====

// 读取 trash/index.json
function loadTrashIndex(): TrashNoteEntry[] {
  try {
    if (fs.existsSync(trashIndexPath)) {
      return JSON.parse(fs.readFileSync(trashIndexPath, 'utf-8'))
    }
  } catch (e) {
    console.error('读取回收站索引失败:', e)
  }
  return []
}

// 写入 trash/index.json
function saveTrashIndex(trash: TrashNoteEntry[]) {
  try {
    fs.writeFileSync(trashIndexPath, JSON.stringify(trash, null, 2))
  } catch (e) {
    console.error('写入回收站索引失败:', e)
  }
}

// 将笔记移入回收站：移动 {id}.json 到 trash/，在 trash/index.json 添加条目
function moveNoteToTrash(id: string): boolean {
  if (!isValidNoteId(id)) {
    console.error(`非法笔记 ID: ${id}`)
    return false
  }
  try {
    const notePath = path.join(notesDir, `${id}.json`)
    if (!fs.existsSync(notePath)) return false
    // 读取笔记内容以构建回收站条目
    const note: Note = JSON.parse(fs.readFileSync(notePath, 'utf-8'))
    const now = new Date()
    const deletedAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + TRASH_TTL_MS).toISOString()
    const trashEntry: TrashNoteEntry = {
      id: note.id,
      title: note.title,
      type: note.type,
      color: note.color,
      tags: note.tags,
      workspace: note.workspace,
      format: note.format,
      deletedAt,
      expiresAt,
    }
    // 移动文件到 trash/ 目录
    const trashNotePath = path.join(trashDir, `${id}.json`)
    fs.renameSync(notePath, trashNotePath)
    // 添加到回收站索引
    const trashIndex = loadTrashIndex()
    trashIndex.unshift(trashEntry)
    saveTrashIndex(trashIndex)
    // 从笔记索引中移除
    const index = loadNoteIndex()
    const newIndex = index.filter(e => e.id !== id)
    if (newIndex.length !== index.length) {
      saveNoteIndex(newIndex)
    }
    return true
  } catch (e) {
    console.error(`移入回收站失败 ${id}:`, e)
    return false
  }
}

// 从回收站恢复笔记：将 {id}.json 移回 notes/，重建索引条目，从 trash/index.json 移除
function restoreNoteFromTrash(id: string): boolean {
  if (!isValidNoteId(id)) {
    console.error(`非法笔记 ID: ${id}`)
    return false
  }
  try {
    const trashNotePath = path.join(trashDir, `${id}.json`)
    if (!fs.existsSync(trashNotePath)) return false
    // 读取笔记内容
    const note: Note = JSON.parse(fs.readFileSync(trashNotePath, 'utf-8'))
    // 移回 notes/ 目录
    const notePath = path.join(notesDir, `${id}.json`)
    fs.renameSync(trashNotePath, notePath)
    // 重建笔记索引条目
    const index = loadNoteIndex()
    const entry: NoteIndexEntry = {
      id: note.id,
      title: note.title,
      type: note.type,
      color: note.color,
      tags: note.tags,
      workspace: note.workspace,
      updatedAt: note.updatedAt,
      expiresAt: note.expiresAt,
      pinned: note.pinned === true ? true : undefined,
    }
    // 如果索引中已存在（不应发生但防御性处理），更新而非重复添加
    const existIdx = index.findIndex(e => e.id === note.id)
    if (existIdx >= 0) {
      index[existIdx] = entry
    } else {
      index.unshift(entry)
    }
    saveNoteIndex(index)
    // 从回收站索引中移除
    const trashIndex = loadTrashIndex()
    const newTrashIndex = trashIndex.filter(e => e.id !== id)
    if (newTrashIndex.length !== trashIndex.length) {
      saveTrashIndex(newTrashIndex)
    }
    return true
  } catch (e) {
    console.error(`从回收站恢复失败 ${id}:`, e)
    return false
  }
}

// 永久删除回收站中的笔记：删除 trash/{id}.json，从 trash/index.json 移除
function permanentlyDeleteNote(id: string): boolean {
  if (!isValidNoteId(id)) {
    console.error(`非法笔记 ID: ${id}`)
    return false
  }
  try {
    const trashNotePath = path.join(trashDir, `${id}.json`)
    if (fs.existsSync(trashNotePath)) {
      fs.unlinkSync(trashNotePath)
    }
    const trashIndex = loadTrashIndex()
    const newTrashIndex = trashIndex.filter(e => e.id !== id)
    if (newTrashIndex.length !== trashIndex.length) {
      saveTrashIndex(newTrashIndex)
    }
    return true
  } catch (e) {
    console.error(`永久删除失败 ${id}:`, e)
    return false
  }
}

// 清空回收站：删除 trash/ 下所有 {id}.json，清空 trash/index.json
function emptyTrash(): boolean {
  try {
    // 删除 trash/ 下所有 .json 文件（排除 index.json）
    const files = fs.readdirSync(trashDir).filter(f => f.endsWith('.json') && f !== 'index.json')
    for (const file of files) {
      fs.unlinkSync(path.join(trashDir, file))
    }
    saveTrashIndex([])
    return true
  } catch (e) {
    console.error('清空回收站失败:', e)
    return false
  }
}

// ===== 品牌升级数据迁移（one-time-editor → oncepad）=====
// 检测旧应用名残留目录，自动迁移所有用户数据到新路径。
// 幂等设计：新路径已有笔记文件时跳过文件迁移，但始终校验并修复 index.json。
function migrateFromOldAppName() {
  try {
    const oldUserDataPath = path.join(app.getPath('appData'), 'one-time-editor')
    const newUserDataPath = app.getPath('userData')
    const newNotesDir = path.join(newUserDataPath, 'notes')

    // 判断旧路径是否存在（决定是否需要执行文件迁移）
    const oldPathExists = fs.existsSync(oldUserDataPath)

    // 判断新路径是否已有笔记文件（决定是否跳过文件迁移）
    let newNotesCount = 0
    if (fs.existsSync(newNotesDir)) {
      newNotesCount = fs.readdirSync(newNotesDir).filter(f => f.endsWith('.json') && f !== 'index.json').length
    }

    // 仅在旧路径存在且新路径无笔记时执行文件迁移
    if (oldPathExists && newNotesCount === 0) {
      console.log(`[OncePad] 检测到旧应用数据目录: ${oldUserDataPath}，开始迁移到 ${newUserDataPath}`)

      // 需要迁移的用户数据文件清单
      const filesToMigrate = [
        'config.json',
        'history.json',
        'tags.json',
        'workspaces.json',
        'debug.log',
      ]
      // 需要迁移的目录清单
      const dirsToMigrate = ['notes', 'trash']

      // 迁移单个文件（用户数据文件优先使用旧路径版本覆盖新路径）
      // 注意：config.json 等用户数据文件包含用户真实设置，应覆盖新路径的默认生成版本
      for (const fileName of filesToMigrate) {
        const srcFile = path.join(oldUserDataPath, fileName)
        const dstFile = path.join(newUserDataPath, fileName)
        if (!fs.existsSync(srcFile)) continue
        try {
          // 用户数据文件：旧路径存在则覆盖新路径（旧路径是用户真实数据）
          fs.copyFileSync(srcFile, dstFile)
          console.log(`[OncePad] 迁移文件: ${fileName}`)
        } catch (e) {
          console.error(`[OncePad] 迁移文件失败 ${fileName}:`, e)
        }
      }

      // 迁移目录（递归复制，已存在的文件跳过）
      for (const dirName of dirsToMigrate) {
        const srcDir = path.join(oldUserDataPath, dirName)
        const dstDir = path.join(newUserDataPath, dirName)
        if (!fs.existsSync(srcDir)) continue
        try {
          if (!fs.existsSync(dstDir)) {
            fs.mkdirSync(dstDir, { recursive: true })
          }
          copyDirRecursive(srcDir, dstDir)
          console.log(`[OncePad] 迁移目录: ${dirName}/`)
        } catch (e) {
          console.error(`[OncePad] 迁移目录失败 ${dirName}/:`, e)
        }
      }

      // 迁移完成后在旧目录写入迁移标记，便于排查
      try {
        const migrationMark = path.join(oldUserDataPath, '.migrated-to-oncepad')
        fs.writeFileSync(migrationMark, new Date().toISOString())
      } catch {}

      console.log('[OncePad] 数据迁移完成')
    }

    // 始终校验并修复 index.json：扫描 notes/ 目录所有笔记文件，重建索引
    // 解决 copyDirRecursive 跳过已存在文件导致 index.json 未覆盖的问题
    // 也用于修复其他原因导致的 index.json 不一致
    if (fs.existsSync(newNotesDir)) {
      try {
        const noteFiles = fs.readdirSync(newNotesDir).filter(f => f.endsWith('.json') && f !== 'index.json')
        const currentIndex = loadNoteIndex()
        // 笔记文件数与索引条目数不匹配时重建
        if (noteFiles.length !== currentIndex.length) {
          console.log(`[OncePad] 检测到 index.json 不一致（文件 ${noteFiles.length} 个，索引 ${currentIndex.length} 条），开始重建`)
          const rebuiltIndex: NoteIndexEntry[] = []
          for (const file of noteFiles) {
            try {
              const notePath = path.join(newNotesDir, file)
              const note: Note = JSON.parse(fs.readFileSync(notePath, 'utf-8'))
              rebuiltIndex.push({
                id: note.id,
                title: note.title,
                type: note.type,
                color: note.color,
                tags: note.tags,
                workspace: note.workspace,
                updatedAt: note.updatedAt,
                expiresAt: note.expiresAt,
                pinned: note.pinned === true ? true : undefined,
              })
            } catch (e) {
              console.error(`[OncePad] 重建索引时读取笔记失败 ${file}:`, e)
            }
          }
          saveNoteIndex(rebuiltIndex)
          console.log(`[OncePad] 重建 notes/index.json 完成，共 ${rebuiltIndex.length} 条笔记`)
        }
      } catch (e) {
        console.error('[OncePad] 重建 notes/index.json 失败:', e)
      }
    }
  } catch (e) {
    console.error('[OncePad] 数据迁移失败:', e)
    // 迁移失败不阻塞应用启动，用户可手动迁移
  }
}

// 递归复制目录（已存在的文件跳过，避免覆盖新路径已有数据）
function copyDirRecursive(src: string, dst: string) {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(dst, { recursive: true })
  }
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const dstPath = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath)
    } else {
      if (fs.existsSync(dstPath)) continue  // 已存在则跳过
      fs.copyFileSync(srcPath, dstPath)
    }
  }
}

// ===== Task 2: 旧数据迁移逻辑 =====

// 检测 history.json 存在且 notes/ 目录不存在时触发迁移
function migrateHistoryToNotes() {
  try {
    // notes/ 目录已存在则不迁移
    if (fs.existsSync(notesDir)) {
      return
    }
    // history.json 不存在则不迁移
    if (!fs.existsSync(historyPath)) {
      return
    }
    // 读取旧 history.json
    const history: HistoryEntry[] = JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
    if (!Array.isArray(history)) {
      return
    }
    // 创建 notes/ 目录
    fs.mkdirSync(notesDir, { recursive: true })
    // 将每条记录转为 Note 对象并保存
    for (const entry of history) {
      const createdAt = entry.createdAt || new Date().toISOString()
      // 草稿过期时间 = 创建时间 + 3天
      const expiresAt = new Date(new Date(createdAt).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
      // title = text 首行截取前60字符
      const firstLine = (entry.text || '').split('\n')[0] || ''
      const title = firstLine.slice(0, 60)
      const note: Note = {
        id: crypto.randomUUID(),
        title,
        content: entry.text || '',
        type: 'draft',
        tags: [],
        color: 'default',
        workspace: '', // 默认区
        createdAt,
        updatedAt: createdAt,
        expiresAt,
        format: 'plain',
      }
      // 直接写入文件，避免 saveNote 触发 index.json 重复读写
      const notePath = path.join(notesDir, `${note.id}.json`)
      fs.writeFileSync(notePath, JSON.stringify(note, null, 2))
    }
    // 将原 history.json 重命名为 history.json.bak
    const bakPath = path.join(app.getPath('userData'), 'history.json.bak')
    if (fs.existsSync(bakPath)) {
      fs.unlinkSync(bakPath)
    }
    fs.renameSync(historyPath, bakPath)
    // 迁移完成后调用 initNotesDir() 补全其他文件（index.json、workspaces.json、tags.json）
    // 扫描 notes/ 目录下所有 .json 文件（排除 index.json），读取并构建索引
    const rebuiltIndex: NoteIndexEntry[] = []
    const files = fs.readdirSync(notesDir).filter(f => f.endsWith('.json') && f !== 'index.json')
    for (const file of files) {
      try {
        const notePath = path.join(notesDir, file)
        const note: Note = JSON.parse(fs.readFileSync(notePath, 'utf-8'))
        rebuiltIndex.push({
          id: note.id,
          title: note.title,
          type: note.type,
          color: note.color,
          tags: note.tags,
          workspace: note.workspace,
          updatedAt: note.updatedAt,
          expiresAt: note.expiresAt,
        })
      } catch (e) {
        console.error(`迁移重建索引时读取 ${file} 失败:`, e)
      }
    }
    saveNoteIndex(rebuiltIndex)
    // 补全 workspaces.json 和 tags.json
    initNotesDir()
    console.log(`迁移完成：共迁移 ${history.length} 条历史记录到 notes/`)
  } catch (e) {
    console.error('迁移 history.json 到 notes/ 失败:', e)
  }
}

// ===== Task 3: 草稿过期清理机制 =====

// 读取 index.json，筛选 type='draft' 且 expiresAt < now 的条目，移入回收站
// 同时清理回收站中超过 24 小时的条目（永久删除）
function cleanupExpiredNotes() {
  try {
    const index = loadNoteIndex()
    if (index.length > 0) {
      const now = Date.now()
      const expiredIds: string[] = []
      for (const entry of index) {
        if (entry.type === 'draft' && entry.expiresAt) {
          const expiresTime = new Date(entry.expiresAt).getTime()
          if (Number.isFinite(expiresTime) && expiresTime < now) {
            expiredIds.push(entry.id)
          }
        }
      }
      if (expiredIds.length > 0) {
        // 过期草稿移入回收站（而非直接永久删除），给用户最后的恢复机会
        for (const id of expiredIds) {
          moveNoteToTrash(id)
        }
        console.log(`清理过期草稿：共移入回收站 ${expiredIds.length} 条`)
      }
    }
    // 清理回收站中超过 24 小时的条目（永久删除）
    cleanupExpiredTrash()
  } catch (e) {
    console.error('清理过期草稿失败:', e)
  }
}

// 清理回收站中过期的条目（expiresAt < now）
function cleanupExpiredTrash() {
  try {
    const trashIndex = loadTrashIndex()
    if (trashIndex.length === 0) return
    const now = Date.now()
    const expiredIds: string[] = []
    for (const entry of trashIndex) {
      const expiresTime = new Date(entry.expiresAt).getTime()
      if (Number.isFinite(expiresTime) && expiresTime < now) {
        expiredIds.push(entry.id)
      }
    }
    if (expiredIds.length === 0) return
    // 永久删除过期的回收站条目
    for (const id of expiredIds) {
      try {
        const trashNotePath = path.join(trashDir, `${id}.json`)
        if (fs.existsSync(trashNotePath)) {
          fs.unlinkSync(trashNotePath)
        }
      } catch (e) {
        console.error(`清理回收站 ${id} 文件失败:`, e)
      }
    }
    // 从 trash/index.json 中移除
    const newTrashIndex = trashIndex.filter(e => !expiredIds.includes(e.id))
    saveTrashIndex(newTrashIndex)
    console.log(`清理回收站：共永久删除 ${expiredIds.length} 条`)
  } catch (e) {
    console.error('清理回收站失败:', e)
  }
}

// ===== Task 12-13: 文件打开处理与多窗口辅助函数 =====

// 支持的文件扩展名（v1.1.0 扩展：覆盖常见文本/代码/配置格式）
const SUPPORTED_EXTS = [
  // 文档类
  '.md', '.markdown', '.txt', '.text', '.log',
  // 代码类
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.sass', '.less',
  '.html', '.htm', '.xml', '.svg', '.vue', '.svelte',
  '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.go', '.rs', '.swift', '.kt', '.scala', '.clj', '.ex', '.exs',
  '.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd', '.ps1',
  // 配置类
  '.yml', '.yaml', '.toml', '.ini', '.conf', '.cfg', '.properties',
  '.env', '.editorconfig', '.gitignore', '.gitattributes',
  // 数据类
  '.csv', '.tsv', '.sql',
  // 其他文本类
  '.diff', '.patch', '.rtf',
]

/**
 * 检测文件内容是否为纯文本（v1.1.0 新增）
 * 用于处理后缀名未收录的文件：只要内容是纯文本就允许打开
 *
 * 检测策略：
 * 1. 读取文件前 8KB 字节
 * 2. 检测是否包含 NULL 字节（二进制文件标志）
 * 3. 检测是否包含大量非打印字符
 *
 * @param filePath 文件路径
 * @returns true=纯文本，false=二进制文件
 */
function isPlainTextFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(8192)
    const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0)
    fs.closeSync(fd)
    const slice = buffer.subarray(0, bytesRead)
    // 二进制文件标志：包含 NULL 字节
    if (slice.includes(0)) return false
    // 检测非打印字符比例（排除常见的 \r \n \t）
    let nonPrintable = 0
    for (let i = 0; i < bytesRead; i++) {
      const byte = slice[i]
      // 允许：\t(9) \n(10) \r(13) 32-126(ASCII 可打印) 128-255(UTF-8 多字节)
      if (byte < 9 || (byte > 13 && byte < 32)) {
        nonPrintable++
      }
    }
    // 非打印字符超过 5% 判定为二进制
    if (bytesRead > 0 && nonPrintable / bytesRead > 0.05) return false
    return true
  } catch {
    return false
  }
}

// 从命令行参数中提取文件路径（用于双击文件打开场景）
// v1.1.0 扩展：支持所有文本类文件，后缀名未收录时检测内容是否为纯文本
function extractFilePathFromArgs(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    // 跳过以 - 或 -- 开头的参数（electron 开发模式参数）
    if (arg.startsWith('-')) continue
    // 解析为绝对路径
    const resolved = path.resolve(arg)
    if (!fs.existsSync(resolved)) continue
    // 后缀名在支持清单中 → 直接通过
    const ext = path.extname(arg).toLowerCase()
    if (SUPPORTED_EXTS.includes(ext)) {
      return resolved
    }
    // 后缀名未收录 → 检测内容是否为纯文本
    if (isPlainTextFile(resolved)) {
      return resolved
    }
  }
  return null
}

// 获取最后活动的窗口（优先返回当前聚焦窗口，否则返回最后创建的窗口）
function getLastWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && windows.has(focused.id)) {
    return focused
  }
  const wins = Array.from(windows.values())
  return wins.length > 0 ? wins[wins.length - 1] : null
}

// 路径安全校验：仅允许 .md/.markdown 扩展名，解析为绝对路径并检查存在性
// UUID v4 格式校验（防止路径遍历攻击：id 拼接到文件路径前必须验证）
// 标准格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx（小写十六进制）
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isValidNoteId(id: string): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id)
}

function validateFilePath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase()
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    return null
  }
  // 后缀名在支持清单中 → 直接通过
  if (SUPPORTED_EXTS.includes(ext)) {
    return resolved
  }
  // v1.1.0 新增：后缀名未收录时，检测文件内容是否为纯文本
  // 只要内容是纯文本（如 .log 变体、无后缀文件、代码文件等），就允许打开
  if (isPlainTextFile(resolved)) {
    return resolved
  }
  return null
}

// 创建新窗口加载指定文件（用于 second-instance 场景）
function loadFileToNewWindow(filePath: string) {
  const resolved = validateFilePath(filePath)
  if (!resolved) {
    console.error('文件路径无效或不存在:', filePath)
    return
  }
  const config = loadConfig()
  createWindow(config, resolved)
}

// 创建系统托盘图标和菜单
// 功能：单击托盘显示窗口、右键菜单（显示/退出）、防止应用在所有窗口隐藏时退出
function createTray() {
  // 托盘图标加载策略（extraResources 方案）：
  // 通过 package.json 的 extraResources 配置，图标文件被复制到 asar 外部的 resources/ 目录
  // 避免了 asar 虚拟文件系统导致 nativeImage 加载失败的问题
  // 打包后路径：process.resourcesPath/tray-icon.png
  // 开发模式路径：build/icon.iconset/icon_32x32.png
  let trayImage: Electron.NativeImage = nativeImage.createEmpty()
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icon.png')
    : path.join(__dirname, '../../build/icon.iconset/icon_32x32.png')

  try {
    // 直接用 createFromPath 读取 asar 外部文件（不存在 asar 路径问题）
    trayImage = nativeImage.createFromPath(iconPath)
    // 如果失败，尝试用 fs.readFileSync + createFromBuffer
    if (trayImage.isEmpty()) {
      const buf = fs.readFileSync(iconPath)
      trayImage = nativeImage.createFromBuffer(buf)
    }
    // 全部失败，使用空图标
    if (trayImage.isEmpty()) {
      trayImage = nativeImage.createEmpty()
    }
  } catch {
    trayImage = nativeImage.createEmpty()
  }

  tray = new Tray(trayImage)
  tray.setToolTip('OncePad')

  // 右键菜单：显示窗口 / 新建笔记 / 退出
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        // 显示第一个可见窗口，或恢复第一个隐藏窗口
        const wins = Array.from(windows.values())
        if (wins.length === 0) {
          createWindow(loadConfig())
          return
        }
        const visible = wins.find(w => w.isVisible())
        if (visible) {
          visible.focus()
        } else {
          wins[0].show()
          wins[0].focus()
        }
      },
    },
    {
      label: '新建笔记',
      click: () => {
        createWindow(loadConfig())
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        // 销毁托盘并退出应用
        if (tray) {
          tray.destroy()
          tray = null
        }
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)

  // 单击托盘图标：显示窗口
  tray.on('click', () => {
    const wins = Array.from(windows.values())
    if (wins.length === 0) {
      createWindow(loadConfig())
      return
    }
    const visible = wins.find(w => w.isVisible())
    if (visible) {
      // 已有可见窗口，聚焦它
      visible.focus()
    } else {
      // 所有窗口都隐藏，显示第一个并聚焦
      wins[0].show()
      wins[0].focus()
    }
  })
}

function createWindow(config: Config, filePath?: string) {
  // 检测 --hidden 命令行参数（开机自启隐藏模式）
  const startHidden = process.argv.includes('--hidden')
  // 使用保存的窗口尺寸/位置，若无则使用默认值 700x500
  const bounds = config.windowBounds
  let width = bounds?.width || 700
  let height = bounds?.height || 500
  let x = bounds?.x
  let y = bounds?.y

  // 校验窗口位置是否在可见屏幕范围内
  // 修复：若保存的坐标超出所有显示器范围（如外接显示器拔出后），重置到主屏居中
  if (x !== undefined && y !== undefined) {
    const centerX = x + width / 2
    const centerY = y + height / 2
    const displays = screen.getAllDisplays()
    const isVisible = displays.some(d =>
      centerX >= d.bounds.x && centerX <= d.bounds.x + d.bounds.width &&
      centerY >= d.bounds.y && centerY <= d.bounds.y + d.bounds.height
    )
    if (!isVisible) {
      // 窗口中心不在任何显示器内，重置到主屏居中并限制尺寸
      const primaryDisplay = screen.getPrimaryDisplay()
      width = Math.min(width, primaryDisplay.workAreaSize.width)
      height = Math.min(height, primaryDisplay.workAreaSize.height)
      x = Math.max(0, Math.floor((primaryDisplay.workAreaSize.width - width) / 2))
      y = Math.max(0, Math.floor((primaryDisplay.workAreaSize.height - height) / 2))
    }
  }

  const newWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    frame: false,
    show: false,
    skipTaskbar: false,
    alwaysOnTop: config.alwaysOnTop,
    // 窗口图标：开发模式下从 build/icon.png 加载，打包后由 electron-builder 自动嵌入
    icon: path.join(__dirname, '../../build/icon.png'),
  })

  const winId = newWin.id
  // 注册到多窗口管理器
  windows.set(winId, newWin)
  windowTexts.set(winId, '')
  if (filePath) {
    windowFiles.set(winId, filePath)
  }

  newWin.on('ready-to-show', () => {
    // --hidden 模式下不显示窗口，仅隐藏到后台
    if (startHidden) {
      // skipTaskbar 已设为 false，这里仅不调用 show()
      // 窗口保持隐藏状态，用户通过快捷键唤出
      return
    }
    newWin.show()
    newWin.focus()
  })

  // 窗口尺寸/位置变化时持久化（防抖：500ms 内只保存一次）
  let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
  const saveBoundsDebounced = () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    boundsSaveTimer = setTimeout(() => {
      try {
        const currentBounds = newWin.getNormalBounds()
        const cfg = loadConfig()
        cfg.windowBounds = { x: currentBounds.x, y: currentBounds.y, width: currentBounds.width, height: currentBounds.height }
        saveConfig(cfg)
      } catch {}
    }, 500)
  }
  newWin.on('resize', saveBoundsDebounced)
  newWin.on('move', saveBoundsDebounced)

  // 失焦自动隐藏：窗口失去焦点时自动隐藏到托盘（可配置）
  newWin.on('blur', () => {
    const cfg = loadConfig()
    if (cfg.blurToHide === true) {
      newWin.hide()
    }
  })

  newWin.on('close', (event) => {
    // v1.1.0：文件模式下检查未保存修改
    // 如果窗口有关联文件且未在强制关闭集合中，拦截关闭并通知渲染进程处理
    const filePath = windowFiles.get(winId)
    if (filePath && !forceClose.has(winId)) {
      event.preventDefault()
      // 通知渲染进程执行关闭流程（含未保存检查）
      newWin.webContents.send('request-close')
      return
    }
    // 关闭时立即保存窗口尺寸/位置
    try {
      const currentBounds = newWin.getNormalBounds()
      const cfg = loadConfig()
      cfg.windowBounds = { x: currentBounds.x, y: currentBounds.y, width: currentBounds.width, height: currentBounds.height }
      saveConfig(cfg)
    } catch {}
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    // 关闭时复制该窗口文本到剪贴板并保存到历史
    const text = windowTexts.get(winId) || ''
    copyText(text)
    saveTextToHistory(text)
    // 清理强制关闭标记
    forceClose.delete(winId)
  })

  newWin.on('closed', () => {
    // 从管理器移除
    windows.delete(winId)
    windowTexts.delete(winId)
    windowFiles.delete(winId)
    forceClose.delete(winId)
  })

  // 编辑器右键菜单：剪切/复制/粘贴/全选（原生 Electron Menu）
  newWin.webContents.on('context-menu', (_event, params) => {
    const hasSelection = params.selectionText && params.selectionText.length > 0
    const hasClipboard = clipboard.readText().length > 0
    const menu = Menu.buildFromTemplate([
      { label: '剪切', role: 'cut', enabled: hasSelection && params.editFlags.canCut },
      { label: '复制', role: 'copy', enabled: hasSelection && params.editFlags.canCopy },
      { label: '粘贴', role: 'paste', enabled: hasClipboard && params.editFlags.canPaste },
      { type: 'separator' },
      { label: '全选', role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ])
    menu.popup(newWin)
  })

  // v1.1.1：渲染进程崩溃捕获（Electron 28+ 使用 render-process-gone 事件）
  newWin.webContents.on('render-process-gone', (_event, details) => {
    writeErrorLog('FATAL', `Renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`)
  })

  // v1.1.1：渲染进程无响应捕获
  newWin.on('unresponsive', () => {
    writeErrorLog('WARN', `Window unresponsive: id=${newWin.id}`)
  })

  // 加载 URL：如果有 filePath，通过 query parameter 传递给渲染进程
  if (VITE_DEV_SERVER_URL) {
    if (filePath) {
      const url = new URL(VITE_DEV_SERVER_URL)
      url.searchParams.set('file', filePath)
      newWin.loadURL(url.toString())
    } else {
      newWin.loadURL(VITE_DEV_SERVER_URL)
    }
  } else {
    if (filePath) {
      newWin.loadFile(path.join(process.env.DIST!, 'index.html'), {
        query: { file: filePath },
      })
    } else {
      newWin.loadFile(path.join(process.env.DIST!, 'index.html'))
    }
  }

  // dev 模式自动打开 DevTools（调试中文输入法问题）
  if (VITE_DEV_SERVER_URL) {
    newWin.webContents.openDevTools({ mode: 'detach' })
  }

  return newWin
}

function toggleWindow() {
  if (windows.size === 0) {
    createWindow(loadConfig())
    return
  }
  // 检查是否有可见窗口
  const allWindows = Array.from(windows.values())
  const visibleWindows = allWindows.filter(w => w.isVisible())
  if (visibleWindows.length > 0) {
    // 有可见窗口 → 隐藏所有窗口
    const lastWin = getLastWindow()
    if (lastWin) {
      const text = windowTexts.get(lastWin.id) || ''
      copyText(text)
    }
    if (process.platform === 'darwin') {
      app.hide()
    } else {
      for (const w of visibleWindows) {
        w.hide()
      }
    }
  } else {
    // 所有窗口都隐藏 → 显示所有窗口，聚焦最后一个
    for (const w of allWindows) {
      w.show()
    }
    const lastWin = getLastWindow()
    if (lastWin) {
      lastWin.focus()
    }
  }
}

function copyText(text: string) {
  if (text.trim()) {
    clipboard.writeText(text)
  }
}

function saveTextToHistory(text: string) {
  if (!text.trim()) return
  const history = loadHistory()
  const entry: HistoryEntry = {
    id: Date.now().toString(),
    text,
    createdAt: new Date().toISOString(),
  }
  history.unshift(entry)
  if (history.length > 100) {
    history.splice(100)
  }
  saveHistory(history)
}

function registerShortcut(config: Config) {
  globalShortcut.unregisterAll()
  // v1.1.0：空字符串快捷键跳过注册（新建/复制默认为空）
  if (!config.shortcut) return
  try {
    globalShortcut.register(config.shortcut, toggleWindow)
  } catch {
    // fallback 也使用 Alt+Q（不再用 Control+J）
    try {
      globalShortcut.register(defaultShortcut, toggleWindow)
    } catch {}
  }
}

// ===== Task 12: 单实例锁 + 文件打开处理 =====

// 启动时从命令行参数提取文件路径（双击 .md 文件启动场景）
const initialFilePath = extractFilePathFromArgs(process.argv)

// 请求单实例锁：确保只有一个应用实例运行
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 获取锁失败，说明已有实例运行，直接退出
  app.quit()
} else {
  // 监听 second-instance 事件：应用已运行时再次双击文件触发
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    const filePath = extractFilePathFromArgs(commandLine)

    if (filePath) {
      // v1.1.1：优先复用已有窗口加载文件，避免创建新窗口的开销
      const lastWin = getLastWindow()
      if (lastWin) {
        // 聚焦已有窗口
        if (lastWin.isMinimized()) lastWin.restore()
        lastWin.show()
        lastWin.focus()
        // 通知渲染进程在已有窗口中加载文件（渲染进程会先检查未保存修改）
        lastWin.webContents.send('load-file-in-window', filePath)
      } else {
        // 没有窗口则创建新窗口加载文件
        loadFileToNewWindow(filePath)
      }
    } else {
      // 无文件参数：聚焦最后一个活动窗口
      const lastWin = getLastWindow()
      if (lastWin) {
        if (lastWin.isMinimized()) lastWin.restore()
        lastWin.show()
        lastWin.focus()
      } else {
        // 没有窗口则创建新窗口
        createWindow(loadConfig())
      }
    }
  })
} // end of else (gotTheLock)

// ===== v1.1.1 进程级异常捕获 =====
// 必须在 app.whenReady() 之前注册，确保启动阶段的异常也能被捕获
process.on('uncaughtException', (err: Error) => {
  const stack = err.stack || err.message || String(err)
  writeErrorLog('FATAL', `Uncaught Exception: ${stack}`)
})

process.on('unhandledRejection', (reason: unknown) => {
  const detail = reason instanceof Error
    ? (reason.stack || reason.message)
    : String(reason)
  writeErrorLog('ERROR', `Unhandled Rejection: ${detail}`)
})

app.on('child-process-gone', (_event, details) => {
  writeErrorLog('ERROR', `Child process gone: reason=${details.reason}, exitCode=${details.exitCode}, name=${details.name}`)
})

app.whenReady().then(() => {
  // ===== 品牌升级数据迁移（one-time-editor → oncepad）=====
  // 原因：package.json name 从 one-time-editor 改为 oncepad，
  // 导致 Electron app.getPath('userData') 路径变更，用户数据无法访问。
  // 启动时检测旧路径，自动迁移所有用户数据到新路径，避免用户数据丢失。
  migrateFromOldAppName()

  // Task 2: 旧数据迁移（history.json → notes/）
  migrateHistoryToNotes()
  // Task 1: 初始化 notes/ 目录结构（迁移后补全缺失文件）
  initNotesDir()
  // Task 3: 清理过期草稿
  cleanupExpiredNotes()

  const config = loadConfig()
  // 如果启动时带有文件路径参数，创建窗口时加载该文件
  createWindow(config, initialFilePath || undefined)
  registerShortcut(config)
  // 创建系统托盘（支持隐藏到托盘、失焦自动隐藏、单击托盘恢复窗口）
  createTray()

  // IPC handlers
  ipcMain.handle('get-history', () => {
    return loadHistory()
  })

  ipcMain.handle('save-to-history', (_event, text: string) => {
    if (!text.trim()) return loadHistory()
    const history = loadHistory()
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      text,
      createdAt: new Date().toISOString(),
    }
    history.unshift(entry)
    // Keep up to 100 entries
    if (history.length > 100) {
      history.splice(100)
    }
    saveHistory(history)
    return history
  })

  ipcMain.handle('delete-history-entry', (_event, id: string) => {
    let history = loadHistory()
    history = history.filter(h => h.id !== id)
    saveHistory(history)
    return history
  })

  ipcMain.handle('copy-to-clipboard', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('sync-text', (event, text: string) => {
    // 按窗口 ID 跟踪文本（支持多窗口各自独立）
    windowTexts.set(event.sender.id, text)
  })

  ipcMain.handle('get-config', () => {
    return loadConfig()
  })

  ipcMain.handle('set-shortcut', (_event, shortcut: string) => {
    // v1.1.0：允许空字符串（禁用快捷键）或合法快捷键
    if (shortcut !== '' && !shortcutValidator.test(shortcut)) return false
    const config = loadConfig()
    config.shortcut = shortcut
    saveConfig(config)
    registerShortcut(config)
    return true
  })

  ipcMain.handle('set-local-shortcut', (_event, name: string, shortcut: string) => {
    if (name !== 'new' && name !== 'copy') return false
    // v1.1.0：允许空字符串（禁用快捷键）或合法快捷键
    if (shortcut !== '' && !shortcutValidator.test(shortcut)) return false
    const config = loadConfig()
    if (name === 'new') {
      config.newShortcut = shortcut
    } else {
      config.copyShortcut = shortcut
    }
    saveConfig(config)
    return true
  })

  ipcMain.handle('set-always-on-top', (_event, alwaysOnTop: boolean) => {
    const config = loadConfig()
    config.alwaysOnTop = alwaysOnTop === true
    saveConfig(config)
    // 应用到所有窗口
    for (const w of windows.values()) {
      w.setAlwaysOnTop(config.alwaysOnTop)
    }
    return config.alwaysOnTop
  })

  ipcMain.handle('set-close-last-window-behavior', (_event, behavior: string) => {
    const valid: string[] = ['hide', 'confirm', 'quit']
    if (!valid.includes(behavior)) return false
    const config = loadConfig()
    config.closeLastWindowBehavior = behavior as 'hide' | 'confirm' | 'quit'
    saveConfig(config)
    return true
  })

  ipcMain.handle('set-indent', (_event, indentType: string, indentSize: number) => {
    const config = loadConfig()
    config.indentType = indentType === 'tab' ? 'tab' : 'space'
    config.indentSize = [2, 4, 6, 8].includes(indentSize) ? indentSize : 2
    saveConfig(config)
  })

  ipcMain.handle('get-system-fonts', async () => {
    try {
      const fonts = await fontList.getFonts()
      return fonts.sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  })

  ipcMain.handle('set-font-en', (_event, fontEn: string) => {
    if (typeof fontEn !== 'string' || !fontEn) return false
    const config = loadConfig()
    config.fontEn = fontEn
    saveConfig(config)
    return true
  })

  ipcMain.handle('set-font-cn', (_event, fontCn: string) => {
    if (typeof fontCn !== 'string' || !fontCn) return false
    const config = loadConfig()
    config.fontCn = fontCn
    saveConfig(config)
    return true
  })

  ipcMain.handle('set-font-size', (_event, fontSize: number) => {
    const size = Number(fontSize)
    if (!Number.isFinite(size) || size < 12 || size > 24) return false
    const config = loadConfig()
    config.fontSize = size
    saveConfig(config)
    return true
  })

  ipcMain.handle('set-font-split', (_event, fontSplit: boolean) => {
    const config = loadConfig()
    config.fontSplit = fontSplit === true
    saveConfig(config)
    return true
  })

  ipcMain.handle('set-ui-scale', (_event, uiScale: number) => {
    const scale = Number(uiScale)
    if (!Number.isFinite(scale) || scale < 80 || scale > 200) return false
    const config = loadConfig()
    config.uiScale = scale
    saveConfig(config)
    return true
  })

  ipcMain.handle('set-language', (_event, language: string) => {
    if (typeof language !== 'string' || !['zh-CN', 'en'].includes(language)) return false
    const config = loadConfig()
    config.language = language
    saveConfig(config)
    return true
  })

  ipcMain.handle('hide-window', (event) => {
    // 隐藏发起请求的窗口（支持多窗口）
    BrowserWindow.fromWebContents(event.sender)?.hide()
  })

  ipcMain.handle('close-window', async (event) => {
    // 关闭发起请求的窗口（支持多窗口手动关闭）
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    // v1.1.0 修复 Bug 1：渲染进程已做未保存检查，添加 forceClose 标记
    // 避免 close 事件再次拦截 request-close 导致死循环（程序卡死）
    forceClose.add(win.id)

    // 检查是否为最后一个窗口
    // windows Map 中的窗口数（排除当前正在关闭的窗口）
    const otherWindows = Array.from(windows.values()).filter(w => w.id !== win.id)
    if (otherWindows.length > 0) {
      // 还有其他窗口，直接关闭当前窗口
      win.close()
      return
    }

    // 是最后一个窗口，根据配置决定行为
    const config = loadConfig()
    const behavior = config.closeLastWindowBehavior || 'hide'

    if (behavior === 'hide') {
      // 隐藏到托盘，不退出
      win.hide()
      // hide 不触发 close 事件，手动清理 forceClose
      forceClose.delete(win.id)
    } else if (behavior === 'quit') {
      // 直接退出应用
      win.close()
    } else {
      // confirm：弹窗询问用户
      const choice = await dialog.showMessageBox(win, {
        type: 'question',
        title: '确认退出',
        message: '这是最后一个窗口，确定要退出 OncePad 吗？',
        detail: '选择"隐藏"将保留应用在后台运行，可通过快捷键重新唤出。',
        buttons: ['隐藏到托盘', '退出应用', '取消'],
        defaultId: 0,
        cancelId: 2,
      })
      if (choice.response === 0) {
        win.hide()
        forceClose.delete(win.id)
      } else if (choice.response === 1) {
        win.close()
      } else {
        // 用户取消，清理 forceClose
        forceClose.delete(win.id)
      }
    }
  })

  // ===== Task 4: 笔记相关 IPC handler =====

  // 获取笔记列表（可选过滤参数：workspaceId, type, tagId, searchKeyword）
  ipcMain.handle('get-notes', (_event, query?: NoteQuery) => {
    let index = loadNoteIndex()
    if (!query) return index
    if (query.workspaceId !== undefined && query.workspaceId !== '') {
      index = index.filter(e => e.workspace === query.workspaceId)
    }
    if (query.type) {
      index = index.filter(e => e.type === query.type)
    }
    if (query.tagId) {
      index = index.filter(e => e.tags.includes(query.tagId!))
    }
    if (query.searchKeyword) {
      const kw = query.searchKeyword.toLowerCase()
      index = index.filter(e => e.title.toLowerCase().includes(kw))
    }
    return index
  })

  // 获取单个笔记详情
  ipcMain.handle('get-note', (_event, id: string) => {
    return loadNote(id)
  })

  // 保存笔记，返回更新后的 NoteIndexEntry[]
  ipcMain.handle('save-note', (_event, note: Note) => {
    saveNote(note)
    return loadNoteIndex()
  })

  // 删除笔记，返回更新后的 NoteIndexEntry[]
  ipcMain.handle('delete-note', (_event, id: string) => {
    deleteNote(id)
    return loadNoteIndex()
  })

  // 收藏笔记：draft 转 pin，清除 expiresAt，返回 Note
  ipcMain.handle('pin-note', (_event, id: string) => {
    const note = loadNote(id)
    if (!note) return null
    note.type = 'pin'
    note.expiresAt = null
    note.updatedAt = new Date().toISOString()
    saveNote(note)
    return note
  })

  // 设置笔记置顶状态：仅对收藏笔记生效，置顶笔记在列表顶部显示
  ipcMain.handle('set-note-pinned', (_event, id: string, pinned: boolean) => {
    const note = loadNote(id)
    if (!note) return loadNoteIndex()
    // 仅收藏笔记可置顶，草稿忽略
    if (note.type !== 'pin') return loadNoteIndex()
    note.pinned = pinned === true ? true : undefined
    note.updatedAt = new Date().toISOString()
    saveNote(note)
    return loadNoteIndex()
  })

  // ===== 回收站相关 IPC handler（回收站机制新增） =====

  // 获取回收站笔记列表
  ipcMain.handle('get-trash-notes', () => {
    return loadTrashIndex()
  })

  // 从回收站恢复笔记：移回 notes/ 目录，重建索引，返回更新后的笔记索引
  ipcMain.handle('restore-note', (_event, id: string) => {
    restoreNoteFromTrash(id)
    return loadNoteIndex()
  })

  // 永久删除回收站中的笔记：删除 trash/{id}.json，从 trash/index.json 移除，返回更新后的回收站索引
  ipcMain.handle('permanently-delete-note', (_event, id: string) => {
    permanentlyDeleteNote(id)
    return loadTrashIndex()
  })

  // 清空回收站：删除所有 trash/{id}.json，清空 trash/index.json，返回空数组
  ipcMain.handle('empty-trash', () => {
    emptyTrash()
    return loadTrashIndex()
  })

  // 设置草稿自动清理时长（天）
  ipcMain.handle('set-draft-ttl-days', (_event, days: number) => {
    if (![1, 2, 3, 7].includes(Number(days))) return false
    const config = loadConfig()
    config.draftTtlDays = Number(days)
    saveConfig(config)
    return true
  })

  // 设置开机自启：调用系统 API 注册/取消登录项
  ipcMain.handle('set-auto-launch', (_event, enabled: boolean, hidden: boolean) => {
    const config = loadConfig()
    config.autoLaunch = enabled === true
    config.autoLaunchHidden = hidden === true
    saveConfig(config)
    // 调用 Electron 系统 API 设置登录项
    // hidden=true 时通过 --hidden 参数传递，启动时检测此参数隐藏窗口
    app.setLoginItemSettings({
      openAtLogin: enabled === true,
      args: enabled === true && hidden === true ? ['--hidden'] : [],
    })
    return true
  })

  // 失焦自动隐藏开关
  ipcMain.handle('set-blur-to-hide', (_event, enabled: boolean) => {
    const config = loadConfig()
    config.blurToHide = enabled === true
    saveConfig(config)
    return true
  })

  // 行号显示开关：开启后在编辑区最左侧显示行号
  ipcMain.handle('set-show-line-numbers', (_event, enabled: boolean) => {
    const config = loadConfig()
    config.showLineNumbers = enabled === true
    saveConfig(config)
    return true
  })

  // 行号模式设置：logical=逻辑行号，visual=视觉行号
  ipcMain.handle('set-line-number-mode', (_event, mode: 'logical' | 'visual') => {
    const config = loadConfig()
    config.lineNumberMode = mode === 'visual' ? 'visual' : 'logical'
    saveConfig(config)
    return true
  })

  // 编辑器行高设置
  ipcMain.handle('set-editor-line-height', (_event, value: number) => {
    const config = loadConfig()
    config.editorLineHeight = Number.isFinite(value) && value >= 1.2 && value <= 2.4 ? value : 1.7
    saveConfig(config)
    return true
  })

  // 编辑器内边距设置
  ipcMain.handle('set-editor-padding', (_event, value: number) => {
    const config = loadConfig()
    config.editorPadding = Number.isFinite(value) && value >= 8 && value <= 48 ? value : 24
    saveConfig(config)
    return true
  })

  // 缩略图（minimap）开关设置
  ipcMain.handle('set-show-minimap', (_event, enabled: boolean) => {
    const config = loadConfig()
    config.showMinimap = enabled === true
    saveConfig(config)
    return true
  })

  // v1.1.0：序号补全开关设置（VS Code 风格 inline suggestion）
  ipcMain.handle('set-enable-sequence-suggestion', (_event, enabled: boolean) => {
    const config = loadConfig()
    config.enableSequenceSuggestion = enabled === true
    saveConfig(config)
    return true
  })

  // v1.1.0：序号补全接受方式设置（方案 B：仅 tab / enter）
  ipcMain.handle('set-seq-accept-mode', (_event, mode: string, enabled: boolean) => {
    const config = loadConfig()
    if (mode === 'tab') config.seqAcceptOnTab = enabled === true
    else if (mode === 'enter') config.seqAcceptOnEnter = enabled === true
    saveConfig(config)
    return true
  })

  // 设置导航栏按钮显示/隐藏
  // 接收按钮 key 和 enabled 状态，更新 config 并持久化
  ipcMain.handle('set-navbar-button', (_event, key: string, enabled: boolean) => {
    // 设置按钮禁止隐藏（入口保护：防止用户隐藏后无法打开设置面板恢复）
    if (key === 'settings') {
      return false
    }
    const config = loadConfig()
    if (!config.navbarButtons) {
      config.navbarButtons = {
        pin: true, color: true, newBtn: true,
        copy: true, notes: true, settings: true,
      }
    }
    if (key in config.navbarButtons) {
      (config.navbarButtons as Record<string, boolean>)[key] = enabled === true
      saveConfig(config)
      return true
    }
    return false
  })

  // v1.1.0：显示/隐藏调试面板
  ipcMain.handle('set-show-debug-tab', (_event, enabled: boolean) => {
    const config = loadConfig()
    config.showDebugTab = enabled === true
    saveConfig(config)
    return true
  })

  // ===== 工作区相关 IPC handler =====

  ipcMain.handle('get-workspaces', () => {
    return loadWorkspaces()
  })

  // 创建工作区，返回更新后的 Workspace[]
  ipcMain.handle('create-workspace', (_event, name: string, icon: string) => {
    if (typeof name !== 'string' || !name.trim()) return loadWorkspaces()
    const workspaces = loadWorkspaces()
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: name.trim(),
      icon: typeof icon === 'string' && icon ? icon : '📝',
      createdAt: new Date().toISOString(),
    }
    workspaces.push(workspace)
    saveWorkspaces(workspaces)
    return workspaces
  })

  // 删除工作区，该工作区下的笔记 workspace 设为''，返回更新后的 Workspace[]
  ipcMain.handle('delete-workspace', (_event, id: string) => {
    let workspaces = loadWorkspaces()
    workspaces = workspaces.filter(w => w.id !== id)
    saveWorkspaces(workspaces)
    // 将该工作区下的笔记 workspace 设为''（默认区）
    const index = loadNoteIndex()
    for (const entry of index) {
      if (entry.workspace === id) {
        const note = loadNote(entry.id)
        if (note) {
          note.workspace = ''
          note.updatedAt = new Date().toISOString()
          saveNote(note)
        }
      }
    }
    // 如果默认工作区被删除，重置为''
    const config = loadConfig()
    if (config.defaultWorkspaceId === id) {
      config.defaultWorkspaceId = ''
      saveConfig(config)
    }
    return workspaces
  })

  // 重命名工作区，返回更新后的 Workspace[]
  ipcMain.handle('rename-workspace', (_event, id: string, name: string) => {
    if (typeof name !== 'string' || !name.trim()) return loadWorkspaces()
    const workspaces = loadWorkspaces()
    const ws = workspaces.find(w => w.id === id)
    if (!ws) return workspaces
    ws.name = name.trim()
    saveWorkspaces(workspaces)
    return workspaces
  })

  // 更新工作区图标，返回更新后的 Workspace[]
  ipcMain.handle('update-workspace-icon', (_event, id: string, icon: string) => {
    const workspaces = loadWorkspaces()
    const ws = workspaces.find(w => w.id === id)
    if (!ws) return workspaces
    ws.icon = typeof icon === 'string' && icon ? icon : '📝'
    saveWorkspaces(workspaces)
    return workspaces
  })

  // 移动笔记到指定工作区，返回更新后的 NoteIndexEntry[]
  ipcMain.handle('move-note-to-workspace', (_event, noteId: string, workspaceId: string) => {
    const note = loadNote(noteId)
    if (!note) return loadNoteIndex()
    note.workspace = typeof workspaceId === 'string' ? workspaceId : ''
    note.updatedAt = new Date().toISOString()
    saveNote(note)
    return loadNoteIndex()
  })

  // 设置默认新建笔记工作区
  ipcMain.handle('set-default-workspace', (_event, workspaceId: string) => {
    const config = loadConfig()
    config.defaultWorkspaceId = typeof workspaceId === 'string' ? workspaceId : ''
    saveConfig(config)
    return true
  })

  // ===== 标签相关 IPC handler =====

  // get-tags：动态统计每个标签被多少笔记使用，覆盖 tags.json 中的 usageCount
  // 这样无论添加/删除标签、添加/删除笔记，返回的 usageCount 始终准确
  ipcMain.handle('get-tags', () => {
    return getTagsWithUsage()
  })

  // 创建标签，返回更新后的 Tag[]（带使用次数统计）
  ipcMain.handle('create-tag', (_event, name: string, color: string) => {
    if (typeof name !== 'string' || !name.trim()) return getTagsWithUsage()
    const tags = loadTags()
    const tag: Tag = {
      id: crypto.randomUUID(),
      name: name.trim(),
      color: typeof color === 'string' && color ? color : '#888888',
      usageCount: 0,
    }
    tags.push(tag)
    saveTags(tags)
    return getTagsWithUsage()
  })

  // 删除标签，从所有笔记的 tags 数组中移除，返回更新后的 Tag[]（带使用次数统计）
  ipcMain.handle('delete-tag', (_event, id: string) => {
    let tags = loadTags()
    tags = tags.filter(t => t.id !== id)
    saveTags(tags)
    // 从所有笔记的 tags 数组中移除该标签
    const index = loadNoteIndex()
    for (const entry of index) {
      if (entry.tags.includes(id)) {
        const note = loadNote(entry.id)
        if (note) {
          note.tags = note.tags.filter(t => t !== id)
          note.updatedAt = new Date().toISOString()
          saveNote(note)
        }
      }
    }
    return getTagsWithUsage()
  })

  // 重命名标签，返回更新后的 Tag[]（带使用次数统计）
  ipcMain.handle('rename-tag', (_event, id: string, name: string) => {
    if (typeof name !== 'string' || !name.trim()) return getTagsWithUsage()
    const tags = loadTags()
    const tag = tags.find(t => t.id === id)
    if (!tag) return getTagsWithUsage()
    tag.name = name.trim()
    saveTags(tags)
    return getTagsWithUsage()
  })

  // 更新标签颜色，返回更新后的 Tag[]（带使用次数统计）
  ipcMain.handle('update-tag-color', (_event, id: string, color: string) => {
    if (typeof color !== 'string' || !color) return getTagsWithUsage()
    const tags = loadTags()
    const tag = tags.find(t => t.id === id)
    if (!tag) return getTagsWithUsage()
    tag.color = color
    saveTags(tags)
    return getTagsWithUsage()
  })

  // ===== 搜索 IPC handler =====

  // 搜索笔记（搜索 title 和 content），返回匹配的 NoteIndexEntry[]
  ipcMain.handle('search-notes', (_event, keyword: string) => {
    if (typeof keyword !== 'string' || !keyword.trim()) return []
    const kw = keyword.toLowerCase()
    const index = loadNoteIndex()
    const result: NoteIndexEntry[] = []
    for (const entry of index) {
      // 先检查 title 是否匹配（无需读文件）
      if (entry.title.toLowerCase().includes(kw)) {
        result.push(entry)
        continue
      }
      // title 不匹配则读取文件检查 content
      const note = loadNote(entry.id)
      if (note && note.content.toLowerCase().includes(kw)) {
        result.push(entry)
      }
    }
    return result
  })

  // ===== Task 12: 文件打开/保存 IPC handler =====

  // 打开文件：读取 .md/.markdown 文件内容，返回 { content, fileName, filePath } 或 null
  ipcMain.handle('open-file', (_event, filePath: string) => {
    try {
      // 路径安全校验
      const resolved = validateFilePath(filePath)
      if (!resolved) {
        console.error('文件路径无效或不存在:', filePath)
        return null
      }
      // 文件大小限制：防止超大文件导致内存溢出（上限 10MB）
      const stat = fs.statSync(resolved)
      const MAX_FILE_SIZE = 10 * 1024 * 1024
      if (stat.size > MAX_FILE_SIZE) {
        console.error(`文件过大（${(stat.size / 1024 / 1024).toFixed(1)}MB），超过 10MB 上限`)
        return null
      }
      const content = fs.readFileSync(resolved, 'utf-8')
      const fileName = path.basename(resolved)
      return { content, fileName, filePath: resolved }
    } catch (e) {
      console.error('打开文件失败:', e)
      return null
    }
  })

  // 保存文件：将内容写入指定路径，返回 { success: boolean, error?: string }
  // v1.1.0 扩展：允许保存为任意后缀名（用户可选择保存为 .txt/.log/.json 等）
  ipcMain.handle('save-file', (_event, filePath: string, content: string) => {
    try {
      const resolved = path.resolve(filePath)
      fs.writeFileSync(resolved, content, 'utf-8')
      return { success: true }
    } catch (e) {
      console.error('保存文件失败:', e)
      return { success: false, error: String(e) }
    }
  })

  // ===== v1.1.0：文件菜单相关 IPC =====

  // 设置窗口关联文件（渲染进程打开/关闭文件时调用，保持 windowFiles 同步）
  ipcMain.handle('set-window-file', (event, filePath: string | null) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (filePath) {
      windowFiles.set(win.id, filePath)
    } else {
      windowFiles.delete(win.id)
    }
    return true
  })

  // 打开文件对话框：弹出系统选择对话框，读取选中的 .md/.markdown 文件
  ipcMain.handle('open-file-dialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '打开文件',
      filters: [
        { name: '常用文本', extensions: ['md', 'markdown', 'txt', 'text', 'log'] },
        { name: '代码文件', extensions: ['js', 'ts', 'jsx', 'tsx', 'json', 'css', 'html', 'xml', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'sh', 'bat', 'ps1'] },
        { name: '配置文件', extensions: ['yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    // 复用 open-file handler 的读取逻辑
    try {
      const resolved = validateFilePath(filePath)
      if (!resolved) return null
      const stat = fs.statSync(resolved)
      const MAX_FILE_SIZE = 10 * 1024 * 1024
      if (stat.size > MAX_FILE_SIZE) return null
      const content = fs.readFileSync(resolved, 'utf-8')
      const fileName = path.basename(resolved)
      // 更新窗口关联文件
      windowFiles.set(win.id, resolved)
      return { content, fileName, filePath: resolved }
    } catch (e) {
      console.error('打开文件对话框失败:', e)
      return null
    }
  })

  // 另存为：弹出系统保存对话框，将内容写入用户选择的路径
  // v1.1.0 扩展：支持保存为多种文本格式，移除后缀名限制
  ipcMain.handle('save-file-as', async (event, content: string, suggestedName?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: '窗口不存在' }
    const result = await dialog.showSaveDialog(win, {
      title: '另存为',
      defaultPath: suggestedName || 'untitled.md',
      filters: [
        { name: '常用文本', extensions: ['md', 'markdown', 'txt', 'text', 'log'] },
        { name: '代码文件', extensions: ['js', 'ts', 'jsx', 'tsx', 'json', 'css', 'html', 'xml', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'sh', 'bat', 'ps1'] },
        { name: '配置文件', extensions: ['yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) return { success: false, error: '用户取消' }
    try {
      fs.writeFileSync(result.filePath, content, 'utf-8')
      // 更新窗口关联文件
      windowFiles.set(win.id, result.filePath)
      return { success: true, filePath: result.filePath, fileName: path.basename(result.filePath) }
    } catch (e) {
      console.error('另存为失败:', e)
      return { success: false, error: String(e) }
    }
  })

  // 获取应用信息（关于对话框使用）
  ipcMain.handle('get-app-info', () => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    }
  })

  // v1.1.0：使用系统默认浏览器打开外部链接（避免在 Electron 内部打开）
  ipcMain.handle('open-external', async (_event, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return false
    await shell.openExternal(url)
    return true
  })

  // v1.1.1：异常日志 IPC
  // 打开日志文件夹（用户在设置中点击"打开日志文件夹"按钮时调用）
  ipcMain.handle('open-logs-folder', async () => {
    try {
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true })
      }
      await shell.openPath(logsDir)
      return true
    } catch (err) {
      writeErrorLog('ERROR', `Failed to open logs folder: ${err}`)
      return false
    }
  })

  // 获取日志存储路径（用于设置界面显示）
  ipcMain.handle('get-logs-path', () => {
    return logsDir
  })

  // 渲染进程写入错误日志（前端 window.onerror / unhandledrejection 捕获后通过 IPC 发送）
  ipcMain.handle('write-error-log', (_event, message: string) => {
    writeErrorLog('ERROR', `[Renderer] ${message}`)
  })

  // 强制关闭窗口（用户确认未保存对话框后调用，跳过未保存检查）
  ipcMain.handle('force-close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    forceClose.add(win.id)
    win.close()
  })

  // ===== 调试日志 IPC =====
  // v1.1.0：dev 模式下日志写入 d:\AOS\05_CACHE\oncepad_debug.log，方便自动化读取
  // 打包模式写入 userData/debug.log
  const debugLogPath = VITE_DEV_SERVER_URL
    ? 'd:\\AOS\\05_CACHE\\oncepad_debug.log'
    : path.join(app.getPath('userData'), 'debug.log')
  // debug.log 文件大小上限：1MB，超过则自动轮转（保留最后 200 行）
  const DEBUG_LOG_MAX_SIZE = 1024 * 1024
  ipcMain.handle('write-debug-log', (_event, message: string) => {
    // 消息长度限制：防止恶意或异常调用写入过大内容（上限 10KB）
    const MAX_MSG_LEN = 10000
    const msg = typeof message === 'string' ? message.slice(0, MAX_MSG_LEN) : String(message).slice(0, MAX_MSG_LEN)
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const line = `[${ts}] ${msg}\n`
    try {
      // 文件大小检查：超过上限时自动轮转，保留最后 200 行
      if (fs.existsSync(debugLogPath)) {
        const stat = fs.statSync(debugLogPath)
        if (stat.size > DEBUG_LOG_MAX_SIZE) {
          const content = fs.readFileSync(debugLogPath, 'utf-8')
          const lines = content.split('\n').filter(Boolean)
          const kept = lines.slice(-200).join('\n') + '\n'
          fs.writeFileSync(debugLogPath, kept, 'utf-8')
        }
      }
      fs.appendFileSync(debugLogPath, line, 'utf-8')
    } catch (e) {
      console.error('写入调试日志失败:', e)
    }
    return debugLogPath
  })

  ipcMain.handle('read-debug-log', () => {
    try {
      const content = fs.readFileSync(debugLogPath, 'utf-8')
      // 返回最后 100 行
      const lines = content.split('\n').filter(Boolean)
      return lines.slice(-100).join('\n')
    } catch {
      return ''
    }
  })

  ipcMain.handle('clear-debug-log', () => {
    try {
      fs.writeFileSync(debugLogPath, '', 'utf-8')
      return true
    } catch {
      return false
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // macOS: 点击 dock 图标时，如果没有窗口则创建新窗口，否则聚焦最后一个窗口
  if (windows.size === 0) {
    createWindow(loadConfig())
  } else {
    const lastWin = getLastWindow()
    if (lastWin) {
      lastWin.show()
      lastWin.focus()
    }
  }
})

app.on('will-quit', () => {
  // 各窗口的文本已在 close 事件中保存到历史，此处仅注销快捷键
  globalShortcut.unregisterAll()
  // 销毁托盘，避免退出后托盘图标残留
  if (tray) {
    tray.destroy()
    tray = null
  }
})
