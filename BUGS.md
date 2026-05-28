# 🐛 Bug Audit Report — AntriPhotobooth

**Tanggal Audit:** 2026-05-25
**Total Bug Ditemukan:** 45
**Severity Breakdown:** 4 Critical · 13 High · 19 Medium · 9 Low

> Laporan ini hasil review menyeluruh terhadap `js/customer.js`, `js/sekretariat.js`, `js/pengambilan.js`, `js/admin.js`, `js/monitor.js`, `js/auth.js`, `shared/ui.js`, `shared/config.js`, semua edge functions di `supabase/functions/`, RLS policies, dan migrations.

## 📋 Daftar Isi

- [Priority Fix Order](#priority-fix-order)
- [🔴 CRITICAL Bugs](#-critical-bugs-4)
- [🟠 HIGH Bugs](#-high-bugs-13)
- [🟡 MEDIUM Bugs](#-medium-bugs-19)
- [🟢 LOW Bugs](#-low-bugs-9)

---

## Priority Fix Order

| # | Area | Bug IDs | Effort |
|---|---|---|---|
| 1 | RLS Hardening | BUG-001, 008, 016, 030 | High |
| 2 | Smart Payment Logic | BUG-002, 005, 006, 007 | Medium |
| 3 | Quota Counter Integrity | BUG-003, 009, 011 | Medium |
| 4 | Webhook Idempotency | BUG-004, 015 | Medium |
| 5 | Realtime Subscription Hygiene | BUG-012, 013, 027, 033 | Low |
| 6 | Atomicity (submit + payment) | BUG-014 | Low |
| 7 | UX Correctness | BUG-005, 010, 021, 023, 031 | Low |

---

## 🔴 CRITICAL Bugs (4)

### BUG-001 | RLS terlalu permissive untuk tabel `queues`
**Severity:** Critical
**Status:** ✅ FIXED (2026-05-25)
**Migration:** `supabase/migrations/rls_hardening.sql`
**File:** `supabase/rls_policies.sql:46-50`

```sql
CREATE POLICY "Public update access for queues"
ON queues FOR UPDATE
TO public USING (true);
```

**Description:** Anon key publicly exposed di client-side (normal untuk Supabase). Tapi policy UPDATE `USING (true)` artinya siapa saja bisa modify field apapun di `queues` lewat browser console.

**Reproduce:**
```js
// Buka customer.html → console
await supabaseClient.from('queues')
  .update({ payment_status: 'lunas' })
  .eq('nomor_antrian', 'SMAP-0001');
// → langsung sukses, tanpa auth
```

**Impact:** Foundational issue — mendasari BUG-008, BUG-016, BUG-030. Setiap mutasi sensitif (payment, pickup, notes) bisa di-spoof.

**Suggested Fix:**
1. Pindahkan semua mutasi ke SECURITY DEFINER RPC dengan validasi
2. Buat RPC: `customer_update_payment_method(nomor_antrian, method, channel)`, `customer_update_order(...)` dst
3. Revoke `UPDATE` policy untuk public, hanya allow specific column lewat RPC

---

### BUG-002 | Smart Payment "Kasus 2" (belum_lunas) tidak di-handle
**Severity:** Critical
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/customer.js:625-633`

```javascript
} else if (priceInfo) {
    // Kasus 2: status awal BELUM LUNAS
    // ...
    shouldUpdate = false;  // ← TIDAK update notes!
}
```

**Description:** Saat customer edit pesanan yang sudah partial-paid, payment note "Kurang bayar Rp X" jadi stale karena tidak di-recalculate berdasarkan harga baru.

**Reproduce:**
1. Customer pesan Rp 80k → set lunas
2. Edit tambah jadi Rp 120k → status `belum_lunas`, notes "Kurang bayar Rp 40k"
3. Edit lagi: kurangi jadi Rp 100k
4. Note masih bilang "kurang Rp 40k" — padahal seharusnya "kurang Rp 20k" (sudah dibayar 80k dari 100k)

**Impact:** Customer bayar selisih lebih dari yang seharusnya. "Kas Diterima" di sekretariat salah hitung.

**Suggested Fix:**
```javascript
} else if (priceInfo) {
    // Hitung paid amount dari note lama
    const oldKurang = parsePaymentNoteAmount(priceInfo.oldPaymentNote, 'Kurang bayar');
    const paidAmount = priceInfo.oldTotal - oldKurang;
    const newKurang = priceInfo.newTotal - paidAmount;

    if (newKurang > 0) {
        newPaymentStatus = 'belum_lunas';
        paymentNoteOnly = `Kurang bayar: ${formatCurrency(newKurang)} ...`;
    } else if (newKurang < 0) {
        newPaymentStatus = 'lunas';
        paymentNoteOnly = `Kelebihan bayar: ${formatCurrency(-newKurang)} ...`;
    } else {
        newPaymentStatus = 'lunas';
        paymentNoteOnly = '';
    }
    shouldUpdate = true;
}
```

---

### BUG-003 | `current_ticket_count` tidak pernah di-decrement
**Severity:** Critical
**Status:** ✅ FIXED (2026-05-25) — sekaligus fix BUG-009
**File:** `js/sekretariat.js` (delete operations) + `supabase/migrations/add_booth_quota_and_schedule.sql`
**Migration:** `supabase/migrations/fix_quota_counter_integrity.sql`

**Description:** Counter quota di `booths.current_ticket_count` hanya di-increment saat `submit_queue`. Tidak ada logic decrement untuk:
- Status `batal`
- Bulk delete (resetAllQueues)
- Delete booth
- Import data (replaces existing)

**Reproduce:**
1. Booth `max_capacity = 30`
2. 30 customer daftar → counter = 30
3. 25 di antaranya batal → tiket aktif tinggal 5
4. Counter masih = 30 → booth status "FULL", customer baru di-block padahal slot kosong

**Impact:** False positive "kuota habis", revenue lost.

**Suggested Fix:**
Opsi 1 (recommended): hitung dynamic
```sql
-- Di submit_queue, ganti baca current_ticket_count dengan:
SELECT COUNT(DISTINCT nomor_antrian) INTO v_current
FROM queues
WHERE booth_id = p_booth_id AND status != 'batal';
IF v_current >= v_booth.max_capacity THEN ...
```

Opsi 2: Trigger
```sql
CREATE TRIGGER decrement_quota AFTER UPDATE OF status ON queues
WHEN (NEW.status = 'batal' AND OLD.status != 'batal')
EXECUTE FUNCTION decrement_booth_count();
```

---

### BUG-004 | Webhook tidak idempotent terhadap amount
**Severity:** Critical
**Status:** ⚠️ PARTIALLY FIXED (2026-05-25) — idempotency handled, audit trail belum
**File:** `supabase/functions/payment-webhook/index.ts:60-110`

**Description:** Webhook handler:
1. Tidak verify amount yang dibayar = total order
2. Tidak ada audit trail per transaksi
3. Tidak handle duplicate webhook delivery
4. Saat partial payment (BUG-002), webhook tetap mark `lunas` full

**Reproduce:**
1. Customer total Rp 120k, partial-paid Rp 40k via PaymenKu
2. Webhook fired → DB di-update `lunas`, notes cleared
3. Padahal customer cuma bayar Rp 40k untuk selisih, bukan total
4. Tidak ada record berapa total yang sudah dibayar

**Impact:** Salah financial reporting, lost audit trail, possible fraud.

**Suggested Fix:**
```sql
CREATE TABLE payment_events (
    id BIGSERIAL PRIMARY KEY,
    nomor_antrian TEXT NOT NULL,
    trx_id TEXT UNIQUE NOT NULL,  -- idempotency
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```
Webhook insert ke tabel ini, lalu reconcile total `paid_amount` per nomor_antrian sebelum mark lunas.

---

## 🟠 HIGH Bugs (13)

### BUG-005 | Toggle ke `lunas` di sekretariat tidak clear "Kurang bayar" note
**Severity:** High
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/sekretariat.js:743-770` (`togglePayment`)

**Description:** Sekretariat klik tombol toggle dari "Belum" ke "Lunas". Status berubah, tapi `notes` "Kurang bayar Rp 40k" tetap ada → "Kas Diterima" hitung sebagai partial padahal sudah lunas full.

**Reproduce:**
1. Customer punya note "Kurang bayar Rp 40k", status belum_lunas
2. Sekretariat klik toggle → status jadi lunas
3. Note masih "Kurang bayar" → kalkulasi kas: `totalHarga - 40k` (salah, harusnya `totalHarga`)

**Suggested Fix:** Di `togglePayment`, kalau new status `lunas`, juga clear payment note (preserve manual notes):
```javascript
const parsed = parseNotes(customer.notes);
const cleanedNotes = combineNotes(parsed.manual, '');
await supabase.from('queues')
  .update({ payment_status: newStatus, notes: cleanedNotes })
  .eq('nomor_antrian', nomorAntrian);
```

---

### BUG-006 | Race condition: customer edit + webhook concurrent
**Severity:** High
**Status:** ✅ FIXED (2026-05-25) — conditional update di webhook (only if still belum_lunas)
**File:** `js/customer.js:620-680` × `supabase/functions/payment-webhook/index.ts:62-110`

**Description:** Customer klik "BAYAR SEKARANG" → redirect ke gateway. Selagi customer bayar, customer juga edit pesanan di tab lain. Webhook fired di tengah-tengah → DB state inconsistent.

**Reproduce:**
1. Tab A: customer bayar selisih Rp 40k via gateway
2. Tab B: customer edit pesanan, kurangi item → status berubah
3. Webhook fired antar Tab A & B → status & notes timpa-timpa

**Suggested Fix:**
- Lock row saat edit: `SELECT FOR UPDATE` di `update_queue_order` RPC
- Atau: cek `updated_at` (optimistic concurrency)

---

### BUG-007 | `saveNotes` race: resurrect stale payment note
**Severity:** High
**Status:** ✅ FIXED (2026-05-25) — re-fetch dari DB sebelum combine
**File:** `js/sekretariat.js:1011-1037`

**Description:** `saveNotes` baca `customer.notes` dari local cache, gabung dengan input baru, write ke DB. Kalau realtime update datang antara baca-cache dan write, payment note yang baru di-clear bisa "hidup lagi".

**Reproduce:**
1. Sekretariat buka modal notes (cache: `manual: "VIP", payment: "Kurang bayar 40k"`)
2. Webhook fire bersamaan → DB clear payment note
3. Sekretariat ketik "VIP penting" → save → combine dengan stale `payment` dari cache
4. Payment note "Kurang bayar 40k" muncul lagi

**Suggested Fix:** Re-fetch dari DB sebelum combine:
```javascript
const { data: fresh } = await supabase.from('queues').select('notes').eq('nomor_antrian', n).limit(1).single();
const payment = parseNotes(fresh.notes).payment;
const combined = combineNotes(trimmed, payment);
```

---

### BUG-008 | `payment-return.html` update via anon (bypass webhook signature)
**Severity:** High
**Status:** ✅ FIXED (2026-05-25) — hapus client-side update, rely on webhook
**File:** `payment-return.html:55-72`

**Description:** Halaman return dari payment gateway langsung update DB lewat anon client (bukan webhook). User bisa craft URL untuk auto-mark lunas tanpa benar-benar bayar.

**Reproduce:**
```
https://app.com/payment-return.html?order_id=SMAP-0001
```
Cek-payment edge function panggil PaymenKu API. Kalau response paid → return.html langsung update `payment_status: lunas`. Tapi attacker bisa intercept dan modify response, atau langsung run di console.

**Suggested Fix:** Hapus update di return.html. Hanya tampilkan status. Yang authoritative adalah webhook.

---

### BUG-009 | Quota check race tanpa `FOR UPDATE`
**Severity:** High
**Status:** ✅ FIXED (2026-05-25) — sekalian dengan BUG-003
**File:** `supabase/migrations/add_booth_quota_and_schedule.sql:38-58`
**Migration:** `supabase/migrations/fix_quota_counter_integrity.sql`

**Description:** Validasi quota di `submit_queue` tidak pakai `SELECT FOR UPDATE`. Dua customer simultan untuk slot terakhir bisa lolos sama-sama.

**Reproduce:**
1. Booth max=30, current=29
2. Customer A & B submit bersamaan
3. Both reads `current=29`, both pass check, both insert → final `current=31`

**Suggested Fix:**
```sql
SELECT * INTO v_booth FROM booths
WHERE id = p_booth_id AND is_active = true
FOR UPDATE;  -- Lock row
```

---

### BUG-010 | Notif "sisa N antrian" misfire on restore
**Severity:** High
**Status:** ✅ FIXED (2026-05-25) — grace period 3 detik untuk skip notif initial render
**File:** `js/customer.js` (notification logic in `renderTicketStatuses`)

**Description:** Saat customer reload page, status di-restore dari DB. Notif counter "sisa 2 antrian lagi" yang harusnya cuma fire saat transition, ikut fire pas restore → bunyi notif tanpa konteks.

**Suggested Fix:** Track previous state di memory, fire notif hanya saat transition (`prev != now`).

---

### BUG-012 | Realtime subscription customer tanpa filter booth
**Severity:** High
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/customer.js:1166-1184` (`subscribeMyTicket`)

**Description:**
```javascript
.on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, ...)
```
Tidak ada filter `booth_id` atau `nomor_antrian`. Setiap customer dapat semua update queue dari semua booth → bandwidth waste + bisa leak data.

**Suggested Fix:**
```javascript
.on('postgres_changes', {
    event: '*', schema: 'public', table: 'queues',
    filter: 'booth_id=eq.' + currentBoothId
}, ...)
```

---

### BUG-013 | Sekretariat realtime subscription tidak unsubscribe
**Severity:** High
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/sekretariat.js:1031-1041`

**Description:** `subscribeRealtime()` create channel tapi tidak ada cleanup saat user logout/leave. Tab tetap subscribe → memory leak + data tetap di-fetch.

**Suggested Fix:**
```javascript
let queueChannel, boothChannel;
function subscribeRealtime() {
    if (queueChannel) supabaseClient.removeChannel(queueChannel);
    queueChannel = supabaseClient.channel(...).subscribe();
    // dst
}
window.addEventListener('beforeunload', () => {
    if (queueChannel) supabaseClient.removeChannel(queueChannel);
});
```

---

### BUG-014 | submit_queue + payment_method update non-atomic
**Severity:** High
**File:** `js/customer.js:625-635` (`executeSubmitQueue`)

**Description:**
```javascript
// Step 1: RPC submit_queue (insert rows)
// Step 2: UPDATE queues SET payment_method=... (separate query)
```
Kalau Step 2 fail (network drop, RLS reject) → tiket tercipta tanpa payment_method. Customer bingung, sekretariat lihat "➖ KOSONG".

**Suggested Fix:** Pass `payment_method` dan `payment_channel` ke `submit_queue` RPC sebagai parameter, set di INSERT.

---

### BUG-015 | `payNowOnline` bisa create multiple PaymenKu trx
**Severity:** High
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/customer.js:849-940`

**Description:** Klik "BAYAR SEKARANG" berkali-kali (atau race condition jaringan lambat) bisa create multiple `payment_trx_id`. Customer charged multiple kali.

**Reproduce:**
1. Customer klik "BAYAR" → loading
2. Klik lagi → loading lagi
3. Buka 2 tab → klik bayar di keduanya
→ 3 trx dibuat di PaymenKu, semua valid

**Suggested Fix:**
1. Disable button immediately + persist disabled state
2. Cek `payment_trx_id` exists & status pending → reuse, bukan create baru
3. Backend: check existing pending trx untuk nomor_antrian

---

### BUG-016 | Public bisa update `notes` bypass parser
**Severity:** High
**Status:** ✅ FIXED (2026-05-25) — sekaligus dengan BUG-001
**Migration:** `supabase/migrations/rls_hardening.sql`
**File:** `supabase/rls_policies.sql:46-50`

**Description:** Anyone via console:
```js
await supabaseClient.from('queues').update({notes: '\n---PAYMENT---\nKelebihan bayar: Rp 999999'}).eq(...)
```
→ Sekretariat lihat fake "kelebihan bayar Rp 999.999" → klik "Sudah Dikembalikan" → kasir keluarin uang fiktif.

**Suggested Fix:** Notes update via RPC `update_notes_manual(nomor_antrian, manual_text)` yang preserve payment notes server-side.

---

### BUG-017 | Customer `showPopup` override hilangkan `isError` flag
**Severity:** High
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/customer.js:1438-1490`

**Description:** Customer page override `showPopup(title, body)` tanpa parameter `isError`. Sehingga popup error muncul tetap dengan warna random (yellow/pink/cyan/green) — yang seharusnya merah untuk error.

**Suggested Fix:** Tambah parameter ketiga `isError`, force `bg-neoRed` jika true.

---

### BUG-030 | Public bisa flip `picked_up`
**Severity:** High
**Status:** ✅ FIXED (2026-05-25) — RPC `pengambilan_set_pickup()` require auth
**Migration:** `supabase/migrations/rls_hardening.sql`
**File:** `supabase/rls_policies.sql` (UPDATE TO public USING true)

**Description:** Customer/anyone bisa update `picked_up: true` → workflow pengambilan rusak. Petugas pengambilan disable batalkan, tapi via console attacker bisa.

**Suggested Fix:** RPC `mark_picked_up(nomor_antrian)` yang require auth role `pengambilan` atau `admin`.

---

## 🟡 MEDIUM Bugs (19)

### BUG-018 | XSS via `nama_lengkap`/`kelas`/`alamat` di template literal
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/sekretariat.js`, `js/customer.js`, `js/pengambilan.js`, `js/monitor.js`

**Description:** Banyak template literal `${c.nama_lengkap}` dirender ke `innerHTML` tanpa `escapeHTML()`. Kalau customer input mengandung HTML tag, render rusak/XSS.

**Reproduce:** Daftar dengan nama `<img src=x onerror=alert(1)>` → muncul saat di-render di sekretariat.

**Suggested Fix:** Wrap semua user input dengan `escapeHTML()`.

---

### BUG-019 | `escapeHTML` ada tapi inkonsisten dipakai
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25) — pindah ke shared/config.js global, tambah escapeAttr()
**File:** `shared/ui.js:escapeHTML` & multiple files

**Description:** Helper sudah ada, tapi banyak template tidak pakai. Audit setiap `${...}` di `innerHTML`.

---

### BUG-021 | No double-submit guard di "AMBIL TIKET"
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/customer.js:submitQueue`

**Description:** Klik double saat network lambat → 2 tiket terbuat (atau RPC error karena unique constraint).

**Suggested Fix:** Disable button saat submit:
```javascript
const btn = document.getElementById('btn-submit-queue');
if (btn.disabled) return;
btn.disabled = true;
try { ... } finally { btn.disabled = false; }
```

---

### BUG-022 | `parseInt(localStorage)` tanpa validation
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/customer.js:editOrder`, `customer.js:payNowOnline`

```javascript
const savedPigura = parseInt(localStorage.getItem('myPiguraQty') || '0');
```
Kalau localStorage corrupt (random string) → NaN → harga negatif/0.

**Suggested Fix:**
```javascript
const savedPigura = Math.max(0, parseInt(localStorage.getItem('myPiguraQty')) || 0);
```

---

### BUG-023 | `customerTicketPrefix` dibaca tapi tidak pernah ditulis
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/customer.js:lacakTiket`

```javascript
const currentPrefixVal = localStorage.getItem('customerTicketPrefix') || 'PB';
```
Tidak ada `setItem` untuk key ini. Lacak tiket selalu fallback ke 'PB' meskipun booth lain prefix-nya 'SMAP'.

**Suggested Fix:** Set saat `loadBoothInfo` sukses:
```javascript
localStorage.setItem('customerTicketPrefix', currentBoothInfo.ticket_prefix);
```

---

### BUG-024 | Two-tab race
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25) — BroadcastChannel sync antar tab customer
**File:** Customer page in general

**Description:** Customer buka 2 tab, edit di tab A → tab B punya stale state. Realtime trigger di tab B tapi UI bisa overlap dengan operation customer.

**Suggested Fix:** Pakai `localStorage` event untuk sync state, atau disable edit di tab kedua.

---

### BUG-025 | Switch payment_method online↔tunai dengan pending PaymenKu trx
**Severity:** Medium
**File:** `js/customer.js:confirmChangePayment` & `js/sekretariat.js:togglePaymentMethod`

**Description:** Customer punya pending PaymenKu trx → switch ke tunai. Trx di PaymenKu tetap valid → kalau customer iseng bayar, status tunai tapi sudah ada uang masuk tidak ter-link.

**Suggested Fix:** Saat switch dari online → tunai, panggil `cancel-payment` di PaymenKu API.

---

### BUG-027 | Notes input lose focus on realtime rerender
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/sekretariat.js:renderCustomerTable`

**Description:** Realtime trigger → `tbody.innerHTML = ...` (full re-render) → input notes yang lagi diketik kehilangan focus + cursor. Sekretariat susah ngetik notes panjang.

**Suggested Fix:** Diff render (cuma update row yang berubah), atau preserve focus state sebelum rerender.

---

### BUG-028 | `restoreQueue` wipe ticket selesai
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25) — tampilkan popup "Foto Sudah Selesai" + clean localStorage
**File:** `js/customer.js:restoreQueue`

```javascript
.in('status', ACTIVE_STATUSES);  // [menunggu, dipanggil, ditunda]
```
Tiket yang sudah `selesai` tidak di-load → customer kelihatan kayak "kadaluarsa", padahal seharusnya bisa lihat receipt-nya.

**Suggested Fix:** Show finished ticket dengan UI berbeda (read-only, dengan "Foto Anda Sudah Selesai!").

---

### BUG-031 | `togglePaymentMethod` panggil `applyFilters()` 2x
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/sekretariat.js:780-810`

**Description:** `applyFilters()` di-call dalam callback `showConfirm` AND di luar (line 805). Kalau user batal di confirm, `applyFilters()` tetap jalan tapi tanpa data baru.

---

### BUG-032 | `update_queue_order` tidak validasi status server-side
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25) — sekaligus fix BUG-039
**Migration:** `supabase/migrations/fix_update_queue_order.sql`
**File:** Edit order RPC (sekarang ada di repo)

**Description:** Frontend block edit kalau status `dipanggil/selesai/batal`, tapi server tidak check. Direct API call bisa edit tiket yang sudah selesai.

---

### BUG-033 | Multiple realtime listeners untuk booth-sync di customer
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25) — track `boothSyncChannel` & cleanup
**File:** `js/customer.js:initSystemChannel`

