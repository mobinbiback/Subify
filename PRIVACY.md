# حریم خصوصی Subify

این افزونه سرور پردازش ترجمه یا صدا ندارد و متن و صدای لازم را فقط به سرویس انتخابی تو می‌فرستد. دو دسته داده‌ی دیگر هم به سرورهای Subify می‌رود: کش ترجمهٔ زیرنویس (برای همه) و داده‌های حساب (فقط وقتی واردی). هر دو در بخش «چه چیزی به بیرون ارسال می‌شود» آمده‌اند. هرچه ذخیره یا ارسال می‌شود، دقیقاً یکی از موارد زیر است:

## چه چیزی، کجا ذخیره می‌شود

| داده | محل ذخیره | خروج از دستگاه؟ |
|---|---|---|
| کلیدهای API (Gemini/OpenRouter/OpenAI/Custom) | `browser.storage.local` (پروفایل خود مرورگر) | فقط در هدر/کوئری درخواستی که مستقیماً به همان سرویس می‌رود |
| تنظیمات ظاهر زیرنویس، مدل انتخابی، نرخ‌های هزینه | `browser.storage.local` | خیر |
| آمار مصرف (کاراکتر ترجمه‌شده، ثانیهٔ دوبله، تعداد export) | `browser.storage.local` (`pd_stats`) | فقط عددهای جمع‌شدهٔ روزانه، طبق بخش «آمار ناشناس روزانه» |
| گزارش رویداد (`pd_log`) و صف زیرنویس لحظه‌ای (`pd_cues`) | `browser.storage.session` (فقط تا بسته‌شدن مرورگر) | خیر |
| دیکشنری واژه‌ها، اسکرین‌شات‌ها، استوری‌بوردها | IndexedDB با نام `subify-local`، در origin خود افزونه (`chrome-extension://…`) | خیر |
| حافظهٔ ترجمهٔ هر ویدیو (برای اینکه دوباره هزینه‌ی API پرداخت نکنی) | IndexedDB با همین نام، ولی در origin همان سایت ویدیو (یوتیوب/ویمیو/آپارات)، این یک پایگاه‌دادهٔ جدا از مورد بالاست، چون content scriptها به IndexedDB خودِ صفحه دسترسی دارند نه به origin افزونه | خیر |

## چه چیزی به بیرون ارسال می‌شود

- متن زیرنویس (برای ترجمه) و/یا صدای تب (برای دوبله) فقط به همان سرویسی که خودت در تنظیمات انتخاب و کلیدش را وارد کرده‌ای (Gemini، OpenRouter، OpenAI، یا یک Custom API دلخواه) ارسال می‌شود.
- برای Custom API، افزونه پیش از اولین استفاده فقط برای همان یک دامنه که خودت وارد می‌کنی درخواست اجازهٔ دسترسی می‌کند (نه کل اینترنت).
- وقتی معنی یک لغت انگلیسی را می‌خواهی، همان لغت (فقط خود کلمه، بدون متن زیرنویس) به `api.dictionaryapi.dev` فرستاده می‌شود. این سرویس برای جستجوی معنی لغت است و کلید یا داده دیگری دریافت نمی‌کند.
- کش ترجمهٔ زیرنویس (برای همه، حتی بدون ورود): بعد از هر دستهٔ ترجمهٔ زیرنویس، این داده‌ها به `https://sub-ify.site/subify-api/cache` فرستاده می‌شود: شناسهٔ ویدیو، شناسهٔ آهنگ زیرنویس، زبان مقصد، زمان شروع و پایان هر خط، متن اصلی خط و ترجمه‌اش. این کش می‌تواند برای همان ویدیو دوباره خوانده شود تا هزینهٔ API تکرار نشود. کلید API و صدا در این درخواست‌ها نیست و درخواست‌ها بدون کوکی ورود فرستاده می‌شوند.
- داده‌های حساب (فقط وقتی واردی): نام و ایمیلی که سرور برمی‌گرداند، کارت‌های لغت همراه با داده‌های مرورشان برای همگام‌سازی با `sub-ify.site/auth/vocab.php`، و متن تیکت‌های پشتیبانی که می‌فرستی به `sub-ify.site/auth/tickets.php`.
- هیچ Analytics یا سرویس ردیابی شخص‌ثالثی در کد وجود ندارد. تنها ارسال دیگر، آمار ناشناس روزانه به سرور خود Subify است (بخش بعدی).

## آمار ناشناس روزانه

برای اینکه بدانیم افزونه واقعاً استفاده می‌شود، افزونه هر ۶ ساعت یک بار عددهای جمع‌شدهٔ امروز (و روزهای عقب‌افتادهٔ تا یک هفته) را به `https://sub-ify.site/subify-api/usage` می‌فرستد:

