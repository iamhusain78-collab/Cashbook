"use strict";
/* ============================================================
   Cashbook — offline personal ledger (PWA, IndexedDB)
   Money stored as INTEGER minor units (x100). No float in totals.
   ============================================================ */

const DB_NAME = "cashbook_db";
const DB_VERSION = 1;            // bump + add a case in upgrade() for future migrations
const MINOR = 100;               // smallest unit = 1/100 of the major unit

const COLORS = ["#6C4DF2","#0BA678","#F0436A","#F59E0B","#3B82F6","#EC4899","#14B8A6","#8B5CF6","#EF4444","#F97316"];
const CB_ICONS = ["📒","💰","🚚","🏦","🧾","🏷️","💵","📦","🛠️","🏠"];
const CAT_ICONS = ["💵","🚚","⛽","🛠️","🧾","🍽️","🏷️","📦","🏦","💼","🪙","📈","📉","🔧","🧰","💳"];

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const uid = () => (crypto && crypto.randomUUID) ? crypto.randomUUID()
  : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,10);
const nowISO = () => new Date().toISOString();
function todayLocal(){
  const d = new Date();
  const p = (n)=>String(n).padStart(2,"0");
  return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate());
}
function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---------- money ---------- */
// parse user text -> integer minor units; returns null if invalid / <= 0
function parseMinor(text){
  if(text==null) return null;
  const t = String(text).trim().replace(/,/g,"");
  if(t === "" || !/^\d*\.?\d*$/.test(t)) return null;
  const f = Number(t);
  if(!isFinite(f) || f <= 0) return null;
  return Math.round(f * MINOR);
}
// integer minor -> grouped string, 2 decimals, no currency symbol. Pure integer math.
function fmtMinor(minor){
  const neg = minor < 0;
  let v = Math.abs(minor);
  const frac = v % MINOR;
  let intPart = (v - frac) / MINOR;
  let s = String(intPart);
  let out = "";
  while(s.length > 3){ out = "," + s.slice(-3) + out; s = s.slice(0,-3); }
  out = s + out;
  const fracStr = String(frac).padStart(2,"0");
  return (neg ? "-" : "") + out + "." + fracStr;
}
function fmtSigned(minor, type){
  const sign = type === "OUT" ? "−" : "+";
  return sign + " " + fmtMinor(Math.abs(minor));
}

/* ---------- dates ---------- */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function prettyDate(ymd){
  const p = ymd.split("-");
  if(p.length !== 3) return ymd;
  return Number(p[2]) + " " + (MONTHS[Number(p[1])-1] || "?") + " " + p[0];
}

/* ============================================================
   DATABASE LAYER (IndexedDB) — versioned migrations
   ============================================================ */
let DB = null;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;
      const from = e.oldVersion;
      upgrade(db, tx, from);
    };
    req.onsuccess = () => { DB = req.result; resolve(DB); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Database is busy in another tab. Close other copies and reopen."));
  });
}

// All schema changes live here, gated by version. Add `if(from < N){...}` blocks for future migrations.
function upgrade(db, tx, from){
  if(from < 1){
    // migration 0001 — initial schema
    const cb = db.createObjectStore("cashbooks", { keyPath:"id" });
    cb.createIndex("by_archived", "is_archived");

    const en = db.createObjectStore("entries", { keyPath:"id" });
    en.createIndex("by_cashbook", "cashbook_id");
    en.createIndex("by_cashbook_date", ["cashbook_id","entry_date"]);
    en.createIndex("by_category", "category_id");

    const ca = db.createObjectStore("categories", { keyPath:"id" });
    ca.createIndex("by_type", "type");
    ca.createIndex("by_type_sort", ["type","sort_order"]);

    db.createObjectStore("meta", { keyPath:"key" });

    seedDefaults(tx);
  }
}

