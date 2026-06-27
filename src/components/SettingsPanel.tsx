import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Workspace, Tag } from '../types'

// ===== 设置面板相关的本地类型 =====
// 这两个类型原本定义在 App.tsx 中，拆分 SettingsPanel 组件时迁移至此处并导出，
// 供 App.tsx 复用，避免循环依赖。
export type SettingsTab = 'general' | 'appearance' | 'editor' | 'shortcuts' | 'management' | 'debug'
export type ShortcutTarget = 'toggle' | 'new' | 'copy'

/**
 * SettingsPanel 组件 Props 接口
 *
 * 设计原则：纯展示组件（Presentational Component）
 * - 所有状态（state）由父组件 App.tsx 持有，通过 props 传入
 * - 所有事件处理函数（handlers）由父组件通过 useCallback 定义，通过 props 传入
 * - 组件本身不持有任何业务状态，只负责 UI 渲染和事件转发
 * - 这样做的好处：保持单向数据流清晰，不破坏现有 useCallback 依赖关系
 *
 * 字段分组：
 *   1. 面板状态（activeTab / onTabChange）
 *   2. 通用设置（language / alwaysOnTop / closeLastWindowBehavior / draftTtlDays / autoLaunch / indent）
 *   3. 外观设置（fontEn / fontCn / fontSize / fontSplit / uiScale / systemFonts）
 *   4. 快捷键设置（toggle/new/copy 三组 + recordingTarget）
 *   5. 调试设置（debugMode / debugLogs）
 */
interface SettingsPanelProps {
  // === 面板状态 ===
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void

  // === 通用设置 ===
  language: string
  onLanguageChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  alwaysOnTop: boolean
  onAlwaysOnTopChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  closeLastWindowBehavior: 'hide' | 'confirm' | 'quit'
  onCloseLastWindowBehaviorChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  draftTtlDays: number
  onDraftTtlDaysChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  autoLaunch: boolean
  autoLaunchHidden: boolean
  onAutoLaunchChange: (enabled: boolean) => void
  onAutoLaunchHiddenChange: (hidden: boolean) => void
  blurToHide: boolean
  onBlurToHideChange: (enabled: boolean) => void
  showLineNumbers: boolean
  onShowLineNumbersChange: (enabled: boolean) => void
  // 行号模式
  lineNumberMode: 'logical' | 'visual'
  onLineNumberModeChange: (mode: 'logical' | 'visual') => void
  // 编辑器行高/内边距
  editorLineHeight: number
  editorPadding: number
  onEditorLineHeightChange: (value: number) => void
  onEditorPaddingChange: (value: number) => void
  // 缩略图（minimap）
  showMinimap: boolean
  onShowMinimapChange: (enabled: boolean) => void
  // 主题模式
  theme: 'dark' | 'light'
  onThemeChange: (theme: 'dark' | 'light') => void
  indentType: 'space' | 'tab'
  indentSize: number
  onIndentTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  onIndentSizeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void

  // === 外观设置 ===
  fontEn: string
  fontCn: string
  fontSize: number
  fontSplit: boolean
  systemFonts: string[]
  uiScale: number
  uiScalePreview: number
  onFontEnChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  onFontCnChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  onFontSizeChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFontSplitChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onUiScaleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onApplyUiScale: (scale: number) => void
  // 导航栏按钮显示/隐藏配置（6 个开关：pin/color/newBtn/copy/notes/settings）
  navbarButtons: {
    pin: boolean
    color: boolean
    newBtn: boolean
    copy: boolean
    notes: boolean
    settings: boolean
  }
  onNavbarButtonChange: (key: string, enabled: boolean) => void

  // === 快捷键设置 ===
  toggleShortcut: string
  toggleShortcutInput: string
  newShortcut: string
  newShortcutInput: string
  copyShortcut: string
  copyShortcutInput: string
  recordingTarget: ShortcutTarget | null
  // setRecordingTarget 的类型签名，兼容直接传值和函数式更新两种用法
  onSetRecordingTarget: (target: ShortcutTarget | null | ((prev: ShortcutTarget | null) => ShortcutTarget | null)) => void
  onShortcutKeyDown: (e: React.KeyboardEvent) => void
  onSaveToggleShortcut: () => void
  onSaveNewShortcut: () => void
  onSaveCopyShortcut: () => void
  onResetToggleShortcut: () => void
  onResetNewShortcut: () => void
  onResetCopyShortcut: () => void
  onClearToggleShortcut: () => void
  onClearNewShortcut: () => void
  onClearCopyShortcut: () => void

  // === 调试设置 ===
  debugMode: boolean
  debugLogs: string[]
  onDebugModeChange: (enabled: boolean) => void
  onClearDebugLogs: () => void
  // v1.1.0：调试面板显示开关（管理标签页内）
  showDebugTab: boolean
  onShowDebugTabChange: (enabled: boolean) => void
  // v1.1.0：序号补全开关（管理标签页→高级中启用）
  enableSequenceSuggestion: boolean
  onEnableSequenceSuggestionChange: (enabled: boolean) => void
  // v1.1.0：序号补全接受方式（方案 B：仅 Tab/Enter，移除"继续输入即接受"）
  seqAcceptOnTab: boolean
  seqAcceptOnEnter: boolean
  onSeqAcceptModeChange: (mode: 'tab' | 'enter', enabled: boolean) => void