- تعداد جلسه، تعداد خط زیرنویس، تعداد فایل زیرنویس دانلودشده، تعداد خط‌های هر ویدیو و تعداد خط‌هایی که از کش مشترک آمد، تعداد خروجی صوتی و تعداد دفعات دوبله؛
- ثانیه‌های زیرنویس، دوبله و زیرنویس زنده، و ثانیه‌های گفتار به تفکیک کد زبان مبدأ (مثلاً `fa` یا `en`)؛
- یک شناسهٔ تصادفی نصب (۳۲ نویسه). سرور آن را هش می‌کند.
- برای نقشهٔ ساعت‌های فعال: ثانیه‌های کار (زیرنویس، دوبله و زیرنویس زنده) در هر ساعت از روز به وقت جهانی (UTC)، یعنی ۲۴ عدد برای هر روز، و بیشترین مدت «نشست» همان روز. نشست یعنی کار پیوسته که بین دو بخش آن بیش از ۱۰ دقیقه وقفه نباشد. سرور از این عددها فقط ساعت و روز هفته را می‌داند، نه زمان دقیق کار و نه منطقهٔ زمانی تو.

در این گزارش نه متن، نه ترجمه، نه عنوان یا نشانی ویدیو، نه ایمیل یا اطلاعات حساب ذخیره می‌شود. نشانی IP در پایگاه داده‌ی Subify ذخیره نمی‌شود؛ فقط یک کلید هش‌شدهٔ موقت برای محدود کردن تعداد درخواست نگه داشته می‌شود و حداکثر یک روز بعد پاک می‌شود. لاگ‌های معمولی سرور میزبان سایت ممکن است IP را ثبت کنند. هر گزارش، عددهای کامل همان روز این نصب را جایگزین گزارش قبلی می‌کند.

اگر با حساب Subify وارد شوید، این نصب به همان حساب وصل می‌شود تا مصرف‌تان در پنل کاربری (my.sub-ify.site) دیده شود. این اتصال فقط شناسهٔ هش‌شدهٔ نصب و شناسهٔ حساب را ذخیره می‌کند. گزارش‌های قبل از ورود هم، که با همان شناسهٔ نصب ثبت شده‌اند، پس از اتصال در حساب دیده می‌شوند.

## هوش مصنوعی رایگان برای اعضا

اگر وارد حساب Subify شده باشی و کلید AI خودت را ذخیره نکرده باشی، متن لازم برای ترجمه یا تمرین از افزونه به سرور Subify فرستاده می‌شود و از کلید مالک پاسخ می‌گیرد. این متن روی سرور نگه داشته نمی‌شود؛ سرور فقط شمارش مصرف را ثبت می‌کند: شناسهٔ نصب (هش‌شده)، شناسهٔ ویدیو یا نوع تمرین، و تعداد درخواست و توکن. ارائه‌دهندهٔ مدل هم متن را برای ساختن پاسخ می‌بیند. اگر کلید خودت را ذخیره کنی، متن مستقیم به همان ارائه‌دهنده‌ی خودت می‌رود و این بخش استفاده نمی‌شود.

## فعالیت حساب در پنل مدیریت

مدیر Subify می‌تواند برای هر عضو ببیند این ماه چه کارهایی انجام شده است: تعداد ترجمه‌ی زیرنویس، دوبله، تمرین با مربی و چت، و ۱۰۰ کار آخر با زمان و نام فایل یا ویدیو. این فهرست همراه با وضعیت دانشجویی یا پرو ذخیره می‌شود.

- متن زیرنویس‌ها، ترجمه‌ها، گفتگوها و محتوای تمرین‌ها در این فهرست ذخیره نمی‌شود.
- این داده‌ها حداکثر ۱۸۰ روز نگه داشته می‌شوند و بعد پاک می‌شوند.
- این فهرست فقط برای حساب‌هایی است که وارد شده‌اند. آمار ناشناس روزانه (بخش بالاتر) جدا از این است.

## تاریخچهٔ ویدیوها

افزونه فهرست ۵۰ ویدیوی آخری را که تماشا کرده‌اید روی همین دستگاه نگه می‌دارد (`subify_video_history`). این فهرست با شناسهٔ نصب به سرور Subify همگام می‌شود و برای هر ویدیو این‌ها ذخیره می‌شود: شناسهٔ ویدیوی یوتیوب، عنوان ویدیو، نقطهٔ توقف (ثانیه) و مدت ویدیو. نقطهٔ توقف هر چند ثانیه یک بار به‌روز می‌شود تا در پنل کاربری بتوانید از همان جا ادامه دهید.

- این همگام‌سازی برای همه انجام می‌شود، حتی بدون ورود به حساب. با ورود، نصب به حساب وصل می‌شود و تاریخچه در پنل دیده می‌شود.
- اگر ویدیویی را از فهرست افزونه حذف کنید، از سرور هم حذف می‌شود. اگر در پنل حذفش کنید، از فهرست افزونه هم حذف می‌شود.
- متن زیرنویس‌ها و ترجمه‌ها در این همگام‌سازی فرستاده نمی‌شود.

