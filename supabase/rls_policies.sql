-- ==========================================
-- SCRIPT KEAMANAN SUPABASE (RLS)
-- ==========================================
-- Copy dan paste script ini di menu "SQL Editor" di dashboard Supabase Anda.
-- Script ini akan mengaktifkan pengamanan dasar agar data tidak bisa dihapus sembarangan oleh orang luar.

-- 1. Aktifkan RLS di semua tabel
ALTER TABLE queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE booths ENABLE ROW LEVEL SECURITY;
ALTER TABLE backgrounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_booth_access ENABLE ROW LEVEL SECURITY;

-- 2. Hapus policy lama (jika ada) agar tidak bentrok
DROP POLICY IF EXISTS "Public read access for backgrounds" ON backgrounds;
DROP POLICY IF EXISTS "Public read access for booths" ON booths;
DROP POLICY IF EXISTS "Public access for queues" ON queues;
DROP POLICY IF EXISTS "Admin full access for queues" ON queues;

-- ==========================================
-- POLICIES UNTUK BACKGROUNDS & BOOTHS
-- (Semua orang boleh melihat, hanya admin/petugas yang login yang boleh mengubah)
-- ==========================================
CREATE POLICY "Public read access for backgrounds" 
ON backgrounds FOR SELECT 
TO public USING (true);

CREATE POLICY "Public read access for booths" 
ON booths FOR SELECT 
TO public USING (true);

-- ==========================================
-- POLICIES UNTUK QUEUES (ANTRIAN)
-- ==========================================
-- Monitor dan Customer butuh melihat data antrian
CREATE POLICY "Public read access for queues" 
ON queues FOR SELECT 
TO public USING (true);

-- Customer butuh menambah antrian baru (karena tidak login)
CREATE POLICY "Public insert access for queues" 
ON queues FOR INSERT 
TO public WITH CHECK (true);

-- Customer hanya boleh mengupdate antrian (misal pilih metode pembayaran)
CREATE POLICY "Public update access for queues"
ON queues FOR UPDATE
TO public USING (true);

-- HANYA ADMIN/PETUGAS YANG LOGIN YANG BOLEH MENGHAPUS (DELETE) ANTRIAN
CREATE POLICY "Authenticated users can delete queues"
ON queues FOR DELETE
TO authenticated USING (true);

-- ==========================================
-- POLICIES UNTUK PROFIL & AKSES (Hanya untuk yang login)
-- ==========================================
CREATE POLICY "Authenticated users can read profiles"
ON user_profiles FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Authenticated users can read booth access"
ON user_booth_access FOR SELECT
TO authenticated USING (true);
