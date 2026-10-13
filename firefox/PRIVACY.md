# حریم خصوصی Subify

این افزونه سرور پردازش ترجمه یا صدا ندارد و متن و صدای لازم را فقط به سرویس انتخابی تو می‌فرستد. دو دسته داده‌ی دیگر هم به سرورهای Subify می‌رود: کش ترجمهٔ زیرنویس (برای همه) و داده‌های حساب (فقط وقتی واردی). هر دو در بخش «چه چیزی به بیرون ارسال می‌شود» آمده‌اند. بقیهٔ درخواست‌ها بررسی ورود و جستجوی معنی لغت‌های انگلیسی‌اند. هرچه ذخیره یا ارسال می‌شود، دقیقاً یکی از موارد زیر است:

## چه چیزی، کجا ذخیره می‌شود

| داده | محل ذخیره | خروج از دستگاه؟ |
|---|---|---|
| کلیدهای API (Gemini/OpenRouter/OpenAI/Custom) | `browser.storage.local` (پروفایل خود مرورگر) | فقط در هدر/کوئری درخواستی که مستقیماً به همان سرویس می‌رود |
| تنظیمات ظاهر زیرنویس، مدل انتخابی، نرخ‌های هزینه | `browser.storage.local` | خیر |
| آمار مصرف (کاراکتر ترجمه‌شده، ثانیهٔ دوبله، تعداد export) | `browser.storage.local` (`pd_stats`) | خیر |
| گزارش رویداد (`pd_log`) و صف زیرنویس لحظه‌ای (`pd_cues`) | `browser.storage.session` (فقط تا بسته‌شدن مرورگر) | خیر |
| دیکشنری واژه‌ها، اسکرین‌شات‌ها، استوری‌بوردها | IndexedDB با نام `subify-local`، در origin خود افزونه (`chrome-extension://…`) | خیر |
| حافظهٔ ترجمهٔ هر ویدیو (برای اینکه دوباره هزینه‌ی API پرداخت نکنی) | IndexedDB با همین نام، ولی در origin همان سایت ویدیو (یوتیوب/ویمیو/آپارات)، این یک پایگاه‌دادهٔ جدا از مورد بالاست، چون content scriptها به IndexedDB خودِ صفحه دسترسی دارند نه به origin افزونه | خیر |

## چه چیزی به بیرون ارسال می‌شود

- متن زیرنویس (برای ترجمه) و/یا صدای تب (برای دوبله) فقط به همان سرویسی که خودت در تنظیمات انتخاب و کلیدش را وارد کرده‌ای (Gemini، OpenRouter، OpenAI، یا یک Custom API دلخواه) ارسال می‌شود.
- برای Custom API، افزونه پیش از اولین استفاده فقط برای همان یک دامنه که خودت وارد می‌کنی درخواست اجازهٔ دسترسی می‌کند (نه کل اینترنت).
- وقتی معنی یک لغت انگلیسی را می‌خواهی، همان لغت (فقط خود کلمه، بدون متن زیرنویس) به `api.dictionaryapi.dev` فرستاده می‌شود. این سرویس برای جستجوی معنی لغت است و کلید یا داده دیگری دریافت نمی‌کند.
- کش ترجمهٔ زیرنویس (برای همه، حتی بدون ورود): بعد از هر دستهٔ ترجمهٔ زیرنویس، این داده‌ها به `https://sub-ify.site/subify-api/cache` فرستاده می‌شود: شناسهٔ ویدیو، شناسهٔ آهنگ زیرنویس، زبان مقصد، زمان شروع و پایان هر خط، متن اصلی خط و ترجمه‌اش. این کش می‌تواند برای همان ویدیو دوباره خوانده شود تا هزینهٔ API تکرار نشود. کلید API و صدا در این درخواست‌ها نیست و درخواست‌ها بدون کوکی ورود فرستاده می‌شوند.
- داده‌های حساب (فقط وقتی واردی): نام و ایمیلی که سرور برمی‌گرداند، کارت‌های لغت همراه با داده‌های مرورشان برای همگام‌سازی با `sub-ify.site/auth/vocab.php`، و متن تیکت‌های پشتیبانی که می‌فرستی به `sub-ify.site/auth/tickets.php`.
- هیچ Analytics، تله‌متری یا سرویس ردیابی شخص‌ثالثی در کد افزونه وجود ندارد.

