-- ==========================================
-- Enable Realtime untuk tabel backgrounds
-- Agar customer & monitor otomatis update saat background dikunci/dibuka
-- ==========================================

-- Tambahkan tabel backgrounds ke realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE backgrounds;
