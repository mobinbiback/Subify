
function syncMainLang(){const s=document.getElementById('tab-target-language'),o=document.getElementById('mainLangVal');if(s&&o)o.textContent=s.options[s.selectedIndex]?.textContent||'';}
browser.storage.local.get('subify_settings').then(r=>{const v=(r&&r.subify_settings&&r.subify_settings.targetLanguage)||'fa';const s=document.getElementById('tab-target-language');if(s)s.value=v;syncMainLang();}).catch(()=>{});
function setSafeHTML(el, html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  el.replaceChildren(...Array.from(doc.body.childNodes).map(node => document.importNode(node, true)));
}


function normalizePopupText(value){
  return String(value ?? '').replace(/\\r\\n/g,'\n').replace(/\\n/g,'\n').replace(/\\r/g,'\n');
}
const $ = id => document.getElementById(id);
let currentState = {active:false};

// Subtitle and dubbing labels never name a language. The status line is the same in every
// target language; the language itself is picked on the Translate tab.
let subtitleOnNow=false;
let providerWarning="";
// Short feedback (saved, failed, nothing to export) shows in a toast, so the footer keeps its version.
let sayTimer=0;
function say(text){
  const t=$("toast"); if(!t) return;
  t.textContent=normalizePopupText(text);
  t.classList.add("show");
  clearTimeout(sayTimer);
  sayTimer=setTimeout(()=>t.classList.remove("show"),2600);
}

// One status line: the on/off label under the power switch, and the notice box for an error or a missing key.
function paintStatus(){
  const uiEn=document.documentElement.lang==='en';
  const on=subtitleOnNow;
  $("toggle").classList.toggle("on",on);
  const label=$("stateLabel");
  label.textContent=on?(uiEn?"Subtitles are on":"زیرنویس فعال است"):"آماده";
  label.classList.toggle("on",on);
  $("idleHint").hidden=on;
  const box=$("status");
  const err=currentState.error;
  if(err) setSafeHTML(box,`<span class="error">${escapeHtml(err)}</span>`);
  else if(providerWarning) setSafeHTML(box,providerWarning);
  else box.replaceChildren();
  box.hidden=!(err||providerWarning);
}

function renderState(s){
  currentState=s||{active:false};
  browser.storage.local.get("subify_subtitle_enabled").then(flags=>{
    subtitleOnNow=flags.subify_subtitle_enabled!==false;
    paintStatus();
  });
}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

async function activeTab(){const [tab]=await browser.tabs.query({active:true,currentWindow:true});return tab;}

async function setDubbing(on){
  const tab=await activeTab();
  if(!tab?.id)return;
  const r=await browser.runtime.sendMessage({type:"subify-set-dubbing",enabled:Boolean(on),tabId:tab.id}).catch(e=>({ok:false,error:e.message}));
  const el=$("subify-popup-dubbing");
  if(!r?.ok){
    if(el)el.checked=false;
    say(r?.error||"فعال‌سازی دوبله ناموفق بود");
    return;
  }
  await browser.storage.local.set({subify_dubbing_enabled:Boolean(on)});
  if(el)el.checked=Boolean(on);
  $("dubbing-audio-mode").style.display=on?"block":"none";
  showDubQuick(on);
}

$("toggle").addEventListener("click",async()=>{
  const tab=await activeTab();
  if(!tab?.id)return;
  const flags=await browser.storage.local.get("subify_subtitle_enabled");
  const next=flags.subify_subtitle_enabled===false;
  await browser.storage.local.set({subify_subtitle_enabled:next});
  try{await browser.tabs.sendMessage(tab.id,{type:next?"subify-enable-subtitles":"subify-disable-subtitles"});}catch(_){}
  await renderState(await browser.runtime.sendMessage({type:"popup-get-status"}));
});

function setDubbingModeButtons(withAudio){
  $("dubbing-mode-full")?.classList.toggle("active",withAudio);
  $("dubbing-mode-captions")?.classList.toggle("active",!withAudio);
}
// Quick dub controls next to the dubbing switch: volume and speed, the same values the panel uses.
function showDubQuick(on){
  const box=$("dub-quick"); if(!box)return;
  box.style.display=on?"grid":"none";
  if(on)loadDubQuick();
}
function paintDubQuick(){
  const fa=(n)=>String(n).replace(/\./g,"٫").replace(/\d/g,(d)=>"۰۱۲۳۴۵۶۷۸۹"[d]);
  $("dubQuickGainOut").textContent=fa(Number($("dubQuickGain").value).toFixed(1))+"×";
  $("dubQuickRateOut").textContent=fa(Number($("dubQuickRate").value).toFixed(2))+"×";
  $("dubQuickDuckOut").textContent=fa(String(Math.round(Number($("dubQuickDuck").value)*100)))+"٪";
}
async function loadDubQuick(){
  const {pd_settings={}}=await browser.storage.local.get("pd_settings");
  $("dubQuickGain").value=Number(pd_settings.dubGain??1.6);
  $("dubQuickRate").value=Number(pd_settings.playbackRate??1);
  $("dubQuickDuck").value=Number(pd_settings.duckLevel??0.3);
  paintDubQuick();
}
async function saveDubQuick(){
  const {pd_settings={}}=await browser.storage.local.get("pd_settings");
  await browser.storage.local.set({pd_settings:{...pd_settings,dubGain:Number($("dubQuickGain").value),playbackRate:Number($("dubQuickRate").value),duckLevel:Number($("dubQuickDuck").value)}});
}
$("dubQuickGain")?.addEventListener("input",paintDubQuick);
$("dubQuickRate")?.addEventListener("input",paintDubQuick);
$("dubQuickGain")?.addEventListener("change",saveDubQuick);
$("dubQuickRate")?.addEventListener("change",saveDubQuick);
$("dubQuickDuck")?.addEventListener("input",paintDubQuick);
$("dubQuickDuck")?.addEventListener("change",saveDubQuick);
async function setDubbingAudioMode(withAudio){
  setDubbingModeButtons(withAudio);
  const {pd_settings={}}=await browser.storage.local.get("pd_settings");
  await browser.storage.local.set({pd_settings:{...pd_settings,dubbingAudioEnabled:withAudio}});
  // If dubbing is already running, apply it immediately rather than making
  // the user restart dubbing for the toggle to take effect.
  if($("subify-popup-dubbing").checked){
    await browser.runtime.sendMessage({type:"subify-set-dubbing-audio",enabled:withAudio}).catch(()=>{});
  }
}
$("subify-popup-dubbing").addEventListener("change",e=>setDubbing(e.target.checked));
$("dubbing-mode-full").addEventListener("click",()=>setDubbingAudioMode(true));
$("dubbing-mode-captions").addEventListener("click",()=>setDubbingAudioMode(false));
$("subify-popup-subtitle").addEventListener("change",async e=>{
  const on=e.target.checked;
  await browser.storage.local.set({subify_subtitle_enabled:on});
  const tab=await activeTab();
  if(tab?.id)try{await browser.tabs.sendMessage(tab.id,{type:on?"subify-enable-subtitles":"subify-disable-subtitles"});}catch(_){}
  renderState(currentState);
});