function seedDefaults(tx){
  const store = tx.objectStore("categories");
  const t = nowISO();
  const defs = [
    ["Payment received","IN","💵","#0BA678"],
    ["Freight income","IN","🚚","#14B8A6"],
    ["Advance received","IN","🏦","#3B82F6"],
    ["Other income","IN","🪙","#8B5CF6"],
    ["Fuel","OUT","⛽","#F59E0B"],
    ["Driver / salary","OUT","💼","#6C4DF2"],
    ["Maintenance","OUT","🛠️","#EC4899"],
    ["Office / misc","OUT","🧾","#F0436A"],
    ["Other expense","OUT","📦","#EF4444"],
  ];
  defs.forEach((d, i) => {
    store.put({
      id: uid(), name:d[0], type:d[1], icon_name:d[2], visual_color:d[3],
      is_default:1, is_hidden:0, is_archived:0, sort_order:i, created_at:t, updated_at:t
    });
  });
  tx.objectStore("meta").put({ key:"created_at", value:t });
}

/* ---- promise wrappers ---- */
function txStore(name, mode){ return DB.transaction(name, mode).objectStore(name); }
function reqP(request){
  return new Promise((res, rej) => { request.onsuccess = () => res(request.result); request.onerror = () => rej(request.error); });
}
function getAll(store){ return reqP(txStore(store,"readonly").getAll()); }
function getOne(store, key){ return reqP(txStore(store,"readonly").get(key)); }
function putOne(store, value){
  return new Promise((res, rej) => {
    const tx = DB.transaction(store,"readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => res(value); tx.onerror = () => rej(tx.error);
  });
}

/* ============================================================
   DATA ACCESS
   ============================================================ */
async function getCashbooks(){
  const all = await getAll("cashbooks");
  all.sort((a,b)=> (a.created_at < b.created_at ? -1 : 1));
  return all;
}
async function addCashbook(data){
  const t = nowISO();
  const rec = {
    id: uid(), name:data.name, description:data.description || null,
    color_hex:data.color_hex, icon_name:data.icon_name,
    opening_balance_minor: data.opening_balance_minor | 0,
    created_at:t, updated_at:t, is_archived:0, archived_at:null
  };
  await putOne("cashbooks", rec);
  return rec;
}
async function updateCashbook(id, patch){
  const rec = await getOne("cashbooks", id);
  if(!rec) return null;
  Object.assign(rec, patch, { updated_at: nowISO() });
  await putOne("cashbooks", rec);
  return rec;
}
async function setArchived(id, archived){
  return updateCashbook(id, { is_archived: archived?1:0, archived_at: archived ? nowISO() : null });
}

async function getEntries(cashbookId){
  const idx = txStore("entries","readonly").index("by_cashbook");
  const list = await reqP(idx.getAll(IDBKeyRange.only(cashbookId)));
  const active = list.filter(e => !e.deleted_at);
  active.sort((a,b) => {
    if(a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? 1 : -1; // newest day first
    return a.created_at < b.created_at ? 1 : -1;                                   // newest first within day
  });
  return active;
}
async function addEntry(data){
  const t = nowISO();
  const rec = {
    id: uid(), cashbook_id:data.cashbook_id, amount_minor:data.amount_minor, type:data.type,
    entry_date:data.entry_date, category_id:data.category_id,
    category_name_snapshot:data.category_name_snapshot,
    note:data.note || null, reference_number:data.reference_number || null,
    attachment_uri:null, created_at:t, updated_at:t, deleted_at:null
  };
  await putOne("entries", rec);
  return rec;
}
async function updateEntry(id, data){
  const rec = await getOne("entries", id);
  if(!rec) return null;
  Object.assign(rec, {
    amount_minor:data.amount_minor, type:data.type, entry_date:data.entry_date,
    category_id:data.category_id, category_name_snapshot:data.category_name_snapshot,
    note:data.note || null, reference_number:data.reference_number || null,
    updated_at: nowISO()
  });
  await putOne("entries", rec);
  return rec;
}
async function softDeleteEntry(id){
  const rec = await getOne("entries", id);
  if(!rec) return;
  rec.deleted_at = nowISO(); rec.updated_at = nowISO();
  await putOne("entries", rec);
}

async function getCategories(type){
  const all = await getAll("categories");
  const list = all.filter(c => !c.is_archived && (type ? c.type === type : true));
  list.sort((a,b) => a.sort_order - b.sort_order || (a.name < b.name ? -1 : 1));
  return list;
}
async function addCategory(data){
  const t = nowISO();
  const same = (await getCategories(data.type));
  const rec = {
    id: uid(), name:data.name, type:data.type, icon_name:data.icon_name, visual_color:data.visual_color,
    is_default:0, is_hidden:0, is_archived:0, sort_order: same.length, created_at:t, updated_at:t
  };
  await putOne("categories", rec);
  return rec;
}
async function updateCategory(id, patch){
  const rec = await getOne("categories", id);
  if(!rec) return null;
  Object.assign(rec, patch, { updated_at: nowISO() });
  await putOne("categories", rec); // NOTE: renaming never rewrites entry snapshots (frozen at write time)
  return rec;
}
// TRUE delete: remove the category, and null category_id on its past entries (snapshot keeps the name).
async function deleteCategory(id){
  return new Promise((res, rej) => {
    const tx = DB.transaction(["categories","entries"],"readwrite");
    tx.objectStore("categories").delete(id);
    const idx = tx.objectStore("entries").index("by_category");
    const cur = idx.openCursor(IDBKeyRange.only(id));
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if(c){ const v = c.value; v.category_id = null; v.updated_at = nowISO(); c.update(v); c.continue(); }
    };
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

/* ---- totals (pure integer) ---- */
function computeTotals(cashbook, entries){
  let inSum = 0, outSum = 0;
  for(const e of entries){ if(e.type === "IN") inSum += e.amount_minor; else outSum += e.amount_minor; }
  const balance = (cashbook.opening_balance_minor | 0) + inSum - outSum;
  return { inSum, outSum, balance };
}

/* ---- backup / restore ---- */
async function exportAll(){
  const [cashbooks, categories, entries, meta] = await Promise.all([
    getAll("cashbooks"), getAll("categories"), getAll("entries"), getAll("meta")
  ]);
  return { app:"cashbook", format:1, schema_version:DB_VERSION, exported_at:nowISO(), cashbooks, categories, entries, meta };
}
function importAll(data){
  if(!data || data.app !== "cashbook" || !Array.isArray(data.entries))
    return Promise.reject(new Error("This file is not a Cashbook backup."));
  // One transaction, all requests issued synchronously (no await in between —
  // IndexedDB auto-commits a transaction the moment control yields to the event loop).
  return new Promise((res, rej) => {
    const tx = DB.transaction(["cashbooks","categories","entries","meta"],"readwrite");
    ["cashbooks","categories","entries","meta"].forEach(n => tx.objectStore(n).clear());
    (data.cashbooks||[]).forEach(r => tx.objectStore("cashbooks").put(r));
    (data.categories||[]).forEach(r => tx.objectStore("categories").put(r));
    (data.entries||[]).forEach(r => tx.objectStore("entries").put(r));
    (data.meta||[]).forEach(r => tx.objectStore("meta").put(r));
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error("Restore was aborted."));
  });
}

/* ============================================================
   UI STATE + RENDER
   ============================================================ */
const state = { view:"list", cashbookId:null, showArchived:false };

function setBar(title, sub, showBack){
  $("barTitle").textContent = title;
  $("barSub").textContent = sub || "";
  $("bar").classList.toggle("has-back", !!showBack);
}
function toast(msg){
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove("show"), 2200);
}

// Animate a balance ticking up from zero. Pure-integer formatting; honours reduced motion.
function countUp(el, to){
  if(!el) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(reduce){ el.textContent = fmtMinor(to); el.classList.toggle("neg", to<0); return; }
  const dur = 600, start = performance.now();
  function frame(now){
    const p = Math.min(1, (now-start)/dur);
    const e = 1 - Math.pow(1-p, 3); // easeOutCubic
    const val = Math.round(to * e);
    el.textContent = fmtMinor(val);
    el.classList.toggle("neg", val<0);
    if(p < 1) requestAnimationFrame(frame);
  }
  el.textContent = fmtMinor(0);
  requestAnimationFrame(frame);
}

async function render(){
  if(state.view === "detail" && state.cashbookId){ await renderDetail(state.cashbookId); }
  else { await renderList(); }
}

/* ---------- LIST ---------- */
async function renderList(){
  state.view = "list";
  setBar("Cashbook", "Your accounts", false);
  $("fab").style.display = "flex";
  $("fab").onclick = () => openCashbookForm();

  const books = await getCashbooks();
  const active = books.filter(b => !b.is_archived);
  const archived = books.filter(b => b.is_archived);
  const app = $("app");

  if(books.length === 0){
    app.innerHTML = `<div class="empty">
      <div class="big">📒</div>
      <h2>No cashbooks yet</h2>
      <p>A cashbook is one account — a wallet, a bank, or a person you keep cash with. Make your first one to start logging cash in and out.</p>
      <button class="btn" id="firstCb">Create a cashbook</button>
    </div>`;
    $("firstCb").onclick = () => openCashbookForm();
    return;
  }

  let html = "";
  if(active.length){
    const totals = await Promise.all(active.map(async b => computeTotals(b, await getEntries(b.id)).balance));
    html += active.map((b,i) => cashbookCard(b, totals[i], false)).join("");
  } else {
    html += `<div class="note">All your cashbooks are archived. Open the menu to show them, or add a new one.</div>`;
  }
  if(state.showArchived && archived.length){
    const at = await Promise.all(archived.map(async b => computeTotals(b, await getEntries(b.id)).balance));
    html += `<div class="eyebrow">Archived</div>`;
    html += archived.map((b,i) => cashbookCard(b, at[i], true)).join("");
  }
  app.innerHTML = html;
  app.querySelectorAll("[data-open]").forEach(el => el.onclick = () => {
    state.cashbookId = el.dataset.open;
    state.view = "detail";
    render();
  });
}

function cashbookCard(b, balance, archived){
  return `<button class="cb ${archived?'arch':''}" data-open="${b.id}">
    <span class="tab" style="background:${esc(b.color_hex)}"></span>
    <span class="body">
      <span class="ic">${esc(b.icon_name||"📒")}</span>
      <span class="info">
        <span class="nm">${esc(b.name)}</span>
        <span class="ds">${esc(b.description || (archived?"Archived":"Tap to open"))}</span>
      </span>
      <span class="bal"><span class="lab">Balance</span><span class="num ${balance<0?'neg':''}">${fmtMinor(balance)}</span></span>
    </span>
  </button>`;
}

/* ---------- DETAIL ---------- */
async function renderDetail(id){
  const cb = await getOne("cashbooks", id);
  if(!cb){ state.view="list"; state.cashbookId=null; return renderList(); }
  state.view = "detail";
  setBar(cb.name, cb.is_archived ? "Archived account" : (cb.description || "Cash ledger"), true);
  $("fab").style.display = "flex";
  $("fab").onclick = () => openEntryForm(cb);

  const entries = await getEntries(id);
  const t = computeTotals(cb, entries);
  const app = $("app");

  let html = `<div class="summary">
    <div class="blab">Current balance</div>
    <div class="bbal num ${t.balance<0?'neg':''}" id="heroBal">${fmtMinor(t.balance)}</div>
    <div class="flow">
      <div><div class="k">In</div><div class="v num pos">${fmtMinor(t.inSum)}</div></div>
      <div><div class="k">Out</div><div class="v num neg">${fmtMinor(t.outSum)}</div></div>
      <div><div class="k">Opening</div><div class="v num">${fmtMinor(cb.opening_balance_minor|0)}</div></div>
    </div>
  </div>`;

  if(entries.length === 0){
    html += `<div class="empty"><div class="big">🧾</div><h2>No entries yet</h2>
      <p>Tap the + button to record your first cash in or cash out for this book.</p></div>`;
    app.innerHTML = html;
    countUp($("heroBal"), t.balance);
    return;
  }

  // group by date
  const groups = [];
  let cur = null;
  for(const e of entries){
    if(!cur || cur.date !== e.entry_date){ cur = { date:e.entry_date, items:[] }; groups.push(cur); }
    cur.items.push(e);
  }
  for(const g of groups){
    let dayNet = 0;
    g.items.forEach(e => dayNet += (e.type==="IN"? e.amount_minor : -e.amount_minor));
    html += `<div class="daygroup">
      <div class="dh"><span>${prettyDate(g.date)}</span><span class="num ${dayNet<0?'neg':'pos'}">${dayNet>=0?'+':'−'} ${fmtMinor(Math.abs(dayNet))}</span></div>
      <div class="ledger">${g.items.map(entryRow).join("")}</div>
    </div>`;
  }
  app.innerHTML = html;
  countUp($("heroBal"), t.balance);
  app.querySelectorAll("[data-entry]").forEach(el => el.onclick = () => openEntryForm(cb, el.dataset.entry));
}

function entryRow(e){
  const cat = e.category_name_snapshot || "Uncategorised";
  const bits = [];
  if(e.note) bits.push(esc(e.note));
  if(e.reference_number) bits.push('<span class="rref">#'+esc(e.reference_number)+'</span>');
  const sub = bits.length ? `<span class="rnote">${bits.join(" · ")}</span>` : "";
  return `<button class="row" data-entry="${e.id}">
    <span class="rdot" style="background:${e.type==='IN'?'var(--pos)':'var(--neg)'}"></span>
    <span class="rmain"><span class="rcat">${esc(cat)}</span>${sub}</span>
    <span class="ramt num ${e.type==='IN'?'pos':'neg'}">${fmtSigned(e.amount_minor, e.type)}</span>
  </button>`;
}

/* ============================================================
   SHEETS / FORMS
   ============================================================ */
function openSheet(html){ $("sheet").innerHTML = `<div class="grab"></div>` + html; $("scrim").classList.add("open"); }
function closeSheet(){ $("scrim").classList.remove("open"); $("sheet").innerHTML = ""; }
$("scrim").addEventListener("click", (e) => { if(e.target === $("scrim")) closeSheet(); });

/* ----- cashbook form ----- */
async function openCashbookForm(existing){
  const ed = existing || null;
  let color = ed ? ed.color_hex : COLORS[0];
  let icon = ed ? ed.icon_name : CB_ICONS[0];
  openSheet(`
    <h2>${ed ? "Edit cashbook" : "New cashbook"}</h2>
    <div class="field" id="f-name"><label>Name</label>
      <input id="cbName" placeholder="e.g. Cash in hand, Meezan Bank" value="${ed?esc(ed.name):""}" autocomplete="off">
      <div class="err">Please enter a name.</div></div>
    <div class="field"><label>Description (optional)</label>
      <input id="cbDesc" placeholder="A short note" value="${ed&&ed.description?esc(ed.description):""}" autocomplete="off"></div>
    ${ed ? "" : `<div class="field"><label>Opening balance (optional)</label>
      <input id="cbOpen" inputmode="decimal" placeholder="0.00" autocomplete="off"></div>`}
    <div class="field"><label>Colour</label><div class="swatches" id="cbColors"></div></div>
    <div class="field"><label>Icon</label><div class="icons" id="cbIcons"></div></div>
    <div class="sheet-actions">
      <button class="btn" id="cbSave">${ed?"Save changes":"Create cashbook"}</button>
      ${ed ? `<button class="btn ghost" id="cbArchive">${ed.is_archived?"Unarchive":"Archive this cashbook"}</button>` : ""}
      <button class="btn ghost" id="cbCancel">Cancel</button>
    </div>`);

  buildSwatches($("cbColors"), COLORS, color, v => color = v);
  buildIcons($("cbIcons"), CB_ICONS, icon, v => icon = v);

  $("cbCancel").onclick = closeSheet;
  if(ed && $("cbArchive")) $("cbArchive").onclick = async () => {
    await setArchived(ed.id, !ed.is_archived);
    closeSheet();
    if(!ed.is_archived){ state.view="list"; state.cashbookId=null; }
    toast(ed.is_archived ? "Unarchived" : "Cashbook archived");
    render();
  };
  $("cbSave").onclick = async () => {
    const name = $("cbName").value.trim();
    const fn = $("f-name"); fn.classList.toggle("invalid", !name);
    if(!name) return;
    const desc = $("cbDesc").value.trim();
    if(ed){
      await updateCashbook(ed.id, { name, description: desc||null, color_hex:color, icon_name:icon });
      toast("Saved");
    } else {
      const openMinor = parseMinor($("cbOpen").value) ?? 0;
      const safeOpen = ($("cbOpen").value.trim()==="" ) ? 0 : (openMinor || 0);
      await addCashbook({ name, description:desc||null, color_hex:color, icon_name:icon, opening_balance_minor:safeOpen });
      toast("Cashbook created");
    }
    closeSheet(); render();
  };
}

/* ----- entry form ----- */
async function openEntryForm(cb, entryId){
  const editing = entryId ? await getOne("entries", entryId) : null;
  let type = editing ? editing.type : "OUT";

  openSheet(`
    <h2>${editing ? "Edit entry" : "New entry"}</h2>
    <div class="field"><label>Type</label>
      <div class="seg" id="typeSeg">
        <button data-v="IN" type="button">Cash in</button>
        <button data-v="OUT" type="button">Cash out</button>
      </div></div>
    <div class="field" id="f-amt"><label>Amount</label>
      <input id="enAmt" inputmode="decimal" placeholder="0.00" value="${editing?fmtMinor(editing.amount_minor).replace(/,/g,''):""}" autocomplete="off">
      <div class="err">Enter an amount greater than zero.</div></div>
    <div class="row2">
      <div class="field"><label>Date</label><input id="enDate" type="date" value="${editing?editing.entry_date:todayLocal()}"></div>
      <div class="field" id="f-cat"><label>Category</label><select id="enCat"></select>
        <div class="err">Add a category first.</div></div>
    </div>
    <div class="field"><label>Note (optional)</label><input id="enNote" placeholder="What was it for?" value="${editing&&editing.note?esc(editing.note):""}" autocomplete="off"></div>
    <div class="field"><label>Reference no. (optional)</label><input id="enRef" placeholder="Bill / slip number" value="${editing&&editing.reference_number?esc(editing.reference_number):""}" autocomplete="off"></div>
    <div class="sheet-actions">
      <button class="btn" id="enSave">${editing?"Save changes":"Add entry"}</button>
      ${editing ? `<button class="btn danger" id="enDelete">Delete entry</button>` : ""}
      <button class="btn ghost" id="enCancel">Cancel</button>
    </div>`);

  const seg = $("typeSeg");
  const paint = () => seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === type));
  async function loadCats(keepId){
    const cats = await getCategories(type);
    const sel = $("enCat");
    if(cats.length === 0){ sel.innerHTML = `<option value="">No ${type==='IN'?'income':'expense'} categories</option>`; return; }
    sel.innerHTML = cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    if(keepId && cats.some(c => c.id === keepId)) sel.value = keepId;
  }
  paint();
  await loadCats(editing ? editing.category_id : null);

  seg.querySelectorAll("button").forEach(b => b.onclick = async () => { type = b.dataset.v; paint(); await loadCats(null); });
  $("enCancel").onclick = closeSheet;
  if(editing && $("enDelete")) $("enDelete").onclick = async () => {
    if(!confirm("Delete this entry? It will be removed from the balance.")) return;
    await softDeleteEntry(editing.id); closeSheet(); toast("Entry deleted"); render();
  };
  $("enSave").onclick = async () => {
    const minor = parseMinor($("enAmt").value);
    const famt = $("f-amt"); famt.classList.toggle("invalid", !minor);
    const sel = $("enCat"); const catId = sel.value;
    const fcat = $("f-cat"); fcat.classList.toggle("invalid", !catId);
    if(!minor || !catId) return;
    const cat = await getOne("categories", catId);
    const snapshot = cat ? cat.name : "Uncategorised";   // frozen at write time
    const payload = {
      cashbook_id: cb.id, amount_minor:minor, type, entry_date: $("enDate").value || todayLocal(),
      category_id: catId, category_name_snapshot: snapshot,
      note: $("enNote").value.trim(), reference_number: $("enRef").value.trim()
    };
    if(editing) await updateEntry(editing.id, payload); else await addEntry(payload);
    closeSheet(); toast(editing?"Saved":"Entry added"); render();
  };
}

