var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*
const $=id=>document.getElementById(id);
const L=window.SubifyLearning;
let cards=[],review=[],idx=0,revealed=false,busy=false,session=0,notes=[],wantFocus=false;
const cardKeys=new WeakMap(); // card object -> its key in the vocabulary store

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setHTML(el,html){el.innerHTML=html;}

const tUI=s=>window.SubifyUI?window.SubifyUI.t(s):s;
const keyOf=c=>`${c.lang||"auto"}:${String(c.word).toLowerCase()}`;
const PHASE_LABEL={new:"تازه",learning:"در حال یادگیری",review:"مرور",mastered:"یادگرفته‌شده"};
const phaseOf=c=>PHASE_LABEL[L.srsPhase(c)]||"";
function setStatus(text){$("status").textContent=text;}

// ---------- vocabulary store ----------
// Same IndexedDB as background.js (extension pages share its origin), so the cards and the sync stay one set.
const DB_NAME="subify-local";
let dbPromise=null;
function openDb(){
  if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,2);
    req.onupgradeneeded=()=>{const d=req.result;for(const s of ["translations","vocab","shots","storyboards"]) if(!d.objectStoreNames.contains(s)) d.createObjectStore(s);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>{dbPromise=null;reject(req.error);};
  });
  return dbPromise;
}
function readVocab(){
  return openDb().then(d=>new Promise((resolve,reject)=>{
    const rows=[], tx=d.transaction("vocab","readonly");
    tx.objectStore("vocab").openCursor().onsuccess=e=>{const c=e.target.result; if(c){rows.push({key:String(c.key),value:c.value}); c.continue();}};
    tx.oncomplete=()=>resolve(rows);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error);
  }));
}
function writeVocab(key,card){
  return openDb().then(d=>new Promise((resolve,reject)=>{
    const tx=d.transaction("vocab","readwrite");
    tx.objectStore("vocab").put(card,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error);
  }));
}
// Background pushes changed cards to the account (signed-in users only). Ask for one push after the grades settle.
let syncTimer=null;
function scheduleSync(){
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>{browser.runtime.sendMessage({type:"subify-vocab-sync"}).catch(()=>{});},3000);
}