function srtTime(t){
  t=Math.max(0,Number(t)||0);
  const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60),ms=Math.round((t%1)*1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

async function getExportCues(translateAll=false){
  const tab=await activeTab();
  if(tab?.id){
    try{
      const r=await browser.tabs.sendMessage(tab.id,{type:"subify-refresh-captions",translateAll:Boolean(translateAll)});
      if(r?.ok && Array.isArray(r.cues)) return r.cues
        .filter(c=>Number.isFinite(Number(c.start))&&Number.isFinite(Number(c.end))&&Number(c.end)>Number(c.start))
        .sort((a,b)=>Number(a.start)-Number(b.start));
    }catch(_){}
  }
  const data=await browser.storage.session.get(["subify_export_cues"]);
  const cues=Array.isArray(data.subify_export_cues)?data.subify_export_cues:[];
  return cues.filter(c=>!String(c.id||'').startsWith('live|') && Number.isFinite(Number(c.start)) && Number.isFinite(Number(c.end)) && Number(c.end)>Number(c.start))
    .sort((a,b)=>Number(a.start)-Number(b.start));
}

function vttTime(t){
  t=Math.max(0,Number(t)||0);
  const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60),ms=Math.round((t%1)*1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

function exportText(cues, which, format){
  const useFa=which==='fa';
  const rows=cues.map((c,i)=>({
    i:i+1,start:c.start,end:c.end,text:String(useFa?(c.fa||c.text||''):(c.text||'')).trim()
  })).filter(x=>x.text);
  if(format==='txt') return rows.map(x=>x.text).join('\n');
  if(format==='vtt') return 'WEBVTT\n\n'+rows.map(x=>`${vttTime(x.start)} --> ${vttTime(x.end)}\n${x.text}\n`).join('\n');
  return rows.map(x=>`${x.i}\n${srtTime(x.start)} --> ${srtTime(x.end)}\n${x.text}\n`).join('\n');
}

async function downloadSubtitle(which, format){
  const cues=await getExportCues(which==='fa');
  if(!cues.length){say('هنوز زیرنویسی ثبت نشده');return;}
  const rows=cues.filter(c=>String(which==='fa'?(c.fa||c.text||''):(c.text||'')).trim());
  if(!rows.length){say(which==='fa'?'هنوز ترجمه‌ای آماده نشده':'زیرنویس اصلی در دسترس نیست');return;}
  const text=exportText(cues,which,format);
  const mime=format==='srt'?'application/x-subrip':format==='vtt'?'text/vtt':'text/plain';
  const ext=format;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:mime+';charset=utf-8'}));
  a.download=`subify-${which==='fa'?'fa':'original'}-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.${ext}`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),30000);
}

$('dlFaSrt').addEventListener('click',()=>downloadSubtitle('fa','srt'));
$('dlFaVtt').addEventListener('click',()=>downloadSubtitle('fa','vtt'));
$('dlFaTxt').addEventListener('click',()=>downloadSubtitle('fa','txt'));
$('dlOrigSrt').addEventListener('click',()=>downloadSubtitle('original','srt'));
$('dlOrigVtt').addEventListener('click',()=>downloadSubtitle('original','vtt'));
$('dlOrigTxt').addEventListener('click',()=>downloadSubtitle('original','txt'));

async function exportAudio(mode,stem){
  const format=$('audioExportFormat')?.value==='mp3'?'mp3':'wav';
  const filename=`${stem}-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.${format}`;
  const r=await browser.runtime.sendMessage({type:'popup-export',mode,filename,format});
  if(!r?.ok) say('خروجی صوتی هنوز آماده نیست');
}
$('dlOrigAudio').addEventListener('click',()=>exportAudio('original','subify-original'));
$('dlDubAudio').addEventListener('click',()=>exportAudio('dub','subify-dub'));

browser.runtime.onMessage.addListener(msg=>{
  if(msg.type==="status")renderState(msg.state);
  if(msg.type==="subify-subtitles-auto-enabled" && $('subify-tab-subtitle')) $('subify-tab-subtitle').checked=true;
  if(msg.type==="export-fallback" && msg.url){
    fetch(msg.url).then(r=>r.blob()).then(blob=>{
      const u=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=u; a.download=msg.filename||'subify-export.wav'; a.click();
      setTimeout(()=>URL.revokeObjectURL(u),60000);
    }).catch(()=>{});
  }
});
async function init(){
  const [st,flags,{pd_settings={}}]=await Promise.all([browser.runtime.sendMessage({type:"popup-get-status"}),browser.storage.local.get(["subify_subtitle_enabled","subify_dubbing_enabled"]),browser.storage.local.get("pd_settings")]);
  $("subify-popup-subtitle").checked=flags.subify_subtitle_enabled!==false;
  $("subify-popup-dubbing").checked=flags.subify_dubbing_enabled===true;
  $("dubbing-audio-mode").style.display=flags.subify_dubbing_enabled===true?"block":"none";
  showDubQuick(flags.subify_dubbing_enabled===true);
  setDubbingModeButtons(pd_settings.dubbingAudioEnabled!==false);
  if(st?.state)renderState(st.state); else renderState({active:false});
  const settings=await browser.storage.local.get(["subify_settings","pd_settings"]);
  const keysFrom=[settings.subify_settings||{},settings.pd_settings||{}];
  const hasProvider=keysFrom.some(s=>s.apiKey||s.openRouterKey||s.openaiKey||s.customProviders?.length);
  providerWarning=hasProvider?"":`<span class="error">${document.documentElement.lang==='en'?'No translation key or service has been configured yet.':'هنوز هیچ کلید یا سرویس ترجمه‌ای تنظیم نشده است.'}</span>`;
  renderState(currentState);
}
init();

// Learning lives in the panel now; this button only opens its learning section.
[...document.querySelectorAll("[data-tool-page]")].forEach((b)=>b.addEventListener("click",()=>browser.tabs.create({url:browser.runtime.getURL(b.dataset.toolPage)})));
$("captureShot")?.addEventListener("click",async()=>{const tab=await activeTab();if(tab?.id)await browser.runtime.sendMessage({type:"subify-capture-shot",tabId:tab.id,download:true});});

