-- ==========================================
-- MIGRATION: Booth-specific background settings
-- Ganti is_active global di backgrounds dengan per-booth settings
-- ==========================================

-- 1. Buat tabel junction booth_background_settings
CREATE TABLE IF NOT EXISTS booth_background_settings (
    booth_id    INTEGER NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
    background_id INTEGER NOT NULL REFERENCES backgrounds(id) ON DELETE CASCADE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (booth_id, background_id)
);

COMMENT ON TABLE booth_background_settings IS 'Status buka/tutup background per booth';

-- 2. Enable RLS
ALTER TABLE booth_background_settings ENABLE ROW LEVEL SECURITY;

-- 3. Public bisa baca (customer & monitor perlu cek status)
CREATE POLICY "Public read booth_background_settings"
ON booth_background_settings FOR SELECT
TO public USING (true);

-- 4. Authenticated bisa update (sekretariat)
CREATE POLICY "Authenticated update booth_background_settings"
ON booth_background_settings FOR ALL
TO authenticated USING (true) WITH CHECK (true);

-- 5. Populate: buat row default (semua aktif) untuk semua kombinasi booth x background yang ada
INSERT INTO booth_background_settings (booth_id, background_id, is_active)
SELECT b.id, bg.id, TRUE
FROM booths b
CROSS JOIN backgrounds bg
ON CONFLICT (booth_id, background_id) DO NOTHING;

-- 6. Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE booth_background_settings;
