var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*
const $=id=>document.getElementById(id);
let scenes=[];
let dbp=null;
const THEME_KEY="subify_theme";
const SOURCE_KEY="subify_storyboard_source_tab";

function db(){
  if(dbp)return dbp;
  dbp=new Promise((res,rej)=>{
    const r=indexedDB.open("subify-local",2);
    r.onupgradeneeded=()=>{
      const d=r.result;
      if(!d.objectStoreNames.contains("storyboards"))d.createObjectStore("storyboards");
      if(!d.objectStoreNames.contains("translations"))d.createObjectStore("translations");
      if(!d.objectStoreNames.contains("vocab"))d.createObjectStore("vocab");
      if(!d.objectStoreNames.contains("shots"))d.createObjectStore("shots");
    };
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
  return dbp;
}
async function get(){
  const d=await db();
  return new Promise(r=>{const q=d.transaction("storyboards","readonly").objectStore("storyboards").get("current");q.onsuccess=()=>r(q.result||[]);q.onerror=()=>r([]);});
}
async function put(v){
  const d=await db();
  return new Promise((r,j)=>{const q=d.transaction("storyboards","readwrite").objectStore("storyboards").put(v,"current");q.onsuccess=()=>r();q.onerror=()=>j(q.error);});
}
function isYouTube(t){return Boolean(t?.id&&/^https:\/\/(www\.)?youtube(-nocookie)?\.com\//i.test(t.url||""));}
async function currentExtensionTab(){try{return await browser.tabs.getCurrent();}catch(_){return null;}}
async function sourceTab(){
  const ext=await currentExtensionTab();
  let tabs=[];
  try{tabs=await browser.tabs.query({currentWindow:true});}catch(_){tabs=[];}
  const candidates=tabs.filter(isYouTube);
  if(!candidates.length)return null;
  try{
    const stored=await browser.storage.session.get(SOURCE_KEY);
    const remembered=Number(stored?.[SOURCE_KEY]);
    if(remembered){const t=candidates.find(x=>x.id===remembered);if(t)return t;}
  }catch(_){ }
  // Prefer the most recently active YouTube tab, not storyboard.html itself.
  return candidates.sort((a,b)=>Number(Boolean(b.active))-Number(Boolean(a.active)))[0]||null;
}
async function rememberSource(t){if(!t?.id)return;try{await browser.storage.session.set({[SOURCE_KEY]:t.id});}catch(_){}}
function time(x){x=Number(x)||0;const m=Math.floor(x/60),s=Math.floor(x%60);return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function setStatus(text,ok=false){
  $("status").textContent=text;
  const dot=$("sourceDot"),source=$("sourceText");
  if(dot)dot.classList.toggle("ok",ok);
  if(source)source.textContent=ok?"ویدیو متصل است":"ویدیو پیدا نشد";
}
async function updateSourceStatus(){
  const t=await sourceTab();
  if(t){await rememberSource(t);setStatus(`ویدیو آماده است: ${t.title||"YouTube"}`,true);}
  else setStatus("یک تب YouTube با ویدیوی Subify باز کن.",false);
  return t;
}
async function render(){
  scenes=await get();
  $("board").innerHTML=scenes.length?scenes.map((s,i)=>`<article class="scene">${s.image?`<img src="${esc(s.image)}" alt="">`:`<div class="placeholder">تصویر این شات ذخیره نشده</div>`}<div class="body"><div class="time">#${i+1} • ${time(s.start)}</div><div class="orig">${esc(s.original||"")}</div><div class="fa">${esc(s.fa||"")}</div><div class="small">${esc(s.title||"")}</div></div></article>`).join(""):`<div class="empty">هنوز شاتی اضافه نشده.<br><span>از یک ویدیوی YouTube، «افزودن فریم فعلی» یا «ساخت از زیرنویس ویدیو» را بزن.</span></div>`;
}
async function addCurrent(){
  const t=await updateSourceStatus();
  if(!t?.id)return;
  const b=$("addCurrent");b.disabled=true;b.textContent="در حال گرفتن فریم…";
  try{
    const cue=await browser.tabs.sendMessage(t.id,{type:"subify-get-current-cue"}).catch(()=>null);
    if(!cue?.cue){setStatus("در این لحظه زیرنویس فعالی پیدا نشد.",true);return;}
    // captureVisibleTab works on the active tab. Temporarily activate the source
    // YouTube tab, capture it through the existing background handler, then restore storyboard.
    const ext=await currentExtensionTab();
    await browser.tabs.update(t.id,{active:true});
    const shot=await browser.runtime.sendMessage({type:"subify-capture-shot",tabId:t.id,download:false}).catch(()=>null);
    if(ext?.id)await browser.tabs.update(ext.id,{active:true}).catch(()=>{});
    scenes.push({id:crypto.randomUUID(),start:cue.cue.start,end:cue.cue.end,original:cue.cue.text,fa:cue.cue.fa,title:t.title||"",image:shot?.dataUrl||"",createdAt:Date.now()});
    await put(scenes);await render();setStatus("فریم با موفقیت به Storyboard اضافه شد.",true);
  }finally{b.disabled=false;b.textContent="افزودن فریم فعلی";}
}
async function build(){
  const t=await updateSourceStatus();
  if(!t?.id)return;
  const b=$("build");b.disabled=true;b.textContent="در حال ساخت…";
  try{
    const r=await browser.tabs.sendMessage(t.id,{type:"subify-refresh-captions",translateAll:false}).catch(()=>null);
    if(!r?.ok){setStatus(r?.error||"زیرنویس در دسترس نیست.",true);return;}
    const cues=Array.isArray(r.cues)?r.cues:[];
    scenes=cues.slice(0,120).map((c,i)=>({id:`cue-${i}-${c.id}`,start:c.start,end:c.end,original:c.text,fa:c.fa,title:t.title||"",image:"",createdAt:Date.now()}));
    await put(scenes);await render();setStatus(`${scenes.length} شات از زیرنویس ساخته شد.`,true);
  }finally{b.disabled=false;b.textContent="ساخت از زیرنویس ویدیو";}
}
$("addCurrent").onclick=addCurrent;
$("build").onclick=build;
$("clear").onclick=async()=>{scenes=[];await put([]);await render();setStatus("Storyboard پاک شد.",true);};
$("export").onclick=()=>{const b=new Blob([JSON.stringify(scenes,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="subify-storyboard.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
(async()=>{await render();await updateSourceStatus();})();
