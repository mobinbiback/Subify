

function normalizePopupText(value){
  return String(value ?? '').replace(/\\r\\n/g,'\n').replace(/\\n/g,'\n').replace(/\\r/g,'\n');
}
const $ = id => document.getElementById(id);
let currentState = {active:false};

function renderState(s){
  currentState=s||{active:false};
  browser.storage.local.get(["subify_subtitle_enabled","subify_dubbing_enabled"]).then(flags=>{
    const subtitleOn=flags.subify_subtitle_enabled!==false;
    $("toggle").classList.toggle("on",subtitleOn);
    $("stateLabel").textContent=subtitleOn?"زیرنویس فارسی فعال است":"آماده";
    $("stateLabel").classList.toggle("on",subtitleOn);
  });
  const err=currentState.error;
  $("status").innerHTML=err?`<span class="error">${escapeHtml(err)}</span>`:
    `<strong>وضعیت:</strong> زیرنویس از تایم‌کدهای واقعی YouTube خوانده می‌شود • دوبله مستقل است`;
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
    $("today").textContent=normalizePopupText(r?.error||"فعال‌سازی دوبله ناموفق بود");
    return;
  }
  await browser.storage.local.set({subify_dubbing_enabled:Boolean(on)});
  if(el)el.checked=Boolean(on);
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

$("subify-popup-dubbing").addEventListener("change",e=>setDubbing(e.target.checked));
$("subify-popup-subtitle").addEventListener("change",async e=>{
  const on=e.target.checked;
  await browser.storage.local.set({subify_subtitle_enabled:on});
  const tab=await activeTab();
  if(tab?.id)try{await browser.tabs.sendMessage(tab.id,{type:on?"subify-enable-subtitles":"subify-disable-subtitles"});}catch(_){}
  renderState(currentState);
});
$("popup-source-language").addEventListener("change",async e=>{
  const {subify_settings={}}=await browser.storage.local.get("subify_settings");
  await browser.storage.local.set({subify_settings:{...subify_settings,sourceLanguage:e.target.value}});
  const tab=await activeTab();
  if(tab?.id)try{await browser.tabs.sendMessage(tab.id,{type:"subify-refresh-captions"});}catch(_){}
});

$("openDash").addEventListener("click",()=>browser.runtime.openOptionsPage());
$("diagBtn").addEventListener("click",()=>$("log").classList.toggle("show"));

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
  if(!cues.length){$('today').textContent=normalizePopupText('هنوز زیرنویسی ثبت نشده');return;}
  const rows=cues.filter(c=>String(which==='fa'?(c.fa||c.text||''):(c.text||'')).trim());
  if(!rows.length){$('today').textContent=normalizePopupText(which==='fa'?'هنوز ترجمه فارسی آماده نشده':'زیرنویس اصلی در دسترس نیست');return;}
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
  if(!r?.ok) $('today').textContent=normalizePopupText('خروجی صوتی هنوز آماده نیست');
}
$('dlOrigAudio').addEventListener('click',()=>exportAudio('original','subify-original'));
$('dlDubAudio').addEventListener('click',()=>exportAudio('dub','subify-dub'));

browser.runtime.onMessage.addListener(msg=>{
  if(msg.type==="status")renderState(msg.state);
  if(msg.type==="log-updated")refreshLog();
  if(msg.type==="subify-subtitles-auto-enabled" && $('subify-tab-subtitle')) $('subify-tab-subtitle').checked=true;
  if(msg.type==="export-fallback" && msg.url){
    fetch(msg.url).then(r=>r.blob()).then(blob=>{
      const u=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=u; a.download=msg.filename||'subify-export.wav'; a.click();
      setTimeout(()=>URL.revokeObjectURL(u),60000);
    }).catch(()=>{});
  }
});
async function refreshLog(){const {pd_log=[]}=await browser.storage.session.get("pd_log");$("log").innerHTML=pd_log.slice(-30).map(e=>`<div>${escapeHtml(new Date(e.t).toLocaleTimeString('fa-IR'))} ${escapeHtml(e.msg)}</div>`).join('');}
async function init(){
  const [st,flags]=await Promise.all([browser.runtime.sendMessage({type:"popup-get-status"}),browser.storage.local.get(["subify_subtitle_enabled","subify_dubbing_enabled"])]);
  $("subify-popup-subtitle").checked=flags.subify_subtitle_enabled!==false;
  $("subify-popup-dubbing").checked=flags.subify_dubbing_enabled===true;
  const {subify_settings={}}=await browser.storage.local.get("subify_settings");
  $("popup-source-language").value=subify_settings.sourceLanguage||"auto";
  if(st?.state)renderState(st.state); else renderState({active:false});
  const settings=await browser.storage.local.get("subify_settings");
  const hasProvider=Boolean(settings.subify_settings?.apiKey||settings.subify_settings?.openRouterKey||settings.subify_settings?.openaiKey||settings.subify_settings?.customProviders?.length);
  if(!hasProvider) $("status").innerHTML=`<span class="error">هنوز هیچ کلید یا سرویس ترجمه‌ای تنظیم نشده است.</span>`;
  await refreshLog();
}
init();