**Description:** Setiap `initSystemChannel()` call create new channel `booth-sync-X` tanpa cleanup. Kalau function di-call ulang (mis. saat ganti booth) → multiple subscription.

---

### BUG-034 | `realtimeChannel` global tanpa cleanup di tab close
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25) — beforeunload cleanup all channels
**File:** `js/customer.js`

---

### BUG-035 | `system-events` channel name collision
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25) — broadcast include boothId, customer filter
**File:** `js/customer.js`, `js/sekretariat.js`, `js/admin.js`

**Description:** Semua dashboard subscribe ke channel `system-events` dengan name yang sama. `clear_cache` broadcast bisa nyasar ke customer secara unintended.

---

### BUG-036 | `applyBoothUI(currentBoothInfo)` dipanggil sebelum currentBoothInfo di-set
**Severity:** Medium
**File:** `js/customer.js:initSystemChannel`

---

### BUG-038 | Status filter "active" tidak include `ditunda`
**Severity:** Medium
**Status:** ❌ NOT A BUG (verified 2026-05-25) — code sudah include `STATUS.DITUNDA`
**File:** `js/sekretariat.js:applyFilters`

**Description:** Filter `status=active` cuma cek `menunggu` dan `dipanggil`, bukan `ditunda`. Tiket ditunda tidak muncul di filter "active".

