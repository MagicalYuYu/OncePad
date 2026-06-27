import { contextBridge, ipcRenderer } from 'electron'
import type { Note, NoteQuery } from '../src/types'

contextBridge.exposeInMainWorld('electronAPI', {
  getHistory: () => ipcRenderer.invoke('get-history'),
  saveToHistory: (text: string) => ipcRenderer.invoke('save-to-history', text),
  deleteHistoryEntry: (id: string) => ipcRenderer.invoke('delete-history-entry', id),
  copyToClipboard: (text: string) => ipcRenderer.invoke('copy-to-clipboard', text),
  syncText: (text: string) => ipcRenderer.invoke('sync-text', text),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setShortcut: (shortcut: string) => ipcRenderer.invoke('set-shortcut', shortcut),
  setLocalShortcut: (name: 'new' | 'copy', shortcut: string) => ipcRenderer.invoke('set-local-shortcut', name, shortcut),
  setAlwaysOnTop: (alwaysOnTop: boolean) => ipcRenderer.invoke('set-always-on-top', alwaysOnTop),
  setIndent: (indentType: string, indentSize: number) => ipcRenderer.invoke('set-indent', indentType, indentSize),
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),
  setFontEn: (fontEn: string) => ipcRenderer.invoke('set-font-en', fontEn),
  setFontCn: (fontCn: string) => ipcRenderer.invoke('set-font-cn', fontCn),
  setFontSize: (fontSize: number) => ipcRenderer.invoke('set-font-size', fontSize),
  setFontSplit: (fontSplit: boolean) => ipcRenderer.invoke('set-font-split', fontSplit),
  setUiScale: (uiScale: number) => ipcRenderer.invoke('set-ui-scale', uiScale),
  setLanguage: (language: string) => ipcRenderer.invoke('set-language', language),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  setCloseLastWindowBehavior: (behavior: string) => ipcRenderer.invoke('set-close-last-window-behavior', behavior),

  // ===== Task 4: 笔记相关 IPC 方法 =====
  getNotes: (query?: NoteQuery) => ipcRenderer.invoke('get-notes', query),
  getNote: (id: string) => ipcRenderer.invoke('get-note', id),
  saveNote: (note: Note) => ipcRenderer.invoke('save-note', note),
  deleteNote: (id: string) => ipcRenderer.invoke('delete-note', id),
  pinNote: (id: string) => ipcRenderer.invoke('pin-note', id),
  setNotePinned: (id: string, pinned: boolean) => ipcRenderer.invoke('set-note-pinned', id, pinned),

  // ===== 回收站相关 IPC 方法（回收站机制新增） =====
  getTrashNotes: () => ipcRenderer.invoke('get-trash-notes'),
  restoreNote: (id: string) => ipcRenderer.invoke('restore-note', id),
  permanentlyDeleteNote: (id: string) => ipcRenderer.invoke('permanently-delete-note', id),
  emptyTrash: () => ipcRenderer.invoke('empty-trash'),
  setDraftTtlDays: (days: number) => ipcRenderer.invoke('set-draft-ttl-days', days),
  setAutoLaunch: (enabled: boolean, hidden: boolean) => ipcRenderer.invoke('set-auto-launch', enabled, hidden),
  setBlurToHide: (enabled: boolean) => ipcRenderer.invoke('set-blur-to-hide', enabled),
  setShowLineNumbers: (enabled: boolean) => ipcRenderer.invoke('set-show-line-numbers', enabled),
  setLineNumberMode: (mode: 'logical' | 'visual') => ipcRenderer.invoke('set-line-number-mode', mode),
  setEditorLineHeight: (value: number) => ipcRenderer.invoke('set-editor-line-height', value),
  setEditorPadding: (value: number) => ipcRenderer.invoke('set-editor-padding', value),
  setShowMinimap: (enabled: boolean) => ipcRenderer.invoke('set-show-minimap', enabled),
  // 导航栏按钮显示/隐藏（key: pin/color/newBtn/copy/notes/settings）
  setNavbarButton: (key: string, enabled: boolean) => ipcRenderer.invoke('set-navbar-button', key, enabled),
  // v1.1.0：显示/隐藏调试面板
  setShowDebugTab: (enabled: boolean) => ipcRenderer.invoke('set-show-debug-tab', enabled),
  // v1.1.0：序号补全开关（VS Code 风格 inline suggestion）
  setEnableSequenceSuggestion: (enabled: boolean) => ipcRenderer.invoke('set-enable-sequence-suggestion', enabled),
  // v1.1.0：序号补全接受方式（key: seqAcceptOnType / seqAcceptOnTab / seqAcceptOnEnter）
  setSeqAcceptMode: (key: string, enabled: boolean) => ipcRenderer.invoke('set-seq-accept-mode', key, enabled),

  // ===== 工作区相关 IPC 方法 =====
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  createWorkspace: (name: string, icon: string) => ipcRenderer.invoke('create-workspace', name, icon),
  deleteWorkspace: (id: string) => ipcRenderer.invoke('delete-workspace', id),
  renameWorkspace: (id: string, name: string) => ipcRenderer.invoke('rename-workspace', id, name),
  updateWorkspaceIcon: (id: string, icon: string) => ipcRenderer.invoke('update-workspace-icon', id, icon),
  moveNoteToWorkspace: (noteId: string, workspaceId: string) => ipcRenderer.invoke('move-note-to-workspace', noteId, workspaceId),
  setDefaultWorkspace: (workspaceId: string) => ipcRenderer.invoke('set-default-workspace', workspaceId),

  // ===== 标签相关 IPC 方法 =====
  getTags: () => ipcRenderer.invoke('get-tags'),
  createTag: (name: string, color: string) => ipcRenderer.invoke('create-tag', name, color),
  deleteTag: (id: string) => ipcRenderer.invoke('delete-tag', id),
  renameTag: (id: string, name: string) => ipcRenderer.invoke('rename-tag', id, name),
  updateTagColor: (id: string, color: string) => ipcRenderer.invoke('update-tag-color', id, color),

  // ===== 搜索 IPC 方法 =====
  searchNotes: (keyword: string) => ipcRenderer.invoke('search-notes', keyword),

  // ===== Task 12: 文件打开/保存 IPC 方法 =====
  // 打开文件：读取 .md/.markdown 文件内容，返回 { content, fileName, filePath } 或 null
  openFile: (filePath: string) => ipcRenderer.invoke('open-file', filePath),
  // 保存文件：将内容写入指定路径，返回 { success: boolean, error?: string }
  saveFile: (filePath: string, content: string) => ipcRenderer.invoke('save-file', filePath, content),
  // v1.1.0：设置窗口关联文件（打开/关闭文件时同步主进程状态）
  setWindowFile: (filePath: string | null) => ipcRenderer.invoke('set-window-file', filePath),
  // v1.1.0：打开文件对话框（弹出系统选择框）
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  // v1.1.0：另存为（弹出系统保存框，返回 { success, filePath?, fileName?, error? }）
  saveFileAs: (content: string, suggestedName?: string) => ipcRenderer.invoke('save-file-as', content, suggestedName),
  // v1.1.0：获取应用信息（关于对话框使用）
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  // v1.1.0：使用系统默认浏览器打开外部链接（避免在 Electron 内部打开）
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  // v1.1.0：强制关闭窗口（跳过未保存检查）
  forceCloseWindow: () => ipcRenderer.invoke('force-close-window'),
  // v1.1.0：监听主进程的关闭请求（Alt+F4 / 系统关闭时触发）
  onRequestClose: (callback: () => void) => ipcRenderer.on('request-close', () => callback()),
  // v1.1.1：监听主进程的"在已有窗口加载文件"请求（双击文件时复用已有窗口）
  onLoadFileInWindow: (callback: (filePath: string) => void) => ipcRenderer.on('load-file-in-window', (_e, filePath: string) => callback(filePath)),
  // v1.1.1：打开日志文件夹（设置界面"打开日志文件夹"按钮）
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  // v1.1.1：获取日志存储路径（设置界面显示）
  getLogsPath: () => ipcRenderer.invoke('get-logs-path'),
  // v1.1.1：渲染进程写入错误日志（前端 window.onerror 捕获后通过 IPC 发送）
  writeErrorLog: (message: string) => ipcRenderer.invoke('write-error-log', message),

  // ===== 调试日志 IPC 方法 =====
  writeDebugLog: (message: string) => ipcRenderer.invoke('write-debug-log', message),
  readDebugLog: () => ipcRenderer.invoke('read-debug-log'),
  clearDebugLog: () => ipcRenderer.invoke('clear-debug-log'),
})