// Header tabs + compact style editor. All values share the same subify_settings
// object used by the full options page, so editing here is not a separate config.
(function initPopupTabsAndStyle(){
  const tabs=[...document.querySelectorAll('.tab')], panels=[...document.querySelectorAll('.tab-panel')];
  tabs.forEach(t=>t.addEventListener('click',()=>{
    const name=t.dataset.tab;
    tabs.forEach(x=>x.classList.toggle('active',x===t));
    panels.forEach(p=>p.classList.toggle('active',p.dataset.panel===name));
    if(name==='style') loadPopupStyle();
    if(name==='translate') loadPopupTranslate();
    if(name==='services') loadPopupServices();
  }));
  $('openFullSettings')?.addEventListener('click',()=>browser.runtime.openOptionsPage());
  $('openStyleFull')?.addEventListener('click',()=>browser.runtime.openOptionsPage());

  const presets={
    classic:{bgColor:'#0B0E13',textColor:'#F8FAFC',highlightColor:'#FFB35C',borderRadius:10,padding:9,outlineWidth:0,shadowBlur:8,customWeight:600,positionMode:'bottom',maxWidth:86,bgOpacity:.88,fontSize:30,effect:'classic'},
    youtube:{bgColor:'#050505',textColor:'#FFFFFF',highlightColor:'#FFFFFF',borderRadius:3,padding:5,outlineWidth:0,shadowBlur:2,customWeight:600,positionMode:'bottom',maxWidth:82,bgOpacity:.82,fontSize:28,effect:'youtube'},
    pill:{bgColor:'#FFFFFF',textColor:'#111318',highlightColor:'#B66A00',borderRadius:999,padding:9,outlineWidth:0,shadowBlur:10,customWeight:700,positionMode:'bottom',maxWidth:86,bgOpacity:.94,fontSize:30,effect:'pill'},
    snapchat:{bgColor:'#FFFC00',textColor:'#050505',highlightColor:'#E50000',borderRadius:4,padding:7,outlineWidth:0,shadowBlur:5,customWeight:800,positionMode:'bottom',maxWidth:92,bgOpacity:.96,fontSize:30,effect:'snapchat'},
    cinema:{bgColor:'#050505',textColor:'#F7F1E5',highlightColor:'#E8C878',borderRadius:1,padding:4,outlineWidth:0,shadowBlur:22,customWeight:500,positionMode:'bottom',maxWidth:78,bgOpacity:.62,fontSize:29,effect:'cinema'},
    minimal:{bgColor:'#11151B',textColor:'#F2F4F7',highlightColor:'#AEB8C7',borderRadius:4,padding:5,outlineWidth:0,shadowBlur:0,customWeight:500,positionMode:'bottom',maxWidth:80,bgOpacity:.32,fontSize:27,effect:'minimal'},
    typewriter:{bgColor:'#0B0E13',textColor:'#F8FAFC',highlightColor:'#FF4FD8',borderRadius:4,padding:7,outlineWidth:0,shadowBlur:8,customWeight:600,positionMode:'bottom',maxWidth:88,bgOpacity:.88,fontSize:29,effect:'typewriter'},
    sunset:{bgColor:'#3B1022',textColor:'#FFF4E9',highlightColor:'#FFD166',borderRadius:18,padding:10,outlineWidth:0,shadowBlur:20,customWeight:700,positionMode:'bottom',maxWidth:88,bgOpacity:.78,fontSize:30,effect:'sunset'},
    blueprint:{bgColor:'#07131A',textColor:'#E9FDFF',highlightColor:'#4FF8FF',borderRadius:2,padding:7,outlineWidth:1,shadowBlur:10,customWeight:600,positionMode:'bottom',maxWidth:88,bgOpacity:.9,fontSize:29,effect:'blueprint'}
  };
  const ids=['font','fontEn','display','fontSize','maxWidth','positionMode','positionY','bgOpacity','radius','textColor','bgColor','highlightColor','outlineWidth','shadowBlur'];
  const val=(id)=>$('style-'+id);
  function setStyleForm(s){
    const d={font:'Lalezar',fontEn:'Inter',displayMode:'translation',fontSize:30,maxWidth:86,positionMode:'bottom',positionY:82,bgOpacity:.78,borderRadius:999,textColor:'#111111',bgColor:'#FFFFFF',highlightColor:'#B66A00',outlineWidth:0,shadowBlur:5,preset:'pill',effect:'pill',...s};
    const faFonts=['Lalezar','Vazirmatn','Estedad','VazirmatnVariable','IRANYekanX','Peyda','Sahel','AradFDRegular','AradFDMedium','AradFDBold','AradFDLight','DigiTitr'];
    const enFonts=['Inter','Poppins','Montserrat'];
    const safeFa=faFonts.includes(d.font)?d.font:'Lalezar';
    const safeEn=enFonts.includes(d.fontEn)?d.fontEn:'Inter';
    val('font').value=safeFa; if(val('fontEn')) val('fontEn').value=safeEn; val('display').value=d.displayMode; val('fontSize').value=d.fontSize; val('maxWidth').value=d.maxWidth; val('positionMode').value=d.positionMode; val('positionY').value=d.positionY; val('bgOpacity').value=d.bgOpacity; val('radius').value=d.borderRadius; val('textColor').value=d.textColor; val('bgColor').value=d.bgColor; val('highlightColor').value=d.highlightColor; val('outlineWidth').value=d.outlineWidth; val('shadowBlur').value=d.shadowBlur;
    ['fontSize','maxWidth','positionY','bgOpacity','radius','outlineWidth','shadowBlur'].forEach(id=>{const x=val(id), out=$('style-'+id+'Val');if(!x||!out)return;out.textContent=id==='bgOpacity'?Number(x.value).toFixed(2):x.value});
    document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===d.preset)); renderStylePreview(d);
  }
  function renderStylePreview(s){
    const box=$('styleLivePreview'), orig=$('stylePreviewOrig'), fa=$('stylePreviewFa'); if(!box||!orig||!fa)return;
    const alpha=Math.max(.15,Math.min(.95,Number(s.bgOpacity)||.78));
    const bg=s.bgColor||'#080A0E';
    box.style.background=`${bg}22`;
    const cap=box.querySelector('.style-preview-caption')||box;
    cap.dataset.effect=String(s.effect||s.preset||'pill').toLowerCase();
    cap.style.setProperty('--ink',s.textColor||'#fff'); cap.style.setProperty('--ink-2',s.highlightColor||s.textColor||'#fff'); cap.style.setProperty('--ink-3',s.highlightColor||s.textColor||'#fff');
    cap.style.color=s.textColor||'#fff'; cap.style.background=rgba(s.bgColor||'#000000',alpha);
    cap.style.borderRadius=`${Number(s.borderRadius??7)}px`; cap.style.padding=`${Math.max(3,Number(s.padding||8)/2)}px ${Math.max(8,Number(s.padding||8))}px`;
    cap.style.maxWidth=`${Number(s.maxWidth||86)}%`; cap.style.boxShadow=Number(s.shadowBlur)?`0 3px ${Number(s.shadowBlur)}px rgba(0,0,0,.45)`:'none';
    cap.style.webkitTextStroke=Number(s.outlineWidth)?`${Number(s.outlineWidth)}px #000`:'0 transparent';
    orig.style.display=s.displayMode==='translation'?'none':'block'; fa.style.display=s.displayMode==='original'?'none':'block';
    const uiLang=document.documentElement.lang==='en'?'en':'fa';
    if(uiLang==='en'){
      orig.textContent='Even here, they bloom.';
      fa.textContent='Even here, they bloom.';
      fa.appendChild(document.createTextNode(''));
    }else{
      orig.textContent='Even here, they bloom.';
      setSafeHTML(fa,'حتی <span id="stylePreviewHighlight" class="preview-highlight">اینجا</span> هم شکوفا می‌شوند.');
    }
    const previewHighlight=$('stylePreviewHighlight');
    orig.style.color=s.textColor||'#fff'; fa.style.color=s.textColor||'#fff'; fa.style.fontFamily=uiLang==='en'?fontFamily(s.fontEn||'Inter'):fontFamily(s.font); orig.style.fontFamily=fontFamily(s.fontEn||'Inter'); fa.style.fontSize=`${Math.max(14,Number(s.fontSize)*.62)}px`; fa.style.lineHeight='1.35'; if(previewHighlight) previewHighlight.style.color=s.highlightColor||s.textColor||'#fff';
    const stage=box.querySelector('.style-preview-stage');
    if(stage){const mode=s.positionMode||'bottom';stage.style.alignItems=mode==='top'?'flex-start':mode==='middle'?'center':'flex-end';stage.style.paddingBottom=mode==='bottom'?`${Math.max(4,Number(s.positionY??82)/6)}px`:'0';}
  }
  function fontFamily(name){
    const n=String(name||'').toLowerCase();
    const map={
      lalezar:'"Lalezar",sans-serif',
      vazirmatn:'"Vazirmatn",sans-serif',
      estedad:'"Estedad",sans-serif',
      iranyekanx:'"IRANYekanX",sans-serif',
      digititr:'"DigiTitr",sans-serif',
      sahel:'"Sahel",sans-serif',
      vazirmatnvariable:'"VazirmatnVariable",sans-serif',
      aradfdregular:'"AradFDRegular",sans-serif',
      aradfdmedium:'"AradFDMedium",sans-serif',
      aradfdbold:'"AradFDBold",sans-serif',
      aradfdlight:'"AradFDLight",sans-serif',
      peyda:'"Peyda",sans-serif',
      inter:'"Inter","Vazirmatn",sans-serif',
      poppins:'"Poppins","Vazirmatn",sans-serif',
      montserrat:'"Montserrat","Vazirmatn",sans-serif'
    };
    return map[n] || map.lalezar;
  }
  function rgba(hex,a){const m=String(hex||'#000').match(/^#?([0-9a-f]{6})$/i);if(!m)return `rgba(0,0,0,${a})`;const n=m[1];return `rgba(${parseInt(n.slice(0,2),16)},${parseInt(n.slice(2,4),16)},${parseInt(n.slice(4,6),16)},${a})`;}
  function readStyle(){const preset=document.querySelector('[data-preset].active')?.dataset.preset||'pill';return {font:val('font').value,fontEn:val('fontEn')?.value||'Inter',displayMode:val('display').value,fontSize:+val('fontSize').value,maxWidth:+val('maxWidth').value,positionMode:val('positionMode').value,positionY:+val('positionY').value,bgOpacity:+val('bgOpacity').value,borderRadius:+val('radius').value,textColor:val('textColor').value,bgColor:val('bgColor').value,highlightColor:val('highlightColor').value,outlineWidth:+val('outlineWidth').value,shadowBlur:+val('shadowBlur').value,preset,effect:presets[preset]?.effect||preset};}
  async function loadPopupStyle(){const {subify_settings={}}=await browser.storage.local.get('subify_settings');setStyleForm(subify_settings);}
  async function savePopupStyle(){const {subify_settings={}}=await browser.storage.local.get('subify_settings');await browser.storage.local.set({subify_settings:{...subify_settings,...readStyle()}});say('استایل ذخیره شد ✓');try{const tab=await activeTab();if(tab?.id)await browser.tabs.sendMessage(tab.id,{type:'subify-style-updated'});}catch(_){} }
  $('resetStyle')?.addEventListener('click',async()=>{
    const defaults={font:'Lalezar',fontEn:'Inter',displayMode:'translation',fontSize:30,maxWidth:86,positionMode:'bottom',positionY:82,bgOpacity:.78,borderRadius:999,textColor:'#111111',bgColor:'#FFFFFF',highlightColor:'#B66A00',outlineWidth:0,shadowBlur:5,preset:'pill',effect:'pill'};
    const {subify_settings={}}=await browser.storage.local.get('subify_settings');
    const next={...subify_settings,...defaults};
    await browser.storage.local.set({subify_settings:next});
    setStyleForm(next);
    try{const tab=await activeTab();if(tab?.id)await browser.tabs.sendMessage(tab.id,{type:'subify-style-updated'});}catch(_){}
    say('استایل بازنشانی شد ✓');
  });
  $('saveStyle')?.addEventListener('click',savePopupStyle);
  document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{const {dataset}=b;const current=readStyle();setStyleForm({...current,...presets[dataset.preset],preset:dataset.preset});}));
  let styleAutoSaveTimer=null;
  function scheduleStyleAutoSave(){clearTimeout(styleAutoSaveTimer);styleAutoSaveTimer=setTimeout(()=>{savePopupStyle();},400);}
  // 'input' fires continuously while dragging a slider, update the popup's
  // own live preview instantly, but debounce the actual save+push-to-video
  // so a drag doesn't spam storage writes and messages.
  ['font','fontEn','display','fontSize','maxWidth','positionMode','positionY','bgOpacity','radius','textColor','bgColor','highlightColor','outlineWidth','shadowBlur'].forEach(id=>val(id)?.addEventListener('input',()=>{renderStylePreview(readStyle());scheduleStyleAutoSave();}));
  // 'change' (a discrete pick, dropdown, color swatch) is safe to save
  // immediately, no debounce needed.
  ['font','fontEn','display','positionMode','textColor','bgColor','highlightColor'].forEach(id=>val(id)?.addEventListener('change',()=>{renderStylePreview(readStyle());clearTimeout(styleAutoSaveTimer);savePopupStyle();}));

  async function loadPopupTranslate(){
    const {subify_settings={}}=await browser.storage.local.get('subify_settings');
    const {pd_settings={},pd_models={}}=await browser.storage.local.get(['pd_settings','pd_models']);
    pd_settings.discoveredGeminiModels = Array.isArray(pd_models.all) ? pd_models.all.filter(m=>m && m.methods?.includes?.('generateContent')).map(m=>({id:m.id})) : [];
    $('subify-tab-original').checked=subify_settings.displayMode==='dual';
    $('subify-tab-karaoke').checked=subify_settings.karaokeEnabled!==false;
    $('tab-source-language').value=subify_settings.sourceLanguage||'auto';
    $('tab-target-language').value=subify_settings.targetLanguage||'fa';syncMainLang();
    if($('tab-tone')) $('tab-tone').value=subify_settings.translationTone||'auto';
    renderGlossary(Array.isArray(subify_settings.glossary)?subify_settings.glossary:[]);
    $('popup-provider').value=pd_settings.subtitleProvider||'auto';
    updateProviderUi($('popup-provider').value, pd_settings); await loadCustomProviders();
  }
  function updateProviderUi(v,pd={}){
    const labels={auto:'خودکار',gemini:'Gemini',openrouter:'OpenRouter',openai:'OpenAI',custom:'سرویس سفارشی'};
    if($('providerBadge'))$('providerBadge').textContent=labels[v]||'خودکار';
    if($('providerHint'))$('providerHint').textContent=v==='auto'?'خودکار: اول OpenRouter، سپس OpenAI و بعد Gemini؛ فقط سرویسی که کلید دارد استفاده می‌شود.':`موتور انتخاب‌شده: ${labels[v]||v}. فقط همان سرویس برای ترجمه استفاده می‌شود.`;
    const input=$('popup-provider-model'), select=$('popup-gemini-models'), manual=$('popup-gemini-model-manual'), fetchBtn=$('fetch-gemini-models'), hint=$('providerModelHint');
    if(!input||!select)return;
    const isGemini=v==='gemini', isOR=v==='openrouter', isOAI=v==='openai', isCustom=v==='custom';
    select.style.display=isGemini?'block':'none'; manual.style.display=isGemini?'block':'none'; if(fetchBtn) fetchBtn.style.display=isGemini?'block':'none'; input.style.display=(isGemini||isCustom)?'none':'block';
    if($('custom-provider-panel')) $('custom-provider-panel').style.display=isCustom?'block':'none';
    if(hint) hint.textContent=isGemini?'مدل را از فهرست انتخاب کن یا Model ID را دستی وارد کن. اگر /models خطای 403 بدهد، ورود دستی همچنان کار می‌کند.':isOR?'مدل OpenRouter را می‌توانی دقیقاً دستی تعیین کنی. پیش‌فرض: openrouter/free':isOAI?'مدل OpenAI را دستی وارد کن؛ انتخاب فقط برای ترجمه زیرنویس اعمال می‌شود.':'در حالت Auto، مدل ذخیره‌شده‌ی هر Provider استفاده می‌شود.';
    if(isGemini){
      const val=pd.geminiSubtitleModel||pd.geminiModel||pd.sttModel||'gemini-3.5-flash';
      select.replaceChildren();
      const models=Array.isArray(pd.discoveredGeminiModels)?pd.discoveredGeminiModels:[];
      const ids=models.map(x=>typeof x==='string'?x:x.id).filter(Boolean);
      const uniq=[...new Set([val,...ids])];
      uniq.forEach(id=>{const o=document.createElement('option');o.value=id;o.textContent=id;select.appendChild(o);});
      select.value=val;
      if(manual) manual.value=val;
    } else {
      input.value=isOR?(pd.openRouterModel||'openrouter/free'):isOAI?(pd.openaiModel||'gpt-5.6-luna'):(pd.sttModel||'gemini-3.5-flash');
      input.dataset.provider=v;
    }
  }
  $('fetch-gemini-models')?.addEventListener('click',async()=>{
  const btn=$('fetch-gemini-models');
  if(btn) btn.disabled=true;
  try{
    const r=await browser.runtime.sendMessage({type:'subify-discover-models'});
    if(!r?.ok) throw new Error(r?.error||'خطا در دریافت مدل‌ها');
    const {pd_models={}}=await browser.storage.local.get('pd_models');
    const {pd_settings={}}=await browser.storage.local.get('pd_settings');
    pd_settings.discoveredGeminiModels=pd_models.all||[];
    updateProviderUi('gemini',pd_settings);
    $('providerModelHint').textContent='مدل‌ها دریافت شدند ✓';
  }catch(e){$('providerModelHint').textContent=e.message||String(e);}
  finally{if(btn) btn.disabled=false;}
});
$('subify-tab-subtitle')?.addEventListener('change',async e=>{await browser.storage.local.set({subify_subtitle_enabled:e.target.checked});const tab=await activeTab();if(tab?.id)try{await browser.tabs.sendMessage(tab.id,{type:e.target.checked?'subify-enable-subtitles':'subify-disable-subtitles'});}catch(_){} });
  $('subify-tab-original')?.addEventListener('change',async e=>{const {subify_settings={}}=await browser.storage.local.get('subify_settings');await browser.storage.local.set({subify_settings:{...subify_settings,displayMode:e.target.checked?'dual':'translation'}});});
  $('subify-tab-karaoke')?.addEventListener('change',async e=>{const {subify_settings={}}=await browser.storage.local.get('subify_settings');await browser.storage.local.set({subify_settings:{...subify_settings,karaokeEnabled:e.target.checked}});});
  $('tab-source-language')?.addEventListener('change',async e=>{const {subify_settings={}}=await browser.storage.local.get('subify_settings');await browser.storage.local.set({subify_settings:{...subify_settings,sourceLanguage:e.target.value}});});
  $('tab-tone')?.addEventListener('change',async e=>{
    const {subify_settings={}}=await browser.storage.local.get('subify_settings');
    await browser.storage.local.set({subify_settings:{...subify_settings,translationTone:e.target.value}});
    const tab=await activeTab();
    if(tab?.id)try{await browser.tabs.sendMessage(tab.id,{type:'subify-target-language-changed'});}catch(_){}
  });
  $('toggleTranscriptPanel')?.addEventListener('click',async()=>{
    try{
      const tab=await activeTab();
      if(!tab?.id) return;
      await browser.tabs.sendMessage(tab.id,{type:'subify-toggle-transcript'});
    }catch(_){}
  });

  function renderGlossary(list){
    const wrap=$('glossary-list'); const empty=$('glossary-empty');
    if(!wrap) return;
    wrap.replaceChildren();
    if(!list.length){ if(empty) empty.style.display='block'; return; }
    if(empty) empty.style.display='none';
    list.forEach((entry,i)=>{
      const row=document.createElement('div');
      row.className='gloss-row';
      const text=document.createElement('span');
      text.className='gloss-text';
      text.textContent=`${entry.term} ← ${entry.translation}`;
      const del=document.createElement('button');
      del.type='button'; del.className='gloss-del'; del.textContent='حذف';
      del.addEventListener('click',async()=>{
        const {subify_settings={}}=await browser.storage.local.get('subify_settings');
        const next=(Array.isArray(subify_settings.glossary)?subify_settings.glossary:[]).filter((_,idx)=>idx!==i);
        await browser.storage.local.set({subify_settings:{...subify_settings,glossary:next}});
        renderGlossary(next);
        const tab=await activeTab();
        if(tab?.id)try{await browser.tabs.sendMessage(tab.id,{type:'subify-target-language-changed'});}catch(_){}
      });
      row.appendChild(text); row.appendChild(del);
      wrap.appendChild(row);
    });
  }
  $('glossary-add')?.addEventListener('click',async()=>{
    const termEl=$('glossary-term'), trEl=$('glossary-translation');
    const term=(termEl?.value||'').trim(), translation=(trEl?.value||'').trim();
    if(!term||!translation) return;
    const {subify_settings={}}=await browser.storage.local.get('subify_settings');
    const next=[...(Array.isArray(subify_settings.glossary)?subify_settings.glossary:[]),{term,translation}];
    await browser.storage.local.set({subify_settings:{...subify_settings,glossary:next}});
    renderGlossary(next);
    if(termEl) termEl.value=''; if(trEl) trEl.value='';
    const tab=await activeTab();
    if(tab?.id)try{await browser.tabs.sendMessage(tab.id,{type:'subify-target-language-changed'});}catch(_){}
  });
  $('tab-target-language')?.addEventListener('change',async e=>{
    const {subify_settings={}}=await browser.storage.local.get('subify_settings');
    await browser.storage.local.set({subify_settings:{...subify_settings,targetLanguage:e.target.value}});syncMainLang();
    {const {subify_learning={}}=await browser.storage.local.get('subify_learning');await browser.storage.local.set({subify_learning:{...subify_learning,nativeLang:e.target.value,explainLang:e.target.value}});}
    const tab=await activeTab();
    if(tab?.id)try{await browser.tabs.sendMessage(tab.id,{type:'subify-target-language-changed'});}catch(_){}
  });
  $('popup-provider')?.addEventListener('change',async e=>{const {pd_settings={}}=await browser.storage.local.get('pd_settings');const next={...pd_settings,subtitleProvider:e.target.value};await browser.storage.local.set({pd_settings:next});if(e.target.value==='custom') await loadCustomProviders();updateProviderUi(e.target.value,next);});
  $('popup-provider-model')?.addEventListener('change',async e=>{const {pd_settings={}}=await browser.storage.local.get('pd_settings');const provider=e.target.dataset.provider||$('popup-provider').value;const value=e.target.value.trim();const patch=provider==='openrouter'?{openRouterModel:value||'openrouter/free'}:provider==='openai'?{openaiModel:value||'gpt-5.6-luna'}:{sttModel:value||'gemini-3.5-flash',geminiSubtitleModel:value||'gemini-3.5-flash'};await browser.storage.local.set({pd_settings:{...pd_settings,...patch}});});
  $('popup-gemini-models')?.addEventListener('change',async e=>{const {pd_settings={}}=await browser.storage.local.get('pd_settings');const value=e.target.value;await browser.storage.local.set({pd_settings:{...pd_settings,sttModel:value,geminiSubtitleModel:value}});});
  $('popup-gemini-model-manual')?.addEventListener('change',async e=>{const value=e.target.value.trim();if(!value)return;const {pd_settings={}}=await browser.storage.local.get('pd_settings');await browser.storage.local.set({pd_settings:{...pd_settings,sttModel:value,geminiSubtitleModel:value}});});

  async function loadCustomProviders(){
    const {pd_settings={}}=await browser.storage.local.get('pd_settings');
    const list=Array.isArray(pd_settings.customProviders)?pd_settings.customProviders:[];
    const sel=$('custom-provider-list'); if(!sel)return;
    sel.replaceChildren();
    if(!list.length){const o=document.createElement('option');o.value='';o.textContent=document.documentElement.lang==='en'?'No service has been added yet.':'هنوز هیچ سرویسی اضافه نشده است.';sel.appendChild(o);if($('custom-provider-status'))$('custom-provider-status').textContent=document.documentElement.lang==='en'?'Use the button below to add a custom service.':'از دکمهٔ زیر یه سرویس سفارشی اضافه کن.';return;}
    list.forEach((p,i)=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name||`سرویس ${i+1}`;sel.appendChild(o);});
    sel.value=pd_settings.customProviderId||list[0].id;
    fillCustomProvider(sel.value,list);
  }
  function fillCustomProvider(id,list){
    const p=(list||[]).find(x=>x.id===id); if(!p)return;
    if($('custom-provider-status'))$('custom-provider-status').textContent=document.documentElement.lang==='en'?`Active service: ${p.name||'Custom API'}`:`سرویس فعال: ${p.name||'Custom API'}`;
  }
  $('custom-provider-list')?.addEventListener('change',async e=>{const {pd_settings={}}=await browser.storage.local.get('pd_settings');const list=Array.isArray(pd_settings.customProviders)?pd_settings.customProviders:[];await browser.storage.local.set({pd_settings:{...pd_settings,customProviderId:e.target.value}});fillCustomProvider(e.target.value,list);});
  // Adding/editing a Custom Provider needs a permission prompt (see options.js),
  // and MV3 action popups close the instant that prompt steals focus, killing
  // whatever the user just typed. Options is a normal tab, so it doesn't have
  // that problem. That management UI lives there now; this popup only picks
  // among providers that are already saved.
  $('manage-custom-providers')?.addEventListener('click',()=>{browser.tabs.create({url:browser.runtime.getURL('options.html')+'#custom-providers'});});
  // Services board: read-only status of each provider on this device. Keys are typed in the panel.
  const SVC_LAST_NAMES={gemini:'Gemini',openrouter:'OpenRouter',openai:'OpenAI',custom:'سرویس اختصاصی'};
  function svcTime(t){try{return new Date(t).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});}catch(_){return '';}}
  function setSvc(id,text,cls){const el=$(id);if(!el)return;el.textContent=text;if(cls!==undefined){el.className=cls;}}
  async function loadPopupServices(){
    const [{pd_settings={}},{subify_provider_status:last={}}]=await Promise.all([
      browser.storage.local.get('pd_settings'),
      browser.storage.local.get('subify_provider_status')
    ]);
    const customs=Array.isArray(pd_settings.customProviders)?pd_settings.customProviders:[];
    const activeCustom=customs.find(p=>p.id===pd_settings.customProviderId)||customs[0]||null;
    const seen=(svc)=>last.provider===svc&&last.at?` · آخرین استفاده ${svcTime(last.at)}`:'';
    const ready=(has)=>has?'svc-state is-ready':'svc-state';
    const rows=[
      ['gemini', Boolean(pd_settings.apiKey), (pd_settings.geminiSubtitleModel||pd_settings.geminiModel||pd_settings.sttModel||'gemini-3.5-flash')],
      ['openrouter', Boolean(pd_settings.openRouterKey), (pd_settings.openRouterModel||'openrouter/free')],
      ['openai', Boolean(pd_settings.openaiKey), (pd_settings.openaiModel||'gpt-5.6-luna')]
    ];
    rows.forEach(([svc,has,model])=>{
      const name=SVC_LAST_NAMES[svc];
      setSvc(`svc${svc[0].toUpperCase()+svc.slice(1)}Sub`, has?`کلید ثبت شده · مدل ${model}${seen(svc)}`:'کلید ثبت نشده؛ از پنل مدیریت وارد کن');
      setSvc(`svc${svc[0].toUpperCase()+svc.slice(1)}State`, has?'آماده':'نیاز به کلید', ready(has));
    });
    const customHas=Boolean(activeCustom?.apiKey);
    setSvc('svcCustomSub', activeCustom?`${activeCustom.name||'Custom API'} · مدل ${activeCustom.model||'…'}${seen('custom')}`:'هنوز سرویسی اضافه نشده');
    setSvc('svcCustomState', activeCustom?(customHas?'آماده':'نیاز به کلید'):'خالی', ready(customHas));
    const hint=$('svcNote');
    if(hint)hint.textContent=(pd_settings.subtitleProvider&&pd_settings.subtitleProvider!=='auto')
      ?`موتور ترجمه روی ${SVC_LAST_NAMES[pd_settings.subtitleProvider]||pd_settings.subtitleProvider} قفل است؛ برای حالت خودکار از تب «ترجمه» استفاده کن.`
      :'در حالت «خودکار»، سرویس‌های آماده به ترتیب OpenRouter، OpenAI و Gemini امتحان می‌شن.';
  }
  $('svcOpenPanel')?.addEventListener('click',()=>{browser.tabs.create({url:browser.runtime.getURL('options.html')+'#api-keys'});});
})();

