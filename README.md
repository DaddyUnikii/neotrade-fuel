# NeoTrade auto-card + fuel pack

Toolkit buat NeoTrade (app.neotrade.pro):

1. **Worker kartu** (Cloudflare Workers, gratis): narik kartu `POST /v1/cards/next` terus-menerus 24 jam, tanpa tab browser terbuka. Tiap kartu −80 kredit, +80 NPT.
2. **Halaman status** dengan tombol ON/OFF, per akun dan gabungan semua akun.
3. **Bot fuel pack** (GitHub Actions, manual): klaim NEO AI Fuel Pack (+1.500 kredit per pack) on-chain dari wallet yang ter-link. Cuma bayar gas BNB.

> Punya AI agent? Suruh dia baca [`AGENTS.md`](AGENTS.md) dulu. Isinya langkah setup lengkap + aturan keamanan buat agent.

---

## Cara kerja singkat

```
Cloudflare
 ├─ nt-card-1  (Worker akun 1) ──► app.neotrade.pro /v1/cards/next   (pakai cookie akun 1)
 ├─ nt-card-2  (Worker akun 2) ──► ...                               (cookie akun 2)
 └─ nt-cron    (opsional, multi-akun) : cron */3 menit → panggil semua nt-card-N
                                         + halaman status gabungan

GitHub Actions (repo ini, di-fork)
 └─ "NeoTrade fuel pack" (manual) ──► BSC: mintSoulbound(1) di 0xA5e2…AC8C  (+1.500 kredit)
```

- Tiap run cron, Worker kerja ±175 detik: narik kartu dengan jeda acak 10–60 detik, lalu berhenti. Cron berikutnya lanjut lagi. Jadi kartunya jalan terus, bukan cuma tiap 3 menit.
- State (jumlah kartu, kredit, NPT, riwayat 30 kartu terakhir) disimpan di Durable Object, jadi halaman status langsung update tiap kartu.
- Kalau kredit habis → Worker pause 30 menit lalu coba lagi. Cookie kedaluwarsa → status "Cookie kedaluwarsa", ganti secret `NT_COOKIE`.

---

## Yang kamu butuhkan

- Akun NeoTrade yang sudah login + wallet BSC ter-link (untuk fuel pack).
- Akun Cloudflare (Free cukup).
- Akun GitHub (untuk bot fuel pack).
- Node.js 18+ kalau mau deploy pakai `wrangler` dari komputer (atau pakai dashboard Cloudflare).

---

## Setup 1 akun

### 1. Ambil cookie NeoTrade
1. Buka https://app.neotrade.pro di Chrome, login.
2. F12 → tab **Application** → **Cookies** → `https://app.neotrade.pro` → copy nilai `ntw_session`.
3. Formatnya nanti: `ntw_session=NILAINYA`.
4. **Jangan logout** dari tab itu. Logout = cookie mati. Cukup tutup tabnya.
5. Jangan biarkan tab kartu NeoTrade tetap terbuka, nanti rebutan sama Worker (`too_soon`).

### 2. Deploy Worker
```bash
git clone https://github.com/<kamu>/neotrade-fuel && cd neotrade-fuel/worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put NT_COOKIE      # paste: ntw_session=....
npx wrangler secret put STATUS_TOKEN   # paste string acak, mis. hasil: openssl rand -hex 8
```
Halaman status: `https://nt-card-1.<subdomain-kamu>.workers.dev/s/<STATUS_TOKEN>`
JSON: ganti `/s/` jadi `/j/`.

Lewat dashboard juga bisa: Workers & Pages → Create → upload `worker.js`, tambah binding Durable Object `DO` (class `StateDO`), var `ACCOUNT`, secrets di Settings → Variables and Secrets, cron di Settings → Triggers.

