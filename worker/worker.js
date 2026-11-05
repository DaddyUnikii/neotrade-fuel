// NeoTrade card worker (1 akun). Dipanggil cron (sendiri atau via nt-cron) tiap 3 menit, tiap run kerja ~175 dtk -> POST /v1/cards/next, sama seperti tab web yang fokus.
// Secret: NT_COOKIE (header Cookie dari browser yang sudah login). Var: STATUS_TOKEN.

// State disimpan di Durable Object (konsisten global). KV cuma dipakai untuk migrasi awal,
// karena cache KV per lokasi bikin halaman status telat update.
import { DurableObject } from "cloudflare:workers";
export class StateDO extends DurableObject {
  async get(k) { return (await this.ctx.storage.get(k)) ?? null; }
  async put(k, v) { await this.ctx.storage.put(k, v); }
}
function wrap(env) {
  if (env.__w) return env;
  const stub = env.DO.get(env.DO.idFromName("main"));
  const STATE = {
    async get(k, type) {
      let v = await stub.get(k);
      if (v === null && env.KV) { v = await env.KV.get(k); if (v !== null) await stub.put(k, v); }
      return v === null ? null : (type === "json" ? JSON.parse(v) : v);
    },
    put: (k, v) => stub.put(k, v),
  };
  return { ...env, STATE, __w: true };
}

const BASE = "https://app.neotrade.pro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const BACKOFF_MIN = { unauthorized: 30, insufficient_credits: 5, no_cookie: 30 };

async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s || ""));
  return [...new Uint8Array(b)].slice(0, 6).map(x => x.toString(16).padStart(2, "0")).join("");
}

async function getState(env) {
  return (await env.STATE.get("state", "json")) || { cards: 0, history: [] };
}
async function putState(env, st) { await env.STATE.put("state", JSON.stringify(st)); }

const WINDOW_MS = 175000;              // cron tiap 3 menit, tiap run kerja ~175 dtk
const gap = () => (10 + Math.floor(Math.random() * 51)) * 1000; // jeda acak 10-60 dtk
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callCard(ck) {
  const res = await fetch(BASE + "/v1/cards/next", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "Cookie": ck, "Origin": BASE, "Referer": BASE + "/", "User-Agent": UA },
    body: JSON.stringify({ locale: "en" }),
  });
  return { res, data: await res.json().catch(() => null) };
}

async function tick(env) {
  const start = Date.now();
  const st = await getState(env);
  const ck = (env.NT_COOKIE || "").trim();
  const h = await sha(ck);
  if (st.cookieHash !== h) { st.cookieHash = h; st.pauseUntil = 0; st.lastError = null; }
  if (!ck) { if (st.lastError !== "no_cookie") { st.lastError = "no_cookie"; st.lastErrorAt = start; await putState(env, st); } return; }
  if ((await env.STATE.get("off")) === "1") return; // dimatikan dari tombol OFF
  if (st.pauseUntil && start < st.pauseUntil) return;

  let next = start + Math.floor(Math.random() * 10000), changed = false;
  while (true) {
    const wait = Math.max(0, next - Date.now());
    if (Date.now() + wait - start > WINDOW_MS) break;
    await sleep(wait);
    if ((await env.STATE.get("off")) === "1") { st.off = true; break; }
    let r;
    try { r = await callCard(ck); }
    catch (e) { st.lastError = "network: " + String(e).slice(0, 80); st.lastErrorAt = Date.now(); changed = true; next = Date.now() + 30000; continue; }
    const { res, data } = r, t = Date.now();
    if (res.ok && data) {
      const l = data.ledger || {};
      st.cards = (st.cards || 0) + 1; st.lastCardAt = t;
      st.credits = l.credits ?? st.credits; st.npt = l.npt ?? st.npt;
      st.lastError = null; st.pauseUntil = 0; changed = true;
      st.history = [{ t, credits: st.credits, npt: st.npt }, ...(st.history || [])].slice(0, 30);
      await putState(env, st); changed = false;   // simpan tiap kartu (Durable Object, murah) -> status real-time
      next = t + gap(); continue;
    }
    if (res.status === 204 || res.ok) { next = t + gap(); continue; }
    const code = data?.error?.code || ("http_" + res.status);
    const retry = data?.error?.retry_after_sec;
    if (code === "too_soon" || code === "feed_busy") { next = t + Math.max(retry ? retry * 1000 : 0, gap()); continue; }
    st.lastError = code; st.lastErrorAt = t; changed = true;
    if (BACKOFF_MIN[code]) { st.pauseUntil = t + BACKOFF_MIN[code] * 60000; break; }
    next = t + 5 * 60000;
  }
  if (changed) await putState(env, st);
}

