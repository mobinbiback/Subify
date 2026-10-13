var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*
/* Subify UI language switcher: Persian / English only. UI strings only. */
(function(){
  const KEY='subify_ui_language';
  const root=document.documentElement;
  const $=id=>document.getElementById(id);
  const dict={
    'مرکز کنترل':'Control','ترجمه':'Translate','استایل':'Style','کلیدها':'API Keys',
    'شروع ترجمه':'Start translation','برای شروع ترجمه، همین دکمه رو بزن':'Click to start translation',
    'زیرنویس':'Subtitles','دوبلهٔ':'Dubbing','فارسی':'Persian','انگلیسی':'English','عربی':'Arabic','ترکی':'Turkish','اسپانیایی':'Spanish','آلمانی':'German','فرانسوی':'French','پرتغالی':'Portuguese','روسی':'Russian','هندی':'Hindi','چینی':'Chinese','ژاپنی':'Japanese','کره‌ای':'Korean','ایتالیایی':'Italian',
    'استخراج مستقیم از Caption خود YouTube با تایم‌استمپ واقعی':'Directly reads YouTube captions with real timestamps',
    'صدای مقصد با حفظ زمان‌بندی و صدای اصلی در پس‌زمینه':'Target-language audio with the original audio in the background',
    'وقتی دوبله روشنه:':'When dubbing is on:','🔊 صدای دوبله رو هم پخش کن':'🔊 Play dubbed audio too','📝 فقط زیرنویس زنده، بدون صدا':'📝 Live captions only, no audio',
    'ترجمهٔ کامل صفحه':'Translate full page','متن‌های قابل‌مشاهدهٔ همین صفحه را ترجمه می‌کند.':'Translates the visible text on this page.','زبان مقصد':'Target language','فونت صفحه':'Page font','ترجمه صفحه':'Translate page','بازگردانی':'Restore','برای ترجمه، زبان و فونت را انتخاب کن.':'Choose a language and font, then translate this page.',
    'آماده؛ زبان و لحن ترجمه رو از تب «ترجمه» تنظیم کن، کلیدها رو از «کلیدها» مدیریت کن.':'Ready. Set language and tone in Translate, and manage keys in API Keys.',
    'تنظیمات پیشرفته':'Advanced settings','گزارش فنی':'Diagnostics',
    'نمایش خط اصلی':'Show original line','متن اصلی بالای ترجمه نمایش داده شود':'Show the original above the translation','هایلایت کلمه‌به‌کلمه':'Word-by-word highlight','نمایش حالت کارائوکه هنگام پخش زیرنویس':'Show karaoke highlighting while subtitles play',
    'هنوز هیچ کلید یا سرویس ترجمه‌ای تنظیم نشده است.':'No translation key or service has been configured yet.','زیرنویس فعال است':'Subtitles are on','هنوز هیچ سرویسی اضافه نشده است':'No service has been added yet.','فقط ترجمه':'Translation only','ترجمه+اصلی':'Translation + original','ترجمه + اصلی':'Translation + original','خودکار (لحن خود گوینده)':'Auto (speaker tone)','API اختصاصی':'Custom API','مثلا سرویس من':'e.g. My service','مثلاً سرویس من':'e.g. My service','کلید سرویس':'Service key','مثلاً...':'e.g. ...','فونت انگلیسی':'English font','موتور ترجمه':'Translation engine','برای همین ویدیو':'For this video','خودکار':'Auto','سرویس سفارشی':'Custom service','در حالت خودکار، سرویس دارای کلید معتبر انتخاب می‌شود.':'In Auto mode, a provider with a valid key is selected.',
    'مدل این Provider':'Provider model','↻ دریافت مدل‌ها':'↻ Get models','مدل را دستی انتخاب کن؛ این انتخاب فقط برای ترجمه زیرنویس است.':'Choose a model manually; this only affects subtitle translation.',
    'OpenAI-compatible':'OpenAI-compatible','مدیریت سرویس‌های سفارشی (افزودن/ویرایش)':'Manage custom services (add/edit)',
    'زبان مبدا':'Source language','زبان ترجمه':'Translation language','لحن ترجمه':'Translation tone','خودکار (لحن خود گوینده)':'Auto (speaker tone)','همیشه رسمی':'Always formal','همیشه محاوره‌ای/دوستانه':'Always casual/friendly','آکادمیک (ارائه به استاد)':'Academic (presentation)',
    'زیرنویس از':'Subtitles from','Caption واقعی YouTube':'Real YouTube captions','خوانده می‌شود و ترجمه بر اساس همان cue و تایم‌کد نمایش داده می‌شود.':'are read and translated using the same cue and timestamps.',
    '📜 نمایش/پنهان‌کردن پنل ترنسکریپت':'📜 Show/hide transcript panel','ترجمهٔ ثابت برای کلمات خاص':'Fixed translations for specific words','اسم‌ها، اصطلاح‌های فنی و...':'Names, technical terms, etc.','گاهی هوش‌مصنوعی یه کلمه رو هر بار یه‌جور ترجمه می‌کنه. اینجا می‌تونی بگی یه کلمه یا عبارت خاص':'Sometimes AI translates a word differently each time. Here you can make a specific word or phrase',
    'همیشه':'always','دقیقاً به یه شکل ثابت ترجمه بشه، توی همهٔ ویدیوها، نه فقط همین یکی.':'translate exactly the same way in every video, not just this one.','مثال:':'Example:','+ اضافه کردن':'+ Add','هنوز چیزی اضافه نکردی، لیست خالیه.':'Nothing added yet: the list is empty.',
    'خروجی و دانلود':'Export & download','SRT / VTT / TXT، صوت دوبله':'SRT / VTT / TXT, dubbed audio','زیرنویس اصلی':'Original subtitles','صوت دوبله':'Dubbed audio','MP3 (فشرده)':'MP3 (compressed)','🎧 صوت اصلی':'🎧 Original audio','🗣️ صوت دوبله':'🗣️ Dubbed audio',
    'پریست‌های آماده':'Presets','یک انتخاب، یک استایل کامل':'One choice, a complete style','تایپوگرافی':'Typography','فونت، نوع نمایش، اندازه و عرض متن':'Font, display mode, size and text width','نمایش':'Display','فقط ترجمه':'Translation only','اصلی + ترجمه':'Original + translation','فقط اصلی':'Original only','اندازه':'Size','عرض متن':'Text width','موقعیت':'Position','محل نمایش زیرنویس روی ویدیو':'Subtitle position on video','پایین، مثل YouTube':'Bottom, like YouTube','وسط ویدیو':'Center','بالا':'Top','سفارشی / Drag':'Custom / Drag','موقعیت عمودی':'Vertical position','رنگ و شفافیت':'Color & opacity','رنگ متن، پس‌زمینه و هایلایت':'Text, background and highlight colors','شفافیت':'Opacity','گردی گوشه':'Corner radius','رنگ متن':'Text color','رنگ پس‌زمینه':'Background color','رنگ هایلایت':'Highlight color','جلوه‌های بیشتر':'More effects','Outline و Shadow برای تنظیم نهایی':'Outline and Shadow for final tuning','بازنشانی استایل':'Reset style','ذخیره استایل':'Save style','تنظیمات کامل':'Full settings',
    'کلیدهای API':'API keys','کلید Gemini، OpenRouter و OpenAI را همین‌جا وارد کن. برای':'Enter your Gemini, OpenRouter and OpenAI keys here. For','فقط کارت «افزودن API اختصاصی» را بزن تا پنل مدیریت باز شود.':'click the “Add custom API” card to open the management panel.','محلی و امن':'Local & secure','سرویس‌های دیگر':'Other services','API اختصاصی داری؟':'Have a custom API?','بدون دردسر':'Easy setup','اگر سرویس تو':'If your service is not','نیست، اینجا چیزی وارد نکن. فقط دکمهٔ زیر را بزن تا پنل مدیریت باز شود.':'Gemini, OpenRouter or OpenAI, enter nothing here. Use the button below to open management.','این دکمه را بزن':'Press this button','اطلاعات API را وارد کن':'Enter API information','ذخیره کن':'Save it','⚙ افزودن API اختصاصی در پنل مدیریت':'⚙ Add custom API in management','بعد از ذخیره، برای استفاده برو به «ترجمه» و از «موتور ترجمه» سرویس سفارشی را انتخاب کن.':'After saving, go to Translate and select the custom service from Translation engine.',
    'ذخیره کلیدها':'Save keys','بررسی اتصال':'Connection tests','قبل از ترجمه، اتصال سرویس را همین‌جا امتحان کن.':'Test the service connection here before translating.','تست Gemini':'Test Gemini','تست OpenRouter':'Test OpenRouter','تست OpenAI':'Test OpenAI','کلیدها ذخیره و از تنظیمات اصلی خوانده می‌شوند. مدل هر سرویس از تب «ترجمه» انتخاب می‌شه.':'Keys are saved and read from the main settings. Choose each service model from Translate.',
    '📚 یادگیری':'📚 Learn','🎬 Storyboard':'🎬 Storyboard','📸 اسکرین‌شات':'📸 Screenshot','ساخته‌شده توسط Mobin Bibak ↗':'Made by Mobin Bibak ↗',
    'به Subify خوش اومدی':'Welcome to Subify','رد شدن':'Skip','بعدی':'Next','آمادهٔ شروعی':'Ready to start','ترجمه سریع داخل YouTube':'Fast translation inside YouTube'
  };
  const reverse={}; Object.entries(dict).forEach(([fa,en])=>{if(typeof en==='string'&&!reverse[en])reverse[en]=fa;});
  function translateTextNode(n,lang){
    const raw=n.nodeValue; const trimmed=raw.trim(); if(!trimmed)return;
    const map=lang==='en'?dict:reverse; if(!map[trimmed])return;
    n.nodeValue=raw.replace(trimmed,map[trimmed]);
  }
  function walk(lang){
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:n=>{
      const p=n.parentElement; if(!p||['SCRIPT','STYLE','OPTION'].includes(p.tagName)||p.closest('[data-subify-i18n-ignore]'))return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT;
    }});
    const nodes=[]; while(walker.nextNode())nodes.push(walker.currentNode); nodes.forEach(n=>translateTextNode(n,lang));
    document.documentElement.lang=lang==='en'?'en':'fa'; document.documentElement.dir=lang==='en'?'ltr':'rtl';
  }
  function updateDynamic(lang){
    const btn=$('popupLanguage'); if(btn){btn.textContent=lang==='en'?'FA':'EN';btn.title=lang==='en'?'Switch to Persian':'Switch to English';btn.setAttribute('aria-label',btn.title);}
    const site=$('siteAddress'); if(site)site.textContent='sub-ify.site';
    if(typeof window.renderState==='function') window.renderState(currentState);
  }
  async function apply(lang){
    lang=lang==='en'?'en':'fa'; await browser.storage.local.set({subify_ui_language:lang}); walk(lang); updateDynamic(lang); }
  async function init(){
    const r=await browser.storage.local.get(KEY); const lang=r[KEY]==='en'?'en':'fa';
    walk(lang); updateDynamic(lang);
    $('popupLanguage')?.addEventListener('click',async()=>{const next=document.documentElement.lang==='en'?'fa':'en';await apply(next);});
    const obs=new MutationObserver(muts=>{const lang=document.documentElement.lang==='en'?'en':'fa'; for(const m of muts){for(const n of m.addedNodes||[]){if(n.nodeType===Node.TEXT_NODE)translateTextNode(n,lang); else if(n.nodeType===Node.ELEMENT_NODE){const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);const a=[];while(w.nextNode())a.push(w.currentNode);a.forEach(x=>translateTextNode(x,lang));}}}}); obs.observe(document.body,{subtree:true,childList:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
