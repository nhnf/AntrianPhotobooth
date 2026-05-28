-- ==========================================
-- MIGRATION: Add UNIQUE constraints (BUG-043, 044)
-- ==========================================
-- BUG-043: Tidak ada UNIQUE constraint di payment_trx_id
--   → Bisa ada 2 row dengan trx_id sama (race condition / duplicate insert)
-- BUG-044: Booth prefix bisa duplicate → nomor antrian bentrok
-- ==========================================

-- Step 1: Cleanup duplicate payment_trx_id sebelum tambah constraint
-- (set yang lama jadi NULL agar tidak conflict dengan unique)
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN 
        SELECT payment_trx_id, MIN(id) AS keep_id
        FROM queues 
        WHERE payment_trx_id IS NOT NULL
        GROUP BY payment_trx_id
        HAVING COUNT(DISTINCT id) > 1
    LOOP
        -- Pertahankan yang lama (id terkecil), null-kan yang lain
        UPDATE queues 
        SET payment_trx_id = NULL
        WHERE payment_trx_id = r.payment_trx_id 
          AND id != r.keep_id;
        RAISE NOTICE 'Deduplicated payment_trx_id %', r.payment_trx_id;
    END LOOP;
END $$;

-- Step 2: BUG-043 — UNIQUE partial index untuk payment_trx_id
-- (partial: hanya yang NOT NULL, agar banyak NULL tetap allowed)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_trx_id 
ON queues (payment_trx_id) 
WHERE payment_trx_id IS NOT NULL;

-- Step 3: BUG-044 — UNIQUE booth ticket_prefix
-- Cleanup duplicate dulu (rare, tapi jaga-jaga)
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN 
        SELECT ticket_prefix, MIN(id) AS keep_id
        FROM booths
        WHERE ticket_prefix IS NOT NULL
        GROUP BY ticket_prefix
        HAVING COUNT(*) > 1
    LOOP
        -- Append id ke prefix duplicate
        UPDATE booths 
        SET ticket_prefix = ticket_prefix || '-' || id
        WHERE ticket_prefix = r.ticket_prefix 
          AND id != r.keep_id;
        RAISE NOTICE 'Deduplicated booth prefix %', r.ticket_prefix;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_booth_ticket_prefix 
ON booths (ticket_prefix) 
WHERE ticket_prefix IS NOT NULL;

COMMENT ON INDEX uniq_payment_trx_id IS 'Prevent duplicate payment transactions (BUG-043)';
COMMENT ON INDEX uniq_booth_ticket_prefix IS 'Prevent booth prefix collision (BUG-044)';