// ---------- theme (dark/light) ----------

// ---------- first-run onboarding ----------
(function initOnboarding(){
  const KEY='subify_onboarded';
  const overlay=document.getElementById('onboarding');
  const steps=[...document.querySelectorAll('.ob-step')];
  const dotsEl=document.getElementById('obDots');
  if(!overlay||!steps.length||!dotsEl)return;
  let idx=0;
  steps.forEach((_,i)=>{const dot=document.createElement('span');dot.className='ob-dot'+(i===0?' active':'');dotsEl.appendChild(dot);});
  const dots=[...dotsEl.children];
  function render(){
    steps.forEach((s,i)=>s.classList.toggle('active',i===idx));
    dots.forEach((d,i)=>d.classList.toggle('active',i===idx));
    const next=document.getElementById('obNext');
    if(next)next.textContent=idx===steps.length-1?(document.documentElement.lang==='en'?'Start':'شروع کن'):(document.documentElement.lang==='en'?'Next':'بعدی');
  }
  function finish(){if(overlay.contains(document.activeElement))document.activeElement.blur();overlay.classList.remove('show');overlay.setAttribute('aria-hidden','true');browser.storage.local.set({[KEY]:true});}
  document.getElementById('obNext')?.addEventListener('click',()=>{
    if(idx===steps.length-1){finish();return;}
    idx++;render();
  });
  document.getElementById('obSkip')?.addEventListener('click',finish);
  browser.storage.local.get(KEY).then((r)=>{
    if(!r[KEY]){overlay.removeAttribute('aria-hidden');overlay.classList.add('show');render();}
  });
})();


