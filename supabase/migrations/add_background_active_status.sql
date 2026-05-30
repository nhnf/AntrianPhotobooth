-- ==========================================
-- MIGRATION: Tambah kolom is_active ke tabel backgrounds
-- Fitur: sekretariat bisa buka/kunci background
-- ==========================================

ALTER TABLE backgrounds
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL;

COMMENT ON COLUMN backgrounds.is_active IS 'TRUE = background terbuka untuk dipesan, FALSE = background dikunci/ditutup';

-- Semua background yang sudah ada dianggap aktif
UPDATE backgrounds SET is_active = TRUE WHERE is_active IS NULL;
