-- ==========================================
-- MIGRATION: Add Booth Quota & Schedule Control
-- ==========================================
-- Menambahkan fitur kontrol waktu akses dan batas kuota tiket per booth

-- 1. Tambah kolom baru ke tabel booths
ALTER TABLE booths 
ADD COLUMN IF NOT EXISTS sales_start_datetime TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS max_capacity INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS current_ticket_count INTEGER DEFAULT 0;

-- 2. Tambah comment untuk dokumentasi
COMMENT ON COLUMN booths.sales_start_datetime IS 'Tanggal dan jam mulai penjualan tiket. NULL = selalu buka';
COMMENT ON COLUMN booths.max_capacity IS 'Batas maksimal tiket yang dapat dijual. NULL = tanpa batas';
COMMENT ON COLUMN booths.current_ticket_count IS 'Jumlah tiket yang sudah terjual (counter)';

-- 3. Buat index untuk performa query
CREATE INDEX IF NOT EXISTS idx_booths_sales_datetime ON booths(sales_start_datetime);
CREATE INDEX IF NOT EXISTS idx_booths_capacity ON booths(max_capacity, current_ticket_count);

-- 4. Modifikasi fungsi submit_queue untuk validasi waktu & kuota
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
BEGIN
    -- 1. Ambil info booth dan cek validitas
    SELECT * INTO v_booth FROM booths WHERE id = p_booth_id AND is_active = true;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booth tidak ditemukan atau tidak aktif';
    END IF;
    
    -- 2. VALIDASI WAKTU AKSES
    IF v_booth.sales_start_datetime IS NOT NULL THEN
        IF NOW() < v_booth.sales_start_datetime THEN
            RAISE EXCEPTION 'SALES_NOT_OPEN:%', v_booth.sales_start_datetime::TEXT;
        END IF;
    END IF;
    
    -- 3. VALIDASI KUOTA
    IF v_booth.max_capacity IS NOT NULL THEN
        IF v_booth.current_ticket_count >= v_booth.max_capacity THEN
            RAISE EXCEPTION 'CAPACITY_FULL:%:%', v_booth.current_ticket_count, v_booth.max_capacity;
        END IF;
    END IF;
    
    -- 4. Generate nomor antrian
    v_ticket_num := NEXTVAL('ticket_sequence');
    v_nomor_antrian := v_booth.ticket_prefix || '-' || LPAD(v_ticket_num::TEXT, 3, '0');
    
    -- 5. Insert ke tabel queues untuk setiap background
    FOR v_bg IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_backgrounds)
    LOOP
        INSERT INTO queues (
            booth_id,
            nomor_antrian,
            nama_lengkap,
            kelas,
            alamat,
            background_id,
            jumlah_foto,
            pigura,
            no_wa,
            status,
            payment_status
        ) VALUES (
            p_booth_id,
            v_nomor_antrian,
            p_nama,
            p_kelas,
            p_alamat,
            (v_bg->>'background_id')::INTEGER,
            (v_bg->>'jumlah_foto')::INTEGER,
            p_pigura,
            p_no_wa,
            'menunggu',
            'belum_lunas'
        ) RETURNING id, background_id, jumlah_foto, status, created_at INTO v_queue_id, v_bg;
        
        -- Kumpulkan hasil untuk return
        v_rows := v_rows || JSONB_BUILD_OBJECT(
            'id', v_queue_id,
            'background_id', (v_bg->>'background_id')::INTEGER,
            'jumlah_foto', (v_bg->>'jumlah_foto')::INTEGER,
            'status', 'menunggu',
            'created_at', NOW()
        );
    END LOOP;
    
    -- 6. INCREMENT COUNTER KUOTA (hanya 1x per nomor antrian)
    UPDATE booths 
    SET current_ticket_count = current_ticket_count + 1 
    WHERE id = p_booth_id;
    
    -- 7. Return result
    v_result := JSONB_BUILD_OBJECT(
        'nomor_antrian', v_nomor_antrian,
        'rows', v_rows
    );
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Pass error message ke frontend
        RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Buat fungsi untuk reset quota counter
CREATE OR REPLACE FUNCTION reset_booth_quota(p_booth_id INTEGER)
RETURNS VOID AS $$
BEGIN
    UPDATE booths 
    SET current_ticket_count = 0 
    WHERE id = p_booth_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booth dengan ID % tidak ditemukan', p_booth_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Grant execute permission untuk fungsi baru
GRANT EXECUTE ON FUNCTION reset_booth_quota(INTEGER) TO authenticated;

-- Migration selesai
