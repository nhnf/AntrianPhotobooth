-- ==========================================
-- MIGRATION: RLS Hardening (BUG-001, 008, 016, 030)
-- ==========================================
-- Sebelumnya: "Public update access for queues TO public USING (true)" 
-- → siapa saja dengan anon key bisa flip payment_status, picked_up, notes, dll.
--
-- Solusi:
-- 1. REVOKE public UPDATE policy
-- 2. KEEP authenticated UPDATE (untuk sekretariat dashboard)
-- 3. ADD specific RPC SECURITY DEFINER untuk mutasi yang dibutuhkan customer (anon)
-- 4. Customer client harus dirubah pakai RPC, bukan direct UPDATE
-- ==========================================

-- Step 1: Drop policy public UPDATE yang terlalu permissive
DROP POLICY IF EXISTS "Public update access for queues" ON queues;

-- Step 2: Authenticated dashboards (sekretariat, admin, pengambilan) tetap bisa UPDATE
-- (mereka sudah login & RLS mengandalkan role authenticated)
DROP POLICY IF EXISTS "Authenticated users can update queues" ON queues;
CREATE POLICY "Authenticated users can update queues"
ON queues FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- ==========================================
-- RPC untuk mutasi yang dibutuhkan customer (anon)
-- ==========================================

-- 1. Set payment method/channel/trx_id (dipanggil customer saat submit & change method)
CREATE OR REPLACE FUNCTION customer_set_payment_meta(
    p_nomor_antrian TEXT,
    p_payment_method TEXT,
    p_payment_channel TEXT DEFAULT NULL,
    p_payment_trx_id TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    -- Validasi: hanya allow set kalau status masih belum_lunas
    -- (mencegah customer override status lunas)
    IF NOT EXISTS (
        SELECT 1 FROM queues 
        WHERE nomor_antrian = p_nomor_antrian
          AND payment_status = 'belum_lunas'
    ) THEN
        RAISE EXCEPTION 'PAYMENT_LOCKED: Tiket sudah lunas, tidak bisa ubah metode pembayaran';
    END IF;
    
    -- Validasi method values
    IF p_payment_method NOT IN ('online', 'tunai') THEN
        RAISE EXCEPTION 'INVALID_METHOD: Metode pembayaran tidak valid';
    END IF;
    
    UPDATE queues
    SET payment_method = p_payment_method,
        payment_channel = p_payment_channel,
        payment_trx_id = COALESCE(p_payment_trx_id, payment_trx_id)
    WHERE nomor_antrian = p_nomor_antrian;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION customer_set_payment_meta(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- 2. Apply smart payment update (dipanggil customer saat edit pesanan dengan price change)
-- Hanya allow update payment_status & notes, bukan field lain
CREATE OR REPLACE FUNCTION customer_apply_smart_payment(
    p_nomor_antrian TEXT,
    p_payment_status TEXT,
    p_notes TEXT
) RETURNS VOID AS $$
BEGIN
    IF p_payment_status NOT IN ('lunas', 'belum_lunas') THEN
        RAISE EXCEPTION 'INVALID_STATUS: Status pembayaran tidak valid';
    END IF;
    
    -- Pastikan tiket exists
    IF NOT EXISTS (SELECT 1 FROM queues WHERE nomor_antrian = p_nomor_antrian) THEN
        RAISE EXCEPTION 'NOT_FOUND: Tiket tidak ditemukan';
    END IF;
    
    UPDATE queues
    SET payment_status = p_payment_status,
        notes = p_notes
    WHERE nomor_antrian = p_nomor_antrian;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION customer_apply_smart_payment(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ==========================================
-- Optional: RPC khusus untuk auth users (cleaner & lebih auditable)
-- Note: sekretariat tetap bisa langsung UPDATE karena auth, tapi RPC ini
-- bisa dipakai untuk audit/tracking di masa depan.
-- ==========================================

-- 3. Sekretariat: Toggle payment status (clear payment notes kalau jadi lunas)
CREATE OR REPLACE FUNCTION sekretariat_toggle_payment_status(
    p_nomor_antrian TEXT
) RETURNS TEXT AS $$
DECLARE
    v_current TEXT;
    v_new TEXT;
    v_notes TEXT;
    v_idx INTEGER;
    v_cleaned TEXT;
BEGIN
    -- Auth check
    IF auth.role() != 'authenticated' THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
    END IF;
    
    SELECT payment_status, notes INTO v_current, v_notes
    FROM queues WHERE nomor_antrian = p_nomor_antrian LIMIT 1;
    
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    
    v_new := CASE WHEN v_current = 'lunas' THEN 'belum_lunas' ELSE 'lunas' END;
    v_cleaned := v_notes;
    
    -- Kalau jadi lunas, clear payment note (preserve manual)
    IF v_new = 'lunas' AND v_notes IS NOT NULL THEN
        v_idx := POSITION(E'\n---PAYMENT---\n' IN v_notes);
        IF v_idx > 0 THEN
            v_cleaned := SUBSTRING(v_notes FROM 1 FOR v_idx - 1);
        ELSIF v_notes LIKE 'Kurang bayar:%' OR v_notes LIKE 'Kelebihan bayar:%' THEN
            v_cleaned := '';
        END IF;
    END IF;
    
    UPDATE queues 
    SET payment_status = v_new, notes = v_cleaned
    WHERE nomor_antrian = p_nomor_antrian;
    
    RETURN v_new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION sekretariat_toggle_payment_status(TEXT) TO authenticated;

-- 4. Pengambilan: mark picked_up (BUG-030 fix — tidak boleh diakses anon)
CREATE OR REPLACE FUNCTION pengambilan_set_pickup(
    p_nomor_antrian TEXT,
    p_picked_up BOOLEAN
) RETURNS VOID AS $$
BEGIN
    IF auth.role() != 'authenticated' THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
    END IF;
    
    UPDATE queues 
    SET picked_up = p_picked_up
    WHERE nomor_antrian = p_nomor_antrian;
    
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION pengambilan_set_pickup(TEXT, BOOLEAN) TO authenticated;

-- ==========================================
-- Catatan: 
-- - Customer sekarang hanya bisa: INSERT (submit), UPDATE via 2 RPC di atas, SELECT
-- - Field lain (status, picked_up, payment_trx_id sebagian) tidak bisa di-spoof
-- - Sekretariat (auth) tetap full akses untuk fleksibilitas, RPC tersedia kalau mau strict
-- ==========================================

COMMENT ON FUNCTION customer_set_payment_meta IS 'Customer set payment method/channel/trx (RLS hardening BUG-001)';
COMMENT ON FUNCTION customer_apply_smart_payment IS 'Customer apply smart payment update (RLS hardening BUG-001)';
COMMENT ON FUNCTION sekretariat_toggle_payment_status IS 'Sekretariat toggle payment status with auto-clear notes';
COMMENT ON FUNCTION pengambilan_set_pickup IS 'Pengambilan set pickup status (BUG-030 fix)';