// ---------- popup language: shared switcher in ui-language.js ----------
window.SubifyUI?.register({ en: {
    'مرکز کنترل':'Control','ترجمه':'Translate','استایل':'Style','کلیدها':'API Keys',
    'شروع ترجمه':'Start translation','برای شروع ترجمه، همین دکمه رو بزن':'Press to start translation',
    'زیرنویس':'Subtitles','دوبلهٔ':'Dubbing','فارسی':'Persian',
    'استخراج مستقیم از Caption خود YouTube با تایم‌استامپ واقعی':'Directly reads real YouTube captions with timestamps',
    'استخراج مستقیم Caption یوتیوب با تایم‌کد واقعی':'Directly reads YouTube captions with real timecodes',
    'صدای مقصد با حفظ زمان‌بندی و صدای اصلی در پس‌زمینه':'Target-language audio with original audio in the background',
    'وقتی دوبله روشنه:':'When dubbing is on:','🔊 صدای دوبله رو هم پخش کن':'🔊 Play dubbed audio too','📝 فقط زیرنویس زنده، بدون صدا':'📝 Live captions only, no audio',
    'ترجمهٔ کامل صفحه':'Translate full page','متن‌های قابل‌مشاهدهٔ همین صفحه را ترجمه می‌کند.':'Translates the visible text on this page.',
    'زبان مقصد':'Target language','فونت صفحه':'Page font','ترجمه صفحه':'Translate page','بازگردانی':'Restore page',
    'برای ترجمه، زبان و فونت را انتخاب کن.':'Choose a language and font to translate this page.',
    'تنظیمات پیشرفته':'Advanced settings','گزارش فنی':'Diagnostics','نمایش خط اصلی':'Show original line',
    'متن اصلی بالای ترجمه نمایش داده شود':'Show the original above the translation','هایلایت کلمه‌به‌کلمه':'Word-by-word highlight',
    'نمایش حالت کارائوکه هنگام پخش زیرنویس':'Show karaoke highlighting while subtitles play','موتور ترجمه':'Translation engine',
    'برای همین ویدیو':'For this video','خودکار':'Auto','سرویس سفارشی':'Custom service',
    'در حالت خودکار، سرویس دارای کلید معتبر انتخاب می‌شود.':'Auto selects a provider with a valid key.',
    'زبان مبدا':'Source language','زبان ترجمه':'Translation language','لحن ترجمه':'Translation tone',
    'همیشه رسمی':'Always formal','همیشه محاوره‌ای/دوستانه':'Always casual/friendly','آکادمیک (ارائه به استاد)':'Academic',
    '📜 نمایش/پنهان‌کردن پنل ترنسکریپت':'📜 Show/hide transcript panel','خروجی و دانلود':'Export & download',
    'تنظیمات کامل':'Full settings','ذخیره کلیدها':'Save keys','بررسی اتصال':'Connection test',
    'تست Gemini':'Test Gemini','تست OpenRouter':'Test OpenRouter','تست OpenAI':'Test OpenAI',
    'پیش‌نمایش بالا با هر تغییر رنگ، فونت، اندازه، موقعیت و جلوه فوراً به‌روزرسانی می‌شود.':'The preview updates instantly with every style change.',
    'پریست‌های آماده':'Presets','تایپوگرافی':'Typography','فونت':'Font','فونت انگلیسی':'English font','نمایش':'Display','اندازه':'Size','عرض متن':'Text width',
    'موقعیت':'Position','رنگ و شفافیت':'Color & opacity','جلوه‌های بیشتر':'More effects','بازنشانی استایل':'Reset style','ذخیره استایل':'Save style',
    'محلی و امن':'Local & secure','سرویس‌های دیگر':'Other services','API اختصاصی داری؟':'Have a custom API?',
    'ذخیره کن':'Save it','ساخته‌شده توسط Mobin Bibak ↗':'Made by Mobin Bibak ↗',
    'هنوز هیچ کلید یا سرویس ترجمه‌ای تنظیم نشده است.':'No translation key or service has been configured yet.','زیرنویس فعال است':'Subtitles are on','API اختصاصی':'Custom API','هنوز هیچ سرویسی اضافه نشده است':'No service has been added yet.',
    'فقط ترجمه':'Translation only','ترجمه+اصلی':'Translation + original','ترجمه + اصلی':'Translation + original','اصلی + ترجمه':'Original + translation','فقط اصلی':'Original only',
    'خودکار (لحن خود گوینده)':'Auto (speaker tone)','مثلا سرویس من':'e.g. My service','مثلاً سرویس من':'e.g. My service','کلید سرویس':'Service key','مثلاً...':'e.g. ...','فونت انگلیسی':'English font'
} });
// Onboarding language picker: same menu and keys as the header (ui-language.js); opens upward because the card sits at the bottom.
(function initOnboardingLanguage(){
  const UI=window.SubifyUI, btn=document.getElementById('obLanguage'), menu=document.getElementById('obLangMenu'), wrap=btn?.closest('.ob-lang');
  if(!UI||!btn||!menu||!wrap)return;
  const ICON_CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
  const isOpen=()=>wrap.dataset.open==='true';
  const items=()=>[...menu.querySelectorAll('[role="menuitemradio"]')];
  function paint(lang){
    btn.querySelector('.lang-trigger-name').textContent=UI.NAMES[lang]||lang;
    items().forEach(b=>b.setAttribute('aria-checked',String(b.dataset.lang===lang)));
  }
  UI.LANGS.forEach(code=>{
    const b=document.createElement('button');
    b.type='button'; b.className='lang-opt'; b.setAttribute('role','menuitemradio'); b.dataset.lang=code;
    b.innerHTML='<span class="lang-opt-name"></span><span class="lang-opt-code" dir="ltr"></span><span class="lang-opt-tick" aria-hidden="true">'+ICON_CHECK+'</span>';
    b.querySelector('.lang-opt-name').textContent=UI.NAMES[code]||code;
    b.querySelector('.lang-opt-code').textContent=code.toUpperCase();
    menu.appendChild(b);
  });
  function setOpen(open,moveFocus){
    wrap.dataset.open=String(open); btn.setAttribute('aria-expanded',String(open));
    if(open){ paint(UI.lang); setTimeout(()=>{ (menu.querySelector('[aria-checked="true"]')||items()[0])?.focus(); },0); }
    else if(moveFocus) btn.focus();
  }
  btn.addEventListener('click',()=>setOpen(!isOpen(),true));
  menu.addEventListener('click',e=>{
    const o=e.target.closest('.lang-opt'); if(!o) return;
    setOpen(false,true); UI.set(o.dataset.lang);
  });
  wrap.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&isOpen()){ e.preventDefault(); setOpen(false,true); return; }
    if(document.activeElement===btn&&(e.key==='ArrowDown'||e.key==='ArrowUp')){ e.preventDefault(); setOpen(true,true); return; }
    if(!isOpen()) return;
    const list=items(), i=list.indexOf(document.activeElement); if(i<0) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); list[(i+1)%list.length].focus(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); list[(i-1+list.length)%list.length].focus(); }
    else if(e.key==='Home'){ e.preventDefault(); list[0].focus(); }
    else if(e.key==='End'){ e.preventDefault(); list[list.length-1].focus(); }
    else if(e.key==='Tab'){ setOpen(false,false); }
  });
  document.addEventListener('pointerdown',e=>{ if(isOpen()&&!wrap.contains(e.target)) setOpen(false,false); });
  document.addEventListener('subify-ui-language',e=>paint(String(e.detail?.lang||UI.lang||'fa')));
  paint(UI.lang);
})();


