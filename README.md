<div align="center">

<img src="icons/icon128.png" width="96" height="96" alt="Subify logo" />

# 🎬 Subify

### ترجمه و دوبله هوشمند زیرنویس یوتیوب به فارسی

[![Version](https://img.shields.io/badge/version-2.5.0-8b7cff?style=flat-square)](#)
[![Manifest](https://img.shields.io/badge/manifest-v3-4cc2ff?style=flat-square)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-25d8a0?style=flat-square)](LICENSE)
[![Chrome](https://img.shields.io/badge/chrome-116%2B-orange?style=flat-square)](#)

**زیرنویس زمان‌بندی‌شده یوتیوب، ویمیو، آپارات و Coursera رو مستقیم، با ترجمه پیش‌دستانه و همگام‌سازی دقیق، به فارسی برگردون یا حتی زنده دوبله کن.**

</div>

---

## ✨ ویژگی‌ها

- 🌐 **ترجمه لحظه‌ای زیرنویس** روی یوتیوب، ویمیو، آپارات و Coursera — مستقیم از کپشن‌های زمان‌بندی‌شدهٔ ویدیو، بدون نیاز به فایل زیرنویس جدا
- ⚡ **ترجمه پیش‌دستانه (Pre-fetch)** با همگام‌سازی دقیق زمانی، برای تجربه‌ای بدون تأخیر
- 🎙️ **دوبله زنده صوتی (Live Translate)** روی Gemini - تنظیم بلندی دوبله، میزان کات صدای اصلی (ducking)، سرعت پخش و انتخاب صدا
- 🔄 **حالت Chunked fallback** برای زمانی که مسیر Live در دسترس نیست
- 🧠 **چند ارائه‌دهنده هوش مصنوعی**: Google Gemini · OpenRouter · OpenAI · یا هر Custom API — با کلید API خودت
- 💾 **خروجی زیرنویس** به فرمت‌های SRT، VTT و TXT، و **خروجی صوت دوبله** با فرمت WAV یا MP3 (فشرده‌تر)
- 🎨 **استایل‌دهی کامل زیرنویس** با پیش‌نمایش زنده، قالب‌های آماده و فونت‌های فارسی (Vazirmatn، Estedad، Lalezar)
- 📚 **یادگیری لغت با سیستم Leitner** — کلمات از دل زیرنویس‌ها استخراج و به‌صورت فلش‌کارت محلی مرور می‌شن
- 📊 **داشبورد آمار مصرف و برآورد هزینه** — با نرخی که خودت وارد می‌کنی
- 🔒 **کاملاً محلی و خصوصی** — کلیدهای API و تنظیمات فقط روی مرورگر خودت ذخیره می‌شن؛ جزئیات در [PRIVACY.md](PRIVACY.md)

---

## 📦 نصب

این افزونه فعلاً به‌صورت Unpacked (بارگذاری دستی) روی Chrome/Chromium نصب می‌شه:

```bash
git clone https://github.com/mobinbiback/Subify.git
```

1. آدرس `chrome://extensions` رو باز کن
2. گزینه **Developer mode** رو از گوشهٔ بالا سمت راست فعال کن
3. روی **Load unpacked** بزن و پوشه کلون‌شده `Subify` رو انتخاب کن
4. آیکون Subify رو کنار نوار آدرس پین کن و از یک ویدیوی یوتیوب شروع کن 🎉

> نیازمند Chrome (یا مرورگر مبتنی بر Chromium) نسخهٔ ۱۱۶ به بالا.

---

## 🚀 شروع سریع

1. روی آیکون افزونه کلیک کن و کلید API یکی از سرویس‌دهنده‌ها (Gemini، OpenRouter یا OpenAI) رو وارد کن
2. حالت دلخواه رو فعال کن: **ترجمه متنی زیرنویس** یا **دوبله زنده صوتی**
3. یک ویدیوی یوتیوب پخش کن - زیرنویس فارسی همگام با گفتار نمایش داده یا شنیده می‌شه
4. در صورت نیاز از تب **استایل** برای شخصی‌سازی ظاهر زیرنویس یا از **خروجی** برای گرفتن فایل SRT/VTT/TXT استفاده کن

---

## 🔐 مجوزهای افزونه

| مجوز | کاربرد |
|---|---|
| `storage` | ذخیره تنظیمات و کلیدهای API به‌صورت محلی |
| `tabCapture` / `offscreen` | ضبط صدای تب برای حالت دوبله زنده |
| `activeTab` / `tabs` | تشخیص و تعامل با تب یوتیوب فعال |
| `downloads` | ذخیره خروجی زیرنویس (SRT/VTT/TXT) |

دسترسی شبکه‌ای افزونه محدود به یوتیوب، ویمیو، آپارات، Coursera و APIهای مدل‌های هوش مصنوعی انتخابی (Gemini، OpenRouter، OpenAI) است. برای هر Custom API دیگه، افزونه پیش از اولین استفاده فقط برای همون یک دامنه اجازهٔ جداگانه می‌گیره (نه کل اینترنت).

---

## 🛠️ ساختار پروژه

```
Subify/
├── manifest.json          # پیکربندی Manifest V3
├── popup.html / popup.js  # رابط اصلی افزونه
├── options.html / options.js  # تنظیمات پیشرفتهٔ دوبله
├── background.js          # Service worker
├── content.css
├── page-bridge.js / page-hook.js   # اتصال به پلیر یوتیوب
├── subtitle-overlay.js    # رندر زیرنویس روی ویدیو
├── live-client.js         # اتصال به Gemini Live
├── offscreen.js / offscreen.html  # پردازش صوتی در پس‌زمینه
├── storyboard.js / storyboard.html
├── learn.js / learn.html  # یادگیری لغت (Leitner)
├── whatsnew.js / whatsnew.html  # صفحهٔ «چه چیزی تغییر کرد» بعد از هر آپدیت
├── vendor/                # lamejs (رمزگذاری MP3)
├── fonts/                 # Vazirmatn، Estedad، Lalezar
└── icons/
```

📄 [CHANGELOG.md](CHANGELOG.md) · [PRIVACY.md](PRIVACY.md)

---

## 🤝 مشارکت

خوشحال می‌شیم مشارکت کنی:

1. ریپو رو Fork کن
2. یک برنچ برای فیچرت بساز (`git checkout -b feature/AmazingFeature`)
3. تغییراتت رو کامیت کن (`git commit -m 'Add some AmazingFeature'`)
4. برنچ رو Push کن (`git push origin feature/AmazingFeature`)
5. یک Pull Request باز کن

---

## 📝 لایسنس

این پروژه تحت لایسنس MIT منتشر شده — فایل [LICENSE](LICENSE) رو ببین.

---

<div align="center">

ساخته‌شده با 💜 برای فارسی‌زبان‌هایی که یوتیوب تماشا می‌کنن

</div>