// ---------- full dictionary entry (word list and review card) ----------
function entryHeadHtml(c){
  return `<div class="entry-head"><span class="entry-word" dir="ltr">${esc(c.word)}</span>${c.ipa?`<span class="entry-ipa" dir="ltr">${esc(c.ipa)}</span>`:""}${c.pos?`<span class="chip chip-pos">${esc(c.pos)}</span>`:""}${c.level?`<span class="chip">${esc(c.level)}</span>`:""}</div>`;
}
function entryDetailHtml(c){
  if(!c.enriched&&!c.meaning){
    return `<div class="entry-empty">توضیح کامل هنوز دریافت نشده.</div><button class="btn-enrich" data-enrich="${esc(keyOf(c))}">دریافت توضیح کامل با AI</button>`;
  }
  const parts=[];
  if(c.meaning) parts.push(`<div class="entry-meaning">${esc(c.meaning)}</div>`);
  if(c.definition) parts.push(`<div class="entry-def" dir="ltr">${esc(c.definition)}</div>`);
  if(c.lemma&&c.lemma.toLowerCase()!==String(c.word).toLowerCase()) parts.push(`<div class="entry-line"><b>ریشه:</b> <span dir="ltr">${esc(c.lemma)}</span></div>`);
  if(c.forms) parts.push(`<div class="entry-line"><b>شکل‌ها:</b> <span dir="ltr">${esc(c.forms)}</span></div>`);
  if(Array.isArray(c.synonyms)&&c.synonyms.length) parts.push(`<div class="entry-line"><b>مترادف:</b> <span dir="ltr">${c.synonyms.map(esc).join(" · ")}</span></div>`);
  if(c.example) parts.push(`<div class="entry-example"><div dir="ltr">${esc(c.example)}</div>${c.exampleFa?`<div class="entry-example-fa">${esc(c.exampleFa)}</div>`:""}</div>`);
  parts.push(richHtml(c));
  if(c.note) parts.push(`<div class="entry-note">💡 ${esc(c.note)}</div>`);
  if(c.sentence) parts.push(`<div class="entry-src"><b>جمله‌ی اصلی:</b> <span dir="ltr">${esc(c.sentence)}</span>${c.translation?`<div class="entry-src-fa">${esc(c.translation)}</div>`:""}</div>`);
  return parts.join("");
}
// r21 extra fields of a card: collocations, a second example, common mistakes, a usage note and category tags.
// Each part is drawn only when the card has it, so cards saved before r21 look the same as before.
const TAG_FA={travel:"سفر",food:"غذا",work:"کار",study:"تحصیل",family:"خانواده",health:"سلامت",technology:"فناوری",money:"پول",feelings:"احساسات",nature:"طبیعت"};
function richHtml(c){
  const out=[];
  const colls=Array.isArray(c.collocations)?c.collocations.filter(Boolean):[];
  if(colls.length) out.push(`<div class="entry-line"><b>همنشین‌ها:</b> <span class="chips" dir="ltr">${colls.map(x=>`<span class="chip">${esc(x)}</span>`).join("")}</span></div>`);
  if(c.example2) out.push(`<div class="entry-example entry-example2"><div class="entry-sub">مثال دوم</div><div dir="ltr">${esc(c.example2)}</div>${c.example2Fa?`<div class="entry-example-fa">${esc(c.example2Fa)}</div>`:""}</div>`);
  const miss=Array.isArray(c.mistakes)?c.mistakes.filter(m=>m&&m.wrong&&m.right):[];
  if(miss.length) out.push(`<div class="entry-line"><b>اشتباه‌های رایج:</b><ul class="mistakes">${miss.map(m=>`<li><span dir="ltr"><s>${esc(m.wrong)}</s> → <b>${esc(m.right)}</b></span>${m.note?` <span class="m-note">${esc(m.note)}</span>`:""}</li>`).join("")}</ul></div>`);
  if(c.contextNote) out.push(`<div class="entry-line"><b>کی استفاده می‌شود:</b> ${esc(c.contextNote)}</div>`);
  const tags=Array.isArray(c.tags)?c.tags.filter(k=>TAG_FA[k]):[];
  if(tags.length) out.push(`<div class="entry-line"><b>موضوع:</b> ${tags.map(k=>`<span class="chip chip-tag">${esc(TAG_FA[k])}</span>`).join(" ")}</div>`);
  return out.join("");
}
function entryHtml(c){
  return entryHeadHtml(c)+entryDetailHtml(c)+(c.sentence?grammarBlockHtml(c):"");
}

// Where the word was saved: the video title and the time in it, when the card has them (card.source).
// A word saved from a roleplay lesson has the practice as its source (kind "practice"), not a video.
function sourceHtml(src){
  if(!src||typeof src!=="object") return "";
  if(L.isPracticeSource(src)) return `<div class="src-line"><span aria-hidden="true">💬</span><span>${esc(tUI("تمرین نقش‌آفرینی"))}</span></div>`;
  const title=String(src.title||"").trim();
  const time=Number.isFinite(Number(src.t))&&src.t!==null&&src.t!==""?L.formatMmSs(src.t):"";
  const url=L.sourceOpenUrl(src);
  if(!title&&!time&&!url) return "";
  const name=esc(title||tUI("ویدیو"));
  const label=url?`<a class="src-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${name}</a>`:`<span>${name}</span>`;
  return `<div class="src-line"><span aria-hidden="true">🎬</span>${label}${time?` <span class="src-time" dir="ltr">${time}</span>`:""}</div>`;
}

