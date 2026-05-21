-- AntriPhotobooth: Payment Integration Schema Update
-- Copy dan jalankan script ini di SQL Editor pada dashboard Supabase Anda.

-- 1. Tambahkan kolom pembayaran pada tabel queues
ALTER TABLE queues 
ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS payment_trx_id TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS payment_channel TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Pastikan kolom payment_status tetap default 'belum_lunas'
ALTER TABLE queues ALTER COLUMN payment_status SET DEFAULT 'belum_lunas';
