-- ==========================================
-- MIGRATION: Fix BUG-032 — Server-side validation di update_queue_order
-- BUG-039: Migration drift — function ini sebelumnya tidak ada di repo
-- ==========================================
-- update_queue_order dipanggil dari customer.js & sekretariat.js untuk edit pesanan.
-- Sebelumnya tidak ada validasi status server-side, jadi attacker bisa edit
-- tiket yang sudah selesai/batal via direct API call.
--
-- Solusi:
-- 1. Drop semua versi update_queue_order yang ada
-- 2. Recreate dengan validasi:
--    - Cek nomor_antrian exists
--    - Block edit kalau status ada yang selesai/batal
-- ==========================================

-- Step 1: Drop semua versi existing untuk hindari konflik
DO $$ 
DECLARE r RECORD;
BEGIN
    FOR r IN 
        SELECT p.oid::regprocedure as func
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE p.proname = 'update_queue_order' AND n.nspname = 'public'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func || ' CASCADE';
        RAISE NOTICE 'Dropped: %', r.func;
    END LOOP;
END $$;

-- Step 2: Recreate dengan validasi
CREATE OR REPLACE FUNCTION update_queue_order(
    p_nomor_antrian TEXT,
    p_nama TEXT,
    p_kelas TEXT,
    p_alamat TEXT,
    p_notes TEXT,
    p_backgrounds JSONB,
    p_pigura INTEGER,
    p_no_wa TEXT
) RETURNS JSONB AS $$
DECLARE
    v_existing RECORD;
    v_status_count INTEGER;
    v_bg JSONB;
    v_queue_id INTEGER;
    v_rows JSONB := '[]'::JSONB;
    v_booth_id INTEGER;
    v_payment_method TEXT;
    v_payment_channel TEXT;
    v_payment_status TEXT;
    v_payment_trx_id TEXT;
BEGIN
    -- 1. Validasi nomor_antrian exists & ambil meta data
    SELECT booth_id, payment_method, payment_channel, payment_status, payment_trx_id
    INTO v_booth_id, v_payment_method, v_payment_channel, v_payment_status, v_payment_trx_id
    FROM queues
    WHERE nomor_antrian = p_nomor_antrian
    LIMIT 1;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Antrian tidak ditemukan: %', p_nomor_antrian;
    END IF;
    
    -- 2. BUG-032 FIX: Validasi status — tidak boleh edit kalau ada item selesai/batal/dipanggil
    SELECT COUNT(*) INTO v_status_count
    FROM queues
    WHERE nomor_antrian = p_nomor_antrian
      AND status IN ('selesai', 'batal', 'dipanggil');
    
    IF v_status_count > 0 THEN
        RAISE EXCEPTION 'TICKET_LOCKED: Tiket tidak bisa diedit karena sudah dipanggil/selesai/dibatalkan';
    END IF;
    
    -- 3. Hapus rows lama untuk nomor_antrian ini
    DELETE FROM queues WHERE nomor_antrian = p_nomor_antrian;
    
    -- 4. Insert ulang dengan data baru, preserve metadata payment & booth
    FOR v_bg IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_backgrounds)
    LOOP
        INSERT INTO queues (
            booth_id, nomor_antrian, nama_lengkap, kelas, alamat,
            background_id, jumlah_foto, pigura, no_wa, notes, status, payment_status,
            payment_method, payment_channel, payment_trx_id
        ) VALUES (
            v_booth_id, p_nomor_antrian, p_nama, p_kelas, p_alamat,
            (v_bg->>'background_id')::INTEGER, (v_bg->>'jumlah_foto')::INTEGER,
            p_pigura, p_no_wa, p_notes, 'menunggu',
            COALESCE(v_payment_status, 'belum_lunas'),
            v_payment_method, v_payment_channel, v_payment_trx_id
        ) RETURNING id INTO v_queue_id;
        
        v_rows := v_rows || JSONB_BUILD_OBJECT(
            'id', v_queue_id,
            'background_id', (v_bg->>'background_id')::INTEGER,
            'jumlah_foto', (v_bg->>'jumlah_foto')::INTEGER,
            'status', 'menunggu',
            'created_at', NOW()
        );
    END LOOP;
    
    -- 5. Return result
    RETURN JSONB_BUILD_OBJECT(
        'nomor_antrian', p_nomor_antrian,
        'rows', v_rows
    );
EXCEPTION
    WHEN OTHERS THEN RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_queue_order(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION update_queue_order IS 'Edit pesanan customer (BUG-032/039 fix: server-side status validation + migration drift)';