/* ----- swatch / icon pickers ----- */
function buildSwatches(host, colors, current, onPick){
  host.innerHTML = colors.map(c => `<button type="button" class="swatch ${c===current?'on':''}" data-c="${c}" style="background:${c}" aria-label="colour"></button>`).join("");
  host.querySelectorAll(".swatch").forEach(s => s.onclick = () => {
    host.querySelectorAll(".swatch").forEach(x => x.classList.remove("on")); s.classList.add("on"); onPick(s.dataset.c);
  });
}
function buildIcons(host, icons, current, onPick){
  host.innerHTML = icons.map(ic => `<button type="button" class="icbtn ${ic===current?'on':''}" data-i="${ic}">${ic}</button>`).join("");
  host.querySelectorAll(".icbtn").forEach(s => s.onclick = () => {
    host.querySelectorAll(".icbtn").forEach(x => x.classList.remove("on")); s.classList.add("on"); onPick(s.dataset.i);
  });
}

/* ============================================================
   MENU + CATEGORIES + BACKUP
   ============================================================ */
$("menuBtn").onclick = openMenu;
$("backBtn").onclick = () => { state.view="list"; state.cashbookId=null; render(); };

function openMenu(){
  openSheet(`
    <h2>Menu</h2>
    <div class="menu-list">
      <button data-a="cats"><span class="mi">🏷️</span> Manage categories</button>
      <button data-a="arch"><span class="mi">📂</span> ${state.showArchived?"Hide archived cashbooks":"Show archived cashbooks"}</button>
      <button data-a="backup"><span class="mi">⬇️</span> Back up to a file</button>
      <button data-a="restore"><span class="mi">⬆️</span> Restore from a file</button>
      <button data-a="about"><span class="mi">ℹ️</span> About &amp; storage</button>
    </div>`);
  $("sheet").querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if(a==="cats") openCategories();
    else if(a==="arch"){ state.showArchived = !state.showArchived; closeSheet(); render(); }
    else if(a==="backup") doBackup();
    else if(a==="restore") doRestore();
    else if(a==="about") openAbout();
  });
}

