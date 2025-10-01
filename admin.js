
const SUPABASE_URL  = "https://tzmegilrifrlruljfamb.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6bWVnaWxyaWZybHJ1bGpmYW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxNzU2MzEsImV4cCI6MjA3NDc1MTYzMX0.UBpJTuPOg1DOwUvffd_ch0fKwWyYbmOPEpkzIEh3thg";
const SCORES_TABLE  = "scores";

// Must match your RLS policy string exactly:
const ADMIN_HEADER  = "QWIYGDIUQHKNKJZABJHQGIYGWIDBQUKawsdb";


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

  // Enable wipe only when the operator types DELETE
  confirmInput.addEventListener("input", ()=>{
    wipeBtn.disabled = (confirmInput.value.trim().toUpperCase() !== "DELETE");
  });

  exportBtn.addEventListener("click", exportCsv);

  // ---- Wipe via RPC (TRUNCATE) with verification ----
  wipeBtn.addEventListener("click", async ()=>{
    if(wipeBtn.disabled) return;
    if(confirmInput.value.trim().toUpperCase() !== "DELETE") return;

    setStatus("Erasing…");
    wipeBtn.disabled = true;

    try{
      const beforeTotal = await countRows();

      // Call the security-definer function (bypasses RLS, checks token server-side)
      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_wipe_scores`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ admin_token: ADMIN_HEADER }) // MUST equal SQL token
      });
      if(!rpc.ok){
        const t = await rpc.text();
        throw new Error(`RPC wipe failed: ${rpc.status} ${rpc.statusText} — ${t}`);
      }

      // Verify table is empty now
      const afterTotal = await countRows();
      if(afterTotal === 0){
        setStatus(`All scores erased. Removed ${beforeTotal} rows.`, true);
        confirmInput.value = "";
      }else{
        setStatus(`Wipe ran, but ${afterTotal} rows remain. Double-check SQL function + token.`);
      }
    }catch(e){
      console.warn(e);
      setStatus("Delete failed. Check admin token & SQL function/permissions.");
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
