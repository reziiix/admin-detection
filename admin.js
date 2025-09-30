// ===================== admin.js (AI Detection Games — Admin Console) =====================
// Requirements:
// - Supabase table: scores(id bigserial pk, name text, score int, total int, ts bigint not null)
// - RLS enabled with policies: select (true), delete requires x-admin header matching your token
//     create policy delete_scores_admin on scores for delete to anon
//     using ( current_setting('request.headers.x-admin', true) = 'YOUR_ADMIN_TOKEN' );

// ---------- CONFIG ----------
const SUPABASE_URL  = "https://tzmegilrifrlruljfamb.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6bWVnaWxyaWZybHJ1bGpmYW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxNzU2MzEsImV4cCI6MjA3NDc1MTYzMX0.UBpJTuPOg1DOwUvffd_ch0fKwWyYbmOPEpkzIEh3thg";
const SCORES_TABLE  = "scores";

// Must match your RLS policy string exactly:
const ADMIN_HEADER  = "QWIYGDIUQHKNKJZABJHQGIYGWIDBQUKawsdb";

// Set to the SHA-256 hex of your chosen password (see README comment below)
const PASSWORD_SHA256_HEX = "caa75277d28a4a59bfeb82058a03beefdf02b93da0013987c128035968db43fe";

// ---------- helpers ----------
const $ = s => document.querySelector(s);
function toHex(buf){ return Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,"0")).join(""); }
async function sha256Hex(txt){ return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt))); }
function csvEscape(s){ const t=String(s??""); return /[",\n]/.test(t) ? `"${t.replace(/"/g,'""')}"` : t; }
function setStatus(msg, ok=false){ const s=$("#status"); if(!s) return; s.textContent=msg||""; s.style.color = ok ? "#23D0A8" : "#9aa3b2"; }

// ---------- auth gate ----------
document.addEventListener("DOMContentLoaded", ()=>{
  const form = $("#pw-form");
  const input = $("#pw");
  const login = $("#login");
  const admin = $("#admin");
  const msg   = $("#msg");

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    msg.textContent = "Checking…";
    try{
      const h = await sha256Hex(input.value || "");
      if(h === PASSWORD_SHA256_HEX){
        login.classList.add("hidden");
        admin.classList.remove("hidden");
        msg.textContent = "";
        input.value = "";
      }else{
        msg.textContent = "Incorrect password.";
      }
    }catch{
      msg.textContent = "Browser crypto not available.";
    }
  });

  initControls();
});

function initControls(){
  const confirmInput = $("#confirm");
  const wipeBtn = $("#wipe");
  const exportBtn = $("#export");

  confirmInput.addEventListener("input", ()=>{
    wipeBtn.disabled = (confirmInput.value.trim().toUpperCase() !== "DELETE");
  });

  exportBtn.addEventListener("click", exportCsv);

  // -------- Wipe all rows (robust: id > 0, then explicit id list) --------
  wipeBtn.addEventListener("click", async ()=>{
    if(wipeBtn.disabled) return;
    if(confirmInput.value.trim().toUpperCase() !== "DELETE") return;

    setStatus("Erasing…");
    wipeBtn.disabled = true;

    try{
      const beforeTotal = await countRows();

      // Pass 1: delete every row via id>0 (covers all normal rows)
      const del1 = await fetch(`${SUPABASE_URL}/rest/v1/${SCORES_TABLE}?id=gt.0`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          "x-admin": ADMIN_HEADER,       // must match RLS policy
          Prefer: "return=minimal"
        }
      });
      if(!del1.ok){
        const t = await del1.text();
        throw new Error(`Delete(1) failed: ${del1.status} ${del1.statusText} — ${t}`);
      }

      // Check remaining rows
      let remaining = await countRows();

      // Pass 2: if anything remains (weird legacy rows), delete by explicit id list
      if(remaining > 0){
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${SCORES_TABLE}?select=id`, {
          headers: {
            apikey: SUPABASE_ANON,
            Authorization: `Bearer ${SUPABASE_ANON}`,
            Prefer: "count=exact"
          }
        });
        if(!r.ok) throw new Error(`Fetch ids failed: ${r.status} ${r.statusText}`);
        const rows = await r.json();
        if(rows.length > 0){
          // IMPORTANT: do NOT URL-encode commas in PostgREST IN lists
          const list = rows.map(x => x.id).join(",");
          const del2 = await fetch(`${SUPABASE_URL}/rest/v1/${SCORES_TABLE}?id=in.(${list})`, {
            method: "DELETE",
            headers: {
              apikey: SUPABASE_ANON,
              Authorization: `Bearer ${SUPABASE_ANON}`,
              "x-admin": ADMIN_HEADER,
              Prefer: "return=minimal"
            }
          });
          if(!del2.ok){
            const t2 = await del2.text();
            throw new Error(`Delete(2) failed: ${del2.status} ${del2.statusText} — ${t2}`);
          }
        }
        remaining = await countRows();
      }

      if(remaining === 0){
        setStatus(`All scores erased. Removed ${beforeTotal} rows.`, true);
        confirmInput.value = "";
      }else{
        setStatus(`Delete ran, but ${remaining} rows remain. Check admin token & delete policy.`);
      }
    }catch(e){
      console.warn(e);
      setStatus("Delete failed. Check admin header token & RLS policy.");
    }finally{
      wipeBtn.disabled = true;
    }
  });
}

// ---------- actions ----------
async function countRows(){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${SCORES_TABLE}?select=id`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      Prefer: "count=exact"
    }
  });
  const cr = r.headers.get("content-range") || "0/0";
  const total = Number((cr.split("/")[1] || "0"));
  return Number.isFinite(total) ? total : 0;
}

async function exportCsv(){
  setStatus("Exporting…");
  try{
    const q = `${SUPABASE_URL}/rest/v1/${SCORES_TABLE}?select=name,score,total,ts&order=score.desc,ts.asc&limit=100`;
    const r = await fetch(q, {
      headers:{ apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
    });
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const rows = await r.json();

    const csv = ["name,score,total,timestamp_iso"];
    rows.forEach(o=>{
      const iso = new Date(Number(o.ts||0)).toISOString();
      csv.push(`${csvEscape(o.name)},${o.score},${o.total},${iso}`);
    });

    const blob = new Blob([csv.join("\n")], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = $("#download");
    a.href = url; a.download = "leaderboard.csv"; a.click();
    URL.revokeObjectURL(url);

    setStatus(`Exported ${rows.length} rows.`, true);
  }catch(e){
    console.warn(e);
    setStatus("Export failed.");
  }
}