async function openCategories(){
  const cats = await getCategories();
  const ins = cats.filter(c => c.type==="IN");
  const outs = cats.filter(c => c.type==="OUT");
  const rows = (arr) => arr.length ? arr.map(catManageRow).join("") : `<div class="note">None yet.</div>`;
  openSheet(`
    <h2>Categories</h2>
    <div class="eyebrow" style="margin-top:0">Cash in</div>${rows(ins)}
    <div class="eyebrow">Cash out</div>${rows(outs)}
    <div class="sheet-actions">
      <button class="btn" id="catAdd">Add a category</button>
      <button class="btn ghost" id="catBack">Back</button>
    </div>`);
  $("catBack").onclick = openMenu;
  $("catAdd").onclick = () => openCategoryForm();
  $("sheet").querySelectorAll("[data-edit]").forEach(b => b.onclick = async () => openCategoryForm(await getOne("categories", b.dataset.edit)));
  $("sheet").querySelectorAll("[data-del]").forEach(b => b.onclick = () => confirmDeleteCategory(b.dataset.del, b.dataset.name));
}
function catManageRow(c){
  return `<div class="cat-row">
    <span class="cdot" style="background:${esc(c.visual_color)}"></span>
    <span style="font-size:18px">${esc(c.icon_name)}</span>
    <span class="cname">${esc(c.name)}</span>
    <button class="cact" data-edit="${c.id}">Edit</button>
    <button class="cact del" data-del="${c.id}" data-name="${esc(c.name)}">Delete</button>
  </div>`;
}
async function openCategoryForm(existing){
  const ed = existing || null;
  let type = ed ? ed.type : "OUT";
  let color = ed ? ed.visual_color : COLORS[0];
  let icon = ed ? ed.icon_name : CAT_ICONS[0];
  openSheet(`
    <h2>${ed?"Edit category":"New category"}</h2>
    <div class="field" id="f-cn"><label>Name</label>
      <input id="catName" value="${ed?esc(ed.name):""}" placeholder="e.g. Toll tax" autocomplete="off">
      <div class="err">Please enter a name.</div></div>
    ${ed ? `<div class="note">Renaming won't change entries you already saved — they keep the name they had when logged.</div>`
         : `<div class="field"><label>Type</label><div class="seg" id="catSeg">
              <button data-v="IN" type="button">Cash in</button><button data-v="OUT" type="button">Cash out</button></div></div>`}
    <div class="field"><label>Colour</label><div class="swatches" id="catColors"></div></div>
    <div class="field"><label>Icon</label><div class="icons" id="catIcons"></div></div>
    <div class="sheet-actions">
      <button class="btn" id="catSave">${ed?"Save changes":"Add category"}</button>
      <button class="btn ghost" id="catCancel">Cancel</button>
    </div>`);
  buildSwatches($("catColors"), COLORS, color, v => color=v);
  buildIcons($("catIcons"), CAT_ICONS, icon, v => icon=v);
  if(!ed){
    const seg = $("catSeg");
    const paint = () => seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v===type));
    paint();
    seg.querySelectorAll("button").forEach(b => b.onclick = () => { type=b.dataset.v; paint(); });
  }
  $("catCancel").onclick = openCategories;
  $("catSave").onclick = async () => {
    const name = $("catName").value.trim();
    $("f-cn").classList.toggle("invalid", !name);
    if(!name) return;
    if(ed) await updateCategory(ed.id, { name, visual_color:color, icon_name:icon });
    else await addCategory({ name, type, visual_color:color, icon_name:icon });
    toast(ed?"Saved":"Category added"); openCategories();
  };
}
async function confirmDeleteCategory(id, name){
  const idx = txStore("entries","readonly").index("by_category");
  const used = await reqP(idx.count(IDBKeyRange.only(id)));
  const msg = used > 0
    ? `Delete "${name}"? ${used} entr${used===1?"y":"ies"} used it. Those entries stay and keep the name "${name}", but will no longer be linked to a category.`
    : `Delete "${name}"?`;
  if(!confirm(msg)) return;
  await deleteCategory(id); toast("Category deleted"); openCategories(); 
}

/* ----- backup ----- */
async function doBackup(){
  try{
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "cashbook-backup-" + todayLocal() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
    closeSheet(); toast("Backup file saved");
  }catch(err){ alert("Backup failed: " + err.message); }
}
function doRestore(){
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json,.json";
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try{
        const data = JSON.parse(reader.result);
        const counts = `${(data.cashbooks||[]).length} cashbooks and ${(data.entries||[]).length} entries`;
        if(!confirm("Restore will REPLACE everything currently in this app with the backup (" + counts + "). Continue?")) return;
        await importAll(data);
        state.view="list"; state.cashbookId=null; state.showArchived=false;
        closeSheet(); toast("Backup restored"); render();
      }catch(err){ alert("Could not restore: " + err.message); }
    };
    reader.readAsText(file);
  };
  inp.click();
}

function openAbout(){
  openSheet(`
    <h2>About &amp; storage</h2>
    <div class="about">
      <p><strong>Cashbook</strong> keeps everything on this device only. There is no account, no server, and no internet needed once it's installed.</p>
      <p>Your data lives in this app's private storage. It stays unless you clear the browser/app data or uninstall. To be safe, <strong>back up to a file regularly</strong> — and keep that file somewhere safe (Drive, email to yourself, etc.).</p>
      <p id="persistLine">Checking storage protection…</p>
    </div>
    <div class="sheet-actions">
      <button class="btn" id="aboutBackup">Back up now</button>
      <button class="btn ghost" id="aboutClose">Close</button>
    </div>`);
  $("aboutClose").onclick = closeSheet;
  $("aboutBackup").onclick = doBackup;
  reportPersistence();
}
async function reportPersistence(){
  const line = $("persistLine"); if(!line) return;
  try{
    if(navigator.storage && navigator.storage.persisted){
      let p = await navigator.storage.persisted();
      if(!p && navigator.storage.persist) p = await navigator.storage.persist();
      line.innerHTML = p
        ? "✅ <strong>Storage protected</strong> — Android won't auto-clear this app's data to free space."
        : "⚠️ Storage protection not granted. Your data is still saved, but keep backups as your safety net.";
    } else { line.textContent = "Keep backups as your safety net — they're your guaranteed copy."; }
  }catch(e){ line.textContent = "Keep backups as your safety net — they're your guaranteed copy."; }
}

/* ============================================================
   BOOT
   ============================================================ */
async function boot(){
  try{
    await openDB();
    if(navigator.storage && navigator.storage.persist){ try{ await navigator.storage.persist(); }catch(e){} }
    await render();
  }catch(err){
    $("app").innerHTML = `<div class="empty"><div class="big">⚠️</div><h2>Couldn't open the database</h2><p>${esc(err.message||"Unknown error")}. Try reopening the app.</p></div>`;
  }
  if("serviceWorker" in navigator){
    const reg = () => navigator.serviceWorker.register("sw.js", { updateViaCache:"none" })
      .then(r => r.update().catch(()=>{})).catch(()=>{});
    if(document.readyState === "complete") reg();
    else window.addEventListener("load", reg, { once:true });
  }
}
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
});
window.addEventListener("error", (e) => {
  console.error(e.error || e.message);
});
boot();
