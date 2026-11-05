// nt-cron: satu cron (tiap 3 menit) yang menjalankan semua worker akun lewat service binding,
// plus satu halaman status gabungan dengan tombol ON/OFF per akun.
const fmt = t => t ? new Date(t).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB" : "-";
const MSG = { no_cookie: "Cookie belum diisi", unauthorized: "Cookie kedaluwarsa", insufficient_credits: "Kredit habis" };

export default {
  async scheduled(ev, env, ctx) {
    const accs = JSON.parse(env.ACCOUNTS);
    ctx.waitUntil(Promise.all(accs.map(async a => {
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 8000)));
      try { await env[a.b].fetch("https://nt/tick/" + a.t, { method: "POST" }); } catch (e) { console.log(a.b, String(e)); }
    })));
  },
  async fetch(req, env) {
    const u = new URL(req.url), M = env.MASTER_TOKEN, accs = JSON.parse(env.ACCOUNTS);
    const m = u.pathname.match(/^\/(on|off|allon|alloff)\/([^/]+)(?:\/(\d))?$/);
    if (req.method === "POST" && m && m[2] === M) {
      const targets = m[1].startsWith("all") ? accs : accs.filter(a => a.b === "S" + m[3]);
      const act = m[1].replace("all", "");
      await Promise.all(targets.map(a => env[a.b].fetch(`https://nt/${act}/${a.t}`, { method: "POST", redirect: "manual" })));
      return Response.redirect(u.origin + "/s/" + M, 303);
    }
    if (u.pathname !== "/s/" + M) return new Response("not found", { status: 404 });
    const rows = await Promise.all(accs.map(async a => {
      try { return { n: a.b.slice(1), ...(await (await env[a.b].fetch("https://nt/j/" + a.t)).json()) }; }
      catch (e) { return { n: a.b.slice(1), err: true }; }
    }));
    let tc = 0, tn = 0;
    const tr = rows.map(r => {
      tc += r.credits || 0; tn += r.npt || 0;
      const st = r.err ? "error" : r.off ? "🔴 OFF" : (MSG[r.lastError] ? "⚠️ " + MSG[r.lastError] : r.lastError || "🟢 ON");
      const btn = r.err ? "" : `<form method=post action="/${r.off ? "on" : "off"}/${M}/${r.n}"><button>${r.off ? "Nyalakan" : "Matikan"}</button></form>`;
      return `<tr><td><b>${r.n}</b></td><td>${st}</td><td>${r.credits ?? "-"}</td><td>${r.npt ?? "-"}</td><td>${r.cards ?? 0}</td><td style="font-size:12px">${fmt(r.lastCardAt)}</td><td>${btn}</td></tr>`;
    }).join("");
    const html = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><meta http-equiv=refresh content=30>
<title>NeoTrade workers</title><body style="font-family:system-ui;max-width:760px;margin:16px auto;padding:0 10px">
<h2>NeoTrade workers</h2>
<p><form method=post action="/allon/${M}" style="display:inline"><button>Nyalakan semua</button></form>
<form method=post action="/alloff/${M}" style="display:inline"><button>Matikan semua</button></form></p>
<div style="overflow-x:auto"><table border=1 cellpadding=5 style="border-collapse:collapse;font-size:14px">
<tr><th>Akun</th><th>Status</th><th>Kredit</th><th>NPT</th><th>Kartu</th><th>Terakhir</th><th></th></tr>${tr}
<tr><td colspan=2><b>Total</b></td><td><b>${tc}</b></td><td><b>${tn}</b></td><td colspan=3></td></tr></table></div>
<p style="color:#666;font-size:12px">Refresh otomatis tiap 30 detik. Worker narik kartu terus dengan jeda acak 10–60 detik, angka langsung ter-update tiap kartu.</p></body>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  },
};
