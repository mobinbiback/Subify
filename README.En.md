<div align="center">

<img src="assets/img/subify-logo-dark.png" width="180" alt="Subify logo" />

# 🎬 Subify

### **Watch. Understand. Learn. 🌍**

**AI-powered subtitle translation, bilingual captions & live dubbing for YouTube.**

Turn foreign-language videos into something you can actually understand with real-time translation, synchronized bilingual subtitles, subtitle export, and AI-powered voice dubbing.

[![🇬🇧 English](https://img.shields.io/badge/🇬🇧_English-8b7cff?style=for-the-badge)](README.En.md)
[![🇮🇷 فارسی](https://img.shields.io/badge/🇮🇷_فارسی-25d8a0?style=for-the-badge)](README.md)

<br>

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4cc2ff?style=flat-square)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-25d8a0?style=flat-square)](LICENSE)

<br>

[🌐 Website](https://sub-ify.site/) · [🟢 Chrome Web Store](https://chromewebstore.google.com/detail/subify-%D8%AA%D8%B1%D8%AC%D9%85%D9%87%D8%8C-%D8%AF%D9%88%D8%A8%D9%84%D9%87-%D9%88%D8%B2%DB%8C%D8%B1/lkddchadfmlncbjhekdjhhddahjafohg) · [🦊 Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/subify-lite/)

</div>

---

## 🌍 What is Subify?

**Subify is a free, open-source browser extension for understanding foreign-language YouTube videos.**

Translate captions in real time, display bilingual subtitles, customize their appearance, export them as subtitle files, and use AI-powered live voice dubbing when you would rather listen than read.

Subify is built for language learners, students, course viewers, podcast listeners, and anyone who regularly watches content in a language they do not fully understand.

---

## 🎥 See it in action

> **A good demo should show the product, not explain it.**
>
> Add a short GIF or screen recording here showing:
> 1. A YouTube video playing in another language
> 2. Subify translating the subtitles
> 3. Bilingual captions appearing in sync
> 4. Live dubbing being enabled

---

## ✨ Features

### 🌐 Real-time subtitle translation
Translate synchronized YouTube captions directly from the video without downloading a separate subtitle file.

### ⚡ Predictive translation
Pre-fetch upcoming subtitle segments so translated captions are ready when the speaker reaches them, with timing synchronization designed to keep the translation aligned with playback.

### 🔤 Bilingual subtitles
Keep the original caption and its translation together so you can follow the meaning while still seeing the source language.

### 🎙️ Live AI voice dubbing
Use Gemini-powered live translation to hear translated speech while the video is playing, with controls for:
- Dubbing volume
- Original-audio ducking
- Playback speed
- Voice selection

### 🔄 Chunked fallback
Use a chunked translation path when the live route is unavailable.

### 🧠 Multiple AI providers
Use your own API key with supported providers:
- Google Gemini
- OpenRouter
- OpenAI

### 💾 Subtitle export
Export translated subtitles as:
- SRT
- VTT
- TXT

### 🎨 Subtitle customization
Customize the subtitle experience with live preview, presets, and bundled Persian fonts including Vazirmatn, Estedad, and Lalezar.

### 📚 Vocabulary learning
Extract vocabulary from subtitles and review words locally with a Leitner-style flashcard workflow.

### 🔒 Local-first privacy
API keys and extension settings are stored locally in the browser. Requests are made to YouTube and the AI provider APIs configured by the user.

---

## 🎯 Why Subify?

Foreign-language content is everywhere.

The problem is not finding something worth watching.  
The problem is understanding it.

Subify puts translation and dubbing directly where the content already lives, so you can keep watching instead of constantly switching between players, subtitle files, and translation tools.

**Watch more. Understand more. Learn as you go.**

---

## 📦 Installation

Subify is currently available for **Chrome** and **Firefox**.

### 🟢 Chrome

[![Get Subify for Chrome](https://img.shields.io/badge/Get%20Subify%20for-Chrome-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/subify-%D8%AA%D8%B1%D8%AC%D9%85%D9%87%D8%8C-%D8%AF%D9%88%D8%A8%D9%84%D9%87-%D9%88%D8%B2%DB%8C%D8%B1/lkddchadfmlncbjhekdjhhddahjafohg)

### 🦊 Firefox

[![Get Subify for Firefox](https://img.shields.io/badge/Get%20Subify%20for-Firefox-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/subify-lite/)

### 🌐 Website

[![Visit Subify Website](https://img.shields.io/badge/Visit-Subify%20Website-8b7cff?style=for-the-badge)](https://sub-ify.site/)

---

## 🚀 Quick Start

1. Install Subify from the Chrome Web Store or Firefox Add-ons.
2. Open the extension settings.
3. Add your API key for Gemini, OpenRouter, or OpenAI.
4. Open a YouTube video with captions.
5. Enable **Subtitle Translation** or **Live Voice Dubbing**.
6. Customize subtitle appearance or export the result as SRT, VTT, or TXT.

---

## 🧠 AI Providers

Subify follows a provider-based architecture so users can choose the AI service that fits their needs.

| Provider | Use |
|---|---|
| Google Gemini | Translation and live voice translation |
| OpenRouter | Text translation through supported models |
| OpenAI | Text translation through the OpenAI API |

> **Bring your own API key:** Subify is designed around user-provided API credentials rather than a centralized API key stored by the extension.

---

## 🔐 Privacy & Permissions

Subify follows a **local-first** approach.

- API keys and extension settings are stored locally in the user's browser.
- AI requests use the API key configured by the user.
- Network access is limited to YouTube and the configured AI provider APIs required by the extension.
- Vocabulary and extension settings are designed around local browser storage.

### Extension permissions

| Permission | Purpose |
|---|---|
| `storage` | Store extension settings and API keys locally |
| `tabCapture` / `offscreen` | Capture tab audio for live dubbing |
| `activeTab` / `tabs` | Detect and interact with the active YouTube tab |
| `downloads` | Save subtitle exports |

---

## 🏗️ How it works

```text
                 ┌─────────────────────┐
                 │   YouTube video     │
                 │  + synchronized     │
                 │      captions       │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │   Subtitle engine   │
                 │   timing + chunks   │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │   AI translation    │
                 │ Gemini / OpenRouter │
                 │       / OpenAI      │
                 └───────┬─────┬───────┘
                         │     │
                ┌────────┘     └────────┐
                ▼                       ▼
        ┌───────────────┐       ┌────────────────┐
        │ Bilingual /   │       │  Live voice    │
        │ translated    │       │    dubbing     │
        │ subtitles     │       │                │
        └───────┬───────┘       └───────┬────────┘
                │                       │
                └───────────┬───────────┘
                            ▼
                     ┌─────────────┐
                     │    YouTube  │
                     │    player   │
                     └─────────────┘
```

---

## 🛠️ Project Structure

```text
Subify/
├── manifest.json
├── popup.html / popup.js
├── options.html / options.js
├── background.js
├── content.css
├── page-bridge.js / page-hook.js
├── subtitle-overlay.js
├── live-client.js
├── capture-worklet.js
├── offscreen.js / offscreen.html
├── storyboard.js / storyboard.html
├── learn.js / learn.html
├── fonts/
└── icons/
```

### Core pieces

| File | Role |
|---|---|
| `subtitle-overlay.js` | Subtitle rendering and synchronization |
| `live-client.js` | Live Gemini connection |
| `background.js` | Extension service worker |
| `offscreen.js` | Audio processing for live dubbing |
| `learn.js` | Vocabulary learning workflow |
| `storyboard.js` | Subtitle/storyboard-related UI |

---

## 🤝 Contributing

Subify is open source and contributions are welcome.

```bash
git clone https://github.com/mobinbiback/Subify.git
cd Subify
```

Then load the project as an unpacked extension in a Chromium-based browser, or use the appropriate extension-development workflow for Firefox.

For feature requests, bug reports, and improvements, open an issue or submit a pull request.

### Development workflow

```bash
git checkout -b feature/your-feature
git add .
git commit -m "Add your feature"
git push origin feature/your-feature
```

Then open a Pull Request on GitHub.

---

## 🗺️ Roadmap

Subify is actively evolving.

Planned and ongoing work includes:

- More supported video and learning platforms
- Better subtitle translation quality and latency
- More AI providers and model options
- Improved live dubbing
- More subtitle export and customization options
- Better language-learning workflows
- A broader web experience beyond the current extension workflow

Have an idea? Open an issue and describe the problem you want to solve.

---

## ⭐ Support the project

Subify is free and open source.

If it helps you understand videos, learn a language, or access content you could not easily follow before, **consider giving the repository a Star**.

Every Star helps other people discover the project.

---

## 📝 License

Subify is released under the [MIT License](LICENSE).

---

## 🔗 Links

[🌐 Subify Website](https://sub-ify.site/)

[💻 GitHub Repository](https://github.com/mobinbiback/Subify)

[🟢 Chrome Web Store](https://chromewebstore.google.com/detail/subify-%D8%AA%D8%B1%D8%AC%D9%85%D9%87%D8%8C-%D8%AF%D9%88%D8%A8%D9%84%D9%87-%D9%88%D8%B2%DB%8C%D8%B1/lkddchadfmlncbjhekdjhhddahjafohg)

[🦊 Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/subify-lite/)

---

<div align="center">

**Built with 💜 for everyone who wants to understand more of the internet.**

</div>
