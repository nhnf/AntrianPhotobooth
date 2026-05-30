-- ==========================================
-- Fix RLS: Tambah policy UPDATE untuk backgrounds
-- Sekretariat (authenticated) perlu bisa update is_active
-- ==========================================

-- Drop policy lama kalau ada
DROP POLICY IF EXISTS "Authenticated users can update backgrounds" ON backgrounds;

-- Tambah policy UPDATE untuk authenticated users (sekretariat/admin)
CREATE POLICY "Authenticated users can update backgrounds"
ON backgrounds FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Verifikasi
SELECT policyname, cmd, roles 
FROM pg_policies 
WHERE tablename = 'backgrounds';