// ---------- full-page translation ----------
(function initPageTranslation(){
  const $p=id=>document.getElementById(id);
  async function injectTranslator(tabId){
    if(!browser.scripting?.executeScript) throw new Error('Page translation injection is unavailable in this browser');
    await browser.scripting.executeScript({target:{tabId},files:['page-translate-core.js','page-translator.js']});
  }
  async function getPageTranslatorTab(){
    const tab=await activeTab();
    if(!tab?.id) throw new Error('No active tab');
    if(/^((chrome|edge|about|moz-extension|chrome-extension):|file:)/i.test(String(tab.url||''))) throw new Error('This page cannot be translated');
    return tab;
  }
  $p('translatePageBtn')?.addEventListener('click',async()=>{
    const status=$p('pageTranslateStatus'), lang=$p('pageTranslateLanguage')?.value||'fa', font=$p('pageTranslateFont')?.value||'Vazirmatn';
    if(status){status.dataset.runtime='1';status.textContent=document.documentElement.lang==='en'?'Translating page…':'در حال ترجمه صفحه…';}
    try{
      const tab=await getPageTranslatorTab();
      await injectTranslator(tab.id);
      const r=await browser.tabs.sendMessage(tab.id,{type:'subify-page-translate-start',targetLanguage:lang,font});
      if(status)status.textContent=r?.ok?(document.documentElement.lang==='en'?`Translated ${r.count||0} text blocks.`:`${r.count||0} بخش متنی ترجمه شد.`):(r?.error||'Translation failed');
    }catch(e){if(status)status.textContent=String(e.message||e);}
  });
  $p('restorePageBtn')?.addEventListener('click',async()=>{
    const status=$p('pageTranslateStatus');
    try{
      const tab=await getPageTranslatorTab();
      await injectTranslator(tab.id);
      await browser.tabs.sendMessage(tab.id,{type:'subify-page-translate-restore'});
      if(status)status.textContent=document.documentElement.lang==='en'?'Page restored.':'صفحه بازگردانی شد.';
    }catch(e){if(status)status.textContent=String(e.message||e);}
  });
  // "Translate every page": the switch saves the choice. Each finished page load then runs the translator (background.js).
  const ALL_SITES=['https://*/*','http://*/*'];
  const autoBox=$p('pageTranslateAll');
  const uiText=s=>(window.SubifyUI?window.SubifyUI.t(s):s);
  const saySt=text=>{const s=$p('pageTranslateStatus');if(s){s.dataset.runtime='1';s.textContent=text;}};
  async function readAuto(){const {subify_settings={}}=await browser.storage.local.get('subify_settings');const a=subify_settings.pageAutoTranslate||{};return {enabled:a.enabled===true};}
  async function saveAuto(patch){const {subify_settings={}}=await browser.storage.local.get('subify_settings');const cur=subify_settings.pageAutoTranslate||{};await browser.storage.local.set({subify_settings:{...subify_settings,pageAutoTranslate:{...cur,...patch}}});}
  async function allSitesAllowed(){try{if(await browser.permissions.contains({origins:ALL_SITES}))return true;return !!(await browser.permissions.request({origins:ALL_SITES}));}catch(_){return false;}}
  async function restoreOpenPages(){const tabs=await browser.tabs.query({});await Promise.all(tabs.filter(t=>t.id&&/^https?:/i.test(t.url||'')).map(t=>browser.tabs.sendMessage(t.id,{type:'subify-page-translate-restore'}).catch(()=>{})));}
  if(autoBox)readAuto().then(a=>{autoBox.checked=a.enabled;}).catch(()=>{});
  autoBox?.addEventListener('change',async()=>{
    if(autoBox.checked){
      if(!(await allSitesAllowed())){autoBox.checked=false;saySt(uiText('بدون اجازهٔ دسترسی به همهٔ سایت‌ها، ترجمهٔ خودکار روشن نمی‌شه.'));return;}
      await saveAuto({enabled:true,lang:$p('pageTranslateLanguage')?.value||'fa',font:$p('pageTranslateFont')?.value||'Vazirmatn'});
      saySt(uiText('از این به بعد هر صفحه‌ای که باز می‌کنی، خودکار ترجمه می‌شه.'));
      $p('translatePageBtn')?.click();
    }else{
      await saveAuto({enabled:false});
      saySt(uiText('ترجمهٔ خودکار خاموش شد و صفحه‌های باز بازگردانی شدند.'));
      await restoreOpenPages().catch(()=>{});
    }
  });
  $p('pageTranslateLanguage')?.addEventListener('change',async e=>{if(autoBox?.checked){await saveAuto({lang:e.target.value});$p('translatePageBtn')?.click();}});
  $p('pageTranslateFont')?.addEventListener('change',async e=>{if(autoBox?.checked)await saveAuto({font:e.target.value});});
})();