function fmt(t) { return t ? new Date(t).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB" : "-"; }

export default {
  async scheduled(ev, env, ctx) { env = wrap(env); ctx.waitUntil(tick(env)); },
  async fetch(req, env) { env = wrap(env);
    const u = new URL(req.url);
    if (req.method === "POST" && u.pathname === "/tick/" + env.STATUS_TOKEN) { await tick(env); return new Response("ok"); } // dipanggil nt-cron
    if (req.method === "POST" && (u.pathname === "/on/" + env.STATUS_TOKEN || u.pathname === "/off/" + env.STATUS_TOKEN)) {
      const on = u.pathname.startsWith("/on/");
      const s2 = await getState(env); s2.off = !on; if (on) { s2.pauseUntil = 0; s2.lastError = s2.lastError === "no_cookie" ? s2.lastError : null; }
      await putState(env, s2); await env.STATE.put("off", on ? "0" : "1");
      return Response.redirect(u.origin + "/s/" + env.STATUS_TOKEN, 303);
    }
    const st0 = u.pathname === "/j/" + env.STATUS_TOKEN;
    if (!st0 && u.pathname !== "/s/" + env.STATUS_TOKEN) return new Response("not found", { status: 404 });
    const st = await getState(env);
    st.off = (await env.STATE.get("off")) === "1";
    if (st0) return Response.json({ off: !!st.off, credits: st.credits ?? null, npt: st.npt ?? null, lastCardAt: st.lastCardAt || null, lastError: st.lastError || null, pauseUntil: st.pauseUntil || 0, cards: st.cards || 0 }, { headers: { "cache-control": "no-store" } });
    const msg = {
      no_cookie: "Cookie belum diisi (secret NT_COOKIE).",
      unauthorized: "Cookie kedaluwarsa/logout. Ganti secret NT_COOKIE.",
      insufficient_credits: "Kredit habis. Klaim fuel pack di web, worker coba lagi tiap 5 menit.",
    }[st.lastError] || st.lastError || "Aman";
    const rows = (st.history || []).map(x => `<tr><td>${fmt(x.t)}</td><td>${x.credits ?? "-"}</td><td>${x.npt ?? "-"}</td></tr>`).join("");
    const html = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><meta http-equiv=refresh content=60>
<title>NeoTrade worker</title><body style="font-family:system-ui;max-width:520px;margin:20px auto;padding:0 12px">
<h2>NeoTrade worker · akun ${env.ACCOUNT || 1}</h2>
<p><b>Worker:</b> ${st.off ? "🔴 OFF" : "🟢 ON"} &nbsp;
<form method=post action="/${st.off ? "on" : "off"}/${env.STATUS_TOKEN}" style="display:inline"><button style="font-size:16px;padding:6px 16px">${st.off ? "Nyalakan" : "Matikan"}</button></form></p>
<p><b>Status:</b> ${st.off ? "Dimatikan" : msg}</p>
<p>Kartu via worker: <b>${st.cards || 0}</b><br>Kartu terakhir: ${fmt(st.lastCardAt)}<br>Kredit: <b>${st.credits ?? "-"}</b> · NPT: <b>${st.npt ?? "-"}</b><br>
${st.lastError ? "Error terakhir: " + fmt(st.lastErrorAt) + "<br>" : ""}${st.pauseUntil > Date.now() ? "Jeda sampai: " + fmt(st.pauseUntil) : ""}</p>
<table border=1 cellpadding=4 style="border-collapse:collapse"><tr><th>Waktu</th><th>Kredit</th><th>NPT</th></tr>${rows}</table></body>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  },
};