## پاک‌کردن داده‌ها

دکمهٔ «پاک‌کردن کامل داده‌ها» در صفحهٔ تنظیمات پیشرفته (Options) موارد زیر را حذف می‌کند:
- تمام کلیدها و تنظیمات (`pd_settings`, `pd_models`, `pd_stats`, و کلیدهای `subify_*`)
- `browser.storage.session`
- پایگاه‌دادهٔ IndexedDB افزونه (دیکشنری، اسکرین‌شات، استوری‌بورد)
- حافظهٔ ترجمهٔ صفحاتی که همین الان بازند (یوتیوب/ویمیو/آپارات)؛ برای تب‌هایی که الان باز نیستند، پاک‌سازی در اولین بازدید بعدی همان تب انجام می‌شود.

این کار قابل بازگشت نیست.

## مجوزهای مرورگر

افزونه برنامه‌ی زیرنویس و دوبله را فقط روی این سایت‌ها اجرا می‌کند: YouTube (شامل m.youtube.com و youtube-nocookie.com)، Vimeo، Aparat، Coursera، X، Instagram، Facebook، TikTok، Threads، Udemy، LinkedIn، edX، H5P، TED و Khan Academy.

دسترسی‌های دیگر فقط برای کار خود افزونه‌اند: دامنه‌های Gemini، OpenRouter، OpenAI، sub-ify.site (برای ورود، کش ترجمه و همگام‌سازی حساب) و api.dictionaryapi.dev (برای معنی لغت). دسترسی به Custom API فقط برای دامنه‌ای است که خودت وارد می‌کنی و مرورگر برای آن جداگانه اجازه می‌خواهد.

یک نکته‌ی شفاف: manifest نسخه‌ی فعلی دسترسی `<all_urls>` را هم دارد، یعنی مرورگر از نظر فنی اجازه‌ی دسترسی به همه‌ی سایت‌ها را به افزونه می‌دهد. با این حال، متن زیرنویس یا صدا را جز به Provider انتخابی‌ات و کش ترجمهٔ Subify (که در بالا توضیح داده شد) به جای دیگری نمی‌فرستد.

## کتابخانه‌های شخص‌ثالث همراه افزونه

- `vendor/lame.min.js` (کدگذاری MP3، پروژهٔ LAME، مجوز LGPL)، فقط برای ساختن فایل خروجی MP3 در همان دستگاه کاربر اجرا می‌شود، هیچ داده‌ای جایی ارسال نمی‌کند. متن مجوز: `vendor/lamejs-LICENSE.txt`.
- فونت Lalezar (`fonts/Lalezar-Regular.ttf`, مجوز OFL)، فقط برای نمایش زیرنویس.


## Account (only when login is required)
The extension contacts `https://sub-ify.site/auth/me.php` (and `/auth/logout.php` when you sign out) to check whether you are signed in. The session cookie is HttpOnly on sub-ify.site; the extension does not read or store it. Only the account name and e-mail returned by the server are shown in the popup.

When you are signed in, the extension also syncs your vocabulary cards with `/auth/vocab.php` and sends or reads your support tickets with `/auth/tickets.php`. Both requests are sent with your sign-in cookie. The translation cache at `/subify-api/cache` (described in the Persian section above) is sent without the cookie. The button "Delete all data" does not delete data already stored on sub-ify.site.

## Recent videos and saved words in AI practice
The extension keeps the titles of your last 8 videos on this device (`subify_video_history`). When you start a practice or writing task, the titles of recent videos and up to 8 saved words for your target language are included in the AI request so the task can refer to them. Nothing else is sent for these tasks. You can clear the history from the options page.