/* ---- live status: progress ring, provider chip, ready-from-cache ---- */
(function subifyLiveStatus(){
  const toggle=document.getElementById('toggle');
  const ring=document.getElementById('progressRing');
  const fill=document.getElementById('progressFill');
  const pct=document.getElementById('progressPct');
  const chip=document.getElementById('providerChip');
  const label=document.getElementById('stateLabel');
  if(!toggle||!ring||!fill||!pct||!chip||!label) return;
  const FA_DIGITS='۰۱۲۳۴۵۶۷۸۹';
  const toFa=n=>String(n).replace(/\d/g,d=>FA_DIGITS[d]);
  const NAMES={gemini:'Gemini',openrouter:'OpenRouter',openai:'OpenAI',custom:'Custom API'};
  const OFF_TEXT='آماده';
  const CACHE_TEXT='آماده از کش؛ همین دکمه رو بزن';
  let cacheVideo='', cacheHit=false;

  const videoIdOf=url=>{
    try{const u=new URL(url);return /(^|\.)youtube\.com$/.test(u.hostname)?(u.searchParams.get('v')||''):'';}
    catch(_){return '';}
  };

  async function checkCache(videoId){
    if(!videoId){cacheVideo='';cacheHit=false;return;}
    if(cacheVideo===videoId) return;
    cacheVideo=videoId; cacheHit=false;
    try{
      const {subify_settings={}}=await browser.storage.local.get('subify_settings');
      const res=await browser.runtime.sendMessage({type:'subify-cache-status',videoId,targetLanguage:String(subify_settings.targetLanguage||'fa').toLowerCase()});
      cacheHit=!!(res&&res.ok&&res.rows>0);
    }catch(_){cacheHit=false;}
  }

  function renderChip(status){
    if(!status||!status.provider){chip.hidden=true;return;}
    chip.dataset.provider=status.provider;
    chip.textContent=(NAMES[status.provider]||status.provider)+(status.from?' · جایگزین '+(NAMES[status.from]||status.from):'');
    chip.hidden=false;
  }

  async function tick(){
    try{
      const [tab]=await browser.tabs.query({active:true,currentWindow:true});
      const videoId=videoIdOf(tab?.url||'');
      const {subify_provider_status=null}=await browser.storage.local.get('subify_provider_status');
      renderChip(subify_provider_status);
      let total=0,done=0;
      if(videoId&&tab?.id){
        try{const p=await browser.tabs.sendMessage(tab.id,{type:'subify-popup-progress'});total=Number(p?.total)||0;done=Number(p?.done)||0;}catch(_){}
      }
      const on=toggle.classList.contains('on');
      if(on&&total>0&&done<total){
        const p=Math.min(100,Math.round(done/total*100));
        fill.style.strokeDashoffset=String(100-p);
        pct.textContent=toFa(p)+'٪';
        toggle.classList.add('busy');
        ring.classList.add('show');
      }else{
        toggle.classList.remove('busy');
        ring.classList.toggle('show',on&&total>0);
        if(on&&total>0) fill.style.strokeDashoffset='0';
      }
      if(!on){
        await checkCache(videoId);
        if(cacheHit){ if(label.textContent!==CACHE_TEXT) label.textContent=CACHE_TEXT; }
        else if(label.textContent===CACHE_TEXT) label.textContent=OFF_TEXT;
      }
    }catch(_){}
  }

  tick();
  setInterval(tick,1000);
  browser.storage.onChanged.addListener(()=>{tick();});
})();