این عددها جمع می‌شوند و در صفحهٔ آمار عمومی Subify و داشبورد مدیریت نشان داده می‌شوند.

این ارسال برای همه فعال است و گزینهٔ خاموش کردن ندارد. دکمهٔ «پاک‌کردن کامل داده‌ها» شناسهٔ نصب را پاک و یک شناسهٔ تازه می‌سازد، ولی گزینهٔ خاموش را تغییر نمی‌دهد. عددهایی که قبلاً فرستاده شده‌اند روی سرور می‌مانند، به‌صورت جمع‌شده و بدون نام.

## پاک‌کردن داده‌ها

دکمهٔ «پاک‌کردن کامل داده‌ها» در صفحهٔ تنظیمات پیشرفته (Options) موارد زیر را حذف می‌کند:
- تمام کلیدها و تنظیمات (`pd_settings`, `pd_models`, `pd_stats`, و کلیدهای `subify_*`)
- `browser.storage.session`
- پایگاه‌دادهٔ IndexedDB افزونه (دیکشنری، اسکرین‌شات، استوری‌بورد)
- حافظهٔ ترجمهٔ صفحاتی که همین الان بازند (یوتیوب/ویمیو/آپارات)؛ برای تب‌هایی که الان باز نیستند، پاک‌سازی در اولین بازدید بعدی همان تب انجام می‌شود.

این کار قابل بازگشت نیست.

## مجوزهای مرورگر

افزونه برنامه‌ی زیرنویس و دوبله را فقط روی این سایت‌ها اجرا می‌کند: YouTube (شامل m.youtube.com و youtube-nocookie.com)، Vimeo، Aparat، Coursera، X، Instagram، Facebook، TikTok، Threads، Udemy، LinkedIn، edX، H5P، TED و Khan Academy.

دسترسی‌های دیگر فقط برای کار خود افزونه‌اند: دامنه‌های Gemini، OpenRouter، OpenAI، sub-ify.site (برای ورود، کش ترجمه و همگام‌سازی حساب) و api.dictionaryapi.dev (برای معنی لغت). دسترسی «همهٔ سایت‌ها» به‌صورت پیش‌فرض داده نمی‌شود؛ فقط اگر یک Custom API روی دامنه‌ی دیگری تعریف کنی، Chrome برای همان یک دامنه به‌صورت جداگانه اجازه می‌خواهد.

## کتابخانه‌های شخص‌ثالث همراه افزونه

- `vendor/lame.min.js` (کدگذاری MP3، پروژهٔ LAME، مجوز LGPL)، فقط برای ساختن فایل خروجی MP3 در همان دستگاه کاربر اجرا می‌شود، هیچ داده‌ای جایی ارسال نمی‌کند. متن مجوز: `vendor/lamejs-LICENSE.txt`.
- فونت Lalezar (`fonts/Lalezar-Regular.ttf`, مجوز OFL)، فقط برای نمایش زیرنویس.


## Account (only when login is required)
The extension contacts `https://sub-ify.site/auth/me.php` (and `/auth/logout.php` when you sign out) to check whether you are signed in. The session cookie is HttpOnly on sub-ify.site; the extension does not read or store it. Only the account name and e-mail returned by the server are shown in the popup.

You can sign in with a username and password, or with Google, GitHub or LinkedIn. A username and password account stores the username, an optional e-mail address, and a bcrypt hash of your password (never the password itself). Sign-in with LinkedIn sends your LinkedIn ID, name, e-mail and profile picture URL to the server. Account activity is shown to the Subify administrator as described in the Persian section "فعالیت حساب در پنل مدیریت".

When you are signed in, the extension also syncs your vocabulary cards with `/auth/vocab.php` and sends or reads your support tickets with `/auth/tickets.php`. Both requests are sent with your sign-in cookie. The translation cache at `/subify-api/cache` (described in the Persian section above) is sent without the cookie. The button "Delete all data" does not delete data already stored on sub-ify.site.

## Recent videos and saved words in AI practice
The extension keeps the titles of your last 50 videos on this device (`subify_video_history`) and syncs them to your Subify account history (see the section above). When you start a practice or writing task, the titles of recent videos and up to 8 saved words for your target language are included in the AI request so the task can refer to them. Nothing else is sent for these tasks. You can remove items from the history in the account panel; the extension list follows.
- When you are signed in and have no AI key of your own, the text needed for a translation or an exercise is sent to Subify's server, which answers with the owner's key. The server does not keep the text; it only counts usage (hashed install id, video id or exercise type, requests and tokens). The model provider sees the text to produce the answer.
