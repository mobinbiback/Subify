
const __sby_p = (() => {
  const a = [77,111,98,105,110,98,105,98,97,107];
  return Object.freeze({
    id: a.map((n,i) => String.fromCharCode(n ^ 0)).join(''),
    stamp: 'subify-provenance-v2416'
  });
})();

function normalizePopupText(value){
  return String(value ?? '').replace(/\\r\\n/g,'\n').replace(/\\n/g,'\n').replace(/\\r/g,'\n');
}
const $ = id => document.getElementById(id);
let currentState = {active:false};

function renderState(s){
  currentState=s||{active:false};
  chrome.storage.local.get(["subify_subtitle_enabled","subify_dubbing_enabled"]).then(flags=>{
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

async function activeTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return tab;}

async function setDubbing(on){
  const tab=await activeTab();
  if(!tab?.id)return;
  $("subify-popup-dubbing").checked=on;
  await chrome.storage.local.set({subify_dubbing_enabled:on});
  await chrome.runtime.sendMessage({type:"subify-set-dubbing",enabled:on,tabId:tab.id});
}

$("toggle").addEventListener("click",async()=>{
  const tab=await activeTab();
  if(!tab?.id)return;
  const flags=await chrome.storage.local.get("subify_subtitle_enabled");
  const next=flags.subify_subtitle_enabled===false;
  await chrome.storage.local.set({subify_subtitle_enabled:next});
  try{await chrome.tabs.sendMessage(tab.id,{type:next?"subify-enable-subtitles":"subify-disable-subtitles"});}catch(_){}
  await renderState(await chrome.runtime.sendMessage({type:"popup-get-status"}));
});

$("subify-popup-dubbing").addEventListener("change",e=>setDubbing(e.target.checked));
$("subify-popup-subtitle").addEventListener("change",async e=>{
  const on=e.target.checked;
  await chrome.storage.local.set({subify_subtitle_enabled:on});
  const tab=await activeTab();
  if(tab?.id)try{await chrome.tabs.sendMessage(tab.id,{type:on?"subify-enable-subtitles":"subify-disable-subtitles"});}catch(_){}
  renderState(currentState);
});
$("popup-source-language").addEventListener("change",async e=>{
  const {subify_settings={}}=await chrome.storage.local.get("subify_settings");
  await chrome.storage.local.set({subify_settings:{...subify_settings,sourceLanguage:e.target.value}});
  const tab=await activeTab();
  if(tab?.id)try{await chrome.tabs.sendMessage(tab.id,{type:"subify-refresh-captions"});}catch(_){}
});

$("openDash").addEventListener("click",()=>chrome.runtime.openOptionsPage());
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
      const r=await chrome.tabs.sendMessage(tab.id,{type:"subify-refresh-captions"});
      if(r?.ok && Array.isArray(r.cues)) return r.cues
        .filter(c=>Number.isFinite(Number(c.start))&&Number.isFinite(Number(c.end))&&Number(c.end)>Number(c.start))
        .sort((a,b)=>Number(a.start)-Number(b.start));
    }catch(_){}
  }
  const data=await chrome.storage.session.get(["subify_export_cues"]);
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
  a.href=URL.createObjectURL(new Blob(['\\uFEFF'+text],{type:mime+';charset=utf-8'}));
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

async function exportAudio(mode,filename){
  const r=await chrome.runtime.sendMessage({type:'popup-export',mode,filename});
  if(!r?.ok) $('today').textContent=normalizePopupText('خروجی صوتی هنوز آماده نیست');
}
$('dlOrigAudio').addEventListener('click',()=>exportAudio('original',`subify-original-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.wav`));
$('dlDubAudio').addEventListener('click',()=>exportAudio('dub',`subify-dub-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.wav`));