async function enrichCard(key){
  const c=cards.find(x=>keyOf(x)===key); if(!c) return;
  const r=await browser.runtime.sendMessage({type:"subify-vocab-enrich",word:c.word,sentence:c.sentence||"",translation:c.translation||"",lang:c.lang||"auto"});
  if(!r?.ok) alert(tUI(r?.error||"خطا در دریافت توضیح"));
  else if(r.aiError) alert(tUI("ذخیره شد ولی AI پاسخ نداد")+": "+r.aiError);
  load(key);
}
function bindEnrich(root){root.querySelectorAll("[data-enrich]").forEach(b=>b.onclick=()=>{b.disabled=true;b.textContent="در حال دریافت…";enrichCard(b.dataset.enrich);});}

// ---------- loading and the word list ----------
// Reads the store and migrates each card to the spaced-repetition fields. keepKey: the card to stay on after a reload.
async function load(keepKey){
  let rows=[];
  try{ rows=await readVocab(); setStatus(""); }
  catch(_){ setStatus(tUI("خواندن لغت‌ها ناموفق بود")); }
  const now=Date.now();
  cards=rows.map(r=>{const c=L.srsMigrate(r.value,now); cardKeys.set(c,r.key); return c;}).filter(c=>c&&c.word);
  cards.sort((a,b)=>(a.nextDueAt||0)-(b.nextDueAt||0));
  review=cards.filter(c=>L.isDue(c,now));
  const at=keepKey?review.findIndex(c=>keyOf(c)===keepKey):-1;
  idx=at>=0?at:0;
  if(at<0){ revealed=false; session=review.length; }
  renderAll();
}
function renderAll(){ renderHeader(); renderList(); renderReview(); }
function renderHeader(){
  $("count").textContent=`${cards.length} کارت • ${review.length} آماده مرور`;
}
function renderList(){
  const rows=$("rows");
  setHTML(rows,cards.length?cards.map(c=>`<details class="wcard"><summary><span class="w" dir="ltr">${esc(c.word||"")}</span><span class="m">${esc(c.meaning||"در انتظار توضیح…")}</span><span class="l">${esc(c.pos||c.level||"")}</span><span class="b">${esc(phaseOf(c))}</span></summary><div class="wbody">${entryHtml(c)}</div></details>`).join(""):`<div class="empty">هنوز لغتی ذخیره نشده. روی یک کلمه در زیرنویس اصلی یا ترنسکریپت کلیک کن.</div>`);
  bindEnrich(rows);
  bindGrammar(rows);
}

