# SnapCompass

**Capture anything. Annotate everything.**

SnapCompass 是一个免费、开源的截图与录屏工具集 —— 融合了 FireShot 的整页截图 / PDF 导出能力与 Awesome Screenshot 的标注编辑、屏幕录制体验。一次安装，同时获得 **Chrome 浏览器插件** 与 **Windows 桌面应用**。

SnapCompass is a free, open-source screenshot & screen-recording toolkit — combining FireShot-grade full-page capture and PDF export with Awesome Screenshot-grade annotation and recording. Ships as a **Chrome extension** and a **Windows desktop app**.

## Features 功能

| | |
|---|---|
| 🖼️ **Full-page capture** 整页截图 | Scroll-stitched, sticky-header aware 滚动拼接，自动处理吸顶元素 |
| ✂️ **Region & visible capture** 区域/可视区截图 | Drag-select or one keystroke 框选或快捷键一键截取 |
| ✏️ **Annotation studio** 标注编辑器 | Pen, arrows, shapes, text, mosaic blur, crop 画笔/箭头/矩形/文字/马赛克/裁剪 |
| 🎥 **Screen recording** 屏幕录制 | Tab / window / desktop → **GIF or MP4** |
| 📄 **Export** 导出 | PNG · JPG · PDF · GIF · MP4, plus clipboard copy 一键复制到剪贴板 |
| 🔒 **Local-first** 本地优先 | No account, no upload, no watermark 无需账号、不上传、无水印 |

## Repository layout 目录结构

```
SnapCompass/
├── extension/     # Chrome (MV3) extension 浏览器插件
├── desktop/       # Electron Windows app 桌面版 (.exe)
└── docs/          # Landing page (GitHub Pages) 官网落地页
```

## Chrome extension 插件安装

1. Clone this repo / 克隆本仓库
2. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/`
3. 打开 `chrome://extensions`，开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `extension/` 目录

**Shortcuts 快捷键**: `Alt+Shift+S` visible 可视区 · `Alt+Shift+F` full page 整页 · `Alt+Shift+R` region 区域

## Desktop app 桌面版

```bash
cd desktop
npm install
npm start        # run the app 运行
npm run dist     # build the .exe installer 打包 exe
```

Global hotkey 全局快捷键: `Ctrl+Shift+X` 框选截图

## Tech 技术

- Extension: Manifest V3, offscreen document recording (MediaRecorder), gif.js, jsPDF
- Desktop: Electron + electron-builder
- Landing page: vanilla HTML/CSS/JS, deployed via GitHub Pages

## License

MIT