chrome.runtime.onMessage.addListener(msg=>{
  if(msg.type==="status")renderState(msg.state);
  if(msg.type==="log-updated")refreshLog();
  if(msg.type==="export-fallback" && msg.url){
    fetch(msg.url).then(r=>r.blob()).then(blob=>{
      const u=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=u; a.download=msg.filename||'subify-export.wav'; a.click();
      setTimeout(()=>URL.revokeObjectURL(u),60000);
    }).catch(()=>{});
  }
});
async function refreshLog(){const {pd_log=[]}=await chrome.storage.session.get("pd_log");$("log").innerHTML=pd_log.slice(-30).map(e=>`<div>${escapeHtml(new Date(e.t).toLocaleTimeString('fa-IR'))} ${escapeHtml(e.msg)}</div>`).join('');}
async function init(){
  const [st,flags]=await Promise.all([chrome.runtime.sendMessage({type:"popup-get-status"}),chrome.storage.local.get(["subify_subtitle_enabled","subify_dubbing_enabled"])]);
  $("subify-popup-subtitle").checked=flags.subify_subtitle_enabled!==false;
  $("subify-popup-dubbing").checked=flags.subify_dubbing_enabled===true;
  const {subify_settings={}}=await chrome.storage.local.get("subify_settings");
  $("popup-source-language").value=subify_settings.sourceLanguage||"auto";
  if(st?.state)renderState(st.state); else renderState({active:false});
  const key=await chrome.runtime.sendMessage({type:"subify-test-key"}).catch(()=>null);
  if(key?.ok)$("status").innerHTML=`<strong>Gemini:</strong> متصل • مدل ترجمه: ${escapeHtml(key.model)}`;
  else $("status").innerHTML=`<span class="error">کلید Gemini هنوز تأیید نشده است.</span>`;
  await refreshLog();
}
init();