---

### BUG-040 | `sanitizeInput` regex naive
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25)
**File:** `shared/ui.js`

```javascript
return input.replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
```
**Description:** Bisa di-bypass (mis. `<img src=x` tanpa `>` awal akan ditolak). Tidak escape `&`, `<`, `>`. Pakai escapeHTML lebih baik.

---

### BUG-044 | Prefix duplicate antar booth tidak di-validate
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25) — partial unique index
**Migration:** `supabase/migrations/add_constraints.sql`
**File:** Booth management

**Description:** Admin bisa create 2 booth dengan prefix sama (e.g. dua-duanya 'PB'). Nomor antrian akan bentrok.

---

### BUG-045 | Pigura > 20 tidak di-validate server-side
**Severity:** Medium
**Status:** ✅ FIXED (2026-05-25) — validate di submit_queue & update_queue_order
**Migration:** `supabase/migrations/add_validation_pigura.sql`
**File:** `submit_queue` RPC

---

## 🟢 LOW Bugs (9)

### BUG-037 | Implicit globals
**Severity:** Low
**File:** `js/customer.js` (top-level vars without `let`/`const`)

**Description:** Beberapa variable seperti `bgQuantities`, `piguraQty` bergantung pada hoisting / mungkin tidak di-declare eksplisit.

