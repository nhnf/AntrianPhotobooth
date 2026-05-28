-- ==========================================
-- MIGRATION: Add sales_end_datetime to booths
-- Fitur: booth bisa ditutup pada waktu tertentu
-- ==========================================

ALTER TABLE booths
ADD COLUMN IF NOT EXISTS sales_end_datetime TIMESTAMP WITH TIME ZONE DEFAULT NULL;

COMMENT ON COLUMN booths.sales_end_datetime IS 'Tanggal dan jam tutup penjualan tiket. NULL = tidak ada batas tutup';

-- Update submit_queue untuk validasi jam tutup
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
    v_pigura := COALESCE(p_pigura, 0);
    IF v_pigura < 0 OR v_pigura > 20 THEN
        RAISE EXCEPTION 'INVALID_PIGURA: Jumlah pigura harus 0-20';
    END IF;

    FOR v_bg IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_backgrounds) LOOP
        IF (v_bg->>'jumlah_foto')::INTEGER < 1 OR (v_bg->>'jumlah_foto')::INTEGER > 50 THEN
            RAISE EXCEPTION 'INVALID_QTY: Jumlah foto per background harus 1-50';
        END IF;
    END LOOP;

    SELECT * INTO v_booth FROM booths WHERE id = p_booth_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booth tidak ditemukan atau tidak aktif'; END IF;

    -- Validasi jam buka
    IF v_booth.sales_start_datetime IS NOT NULL THEN
        IF NOW() < v_booth.sales_start_datetime THEN
            RAISE EXCEPTION 'SALES_NOT_OPEN:%', v_booth.sales_start_datetime::TEXT;
        END IF;
    END IF;

    -- Validasi jam tutup (BARU)
    IF v_booth.sales_end_datetime IS NOT NULL THEN
        IF NOW() > v_booth.sales_end_datetime THEN
            RAISE EXCEPTION 'SALES_CLOSED:%', v_booth.sales_end_datetime::TEXT;
        END IF;
    END IF;

    -- Validasi kuota
    IF v_booth.max_capacity IS NOT NULL THEN
        SELECT COUNT(DISTINCT nomor_antrian) INTO v_actual_count
        FROM queues WHERE booth_id = p_booth_id AND status != 'batal';
        IF v_actual_count >= v_booth.max_capacity THEN
            RAISE EXCEPTION 'CAPACITY_FULL:%:%', v_actual_count, v_booth.max_capacity;
        END IF;
    END IF;

    v_ticket_num := NEXTVAL('ticket_sequence');
    v_nomor_antrian := v_booth.ticket_prefix || '-' || LPAD(v_ticket_num::TEXT, 3, '0');

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
                v_bg_id, v_qty, v_pigura, p_no_wa, 'menunggu', 'belum_lunas'
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

    RETURN JSONB_BUILD_OBJECT('nomor_antrian', v_nomor_antrian, 'rows', v_rows);
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION submit_queue(INTEGER, TEXT, TEXT, TEXT, JSONB, INTEGER, TEXT) TO anon, authenticated;
