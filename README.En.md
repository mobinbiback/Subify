<div align="center">

<img src="icons/icon128.png" width="96" height="96" alt="Subify logo" />

# 🎬 Subify

### AI-powered YouTube subtitle translation and video dubbing

[![🇬🇧 English](https://img.shields.io/badge/🇬🇧_English-8b7cff?style=for-the-badge)](README.En.md)
[![🇮🇷 فارسی](https://img.shields.io/badge/🇮🇷_فارسی-25d8a0?style=for-the-badge)](README.md)

<br>

[![Version](https://img.shields.io/badge/version-2.7.4-8b7cff?style=flat-square)](#)
[![Manifest](https://img.shields.io/badge/manifest-v3-4cc2ff?style=flat-square)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-25d8a0?style=flat-square)](LICENSE)
[![Chrome](https://img.shields.io/badge/chrome-116%2B-orange?style=flat-square)](#)

**Translate synchronized YouTube subtitles into Persian with predictive translation and precise timing synchronization, or even dub videos live with AI-powered voice translation.**

<br>

[🌐 Website](https://sub-ify.site/) · [🟢 Chrome Web Store](https://chromewebstore.google.com/detail/subify-%D8%AA%D8%B1%D8%AC%D9%85%D9%87%D8%8C-%D8%AF%D9%88%D8%A8%D9%84%D9%87-%D9%88%D8%B2%DB%8C%D8%B1/lkddchadfmlncbjhekdjhhddahjafohg) · [🦊 Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/subify-lite/)

</div>

---

## ✨ Features

- 🌐 **Real-time YouTube subtitle translation** directly from the video's synchronized captions, with no separate subtitle file required
- ⚡ **Predictive translation (Pre-fetch)** with precise timing synchronization for a seamless, low-latency experience
- 🎙️ **Live voice dubbing (Live Translate)** powered by Gemini - adjust dubbing volume, original audio ducking, playback speed, and voice selection
- 🔄 **Chunked fallback mode** for when the Live translation route is unavailable
- 🧠 **Multiple AI providers**: Google Gemini · OpenRouter · OpenAI — using your own API key
- 💾 **Subtitle export** in SRT, VTT, and TXT formats
- 🎨 **Full subtitle styling** with live preview, ready-made presets, and Persian fonts (Vazirmatn, Estedad, Lalezar)
- 📚 **Vocabulary learning with the Leitner system** — words are extracted from subtitles and reviewed as local flashcards
- 🔒 **Fully local and private** — API keys and settings are stored only in your browser

---

## 📦 Installation

Subify is officially available for Chrome and Firefox. Install it directly from your browser's extension store.

### 🟢 Chrome

[![Get Subify for Chrome](https://img.shields.io/badge/Get%20Subify%20for-Chrome-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/subify-%D8%AA%D8%B1%D8%AC%D9%85%D9%87%D8%8C-%D8%AF%D9%88%D8%A8%D9%84%D9%87-%D9%88%D8%B2%DB%8C%D8%B1/lkddchadfmlncbjhekdjhhddahjafohg)

### 🦊 Firefox

[![Get Subify for Firefox](https://img.shields.io/badge/Get%20Subify%20for-Firefox-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/subify-lite/)

### 🌐 Website

[![Visit Subify Website](https://img.shields.io/badge/Visit-Subify%20Website-8b7cff?style=for-the-badge)](https://sub-ify.site/)

---

## 🚀 Quick Start

1. Install Subify from your browser's extension store
2. Click the extension icon and enter your API key for one of the supported providers (Gemini, OpenRouter, or OpenAI)
3. Enable your preferred mode: **Subtitle Translation** or **Live Voice Dubbing**
4. Play a YouTube video - Persian subtitles will be displayed or heard in sync with the speech
5. Use the **Style** tab to customize subtitle appearance, or the **Export** tab to save subtitles as SRT/VTT/TXT

---

## 🔐 Privacy & Permissions

Subify is designed with user privacy in mind.

- 🔒 API keys and settings are stored locally in the user's browser
- 🔑 Subify uses the user's own API key for the selected AI provider
- 🌐 Network requests are limited to YouTube and the APIs of the selected AI services
- 💾 Extension settings are stored locally

### Extension Permissions

| Permission | Purpose |
|---|---|
| `storage` | Stores settings and API keys locally |
| `tabCapture` / `offscreen` | Captures tab audio for live dubbing |
| `activeTab` / `tabs` | Detects and interacts with the active YouTube tab |
| `downloads` | Saves subtitle exports (SRT/VTT/TXT) |

The extension's network access is limited to YouTube and the APIs of the selected AI providers (Gemini, OpenAI, OpenRouter).

---

## 🛠️ Project Structure

```text
Subify/
├── manifest.json          # Manifest V3 configuration
├── popup.html / popup.js  # Main extension interface
├── options.html / options.js  # Advanced dubbing settings
├── background.js          # Service worker
├── content.css
├── page-bridge.js / page-hook.js   # YouTube player integration
├── subtitle-overlay.js    # Subtitle rendering on the video
├── live-client.js         # Gemini Live connection
├── offscreen.js / offscreen.html  # Background audio processing
├── storyboard.js / storyboard.html
├── learn.js / learn.html  # Vocabulary learning (Leitner)
├── fonts/                 # Vazirmatn, Estedad, Lalezar
└── icons/


---

🤝 Contributing

We'd love to have your contribution:

1. Fork the repository


2. Create a branch for your feature:



git checkout -b feature/AmazingFeature

3. Commit your changes:



git commit -m "Add some AmazingFeature"

4. Push the branch:



git push origin feature/AmazingFeature

5. Open a Pull Request




---

📝 License

This project is released under the MIT License — see the LICENSE file for details.


---

🔗 Links

🌐 Subify Website

💻 GitHub Repository

🟢 Chrome Web Store

🦊 Firefox Add-ons



---

<div align="center">Built with 💜 for Persian-speaking YouTube viewers

</div>
```