### 3. Bot fuel pack (opsional)
1. Fork repo ini. Di fork, buka tab **Actions** → aktifkan workflow.
2. Settings → Secrets and variables → Actions → **New repository secret**:
   - `PRIVATE_KEY` = private key wallet yang ter-link ke akun NeoTrade itu. Isi wallet dengan sedikit BNB buat gas.
   - `STATUS_URL` = URL halaman status Worker (opsional, cuma buat nampilin kredit sebelum klaim).
3. Actions → **NeoTrade fuel pack** → Run workflow → pilih akun, isi `packs`:
   - `0` = klaim terus (jeda acak 30–60 detik) sampai di-cancel, saldo BNB < 0,002, atau 350 menit.
   - `N` = klaim N pack.

Saran: pakai wallet khusus yang isinya cuma BNB buat gas, bukan wallet utama.

---

## Setup multi-akun (sampai 6, bisa ditambah)

Cloudflare Free cuma kasih **5 cron trigger** per akun Cloudflare, jadi pakai dispatcher:

1. Untuk tiap akun N: copy `worker/wrangler.toml`, ganti `name = "nt-card-N"` dan `ACCOUNT = "N"`, **hapus blok `[triggers]`**, deploy, isi `NT_COOKIE` + `STATUS_TOKEN` masing-masing.
2. Cookie tiap akun diambil dari **profil Chrome terpisah** (atau browser berbeda). Jangan logout.
3. Deploy dispatcher:
   ```bash
   cd dispatcher
   # edit wrangler.toml: daftar services S1..SN
   npx wrangler deploy
   npx wrangler secret put MASTER_TOKEN
   npx wrangler secret put ACCOUNTS   # [{"b":"S1","t":"<token akun1>"},{"b":"S2","t":"<token akun2>"}]
   ```
4. Halaman gabungan: `https://nt-cron.<subdomain>.workers.dev/s/<MASTER_TOKEN>`. Tabel semua akun, total kredit/NPT, tombol ON/OFF per akun + nyalakan/matikan semua. Refresh otomatis tiap 30 detik.
5. Bot fuel: secret `PRIVATE_KEY_2`, `STATUS_URL_2`, dst. (akun 1 tetap `PRIVATE_KEY` / `STATUS_URL`). Pilih akun di dropdown waktu Run workflow. Lebih dari 6 akun: tambah angka di `options` di `.github/workflows/claim.yml`.

---

## Cara berhenti

- Kartu: tombol **Matikan** di halaman status, atau hapus secret `NT_COOKIE`.
- Fuel pack: Cancel run di Actions, atau Actions → workflow → **Disable workflow**.

## Status & error

| Status | Arti | Solusi |
|---|---|---|
| Aman / 🟢 ON | jalan normal | – |
| Cookie belum diisi | secret `NT_COOKIE` kosong | isi secretnya |
| Cookie kedaluwarsa | logout / sesi habis | ambil cookie baru, ganti secret |
| Kredit habis | kredit < 80 | klaim fuel pack; Worker coba lagi tiap 30 menit |

## Risiko (baca dulu)

- Otomasi dan multi-akun bisa melanggar aturan NeoTrade dan dianggap sybil (akun bisa di-flag/banned, reward hangus). Semua akun dari Worker keluar lewat IP Cloudflare yang mirip. Tanggung sendiri.
- `NT_COOKIE` = akses penuh ke sesi akunmu. `PRIVATE_KEY` = akses penuh ke wallet. Simpan **hanya** di Cloudflare Secrets / GitHub Secrets. Jangan commit, jangan kirim ke chat, jangan screenshot.
- URL status berisi token. Siapa pun yang pegang link bisa ON/OFF. Kalau bocor, ganti `STATUS_TOKEN` / `MASTER_TOKEN`.
- Repo publik aman untuk secrets: GitHub Secrets tidak ikut ke fork dan tidak tampil di log (kode ini tidak pernah print secret).
- Kontrak fuel pack (`0xA5e24f880E2F21005A014861197eE94c5A63Ae8C`, BSC): `mintSoulbound(1)`, value 0, tanpa approve token apa pun.
