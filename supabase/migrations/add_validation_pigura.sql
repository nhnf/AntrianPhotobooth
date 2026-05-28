-- ==========================================
-- MIGRATION: BUG-045 — Server-side validation untuk pigura
-- ==========================================
-- Frontend membatasi pigura 0-20, tapi server tidak validate.
-- Attacker bisa kirim pigura: 99999 via direct API call → harga abnormal.
-- ==========================================

-- Update submit_queue dengan validasi pigura
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
    v_actual_count INTEGER;
    v_pigura INTEGER;
BEGIN
    -- BUG-045 FIX: validate pigura range
    v_pigura := COALESCE(p_pigura, 0);
    IF v_pigura < 0 OR v_pigura > 20 THEN
        RAISE EXCEPTION 'INVALID_PIGURA: Jumlah pigura harus 0-20';
    END IF;
    
    -- Validate jumlah_foto per background
    FOR v_bg IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_backgrounds) LOOP
        IF (v_bg->>'jumlah_foto')::INTEGER < 1 OR (v_bg->>'jumlah_foto')::INTEGER > 50 THEN
            RAISE EXCEPTION 'INVALID_QTY: Jumlah foto per background harus 1-50';
        END IF;
    END LOOP;
    
    -- 1. Lock booth row & ambil info
    SELECT * INTO v_booth
    FROM booths WHERE id = p_booth_id AND is_active = true
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
    
    -- 3. VALIDASI KUOTA — pakai dynamic count
    IF v_booth.max_capacity IS NOT NULL THEN
        SELECT COUNT(DISTINCT nomor_antrian) INTO v_actual_count
        FROM queues WHERE booth_id = p_booth_id AND status != 'batal';
        
        IF v_actual_count >= v_booth.max_capacity THEN
            RAISE EXCEPTION 'CAPACITY_FULL:%:%', v_actual_count, v_booth.max_capacity;
        END IF;
    END IF;
    
    -- 4. Generate nomor antrian
    v_ticket_num := NEXTVAL('ticket_sequence');
    v_nomor_antrian := v_booth.ticket_prefix || '-' || LPAD(v_ticket_num::TEXT, 3, '0');
    
    -- 5. Insert
    FOR v_bg IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_backgrounds) LOOP
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
                v_pigura, p_no_wa, 'menunggu', 'belum_lunas'
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
    
    RETURN JSONB_BUILD_OBJECT(
        'nomor_antrian', v_nomor_antrian,
        'rows', v_rows
    );
EXCEPTION
    WHEN OTHERS THEN RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION submit_queue(INTEGER, TEXT, TEXT, TEXT, JSONB, INTEGER, TEXT) TO anon, authenticated;

-- Update update_queue_order dengan validasi yang sama
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
    v_status_count INTEGER;
    v_bg JSONB;
    v_queue_id INTEGER;
    v_rows JSONB := '[]'::JSONB;
    v_booth_id INTEGER;
    v_payment_method TEXT;
    v_payment_channel TEXT;
    v_payment_status TEXT;
    v_payment_trx_id TEXT;
    v_pigura INTEGER;
BEGIN
    -- BUG-045 FIX: validate pigura range
    v_pigura := COALESCE(p_pigura, 0);
    IF v_pigura < 0 OR v_pigura > 20 THEN
        RAISE EXCEPTION 'INVALID_PIGURA: Jumlah pigura harus 0-20';
    END IF;
    
    -- Validate jumlah_foto per background
    FOR v_bg IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_backgrounds) LOOP
        IF (v_bg->>'jumlah_foto')::INTEGER < 1 OR (v_bg->>'jumlah_foto')::INTEGER > 50 THEN
            RAISE EXCEPTION 'INVALID_QTY: Jumlah foto per background harus 1-50';
        END IF;
    END LOOP;
    
    SELECT booth_id, payment_method, payment_channel, payment_status, payment_trx_id
    INTO v_booth_id, v_payment_method, v_payment_channel, v_payment_status, v_payment_trx_id
    FROM queues WHERE nomor_antrian = p_nomor_antrian LIMIT 1;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Antrian tidak ditemukan: %', p_nomor_antrian;
    END IF;
    
    -- BUG-032: validasi status
    SELECT COUNT(*) INTO v_status_count
    FROM queues
    WHERE nomor_antrian = p_nomor_antrian
      AND status IN ('selesai', 'batal', 'dipanggil');
    
    IF v_status_count > 0 THEN
        RAISE EXCEPTION 'TICKET_LOCKED: Tiket tidak bisa diedit karena sudah dipanggil/selesai/dibatalkan';
    END IF;
    
    DELETE FROM queues WHERE nomor_antrian = p_nomor_antrian;
    
    FOR v_bg IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_backgrounds)
    LOOP
        INSERT INTO queues (
            booth_id, nomor_antrian, nama_lengkap, kelas, alamat,
            background_id, jumlah_foto, pigura, no_wa, notes, status, payment_status,
            payment_method, payment_channel, payment_trx_id
        ) VALUES (
            v_booth_id, p_nomor_antrian, p_nama, p_kelas, p_alamat,
            (v_bg->>'background_id')::INTEGER, (v_bg->>'jumlah_foto')::INTEGER,
            v_pigura, p_no_wa, p_notes, 'menunggu',
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
    
    RETURN JSONB_BUILD_OBJECT(
        'nomor_antrian', p_nomor_antrian,
        'rows', v_rows
    );
EXCEPTION
    WHEN OTHERS THEN RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_queue_order(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, TEXT) TO anon, authenticated;