---

### BUG-039 | Migration drift: `update_queue_order` tidak ada di repo
**Severity:** Low
**Status:** ✅ FIXED (2026-05-25) — sekaligus dengan BUG-032
**Migration:** `supabase/migrations/fix_update_queue_order.sql`
**File:** `supabase/migrations/`

**Description:** Code di customer.js & sekretariat.js panggil RPC `update_queue_order`, tapi tidak ada di migration files. Setup developer baru akan error.

**Suggested Fix:** Tambahkan SQL function ke migrations.

---

### BUG-041 | Timezone ambiguity di `sales_start_datetime`
**Severity:** Low
**File:** `supabase/migrations/add_booth_quota_and_schedule.sql`

**Description:** `TIMESTAMP WITH TIME ZONE` di-compare dengan `NOW()` server-side. Kalau server di UTC tapi event Indonesia (WIB), mismatch 7 jam.

---

### BUG-042 | Forced tunai fallback saat payment expired
**Severity:** Low
**Status:** ✅ FIXED (2026-05-25) — sudah dihapus saat BUG-008 fix di payment-return.html
**File:** `payment-return.html:67-71`

```javascript
} else {
    await supabaseClient.from('queues').update({ payment_method: 'tunai', payment_channel: null });
}
```
**Description:** Kalau payment expired/cancelled, otomatis switch ke tunai. Customer tidak ada konfirmasi.