$("openLearn")?.addEventListener("click",()=>chrome.tabs.create({url:chrome.runtime.getURL("learn.html")}));
$("openStoryboard")?.addEventListener("click",()=>chrome.tabs.create({url:chrome.runtime.getURL("storyboard.html")}));
$("captureShot")?.addEventListener("click",async()=>{const tab=await activeTab();if(tab?.id)await chrome.runtime.sendMessage({type:"subify-capture-shot",tabId:tab.id,download:true});});

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
  $('openFullSettings')?.addEventListener('click',()=>chrome.runtime.openOptionsPage());
  $('openStyleFull')?.addEventListener('click',()=>chrome.runtime.openOptionsPage());

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
  async function loadPopupStyle(){const {subify_settings={}}=await chrome.storage.local.get('subify_settings');setStyleForm(subify_settings);}
  async function savePopupStyle(){const {subify_settings={}}=await chrome.storage.local.get('subify_settings');await chrome.storage.local.set({subify_settings:{...subify_settings,...readStyle()}});$('today').textContent=normalizePopupText('استایل ذخیره شد ✓');try{const tab=await activeTab();if(tab?.id)await chrome.tabs.sendMessage(tab.id,{type:'subify-style-updated'});}catch(_){} }
  $('resetStyle')?.addEventListener('click',async()=>{
    const defaults={font:'Lalezar',displayMode:'translation',fontSize:30,maxWidth:86,positionMode:'bottom',positionY:82,bgOpacity:.78,borderRadius:999,textColor:'#111111',bgColor:'#FFFFFF',highlightColor:'#B66A00',outlineWidth:0,shadowBlur:5,preset:'pill'};
    const {subify_settings={}}=await chrome.storage.local.get('subify_settings');
    const next={...subify_settings,...defaults};
    await chrome.storage.local.set({subify_settings:next});
    setStyleForm(next);
    try{const tab=await activeTab();if(tab?.id)await chrome.tabs.sendMessage(tab.id,{type:'subify-style-updated'});}catch(_){}
    $('today').textContent=normalizePopupText('استایل بازنشانی شد ✓');
  });
  $('saveStyle')?.addEventListener('click',savePopupStyle);
  document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{const {dataset}=b;const current=readStyle();setStyleForm({...current,...presets[dataset.preset],preset:dataset.preset});}));
  ['font','display','fontSize','maxWidth','positionMode','positionY','bgOpacity','radius','textColor','bgColor','highlightColor','outlineWidth','shadowBlur'].forEach(id=>val(id)?.addEventListener('input',()=>renderStylePreview(readStyle())));
  ['font','display','positionMode','textColor','bgColor','highlightColor'].forEach(id=>val(id)?.addEventListener('change',()=>renderStylePreview(readStyle())));

  async function loadPopupTranslate(){
    const {subify_settings={}}=await chrome.storage.local.get('subify_settings');
    const {pd_settings={},pd_models={}}=await chrome.storage.local.get(['pd_settings','pd_models']);
    pd_settings.discoveredGeminiModels = Array.isArray(pd_models.all) ? pd_models.all.filter(m=>m && m.methods?.includes?.('generateContent')).map(m=>({id:m.id})) : [];
    $('subify-tab-subtitle').checked=(await chrome.storage.local.get('subify_subtitle_enabled')).subify_subtitle_enabled!==false;
    $('subify-tab-original').checked=subify_settings.displayMode==='dual';
    $('subify-tab-karaoke').checked=subify_settings.karaokeEnabled!==false;
    $('tab-source-language').value=subify_settings.sourceLanguage||'auto';
    $('popup-provider').value=pd_settings.subtitleProvider||'auto';
    updateProviderUi($('popup-provider').value, pd_settings);
  }
  function updateProviderUi(v,pd={}){
    const labels={auto:'خودکار',gemini:'Gemini',openrouter:'OpenRouter',openai:'OpenAI'};
    if($('providerBadge'))$('providerBadge').textContent=labels[v]||'خودکار';
    if($('providerHint'))$('providerHint').textContent=v==='auto'?'خودکار: اول OpenRouter، سپس OpenAI و بعد Gemini؛ فقط سرویسی که کلید دارد استفاده می‌شود.':`موتور انتخاب‌شده: ${labels[v]||v}. فقط همان سرویس برای ترجمه استفاده می‌شود.`;
    const input=$('popup-provider-model'), select=$('popup-gemini-models'), hint=$('providerModelHint');
    if(!input||!select)return;
    const isGemini=v==='gemini', isOR=v==='openrouter', isOAI=v==='openai';
    select.style.display=isGemini?'block':'none'; input.style.display=isGemini?'none':'block';
    if(hint) hint.textContent=isGemini?'یک مدل generateContent از Gemini انتخاب کن. در صورت وجود مدل‌های کشف‌شده این فهرست خودکار پر می‌شود.':isOR?'مدل OpenRouter را می‌توانی دقیقاً دستی تعیین کنی. پیش‌فرض: openrouter/free':isOAI?'مدل OpenAI را دستی وارد کن؛ انتخاب فقط برای ترجمه زیرنویس اعمال می‌شود.':'در حالت Auto، مدل ذخیره‌شده‌ی هر Provider استفاده می‌شود.';
    if(isGemini){
      const val=pd.geminiSubtitleModel||pd.geminiModel||pd.sttModel||'gemini-3.1-flash-lite';
      select.innerHTML='';
      const models=Array.isArray(pd.discoveredGeminiModels)?pd.discoveredGeminiModels:[];
      const ids=models.map(x=>typeof x==='string'?x:x.id).filter(Boolean);
      const uniq=[...new Set([val,...ids])];
      uniq.forEach(id=>{const o=document.createElement('option');o.value=id;o.textContent=id;select.appendChild(o);});
      select.value=val;
    } else {
      input.value=isOR?(pd.openRouterModel||'openrouter/free'):isOAI?(pd.openaiModel||'gpt-5.6-luna'):(pd.sttModel||'gemini-3.1-flash-lite');
      input.dataset.provider=v;
    }
  }
  $('subify-tab-subtitle')?.addEventListener('change',async e=>{await chrome.storage.local.set({subify_subtitle_enabled:e.target.checked});const tab=await activeTab();if(tab?.id)try{await chrome.tabs.sendMessage(tab.id,{type:e.target.checked?'subify-enable-subtitles':'subify-disable-subtitles'});}catch(_){} });
  $('subify-tab-original')?.addEventListener('change',async e=>{const {subify_settings={}}=await chrome.storage.local.get('subify_settings');await chrome.storage.local.set({subify_settings:{...subify_settings,displayMode:e.target.checked?'dual':'translation'}});});
  $('subify-tab-karaoke')?.addEventListener('change',async e=>{const {subify_settings={}}=await chrome.storage.local.get('subify_settings');await chrome.storage.local.set({subify_settings:{...subify_settings,karaokeEnabled:e.target.checked}});});
  $('tab-source-language')?.addEventListener('change',async e=>{const {subify_settings={}}=await chrome.storage.local.get('subify_settings');await chrome.storage.local.set({subify_settings:{...subify_settings,sourceLanguage:e.target.value}});});
  $('popup-provider')?.addEventListener('change',async e=>{const {pd_settings={}}=await chrome.storage.local.get('pd_settings');const next={...pd_settings,subtitleProvider:e.target.value};await chrome.storage.local.set({pd_settings:next});updateProviderUi(e.target.value,next);});
  $('popup-provider-model')?.addEventListener('change',async e=>{const {pd_settings={}}=await chrome.storage.local.get('pd_settings');const provider=e.target.dataset.provider||$('popup-provider').value;const value=e.target.value.trim();const patch=provider==='openrouter'?{openRouterModel:value||'openrouter/free'}:provider==='openai'?{openaiModel:value||'gpt-5.6-luna'}:{sttModel:value||'gemini-3.1-flash-lite',geminiSubtitleModel:value||'gemini-3.1-flash-lite'};await chrome.storage.local.set({pd_settings:{...pd_settings,...patch}});});
  $('popup-gemini-models')?.addEventListener('change',async e=>{const {pd_settings={}}=await chrome.storage.local.get('pd_settings');const value=e.target.value;await chrome.storage.local.set({pd_settings:{...pd_settings,sttModel:value,geminiSubtitleModel:value}});});

  async function loadPopupKeys(){const {pd_settings={}}=await chrome.storage.local.get('pd_settings');$('popup-gemini-key').value=pd_settings.apiKey||'';$('popup-openrouter-key').value=pd_settings.openRouterKey||'';$('openaiKey').value=pd_settings.openaiKey||'';$('openaiModel').value=pd_settings.openaiModel||'gpt-5.6-luna';}
  $('saveKeys')?.addEventListener('click',async()=>{const {pd_settings={}}=await chrome.storage.local.get('pd_settings');await chrome.storage.local.set({pd_settings:{...pd_settings,apiKey:$('popup-gemini-key').value.trim(),openRouterKey:$('popup-openrouter-key').value.trim(),openaiKey:$('openaiKey').value.trim(),openaiModel:$('openaiModel').value.trim()||'gpt-5.6-luna'}});$('keyStatus').textContent='کلیدها ذخیره شدند ✓';});
  $('testGemini')?.addEventListener('click',async()=>{const r=await chrome.runtime.sendMessage({type:'subify-test-key'}).catch(e=>({ok:false,error:e.message}));$('keyStatus').textContent=r?.ok?`Gemini متصل است • ${r.model||''}`:(r?.error||'کلید Gemini معتبر نیست یا هنوز تنظیم نشده است.');});
  $('testOpenRouter')?.addEventListener('click',async()=>{const r=await chrome.runtime.sendMessage({type:'subify-test-openrouter'}).catch(e=>({ok:false,error:e.message}));$('keyStatus').textContent=r?.ok?`OpenRouter متصل است • ${r.model||''}`:(r?.error||'اتصال OpenRouter ناموفق بود.');});
  $('testOpenAI')?.addEventListener('click',async()=>{const r=await chrome.runtime.sendMessage({type:'subify-test-openai'}).catch(e=>({ok:false,error:e.message}));$('keyStatus').textContent=r?.ok?`OpenAI متصل است • ${r.model||''}`:(r?.error||'اتصال OpenAI ناموفق بود.');});
})();
