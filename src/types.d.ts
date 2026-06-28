export interface HistoryEntry {
  id: string
  text: string
  createdAt: string
}

// ===== 笔记存储相关类型（Task 1 新增） =====

// 笔记颜色标记
export type NoteColor = 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'
// 笔记类型：草稿 / 收藏
export type NoteType = 'draft' | 'pin'
// 笔记格式：纯文本 / Markdown
export type NoteFormat = 'plain' | 'md'

// 笔记完整数据结构
export interface Note {
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
  pinned?: boolean        // 是否置顶（仅在收藏列表内生效，置顶笔记显示在列表顶部）
}

// 笔记索引条目（用于列表展示，避免加载全部正文）
export interface NoteIndexEntry {
  id: string
  title: string
  type: NoteType
  color: NoteColor
  tags: string[]
  workspace: string
  updatedAt: string
  expiresAt: string | null
  pinned?: boolean        // 是否置顶
}

// 工作区
export interface Workspace {
  id: string
  name: string
  icon: string            // emoji 图标
  createdAt: string
}

// 标签
export interface Tag {
  id: string
  name: string
  color: string
  usageCount: number
}

// 笔记查询过滤参数
export interface NoteQuery {
  workspaceId?: string
  type?: NoteType
  tagId?: string
  searchKeyword?: string
}

// ===== Task 12: 文件打开/保存相关类型 =====

// 文件内容返回结构（openFile 的返回值）
export interface FileContent {
  content: string
  fileName: string
  filePath: string
}

// 文件保存结果（saveFile 的返回值）
export interface SaveFileResult {
  success: boolean
  error?: string
}

// v1.1.0：另存为结果（saveFileAs 的返回值）
export interface SaveAsResult {
  success: boolean
  filePath?: string
  fileName?: string
  error?: string
}

// v1.1.0：应用信息（getAppInfo 的返回值，用于关于对话框）
export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
}

export interface AppConfig {
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
  windowBounds?: { x: number; y: number; width: number; height: number }
  closeLastWindowBehavior?: 'hide' | 'confirm' | 'quit'
  draftTtlDays?: number
  autoLaunch?: boolean
  autoLaunchHidden?: boolean
  blurToHide?: boolean
  defaultWorkspaceId?: string
  showLineNumbers?: boolean
  lineNumberMode?: 'logical' | 'visual'
  editorLineHeight?: number
  editorPadding?: number
  showMinimap?: boolean
  // 导航栏按钮显示/隐藏配置
  navbarButtons?: {
    pin: boolean
    color: boolean
    newBtn: boolean
    copy: boolean
    notes: boolean
    settings: boolean
  }
  // v1.1.0：是否显示调试面板（默认 false）
  showDebugTab?: boolean
  // v1.1.0：序号补全开关（VS Code 风格 inline suggestion，默认 false）
  enableSequenceSuggestion?: boolean
  // v1.1.0：序号补全接受方式（方案 B：仅 Tab/Enter，移除"继续输入即接受"）
  seqAcceptOnTab?: boolean
  seqAcceptOnEnter?: boolean
}

// ===== 回收站条目类型（回收站机制新增） =====
export interface TrashNoteEntry {
  id: string
  title: string
  type: NoteType
  color: NoteColor
  tags: string[]
  workspace: string
  format: NoteFormat
  deletedAt: string
  expiresAt: string
}

export interface ElectronAPI {
  getHistory: () => Promise<HistoryEntry[]>
  saveToHistory: (text: string) => Promise<HistoryEntry[]>
  deleteHistoryEntry: (id: string) => Promise<HistoryEntry[]>
  copyToClipboard: (text: string) => Promise<void>
  syncText: (text: string) => Promise<void>
  getConfig: () => Promise<AppConfig>
  setShortcut: (shortcut: string) => Promise<boolean>
  setLocalShortcut: (name: 'new' | 'copy', shortcut: string) => Promise<boolean>
  setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<boolean>
  setIndent: (indentType: string, indentSize: number) => Promise<void>
  getSystemFonts: () => Promise<string[]>
  setFontEn: (fontEn: string) => Promise<boolean>
  setFontCn: (fontCn: string) => Promise<boolean>
  setFontSize: (fontSize: number) => Promise<boolean>
  setFontSplit: (fontSplit: boolean) => Promise<boolean>
  setUiScale: (uiScale: number) => Promise<boolean>
  setLanguage: (language: string) => Promise<boolean>
  hideWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  setCloseLastWindowBehavior: (behavior: string) => Promise<boolean>

  // ===== Task 4: 笔记相关方法 =====
  getNotes: (query?: NoteQuery) => Promise<NoteIndexEntry[]>
  getNote: (id: string) => Promise<Note | null>
  saveNote: (note: Note) => Promise<NoteIndexEntry[]>
  // v1.1.2 修复 Bug S-1：同步保存笔记（beforeunload 场景使用）
  saveNoteSync: (note: Note) => boolean
  deleteNote: (id: string) => Promise<NoteIndexEntry[]>
  pinNote: (id: string) => Promise<Note | null>
  setNotePinned: (id: string, pinned: boolean) => Promise<NoteIndexEntry[]>