$("openLearn")?.addEventListener("click",()=>browser.tabs.create({url:browser.runtime.getURL("learn.html")}));
$("openStoryboard")?.addEventListener("click",()=>browser.tabs.create({url:browser.runtime.getURL("storyboard.html")}));
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
    if(name==='keys') loadPopupKeys();
  }));
  $('openFullSettings')?.addEventListener('click',()=>browser.runtime.openOptionsPage());
  $('openStyleFull')?.addEventListener('click',()=>browser.runtime.openOptionsPage());

  const presets={
    classic:{bgColor:'#080A0E',textColor:'#ffffff',highlightColor:'#FFB35C',borderRadius:7,padding:8,outlineWidth:0,shadowBlur:6,customWeight:600,positionMode:'bottom',maxWidth:86},
    youtube:{bgColor:'#000000',textColor:'#ffffff',highlightColor:'#FFB35C',borderRadius:2,padding:7,outlineWidth:0,shadowBlur:5,customWeight:600,positionMode:'bottom',maxWidth:84},
    tiktok:{bgColor:'#000000',textColor:'#ffffff',highlightColor:'#ffffff',borderRadius:8,padding:8,outlineWidth:3,shadowBlur:8,customWeight:800,positionMode:'middle',maxWidth:88},
    pill:{bgColor:'#FFFFFF',textColor:'#111111',highlightColor:'#B66A00',borderRadius:999,padding:9,outlineWidth:0,shadowBlur:5,customWeight:700,positionMode:'bottom',maxWidth:86},
    snapchat:{bgColor:'#000000',textColor:'#ffffff',highlightColor:'#FFB35C',borderRadius:2,padding:8,outlineWidth:0,shadowBlur:3,customWeight:600,positionMode:'bottom',maxWidth:96},
    cinema:{bgColor:'#000000',textColor:'#F7F4EE',highlightColor:'#FFB35C',borderRadius:0,padding:6,outlineWidth:0,shadowBlur:14,customWeight:500,positionMode:'bottom',maxWidth:82},
    minimal:{bgColor:'#000000',textColor:'#ffffff',highlightColor:'#FFB35C',borderRadius:2,padding:5,outlineWidth:1,shadowBlur:4,customWeight:600,positionMode:'bottom',maxWidth:82}
  };
  const ids=['font','display','fontSize','maxWidth','positionMode','positionY','bgOpacity','radius','textColor','bgColor','highlightColor','outlineWidth','shadowBlur'];
  const val=(id)=>$('style-'+id);
  function setStyleForm(s){
    const d={font:'Lalezar',displayMode:'translation',fontSize:30,maxWidth:86,positionMode:'bottom',positionY:82,bgOpacity:.78,borderRadius:999,textColor:'#111111',bgColor:'#FFFFFF',highlightColor:'#B66A00',outlineWidth:0,shadowBlur:5,preset:'pill',...s};
    val('font').value=d.font; val('display').value=d.displayMode; val('fontSize').value=d.fontSize; val('maxWidth').value=d.maxWidth; val('positionMode').value=d.positionMode; val('positionY').value=d.positionY; val('bgOpacity').value=d.bgOpacity; val('radius').value=d.borderRadius; val('textColor').value=d.textColor; val('bgColor').value=d.bgColor; val('highlightColor').value=d.highlightColor; val('outlineWidth').value=d.outlineWidth; val('shadowBlur').value=d.shadowBlur;
    ['fontSize','maxWidth','positionY','bgOpacity','radius','outlineWidth','shadowBlur'].forEach(id=>{const x=val(id), out=$('style-'+id+'Val');if(!x||!out)return;out.textContent=id==='bgOpacity'?Number(x.value).toFixed(2):x.value});
    document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===d.preset)); renderStylePreview(d);
  }
  function renderStylePreview(s){
    const box=$('styleLivePreview'), orig=$('stylePreviewOrig'), fa=$('stylePreviewFa'); if(!box||!orig||!fa)return;
    const alpha=Math.max(.15,Math.min(.95,Number(s.bgOpacity)||.78));
    const bg=s.bgColor||'#080A0E';
    box.style.background=`linear-gradient(145deg,${bg}22,#0c1016)`;
    const cap=box.querySelector('.style-preview-caption')||box;
    cap.style.color=s.textColor||'#fff'; cap.style.background=rgba(s.bgColor||'#000000',alpha);
    cap.style.borderRadius=`${Number(s.borderRadius??7)}px`; cap.style.padding=`${Math.max(3,Number(s.padding||8)/2)}px ${Math.max(8,Number(s.padding||8))}px`;
    cap.style.maxWidth=`${Number(s.maxWidth||86)}%`; cap.style.boxShadow=Number(s.shadowBlur)?`0 3px ${Number(s.shadowBlur)}px rgba(0,0,0,.45)`:'none';
    cap.style.webkitTextStroke=Number(s.outlineWidth)?`${Number(s.outlineWidth)}px #000`:'0 transparent';
    orig.style.display=s.displayMode==='translation'?'none':'block'; fa.style.display=s.displayMode==='original'?'none':'block';
    orig.style.color=s.textColor||'#fff'; fa.style.color=s.textColor||'#fff'; fa.style.fontSize=`${Math.max(14,Number(s.fontSize)*.62)}px`; fa.style.lineHeight='1.35';
    const stage=box.querySelector('.style-preview-stage');
    if(stage){const mode=s.positionMode||'bottom';stage.style.alignItems=mode==='top'?'flex-start':mode==='middle'?'center':'flex-end';stage.style.paddingBottom=mode==='bottom'?`${Math.max(4,Number(s.positionY??82)/6)}px`:'0';}
  }
  function rgba(hex,a){const m=String(hex||'#000').match(/^#?([0-9a-f]{6})$/i);if(!m)return `rgba(0,0,0,${a})`;const n=m[1];return `rgba(${parseInt(n.slice(0,2),16)},${parseInt(n.slice(2,4),16)},${parseInt(n.slice(4,6),16)},${a})`;}
  function readStyle(){return {font:val('font').value,displayMode:val('display').value,fontSize:+val('fontSize').value,maxWidth:+val('maxWidth').value,positionMode:val('positionMode').value,positionY:+val('positionY').value,bgOpacity:+val('bgOpacity').value,borderRadius:+val('radius').value,textColor:val('textColor').value,bgColor:val('bgColor').value,highlightColor:val('highlightColor').value,outlineWidth:+val('outlineWidth').value,shadowBlur:+val('shadowBlur').value,preset:document.querySelector('[data-preset].active')?.dataset.preset||'pill'};}
  async function loadPopupStyle(){const {subify_settings={}}=await browser.storage.local.get('subify_settings');setStyleForm(subify_settings);}
  async function savePopupStyle(){const {subify_settings={}}=await browser.storage.local.get('subify_settings');await browser.storage.local.set({subify_settings:{...subify_settings,...readStyle()}});$('today').textContent=normalizePopupText('استایل ذخیره شد ✓');try{const tab=await activeTab();if(tab?.id)await browser.tabs.sendMessage(tab.id,{type:'subify-style-updated'});}catch(_){} }
  $('resetStyle')?.addEventListener('click',async()=>{
    const defaults={font:'Lalezar',displayMode:'translation',fontSize:30,maxWidth:86,positionMode:'bottom',positionY:82,bgOpacity:.78,borderRadius:999,textColor:'#111111',bgColor:'#FFFFFF',highlightColor:'#B66A00',outlineWidth:0,shadowBlur:5,preset:'pill'};
    const {subify_settings={}}=await browser.storage.local.get('subify_settings');
    const next={...subify_settings,...defaults};
    await browser.storage.local.set({subify_settings:next});
    setStyleForm(next);
    try{const tab=await activeTab();if(tab?.id)await browser.tabs.sendMessage(tab.id,{type:'subify-style-updated'});}catch(_){}
    $('today').textContent=normalizePopupText('استایل بازنشانی شد ✓');
  });
  $('saveStyle')?.addEventListener('click',savePopupStyle);
  document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{const {dataset}=b;const current=readStyle();setStyleForm({...current,...presets[dataset.preset],preset:dataset.preset});}));
  ['font','display','fontSize','maxWidth','positionMode','positionY','bgOpacity','radius','textColor','bgColor','highlightColor','outlineWidth','shadowBlur'].forEach(id=>val(id)?.addEventListener('input',()=>renderStylePreview(readStyle())));
  ['font','display','positionMode','textColor','bgColor','highlightColor'].forEach(id=>val(id)?.addEventListener('change',()=>renderStylePreview(readStyle())));

  async function loadPopupTranslate(){
    const {subify_settings={}}=await browser.storage.local.get('subify_settings');
    const {pd_settings={},pd_models={}}=await browser.storage.local.get(['pd_settings','pd_models']);
    pd_settings.discoveredGeminiModels = Array.isArray(pd_models.all) ? pd_models.all.filter(m=>m && m.methods?.includes?.('generateContent')).map(m=>({id:m.id})) : [];
    $('subify-tab-subtitle').checked=(await browser.storage.local.get('subify_subtitle_enabled')).subify_subtitle_enabled!==false;
    $('subify-tab-original').checked=subify_settings.displayMode==='dual';
    $('subify-tab-karaoke').checked=subify_settings.karaokeEnabled!==false;
    $('tab-source-language').value=subify_settings.sourceLanguage||'auto';
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
      const val=pd.geminiSubtitleModel||pd.geminiModel||pd.sttModel||'gemini-3.1-flash-lite';
      select.innerHTML='';
      const models=Array.isArray(pd.discoveredGeminiModels)?pd.discoveredGeminiModels:[];
      const ids=models.map(x=>typeof x==='string'?x:x.id).filter(Boolean);
      const uniq=[...new Set([val,...ids])];
      uniq.forEach(id=>{const o=document.createElement('option');o.value=id;o.textContent=id;select.appendChild(o);});
      select.value=val;
      if(manual) manual.value=val;
    } else {
      input.value=isOR?(pd.openRouterModel||'openrouter/free'):isOAI?(pd.openaiModel||'gpt-5.6-luna'):(pd.sttModel||'gemini-3.1-flash-lite');
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
  $('popup-provider')?.addEventListener('change',async e=>{const {pd_settings={}}=await browser.storage.local.get('pd_settings');const next={...pd_settings,subtitleProvider:e.target.value};await browser.storage.local.set({pd_settings:next});if(e.target.value==='custom') await loadCustomProviders();updateProviderUi(e.target.value,next);});
  $('popup-provider-model')?.addEventListener('change',async e=>{const {pd_settings={}}=await browser.storage.local.get('pd_settings');const provider=e.target.dataset.provider||$('popup-provider').value;const value=e.target.value.trim();const patch=provider==='openrouter'?{openRouterModel:value||'openrouter/free'}:provider==='openai'?{openaiModel:value||'gpt-5.6-luna'}:{sttModel:value||'gemini-3.1-flash-lite',geminiSubtitleModel:value||'gemini-3.1-flash-lite'};await browser.storage.local.set({pd_settings:{...pd_settings,...patch}});});
  $('popup-gemini-models')?.addEventListener('change',async e=>{const {pd_settings={}}=await browser.storage.local.get('pd_settings');const value=e.target.value;await browser.storage.local.set({pd_settings:{...pd_settings,sttModel:value,geminiSubtitleModel:value}});});
  $('popup-gemini-model-manual')?.addEventListener('change',async e=>{const value=e.target.value.trim();if(!value)return;const {pd_settings={}}=await browser.storage.local.get('pd_settings');await browser.storage.local.set({pd_settings:{...pd_settings,sttModel:value,geminiSubtitleModel:value}});});

  async function loadCustomProviders(){
    const {pd_settings={}}=await browser.storage.local.get('pd_settings');
    const list=Array.isArray(pd_settings.customProviders)?pd_settings.customProviders:[];
    const sel=$('custom-provider-list'); if(!sel)return;
    sel.innerHTML='';
    if(!list.length){const o=document.createElement('option');o.value='';o.textContent='هنوز سرویسی اضافه نشده';sel.appendChild(o);return;}
    list.forEach((p,i)=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name||`سرویس ${i+1}`;sel.appendChild(o);});
    sel.value=pd_settings.customProviderId||list[0].id;
    fillCustomProvider(sel.value,list);
  }
  function fillCustomProvider(id,list){
    const p=(list||[]).find(x=>x.id===id); if(!p)return;
    $('custom-provider-name').value=p.name||'';$('custom-provider-base').value=p.baseUrl||'';$('custom-provider-key').value=p.apiKey||'';$('custom-provider-model').value=p.model||'';
    if($('custom-provider-status'))$('custom-provider-status').textContent=`سرویس فعال: ${p.name||'Custom API'}`;
  }
  // Custom API base URLs are arbitrary, so the extension no longer holds a
  // blanket host permission for every site. Ask for just that one origin,
  // right here in the click handler so it still counts as a user gesture.
  async function ensureCustomOriginPermission(base){
    let origin;
    try{ origin=new URL(/^https?:\/\//i.test(base)?base:`https://${base}`).origin+'/*'; }
    catch(_){ $('custom-provider-status').textContent='Base URL معتبر نیست.'; return false; }
    try{
      const already=await browser.permissions.contains({origins:[origin]});
      if(already) return true;
      const granted=await browser.permissions.request({origins:[origin]});
      if(!granted) $('custom-provider-status').textContent=`بدون اجازه دسترسی به ${origin} نمی‌توان این سرویس را استفاده کرد.`;
      return granted;
    }catch(e){ $('custom-provider-status').textContent='درخواست دسترسی ناموفق بود: '+(e.message||e); return false; }
  }
  async function saveCustomProvider(){
    const name=$('custom-provider-name').value.trim()||'Custom API'; const base=$('custom-provider-base').value.trim(); const key=$('custom-provider-key').value.trim(); const model=$('custom-provider-model').value.trim();
    if(!base||!key||!model){$('custom-provider-status').textContent='نام سرویس، Base URL، API Key و Model ID الزامی هستند.';return null;}
    if(!(await ensureCustomOriginPermission(base))) return null;
    const {pd_settings={}}=await browser.storage.local.get('pd_settings'); const list=Array.isArray(pd_settings.customProviders)?[...pd_settings.customProviders]:[]; const id=$('custom-provider-list').dataset.newId || $('custom-provider-list').value || `custom_${Date.now()}`; const item={id,name,baseUrl:base,apiKey:key,model}; const idx=list.findIndex(x=>x.id===id); if(idx>=0)list[idx]=item;else list.push(item); const next={...pd_settings,customProviders:list,customProviderId:id,subtitleProvider:'custom'}; await browser.storage.local.set({pd_settings:next}); await loadCustomProviders(); $('custom-provider-list').dataset.newId=''; updateProviderUi('custom',next); $('custom-provider-status').textContent='سرویس ذخیره شد ✓'; return item;
  }
  $('custom-provider-list')?.addEventListener('change',async e=>{const {pd_settings={}}=await browser.storage.local.get('pd_settings');const list=Array.isArray(pd_settings.customProviders)?pd_settings.customProviders:[];await browser.storage.local.set({pd_settings:{...pd_settings,customProviderId:e.target.value}});fillCustomProvider(e.target.value,list);});
  $('custom-save')?.addEventListener('click',saveCustomProvider);
  $('custom-new')?.addEventListener('click',()=>{ $('custom-provider-list').dataset.newId=`custom_${Date.now()}`; $('custom-provider-list').value=''; $('custom-provider-name').value='';$('custom-provider-base').value='';$('custom-provider-key').value='';$('custom-provider-model').value='';$('custom-provider-status').textContent='اطلاعات سرویس جدید را وارد کن.'; });
  $('custom-delete')?.addEventListener('click',async()=>{const id=$('custom-provider-list').value;if(!id)return;const {pd_settings={}}=await browser.storage.local.get('pd_settings');const list=(Array.isArray(pd_settings.customProviders)?pd_settings.customProviders:[]).filter(p=>p.id!==id);const next={...pd_settings,customProviders:list,customProviderId:list[0]?.id||'',subtitleProvider:list.length?'custom':'auto'};await browser.storage.local.set({pd_settings:next});await loadCustomProviders();updateProviderUi(next.subtitleProvider,next);$('custom-provider-status').textContent='سرویس حذف شد.';});
  $('custom-test')?.addEventListener('click',async()=>{await saveCustomProvider();const id=$('custom-provider-list').value;const r=await browser.runtime.sendMessage({type:'subify-test-custom',id}).catch(e=>({ok:false,error:e.message}));$('custom-provider-status').textContent=r?.ok?`اتصال موفق ✓ • ${r.name} • ${r.model}`:(r?.error||'تست ناموفق بود.');});
  $('custom-models')?.addEventListener('click',async()=>{await saveCustomProvider();const id=$('custom-provider-list').value;const r=await browser.runtime.sendMessage({type:'subify-list-custom-models',id}).catch(e=>({ok:false,error:e.message}));const wrap=$('custom-model-list-wrap'),sel=$('custom-model-list');if(!r?.ok){$('custom-provider-status').textContent=r?.error||'دریافت مدل‌ها ناموفق بود.';return;}sel.innerHTML='';r.models.forEach(id=>{const o=document.createElement('option');o.value=id;o.textContent=id;sel.appendChild(o);});wrap.style.display=r.models.length?'block':'none';$('custom-provider-status').textContent=r.models.length?`${r.models.length} مدل پیدا شد.`:'مدلی برگردانده نشد؛ Model ID را دستی وارد کن.';});
  $('custom-model-list')?.addEventListener('change',async e=>{ $('custom-provider-model').value=e.target.value; await saveCustomProvider(); });

  async function loadPopupKeys(){const {pd_settings={}}=await browser.storage.local.get('pd_settings');$('popup-gemini-key').value=pd_settings.apiKey||'';$('popup-openrouter-key').value=pd_settings.openRouterKey||'';$('openaiKey').value=pd_settings.openaiKey||'';$('openaiModel').value=pd_settings.openaiModel||'gpt-5.6-luna';}
  $('saveKeys')?.addEventListener('click',async()=>{const {pd_settings={}}=await browser.storage.local.get('pd_settings');await browser.storage.local.set({pd_settings:{...pd_settings,apiKey:$('popup-gemini-key').value.trim(),openRouterKey:$('popup-openrouter-key').value.trim(),openaiKey:$('openaiKey').value.trim(),openaiModel:$('openaiModel').value.trim()||'gpt-5.6-luna'}});$('keyStatus').textContent='کلیدها ذخیره شدند ✓';});
  $('testGemini')?.addEventListener('click',async()=>{const r=await browser.runtime.sendMessage({type:'subify-test-key'}).catch(e=>({ok:false,error:e.message}));$('keyStatus').textContent=r?.ok?`Gemini متصل است • ${r.model||''}`:(r?.error||'کلید Gemini معتبر نیست یا هنوز تنظیم نشده است.');});
  $('testOpenRouter')?.addEventListener('click',async()=>{const r=await browser.runtime.sendMessage({type:'subify-test-openrouter'}).catch(e=>({ok:false,error:e.message}));$('keyStatus').textContent=r?.ok?`OpenRouter متصل است • ${r.model||''}`:(r?.error||'اتصال OpenRouter ناموفق بود.');});
  $('testOpenAI')?.addEventListener('click',async()=>{const r=await browser.runtime.sendMessage({type:'subify-test-openai'}).catch(e=>({ok:false,error:e.message}));$('keyStatus').textContent=r?.ok?`OpenAI متصل است • ${r.model||''}`:(r?.error||'اتصال OpenAI ناموفق بود.');});
})();
