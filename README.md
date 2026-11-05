# neotrade-fuel

Klaim fuel pack NeoTrade secara manual: hanya jalan saat kamu klik Run workflow. Pilih akun 1-6, isi packs (0 = klaim terus dengan jeda acak 30-60 dtk sampai di-cancel, saldo BNB < 0,002, atau 350 menit).

Secrets per akun (Settings → Secrets and variables → Actions):
- Akun 1: `PRIVATE_KEY`, `STATUS_URL`
- Akun 2-6: `PRIVATE_KEY_2` … `PRIVATE_KEY_6`, `STATUS_URL_2` … `STATUS_URL_6`

PRIVATE_KEY = key wallet yang tertaut ke akun NeoTrade itu.
