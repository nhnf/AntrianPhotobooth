# 📸 AntriPhotobooth - Sistem Manajemen Antrian Photobooth

> Sistem manajemen antrian photobooth berbasis web dengan fitur multi-booth, real-time updates, payment integration, dan smart queue management.

## 📋 Daftar Isi

- [Tentang Sistem](#tentang-sistem)
- [Teknologi](#teknologi)
- [Fitur Utama](#fitur-utama)
- [Role & Akses](#role--akses)
- [Fitur per Role](#fitur-per-role)
- [Arsitektur Sistem](#arsitektur-sistem)
- [Struktur File](#struktur-file)
- [Setup & Instalasi](#setup--instalasi)
- [Konfigurasi](#konfigurasi)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Tentang Sistem

**AntriPhotobooth** adalah sistem manajemen antrian photobooth yang dirancang untuk mengelola multiple booth secara bersamaan dengan fitur-fitur modern seperti:

- ✅ Pendaftaran online via QR Code
- ✅ Real-time queue monitoring
- ✅ Payment integration (Online & Tunai)
- ✅ WhatsApp notifications
- ✅ Voice announcements
- ✅ Multi-booth support
- ✅ Time-based access control
- ✅ Quota management
- ✅ Smart payment status

### Use Case

Sistem ini cocok untuk:
- Event sekolah/kampus dengan multiple photobooth
- Festival atau pameran dengan banyak booth
- Acara besar yang membutuhkan queue management
- Organisasi yang ingin digitalisasi proses photobooth

---

## 🛠️ Teknologi

### Frontend
- **HTML5** - Structure
- **TailwindCSS** - Styling (Neo-Brutalist Design)
- **Vanilla JavaScript** - Logic & Interactivity
- **Web Speech API** - Voice announcements

### Backend
- **Supabase** - Backend as a Service
  - PostgreSQL Database
  - Row Level Security (RLS)
  - Edge Functions (Deno)
  - Realtime Subscriptions
  - Authentication

### Integrasi
- **Fonnte API** - WhatsApp notifications
- **Paymenku** - Payment gateway (QRIS, Virtual Account, E-Wallet)
- **QR Code Generator** - Customer registration links

### Deployment
- **Static Hosting** - Vercel, Netlify, atau GitHub Pages
- **Supabase Cloud** - Database & Edge Functions

---

## ⭐ Fitur Utama

### 1. Multi-Booth Management
- Support multiple booth dalam satu sistem
- Setiap booth punya prefix tiket unik
- Booth-specific access control untuk staff
- Independent queue per booth

### 2. Real-time Queue System
- Live updates tanpa refresh
- Supabase Realtime subscriptions
- Status tracking: Menunggu → Dipanggil → Selesai
- Queue position monitoring

### 3. Payment Integration
- **Online Payment**: QRIS, Virtual Account, E-Wallet (via Paymenku)
- **Tunai**: Bayar di kasir
- Payment status tracking
- Smart payment status untuk edit pesanan

### 4. Time & Quota Control
- Set tanggal & jam buka penjualan per booth
- Countdown timer untuk customer
- Batas kuota tiket per booth
- Real-time quota monitoring
- Manual quota reset

### 5. Smart Payment Status
- Auto-detect perubahan harga saat edit pesanan
- Harga naik → Status jadi "Belum Lunas"
- Harga turun → Kelebihan bayar dikembalikan
- Tracking selisih pembayaran di notes

### 6. WhatsApp Notifications
- Konfirmasi pendaftaran dengan detail pesanan
- Notifikasi pembayaran lunas
- Alert "2 antrian lagi"
- Panggilan antrian
- Notifikasi selesai foto

### 7. Voice Announcements
- Text-to-Speech untuk panggilan antrian
- Support Bahasa Indonesia
- Prioritas neural voice (Google/Microsoft)
- Adjustable voice rate
- Manual voice selector

### 8. Photo Pickup Management
- Dashboard khusus untuk pengambilan foto
- Status tracking: Belum Diambil → Sudah Diambil
- Confirmation before marking as picked up
- Role-based access (hanya sekretariat bisa batalkan)

### 9. Customer Self-Service
- QR Code registration
- Edit pesanan (sebelum/sesudah bayar)
- Track status real-time
- Payment via online/tunai
- Order history

### 10. Admin Dashboard
- User management (CRUD)
- Booth management (CRUD)
- Background management (CRUD)
- Queue management (Edit, Delete, Status change)
- Payment status control
- System-wide monitoring

---

## 👥 Role & Akses

Sistem memiliki 4 role dengan akses berbeda:

| Role | Akses | Deskripsi |
|------|-------|-----------|
| **Admin** | Full Access | Akses ke semua fitur, user management, system configuration |
| **Sekretariat** | Dashboard + Config | Manage queue, payment, booth settings, customer data |
| **Pengambilan** | Pickup Only | Manage photo pickup, mark as collected |
| **Customer** | Public | Registration, payment, track order |

### Role Hierarchy

```
Admin (Superuser)
  ├── Sekretariat (Staff)
  ├── Pengambilan (Staff)
  └── Customer (Public)
```

---

## 🎭 Fitur per Role

### 🔴 Admin

**Akses**: `admin.html`, `sekretariat.html`, `pengambilan.html`

#### User Management
- ✅ Create user baru (email, password, role)
- ✅ Edit user (nama, role)
- ✅ Delete user
- ✅ Change password user
- ✅ Assign booth access untuk staff pengambilan

#### Booth Management
- ✅ Create booth baru
- ✅ Edit booth (nama, prefix)
- ✅ Delete booth
- ✅ Set sales schedule (tanggal & jam buka)
- ✅ Set quota (batas tiket)
- ✅ Reset quota counter
- ✅ Generate QR Code untuk customer
- ✅ Copy URL untuk monitor

#### Background Management
- ✅ Create background baru
- ✅ Edit background (nama, harga)
- ✅ Delete background
- ✅ Upload gambar background

#### Queue Management
- ✅ View all queues (semua booth)
- ✅ Edit customer data
- ✅ Edit pesanan (background, jumlah)
- ✅ Change status (Menunggu, Dipanggil, Ditunda, Selesai, Batal)
- ✅ Toggle payment status (Lunas/Belum Lunas)
- ✅ Toggle payment method (Online/Tunai)
- ✅ Add notes
- ✅ Delete queue
- ✅ Assign photographer (untuk background tertentu)
- ✅ Mark as busy/available
- ✅ Toggle pickup status

#### System Control
- ✅ Clear cache (force reload semua client)
- ✅ Broadcast system messages
- ✅ View system statistics
- ✅ Export data (future)

---

### 🟡 Sekretariat

**Akses**: `sekretariat.html`

#### Queue Management
- ✅ View queues (booth yang di-assign)
- ✅ Edit customer data
- ✅ Edit pesanan
- ✅ Change status
- ✅ Toggle payment status
- ✅ Toggle payment method
- ✅ Add notes
- ✅ Assign photographer
- ✅ Mark photographer busy/available
- ✅ Toggle pickup status (bisa batalkan "Sudah Diambil")

#### Booth Configuration
- ✅ Edit booth name & prefix
- ✅ Set sales schedule
- ✅ Set quota
- ✅ Reset quota counter
- ✅ Generate QR Code
- ✅ Copy monitor URL

#### Customer Service
- ✅ Search customer by name/ticket/phone
- ✅ Filter by booth
- ✅ Filter by payment status
- ✅ View order details
- ✅ WhatsApp direct link
- ✅ Handle payment difference (kurang bayar/kelebihan bayar)

#### Monitoring
- ✅ Real-time queue updates
- ✅ Payment status overview
- ✅ Quota monitoring
- ✅ Photographer availability

---

### 🟢 Pengambilan

**Akses**: `pengambilan.html`

#### Photo Pickup Management
- ✅ View finished orders (foto selesai)
- ✅ Search by ticket/name/phone
- ✅ Filter by booth (hanya booth yang di-assign)
- ✅ Filter by status (Belum/Sudah Diambil)
- ✅ Mark as picked up (dengan konfirmasi)
- ✅ **TIDAK BISA** batalkan "Sudah Diambil" (hanya sekretariat/admin)

#### Statistics
- ✅ Total antrian selesai
- ✅ Belum diambil
- ✅ Sudah diambil

#### Customer Info
- ✅ View customer details
- ✅ View order items
- ✅ WhatsApp direct link

**Catatan**: Staff pengambilan hanya bisa akses booth yang di-assign oleh admin.

---

### 🔵 Customer

**Akses**: `customer.html?booth=ID`

#### Registration
- ✅ Scan QR Code untuk akses
- ✅ Input data (Nama, Kelas, Alamat, No. WA)
- ✅ Pilih background (multiple)
- ✅ Pilih jumlah foto per background
- ✅ Pilih pigura (opsional)
- ✅ Pilih metode pembayaran (Online/Tunai)
- ✅ Generate nomor antrian otomatis

#### Payment
- ✅ **Online**: Generate payment link (QRIS/VA/E-Wallet)
- ✅ **Tunai**: Bayar di kasir
- ✅ Check payment status
- ✅ Auto-update status setelah bayar

#### Order Management
- ✅ Edit pesanan (sebelum/sesudah bayar)
- ✅ Smart payment status:
  - Harga naik → Bayar selisih
  - Harga turun → Kelebihan dikembalikan
  - Harga sama → Tetap lunas
- ✅ Cancel edit
- ✅ View order history

#### Tracking
- ✅ Real-time status update
- ✅ Queue position monitoring
- ✅ Estimated waiting time
- ✅ Status per background:
  - ⏳ Menunggu
  - 📢 Dipanggil
  - ⏸️ Ditunda
  - ✅ Selesai
  - ❌ Batal

#### Restrictions
- ⚠️ Tidak bisa akses jika belum jam buka (countdown timer)
- ⚠️ Tidak bisa daftar jika kuota habis
- ⚠️ Harus via QR Code (URL harus ada ?booth=ID)

---

### 📺 Monitor (Public Display)

**Akses**: `monitor.html?booth=ID`

#### Display
- ✅ Real-time queue display
- ✅ Show current called tickets
- ✅ Show waiting tickets
- ✅ Auto-scroll untuk banyak antrian
- ✅ Booth-specific display

#### Voice Announcement
- ✅ Auto-announce saat status "Dipanggil"
- ✅ Text-to-Speech Bahasa Indonesia
- ✅ Customizable voice & rate
- ✅ Manual voice selector
- ✅ Enable/disable toggle

#### Visual
- ✅ Neo-Brutalist design
- ✅ Color-coded status
- ✅ Large, readable fonts
- ✅ Responsive layout

**Catatan**: Monitor adalah public display, tidak perlu login.

---

## 🏗️ Arsitektur Sistem

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         FRONTEND                            │
├─────────────────────────────────────────────────────────────┤
│  Customer    │  Monitor   │  Sekretariat  │  Pengambilan   │
│  (Public)    │  (Public)  │  (Auth)       │  (Auth)        │
└──────┬───────┴──────┬─────┴───────┬───────┴────────┬────────┘
       │              │             │                │
       └──────────────┴─────────────┴────────────────┘
                      │
                      ▼
       ┌──────────────────────────────────────┐
       │         SUPABASE BACKEND             │
       ├──────────────────────────────────────┤
       │  • PostgreSQL Database               │
       │  • Row Level Security (RLS)          │
       │  • Realtime Subscriptions            │
       │  • Edge Functions (Deno)             │
       │  • Authentication                    │
       └──────────────┬───────────────────────┘
                      │
       ┌──────────────┴───────────────┐
       │                              │
       ▼                              ▼
┌─────────────┐              ┌─────────────┐
│   FONNTE    │              │  PAYMENKU   │
│  (WhatsApp) │              │  (Payment)  │
└─────────────┘              └─────────────┘
```

### Database Schema

**Main Tables**:
- `booths` - Booth information
- `backgrounds` - Background options
- `queues` - Queue entries (main table)
- `user_profiles` - User data & roles
- `user_booth_access` - Booth access for staff

**Key Fields in `queues`**:
- `nomor_antrian` - Ticket number (e.g., BOOTH-001)
- `booth_id` - Foreign key to booths
- `background_id` - Foreign key to backgrounds
- `nama_lengkap`, `kelas`, `alamat`, `no_wa` - Customer data
- `jumlah_foto` - Quantity
- `pigura` - Frame quantity
- `status` - Queue status (menunggu, dipanggil, selesai, batal, ditunda)
- `payment_status` - Payment status (belum_lunas, lunas, menunggu_pembayaran)
- `payment_method` - Payment method (online, tunai)
- `payment_channel` - Payment channel (qris, va_bca, gopay, etc.)
- `picked_up` - Pickup status (boolean)
- `notes` - Additional notes (including payment difference)

### RPC Functions

**Core Functions**:
- `submit_queue()` - Create new queue entry (with time & quota validation)
- `update_queue_order()` - Update existing queue
- `reset_booth_quota()` - Reset quota counter
- `update_user_password()` - Change user password
- `create_user_with_profile()` - Create new user

**Edge Functions**:
- `send-wa` - WhatsApp notifications via Fonnte
- `create-payment` - Generate payment link via Paymenku
- `check-payment` - Check payment status
- `payment-webhook` - Handle payment callbacks

---

## 📁 Struktur File

```
AntriPhotobooth/
├── index.html                 # Login page
├── customer.html              # Customer registration & tracking
├── monitor.html               # Public queue display
├── sekretariat.html           # Sekretariat dashboard
├── pengambilan.html           # Photo pickup dashboard
├── admin.html                 # Admin dashboard (future)
│
├── js/
│   ├── auth.js               # Authentication logic
│   ├── customer.js           # Customer page logic
│   ├── monitor.js            # Monitor page logic
│   ├── sekretariat.js        # Sekretariat dashboard logic
│   └── pengambilan.js        # Pengambilan dashboard logic
│
├── shared/
│   ├── config.js             # Supabase config & constants
│   ├── ui.js                 # Shared UI components (popup, confirm)
│   ├── styles.css            # Global styles (Neo-Brutalist)
│   └── tailwind-config.js    # Tailwind configuration
│
├── supabase/
│   ├── migrations/
│   │   ├── initial_schema.sql
│   │   ├── add_booth_quota_and_schedule.sql
│   │   └── ...
│   ├── rls_policies.sql      # Row Level Security policies
│   └── functions/
│       ├── send-wa/
│       ├── create-payment/
│       ├── check-payment/
│       └── payment-webhook/
│
├── assets/
│   ├── logo-mm.png           # Logo
│   └── backgrounds/          # Background images
│
└── README.md                 # This file
```

---

## 🚀 Setup & Instalasi

### Prerequisites

1. **Supabase Account** - [supabase.com](https://supabase.com)
2. **Fonnte Account** (opsional) - [fonnte.com](https://fonnte.com)
3. **Paymenku Account** (opsional) - [paymenku.com](https://paymenku.com)
4. **Text Editor** - VS Code, Sublime, dll.
5. **Web Server** - Live Server extension atau hosting

### Step 1: Clone/Download Project

```bash
git clone <repository-url>
cd AntriPhotobooth
```

### Step 2: Setup Supabase

1. Buat project baru di [Supabase Dashboard](https://supabase.com/dashboard)
2. Copy **Project URL** dan **Anon Key**
3. Jalankan migrations:
   - Buka **SQL Editor** di Supabase Dashboard
   - Copy-paste isi file `supabase/migrations/initial_schema.sql`
   - Run query
   - Ulangi untuk file migration lainnya

4. Setup RLS Policies:
   - Copy-paste isi file `supabase/rls_policies.sql`
   - Run query

5. Deploy Edge Functions (opsional):
   ```bash
   supabase functions deploy send-wa
   supabase functions deploy create-payment
   supabase functions deploy check-payment
   supabase functions deploy payment-webhook
   ```

### Step 3: Konfigurasi

Edit file `shared/config.js`:

```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

### Step 4: Setup Environment Variables (Edge Functions)

Di Supabase Dashboard → Settings → Edge Functions → Secrets:

```
FONNTE_TOKEN=your-fonnte-token
PAYMENKU_API_KEY=your-paymenku-api-key
PAYMENKU_WEBHOOK_SECRET=your-webhook-secret
```

### Step 5: Create Admin User

Via Supabase Dashboard → Authentication → Users:
1. Create user baru dengan email & password
2. Copy User ID
3. Insert ke `user_profiles`:
   ```sql
   INSERT INTO user_profiles (id, name, role)
   VALUES ('user-id-here', 'Admin', 'admin');
   ```

### Step 6: Run Locally

```bash
# Menggunakan Live Server (VS Code extension)
# Atau Python simple server
python -m http.server 8000

# Atau Node.js http-server
npx http-server -p 8000
```

Buka browser: `http://localhost:8000`

---

## ⚙️ Konfigurasi

### Harga

Edit di `shared/config.js`:

```javascript
const HARGA_PER_FOTO = 40000;  // Harga per foto
const HARGA_PIGURA = 35000;    // Harga pigura
```

### Status

```javascript
const STATUS = {
    MENUNGGU: 'menunggu',
    DIPANGGIL: 'dipanggil',
    DITUNDA: 'ditunda',
    SELESAI: 'selesai',
    BATAL: 'batal'
};
```

### Voice Settings

Di `monitor.html`, adjust voice rate:

```javascript
let _voiceRate = 0.9;  // 0.1 - 2.0 (0.9 = optimal)
```

---

## 🌐 Deployment

### Option 1: Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Option 2: Netlify

```bash
# Install Netlify CLI
npm i -g netlify-cli

# Deploy
netlify deploy
```

### Option 3: GitHub Pages

1. Push ke GitHub repository
2. Settings → Pages → Source: main branch
3. Save

### Option 4: Manual Hosting

Upload semua file ke web hosting (cPanel, FTP, dll.)

**Catatan**: Pastikan Supabase URL di `config.js` sudah benar!

---

## 🐛 Troubleshooting

### Issue: "Booth Tidak Diketahui"

**Solusi**: Pastikan URL customer page ada parameter `?booth=ID`
```
✅ Correct: customer.html?booth=1
❌ Wrong: customer.html
```

### Issue: "Function not found: submit_queue"

**Solusi**: Jalankan migration SQL di Supabase Dashboard

### Issue: Payment link tidak generate

**Solusi**: 
1. Cek environment variables di Supabase
2. Pastikan `PAYMENKU_API_KEY` sudah diset
3. Cek logs di Edge Functions

### Issue: WhatsApp tidak terkirim

**Solusi**:
1. Cek `FONNTE_TOKEN` di environment variables
2. Pastikan Edge Function `send-wa` sudah deployed
3. Cek quota Fonnte

### Issue: Voice announcement tidak jalan

**Solusi**:
1. Klik tombol "Aktifkan Suara" di monitor (browser policy)
2. Pastikan browser support Web Speech API
3. Cek console untuk error

### Issue: Realtime tidak update

**Solusi**:
1. Cek Supabase Realtime status di dashboard
2. Refresh halaman
3. Cek browser console untuk error

---

## 📊 Monitoring & Maintenance

### Database Maintenance

```sql
-- Reset quota semua booth
UPDATE booths SET current_ticket_count = 0;

-- Clear old queues (older than 30 days)
DELETE FROM queues WHERE created_at < NOW() - INTERVAL '30 days';

-- View statistics
SELECT 
    booth_id,
    COUNT(*) as total_orders,
    SUM(CASE WHEN payment_status = 'lunas' THEN 1 ELSE 0 END) as paid_orders
FROM queues
GROUP BY booth_id;
```

### Backup

Supabase auto-backup daily. Manual backup:
1. Dashboard → Database → Backups
2. Download backup

### Logs

Check Edge Function logs:
1. Dashboard → Edge Functions
2. Select function
3. View logs

---

## 🔒 Security

### API Keys

- ✅ `SUPABASE_ANON_KEY` - Public (client-side)
- ❌ `SUPABASE_SERVICE_ROLE_KEY` - Private (server-side only)
- ❌ `FONNTE_TOKEN` - Private (Edge Functions only)
- ❌ `PAYMENKU_API_KEY` - Private (Edge Functions only)

### RLS Policies

- ✅ Public read: backgrounds, booths, queues
- ✅ Public insert: queues (customer registration)
- ✅ Public update: queues (customer edit)
- ❌ Public delete: queues (authenticated only)
- ❌ User management: authenticated only

### Best Practices

1. Jangan commit API keys ke Git
2. Use environment variables untuk secrets
3. Enable RLS di semua tabel
4. Regular backup database
5. Monitor suspicious activities

---

## 📝 Changelog

### v2.0.0 (2026-05-25)
- ✨ Smart Payment Status untuk edit pesanan
- ✨ Time-based access control & quota management
- ✨ Pickup management dengan role-based access
- 🐛 Fix concurrent edit issues

### v1.5.0 (2026-05-24)
- ✨ Voice announcements di monitor
- ✨ WhatsApp notifications
- 🐛 Fix busy status sync

### v1.0.0 (2026-05-20)
- 🎉 Initial release
- ✨ Multi-booth support
- ✨ Payment integration
- ✨ Real-time queue management

---

## 👨‍💻 Developer

Developed by **Nur Hanafi**

---

## 📄 License

This project is proprietary software. All rights reserved.

---

## 🙏 Acknowledgments

- **Supabase** - Backend infrastructure
- **TailwindCSS** - Styling framework
- **Fonnte** - WhatsApp API
- **Paymenku** - Payment gateway

---

## 📞 Support

Untuk pertanyaan atau issue, hubungi:
- Email: nhnf198.id@gmail.com

---

**Last Updated**: 2026-05-25
**Version**: 2.0.0