// ---------- reveal, then grade ----------
// The front shows the word and where it came from. "Show meaning" reveals the entry; then the four grades appear.
function renderReview(){
  const box=$("reviewBox"), c=review[idx];
  if(!c){
    const done=session>0&&idx>=review.length;
    setHTML(box,`<div class="card empty" tabindex="-1" style="grid-column:1/-1">${done?"مرور تمام شد.":"کارت آماده‌ای برای مرور وجود ندارد."}</div>`);
    if(wantFocus){box.querySelector(".empty")?.focus(); wantFocus=false;}
    return;
  }
  const head=`<div class="review-meta"><span><span>کارت</span> <span dir="ltr">${idx+1} / ${review.length}</span></span><span><span>مرحله</span> <span>${esc(phaseOf(c))}</span></span></div>`;
  const front=`<div class="review-front">${entryHeadHtml(c)}${sourceHtml(c.source)}</div>`;
  if(!revealed){
    setHTML(box,`<div class="card review-card">${head}${front}<div><button type="button" class="primary reveal" id="revealBtn" aria-expanded="false" aria-controls="reviewBack">نمایش معنی</button></div><div id="reviewBack" class="review-back" hidden></div></div>`);
    $("revealBtn").onclick=()=>{revealed=true;renderReview();};
    if(wantFocus){$("revealBtn").focus(); wantFocus=false;}
    return;
  }
  setHTML(box,`<div class="card review-card">${head}${front}<div id="reviewBack" class="review-back" tabindex="-1">${entryDetailHtml(c)}${c.sentence?grammarBlockHtml(c):""}</div><div class="grades" role="group" aria-label="${esc(tUI("این کارت را چطور یادت بود؟"))}"><button type="button" class="again" data-g="again" aria-keyshortcuts="1">دوباره</button><button type="button" class="hard" data-g="hard" aria-keyshortcuts="2">سخت</button><button type="button" class="good" data-g="good" aria-keyshortcuts="3">خوب</button><button type="button" class="easy" data-g="easy" aria-keyshortcuts="4">آسان</button></div></div>`);
  bindEnrich(box);
  bindGrammar(box);
  box.querySelectorAll("[data-g]").forEach(b=>b.onclick=()=>gradeCurrent(b.dataset.g));
  $("reviewBack").focus();
}
async function gradeCurrent(g){
  const c=review[idx];
  if(!c||busy) return;
  busy=true;
  const buttons=()=>document.querySelectorAll("#reviewBox [data-g]");
  buttons().forEach(b=>b.disabled=true);
  try{
    const key=cardKeys.get(c)||keyOf(c);
    const next=L.srsGrade(c,g,Date.now());
    await writeVocab(key,next);
    cardKeys.set(next,key);
    const at=cards.indexOf(c); if(at>=0) cards[at]=next;
    review.splice(idx,1);
    revealed=false;
    wantFocus=true;
    scheduleSync();
    renderAll();
  }catch(_){
    setStatus(tUI("ذخیرهٔ نمره ناموفق بود"));
    buttons().forEach(b=>b.disabled=false);
  }finally{
    busy=false;
  }
}
document.addEventListener("keydown",e=>{
  if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey) return;
  const el=e.target;
  if(el&&(el.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  if(!revealed||$("panelWords").hidden||busy) return;
  const g={"1":"again","2":"hard","3":"good","4":"easy"}[e.key];
  if(g){e.preventDefault(); gradeCurrent(g);}
});

// ---------- grammar on a card: a button, a panel, and the explanation kept on the card ----------
const GR_ROWS=[["معنی جمله", "meaning"], ["زمان فعل", "tense"], ["ساختار جمله", "structure"], ["قاعدهٔ گرامری", "grammar"], ["چرا این ساختار؟", "why"], ["جایگزین‌های طبیعی", "natural"], ["جایگزین ساده‌تر", "simpler"], ["جایگزین پیشرفته‌تر", "advanced"]];
const GR_SOURCE=new Set(["natural","simpler","advanced"]);
const GR_SPARK='<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"></path><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"></path></svg>';
const grammarOpen=new Set();
const grammarBusy=new Set();
function grammarRowsHtml(g){
  const rows=GR_ROWS.map(([label,field])=>{
    const v=g[field];
    const text=Array.isArray(v)?v.join("  ·  "):String(v||"");
    if(!text) return "";
    return `<div class="gr-row"><b>${label}</b><div${GR_SOURCE.has(field)?' dir="ltr"':""}>${esc(text)}</div></div>`;
  }).join("");
  return rows||`<div class="gr-fail">توضیحی دریافت نشد.</div>`;
}
function grammarBlockHtml(c){
  const key=keyOf(c), open=grammarOpen.has(key);
  return `<div class="gr-block" data-gr-key="${esc(key)}">`+
    `<button type="button" class="btn-grammar" data-grammar="${esc(key)}" aria-expanded="${open}">`+
      `<span class="gr-ico">${GR_SPARK}</span><span>گرامر این جمله</span><span class="gr-chev" aria-hidden="true">⌄</span>`+
    `</button>`+
    `<div class="gr-panel"${open?"":" hidden"}>${open&&c.grammar?grammarRowsHtml(c.grammar):""}</div>`+
  `</div>`;
}
function paintGrammar(key,html){
  document.querySelectorAll(".gr-block").forEach(b=>{
    if(b.dataset.grKey!==key) return;
    const p=b.querySelector(".gr-panel"); if(p) setHTML(p,html);
  });
}
async function readGrammarPrefs(){
  let v={};
  try{ const r=await browser.storage.local.get("subify_learning"); v=r?.subify_learning||{}; }catch(_){}
  return {cefr:v.cefr||"B1",explainLang:v.explainLang||"fa"};
}
// One explanation per card: fetched once, then kept on the card (subify-vocab-grammar) so it opens without a new AI call.
async function loadGrammar(key){
  const c=cards.find(x=>keyOf(x)===key);
  if(!c||!c.sentence||grammarBusy.has(key)) return;
  if(c.grammar){ paintGrammar(key,grammarRowsHtml(c.grammar)); return; }
  grammarBusy.add(key);
  paintGrammar(key,`<div class="gr-loading"><i></i><i></i><i></i><span>در حال تحلیل جمله…</span></div>`);
  const p=await readGrammarPrefs();
  let r=null;
  try{
    r=await browser.runtime.sendMessage({type:"subify-grammar",sentence:c.sentence,prev:"",next:"",translation:c.translation||"",lang:c.lang||"auto",cefr:p.cefr,explainLang:p.explainLang});
  }catch(e){ r={ok:false,error:String(e?.message||e)}; }
  grammarBusy.delete(key);
  if(!r?.ok||!r.grammar){
    paintGrammar(key,`<div class="gr-fail">توضیح گرامر دریافت نشد${r?.error?": "+esc(r.error):""}</div><button type="button" class="gr-retry" data-grammar-retry="${esc(key)}">تلاش دوباره</button>`);
    return;
  }
  c.grammar=r.grammar;
  paintGrammar(key,grammarRowsHtml(r.grammar));
  try{ await browser.runtime.sendMessage({type:"subify-vocab-grammar",key,grammar:r.grammar}); }catch(_){}
}
function bindGrammar(root){
  root.querySelectorAll("[data-grammar]").forEach(b=>{ if(grammarOpen.has(b.dataset.grammar)) loadGrammar(b.dataset.grammar); });
}
document.addEventListener("click",e=>{
  const retry=e.target.closest?.("[data-grammar-retry]");
  if(retry){
    const key=retry.dataset.grammarRetry, c=cards.find(x=>keyOf(x)===key);
    if(c) delete c.grammar;
    loadGrammar(key);
    return;
  }
  const btn=e.target.closest?.("[data-grammar]");
  if(!btn) return;
  const key=btn.dataset.grammar, open=!grammarOpen.has(key);
  open?grammarOpen.add(key):grammarOpen.delete(key);
  btn.setAttribute("aria-expanded",String(open));
  const panel=btn.closest(".gr-block")?.querySelector(".gr-panel");
  if(!panel) return;
  panel.hidden=!open;
  if(open) loadGrammar(key);
});

// ---------- Anki export ----------
// A plain text file (Blob download) in Anki's tab separated format. No BOM: Anki reads the "#" lines from the first byte.
function exportAnki(){
  const rows=cards.filter(c=>c.word);
  if(!rows.length){ setStatus(tUI("لغتی برای خروجی وجود ندارد.")); return; }
  const blob=new Blob([L.toAnkiTsvSourced(rows)],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const d=new Date(), pad=n=>String(n).padStart(2,"0");
  const a=document.createElement("a");
  a.href=url;
  a.download=`subify-anki-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  setStatus(tUI("خروجی Anki آماده شد")+": "+rows.length);
}

// ---------- timestamped notes (written by the subtitle overlay as subify_notes) ----------
// A note's time is a real button. It jumps the open YouTube tab of that video to the time, or opens the video there.
const YT_WATCH_ID=/^[A-Za-z0-9_-]{11}$/;
let noteGroups=[];
function noteItemHtml(n){
  const time=L.formatMmSs(n.t);
  const url=L.sourceOpenUrl(n);
  const videoId=String(n.videoId||"");
  const timeEl=url||YT_WATCH_ID.test(videoId)
    ? `<button type="button" class="note-time" dir="ltr" data-seek-v="${esc(videoId)}" data-seek-t="${esc(String(n.t))}" data-seek-url="${esc(url)}" aria-label="${esc(tUI("برو به این لحظه"))} ${time}">${time}</button>`
    : `<span class="note-time" dir="ltr" title="${esc(tUI("این یادداشت لینک ندارد"))}">${time}</span>`;
  return `<li class="note-item">${timeEl}<p class="note-text">${esc(n.text)}</p></li>`;
}
function groupActionsHtml(i){
  return `<div class="note-actions"><button type="button" data-seed-page="roleplay.html" data-group="${i}">${esc(tUI("تمرین این ویدیو"))}</button><button type="button" data-seed-page="writer.html" data-group="${i}">${esc(tUI("نوشتن از این ویدیو"))}</button></div>`;
}
function renderNotes(){
  noteGroups=L.groupNotes(notes);
  const total=noteGroups.reduce((n,g)=>n+g.notes.length,0);
  $("notesCount").textContent=total?` (${total})`:"";
  if(!total){
    setHTML($("notesBox"),`<div class="card empty">هنوز یادداشت زمان‌داری ثبت نشده. هنگام تماشای ویدیو یادداشت بساز؛ اینجا با زمان آن فهرست می‌شود.</div>`);
    return;
  }
  setHTML($("notesBox"),noteGroups.map((g,i)=>`<section class="note-group card" aria-label="${esc(g.title||tUI("ویدیو بدون عنوان"))}"><h2 class="note-title">${esc(g.title||tUI("ویدیو بدون عنوان"))}</h2>${groupActionsHtml(i)}<ol class="note-list">${g.notes.map(noteItemHtml).join("")}</ol></section>`).join(""));
}
// Jumps to a note's time. The open tab of that video seeks itself; without one, the video opens at the time.
async function seekNote(videoId,t,url){
  let tab=null;
  if(YT_WATCH_ID.test(videoId)){
    try{
      const tabs=await browser.tabs.query({url:"https://www.youtube.com/*"});
      tab=tabs.find(x=>{try{return new URL(x.url).searchParams.get("v")===videoId;}catch(_){return false;}})||null;
    }catch(_){ tab=null; }
  }
  if(tab){
    try{
      await browser.tabs.update(tab.id,{active:true});
      await browser.windows.update(tab.windowId,{focused:true});
      const r=await browser.tabs.sendMessage(tab.id,{type:"subify-seek",t,videoId});
      if(r?.ok) return;
    }catch(_){ /* no subtitle script in that tab: open the video instead */ }
  }
  if(url){ try{ await browser.tabs.create({url}); }catch(_){ setStatus(tUI("باز کردن ویدیو ناموفق بود")); } }
  else setStatus(tUI("این یادداشت لینک ندارد"));
}
// Spec 27 and 29 from a notes group: the video becomes the practice seed, then its page opens. The seed takes the
// saved transcript of that video when there is one (around the first note), otherwise the group's own notes.
async function practiceGroup(i,page){
  const g=noteGroups[i];
  if(!g) return;
  const videoId=(g.notes.find(n=>YT_WATCH_ID.test(String(n.videoId||"")))||g.notes[0]||{}).videoId||"";
  let cues=[];
  try{
    const r=await browser.storage.local.get("subify_cues_snapshot");
    const snap=r?.subify_cues_snapshot;
    if(snap&&Array.isArray(snap.cues)&&snap.cues.length&&snap.videoId===videoId) cues=L.seedCuesAround(snap.cues,g.notes[0]?.t||0,L.SEED_MAX_CUES);
  }catch(_){ cues=[]; }
  if(!cues.length) cues=L.seedCuesAround(g.notes.map(n=>({start:n.t,end:n.t+5,text:n.text})),0,L.SEED_MAX_CUES);
  const seed=L.practiceSeed({videoId:String(videoId),title:g.title,topic:L.seedTopic(cues),cues,createdAt:Date.now()});
  if(!seed){ setStatus(tUI("برای این ویدیو متنی پیدا نشد.")); return; }
  try{ await browser.storage.local.set({[L.PRACTICE_SEED_KEY]:seed}); }
  catch(_){ setStatus(tUI("ساخت تمرین ناموفق بود")); return; }
  try{ await browser.runtime.sendMessage({type:"subify-open-page",page}); }catch(_){ setStatus(tUI("باز کردن صفحه ناموفق بود")); }
}
document.addEventListener("click",e=>{
  const seek=e.target.closest?.("[data-seek-t]");
  if(seek){ e.preventDefault(); void seekNote(seek.dataset.seekV||"",Number(seek.dataset.seekT),seek.dataset.seekUrl||""); return; }
  const seed=e.target.closest?.("[data-seed-page]");
  if(seed) void practiceGroup(Number(seed.dataset.group),seed.dataset.seedPage);
});
async function loadNotes(){
  try{ const r=await browser.storage.local.get("subify_notes"); notes=Array.isArray(r?.subify_notes)?r.subify_notes:[]; }
  catch(_){ notes=[]; }
  renderNotes();
}
browser.storage.onChanged?.addListener((changes,area)=>{
  if(area!=="local"||!changes.subify_notes) return;
  notes=Array.isArray(changes.subify_notes.newValue)?changes.subify_notes.newValue:[];
  renderNotes();
});
function showPanel(which){
  const words=which==="words";
  $("panelWords").hidden=!words;
  $("panelNotes").hidden=words;
  $("tabWords").setAttribute("aria-pressed",String(words));
  $("tabNotes").setAttribute("aria-pressed",String(!words));
}

$("refresh").onclick=()=>load();
$("review").onclick=()=>{revealed=false;wantFocus=true;load();};
$("exportAnki").onclick=exportAnki;
$("tabWords").onclick=()=>showPanel("words");
$("tabNotes").onclick=()=>showPanel("notes");
// ---------- word list (r21): paste a list, one item per line or separated by en dashes ----------
// Adapted from Vocabulary-Learner by MohammadReza Qaderi (MR-Qaderi), used with the author's written permission (2026-10-11).
// Each batch of up to 10 words is one AI call (background: subify-vocab-batch). Saved cards go through the same store as the others.
let listBusy=false;
async function runWordList(){
  if(listBusy) return;
  const parsed=L.splitWordList($("listInput").value,L.WORD_LIST_MAX);
  if(!parsed.items.length){ $("listProgress").textContent="اول چند لغت را وارد کن."; return; }
  const total=parsed.items.length;
  const batches=[];
  for(let i=0;i<total;i+=L.WORD_BATCH_MAX) batches.push(parsed.items.slice(i,i+L.WORD_BATCH_MAX));
  listBusy=true; $("listRun").disabled=true;
  let saved=0, done=0, failed="";
  const missing=[];
  for(const batch of batches){
    $("listProgress").textContent=`در حال ساخت کارت‌ها: ${done} از ${total}`;
    let r=null;
    try{ r=await browser.runtime.sendMessage({type:"subify-vocab-batch",words:batch,lang:"auto"}); }
    catch(err){ r={ok:false,error:String(err?.message||err)}; }
    if(!r?.ok){ failed=tUI(r?.error||"ساخت کارت‌ها انجام نشد"); break; }
    saved+=r.cards.length;
    missing.push(...(r.missing||[]));
    done+=batch.length;
  }
  listBusy=false; $("listRun").disabled=false;
  const parts=[`${saved} کارت ساخته شد.`];
  if(parsed.over) parts.push(`${parsed.over} مورد بیشتر از سقف ${L.WORD_LIST_MAX} تایی، کنار گذاشته شد.`);
  if(missing.length) parts.push(`بدون توضیح، ذخیره نشد: ${missing.join("، ")}`);
  if(failed) parts.push(failed);
  $("listProgress").textContent=parts.join(" ");
  if(saved) load();
}
$("listRun").addEventListener("click",runWordList);

load();
loadNotes();
