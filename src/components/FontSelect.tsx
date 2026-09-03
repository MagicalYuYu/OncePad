import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeFontName } from '../lib/format'

interface FontSelectProps {
  /** 当前保存的字体名（直接以文本显示，不依赖列表匹配） */
  value: string
  /** 系统字体列表（已规范化） */
  fonts: string[]
  /** 选中列表项后的提交回调 */
  onChange: (font: string) => void
  /** 选项预览文字的回退字体 */
  previewFallback?: string
  /** 过滤无结果时的提示文案（由调用方传入 i18n 翻译） */
  noMatchText?: string
}

/**
 * v1.3.2：可输入搜索的字体选择器（Word 风格），替代原有下拉 select
 *
 * 交互规则（2026-09-03 两轮实测反馈后定型，对齐 Word 行为）：
 * - 输入框文本（query）与过滤词（filter）分离：聚焦时输入框显示并全选当前字体名，
 *   但过滤词为空 → 下拉展示**完整字体列表**并自动滚动定位到当前字体（✓ 标记），
 *   用户一眼可见全部可选字体，直接打字即搜索（全选态下输入自动替换）
 * - 输入仅用于过滤，**只有明确点击列表项或按 Enter 才会更改字体**：
 *   鼠标轻触/聚焦/点击组件外部一律不提交，杜绝误触与乱输入保存
 * - 只允许选择系统字体列表中真实存在的字体（输入"ABC"无法保存，显示无匹配提示）
 * - 键盘：↑↓ 移动高亮，Enter 确认，Esc 关闭恢复
 * - 若保存值不在系统字体列表中（如字体已卸载），下拉置顶补充显示该值，
 *   用户始终可见真实配置，杜绝原生 select"显示第一项"的假象
 */
export function FontSelect({ value, fonts, onChange, previewFallback = 'sans-serif', noMatchText }: FontSelectProps) {
  const [open, setOpen] = useState(false)
  // 输入框显示文本：关闭时与 value 同步；聚焦时=当前字体名（全选），打字后=用户输入
  const [query, setQuery] = useState(value)
  // 实际过滤词：聚焦时置空（显示完整列表），仅在用户打字后生效（Word 行为）
  const [filter, setFilter] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // value 外部变化（如重启加载配置）时同步输入框显示
  useEffect(() => {
    if (!open) setQuery(value)
  }, [value, open])

  // 过滤：空过滤词显示前 200 项；非空做子串匹配（不区分大小写）
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return fonts.slice(0, 200)
    return fonts.filter((f) => f.toLowerCase().includes(q)).slice(0, 200)
  }, [fonts, filter])

  // 保存值不在系统列表时置顶补一项（显示假象防御）
  const options = useMemo(() => {
    if (value && !fonts.includes(value)) {
      return [value, ...filtered]
    }
    return filtered
  }, [value, fonts, filtered])

  // 高亮定位：无过滤词时定位到当前字体（完整列表场景，一眼可见当前位置）；
  // 有过滤词时复位到第一项（搜索场景）
  useEffect(() => {
    if (!open) return
    if (filter === '' && options.includes(value)) {
      setActiveIndex(options.indexOf(value))
    } else {
      setActiveIndex(0)
    }
  }, [filter, open, options, value])

  // 高亮项滚动跟随
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  // 点击组件外部：关闭并恢复显示（不提交任何输入——只承认明确的选择动作）
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(value)
        setFilter('')
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  })

  // 选中列表项（唯一提交路径；置顶补充项 = 当前值，选中等于不变）
  const select = (font: string) => {
    const f = normalizeFontName(font)
    if (f && f !== value) {
      onChange(f)
    }
    setOpen(false)
    setQuery(f || value)
    setFilter('')
    inputRef.current?.blur()
  }

  const closeAndRestore = () => {
    setOpen(false)
    setQuery(value)
    setFilter('')
    inputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setActiveIndex((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // 仅当高亮项存在时提交（完整列表场景=当前字体附近项；搜索场景=过滤结果首项）
      if (open && options.length > 0 && activeIndex < options.length) {
        select(options[activeIndex])
      } else {
        closeAndRestore()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeAndRestore()
    }
  }

  return (
    <div className="font-select" ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        className="font-select-input"
        value={query}
        placeholder={value}
        // 打字时同步输入文本与过滤词（全选态下输入自动替换当前字体名）
        onChange={(e) => { const v = e.target.value; setQuery(v); setFilter(v); setOpen(true) }}
        // 聚焦：输入框=当前字体名并全选；过滤词置空 → 完整列表 + 自动定位当前字体（Word 行为）
        onFocus={(e) => { setOpen(true); setQuery(value); setFilter(''); e.target.select() }}
        onKeyDown={handleKeyDown}
        onBlur={() => { setQuery(value); setFilter(''); setOpen(false) }}
        spellCheck={false}
      />
      {open && options.length > 0 && (
        <div className="font-select-dropdown" ref={listRef}>
          {options.map((font, i) => (
            <div
              key={font}
              className={`font-select-option${i === activeIndex ? ' font-select-active' : ''}${font === value ? ' font-select-current' : ''}`}
              // 阻止 mousedown 抢走输入框焦点导致下拉提前消失，真正选择动作放在 onClick
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => select(font)}
              style={{ fontFamily: `"${normalizeFontName(font)}", ${previewFallback}` }}
            >
              {font}
            </div>
          ))}
        </div>
      )}
      {open && options.length === 0 && (
        <div className="font-select-dropdown">
          <div className="font-select-empty">{noMatchText || '—'}</div>
        </div>
      )}
    </div>
  )
}
