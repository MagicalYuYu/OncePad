<div align="center">

[English](README.md) | [中文](README_CN.md)

<img src="build/icon.png" width="120" alt="OncePad Logo" />

# OncePad

**A lightweight, instant-access scratchpad — from quick snippets to AI prompts, every piece of scattered text finds its place.**

Press a global shortcut to summon it, type your text, press again — and it's already on your clipboard, ready to paste anywhere.

![Version](https://img.shields.io/badge/version-1.1.1-blue?style=flat-square)
![License](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)
![Languages](https://img.shields.io/badge/i18n-11%20languages-blueviolet?style=flat-square)

</div>

---

## What it does

- ⚡ **Instant toggle** — Summon the editor from anywhere with a global shortcut; dismiss it just as fast
- 📋 **Auto-copy on hide** — Text is copied to clipboard the moment the window hides — no extra steps
- 🗂️ **Workspaces** — Organize notes into separate workspaces for different contexts
- 🏷️ **Tags** — Label notes for easy filtering and discovery
- 🎨 **Color labels** — Visually categorize notes with 6 distinct colors
- 📌 **Pin to top** — Keep important notes always accessible
- 📝 **Markdown support** — Full Markdown rendering with live preview toggle
- 📖 **Code / Reading mode** — Switch between editing and reading views
- 🔢 **Line numbers** — Optional, with logical or visual numbering modes
- 📑 **Outline** — Quick navigation via document headings
- 🗺️ **Minimap** — Document overview for fast scrolling (experimental)
- 🔢 **Sequence suggestion** — VS Code-style inline autocomplete for numbered lists (1. / a. / ① / 一、 / -)
- 📂 **File menu** — Open / save / save as files directly; drag-and-drop text files (.md / .txt / .log / code files)
- 📄 **Broad format support** — Opens any plain-text file, even with uncommon extensions (content-aware detection)
- 👁️ **MD preview by default** — Markdown files open in reading mode; other formats open in edit mode
- 💾 **Save feedback** — Visual toast confirmation on successful save (Ctrl+S)
- 🚪 **Reliable close** — Force-close mechanism prevents freeze when closing Markdown files
- ⚡ **Fast file opening** — Reuses existing window when double-clicking files in Explorer (no new process overhead)
- 📋 **Error logging** — Crash and freeze logs stored at a fixed path, accessible from Settings → Management → Advanced
- 🔗 **Broad file associations** — Registers as default editor for 40+ file types (.md / .txt / .js / .py / .json / .csv / .sh / .html / .css / ...)
- ℹ️ **About dialog** — View app version and system info, with quick link to GitHub repository
- 🌐 **11 languages** — 简体中文 / 繁體中文 / English / 日本語 / 한국어 / Deutsch / Français / Español / Português (Brasil) / Русский / Italiano
- 🎛️ **Navbar customization** — Show/hide titlebar buttons (pin, color, new, copy, notes)
- 🔤 **Font customization** — Separate English/Chinese fonts, adjustable size, line height, and padding
- 🔍 **UI scaling** — Adjust the entire interface from 80% to 150%
- 🌙 **Dark / Light theme** — Toggle between dark and light modes
- 📌 **Always on top** — Keep the window above other applications
- 🚀 **Auto-launch** — Start with the system, optionally hidden to tray
- 👻 **Blur to hide** — Automatically hide when the window loses focus
- 🗑️ **Trash with auto-cleanup** — Deleted notes go to trash with configurable retention (1/2/3/7 days)
- 📜 **History** — Past entries saved automatically when you start a new draft
- ⌨️ **Configurable shortcuts** — Customize toggle, new note, and copy shortcuts

<details>
<summary><strong>Complete feature list</strong></summary>

| Category | Feature | Description |
|:---------|:--------|:------------|
| Core | Instant toggle | Global shortcut brings up the editor from any app |
| Core | Auto-copy on hide | Text copied to clipboard when window dismisses |
| Core | History | Past entries saved automatically (up to 100) |
| Core | File menu | Open / save / save as / close files from titlebar menu |
| Core | About dialog | App version + system info + GitHub link |
| Notes | Workspaces | Organize notes into separate workspaces |
| Notes | Tags | Label notes for filtering and discovery |
| Notes | Color labels | 6 colors (default/red/orange/yellow/green/blue/purple) |
| Notes | Pin to top | Keep important notes accessible |
| Notes | Drafts | Auto-saved drafts with configurable cleanup |
| Notes | Trash | Deleted notes with auto-cleanup (1/2/3/7 days) |
| Editor | Markdown | Full Markdown rendering with live preview |
| Editor | Code/Reading mode | Switch between editing and reading views |
| Editor | MD preview by default | MD files open in reading mode, others in edit mode |
| Editor | Line numbers | Logical or visual numbering mode |
| Editor | Outline | Quick navigation via document headings |
| Editor | Minimap | Document overview (experimental) |
| Editor | Sequence suggestion | VS Code-style inline autocomplete for numbered lists |
| Editor | Font customization | Separate EN/CN fonts, size, line height, padding |
| Editor | UI scaling | 80%-150% interface scaling |
| Files | Open via dialog | System file dialog with broad format filters |
| Files | Drag-and-drop | Drag .md / .txt / .log / code files into editor |
| Files | Content-aware detection | Opens any plain-text file regardless of extension |
| Files | Save / Save as | Save to original path or save as new file |
| i18n | 11 languages | zh-CN/zh-TW/en/ja/ko/de/fr/es/pt-BR/ru/it |
| UI | Navbar customization | Show/hide 6 titlebar buttons (settings locked) |
| UI | Dark/Light theme | Toggle between dark and light modes |
| Window | Always on top | Keep window above other applications |
| Window | Auto-launch | Start with system, optionally hidden |
| Window | Blur to hide | Auto-hide when window loses focus |
| Window | Close behavior | Hide to tray / confirm / quit |
| Shortcuts | Toggle window | Global shortcut (default: Alt+Q) |
| Shortcuts | New note | Global shortcut (customizable, default: empty) |
| Shortcuts | Copy | Global shortcut (customizable, default: empty) |

</details>

## Install

### Pre-built binaries

Download the latest release from the [Releases](../../releases) page.

- **Windows (Installer, recommended)**: Download `OncePad-Setup-x.x.x.exe`, run the installer, and OncePad will be permanently installed to `AppData\Local\Programs\OncePad\`. The installer registers file associations for 40+ file types, so double-clicking `.md` / `.txt` / `.js` / `.py` / `.json` / etc. in Explorer will open them in OncePad instantly. The installed version also appears in "Open with" right-click menus.
- **Windows (Portable)**: Download `OncePad x.x.x.exe` and run directly — no installation required. Note: the portable version is a 7z self-extracting executable (~200 MB); each launch extracts to a temp folder, which may cause a delay of several seconds when double-clicking files in Explorer. For daily use, the installer version is strongly recommended.
- **macOS**: Download the `.dmg` (note: unsigned, run `xattr -cr "/Applications/OncePad.app"` if blocked)
- **Linux**: Download the `.AppImage`, make executable, and run

### From source

```bash
git clone https://github.com/MagicalYuYu/OncePad.git
cd OncePad
npm install
npm run dev
```

## How it works

1. Press `Alt+Q` (default) to summon the editor from any application
2. Type your text — it auto-saves as a draft
3. Press the shortcut again — the window disappears and your text is copied to clipboard
4. Paste wherever you need it

That's it. No save dialog, no file management, no friction.

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Package for current platform
npm run dist

# Package for Windows only
npm run build:win
```

## Tech Stack

- **Electron** — Cross-platform desktop framework
- **React** — UI library
- **TypeScript** — Type-safe JavaScript
- **Vite** — Build tool and dev server
- **i18next** — Internationalization framework (11 languages)
- **markdown-it** — Markdown parser

## Acknowledgements

OncePad is a derivative work inspired by One-Time Editor, deeply refactored and significantly extended with 12 independent feature modules. Distributed under the GNU General Public License v3.0.

---

<div align="center">

## Built with AOS

This project was collaboratively developed using **[AOS — Agent Operating System](https://github.com/MagicalYuYu/agent-operating-system)**.

AOS is an operating system for AI agents — providing a kernel, file system, desktop, and persistent memory so that AI assistants can work with structure, traceability, and continuity across sessions. OncePad was built under the AOS framework, with AI handling code generation and iterative implementation while the author directed core design decisions and code review.

[Learn more about AOS](https://github.com/MagicalYuYu/agent-operating-system)

</div>

## License

[GPL-3.0](LICENSE)