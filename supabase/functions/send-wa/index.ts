// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// const FONNTE_TOKEN = Deno.env.get("FONNTE_TOKEN");
// const supabaseUrl = Deno.env.get("SUPABASE_URL");
// const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// const supabase = createClient(supabaseUrl!, supabaseKey!);

// async function sendWaFonnte(noWa: string, message: string) {
//   if (!noWa || !FONNTE_TOKEN) return null;
//   const formData = new URLSearchParams();
//   formData.append("target", noWa);
//   formData.append("message", message);
//   // Tambahkan jeda acak 1-2 detik untuk menghindari deteksi spam dari WhatsApp
//   formData.append("delay", "1-2");

//   const response = await fetch("https://api.fonnte.com/send", {
//     method: "POST",
//     headers: {
//       "Authorization": FONNTE_TOKEN,
//       "Content-Type": "application/x-www-form-urlencoded",
//     },
//     body: formData,
//   });
//   return await response.json();
// }

// serve(async (req) => {
//   try {
//     const payload = await req.json();
//     const type = payload.type;
//     const newRecord = payload.record;
//     const oldRecord = payload.old_record;

//     if (!newRecord || !newRecord.no_wa) {
//       return new Response(JSON.stringify({ message: "Bukan record valid / No WA kosong" }), { status: 200 });
//     }

//     const noWa = newRecord.no_wa;
//     const nama = newRecord.nama_lengkap;
//     const kelas = newRecord.kelas;
//     const alamat = newRecord.alamat;
//     const nomorAntrian = newRecord.nomor_antrian;

//     let pesanWA = "";

//     // 1. PENDAFTARAN (INSERT)
//     if (type === 'INSERT') {
//       // Pastikan hanya kirim pesan 1 kali per nomor antrian (cek apakah ini insert row pertama)
//       const { data: firstRow } = await supabase
//         .from('queues')
//         .select('id')
//         .eq('nomor_antrian', nomorAntrian)
//         .order('id', { ascending: true })
//         .limit(1)
//         .single();
        
//       if (firstRow && firstRow.id === newRecord.id) {
//         // Ambil total foto, pigura, dan rincian background
//         const { data: allQueues } = await supabase
//             .from('queues')
//             .select('jumlah_foto, pigura, backgrounds(nama_background)')
//             .eq('nomor_antrian', nomorAntrian);
        
//         let totalFoto = 0;
//         let totalPigura = 0;
//         let rincianBg: string[] = [];
        
//         if (allQueues) {
//             allQueues.forEach((q: any) => {
//                 totalFoto += (q.jumlah_foto || 0);
//                 totalPigura += (q.pigura || 0);
//                 if (q.backgrounds && q.backgrounds.nama_background) {
//                     rincianBg.push(`- ${q.backgrounds.nama_background} (${q.jumlah_foto} foto)`);
//                 }
//             });
//         }
        
//         const totalHarga = (totalFoto * 40000) + (totalPigura * 35000);
//         const rincianPigura = totalPigura > 0 ? `\n- Pigura (${totalPigura} pcs)` : '';
//         const formatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

//         pesanWA = `Halo ${nama},\n\nTerima kasih telah mendaftar di Photobooth Mediatech An-Nur II!\n\nDetail Pendaftaran:\nNomor Tiket: *${nomorAntrian}*\nNama: ${nama}\nKelas: ${kelas}\nAlamat: ${alamat}\n\n*Pesanan Anda:*\n${rincianBg.join('\n')}${rincianPigura}\n\n*Total Biaya: ${formatter.format(totalHarga)}*\n\nSilakan selesaikan pembayaran agar antrian Anda dapat diproses.\n(Abaikan jika Anda sudah memilih Bayar Tunai di Kasir).\n\n---\n💡 *Tips: Simpan nomor ini agar Anda bisa menerima notifikasi panggilan antrian dengan lancar. Balas "OKE" jika Anda sudah siap mengantri!*`;
//       }
//     }
//     else if (type === 'UPDATE' && oldRecord) {
      
//       // A. PEMBAYARAN LUNAS
//       if (oldRecord.payment_status !== 'lunas' && newRecord.payment_status === 'lunas') {
//         pesanWA = `Halo ${nama},\n\nPembayaran untuk tiket *${nomorAntrian}* telah lunas. Terima kasih!\nAntrian Anda siap untuk diproses.`;
//       }

