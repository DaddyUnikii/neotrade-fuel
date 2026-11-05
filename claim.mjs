// Auto-claim NEO AI Fuel Pack (+1.500 kredit) saat kredit NeoTrade menipis.
// Klaim = mintSoulbound(1) di kontrak kartu NeoTrade (BSC), dari wallet yang tertaut. Hanya bayar gas.
import { createPublicClient, createWalletClient, http, fallback, encodeFunctionData, formatEther, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

const ROUTER = "0xA5e24f880E2F21005A014861197eE94c5A63Ae8C";
const ABI = parseAbi(["function mintSoulbound(uint256 typeId) returns (uint256)"]);
const THRESHOLD = Number(process.env.THRESHOLD || 1600);      // klaim kalau kredit di bawah ini
const MIN_PACKS = Number(process.env.MIN_PACKS || 2);
const MAX_PACKS = Number(process.env.MAX_PACKS || 3);
const MIN_BNB = 0.002;                                        // sisakan minimal segini di wallet
const FORCE = process.env.FORCE === "true";
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const sleep = s => new Promise(r => setTimeout(r, s * 1000));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const summary = [];

const pk = (process.env.PRIVATE_KEY || "").trim();
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(pk)) { console.error("Secret PRIVATE_KEY belum diisi/format salah."); process.exit(1); }
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
const transport = fallback([http("https://bsc.drpc.org"), http("https://bsc-rpc.publicnode.com"), http("https://bsc-dataseed.bnbchain.org")]);
const pub = createPublicClient({ chain: bsc, transport });
const wal = createWalletClient({ chain: bsc, transport, account });

async function status() {
  const r = await fetch(process.env.STATUS_URL, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error("status " + r.status);
  return r.json();
}

const wait = FORCE ? 0 : rnd(0, 300);               // jam acak: tunda 0-5 menit
log(`Wallet ${account.address.slice(0, 6)}…${account.address.slice(-4)}, tunda ${wait} dtk`); await sleep(wait);

let st = null;
try { st = await status(); } catch (e) { log("Gagal baca status Worker:", e.message); }
const stale = !st?.lastCardAt || Date.now() - st.lastCardAt > 2 * 3600e3;
// Worker mati (cookie dihapus/kedaluwarsa) atau lama tidak ambil kartu -> jangan klaim
const workerOff = !st || st.lastError === "no_cookie" || st.lastError === "unauthorized" || (stale && st.lastError !== "insufficient_credits");
const low = st && !workerOff && (st.lastError === "insufficient_credits" || (st.credits != null && st.credits < THRESHOLD));
if (workerOff) log("Worker tidak aktif, tidak klaim.");
log("Status:", JSON.stringify(st));
if (st?.lastError === "unauthorized" || st?.lastError === "no_cookie") log("PERINGATAN: cookie Worker kedaluwarsa, kartu berhenti. Ganti NT_COOKIE di Cloudflare.");

if (!FORCE && !low) { summary.push(`Kredit ${st?.credits ?? "?"} ≥ ${THRESHOLD}, tidak klaim.`); }
else {
  const n = FORCE ? Number(process.env.PACKS || 1) : rnd(MIN_PACKS, MAX_PACKS);
  log(`Klaim ${n} fuel pack`);
  for (let i = 0; i < n; i++) {
    const bal = Number(formatEther(await pub.getBalance({ address: account.address })));
    const data = encodeFunctionData({ abi: ABI, functionName: "mintSoulbound", args: [1n] });
    let gas;
    try { gas = await pub.estimateGas({ account, to: ROUTER, data }); }
    catch (e) { summary.push(`Simulasi gagal, stop: ${e.shortMessage || e.message}`); break; }
    const gp = await pub.getGasPrice();
    const fee = Number(formatEther(gas * gp * 12n / 10n));
    if (bal - fee < MIN_BNB) { summary.push(`Saldo BNB ${bal.toFixed(6)} terlalu tipis, stop.`); break; }
    const hash = await wal.sendTransaction({ to: ROUTER, data, gas: gas * 12n / 10n, gasPrice: gp, value: 0n });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180000 });
    const cost = formatEther(rc.gasUsed * rc.effectiveGasPrice);
    log(`#${i + 1} ${rc.status} ${hash} gas ${cost} BNB`);
    summary.push(`Klaim #${i + 1}: ${rc.status}, gas ${cost} BNB, https://bscscan.com/tx/${hash}`);
    if (rc.status !== "success") break;
    if (i < n - 1) await sleep(rnd(20, 90));          // jeda acak antar klaim
  }
}
const bal = formatEther(await pub.getBalance({ address: account.address }));
summary.push(`Saldo BNB sekarang: ${Number(bal).toFixed(6)}`);
console.log(summary.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) (await import("fs")).appendFileSync(process.env.GITHUB_STEP_SUMMARY, "### NeoTrade fuel pack\n\n" + summary.map(s => "- " + s).join("\n") + "\n");