---

### BUG-043 | Tidak ada UNIQUE constraint di `payment_trx_id`
**Severity:** Low
**Status:** ✅ FIXED (2026-05-25) — partial unique index
**Migration:** `supabase/migrations/add_constraints.sql`
**File:** Database schema

**Description:** Bisa ada 2 row dengan `payment_trx_id` sama (mis. kalau insert race condition).

---

### BUG-046 | `formatCurrency` inkonsisten regex parser
**Severity:** Low
**Status:** ✅ FIXED (2026-05-25) — helper `parseRupiah()` global di shared/config.js
**File:** `js/sekretariat.js:renderStatsCards` & `js/customer.js:payNowOnline`

```javascript
matchKurang[1].replace(/[.,]/g, '')
```
**Description:** Replace semua titik dan koma. Kalau locale-nya bukan Indonesia (mis. `Rp 40,000.00`), parsing error.

---

### BUG-047 | Console logs verbose di production
**Severity:** Low
**Status:** ✅ FIXED (2026-05-25)
**File:** `js/customer.js`, `js/sekretariat.js`

**Description:** Banyak `console.log('🔧 Updating...', {...})` debug log masih aktif. Kalau production, leak info via console.

---

### BUG-048 | `useState`-like pattern manual rentan stale
**Severity:** Low
**File:** Multiple