//       // B. STATUS BERUBAH
//       if (oldRecord.status !== newRecord.status) {
//         const status = newRecord.status;

//         if (status === "dipanggil") {
//           // Cari nama background
//           const { data: bgData } = await supabase.from('backgrounds').select('nama_background').eq('id', newRecord.background_id).single();
//           const namaBg = bgData ? bgData.nama_background : 'Area Photobooth';

//           pesanWA = `Halo ${nama},\n\nNomor antrian Anda *${nomorAntrian}* sedang dipanggil! 🎉\nSilakan langsung menuju ke *${namaBg}*. Jangan sampai terlewat!`;

//           // C. CEK SISA 2 ANTRIAN
//           // Ambil daftar yang menunggu di booth & background yang sama
//           const { data: waitingData } = await supabase
//             .from('queues')
//             .select('no_wa, nama_lengkap, nomor_antrian')
//             .eq('background_id', newRecord.background_id)
//             .eq('status', 'menunggu')
//             .order('created_at', { ascending: true });

//           // waitingData[0] = giliran selanjutnya (sisa 0 antrian)
//           // waitingData[1] = sisa 1 antrian
//           // waitingData[2] = sisa 2 antrian (ini yang mau kita WA)
//           if (waitingData && waitingData.length >= 3) {
//             const orangKe3 = waitingData[2];
            
//             // Mencegah pesan double jika customer memesan banyak background:
//             // Kita pastikan pesan sisa 2 hanya dikirim untuk background PERTAMA yang ia pesan.
//             const { data: firstBg } = await supabase
//               .from('queues')
//               .select('background_id')
//               .eq('nomor_antrian', orangKe3.nomor_antrian)
//               .order('id', { ascending: true })
//               .limit(1)
//               .single();

//             if (firstBg && firstBg.background_id === newRecord.background_id) {
//               const msgSisa2 = `Halo ${orangKe3.nama_lengkap}!\n\nGiliran Anda (Nomor *${orangKe3.nomor_antrian}*) tinggal 2 antrian lagi. Harap bersiap-siap di dekat area Photobooth.`;
//               await sendWaFonnte(orangKe3.no_wa, msgSisa2);
//             }
//           }

//         } else if (status === "selesai") {
//           // Cek apakah semua pesanan untuk nomor_antrian ini sudah selesai
//           const { data: allQueues } = await supabase
//             .from('queues')
//             .select('status')
//             .eq('nomor_antrian', nomorAntrian);
          
//           if (allQueues) {
//             const allSelesai = allQueues.every((q: any) => q.status === "selesai");
//             if (allSelesai) {
//               pesanWA = `Halo ${nama},\n\nTerima kasih telah melakukan sesi foto di Photobooth Mediatech An-Nur II!\n\nUntuk pengambilan hasil cetak pesanan Anda, silakan ambil di *Kantor SMA* pada tanggal *3 Juni 2026*.\n\nTerima kasih banyak!`;
//             }
//           }
//         } else if (status === "batal") {
//           pesanWA = `Halo ${nama},\n\nMohon maaf, antrian tiket *${nomorAntrian}* Anda telah dibatalkan oleh admin. Jika ada pertanyaan, silakan hubungi petugas jaga.`;
//         } else if (status === "ditunda") {
//           pesanWA = `Halo ${nama},\n\nMohon maaf, antrian Anda dengan nomor *${nomorAntrian}* sedang ditunda. Harap segera melapor ke petugas jaga di area Photobooth.\n\n- Admin Photobooth`;
//         } else if (oldRecord.status === "ditunda" && status === "menunggu") {
//           pesanWA = `Halo ${nama},\n\nKehadiran Anda telah dikonfirmasi. Nomor antrian *${nomorAntrian}* telah dimasukkan kembali ke dalam daftar tunggu. Harap bersiap di sekitar lokasi.`;
//         }
//       }
//     }

//     if (pesanWA !== "") {
//       const result = await sendWaFonnte(noWa, pesanWA);
//       return new Response(JSON.stringify({ success: true, result }), { headers: { "Content-Type": "application/json" } });
//     }

//     return new Response(JSON.stringify({ message: "No relevant action taken" }), { headers: { "Content-Type": "application/json" } });

//   } catch (error) {
//     console.error("Error processing webhook:", error);
//     return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
//   }
// });