  // ===== 回收站相关方法（回收站机制新增） =====
  getTrashNotes: () => Promise<TrashNoteEntry[]>
  restoreNote: (id: string) => Promise<NoteIndexEntry[]>
  permanentlyDeleteNote: (id: string) => Promise<TrashNoteEntry[]>
  emptyTrash: () => Promise<TrashNoteEntry[]>
  setDraftTtlDays: (days: number) => Promise<boolean>
  setAutoLaunch: (enabled: boolean, hidden: boolean) => Promise<boolean>
  setBlurToHide: (enabled: boolean) => Promise<boolean>
  setShowLineNumbers: (enabled: boolean) => Promise<boolean>
  setLineNumberMode: (mode: 'logical' | 'visual') => Promise<boolean>
  setEditorLineHeight: (value: number) => Promise<boolean>
  setEditorPadding: (value: number) => Promise<boolean>
  setShowMinimap: (enabled: boolean) => Promise<boolean>
  // 导航栏按钮显示/隐藏（key: pin/color/newBtn/copy/notes/settings）
  setNavbarButton: (key: string, enabled: boolean) => Promise<boolean>
  // v1.1.0：显示/隐藏调试面板
  setShowDebugTab: (enabled: boolean) => Promise<boolean>
  // v1.1.0：序号补全开关（VS Code 风格 inline suggestion）
  setEnableSequenceSuggestion: (enabled: boolean) => Promise<boolean>
  // v1.1.0：序号补全接受方式（key: seqAcceptOnTab / seqAcceptOnEnter）
  setSeqAcceptMode: (key: string, enabled: boolean) => Promise<boolean>
  // 导航栏按钮配置
  navbarButtons?: {
    pin: boolean
    color: boolean
    newBtn: boolean
    copy: boolean
    notes: boolean
    settings: boolean
  }

  // ===== 工作区相关方法 =====
  getWorkspaces: () => Promise<Workspace[]>
  createWorkspace: (name: string, icon: string) => Promise<Workspace[]>
  deleteWorkspace: (id: string) => Promise<Workspace[]>
  // 重命名工作区
  renameWorkspace: (id: string, name: string) => Promise<Workspace[]>
  // 更新工作区图标
  updateWorkspaceIcon: (id: string, icon: string) => Promise<Workspace[]>
  // 移动笔记到指定工作区
  moveNoteToWorkspace: (noteId: string, workspaceId: string) => Promise<NoteIndexEntry[]>
  // 设置默认新建笔记工作区
  setDefaultWorkspace: (workspaceId: string) => Promise<boolean>

  // ===== 标签相关方法 =====
  getTags: () => Promise<Tag[]>
  createTag: (name: string, color: string) => Promise<Tag[]>
  deleteTag: (id: string) => Promise<Tag[]>
  // 重命名标签
  renameTag: (id: string, name: string) => Promise<Tag[]>
  // 更新标签颜色
  updateTagColor: (id: string, color: string) => Promise<Tag[]>

  // ===== 搜索方法 =====
  searchNotes: (keyword: string) => Promise<NoteIndexEntry[]>

  // ===== Task 12: 文件打开/保存方法 =====
  // 打开文件：读取 .md/.markdown 文件内容，返回 { content, fileName, filePath } 或 null
  openFile: (filePath: string) => Promise<FileContent | null>
  // 保存文件：将内容写入指定路径，返回 { success: boolean, error?: string }
  saveFile: (filePath: string, content: string) => Promise<SaveFileResult>
  // v1.1.0：设置窗口关联文件
  setWindowFile: (filePath: string | null) => Promise<boolean>
  // v1.1.0：打开文件对话框
  openFileDialog: () => Promise<FileContent | null>
  // v1.1.0：另存为
  saveFileAs: (content: string, suggestedName?: string) => Promise<SaveAsResult>
  // v1.1.0：获取应用信息
  getAppInfo: () => Promise<AppInfo>
  // v1.1.0：使用系统默认浏览器打开外部链接
  openExternal: (url: string) => Promise<boolean>
  // v1.1.0：强制关闭窗口
  forceCloseWindow: () => Promise<void>
  // v1.1.0：监听主进程关闭请求
  // v1.1.3 修复 Bug M-2：返回移除函数，避免监听器累积
  onRequestClose: (callback: () => void) => () => void
  // v1.1.1：监听主进程"在已有窗口加载文件"请求（双击文件复用窗口）
  // v1.1.3 修复 Bug M-2：返回移除函数，避免监听器累积
  onLoadFileInWindow: (callback: (filePath: string) => void) => () => void
  // v1.1.1：打开日志文件夹（设置界面入口）
  openLogsFolder: () => Promise<boolean>
  // v1.1.1：获取日志存储路径（设置界面显示）
  getLogsPath: () => Promise<string>
  // v1.1.1：渲染进程写入错误日志（window.onerror 捕获后发送）
  writeErrorLog: (message: string) => Promise<void>

  // ===== 调试日志方法 =====
  writeDebugLog: (message: string) => Promise<string>
  readDebugLog: () => Promise<string>
  clearDebugLog: () => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
