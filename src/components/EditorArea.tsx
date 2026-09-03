import type { RefObject } from 'react'
import { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { NoteFormat } from '../types'
import { parseListPrefix, nextListPrefix } from '../lib/sequence'
import type { Match } from '../hooks/useSearchReplace'
// v1.3.2 P1 修复：preview 模式搜索高亮 + 滚动定位（mark.js）
// 之前浏览模式下 searchMatches 计数 OK 但无任何视图反馈：overlay 只在 code 模式渲染
// 这里用 mark.js 给 preview 容器内的文本节点打 mark + scrollIntoView 定位
import Mark from 'mark.js'

// 大纲项：标题级别 + 文本 + 所在行号
export type OutlineItem = { level: number; text: string; line: number }

// v1.1.0：序号补全建议（VS Code 风格 inline suggestion）
// prefix = 待插入的下一行序号前缀（如 "2. " / "② " / "- "）
// top/left = 预览层相对于 editor-container 的像素坐标（已扣除 scrollTop/scrollLeft）
interface SequenceSuggestion {
  prefix: string
  top: number
  left: number
}

interface EditorAreaProps {
  // refs（由父组件持有，传入以便子组件直接绑定）
  textareaRef: RefObject<HTMLTextAreaElement>
  previewRef: RefObject<HTMLDivElement>
  // 编辑器状态
  text: string
  editorMode: 'code' | 'preview'
  editorFormat: NoteFormat
  hasMarkdownSyntax: boolean
  renderedHtml: string
  indentSize: number
  highlightBandY: number
  editorHighlightY: number
  outlineItems: OutlineItem[]
  showOutline: boolean
  // 行号显示开关
  showLineNumbers: boolean
  // 行号模式：logical=逻辑行号（按换行符分割），visual=视觉行号（软换行后每行都编号）
  lineNumberMode: 'logical' | 'visual'
  // 缩略图（minimap）：编辑区右侧显示文档缩略图
  showMinimap: boolean
  // v1.1.0：序号补全开关（用户在设置中手动开启，默认关闭）
  enableSequenceSuggestion: boolean
  // v1.1.0：序号补全接受方式（用户可多选）
  // 注：seqAcceptOnType 已移除（中文输入法兼容性问题），仅保留 Tab/Enter
  seqAcceptOnTab: boolean
  seqAcceptOnEnter: boolean
  // 事件回调
  onTextChange: (text: string) => void
  onToggleOutline: () => void
  onCloseOutline: () => void
  onDrop: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onTabKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onWheel: (e: React.WheelEvent<HTMLTextAreaElement>) => void
  onEditorScroll: () => void
  onUpdateCursorLine: () => void
  onToggleEditorMode: () => void
  onJumpToLine: (line: number) => void
  // v1.3.2 P7：编辑文本后重置搜索 navAnchor，让下次 next/prev 基于新 caret
  onResetSearchNavAnchor?: () => void
  // Toast 反馈
  toastMessage: string | null
  // v1.1.2 修复 Bug M-5：minimap 诊断日志受 debugMode 控制，生产环境不写入
  debugMode: boolean
  // v1.2.0 P0-A：链接点击行为（direct=直接系统浏览器打开，ask=弹窗询问）
  linkClickBehavior: 'direct' | 'ask'
  // 搜索替换功能（v1.3.0）：overlay 高亮层 ref + 搜索状态
  overlayRef: RefObject<HTMLDivElement>
  searchMatches: Match[]
  searchCurrentIndex: number
  searchIsActive: boolean
  // v1.3.0 导航信号（主动导航/打开搜索时递增，驱动滚动定位）
  searchNavTick: number
  // v1.3.0 搜索查询词与选项（预览模式 mark.js 高亮用）
  searchQuery: string
  searchOptions: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
}

export function EditorArea(props: EditorAreaProps) {
  const { t } = useTranslation()
  const {
    textareaRef,
    previewRef,
    text,
    editorMode,
    editorFormat,
    hasMarkdownSyntax,
    renderedHtml,
    indentSize,
    highlightBandY,
    editorHighlightY,
    outlineItems,
    showOutline,
    showLineNumbers,
    lineNumberMode,
    showMinimap,
    enableSequenceSuggestion,
    seqAcceptOnTab,
    seqAcceptOnEnter,
    toastMessage,
    onTextChange,
    onToggleOutline,
    onCloseOutline,
    onDrop,
    onDragOver,
    onTabKey,
    onWheel,
    onEditorScroll,
    onUpdateCursorLine,
    onToggleEditorMode,
    onJumpToLine,
    onResetSearchNavAnchor,
    debugMode,
    linkClickBehavior,
    overlayRef,
    searchMatches,
    searchCurrentIndex,
    searchIsActive,
    searchQuery,
    searchOptions,
  } = props

  // 行号栏 ref：用于与 textarea 同步滚动
  const gutterRef = useRef<HTMLDivElement>(null)
  // minimap 内容 ref：用于 DOM 渲染缩略图内容（真实文字）
  const minimapContentRef = useRef<HTMLDivElement>(null)
  // minimap 视口指示器 ref：用于诊断实际渲染位置
  const minimapViewportRef = useRef<HTMLDivElement>(null)
  // 记录最近一次点击的 Y 坐标（相对于 minimap 容器），用于诊断渲染位置
  const lastClickYRef = useRef<number | null>(null)
  // 隐藏的 mirror div ref：用于视觉行号模式计算每个逻辑行的视觉行数，以及 minimap 行偏移测量
  const mirrorRef = useRef<HTMLDivElement>(null)
  // textarea 的实际内容宽度（用于 mirror div 宽度同步）
  const [textareaWidth, setTextareaWidth] = useState(0)
  // minimap 视口指示器位置（top% 和 height%，基于 visualLineOffsets 计算）
  const [minimapViewport, setMinimapViewport] = useState({ top: 0, height: 100 })
  // mirror div 是否已挂载就绪（解决 ref 赋值不触发重渲染的问题）
  // 切换行号模式或开启 minimap 时 mirror div 可能刚挂载，ref.current 已赋值但不会触发 useMemo 重算
  // 通过 mirrorReady state 强制触发一次重渲染，确保计算在 mirror 就绪后执行
  const [mirrorReady, setMirrorReady] = useState(false)

  // ===== v1.1.0：序号补全（VS Code 风格 inline suggestion）=====
  // 当前活动建议：null 表示无建议；非 null 时在光标位置渲染半透明预览
  const [seqSuggestion, setSeqSuggestion] = useState<SequenceSuggestion | null>(null)
  // ref 镜像：keydown 事件处理函数闭包可能捕获陈旧 state，通过 ref 同步读取最新值
  const seqSuggestionRef = useRef<SequenceSuggestion | null>(null)
  // 光标测量用的 mirror div：复制 textarea 样式，在光标位置插入 span 测量像素坐标
  const cursorMirrorRef = useRef<HTMLDivElement>(null)
  // 同步 state 到 ref（避免 keydown 闭包陈旧）
  useEffect(() => {
    seqSuggestionRef.current = seqSuggestion
  }, [seqSuggestion])

  // v1.1.0：接受方式配置 ref（避免 keydown 闭包陈旧）
  // 注：type 已移除（中文输入法兼容性问题），仅保留 tab/enter
  const seqAcceptConfigRef = useRef({ tab: true, enter: false })
  useEffect(() => {
    seqAcceptConfigRef.current = { tab: seqAcceptOnTab, enter: seqAcceptOnEnter }
  }, [seqAcceptOnTab, seqAcceptOnEnter])

  // v1.1.0：IME compositionend 时间戳（用于区分 IME 确认 Enter 与用户实际 Enter）
  // 根因：Windows 中文输入法确认组合时会发送一次 keydown Enter（keyCode=13, isComposing=false），
  //   与用户真正按的 Enter 是两次独立事件。第一次会创建建议，第二次会立即取消它。
  // 解决方案：compositionend 后 50ms 内的 Enter 视为 IME 确认 Enter，不创建建议。
  const lastCompositionEndRef = useRef(0)
  // v1.3.2 Bug #1 修复：刚接受过建议的标志
  // 用户接受建议（如 "2. "）后按 Enter 想继续换行，lineText="2. " trim==prefix.trim()
  // 旧代码会误判为"空列表项退出列表"，把 "2. " 和前面的 \n 都清空。
  // 修复：接受建议时设 true，下一次 Enter 在该分支跳过退出逻辑。
  const seqJustAcceptedRef = useRef(false)

  /**
   * 测量 textarea 中指定字符位置的光标像素坐标（相对于 editor-container）
   * 使用 mirror div 技术：复制 textarea 所有影响布局的样式，在光标位置插入 span 标记
   *
   * @param textarea 目标 textarea 元素
   * @param position 光标字符偏移量（0-based）
   * @returns 相对于 editor-container 的像素坐标 { top, left }
   */
  const measureCaretCoordinates = useCallback((textarea: HTMLTextAreaElement, position: number): { top: number; left: number } => {
    const mirror = cursorMirrorRef.current
    if (!mirror) return { top: 0, left: 0 }

    const taStyle = getComputedStyle(textarea)
    // 同步所有影响文本布局的样式（与 textarea 完全一致，确保测量结果准确）
    mirror.style.width = `${textarea.clientWidth}px`
    mirror.style.paddingTop = taStyle.paddingTop
    mirror.style.paddingRight = taStyle.paddingRight
    mirror.style.paddingBottom = taStyle.paddingBottom
    mirror.style.paddingLeft = taStyle.paddingLeft
    mirror.style.borderTopWidth = taStyle.borderTopWidth
    mirror.style.borderRightWidth = taStyle.borderRightWidth
    mirror.style.borderBottomWidth = taStyle.borderBottomWidth
    mirror.style.borderLeftWidth = taStyle.borderLeftWidth
    mirror.style.fontFamily = taStyle.fontFamily
    mirror.style.fontSize = taStyle.fontSize
    mirror.style.fontWeight = taStyle.fontWeight
    mirror.style.fontStyle = taStyle.fontStyle
    mirror.style.lineHeight = taStyle.lineHeight
    mirror.style.letterSpacing = taStyle.letterSpacing
    mirror.style.tabSize = taStyle.tabSize
    mirror.style.whiteSpace = taStyle.whiteSpace || 'pre-wrap'
    mirror.style.wordBreak = taStyle.wordBreak || 'normal'
    mirror.style.overflowWrap = taStyle.overflowWrap || 'break-word'

    // 清空 mirror 并填入截至光标位置的文本
    mirror.textContent = ''
    const textBeforeCaret = textarea.value.substring(0, position)
    mirror.appendChild(document.createTextNode(textBeforeCaret))
    // 在光标位置插入 span 标记（zero-width space 占位，确保空行也能测量）
    const span = document.createElement('span')
    span.textContent = '\u200B'
    mirror.appendChild(span)

    // 计算 span 相对于 mirror 的偏移
    const mirrorRect = mirror.getBoundingClientRect()
    const spanRect = span.getBoundingClientRect()
    // 减去 mirror 的 padding（span 坐标已包含 padding 偏移）
    const topInMirror = spanRect.top - mirrorRect.top
    const leftInMirror = spanRect.left - mirrorRect.left
    // 减去 textarea 的 scrollTop/scrollLeft（mirror 不滚动，但 textarea 滚动后光标视口位置变化）
    const top = topInMirror - textarea.scrollTop
    const left = leftInMirror - textarea.scrollLeft

    return { top, left }
  }, [])

  /**
   * 接受序号补全建议：在当前光标位置插入建议前缀
   * 调用后清空 seqSuggestion state
   */
  const acceptSeqSuggestion = useCallback((textarea: HTMLTextAreaElement) => {
    const suggestion = seqSuggestionRef.current
    if (!suggestion) return
    const pos = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = textarea.value
    // 在光标位置插入建议前缀
    const newValue = value.slice(0, pos) + suggestion.prefix + value.slice(end)
    onTextChange(newValue)
    const newPos = pos + suggestion.prefix.length
    // rAF 后设置光标位置（setText 触发重渲染后 textarea.value 才会更新）
    requestAnimationFrame(() => {
      textarea.selectionStart = newPos
      textarea.selectionEnd = newPos
    })
    seqJustAcceptedRef.current = true
    setSeqSuggestion(null)
  }, [onTextChange])

  /**
   * 取消序号补全建议：仅清空 state，不修改文本
   */
  const cancelSeqSuggestion = useCallback(() => {
    setSeqSuggestion(null)
  }, [])

  /**
   * v1.1.0：序号补全 keydown 处理
   * 职责：检测 Enter 键触发建议 + 检测其他键接受/取消建议 + Backspace 重新触发
   * 与 onTabKey 并列调用（onTabKey 仅处理 Tab 缩进，不冲突）
   *
   * 中文输入法处理：
   * - isComposing=true 时直接 return（不干扰输入法组合）
   * - compositionend 事件中接受建议（见 handleCompositionEnd）
   */
  const handleSequenceKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 功能未启用或预览模式不处理
    if (!enableSequenceSuggestion || editorMode !== 'code') return
    // 输入法组合状态不处理（避免干扰中文输入）
    // v1.1.0 方案 B：移除"继续输入即接受"，IME 按键时直接 return
    // 用户如需接受建议，请按 Tab 或 Enter
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return
    }

    const textarea = e.currentTarget
    const currentSuggestion = seqSuggestionRef.current
    // 读取最新的接受方式配置（ref 镜像避免闭包陈旧）
    const acceptConfig = seqAcceptConfigRef.current

    // ===== 已有活动建议：根据按键 + 用户配置决定接受/取消 =====
    if (currentSuggestion) {
      // Backspace/Esc/方向键 → 始终取消（VS Code 行为一致，不可配置）
      if (e.key === 'Backspace' || e.key === 'Escape' || e.key.startsWith('Arrow')) {
        cancelSeqSuggestion()
        return
      }
      // Enter → 根据配置决定接受或取消
      if (e.key === 'Enter') {
        // v1.1.0 修复：IME 确认 Enter 跳过（避免取消刚刚由用户 Enter 创建的建议）
        const sinceCompose = Date.now() - lastCompositionEndRef.current
        if (sinceCompose < 300) {
          return
        }
        // v1.1.0 修复：Enter 始终接受建议（VS Code 标准行为）
        // 根因：用户按两次 Enter 时，第二次 Enter 会取消建议，导致后续输入无法接受建议。
        // 解决方案：Enter 始终接受建议（插入 prefix + 换行），无论 acceptConfig.enter 配置如何。
        // 双回车退出列表的行为改为：空列表项按 Enter 退出（在下方"无建议"分支处理）。
        e.preventDefault()
        acceptSeqSuggestion(textarea)
        return
      }
      // Tab → 根据配置决定接受或交由 onTabKey 处理缩进
      if (e.key === 'Tab') {
        if (acceptConfig.tab) {
          e.preventDefault()
          acceptSeqSuggestion(textarea)
        } else {
          // Tab 未配置为接受方式 → 取消建议，让 onTabKey 处理缩进
          // 注意：onTabKey 已在外层先调用，此处仅清理状态
          cancelSeqSuggestion()
        }
        return
      }
      // 普通可打印字符（单字符，无修饰键）→ v1.1.0 方案 B：始终取消建议
      // 根因：中文输入法下"继续输入即接受"无法可靠工作（IME 在 compositionstart 前已插入文本）
      // 用户如需接受建议，请按 Tab 或 Enter
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        cancelSeqSuggestion()
        return
      }
      // 修饰键（Alt/Control/Shift/Meta 单独按下）→ 不取消建议，直接 return
      // 根因：用户可能按 Alt 切换输入法或 Alt+Tab 切窗口，不应导致建议消失
      if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') {
        return
      }
      // 其他控制键（Ctrl+X/C/V 等）→ 取消建议，让浏览器正常处理
      cancelSeqSuggestion()
      return
    }

    // ===== 无活动建议：检测 Backspace 键是否应重新触发建议 =====
    // 场景：用户输入字符后删除，回到空行，期望建议重新显示
    if (e.key === 'Backspace') {
      const pos = textarea.selectionStart
      const end = textarea.selectionEnd
      // 有选区时不处理（选区删除由浏览器默认行为处理）
      if (pos !== end) return
      const value = textarea.value
      const lineStart = value.lastIndexOf('\n', pos - 1) + 1
      // 光标必须在当前行内（不是在行首，否则 Backspace 会删除换行符）
      if (pos === lineStart) return
      // 当前行从行首到光标的内容：必须只有 1 个字符（删除后变为空行）
      const currentLineBeforeCursor = value.slice(lineStart, pos)
      if (currentLineBeforeCursor.length !== 1) return
      // 必须有上一行
      if (lineStart === 0) return
      // 检查上一行是否有序号前缀
      const prevLineEnd = lineStart - 1 // 换行符位置
      const prevLineStart = value.lastIndexOf('\n', prevLineEnd - 1) + 1
      const prevLineText = value.slice(prevLineStart, prevLineEnd)
      const prefix = parseListPrefix(prevLineText)
      if (!prefix) return
      // 上一行只有序号前缀（无内容）时不重新触发（避免与"双回车退出列表"冲突）
      if (prevLineText.trim() === prefix.trim()) return
      const nextPrefix = nextListPrefix(prefix)
      if (!nextPrefix) return
      // 在 rAF 后显示建议（Backspace 默认行为完成后，textarea.value 已更新）
      requestAnimationFrame(() => {
        const ta = textarea
        const newPos = ta.selectionStart
        const coords = measureCaretCoordinates(ta, newPos)
        setSeqSuggestion({
          prefix: nextPrefix,
          top: coords.top,
          left: coords.left,
        })
      })
      return
    }

    // ===== 无活动建议：检测 Enter 键是否应触发建议 =====
    if (e.key !== 'Enter') return
    // Shift+Enter 不触发（用户可能想软换行）
    if (e.shiftKey) return
    // Ctrl/Cmd+Enter 不触发（可能是快捷键）
    if (e.ctrlKey || e.metaKey) return
    // v1.1.0 修复：IME 确认 Enter 跳过（区分 IME 确认组合时的 Enter 与用户实际按的 Enter）
    // 根因：中文输入法确认组合时发送的 Enter 与用户按下的 Enter 是两次独立事件，
    //   第一次会创建建议，第二次会立即取消它，导致中文输入下建议永远无法生效。
    // 解决方案：compositionend 后 300ms 内的 Enter 视为 IME 确认 Enter，不创建建议。
    //   300ms 阈值可覆盖 IME 的两个 Enter 事件（通常 < 50ms 间隔），用户真实 Enter 通常 > 300ms。
    const sinceComposeNoSugg = Date.now() - lastCompositionEndRef.current
    if (sinceComposeNoSugg < 300) {
      return
    }

    const pos = textarea.selectionStart
    const end = textarea.selectionEnd
    // 仅在无选区时触发（有选区时 Enter 通常是替换选区）
    if (pos !== end) return

    const value = textarea.value
    // 找到当前行起始位置（前一个 \n 之后）
    const lineStart = value.lastIndexOf('\n', pos - 1) + 1
    // 找到当前行结束位置（下一个 \n 之前，或字符串末尾）
    const lineEndIdx = value.indexOf('\n', pos)
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
    const lineText = value.slice(lineStart, lineEnd)

    // 解析当前行的序号前缀
    const prefix = parseListPrefix(lineText)
    if (!prefix) return

    // 特殊情况：当前行只有序号前缀（无内容），按 Enter 应结束列表（清空当前行）
    // 这是 VS Code / Typora 的标准行为：空列表项按 Enter = 退出列表
    // v1.3.2 Bug #1 修复：如果刚接受过建议，光标在新序号行末尾，
    //   用户按 Enter 是想"再换一行继续"，不是退出列表——跳过此分支正常生成下一行建议。
    if (lineText.trim() === prefix.trim()) {
      if (seqJustAcceptedRef.current) {
        // 跳过退出分支，继续到下方"生成下一行序号"逻辑
        seqJustAcceptedRef.current = false
      } else {
        e.preventDefault()
        // 清空当前行（保留前导空白，移除序号前缀）
        const leadingWhitespace = lineText.match(/^\s*/)?.[0] || ''
        const newValue = value.slice(0, lineStart) + leadingWhitespace + value.slice(lineEnd)
        onTextChange(newValue)
        const newPos = lineStart + leadingWhitespace.length
        requestAnimationFrame(() => {
          textarea.selectionStart = newPos
          textarea.selectionEnd = newPos
        })
        return
      }
    } else {
      // 当前行有内容（非空列表项）→ 重置 just-accepted 标志
      seqJustAcceptedRef.current = false
    }

    // 生成下一行序号前缀
    const nextPrefix = nextListPrefix(prefix)
    if (!nextPrefix) return

    // 阻止默认 Enter 行为，手动插入 \n（不插入序号前缀，让用户决定是否接受）
    e.preventDefault()
    const newValue = value.slice(0, pos) + '\n' + value.slice(end)
    onTextChange(newValue)
    const newPos = pos + 1

    // 在 rAF 后测量光标位置并显示建议（setText 触发重渲染后 mirror 才能测量准确）
    requestAnimationFrame(() => {
      textarea.selectionStart = newPos
      textarea.selectionEnd = newPos
      const coords = measureCaretCoordinates(textarea, newPos)
      setSeqSuggestion({
        prefix: nextPrefix,
        top: coords.top,
        left: coords.left,
      })
    })
  }, [enableSequenceSuggestion, editorMode, onTextChange, acceptSeqSuggestion, cancelSeqSuggestion, measureCaretCoordinates])

  /**
   * v1.1.0：原生 compositionend 事件监听（处理中文输入法下的建议接受）
   *
   * 为什么使用原生事件而非 React 的 onCompositionEnd？
   * 在 Electron + Windows 中文输入法环境下，React 合成事件的 onCompositionEnd 可能不触发
   * 或触发时序异常。使用原生 addEventListener 确保事件可靠捕获。
   *
   * 场景：用户在建议显示时通过中文输入法输入字符
   * - keydown 阶段 isComposing=true，handleSequenceKeyDown 直接 return（不干扰输入法）
   * - compositionend 触发时，字符已插入 textarea，但建议 state 仍在
   * - 此时在当前行行首插入建议前缀（实现"继续输入即接受"对中文输入法的支持）
   */
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return

    const handleNativeCompositionStart = () => {
      // v1.1.0 方案 B：移除"继续输入即接受"，compositionstart 时不做任何处理
      // 用户如需接受建议，请按 Tab 或 Enter
    }

    const handleNativeCompositionEnd = () => {
      // v1.1.0 修复：记录 compositionend 时间戳，用于区分 IME 确认 Enter 与用户实际 Enter
      lastCompositionEndRef.current = Date.now()
      // v1.1.0 方案 B：移除"继续输入即接受"，compositionend 后取消建议
      // 用户如需接受建议，请按 Tab 或 Enter
      if (enableSequenceSuggestion && editorMode === 'code' && seqSuggestionRef.current) {
        cancelSeqSuggestion()
      }
    }

    ta.addEventListener('compositionstart', handleNativeCompositionStart)
    ta.addEventListener('compositionend', handleNativeCompositionEnd)
    return () => {
      ta.removeEventListener('compositionstart', handleNativeCompositionStart)
      ta.removeEventListener('compositionend', handleNativeCompositionEnd)
    }
  }, [textareaRef, enableSequenceSuggestion, editorMode, cancelSeqSuggestion])

  // 文本变化、滚动、失焦、模式切换时取消建议（防止建议位置错位）
  // 注意：接受建议会调用 onTextChange → text 变化 → 取消建议（重复但无害，因为 state 已被清空）
  useEffect(() => {
    // 文本变化时若建议已空则无操作；若建议非空但来源是接受建议，则 state 已被清空，无需处理
    if (seqSuggestion) {
      // 仅在非接受操作导致的 text 变化时取消（如外部 setText、加载笔记、撤销）
      // 简化处理：任何 text 变化都取消建议（接受建议时已在 accept 函数内清空 state，不会进入此分支）
      // 但 accept 函数内先 setSeqSuggestion(null) 再 onTextChange，所以这里不会触发
      // 为安全起见，仅清空非空的 state
      // 注意：不能在这里无条件清空，因为接受建议时也会触发 text 变化
      // 实际上 accept 函数先调用 onTextChange 再 setSeqSuggestion(null)，
      // React 批处理后此 effect 会看到 seqSuggestion 仍为旧值（非 null）+ text 已变
      // 此时不应清空，因为建议已被接受（已插入文本）
      // 简化方案：不在 text 变化时清空，依赖 keydown 和滚动/失焦事件清空
    }
  }, [text, seqSuggestion])

  // textarea 滚动时取消建议（建议位置会错位）
  // 已在 onScroll 中通过 handleGutterSync 触发，但这里显式处理避免遗漏
  useEffect(() => {
    if (!seqSuggestion) return
    const ta = textareaRef.current
    if (!ta) return
    const handleScroll = () => cancelSeqSuggestion()
    ta.addEventListener('scroll', handleScroll)
    const handleBlur = () => cancelSeqSuggestion()
    ta.addEventListener('blur', handleBlur)
    return () => {
      ta.removeEventListener('scroll', handleScroll)
      ta.removeEventListener('blur', handleBlur)
    }
  }, [seqSuggestion, textareaRef, cancelSeqSuggestion])

  // 编辑器模式切换时取消建议
  useEffect(() => {
    if (editorMode !== 'code') {
      cancelSeqSuggestion()
    }
  }, [editorMode, cancelSeqSuggestion])

  // 状态栏统计：字数（去空白后的字符数）、字符数（含空白）、行数
  const stats = useMemo(() => {
    const chars = text.length
    const words = text.replace(/\s/g, '').length
    const lines = text === '' ? 0 : text.split('\n').length
    return { chars, words, lines }
  }, [text])

  // ===== minimap 调试日志（实时写入 %APPDATA%/OncePad/debug.log）=====
  // 用于排查视口指示器位置 bug，记录运行时数值供分析
  // 调试完成后可整体移除
  // v1.1.2 修复 Bug M-5：受 debugMode 控制，生产环境不写入（避免每次滚动触发 IPC）
  const logMinimap = (label: string, data: Record<string, unknown>) => {
    if (!debugMode) return
    try {
      const msg = `[minimap] ${label} ${JSON.stringify(data)}`
      // fire-and-forget，不阻塞交互
      void window.electronAPI.writeDebugLog(msg)
    } catch (e) {
      // IPC 调用失败时回退到 console，避免日志静默丢失
      console.error('[minimap log failed]', label, e)
    }
  }

  // 监听 textarea 宽度变化（用于视觉行号模式计算 mirror div 宽度）
  // 修复：原代码仅在 lineNumberMode==='visual' 时运行，导致第一次切换到 visual 时
  // textareaWidth=0，mirror div 宽度为 0，测量结果错误
  // 改为在 showLineNumbers=true 时就运行，提前获取 textareaWidth
  // mirror div 宽度同步：行号模式或 minimap 模式都需要
  // 关键修复：
  // 1. 必须从 getComputedStyle 读取实际的 paddingLeft/paddingRight（minimap 开启时 paddingRight=96px）
  // 2. 必须用 clientWidth 而不是 rect.width，因为 rect.width 包括 border + scrollbar，
  //    而 clientWidth 不包括。textarea 有 8px 滚动条，若用 rect.width 会导致 mirror div
  //    宽度比实际内容宽度多 8px，软换行位置不一致，产生累积跳转偏差
  // 3. 同步 mirror div 的字体相关样式（fontFamily/tabSize/fontWeight/fontStyle 等），
  //    确保 mirror div 测量的行高和 textarea 实际渲染一致。
  //    之前 mirror div 用硬编码的 CSS 变量值，且缺少 tabSize（默认8 vs textarea 的 indentSize），
  //    导致 visualLineOffsets 与 content 实际渲染位置不一致（midDiff ≠ 0）。
  useEffect(() => {
    if (!showLineNumbers && !showMinimap) return
    const ta = textareaRef.current
    if (!ta) return
    const updateWidth = () => {
      const taStyle = getComputedStyle(ta)
      const paddingLeft = parseFloat(taStyle.paddingLeft) || 32
      const paddingRight = parseFloat(taStyle.paddingRight) || 32
      // clientWidth 不包括 border 和 scrollbar，所以内容宽度 = clientWidth - paddingLeft - paddingRight
      const innerWidth = ta.clientWidth - paddingLeft - paddingRight
      setTextareaWidth(innerWidth)
      // 同步 mirror div 字体样式：从 textarea 读取，确保测量结果和 textarea 渲染一致
      const mirror = mirrorRef.current
      if (mirror) {
        mirror.style.fontFamily = taStyle.fontFamily
        mirror.style.fontSize = taStyle.fontSize
        mirror.style.lineHeight = taStyle.lineHeight
        mirror.style.fontWeight = taStyle.fontWeight
        mirror.style.fontStyle = taStyle.fontStyle
        mirror.style.tabSize = taStyle.tabSize
        mirror.style.whiteSpace = taStyle.whiteSpace || 'pre-wrap'
        mirror.style.wordBreak = taStyle.wordBreak || 'normal'
        mirror.style.overflowWrap = taStyle.overflowWrap || 'break-word'
        mirror.style.letterSpacing = taStyle.letterSpacing || '0.3px'
      }
    }
    updateWidth()
    const ro = new ResizeObserver(updateWidth)
    ro.observe(ta)
    return () => ro.disconnect()
  }, [showLineNumbers, showMinimap, textareaRef, indentSize, mirrorReady])

  // 检测 mirror div 挂载/卸载状态，同步到 mirrorReady state
  // 解决问题：切换到 visual 模式时 mirror div 首次渲染，ref.current 在 useMemo 计算后才赋值，
  // 但 ref 赋值不触发重渲染，导致 visualLineNumbers 一直保持退化状态（逻辑行号）
  // 通过 useLayoutEffect 在 DOM 变更后同步检测，强制触发一次重渲染
  useLayoutEffect(() => {
    const ready = mirrorRef.current !== null
    if (ready !== mirrorReady) {
      setMirrorReady(ready)
    }
  }, [showLineNumbers, showMinimap, editorMode, mirrorReady])

  // 诊断：minimapViewport 变化后，读取 viewport 指示器的实际渲染位置
  // 用于对比"预期百分比位置"和"实际像素位置"，定位 CSS 渲染偏差
  // v1.1.2 修复 Bug M-5：受 debugMode 控制，生产环境跳过（避免每次滚动做 Range 测量）
  useEffect(() => {
    if (!debugMode) return
    const viewport = minimapViewportRef.current
    const content = minimapContentRef.current
    const container = content?.parentElement
    if (!viewport || !container) return
    const cRect = container.getBoundingClientRect()
    const vpRect = viewport.getBoundingClientRect()
    const vpTopInContainer = vpRect.top - cRect.top
    const vpCenterInContainer = vpTopInContainer + vpRect.height / 2
    const clickY = lastClickYRef.current
    // 预期像素位置（基于 state 中的百分比）
    const expectedTopPx = (minimapViewport.top / 100) * cRect.height
    const expectedCenterPx = expectedTopPx + (minimapViewport.height / 100) * cRect.height / 2
    logMinimap('rendered', {
      vpTopInContainer: +vpTopInContainer.toFixed(1),
      vpHeight: +vpRect.height.toFixed(1),
      vpCenterInContainer: +vpCenterInContainer.toFixed(1),
      expectedTopPx: +expectedTopPx.toFixed(1),
      expectedCenterPx: +expectedCenterPx.toFixed(1),
      actualMinusExpectedTop: +(vpTopInContainer - expectedTopPx).toFixed(1),
      actualMinusExpectedCenter: +(vpCenterInContainer - expectedCenterPx).toFixed(1),
      clickY: clickY !== null ? +clickY.toFixed(1) : null,
      centerMinusClick: clickY !== null ? +(vpCenterInContainer - clickY).toFixed(1) : null,
      containerHeight: +cRect.height.toFixed(1),
      containerClientHeight: container.clientHeight,
      stateTop: minimapViewport.top,
      stateHeight: minimapViewport.height,
    })

    // 诊断：用 Range API 测量 content 内部行位置，和 visualLineOffsets 对比
    // 验证 content 内部文字行位置是否 = textarea 行位置（visualLineOffsets）
    // 如果 firstDiff/midDiff ≠ 0，说明 content 渲染和 textarea 不一致，是"不跟手"根因
    if (content && visualLineOffsets.length > 2) {
      const textNode = content.firstChild
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const contentRect = content.getBoundingClientRect()
        const ta = textareaRef.current
        const scaleY = ta && ta.scrollHeight > 0 ? contentRect.height / ta.scrollHeight : 1
        const range = document.createRange()
        // 第一行位置
        range.setStart(textNode, 0)
        range.setEnd(textNode, 0)
        const firstRect = range.getBoundingClientRect()
        const firstLineY = firstRect.top - cRect.top
        // 中间行位置（找第 midIndex 个换行符后的位置）
        const midIndex = Math.floor(visualLineOffsets.length / 2)
        const textStr = textNode.textContent || ''
        let charIdx = 0
        let lineCount = 0
        for (let i = 0; i < textStr.length && lineCount < midIndex; i++) {
          if (textStr[i] === '\n') lineCount++
          charIdx = i + 1
        }
        const safeIdx = Math.min(charIdx, textStr.length)
        range.setStart(textNode, safeIdx)
        range.setEnd(textNode, safeIdx)
        const midRect = range.getBoundingClientRect()
        const midLineY = midRect.top - cRect.top
        // 期望位置（visualLineOffsets × scaleY，因为 content 被 transform scale）
        const expectedFirstY = visualLineOffsets[0] * scaleY
        const expectedMidY = visualLineOffsets[midIndex] * scaleY
        logMinimap('contentLines', {
          firstLineY: +firstLineY.toFixed(1),
          expectedFirstY: +expectedFirstY.toFixed(1),
          firstDiff: +(firstLineY - expectedFirstY).toFixed(1),
          midLineY: +midLineY.toFixed(1),
          expectedMidY: +expectedMidY.toFixed(1),
          midDiff: +(midLineY - expectedMidY).toFixed(1),
          midIndex,
          scaleY: +scaleY.toFixed(4),
          contentRectHeight: +contentRect.height.toFixed(1),
          taScrollHeight: ta ? ta.scrollHeight : 0,
        })
      }
    }
  }, [minimapViewport, debugMode])

  // 统一行号列表：根据 lineNumberMode 生成对应的行号数据
  // 实现原理：使用隐藏的 mirror div，与 textarea 相同样式，逐行测量 scrollHeight 计算视觉行数
  //
  // 逻辑行号（logical）：每个逻辑行（按 \n 分割）第一行显示行号，软换行行显示空
  //   适合代码编辑：不回车算同一行
  //   示例：一行软换行成 3 行 → 显示 1, (空), (空), 2, 3...
  //
  // 视觉行号（visual）：每个显示行一个递增数字，软换行行也有行号
  //   适合阅读长文本：每个显示行都有编号
  //   示例：一行软换行成 3 行 → 显示 1, 2, 3, 4, 5...
  const lineNumbers = useMemo(() => {
    if (!showLineNumbers || editorMode !== 'code') return [] as { num: number | null; isSubLine: boolean }[]
    if (text === '') return [{ num: 1, isSubLine: false }]

    const lines = text.split('\n')
    const result: { num: number | null; isSubLine: boolean }[] = []
    const mirror = mirrorRef.current
    if (!mirror) {
      // mirror 未就绪，退化为简单逻辑行号（每个逻辑行一个数字）
      for (let i = 0; i < lines.length; i++) {
        result.push({ num: i + 1, isSubLine: false })
      }
      return result
    }

    // 获取行高（从 CSS 变量计算）
    const rootStyle = getComputedStyle(document.documentElement)
    const fontSize = parseFloat(rootStyle.getPropertyValue('--editor-font-size') || '14')
    const lineHeight = parseFloat(rootStyle.getPropertyValue('--editor-line-height') || '1.7')
    const pixelLineHeight = fontSize * lineHeight

    // 逐行测量视觉行数
    let visualLineCounter = 0 // 视觉行号模式的递增计数器
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i] || ''
      mirror.textContent = lineText || '\u00A0' // 空行用 nbsp 占位
      const scrollHeight = mirror.scrollHeight
      const visualRows = Math.max(1, Math.round(scrollHeight / pixelLineHeight))

      if (lineNumberMode === 'visual') {
        // 视觉行号：每个显示行一个递增数字
        for (let j = 0; j < visualRows; j++) {
          visualLineCounter++
          result.push({ num: visualLineCounter, isSubLine: j > 0 })
        }
      } else {
        // 逻辑行号：每个逻辑行第一行显示数字，软换行行空
        result.push({ num: i + 1, isSubLine: false })
        for (let j = 1; j < visualRows; j++) {
          result.push({ num: null, isSubLine: true })
        }
      }
    }
    return result
  }, [text, showLineNumbers, editorMode, lineNumberMode, textareaWidth, mirrorReady])

  // ===== DOM minimap + 行偏移映射方案 =====
  // 缩略图内容用 DOM div 渲染（真实文字，用户能看到 emoji 颜色和文档结构）
  // 跳转用 visualLineOffsets 查表（精确，不依赖 DOM scrollHeight 的比例假设）
  // 视口指示器基于 visualLineOffsets 定位（不依赖 scrollTop/scrollHeight 比例）

  // 视觉行偏移数组：visualLineOffsets[i] = 视觉行 i 在 textarea 内容中的像素偏移（含 paddingTop）
  // 用于精确的 minimap 点击跳转和视口定位
  // 关键修复：
  // 1. mirror div 宽度必须与 textarea 实际内容宽度一致（考虑 minimap paddingRight: 96px）
  // 2. 每行用实际高度累积（lineScrollHeight / visualRows），不用固定 pixelLineHeight
  //    原因：Math.round 会有舍入误差，如某行实际 2.4*pixelLineHeight，round 后 visualRows=2，
  //    但实际占 2.4 行高度，若用固定 pixelLineHeight 累积会少算 0.4*pixelLineHeight，导致累积误差
  const visualLineOffsets = useMemo(() => {
    if (!showMinimap || editorMode !== 'code') return []
    if (text === '') return []
    const ta = textareaRef.current
    const mirror = mirrorRef.current
    if (!ta || !mirror) return []

    const taStyle = getComputedStyle(ta)
    const taPaddingTop = parseFloat(taStyle.paddingTop) || 24
    const rootStyle = getComputedStyle(document.documentElement)
    const fontSize = parseFloat(rootStyle.getPropertyValue('--editor-font-size') || '14')
    const lineHeightRatio = parseFloat(rootStyle.getPropertyValue('--editor-line-height') || '1.7')
    const pixelLineHeight = fontSize * lineHeightRatio

    const lines = text.split('\n')
    const offsets: number[] = []
    let currentOffset = taPaddingTop
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i] || ''
      mirror.textContent = lineText || '\u00A0'
      const lineScrollHeight = mirror.scrollHeight
      const visualRows = Math.max(1, Math.round(lineScrollHeight / pixelLineHeight))
      // 每个视觉行的实际高度 = 该行总高度 / 视觉行数（消除舍入误差）
      const actualLineHeight = lineScrollHeight / visualRows
      for (let j = 0; j < visualRows; j++) {
        offsets.push(currentOffset)
        currentOffset += actualLineHeight
      }
    }
    return offsets
  }, [text, showMinimap, editorMode, textareaWidth, mirrorReady])

  // 按比例缩放渲染 minimap DOM 内容（真实文字）
  // 缩略图内容显示真实文字，用户能看到 emoji 颜色和文档结构
  // 注意：此函数仅负责视觉渲染，跳转精度由 visualLineOffsets 保证
  const syncMinimapContent = (ta: HTMLTextAreaElement | null) => {
    if (!ta) return
    const content = minimapContentRef.current
    if (!content) return
    const container = content.parentElement
    if (!container) return

    const taStyle = getComputedStyle(ta)
    const taFontSize = parseFloat(taStyle.fontSize) || 14
    const rootStyle = getComputedStyle(document.documentElement)
    const taLineHeightRatio = parseFloat(rootStyle.getPropertyValue('--editor-line-height')) || 1.7
    const taPaddingTop = parseFloat(taStyle.paddingTop) || 24
    const taPaddingBottom = parseFloat(taStyle.paddingBottom) || 24
    // 使用实际 paddingLeft/paddingRight（minimap 开启时 paddingRight=96px）
    const taPaddingLeft = parseFloat(taStyle.paddingLeft) || 32
    const taPaddingRight = parseFloat(taStyle.paddingRight) || 32

    // minimap 内容区域宽度 = 容器宽度 - 容器水平 padding
    const containerStyle = getComputedStyle(container)
    const containerPaddingLeft = parseFloat(containerStyle.paddingLeft) || 4
    const containerPaddingRight = parseFloat(containerStyle.paddingRight) || 4
    const minimapContentWidth = container.clientWidth - containerPaddingLeft - containerPaddingRight
    if (minimapContentWidth <= 0) return

    if (ta.clientWidth <= 0) return

    // 方案 G：content 使用和 textarea 完全相同的布局参数（fontSize/lineHeight/padding/width）
    // 这样 contentHeight = scrollHeight（精确一致）
    // 然后用 transform: scale(scaleX, scaleY) 整体缩放到 minimap 容器大小
    // transform 是渲染后整体缩放，不受字体渲染非线性影响
    // 解决"不跟手"：content 内部位置和 textarea 位置 1:1 对应，指示器位置精确对齐
    content.style.fontSize = `${taFontSize}px`
    content.style.lineHeight = `${taLineHeightRatio}`
    content.style.paddingTop = `${taPaddingTop}px`
    content.style.paddingBottom = `${taPaddingBottom}px`
    content.style.paddingLeft = `${taPaddingLeft}px`
    content.style.paddingRight = `${taPaddingRight}px`
    content.style.width = `${ta.clientWidth}px`

    // 同步换行相关 CSS 属性（不缩放，和 textarea 完全一致）
    content.style.whiteSpace = taStyle.whiteSpace || 'pre-wrap'
    content.style.wordBreak = taStyle.wordBreak || 'normal'
    content.style.overflowWrap = taStyle.overflowWrap || 'break-word'
    content.style.letterSpacing = taStyle.letterSpacing || '0.3px'
    // 关键修复：同步 fontFamily 和 tabSize
    // 之前遗漏了这两个属性，导致 content 和 textarea 的文字渲染宽度不一致
    // 特别是 tabSize：textarea 有 tabSize=indentSize（默认2），content 默认 tab-size=8
    // 如果文本含 Tab 字符，换行位置会不同，导致"越往下偏移越大"
    content.style.fontFamily = taStyle.fontFamily
    content.style.tabSize = taStyle.tabSize
    content.style.fontWeight = taStyle.fontWeight
    content.style.fontStyle = taStyle.fontStyle

    // transform: scale 整体缩放
    // scaleX = 宽度缩放（minimapContentWidth / ta.clientWidth）
    // scaleY = 高度缩放（containerHeight / scrollHeight），让 content 视觉高度 = containerHeight
    const scrollHeight = ta.scrollHeight
    const containerHeight = container.clientHeight
    const scaleX = ta.clientWidth > 0 ? minimapContentWidth / ta.clientWidth : 1
    const scaleY = containerHeight > 0 && scrollHeight > 0
      ? containerHeight / scrollHeight
      : 1
    content.style.transform = `scale(${scaleX}, ${scaleY})`
    content.style.transformOrigin = 'top left'

    logMinimap('sync', {
      scaleX: +scaleX.toFixed(4),
      scaleY: +scaleY.toFixed(4),
      contentFontSize: taFontSize,
      scrollHeight,
      containerHeight,
      taClientHeight: ta.clientHeight,
      contentHeight: content.scrollHeight,
      contentHeightEqualsScrollHeight: content.scrollHeight === scrollHeight,
    })
  }

  // 计算 minimap 视口指示器位置：基于实际滚动几何映射
  // 视口在 textarea 滚动内容中的范围 [scrollTop, scrollTop + clientHeight]
  // 映射到 minimap 容器坐标后转为百分比
  // 旧实现用 topLineIndex/totalVisualLines 假设行均匀分布，与实际行高不符导致指示器错位
  const updateMinimapViewport = (ta: HTMLTextAreaElement | null) => {
    if (!ta || ta.scrollHeight <= 0) {
      setMinimapViewport({ top: 0, height: 100 })
      return
    }
    const content = minimapContentRef.current
    const container = content?.parentElement
    if (!content || !container || container.clientHeight <= 0) {
      setMinimapViewport({ top: 0, height: 100 })
      return
    }
    const contentHeight = content.scrollHeight
    const containerHeight = container.clientHeight
    // 直接用 textarea 自身的滚动比例计算指示器位置
    // 不依赖 containerHeight/contentHeight 的转换，避免坐标系混乱
    // minimap 容器代表整个文档（top:0% ~ bottom:100%）
    // 指示器 top = scrollTop 占文档百分比，height = clientHeight 占文档百分比
    // 日志验证：pureTopPercent 和 pureHeightPercent 始终正确（0.51% 和 30.95%）
    // 而基于 ratio 的 topPercent/heightPercent 在大窗口下异常（0.08% 和 4.86%）
    const topPercent = Math.max(0, (ta.scrollTop / ta.scrollHeight) * 100)
    const heightPercent = Math.max(3, (ta.clientHeight / ta.scrollHeight) * 100)
    // 读取 content 实际生效的 transform，验证 scaleY 是否已应用
    const contentTransform = getComputedStyle(content).transform
    logMinimap('viewport', {
      scrollTop: +ta.scrollTop.toFixed(1),
      scrollHeight: ta.scrollHeight,
      clientHeight: ta.clientHeight,
      contentHeight,
      containerHeight,
      overflow: contentHeight > containerHeight,
      topPercent: +topPercent.toFixed(2),
      heightPercent: +heightPercent.toFixed(2),
      contentTransform,
    })
    setMinimapViewport({ top: topPercent, height: heightPercent })
  }

  // textarea 滚动时同步行号栏滚动位置 + 更新 minimap 视口指示器 + 同步 overlay 高亮层
  const handleGutterSync = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current && e.currentTarget) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop
    }
    // 同步 overlay div 滚动位置（搜索高亮层）
    if (overlayRef.current && e.currentTarget) {
      overlayRef.current.scrollTop = e.currentTarget.scrollTop
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
    updateMinimapViewport(e.currentTarget)
  }

  // 文本变化、minimap 开关、编辑器模式切换时，重新渲染 minimap 内容和视口
  useEffect(() => {
    if (!showMinimap || editorMode !== 'code') return
    const ta = textareaRef.current
    if (!ta) return
    const raf = requestAnimationFrame(() => {
      syncMinimapContent(textareaRef.current)
      updateMinimapViewport(textareaRef.current)
    })
    return () => cancelAnimationFrame(raf)
  }, [showMinimap, editorMode, text, textareaRef, visualLineOffsets])

  // 监听 textarea 尺寸变化（窗口拖动跨屏幕/分辨率变化/窗口 resize）
  useEffect(() => {
    if (!showMinimap || editorMode !== 'code') return
    const ta = textareaRef.current
    if (!ta) return
    const ro = new ResizeObserver(() => {
      syncMinimapContent(textareaRef.current)
      updateMinimapViewport(textareaRef.current)
    })
    ro.observe(ta)
    return () => ro.disconnect()
  }, [showMinimap, editorMode, textareaRef, visualLineOffsets])

  // ===== 搜索替换 overlay 高亮渲染（v1.3.0）=====
  // 搜索专用 mirror div：用于 scrollToMatch 精确测量匹配项像素位置（考虑软换行）
  const searchMirrorRef = useRef<HTMLDivElement>(null)
  // 高亮渲染缓存（性能优化：currentIndex 变化时仅切换 class，不重建 innerHTML）
  const prevCurrentMarkRef = useRef<HTMLElement | null>(null)
  const prevMatchesLengthRef = useRef(0)
  // P0-1 修复：缓存 text 内容，文本编辑后匹配数相同时也需重建 innerHTML（否则 overlay 显示旧文本）
  const prevTextRef = useRef('')
  // v1.3.2 P5 修复：mode toggle 后第一次 effect 跑时跳过 scrollToCurrentMatch
  //   （toggleEditorMode preview→code 已基于 search match line 设置了 scrollTop）
  //   用 prevEditorModeRef 检测 mode 变化
  const prevEditorModeRef = useRef(editorMode)

  /** HTML 转义（防止 XSS，overlay innerHTML 构建时使用） */
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /** 同步 overlay 样式自 textarea（确保高亮位置精确对齐，复用 measureCaretCoordinates 样式同步逻辑） */
  const syncOverlayStyle = useCallback((overlay: HTMLDivElement, textarea: HTMLTextAreaElement) => {
    const taStyle = getComputedStyle(textarea)
    overlay.style.fontFamily = taStyle.fontFamily
    overlay.style.fontSize = taStyle.fontSize
    overlay.style.fontWeight = taStyle.fontWeight
    overlay.style.fontStyle = taStyle.fontStyle
    overlay.style.lineHeight = taStyle.lineHeight
    overlay.style.letterSpacing = taStyle.letterSpacing
    overlay.style.tabSize = taStyle.tabSize
    // v1.3.2 P4 修复：先重置 shorthand padding（防止 CSS .editor-overlay { padding: 24px 32px } 覆盖单独 paddingLeft 等）
    overlay.style.padding = ''
    overlay.style.paddingTop = taStyle.paddingTop
    overlay.style.paddingRight = taStyle.paddingRight
    overlay.style.paddingBottom = taStyle.paddingBottom
    overlay.style.paddingLeft = taStyle.paddingLeft
    overlay.style.borderTopWidth = taStyle.borderTopWidth
    overlay.style.borderRightWidth = taStyle.borderRightWidth
    overlay.style.borderBottomWidth = taStyle.borderBottomWidth
    overlay.style.borderLeftWidth = taStyle.borderLeftWidth
    overlay.style.whiteSpace = taStyle.whiteSpace || 'pre-wrap'
    overlay.style.wordBreak = taStyle.wordBreak || 'normal'
    overlay.style.overflowWrap = taStyle.overflowWrap || 'break-word'
    // v1.3.2 P6 修复：overlay.width 必须等于 textarea.clientWidth（不是 clientWidth - padding）
    //   原因：textarea clientWidth 已包含 padding 内部的内容区（border-box），
    //   overlay 是 absolute 定位、grid-column: 2，物理宽度应等于 grid cell 宽度 = textarea.clientWidth
    //   再加 padding 让 overlay 文字内容区 = textarea 文字内容区（clientWidth - paddingLeft - paddingRight）
    //   旧逻辑：overlay.width = clientWidth - padding → overlay 物理宽度 = 950 (含 padding)
    //   → overlay 文字内容区 = 950 - 64 = 886（比 textarea 文字 950 少 64px）
    //   → wrap 行数不一致 → 文本位置错乱（mark 与 textarea 文字对不齐）
    overlay.style.width = `${textarea.clientWidth}px`
    // v1.3.2 修复：overlay 高度 = textarea 可视高度。CSS height:100% 相对 editor-container
    //（含底部状态栏的总高），比编辑区高出一截——搜索时文本溢出压在字数状态栏上，
    // 且 overlay 最大 scrollTop 与 textarea 不一致，底部滚动同步被 clamp 错位
    overlay.style.height = `${textarea.clientHeight}px`
  }, [])

  /**
   * 渲染 overlay 高亮（编辑模式）
   * 性能优化：matches 数量未变时仅切换 current class，不重建 innerHTML
   * 匹配项分为两类样式：search-match（黄色）+ search-match-current（橙色）
   * P0-1 修复：缓存条件增加 text 内容比较，文本编辑后匹配数相同时也需重建 innerHTML
   */
  const renderOverlayHighlight = useCallback((
    overlay: HTMLDivElement,
    text: string,
    matches: Match[],
    currentIndex: number
  ) => {
    // 性能优化：matches 数量 + text 内容均未变时，仅切换 current class（避免重建 innerHTML）
    if (matches.length === prevMatchesLengthRef.current && matches.length > 0
        && prevCurrentMarkRef.current && prevTextRef.current === text) {
      prevCurrentMarkRef.current.className = 'search-match'
      const marks = overlay.querySelectorAll('mark')
      const newCurrent = marks[currentIndex] as HTMLElement | null
      if (newCurrent) {
        newCurrent.className = 'search-match-current'
        prevCurrentMarkRef.current = newCurrent
        return
      }
    }
    // matches 变化或 text 变化：重建全部 innerHTML
    overlay.innerHTML = ''
    if (matches.length === 0) {
      // v1.3.2 修复：无匹配时也要渲染纯文本——
      // 搜索激活时 textarea 文字已透明（with-search class），overlay 是唯一的文本承载层；
      // 之前这里直接清空，导致 Ctrl+F 刚打开（空搜索词）或输入无匹配词时编辑区整体空白
      // 末尾补 \n：textarea 作为 replaced element 底部恒预留一个空行（~一行高），
      // overlay 不补则 scrollHeight 少一行，底部滚动被 clamp 导致 mark 与文本错位
      overlay.textContent = text + '\n'
      prevMatchesLengthRef.current = 0
      prevCurrentMarkRef.current = null
      prevTextRef.current = ''
      return
    }
    let lastEnd = 0
    const fragments: string[] = []
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]
      // 普通文本段（转义防止 XSS）
      fragments.push(escapeHtml(text.slice(lastEnd, m.start)))
      // 高亮段
      const cls = i === currentIndex ? 'search-match-current' : 'search-match'
      fragments.push(`<mark class="${cls}">${escapeHtml(m.text)}</mark>`)
      lastEnd = m.end
    }
    // 末尾普通文本
    fragments.push(escapeHtml(text.slice(lastEnd)))
    // v1.3.2 修复（恢复 2026-08-10 丢失的补丁）：末尾补 \n 使 overlay.scrollHeight
    // 与 textarea 对齐（textarea 底部恒预留一个空行），否则滚动到底部区域时 overlay 的
    // scrollTop 被 clamp 在更小的最大值，mark 高亮相对文本逐渐偏移一行
    overlay.innerHTML = fragments.join('') + '\n'
    prevMatchesLengthRef.current = matches.length
    prevCurrentMarkRef.current = overlay.querySelectorAll('mark')[currentIndex] as HTMLElement | null
    // P0-1 修复：缓存当前 text 内容
    prevTextRef.current = text
  }, [])

  /**
   * 滚动到当前匹配项
   * 使用 searchMirror div 精确测量像素位置（考虑软换行）
   * 复用 EditorArea 现有 mirror div 测量技术（visualLineOffsets 同款方案）
   * 无 mirror div 时降级为行号 × 行高估算（可能有软换行偏差）
   * P1-4 修复：动态同步 mirrorDiv 的 padding 样式，使 scrollHeight 含 padding 后减去 paddingTop 计算正确
   * P1-5 修复：动态同步 mirrorDiv 的 width 样式，确保软换行位置与 textarea 一致
   */
  const scrollToCurrentMatch = useCallback((
    textarea: HTMLTextAreaElement,
    match: Match,
    mirrorDiv: HTMLDivElement | null
  ) => {
    if (mirrorDiv) {
      const taStyle = getComputedStyle(textarea)
      // P1-5 修复：同步 width（clientWidth 含 padding 但不含 border/scrollbar，与 textarea 内容区一致）
      mirrorDiv.style.width = `${textarea.clientWidth}px`
      // v1.3.2 P4 修复：先重置 shorthand padding（JSX inline style: padding: '0' 会覆盖单独的 paddingTop 等）
      mirrorDiv.style.padding = ''
      // P1-4 修复：同步 padding（使 scrollHeight 包含 padding，计算时减去 paddingTop 得到纯文本高度）
      mirrorDiv.style.paddingTop = taStyle.paddingTop
      mirrorDiv.style.paddingRight = taStyle.paddingRight
      mirrorDiv.style.paddingBottom = taStyle.paddingBottom
      mirrorDiv.style.paddingLeft = taStyle.paddingLeft
      // v1.3.2 P4 修复：同步 box-sizing（textarea 默认 content-box，mirror div 必须一致，否则 width 计算不同）
      mirrorDiv.style.boxSizing = taStyle.boxSizing || 'content-box'
      // v1.3.2 P4 修复：同步 overflow-wrap（textarea 默认 overflow-wrap: break-word，影响 wrap 行为）
      mirrorDiv.style.overflowWrap = taStyle.overflowWrap || 'break-word'
      mirrorDiv.style.fontFamily = taStyle.fontFamily
      mirrorDiv.style.fontSize = taStyle.fontSize
      mirrorDiv.style.lineHeight = taStyle.lineHeight
      mirrorDiv.style.letterSpacing = taStyle.letterSpacing
      // v1.3.2 修复：同步 tabSize——textarea 有 inline tabSize（indentSize），
      // mirror 不同步则含 Tab 文本的软换行位置算错，导致匹配项垂直定位偏移
      mirrorDiv.style.tabSize = taStyle.tabSize
      // 精确测量：用 mirror div 填入匹配前的文本，测量 scrollHeight
      const textBefore = textarea.value.slice(0, match.start)
      mirrorDiv.textContent = textBefore || '\u00A0'
      const taPaddingTop = parseFloat(taStyle.paddingTop) || 24
      // mirrorDiv.scrollHeight = paddingTop + 文本高度 + paddingBottom
      // 因 .editor CSS 中 paddingTop === paddingBottom（同一 CSS 变量 --editor-padding-y）
      // 故 targetTop = scrollHeight - paddingTop = 文本高度 + paddingBottom = paddingTop + 文本高度
      // 即匹配项在 scrollable content 中的正确垂直位置
      const targetTop = mirrorDiv.scrollHeight - taPaddingTop
      // 仅在匹配项不在视口内时滚动
      if (targetTop < textarea.scrollTop || targetTop > textarea.scrollTop + textarea.clientHeight) {
        textarea.scrollTop = targetTop - textarea.clientHeight / 3
      }
    } else {
      // 降级：用行号估算（无 mirror div 时，可能有软换行偏差）
      const taStyle = getComputedStyle(textarea)
      const lineHeight = parseFloat(taStyle.lineHeight) || 24
      const targetTop = match.line * lineHeight
      if (targetTop < textarea.scrollTop || targetTop > textarea.scrollTop + textarea.clientHeight) {
        textarea.scrollTop = targetTop - textarea.clientHeight / 3
      }
    }
    textarea.focus()
    textarea.setSelectionRange(match.start, match.end)
  }, [])

  // 副作用：搜索状态变化时渲染高亮 + 滚动 + with-search class 切换
  useEffect(() => {
    const textarea = textareaRef.current
    const overlay = overlayRef.current
    if (!textarea || !overlay) return

    if (!searchIsActive || editorMode !== 'code') {
      // 搜索关闭或非编辑模式：清除高亮 + 移除 with-search class
      overlay.innerHTML = ''
      prevMatchesLengthRef.current = 0
      prevCurrentMarkRef.current = null
      prevTextRef.current = ''
      textarea.classList.remove('with-search')
      return
    }

    // 编辑模式 + 搜索激活：同步 overlay 样式 + 渲染高亮 + 添加 with-search class
    syncOverlayStyle(overlay, textarea)
    renderOverlayHighlight(overlay, text, searchMatches, searchCurrentIndex)
    textarea.classList.add('with-search')

    // 滚动到当前匹配项
    // v1.3.2 P5 修复：仅当 matches/currentIndex 变化时滚动（用户主动 next/prev/输入）
    //   mode 切换时 scrollTop 已由 toggleEditorMode 处理（基于 search match line 计算），
    //   scrollToCurrentMatch 若再覆盖会让 caret 位置与用户预期不一致
    const isModeJustChanged = prevEditorModeRef.current !== editorMode
    prevEditorModeRef.current = editorMode
    if (searchCurrentIndex >= 0 && searchCurrentIndex < searchMatches.length) {
      if (isModeJustChanged) {
        // mode toggle 后：只设置 selectionRange（caret 位置），不覆盖 scrollTop
        textarea.focus()
        textarea.setSelectionRange(searchMatches[searchCurrentIndex].start, searchMatches[searchCurrentIndex].end)
      } else {
        scrollToCurrentMatch(textarea, searchMatches[searchCurrentIndex], searchMirrorRef.current)
      }
    }
  }, [searchMatches, searchCurrentIndex, searchIsActive, editorMode, text, textareaRef, overlayRef, syncOverlayStyle, renderOverlayHighlight, scrollToCurrentMatch])

  // v1.3.2 P1 修复：preview 模式搜索高亮 + 滚动
  // 之前浏览模式下搜索无任何视图反馈（overlay 仅 code 模式渲染，preview 文本不滚动）
  // 这里用 mark.js 给 preview 容器（previewRef）打 mark，再 scrollIntoView 定位当前匹配
  useEffect(() => {
    const preview = previewRef.current
    if (!preview) return
    // 非预览模式：清空 mark
    if (!searchIsActive || editorMode !== 'preview' || !searchQuery) {
      const existing = preview.querySelectorAll('mark')
      existing.forEach(m => {
        const text = document.createTextNode(m.textContent || '')
        m.parentNode?.replaceChild(text, m)
      })
      preview.normalize()
      return
    }
    // preview 模式 + 搜索激活 + 有 query：用 mark.js 高亮
    try {
      const instance = new Mark(preview)
      // unmark + mark 会破坏 DOM 结构（mark.js 会拆文本节点），
      // 但因为 preview 是 dangerouslySetInnerHTML，下一次 text 变化时 React 会重建，
      // 所以临时破坏是可接受的
      instance.unmark({
        done: () => {
          // 计算正则
          let pattern: RegExp
          try {
            if (searchOptions.regex) {
              const flags = 'g' + (searchOptions.caseSensitive ? '' : 'i') + 'u'
              pattern = new RegExp(searchQuery, flags)
            } else {
              const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\  }, [searchMatches, searchCurrentIndex, searchIsActive, editorMode, text, textareaRef, overlayRef, syncOverlayStyle, renderOverlayHighlight, scrollToCurrentMatch])')
              const flags = 'g' + (searchOptions.caseSensitive ? '' : 'i') + 'u'
              const finalPattern = searchOptions.wholeWord ? '\\b' + escaped + '\\b' : escaped
              pattern = new RegExp(finalPattern, flags)
            }
          } catch {
            return // 正则错误跳过
          }
          // 跨元素匹配 — mark.js 默认 exclude: ['script','style'] 已够用
          instance.markRegExp(pattern, {
            acrossElements: true,
            done: (count: number) => {
              // 高亮完成后，定位到当前匹配项（scrollIntoView）
              // v1.3.2 P1 修复：用 'instant' 而非 'smooth'：
              //   smooth 滚动是异步，连续按 next 时上一次滚动未完成就被打断，
              //   导致视图停留在第 1 个匹配，看起来搜索"不工作"
              const marks = preview.querySelectorAll('mark')
              // v1.3.2 P3 修复：标记当前匹配为 current class（与其他匹配区分开），
              //   否则预览模式所有匹配统一黄色，用户看不出跳到哪
              marks.forEach((m, idx) => {
                if (idx === searchCurrentIndex) {
                  m.className = 'search-match-current'
                } else {
                  m.className = 'search-match'
                }
              })
              if (searchCurrentIndex >= 0 && searchCurrentIndex < marks.length) {
                marks[searchCurrentIndex].scrollIntoView({ block: 'center', behavior: 'instant' })
              }
            },
          })
        },
      })
    } catch (e) {
      // mark.js 异常忽略，不影响搜索功能
      console.warn('[preview search] mark.js failed:', e)
    }
  }, [searchIsActive, searchQuery, searchOptions, searchCurrentIndex, editorMode, text])

  return (
    <>
      {/* 编辑器容器：textarea + MD预览，支持拖拽 .md 文件打开 */}
      <div
        className={`editor-container ${showLineNumbers && editorMode === 'code' ? 'with-gutter' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        {/* 行号栏：仅在 code 模式且开启行号显示时渲染 */}
        {showLineNumbers && editorMode === 'code' && (
          <div className="editor-gutter" ref={gutterRef} aria-hidden="true">
            {/* 统一渲染：lineNumbers 已根据 lineNumberMode 生成对应数据
                - 逻辑行号：每个逻辑行第一行显示数字，软换行行（isSubLine=true）显示空
                - 视觉行号：每个显示行一个递增数字，软换行行也显示数字 */}
            {lineNumbers.map((item, idx) => (
              <div key={idx} className={`gutter-line ${item.isSubLine ? 'gutter-sub-line' : ''}`}>
                {item.num ?? ''}
              </div>
            ))}
          </div>
        )}
        {/* 隐藏的 mirror div：用于计算每行软换行后的视觉行数（行号模式 + minimap 共用）
            渲染条件：行号模式或 minimap 任一开启时
            原因：若仅在某一模式渲染，切换模式时 mirror 首次挂载后 ref.current 已赋值，
            但 ref 赋值不触发重渲染，导致 lineNumbers/visualLineOffsets 保持退化状态 */}
        {(showLineNumbers || showMinimap) && editorMode === 'code' && (
          <div
            ref={mirrorRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '-9999px',
              top: '0',
              width: `${textareaWidth}px`,
              padding: '0',
              margin: '0',
              border: '0',
              font: 'inherit',
              fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--editor-font') || 'monospace',
              fontSize: getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size') || '14px',
              lineHeight: getComputedStyle(document.documentElement).getPropertyValue('--editor-line-height') || '1.7',
              letterSpacing: '0.3px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'hidden',
              visibility: 'hidden',
              pointerEvents: 'none',
            }}
          />
        )}
        {/* 搜索高亮 overlay div（v1.3.0）：位于 textarea 下方，pointer-events: none 不拦截鼠标
            textarea 文字透明（with-search class）+ caret 可见，overlay 用 <mark> 高亮匹配
            样式由 syncOverlayStyle() 从 textarea 同步，确保高亮位置精确对齐 */}
        {editorMode === 'code' && (
          <div
            ref={overlayRef}
            className="editor-overlay"
            aria-hidden="true"
          />
        )}
        {/* 搜索专用 mirror div：用于 scrollToCurrentMatch 精确测量匹配项像素位置
            复制 textarea 样式，填入匹配前文本测量 scrollHeight（考虑软换行）
            仅在搜索激活 + 编辑模式时渲染 */}
        {searchIsActive && editorMode === 'code' && (
          <div
            ref={searchMirrorRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '-9999px',
              top: '0',
              padding: '0',
              margin: '0',
              border: '0',
              font: 'inherit',
              fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--editor-font') || 'monospace',
              fontSize: getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size') || '14px',
              lineHeight: getComputedStyle(document.documentElement).getPropertyValue('--editor-line-height') || '1.7',
              letterSpacing: '0.3px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'hidden',
              visibility: 'hidden',
              pointerEvents: 'none',
            }}
          />
        )}
        <textarea
          ref={textareaRef}
          className="editor"
          style={{
            tabSize: indentSize,
            display: editorMode === 'code' ? 'block' : 'none',
            // 开启 minimap 时增加右侧 padding，避免文本被 minimap 遮挡
            paddingRight: (showMinimap && editorMode === 'code') ? '96px' : '32px',
          }}
          value={text}
          onChange={(e) => {
            onTextChange(e.target.value)
            // v1.3.2 P7 修复：编辑文本后光标位置变化，重置 navAnchor 让下次 next/prev 用新 caret
            onResetSearchNavAnchor?.()
          }}
          onKeyDown={(e) => {
            // v1.1.0 修复：优先处理序号补全，避免 onTabKey 先插入缩进导致 Tab 接受建议时双重处理
            // 原问题：onTabKey 先调用并 preventDefault + 插入缩进，handleSequenceKeyDown 不被调用，
            //         预览未取消，后续输入时预览被接受叠加到缩进后
            // 修复后：先调用 handleSequenceKeyDown，若已 preventDefault（如接受建议）则跳过 onTabKey
            handleSequenceKeyDown(e)
            if (!e.defaultPrevented) {
              onTabKey(e)
            }
          }}
          onWheel={onWheel}
          onScroll={(e) => {
            handleGutterSync(e)
            onEditorScroll()
          }}
          onClick={onUpdateCursorLine}
          onKeyUp={onUpdateCursorLine}
          placeholder={t('editor.placeholder')}
          spellCheck={false}
          autoFocus
        />

        {/* 缩略图（minimap）：DOM 渲染真实文字 + 行偏移映射精确跳转
            仅在 code 模式且开启 showMinimap 时渲染
            实现原理（DOM + 行偏移映射）：
            1. content div 显示完整文档缩略图（真实文字，按比例缩放 + transform: scaleY 适配高度）
            2. 视口指示器基于 visualLineOffsets 定位（精确，不依赖 scrollHeight 比例）
            3. 点击/拖动 → 视觉行索引 → 查 visualLineOffsets 表 → ta.scrollTop（无累积误差） */}
        {showMinimap && editorMode === 'code' && (
          <div
            className="editor-minimap"
            onMouseDown={(e) => {
              const ta = textareaRef.current
              if (!ta) return
              const container = e.currentTarget
              const containerRect = container.getBoundingClientRect()
              if (containerRect.height <= 0 || visualLineOffsets.length === 0) return

              const jumpToPosition = (clientY: number) => {
                const clickY = clientY - containerRect.top
                const containerHeight = containerRect.height
                const maxScroll = ta.scrollHeight - ta.clientHeight
                const scrollTopBefore = ta.scrollTop
                if (containerHeight <= 0 || maxScroll <= 0) return
                // ===== 关键修复：maxScroll 截断导致指示器"不跟手" =====
                // 问题：当指示器高度占容器很大比例时（小屏幕+内容少，heightPercent 可达 46%），
                // 点击靠近底部时 targetScroll > maxScroll，scrollTop 被截断到 maxScroll，
                // 导致指示器中心无法到达点击位置（偏差可达 200+ px），用户感觉"完全不跟手"。
                //
                // 修复：限制 clickY 的有效范围，使指示器中心始终能对齐（截断后的）点击位置。
                // 指示器高度 height = clientHeight/scrollHeight × containerHeight
                // 指示器中心范围 [height/2, containerHeight - height/2]
                // 当 clickY 超出此范围时，截断到边界，此时 textarea 会滚动到 0 或 maxScroll。
                //
                // 数学验证（clickY 被截断到 maxClickY 时）：
                //   clampedClickY = containerHeight - height/2
                //   clickRatio = 1 - height/(2×containerHeight) = 1 - clientHeight/(2×scrollHeight)
                //   targetScroll = clickRatio × scrollHeight - clientHeight/2
                //                = scrollHeight - clientHeight/2 - clientHeight/2 = scrollHeight - clientHeight = maxScroll ✅
                //   指示器中心 = clampedClickY = containerHeight - height/2 ✅（对齐截断后的点击位置）
                const indicatorHeight = (ta.clientHeight / ta.scrollHeight) * containerHeight
                const minClickY = indicatorHeight / 2
                const maxClickY = containerHeight - indicatorHeight / 2
                const isClampedTop = clickY < minClickY
                const isClampedBottom = clickY > maxClickY
                const clampedClickY = Math.max(minClickY, Math.min(maxClickY, clickY))
                // 点击位置 → 视口中心映射（VSCode 式 minimap 行为）
                const clickRatio = clampedClickY / containerHeight
                const targetScroll = clickRatio * ta.scrollHeight - ta.clientHeight / 2
                ta.scrollTop = Math.max(0, Math.min(maxScroll, targetScroll))
                // 点击位置占容器百分比（用户期望指示器出现的位置，作为对照）
                const clickPercent = (clickY / containerHeight) * 100
                const clampedClickPercent = (clampedClickY / containerHeight) * 100
                // 记录点击 Y 供 rendered 诊断日志对照
                lastClickYRef.current = clampedClickY
                logMinimap('jump', {
                  clickY: +clickY.toFixed(1),
                  clampedClickY: +clampedClickY.toFixed(1),
                  containerHeight: +containerHeight.toFixed(1),
                  clickPercent: +clickPercent.toFixed(2),
                  clampedClickPercent: +clampedClickPercent.toFixed(2),
                  scrollHeight: ta.scrollHeight,
                  clientHeight: ta.clientHeight,
                  maxScroll,
                  indicatorHeight: +indicatorHeight.toFixed(1),
                  minClickY: +minClickY.toFixed(1),
                  maxClickY: +maxClickY.toFixed(1),
                  isClampedTop,
                  isClampedBottom,
                  clickRatio: +clickRatio.toFixed(4),
                  targetScroll: +targetScroll.toFixed(1),
                  scrollTopBefore: +scrollTopBefore.toFixed(1),
                  scrollTopAfter: +ta.scrollTop.toFixed(1),
                  // 指示器中心百分比（修复后应 ≈ clampedClickPercent）
                  indicatorCenterPercent: +((ta.scrollTop / ta.scrollHeight) * 100 + (ta.clientHeight / ta.scrollHeight) * 50).toFixed(2),
                  offsetsLen: visualLineOffsets.length,
                  // 原始坐标诊断（确认坐标采集正确）
                  clientYRaw: +clientY.toFixed(1),
                  containerRectTop: +containerRect.top.toFixed(1),
                  containerRectLeft: +containerRect.left.toFixed(1),
                  containerClass: container.className,
                })
                // 关键修复：跳转后更新视口前，先重算 minimap 内容布局，
                // 排除 contentHeight 失准（scaleY 未应用或字体未加载）导致 ratio 错误的假设
                requestAnimationFrame(() => {
                  syncMinimapContent(textareaRef.current)
                  updateMinimapViewport(textareaRef.current)
                })
              }

              jumpToPosition(e.clientY)

              // 支持拖动连续跳转
              const handleMouseMove = (moveEvent: MouseEvent) => {
                jumpToPosition(moveEvent.clientY)
              }
              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
              }
              document.addEventListener('mousemove', handleMouseMove)
              document.addEventListener('mouseup', handleMouseUp)
            }}
          >
            {/* 内容容器：直接包含文本内容，font-size/line-height/padding/width 由 JS 按比例设置
                确保软换行位置与 textarea 完全一致（按比例）
                通过 transform: scaleY() 缩放到容器高度（fit 模式） */}
            <div className="editor-minimap-content" ref={minimapContentRef}>
              {text}
            </div>
            {/* 视口指示器：基于 visualLineOffsets 精确定位
                top/height 为百分比，相对于容器高度（= 内容缩放后高度） */}
            <div
              className="editor-minimap-viewport"
              ref={minimapViewportRef}
              style={{
                top: `${minimapViewport.top}%`,
                height: `${minimapViewport.height}%`,
              }}
            />
          </div>
        )}

        {/* MD 预览区：阅读模式下显示渲染后的 HTML
            v1.2.0 P0-A Layer 3：拦截 <a> 链接点击，走 openExternal 系统浏览器
            根因：Electron 默认在当前窗口内导航加载网页，无返回按钮导致卡死 */}
        {editorMode === 'preview' && (
          <div
            ref={previewRef}
            className="editor md-preview"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
            onClick={(e) => {
              // 检测点击目标是否为 <a> 标签或其子元素
              const target = e.target as HTMLElement
              const anchor = target.closest('a')
              if (!anchor) return
              const href = anchor.getAttribute('href')
              if (!href) return
              // 阻止默认导航行为（Electron 默认在窗口内加载）
              e.preventDefault()
              e.stopPropagation()
              // 根据用户设置决定行为
              if (linkClickBehavior === 'ask') {
                // 弹窗询问模式
                const confirmed = window.confirm(
                  `${t('editor.linkOpenConfirm', '是否使用系统浏览器打开此链接？')}\n${href}`
                )
                if (!confirmed) return
              }
              // 调用主进程 openExternal 走系统浏览器
              // 协议白名单由主进程 open-external handler 校验
              window.electronAPI.openExternal(href)
            }}
          />
        )}

        {/* 预览区高亮带：切换到预览模式时短暂显示位置指示 */}
        {editorMode === 'preview' && highlightBandY >= 0 && (
          <div className="md-highlight-band" style={{ top: `${highlightBandY}px` }} />
        )}

        {/* 编辑区行高亮：预览→编辑切换时，高亮目标行（与预览模式高亮效果对齐） */}
        {editorMode === 'code' && editorHighlightY >= 0 && (
          <div className="editor-line-highlight" style={{ top: `${editorHighlightY}px` }} />
        )}
        {/* 状态栏：字数/字符数/行数 */}
        <div className="editor-statusbar">
          <span>{t('editor.words', { count: stats.words })}</span>
          <span>{t('editor.chars', { count: stats.chars })}</span>
          <span>{t('editor.lines', { count: stats.lines })}</span>
        </div>
        {/* Toast 反馈：复制成功等操作提示 */}
        {toastMessage && (
          <div className="editor-toast">{toastMessage}</div>
        )}

        {/* v1.1.0：序号补全 — 隐藏的光标测量 mirror div
            复制 textarea 样式，在光标位置插入 span 测量像素坐标
            永远隐藏（visibility:hidden + position:absolute + pointer-events:none），不影响布局 */}
        {enableSequenceSuggestion && editorMode === 'code' && (
          <div
            ref={cursorMirrorRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '-9999px',
              top: '0',
              visibility: 'hidden',
              pointerEvents: 'none',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              border: '0',
              margin: '0',
              overflow: 'hidden',
            }}
          />
        )}

        {/* v1.1.0：序号补全 — 半透明预览层（VS Code 风格 inline suggestion）
            绝对定位在光标位置，半透明显示建议的下一行序号前缀
            用户继续输入 → 自动接受（插入前缀 + 字符）
            Backspace/Esc/方向键/Enter → 取消 */}
        {seqSuggestion && (
          <div
            className="seq-suggestion-preview"
            style={{
              top: `${seqSuggestion.top}px`,
              left: `${seqSuggestion.left}px`,
            }}
            aria-hidden="true"
          >
            {seqSuggestion.prefix}
          </div>
        )}
      </div>

      {/* 模式切换按钮：笔记标记为 MD 格式 或 内容检测到 Markdown 语法时显示 */}
      {(editorFormat === 'md' || hasMarkdownSyntax) && (
        <button
          className="mode-toggle-btn"
          onClick={onToggleEditorMode}
          title={editorMode === 'code' ? t('editor.switchToPreview') : t('editor.switchToCode')}
        >
          {editorMode === 'code' ? (
            // 代码模式时显示眼睛图标（切换到阅读模式）
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            // 预览模式时显示代码图标（切换回代码模式）
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          )}
        </button>
      )}

      {/* 大纲按钮 + 悬浮面板：放在模式切换按钮上方 */}
      {outlineItems.length > 0 && (
        <>
          <button
            className="outline-toggle-btn"
            onClick={onToggleOutline}
            title={t('editor.outline', '大纲')}
            aria-label={t('editor.outline', '大纲')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="7" y1="12" x2="21" y2="12" />
              <line x1="11" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          {showOutline && (
            <>
              <div className="popover-backdrop" onClick={onCloseOutline} />
              <div className="outline-panel">
                <div className="outline-header">{t('editor.outline', '大纲')}</div>
                <div className="outline-list">
                  {outlineItems.map((item, idx) => (
                    <button
                      key={idx}
                      className="outline-item"
                      style={{ paddingLeft: `${12 + (item.level - 1) * 16}px` }}
                      onClick={() => onJumpToLine(item.line)}
                      title={item.text}
                    >
                      <span className="outline-level-h">{'H'.repeat(item.level)}</span>
                      <span className="outline-text">{item.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}