**Description:** Variable `groupedCustomers`, `filteredCustomers` di-mutate manual. Tidak ada single source of truth → UI bisa out-of-sync dengan data.

---

### BUG-049 | Tidak ada loading state di `fetchAllCustomers` setelah initial
**Severity:** Low
**Status:** ✅ FIXED (2026-05-25) — opacity loading indicator on count
**File:** `js/sekretariat.js:fetchAllCustomers`

**Description:** Skeleton cuma muncul saat initial load. Subsequent fetch (realtime, after edit) tanpa indikator.

---

## 📊 Statistik

```
Total: 45 bugs
├── Critical:  4 (8.9%)   — 4 fixed ✅ (1 partial)
├── High:     13 (28.9%)  — 12 fixed ✅
├── Medium:   19 (42.2%)  — 16 fixed ✅ (1 not-a-bug)
└── Low:       9 (20.0%)  — 6 fixed ✅

Progress: 38/45 fixed (84%)

By Category:
├── Security/RLS:        6 bugs
├── Smart Payment Logic: 5 bugs
├── Race Conditions:     7 bugs
├── Quota/Counter:       3 bugs
├── Realtime:            5 bugs
├── XSS/Sanitization:    4 bugs
├── UX/UI:               8 bugs
└── Other:               7 bugs
```

---

## 🛠️ Cara Pakai Dokumen Ini

1. **Triage:** Mulai dari Critical, lanjut ke High
2. **Track progress:** Saat sebuah bug di-fix, update status di sini (`Status: ✅ Fixed in commit XXX`)
3. **Group fixing:** Beberapa bug related (e.g., RLS bugs) lebih efisien di-fix bareng dalam 1 PR
4. **Verify:** Setelah fix, tambahkan test/repro case ke dokumen ini

---

**Last Updated:** 2026-05-25
**Audit by:** Sub-agent context-gatherer (autonomous review)
