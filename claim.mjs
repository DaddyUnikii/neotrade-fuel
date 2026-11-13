// Klaim NEO AI Fuel Pack (+1.500 kredit) secara manual: jalan hanya saat kamu Run workflow.
// Klaim = mintSoulbound(1) di kontrak kartu NeoTrade (BSC), dari wallet yang tertaut. Hanya bayar gas.
// PACKS=0 -> klaim terus (jeda acak 30-60 dtk) sampai run di-cancel, saldo tipis, atau timeout.
import { createPublicClient, createWalletClient, http, fallback, encodeFunctionData, formatEther, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import fs from "fs";

const ROUTER = "0xA5e24f880E2F21005A014861197eE94c5A63Ae8C";
const ABI = parseAbi(["function mintSoulbound(uint256 typeId) returns (uint256)"]);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const sleep = s => new Promise(r => setTimeout(r, s * 1000));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const out = line => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "- " + line + "\n"); };

const pk = (process.env.PRIVATE_KEY || "").trim();
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(pk)) { console.error("Secret PRIVATE_KEY belum diisi/format salah."); process.exit(1); }
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
const transport = fallback([http("https://bsc.drpc.org"), http("https://bsc-rpc.publicnode.com"), http("https://bsc-dataseed.bnbchain.org")]);
const pub = createPublicClient({ chain: bsc, transport });
const wal = createWalletClient({ chain: bsc, transport, account });

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "### NeoTrade fuel pack\n\n");
out(`Wallet ${account.address.slice(0, 6)}…${account.address.slice(-4)}`);
if (process.env.STATUS_URL) {
  try { const st = await (await fetch(process.env.STATUS_URL.trim().replace("/s/", "/j/"))).json(); out(`Kredit sebelum klaim: ${st.credits ?? "?"} (status worker: ${st.lastError || "aman"})`); }
  catch (e) { log("Gagal baca status Worker:", e.message); }
}

const n0 = Number(process.env.PACKS || 0);
const n = n0 > 0 ? n0 : Infinity;
log(n === Infinity ? "Klaim terus sampai run dihentikan" : `Klaim ${n} fuel pack`);
const data = encodeFunctionData({ abi: ABI, functionName: "mintSoulbound", args: [1n] });
let ok = 0, errs = 0;
for (let i = 0; i < n; i++) {
  try {
    const bal = Number(formatEther(await pub.getBalance({ address: account.address })));
    let gas;
    try { gas = await pub.estimateGas({ account, to: ROUTER, data }); }
    catch (e) { out(`Simulasi gagal, stop: ${e.shortMessage || e.message}`); break; }
    const gp = await pub.getGasPrice();
    if (bal < Number(formatEther(gas * gp * 12n / 10n))) { out(`Saldo BNB ${bal.toFixed(6)} tidak cukup untuk gas, stop.`); break; }
    const hash = await wal.sendTransaction({ to: ROUTER, data, gas: gas * 12n / 10n, gasPrice: gp, value: 0n });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180000 });
    out(`Klaim #${i + 1}: ${rc.status}, gas ${formatEther(rc.gasUsed * rc.effectiveGasPrice)} BNB, https://bscscan.com/tx/${hash}`);
    if (rc.status !== "success") break;
    ok++; errs = 0;
    if (ok === 1 && process.env.STATUS_URL) {   // bangunin Worker kartu (hapus jeda "Kredit habis")
      try {
        const r = await fetch(process.env.STATUS_URL.trim().replace("/s/", "/wake/"), { method: "POST" });
        const j = await r.json().catch(() => ({}));
        out(j.off ? "Worker kartu sedang OFF, tidak dinyalakan." : "Worker kartu dibangunkan.");
      } catch (e) { log("Gagal bangunin Worker:", e.message); }
    }
  } catch (e) {
    if (++errs >= 5) { out(`Error 5x berturut, stop: ${e.shortMessage || e.message}`); break; }
    log("error, coba lagi:", e.shortMessage || e.message); i--;
  }
  if (i < n - 1) { const d = rnd(30, 60); log(`jeda ${d} dtk`); await sleep(d); }
}
out(`Total klaim sukses: ${ok} (+${ok * 1500} kredit)`);
out(`Saldo BNB sekarang: ${Number(formatEther(await pub.getBalance({ address: account.address }))).toFixed(6)}`);
