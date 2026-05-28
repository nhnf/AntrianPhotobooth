-- ==========================================
-- MIGRATION: Fix nomor antrian per-booth (bukan global sequence)
-- ==========================================
-- Masalah: ticket_sequence adalah global sequence PostgreSQL.
-- Ketika booth baru dibuat atau booth di-reset, nomor antrian
-- tidak mulai dari 001 karena sequence sudah di-increment oleh booth lain.
--
-- Solusi: Ganti NEXTVAL('ticket_sequence') dengan perhitungan
-- MAX nomor antrian per booth + 1, sehingga setiap booth
-- punya counter sendiri yang independen.
-- ==========================================

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

    -- Lock booth row untuk prevent race condition
    SELECT * INTO v_booth FROM booths WHERE id = p_booth_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booth tidak ditemukan atau tidak aktif'; END IF;

    -- Validasi jam buka
    IF v_booth.sales_start_datetime IS NOT NULL THEN
        IF NOW() < v_booth.sales_start_datetime THEN
            RAISE EXCEPTION 'SALES_NOT_OPEN:%', v_booth.sales_start_datetime::TEXT;
        END IF;
    END IF;

    -- Validasi jam tutup
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

    -- Generate nomor antrian PER BOOTH (bukan global sequence)
    -- Ambil nomor terakhir untuk booth ini, lalu +1
    SELECT COALESCE(
        MAX(
            -- Ekstrak angka dari nomor antrian (misal "SMAP-007" -> 7)
            NULLIF(
                REGEXP_REPLACE(nomor_antrian, '^[^-]+-0*', ''),
                ''
            )::INTEGER
        ), 0
    ) + 1
    INTO v_ticket_num
    FROM queues
    WHERE booth_id = p_booth_id;

    -- Format 3 digit: 001, 002, ..., 999
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

-- Catatan: ticket_sequence tidak lagi digunakan, tapi dibiarkan agar tidak break
-- kalau ada referensi lain. Bisa di-drop manual kalau sudah yakin tidak dipakai.
