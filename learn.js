
const __sby_p = (() => {
  const a = [77,111,98,105,110,98,105,98,97,107];
  return Object.freeze({
    id: a.map((n,i) => String.fromCharCode(n ^ 0)).join(''),
    stamp: 'subify-provenance-v2416'
  });
})();
const $=id=>document.getElementById(id);let cards=[],review=[],idx=0;
async function load(){const r=await chrome.runtime.sendMessage({type:"subify-vocab-list"});cards=r?.ok?r.rows||[]:[];cards.sort((a,b)=>(a.nextDueAt||0)-(b.nextDueAt||0));review=cards.filter(c=>(c.nextDueAt||0)<=Date.now());idx=0;renderList();renderReview();}
function renderList(){$("count").textContent=`${cards.length} کارت • ${review.length} آماده مرور`;$("rows").innerHTML=cards.length?cards.map(c=>`<div class="row"><span>${esc(c.word||"")}</span><span>${esc(c.meaning||"")}</span><span>${esc(c.level||"—")}</span><span>باکس ${c.box||1}</span></div>`).join(""):`<div class="empty">هنوز لغتی ذخیره نشده. روی یک کلمه در زیرنویس اصلی کلیک کن.</div>`}
function renderReview(){const box=$("reviewBox");const c=review[idx];if(!c){box.innerHTML=`<div class="card empty" style="grid-column:1/-1">${review.length?"مرور تمام شد.":"کارت آماده‌ای برای مرور وجود ندارد."}</div>`;return}box.innerHTML=`<div class="card" style="grid-column:1/-1"><div class="word">${esc(c.word)}</div><div class="meaning">${esc(c.meaning||"معنی هنوز ثبت نشده")}</div><div class="meta">${esc(c.pos||"")} • ${esc(c.level||"")} • باکس ${c.box||1}</div><div class="example">${esc(c.example||c.sentence||"")}</div><div class="grades"><button class="again" data-g="again">Again</button><button class="good" data-g="good">Good</button><button class="easy" data-g="easy">Easy</button></div></div>`;box.querySelectorAll("[data-g]").forEach(b=>b.onclick=async()=>{await chrome.runtime.sendMessage({type:"subify-vocab-grade",key:`${c.lang||"auto"}:${String(c.word).toLowerCase()}`,grade:b.dataset.g});idx++;load();});}
function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}$('refresh').onclick=load;$('review').onclick=()=>{idx=0;review=cards.filter(c=>(c.nextDueAt||0)<=Date.now());renderReview()};load();