  // === 工作区与标签管理 ===
  workspaces: Workspace[]
  tags: Tag[]
  defaultWorkspaceId: string
  // 工作区操作回调
  onRenameWorkspace: (id: string, name: string) => void
  onUpdateWorkspaceIcon: (id: string, icon: string) => void
  onDeleteWorkspace: (id: string, name: string) => void
  onSetDefaultWorkspace: (workspaceId: string) => void
  // 标签操作回调
  onRenameTag: (id: string, name: string) => void
  onUpdateTagColor: (id: string, color: string) => void
  onDeleteTag: (id: string, name: string) => void
}

/**
 * 设置面板组件
 *
 * 包含 6 个设置标签页：
 *   - general（常规）：语言、置顶、关闭行为、草稿清理、开机自启、失焦隐藏、缩进
 *   - appearance（外观）：主题、英文字体、中文字体、字体分离、字号、UI 缩放
 *   - editor（编辑器）：行号、缩略图、行高、内边距
 *   - shortcuts（快捷键）：显隐窗口 / 新建 / 复制 三个快捷键的录制和保存
 *   - management（管理）：工作区管理 + 标签管理（子标签切换）
 *   - debug（调试）：调试模式开关、调试日志查看
 */
export function SettingsPanel(props: SettingsPanelProps) {
  const { t } = useTranslation()
  const tabsRef = useRef<HTMLDivElement>(null)
  const tabsIndicatorRef = useRef<HTMLDivElement>(null)
  const [managementSubTab, setManagementSubTab] = useState<'workspace' | 'tag' | 'advanced'>('workspace')
  // v1.1.1：异常日志路径（设置→管理→高级中显示，用户可快速跳转到日志目录）
  const [logsPath, setLogsPath] = useState('')

  // 加载日志路径（组件挂载时异步获取）
  useEffect(() => {
    window.electronAPI.getLogsPath().then(setLogsPath)
  }, [])

  // 打开日志文件夹
  const handleOpenLogsFolder = () => {
    window.electronAPI.openLogsFolder()
  }

  // 标签栏滚轮水平滚动：鼠标滚轮垂直滚动转换为水平滚动
  const handleTabsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY
    }
  }

  // 滑动指示器：相对于 tabs 内容定位（加 scrollLeft），指示器随 tabs 一起滚动
  // 指示器在 tabs 容器内部，滚动时自动跟随，无需 scroll 事件监听
  const updateIndicator = () => {
    const tabs = tabsRef.current
    const indicator = tabsIndicatorRef.current
    if (!tabs || !indicator) return
    const activeBtn = tabs.querySelector<HTMLButtonElement>('.settings-tab.active')
    if (!activeBtn) return
    // 指示器在 tabs 容器内部，使用 offsetLeft 直接获取按钮在内容中的位置
    const left = activeBtn.offsetLeft
    indicator.style.transform = `translateX(${left}px)`
    indicator.style.width = `${activeBtn.offsetWidth}px`
  }

  useEffect(() => {
    updateIndicator()
    // 切换 tab 时滚动到可见区域
    const tabs = tabsRef.current
    if (!tabs) return
    const activeBtn = tabs.querySelector<HTMLButtonElement>('.settings-tab.active')
    if (!activeBtn) return
    const tabsRect = tabs.getBoundingClientRect()
    const btnRect = activeBtn.getBoundingClientRect()
    if (btnRect.left < tabsRect.left) {
      tabs.scrollLeft -= (tabsRect.left - btnRect.left + 8)
    } else if (btnRect.right > tabsRect.right) {
      tabs.scrollLeft += (btnRect.right - tabsRect.right + 8)
    }
  }, [props.activeTab])

  // 窗口尺寸变化时重新定位指示器
  useEffect(() => {
    const ro = new ResizeObserver(() => updateIndicator())
    if (tabsRef.current) ro.observe(tabsRef.current)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="panel settings-panel">
      <div className="panel-header">
        <h3>{t('settings.title')}</h3>
        <div className="settings-tabs-wrapper">
          <div className="settings-tabs" onWheel={handleTabsWheel} ref={tabsRef}>
            <button
              className={`settings-tab ${props.activeTab === 'general' ? 'active' : ''}`}
              onClick={() => props.onTabChange('general')}
              data-tab="general"
            >
              <span className="tab-text">{t('settings.tabGeneral', '常规')}</span>
            </button>
            <button
              className={`settings-tab ${props.activeTab === 'appearance' ? 'active' : ''}`}
              onClick={() => props.onTabChange('appearance')}
              data-tab="appearance"
            >
              <span className="tab-text">{t('settings.tabAppearance', '外观')}</span>
            </button>
            <button
              className={`settings-tab ${props.activeTab === 'editor' ? 'active' : ''}`}
              onClick={() => props.onTabChange('editor')}
              data-tab="editor"
            >
              <span className="tab-text">{t('settings.tabEditor', '编辑器')}</span>
            </button>
            <button
              className={`settings-tab ${props.activeTab === 'shortcuts' ? 'active' : ''}`}
              onClick={() => props.onTabChange('shortcuts')}
              data-tab="shortcuts"
            >
              <span className="tab-text">{t('settings.tabShortcuts', '快捷键')}</span>
            </button>
            <button
              className={`settings-tab ${props.activeTab === 'management' ? 'active' : ''}`}
              onClick={() => props.onTabChange('management')}
              data-tab="management"
            >
              <span className="tab-text">{t('settings.tabManagement', '管理')}</span>
            </button>
            {props.showDebugTab && (
              <button
                className={`settings-tab ${props.activeTab === 'debug' ? 'active' : ''}`}
                onClick={() => props.onTabChange('debug')}
                data-tab="debug"
              >
                <span className="tab-text">{t('settings.tabDebug', 'Debug')}</span>
              </button>
            )}
            <div className="settings-tabs-indicator" ref={tabsIndicatorRef} />
          </div>
          <div className="settings-tabs-scroll-fade-left" />
          <div className="settings-tabs-scroll-fade-right" />
        </div>
      </div>
      <div className="panel-content">

        {/* === 通用 Tab === */}
        {props.activeTab === 'general' && (
          <>
            <div className="settings-item">
              <div className="settings-label">{t('settings.language')}</div>
              <select
                className="settings-select settings-select-full"
                value={props.language}
                onChange={props.onLanguageChange}
              >
                <option value="zh-CN">简体中文</option>
                <option value="zh-TW">繁體中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="ru">Русский</option>
                <option value="it">Italiano</option>
              </select>
            </div>
            <div className="settings-item">
              <div className="settings-row">
                <div>
                  <div className="settings-label">{t('settings.alwaysOnTop')}</div>
                  <div className="setting-description">
                    {t('settings.alwaysOnTopDesc')}
                  </div>
                </div>
                <label className="switch" htmlFor="always-on-top-toggle">
                  <input
                    id="always-on-top-toggle"
                    type="checkbox"
                    checked={props.alwaysOnTop}
                    onChange={props.onAlwaysOnTopChange}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.closeLastWindowBehavior', '关闭最后一个窗口时')}</div>
              <div className="setting-description" style={{ marginBottom: 8 }}>
                {t('settings.closeLastWindowBehaviorDesc', '当关闭最后一个窗口时，选择应用的行为')}
              </div>
              <select
                className="settings-select settings-select-full"
                value={props.closeLastWindowBehavior}
                onChange={props.onCloseLastWindowBehaviorChange}
              >
                <option value="hide">{t('settings.closeBehaviorHide', '隐藏到托盘（推荐）')}</option>
                <option value="confirm">{t('settings.closeBehaviorConfirm', '弹窗确认退出')}</option>
                <option value="quit">{t('settings.closeBehaviorQuit', '直接退出应用')}</option>
              </select>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.draftTtlDays', '草稿自动清理时长')}</div>
              <div className="setting-description" style={{ marginBottom: 8 }}>
                {t('settings.draftTtlDaysDesc', '草稿创建后超过此时长将自动永久删除')}
              </div>
              <select
                className="settings-select settings-select-full"
                value={props.draftTtlDays}
                onChange={props.onDraftTtlDaysChange}
              >
                <option value={1}>{t('settings.draftTtl1Day', '1 天')}</option>
                <option value={2}>{t('settings.draftTtl2Days', '2 天')}</option>
                <option value={3}>{t('settings.draftTtl3Days', '3 天（推荐）')}</option>
                <option value={7}>{t('settings.draftTtl1Week', '1 周')}</option>
              </select>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.autoLaunch', '开机自启')}</div>
              <div className="setting-description" style={{ marginBottom: 8 }}>
                {t('settings.autoLaunchDesc', '系统开机时自动启动 OncePad')}
              </div>
              <div className="settings-row" style={{ marginBottom: 8 }}>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={props.autoLaunch}
                    onChange={(e) => props.onAutoLaunchChange(e.target.checked)}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
              {props.autoLaunch && (
                <div className="settings-row">
                  <span className="setting-description">{t('settings.autoLaunchHidden', '启动后隐藏到后台')}</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={props.autoLaunchHidden}
                      onChange={(e) => props.onAutoLaunchHiddenChange(e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>
              )}
            </div>
            <div className="settings-item">
              <div className="settings-row">
                <div>
                  <div className="settings-label">{t('settings.blurToHide', '失焦自动隐藏')}</div>
                  <div className="setting-description">
                    {t('settings.blurToHideDesc', '窗口失去焦点时自动隐藏到托盘')}
                  </div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={props.blurToHide}
                    onChange={(e) => props.onBlurToHideChange(e.target.checked)}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>
          </>
        )}

        {/* === 外观 Tab === */}
        {props.activeTab === 'appearance' && (
          <>
            <div className="settings-item">
              <div className="settings-label">{t('settings.theme', '主题模式')}</div>
              <div className="settings-row" style={{ marginBottom: 8 }}>
                <select
                  className="settings-select"
                  value={props.theme}
                  onChange={(e) => props.onThemeChange(e.target.value as 'dark' | 'light')}
                >
                  <option value="dark">{t('settings.themeDark', '深色')}</option>
                  <option value="light">{t('settings.themeLight', '浅色')}</option>
                </select>
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.fontEn')}</div>
              <select
                className="settings-select settings-select-full"
                value={props.fontEn}
                onChange={props.onFontEnChange}
              >
                {props.systemFonts.map((font) => (
                  <option key={font} value={font} style={{ fontFamily: `"${font}", monospace` }}>
                    {font}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.fontCn')}</div>
              <select
                className="settings-select settings-select-full"
                value={props.fontCn}
                onChange={props.onFontCnChange}
              >
                {props.systemFonts.map((font) => (
                  <option key={font} value={font} style={{ fontFamily: `"${font}", sans-serif` }}>
                    {font}
                  </option>
                ))}
              </select>
              <div className="shortcut-hint">
                {t('settings.fontCnHint')}
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-row">
                <div>
                  <div className="settings-label">{t('settings.fontSplit')}</div>
                  <div className="setting-description">
                    {t('settings.fontSplitHint')}
                  </div>
                </div>
                <label className="switch" htmlFor="font-split-toggle">
                  <input
                    id="font-split-toggle"
                    type="checkbox"
                    checked={props.fontSplit}
                    onChange={props.onFontSplitChange}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.fontSize')}</div>
              <div className="settings-row">
                <input
                  type="range"
                  min="12"
                  max="24"
                  step="1"
                  value={props.fontSize}
                  onChange={props.onFontSizeChange}
                  className="font-size-slider"
                />
                <span className="font-size-value">{props.fontSize}px</span>
              </div>
              <div className="shortcut-hint">
                {t('settings.fontSizeHint')}
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.uiScale')}</div>
              <div className="settings-row">
                <input
                  type="range"
                  min="80"
                  max="200"
                  step="10"
                  value={props.uiScalePreview}
                  onChange={props.onUiScaleChange}
                  onMouseUp={() => props.onApplyUiScale(props.uiScalePreview)}
                  onTouchEnd={() => props.onApplyUiScale(props.uiScalePreview)}
                  className="font-size-slider"
                />
                <span className="font-size-value">{props.uiScalePreview}%</span>
              </div>
              <div className="shortcut-hint">
                {t('settings.uiScaleHint')}
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.navbarButtons', '导航栏按钮')}</div>
              <div className="setting-description">
                {t('settings.navbarButtonsDesc', '自定义标题栏上显示的按钮，关闭后对应按钮将隐藏')}
              </div>
              <div className="navbar-buttons-grid">
                <label className="navbar-button-toggle">
                  <span>{t('settings.navbarPin', '收藏')}</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={props.navbarButtons.pin}
                      onChange={(e) => props.onNavbarButtonChange('pin', e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </label>
                <label className="navbar-button-toggle">
                  <span>{t('settings.navbarColor', '颜色标记')}</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={props.navbarButtons.color}
                      onChange={(e) => props.onNavbarButtonChange('color', e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </label>
                <label className="navbar-button-toggle">
                  <span>{t('settings.navbarNew', '新建')}</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={props.navbarButtons.newBtn}
                      onChange={(e) => props.onNavbarButtonChange('newBtn', e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </label>
                <label className="navbar-button-toggle">
                  <span>{t('settings.navbarCopy', '复制')}</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={props.navbarButtons.copy}
                      onChange={(e) => props.onNavbarButtonChange('copy', e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </label>
                <label className="navbar-button-toggle">
                  <span>{t('settings.navbarNotes', '笔记列表')}</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={props.navbarButtons.notes}
                      onChange={(e) => props.onNavbarButtonChange('notes', e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </label>
                <label className="navbar-button-toggle navbar-button-locked">
                  <span>{t('settings.navbarSettings', '设置')}</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={true}
                      disabled
                    />
                    <span className="switch-slider" />
                  </label>
                </label>
              </div>
              <div className="shortcut-hint" style={{ marginTop: 8 }}>
                {t('settings.navbarSettingsLocked', '设置按钮为入口保护，不可隐藏（防止隐藏后无法恢复）')}
              </div>
            </div>
          </>
        )}

        {/* === 编辑器 Tab === */}
        {props.activeTab === 'editor' && (
          <>
            <div className="settings-item">
              <div className="settings-row">
                <div>
                  <div className="settings-label">{t('settings.showLineNumbers', '显示行号')}</div>
                  <div className="setting-description">
                    {t('settings.showLineNumbersDesc', '在编辑区最左侧显示行号，方便代码类文件阅读')}
                  </div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={props.showLineNumbers}
                    onChange={(e) => props.onShowLineNumbersChange(e.target.checked)}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
              {props.showLineNumbers && (
                <div className="settings-row" style={{ marginTop: 12 }}>
                  <div>
                    <div className="settings-label">{t('settings.lineNumberMode', '行号模式')}</div>
                    <div className="setting-description">
                      {t('settings.lineNumberModeDesc', '选择行号的计算方式')}
                    </div>
                  </div>
                  <select
                    className="settings-select"
                    value={props.lineNumberMode}
                    onChange={(e) => props.onLineNumberModeChange(e.target.value as 'logical' | 'visual')}
                  >
                    <option value="logical">{t('settings.lineNumberLogical', '逻辑行号')}</option>
                    <option value="visual">{t('settings.lineNumberVisual', '视觉行号')}</option>
                  </select>
                </div>
              )}
              {props.showLineNumbers && (
                <div className="shortcut-hint" style={{ marginTop: 8 }}>
                  {props.lineNumberMode === 'logical'
                    ? t('settings.lineNumberLogicalHint', '按换行符分割行号，不回车算同一行。适合代码编辑。')
                    : t('settings.lineNumberVisualHint', '按显示行数编号，软换行后每行都有行号。适合阅读长文本。')}
                </div>
              )}
            </div>
            <div className="settings-item">
              <div className="settings-row">
                <div>
                  <div className="settings-label">
                    {t('settings.showMinimap', '缩略图')}
                    <span className="experimental-badge">{t('settings.experimental', '试验性')}</span>
                  </div>
                  <div className="setting-description">
                    {t('settings.showMinimapDesc', '在编辑区右侧显示文档缩略图，点击或拖动可快速跳转')}
                    <br />
                    <span className="setting-warning">
                      {t('settings.showMinimapWarning', '此功能仍在开发中，缩略图定位可能存在偏差，后续版本将持续优化')}
                    </span>
                  </div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={props.showMinimap}
                    onChange={(e) => props.onShowMinimapChange(e.target.checked)}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.editorLineHeight', '编辑器行高')}</div>
              <div className="settings-row">
                <input
                  type="range"
                  min="1.2"
                  max="2.4"
                  step="0.1"
                  value={props.editorLineHeight}
                  onChange={(e) => props.onEditorLineHeightChange(Number(e.target.value))}
                  className="font-size-slider"
                />
                <span className="font-size-value">{props.editorLineHeight.toFixed(1)}</span>
              </div>
              <div className="shortcut-hint">
                {t('settings.editorLineHeightHint', '调整编辑器文本行间距，值越大行距越宽')}
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.editorPadding', '编辑器内边距')}</div>
              <div className="settings-row">
                <input
                  type="range"
                  min="8"
                  max="48"
                  step="4"
                  value={props.editorPadding}
                  onChange={(e) => props.onEditorPaddingChange(Number(e.target.value))}
                  className="font-size-slider"
                />
                <span className="font-size-value">{props.editorPadding}px</span>
              </div>
              <div className="shortcut-hint">
                {t('settings.editorPaddingHint', '调整编辑器内容与边缘的距离')}
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.indent')}</div>
              <div className="settings-row" style={{ marginBottom: 8 }}>
                <span className="setting-description">{t('settings.indentType')}</span>
                <select
                  className="settings-select"
                  value={props.indentType}
                  onChange={props.onIndentTypeChange}
                >
                  <option value="space">{t('settings.spaces')}</option>
                  <option value="tab">{t('settings.tab')}</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="setting-description">{t('settings.indentSize')}</span>
                <select
                  className="settings-select"
                  value={props.indentSize}
                  onChange={props.onIndentSizeChange}
                >
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                  <option value={6}>6</option>
                  <option value={8}>8</option>
                </select>
              </div>
            </div>
            {/* v1.1.0：序号补全（VS Code 风格 inline suggestion）*/}
            <div className="settings-item">
              <div className="settings-row">
                <div>
                  <div className="settings-label">{t('settings.enableSequenceSuggestion', '序号补全')}</div>
                  <div className="setting-description">
                    {t('settings.enableSequenceSuggestionHint', '在行首输入序号（如 1. / a. / ① / -）后按回车，下一行将显示半透明序号预览。按 Tab 或 Enter 接受，Backspace/Esc 取消。')}
                  </div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={props.enableSequenceSuggestion}
                    onChange={(e) => props.onEnableSequenceSuggestionChange(e.target.checked)}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
              {/* v1.1.0：接受方式子开关（仅在总开关开启时显示）*/}
              {props.enableSequenceSuggestion && (
                <div className="seq-accept-modes">
                  <div className="settings-label seq-accept-label">
                    {t('settings.seqAcceptMode', '接受方式')}
                  </div>
                  <div className="setting-description seq-accept-hint">
                    {t('settings.seqAcceptModeHint', '选择接受序号补全建议的按键方式（可多选）：')}
                  </div>
                  <div className="seq-accept-option">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={props.seqAcceptOnTab}
                        onChange={(e) => props.onSeqAcceptModeChange('tab', e.target.checked)}
                      />
                      <span className="switch-slider" />
                    </label>
                    <span className="seq-accept-option-text">
                      {t('settings.seqAcceptOnTab', 'Tab 接受')}
                      <span className="seq-accept-option-desc">
                        {t('settings.seqAcceptOnTabDesc', '按 Tab 键接受建议')}
                      </span>
                    </span>
                  </div>
                  <div className="seq-accept-option">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={props.seqAcceptOnEnter}
                        onChange={(e) => props.onSeqAcceptModeChange('enter', e.target.checked)}
                      />
                      <span className="switch-slider" />
                    </label>
                    <span className="seq-accept-option-text">
                      {t('settings.seqAcceptOnEnter', 'Enter 接受')}
                      <span className="seq-accept-option-desc">
                        {t('settings.seqAcceptOnEnterDesc', '按 Enter 键接受建议（默认关闭，避免与列表结束行为冲突）')}
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* === 快捷键 Tab === */}
        {props.activeTab === 'shortcuts' && (
          <>
            <div className="settings-item">
              <div className="settings-label">{t('settings.toggleWindow')}</div>
              <div className="shortcut-current">
                {t('settings.current')} <code>{props.toggleShortcut}</code>
              </div>
              <input
                type="text"
                className={`shortcut-input ${props.recordingTarget === 'toggle' ? 'recording' : ''}`}
                value={props.recordingTarget === 'toggle' ? t('settings.pressKeys') : props.toggleShortcutInput}
                onKeyDown={props.onShortcutKeyDown}
                onFocus={() => props.onSetRecordingTarget('toggle')}
                onBlur={() => props.onSetRecordingTarget((t) => (t === 'toggle' ? null : t))}
                readOnly
                placeholder={t('settings.clickToRecord')}
              />
              <div className="shortcut-actions">
                <button
                  className="btn-save"
                  onClick={props.onSaveToggleShortcut}
                  disabled={props.toggleShortcutInput === props.toggleShortcut || !props.toggleShortcutInput.trim()}
                >
                  {t('settings.save')}
                </button>
                <button className="btn-secondary" onClick={props.onResetToggleShortcut}>
                  {t('settings.resetDefault')}
                </button>
                <button className="btn-secondary" onClick={props.onClearToggleShortcut}>
                  {t('settings.clear')}
                </button>
              </div>
              <div className="shortcut-hint">
                {t('settings.toggleWindowHint')}
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.new')}</div>
              <div className="shortcut-current">
                {t('settings.current')} <code>{props.newShortcut || t('settings.notSet', '未设置')}</code>
              </div>
              <input
                type="text"
                className={`shortcut-input ${props.recordingTarget === 'new' ? 'recording' : ''}`}
                value={props.recordingTarget === 'new' ? t('settings.pressKeys') : props.newShortcutInput}
                onKeyDown={props.onShortcutKeyDown}
                onFocus={() => props.onSetRecordingTarget('new')}
                onBlur={() => props.onSetRecordingTarget((t) => (t === 'new' ? null : t))}
                readOnly
                placeholder={t('settings.clickToRecord')}
              />
              <div className="shortcut-actions">
                <button
                  className="btn-save"
                  onClick={props.onSaveNewShortcut}
                  disabled={props.newShortcutInput === props.newShortcut}
                >
                  {t('settings.save')}
                </button>
                <button className="btn-secondary" onClick={props.onResetNewShortcut}>
                  {t('settings.resetDefault')}
                </button>
                <button className="btn-secondary" onClick={props.onClearNewShortcut}>
                  {t('settings.clear')}
                </button>
              </div>
              <div className="shortcut-hint">
                {t('settings.localHint')}
              </div>
            </div>
            <div className="settings-item">
              <div className="settings-label">{t('settings.copy')}</div>
              <div className="shortcut-current">
                {t('settings.current')} <code>{props.copyShortcut || t('settings.notSet', '未设置')}</code>
              </div>
              <input
                type="text"
                className={`shortcut-input ${props.recordingTarget === 'copy' ? 'recording' : ''}`}
                value={props.recordingTarget === 'copy' ? t('settings.pressKeys') : props.copyShortcutInput}
                onKeyDown={props.onShortcutKeyDown}
                onFocus={() => props.onSetRecordingTarget('copy')}
                onBlur={() => props.onSetRecordingTarget((t) => (t === 'copy' ? null : t))}
                readOnly
                placeholder={t('settings.clickToRecord')}
              />
              <div className="shortcut-actions">
                <button
                  className="btn-save"
                  onClick={props.onSaveCopyShortcut}
                  disabled={props.copyShortcutInput === props.copyShortcut}
                >
                  {t('settings.save')}
                </button>
                <button className="btn-secondary" onClick={props.onResetCopyShortcut}>
                  {t('settings.resetDefault')}
                </button>
                <button className="btn-secondary" onClick={props.onClearCopyShortcut}>
                  {t('settings.clear')}
                </button>
              </div>
              <div className="shortcut-hint">
                {t('settings.localHint')}
              </div>
            </div>
          </>
        )}

        {/* === 管理 Tab（工作区+标签，子标签切换）=== */}
        {props.activeTab === 'management' && (
          <>
            <div className="management-subtabs">
              <button
                className={`management-subtab ${managementSubTab === 'workspace' ? 'active' : ''}`}
                onClick={() => setManagementSubTab('workspace')}
              >
                {t('settings.tabWorkspace', '工作区')}
              </button>
              <button
                className={`management-subtab ${managementSubTab === 'tag' ? 'active' : ''}`}
                onClick={() => setManagementSubTab('tag')}
              >
                {t('settings.tabTag', '标签')}
              </button>
              <button
                className={`management-subtab ${managementSubTab === 'advanced' ? 'active' : ''}`}
                onClick={() => setManagementSubTab('advanced')}
              >
                {t('settings.tabAdvanced', '高级')}
              </button>
            </div>
            {managementSubTab === 'workspace' && (
              <WorkspaceManager
                workspaces={props.workspaces}
                defaultWorkspaceId={props.defaultWorkspaceId}
                onRenameWorkspace={props.onRenameWorkspace}
                onUpdateWorkspaceIcon={props.onUpdateWorkspaceIcon}
                onDeleteWorkspace={props.onDeleteWorkspace}
                onSetDefaultWorkspace={props.onSetDefaultWorkspace}
              />
            )}
            {managementSubTab === 'tag' && (
              <TagManager
                tags={props.tags}
                onRenameTag={props.onRenameTag}
                onUpdateTagColor={props.onUpdateTagColor}
                onDeleteTag={props.onDeleteTag}
              />
            )}
            {managementSubTab === 'advanced' && (
              <>
                <div className="settings-item">
                  <div className="settings-row">
                    <div>
                      <div className="settings-label">{t('settings.showDebugTab', '显示调试面板')}</div>
                      <div className="setting-description">
                        {t('settings.showDebugTabHint', '启用后将在设置面板显示 Debug 标签页，用于查看调试日志')}
                      </div>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={props.showDebugTab}
                        onChange={(e) => props.onShowDebugTabChange(e.target.checked)}
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>
                </div>
                {/* v1.1.1：异常日志入口 */}
                <div className="settings-item">
                  <div className="settings-row">
                    <div>
                      <div className="settings-label">{t('settings.logs', '异常日志')}</div>
                      <div className="setting-description" style={{ wordBreak: 'break-all' }}>
                        {t('settings.logsHint', '程序异常（卡死、闪退等）的日志存储在：')}<code>{logsPath}</code>
                      </div>
                    </div>
                    <button
                      className="btn-secondary"
                      onClick={handleOpenLogsFolder}
                      style={{
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {t('settings.openLogsFolder', '打开日志文件夹')}
                    </button>
                  </div>
                </div>
                {/* v1.1.0：序号补全已移至"编辑器"标签页（更符合功能归属）*/}
              </>
            )}
          </>
        )}

        {/* === 调试 Tab === */}
        {props.activeTab === 'debug' && (
          <>
            <div className="settings-item">
              <div className="settings-label">调试模式</div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={props.debugMode}
                  onChange={(e) => props.onDebugModeChange(e.target.checked)}
                />
                <span className="switch-slider" />
              </label>
              <div className="shortcut-hint" style={{ marginTop: 4 }}>
                开启后记录布局、渲染等调试信息，帮助排查界面异常
              </div>
            </div>
            {props.debugMode && (
              <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div className="settings-label">调试日志</div>
                  <button className="btn-secondary" style={{ height: 28, fontSize: 12 }} onClick={props.onClearDebugLogs}>
                    清空
                  </button>
                </div>
                <div className="debug-log-panel">
                  {props.debugLogs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>暂无日志，请操作后查看</div>
                  ) : (
                    props.debugLogs.map((log, i) => (
                      <div key={i} className="debug-log-entry">{log}</div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}

// ===== 工作区管理子组件 =====
// 独立标签页：管理工作区（重命名、换图标、删除、默认工作区）
// 内部持有编辑状态（editingId/editingName/editingIcon），不持有业务数据

interface WorkspaceManagerProps {
  workspaces: Workspace[]
  defaultWorkspaceId: string
  onRenameWorkspace: (id: string, name: string) => void
  onUpdateWorkspaceIcon: (id: string, icon: string) => void
  onDeleteWorkspace: (id: string, name: string) => void
  onSetDefaultWorkspace: (workspaceId: string) => void
}

// ===== 标签管理子组件 =====
// 独立标签页：管理全局标签（重命名、换颜色、删除）
// 标签是全局的，不属于任何工作区

interface TagManagerProps {
  tags: Tag[]
  onRenameTag: (id: string, name: string) => void
  onUpdateTagColor: (id: string, color: string) => void
  onDeleteTag: (id: string, name: string) => void
}

// 预设颜色选项（与 NOTE_COLORS 保持一致风格）
const TAG_COLOR_PRESETS = [
  '#888888', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#a855f7', '#ec4899',
]

function WorkspaceManager(props: WorkspaceManagerProps) {
  const { t } = useTranslation()
  // 工作区编辑状态
  const [wsEditingId, setWsEditingId] = useState<string | null>(null)
  const [wsEditName, setWsEditName] = useState('')
  const [wsEditIcon, setWsEditIcon] = useState('')

  // 进入工作区编辑模式
  const startEditWorkspace = (ws: Workspace) => {
    setWsEditingId(ws.id)
    setWsEditName(ws.name)
    setWsEditIcon(ws.icon)
  }
  // 保存工作区编辑
  const saveWorkspaceEdit = () => {
    if (wsEditingId && wsEditName.trim()) {
      props.onRenameWorkspace(wsEditingId, wsEditName.trim())
      props.onUpdateWorkspaceIcon(wsEditingId, wsEditIcon || '📝')
    }
    setWsEditingId(null)
    setWsEditName('')
    setWsEditIcon('')
  }
  // 取消工作区编辑
  const cancelWorkspaceEdit = () => {
    setWsEditingId(null)
    setWsEditName('')
    setWsEditIcon('')
  }

  return (
    <div className="workspacetag-manager">
      <div className="wtm-section">
        <div className="wtm-section-header">
          <div className="wtm-section-title">{t('management.workspaceSection')}</div>
          <div className="wtm-section-desc">{t('management.workspaceDesc')}</div>
        </div>

        {/* 默认新建笔记工作区选择 */}
        <div className="settings-item">
          <div className="settings-label">{t('workspace.defaultWorkspace')}</div>
          <div className="setting-description">{t('workspace.defaultWorkspaceDesc')}</div>
          <select
            className="settings-select settings-select-full"
            value={props.defaultWorkspaceId}
            onChange={(e) => props.onSetDefaultWorkspace(e.target.value)}
          >
            <option value="">{t('workspace.defaultWorkspaceAll')}</option>
            {props.workspaces.map(ws => (
              <option key={ws.id} value={ws.id}>{ws.icon} {ws.name}</option>
            ))}
          </select>
        </div>

        {/* 工作区列表 */}
        <div className="wtm-list">
          {props.workspaces.length === 0 ? (
            <div className="wtm-empty">{t('workspace.defaultWorkspaceAll')}</div>
          ) : (
            props.workspaces.map(ws => (
              <div key={ws.id} className="wtm-item">
                {wsEditingId === ws.id ? (
                  // 编辑模式
                  <div className="wtm-item-edit">
                    <input
                      className="wtm-icon-input"
                      value={wsEditIcon}
                      onChange={(e) => setWsEditIcon(e.target.value)}
                      maxLength={2}
                      placeholder={t('workspace.iconPlaceholder')}
                    />
                    <input
                      className="wtm-name-input"
                      value={wsEditName}
                      onChange={(e) => setWsEditName(e.target.value)}
                      placeholder={t('workspace.namePlaceholder')}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveWorkspaceEdit()
                        if (e.key === 'Escape') cancelWorkspaceEdit()
                      }}
                    />
                    <button className="btn-secondary wtm-btn-save" onClick={saveWorkspaceEdit}>
                      {t('management.save')}
                    </button>
                    <button className="btn-secondary wtm-btn-cancel" onClick={cancelWorkspaceEdit}>
                      {t('management.cancel')}
                    </button>
                  </div>
                ) : (
                  // 显示模式
                  <div className="wtm-item-display">
                    <span className="wtm-item-icon">{ws.icon}</span>
                    <span className="wtm-item-name">{ws.name}</span>
                    {props.defaultWorkspaceId === ws.id && (
                      <span className="wtm-default-badge">{t('workspace.defaultWorkspace')}</span>
                    )}
                    <div className="wtm-item-actions">
                      <button
                        className="btn-secondary wtm-btn-edit"
                        onClick={() => startEditWorkspace(ws)}
                        title={t('management.edit')}
                      >
                        {t('management.edit')}
                      </button>
                      <button
                        className="btn-secondary wtm-btn-delete"
                        onClick={() => {
                          if (confirm(t('workspace.deleteConfirm', { name: ws.name }))) {
                            props.onDeleteWorkspace(ws.id, ws.name)
                          }
                        }}
                        title={t('workspace.delete')}
                      >
                        {t('workspace.delete')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function TagManager(props: TagManagerProps) {
  const { t } = useTranslation()
  // 标签编辑状态
  const [tagEditingId, setTagEditingId] = useState<string | null>(null)
  const [tagEditName, setTagEditName] = useState('')
  const [tagEditColor, setTagEditColor] = useState(TAG_COLOR_PRESETS[0])

  // 进入标签编辑模式
  const startEditTag = (tag: Tag) => {
    setTagEditingId(tag.id)
    setTagEditName(tag.name)
    setTagEditColor(tag.color)
  }
  // 保存标签编辑
  const saveTagEdit = () => {
    if (tagEditingId && tagEditName.trim()) {
      props.onRenameTag(tagEditingId, tagEditName.trim())
      props.onUpdateTagColor(tagEditingId, tagEditColor)
    }
    setTagEditingId(null)
    setTagEditName('')
    setTagEditColor(TAG_COLOR_PRESETS[0])
  }
  // 取消标签编辑
  const cancelTagEdit = () => {
    setTagEditingId(null)
    setTagEditName('')
    setTagEditColor(TAG_COLOR_PRESETS[0])
  }

  return (
    <div className="workspacetag-manager">
      <div className="wtm-section">
        <div className="wtm-section-header">
          <div className="wtm-section-title">{t('management.tagSection')}</div>
          <div className="wtm-section-desc">{t('management.tagDesc')}</div>
        </div>

        {/* 标签列表 */}
        <div className="wtm-list">
          {props.tags.length === 0 ? (
            <div className="wtm-empty">{t('tag.empty')}</div>
          ) : (
            props.tags.map(tag => (
              <div key={tag.id} className="wtm-item">
                {tagEditingId === tag.id ? (
                  // 编辑模式
                  <div className="wtm-item-edit wtm-tag-edit">
                    <div className="wtm-tag-edit-row">
                      <input
                        className="wtm-name-input"
                        value={tagEditName}
                        onChange={(e) => setTagEditName(e.target.value)}
                        placeholder={t('tag.name')}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveTagEdit()
                          if (e.key === 'Escape') cancelTagEdit()
                        }}
                      />
                      <div className="wtm-color-presets">
                        {TAG_COLOR_PRESETS.map(color => (
                          <button
                            key={color}
                            className={`wtm-color-preset ${tagEditColor === color ? 'selected' : ''}`}
                            style={{ background: color }}
                            onClick={() => setTagEditColor(color)}
                            title={color}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="wtm-tag-edit-row">
                      <button className="btn-secondary wtm-btn-save" onClick={saveTagEdit}>
                        {t('management.save')}
                      </button>
                      <button className="btn-secondary wtm-btn-cancel" onClick={cancelTagEdit}>
                        {t('management.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  // 显示模式
                  <div className="wtm-item-display">
                    <span className="wtm-tag-color-dot" style={{ background: tag.color }} />
                    <span className="wtm-item-name">{tag.name}</span>
                    <span className="wtm-tag-usage">{t('tag.usageCount', { count: tag.usageCount })}</span>
                    <div className="wtm-item-actions">
                      <button
                        className="btn-secondary wtm-btn-edit"
                        onClick={() => startEditTag(tag)}
                        title={t('management.edit')}
                      >
                        {t('management.edit')}
                      </button>
                      <button
                        className="btn-secondary wtm-btn-delete"
                        onClick={() => {
                          if (confirm(t('tag.deleteConfirm', { name: tag.name }))) {
                            props.onDeleteTag(tag.id, tag.name)
                          }
                        }}
                        title={t('tag.delete')}
                      >
                        {t('tag.delete')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
