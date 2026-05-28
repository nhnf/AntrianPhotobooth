-- ==========================================
-- MIGRATION: Fix BUG-003 — Quota Counter Integrity
-- ==========================================
-- Sebelumnya: current_ticket_count hanya di-increment saat submit_queue,
-- tidak pernah di-decrement saat status batal/delete/reset.
-- Akibat: booth quota silent-full dengan slot phantom.
--
-- Solusi: ganti pendekatan static counter dengan dynamic count.
-- 1. Trigger UPDATE/DELETE pada queues untuk auto-recompute counter
-- 2. Modifikasi submit_queue agar pakai SELECT FOR UPDATE (BUG-009 sekaligus)
-- 3. Recompute counter dari data existing (one-time correction)
-- ==========================================

-- Step 1: Function untuk recompute counter berdasarkan data aktual
CREATE OR REPLACE FUNCTION recompute_booth_ticket_count(p_booth_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Hitung distinct nomor_antrian yang status-nya BUKAN 'batal'
    SELECT COUNT(DISTINCT nomor_antrian)
    INTO v_count
    FROM queues
    WHERE booth_id = p_booth_id
      AND status != 'batal';
    
    UPDATE booths
    SET current_ticket_count = COALESCE(v_count, 0)
    WHERE id = p_booth_id;
    
    RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Trigger untuk auto-update counter saat queue berubah
CREATE OR REPLACE FUNCTION trg_recompute_quota_on_change()
RETURNS TRIGGER AS $$
BEGIN
    -- INSERT: recompute booth baru
    IF TG_OP = 'INSERT' THEN
        PERFORM recompute_booth_ticket_count(NEW.booth_id);
        RETURN NEW;
    END IF;
    
    -- DELETE: recompute booth lama
    IF TG_OP = 'DELETE' THEN
        PERFORM recompute_booth_ticket_count(OLD.booth_id);
        RETURN OLD;
    END IF;
    
    -- UPDATE: kalau status berubah ke/dari 'batal' atau booth_id berubah, recompute
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM NEW.status
           OR OLD.booth_id IS DISTINCT FROM NEW.booth_id THEN
            PERFORM recompute_booth_ticket_count(NEW.booth_id);
            IF OLD.booth_id IS DISTINCT FROM NEW.booth_id THEN
                PERFORM recompute_booth_ticket_count(OLD.booth_id);
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger lama jika ada
DROP TRIGGER IF EXISTS queue_quota_sync ON queues;

CREATE TRIGGER queue_quota_sync
AFTER INSERT OR UPDATE OR DELETE ON queues
FOR EACH ROW
EXECUTE FUNCTION trg_recompute_quota_on_change();

-- Step 3: Recompute SEMUA booth saat ini (one-time correction)
DO $$
DECLARE
    booth_rec RECORD;
BEGIN
    FOR booth_rec IN SELECT id FROM booths LOOP
        PERFORM recompute_booth_ticket_count(booth_rec.id);
    END LOOP;
END $$;

-- Step 4: Modifikasi submit_queue dengan FOR UPDATE (sekaligus fix BUG-009 race condition)
CREATE OR REPLACE FUNCTION submit_queue(
    p_booth_id INTEGER,
    p_nama TEXT,
    p_kelas TEXT,
    p_alamat TEXT,
    p_backgrounds JSONB,
    p_pigura INTEGER,
    p_no_wa TEXT
) RETURNS JSONB AS $$
DECLARE
    v_booth RECORD;
    v_nomor_antrian TEXT;
    v_ticket_num INTEGER;
    v_bg JSONB;
    v_queue_id INTEGER;
    v_rows JSONB := '[]'::JSONB;
    v_result JSONB;
    v_actual_count INTEGER;
BEGIN
    -- 1. Lock booth row & ambil info (FOR UPDATE prevents race condition)
    SELECT * INTO v_booth
    FROM booths
    WHERE id = p_booth_id AND is_active = true
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booth tidak ditemukan atau tidak aktif';
    END IF;
    
    -- 2. VALIDASI WAKTU AKSES
    IF v_booth.sales_start_datetime IS NOT NULL THEN
        IF NOW() < v_booth.sales_start_datetime THEN
            RAISE EXCEPTION 'SALES_NOT_OPEN:%', v_booth.sales_start_datetime::TEXT;
        END IF;
    END IF;
    
    -- 3. VALIDASI KUOTA — pakai dynamic count (BUG-003 fix)
    IF v_booth.max_capacity IS NOT NULL THEN
        SELECT COUNT(DISTINCT nomor_antrian) INTO v_actual_count
        FROM queues
        WHERE booth_id = p_booth_id AND status != 'batal';
        
        IF v_actual_count >= v_booth.max_capacity THEN
            RAISE EXCEPTION 'CAPACITY_FULL:%:%', v_actual_count, v_booth.max_capacity;
        END IF;
    END IF;
    
    -- 4. Generate nomor antrian
    v_ticket_num := NEXTVAL('ticket_sequence');
    v_nomor_antrian := v_booth.ticket_prefix || '-' || LPAD(v_ticket_num::TEXT, 3, '0');
    
    -- 5. Insert ke tabel queues untuk setiap background
    FOR v_bg IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_backgrounds)
    LOOP
        DECLARE
            v_bg_id INTEGER := (v_bg->>'background_id')::INTEGER;
            v_qty   INTEGER := (v_bg->>'jumlah_foto')::INTEGER;
        BEGIN
            INSERT INTO queues (
                booth_id, nomor_antrian, nama_lengkap, kelas, alamat,
                background_id, jumlah_foto, pigura, no_wa, status, payment_status
            ) VALUES (
                p_booth_id, v_nomor_antrian, p_nama, p_kelas, p_alamat,
                v_bg_id, v_qty,
                p_pigura, p_no_wa, 'menunggu', 'belum_lunas'
            ) RETURNING id INTO v_queue_id;
            
            v_rows := v_rows || JSONB_BUILD_OBJECT(
                'id', v_queue_id,
                'background_id', v_bg_id,
                'jumlah_foto', v_qty,
                'status', 'menunggu',
                'created_at', NOW()
            );
        END;
    END LOOP;
    
    -- 6. Counter sudah auto-update via trigger queue_quota_sync — no manual update needed
    
    -- 7. Return result
    v_result := JSONB_BUILD_OBJECT(
        'nomor_antrian', v_nomor_antrian,
        'rows', v_rows
    );
    
    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION submit_queue(INTEGER, TEXT, TEXT, TEXT, JSONB, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_booth_ticket_count(INTEGER) TO authenticated;

-- Step 5: Update reset_booth_quota agar sekalian set count ke aktual (bukan 0)
-- Reset disini berarti "anggap counter mulai dari 0", tapi karena trigger akan
-- recompute setelahnya, kita force ke 0 dengan delete-batalkan semua existing.
-- ATAU: rename fungsi jadi reset_booth_canceled (mark all as batal).
-- Untuk safety, kita biarkan reset_booth_quota set 0 manual, tapi user harus
-- aware ini override dari trigger
CREATE OR REPLACE FUNCTION reset_booth_quota(p_booth_id INTEGER)
RETURNS VOID AS $$
BEGIN
    -- Recompute aktual dulu
    PERFORM recompute_booth_ticket_count(p_booth_id);
    
    -- Lalu force ke 0 (manual override — pakai dengan hati-hati)
    UPDATE booths SET current_ticket_count = 0 WHERE id = p_booth_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booth dengan ID % tidak ditemukan', p_booth_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reset_booth_quota(INTEGER) TO authenticated;

-- Migration selesai
COMMENT ON FUNCTION recompute_booth_ticket_count IS 'Recompute current_ticket_count berdasarkan data aktual queues (BUG-003 fix)';
COMMENT ON TRIGGER queue_quota_sync ON queues IS 'Auto-sync booth quota counter saat queue berubah (BUG-003 fix)';
