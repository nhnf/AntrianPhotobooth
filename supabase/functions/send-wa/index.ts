import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const FONNTE_TOKEN = Deno.env.get("FONNTE_TOKEN");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function sendWaFonnte(noWa: string, message: string) {
  if (!noWa || !FONNTE_TOKEN) return null;
  const formData = new URLSearchParams();
  formData.append("target", noWa);
  formData.append("message", message);
  formData.append("delay", "1-2");

  const response = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: {
      "Authorization": FONNTE_TOKEN,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });
  return await response.json();
}

serve(async (req) => {
  try {
    const payload = await req.json();
    console.log("Webhook payload:", JSON.stringify(payload));

    // Supabase webhook bisa kirim dalam 2 format:
    // Format 1 (Database Webhook): { type, table, record, old_record }
    // Format 2 (pg_net / older): { type, record, old_record }
    const type = payload.type;
    const newRecord = payload.record || payload.new;
    const oldRecord = payload.old_record || payload.old;

    if (!newRecord || !newRecord.no_wa) {
      console.log("Skip: no_wa kosong atau record tidak valid");
      return new Response(JSON.stringify({ message: "Bukan record valid / No WA kosong" }), { status: 200 });
    }

    const noWa = newRecord.no_wa;
    const nama = newRecord.nama_lengkap;
    const kelas = newRecord.kelas;
    const alamat = newRecord.alamat;
    const nomorAntrian = newRecord.nomor_antrian;

    let pesanWA = "";

    // ============================================
    // 1. PENDAFTARAN (INSERT)
    // ============================================
    if (type === 'INSERT') {
      // Kirim hanya untuk row pertama (cegah duplikat jika pesan banyak background)
      const { data: firstRow } = await supabase
        .from('queues')
        .select('id')
        .eq('nomor_antrian', nomorAntrian)
        .order('id', { ascending: true })
        .limit(1)
        .single();

      if (firstRow && firstRow.id === newRecord.id) {
        const { data: allQueues } = await supabase
          .from('queues')
          .select('jumlah_foto, pigura, backgrounds(nama_background)')
          .eq('nomor_antrian', nomorAntrian);

        let totalFoto = 0;
        let totalPigura = 0;
        const rincianBg: string[] = [];

        if (allQueues) {
          allQueues.forEach((q: any, index: number) => {
            totalFoto += (q.jumlah_foto || 0);
            if (index === 0) totalPigura = (q.pigura || 0);
            if (q.backgrounds?.nama_background) {
              rincianBg.push(`- ${q.backgrounds.nama_background} (${q.jumlah_foto} foto)`);
            }
          });
        }

        const totalHarga = (totalFoto * 40000) + (totalPigura * 25000);
        const rincianPigura = totalPigura > 0 ? `\n- Pigura (${totalPigura} pcs)` : '';
        const formatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

        pesanWA =
          `Halo ${nama},\n\n` +
          `Terima kasih telah mendaftar di Photobooth Mediatech An-Nur II!\n\n` +
          `Detail Pendaftaran:\n` +
          `Nomor Tiket: *${nomorAntrian}*\n` +
          `Nama: ${nama}\n` +
          `Kelas: ${kelas}\n` +
          `Alamat: ${alamat}\n\n` +
          `*Pesanan Anda:*\n${rincianBg.join('\n')}${rincianPigura}\n\n` +
          `*Total Biaya: ${formatter.format(totalHarga)}*\n\n` +
          `Silakan selesaikan pembayaran agar antrian Anda dapat diproses.\n` +
          `(Abaikan jika Anda sudah memilih Bayar Tunai di Kasir).\n\n` +
          `---\n` +
          `💡 *Tips: Simpan nomor ini agar Anda bisa menerima notifikasi panggilan antrian dengan lancar.*`;
      }
    }

    // ============================================
    // 2. UPDATE
    // ============================================
    else if (type === 'UPDATE') {
      const statusBaru = newRecord.status;
      const statusLama = oldRecord?.status;
      const paymentBaru = newRecord.payment_status;
      const paymentLama = oldRecord?.payment_status;

      // A. PEMBAYARAN LUNAS
      if (paymentLama !== 'lunas' && paymentBaru === 'lunas') {
        pesanWA =
          `Halo ${nama},\n\n` +
          `Pembayaran untuk tiket *${nomorAntrian}* telah lunas. Terima kasih! ✅\n` +
          `Antrian Anda siap untuk diproses.`;
      }

      // B. STATUS BERUBAH
      if (statusLama !== statusBaru) {

        // B1. DIPANGGIL — kirim WA setiap kali masuk background baru
        if (statusBaru === "dipanggil") {
          const { data: bgData } = await supabase
            .from('backgrounds')
            .select('nama_background')
            .eq('id', newRecord.background_id)
            .single();
          const namaBg = bgData?.nama_background || 'Area Photobooth';

          // Cek berapa background yang dipesan & ini sesi ke berapa
          const { data: allBgOrders } = await supabase
            .from('queues')
            .select('background_id, status')
            .eq('nomor_antrian', nomorAntrian)
            .order('id', { ascending: true });

          const totalBg = allBgOrders?.length || 1;
          const bgIndex = allBgOrders
            ? allBgOrders.findIndex((q: any) => q.background_id === newRecord.background_id) + 1
            : 1;
          const sesiInfo = totalBg > 1 ? ` (Sesi ${bgIndex} dari ${totalBg})` : '';

          pesanWA =
            `Halo ${nama},\n\n` +
            `🎉 Nomor antrian Anda *${nomorAntrian}* sedang dipanggil!\n` +
            `Silakan langsung menuju ke *${namaBg}*${sesiInfo}.\n\n` +
            `Jangan sampai terlewat!`;

          // B2. CEK SISA 2 ANTRIAN — kirim notif ke orang ke-3 dalam antrian
          const { data: waitingData } = await supabase
            .from('queues')
            .select('no_wa, nama_lengkap, nomor_antrian')
            .eq('background_id', newRecord.background_id)
            .eq('status', 'menunggu')
            .order('created_at', { ascending: true });

          if (waitingData && waitingData.length >= 3) {
            const orangKe3 = waitingData[2];

            // Cegah double notif: hanya kirim jika ini background pertama yang dipesan
            const { data: firstBg } = await supabase
              .from('queues')
              .select('background_id')
              .eq('nomor_antrian', orangKe3.nomor_antrian)
              .order('id', { ascending: true })
              .limit(1)
              .single();

            if (firstBg && firstBg.background_id === newRecord.background_id) {
              const msgSisa2 =
                `Halo ${orangKe3.nama_lengkap}!\n\n` +
                `Giliran Anda (Nomor *${orangKe3.nomor_antrian}*) tinggal *2 antrian lagi*.\n` +
                `Harap bersiap-siap di dekat area Photobooth. 🏃`;
              await sendWaFonnte(orangKe3.no_wa, msgSisa2);
            }
          }
        }

        // B3. SELESAI — kirim hanya jika SEMUA background sudah selesai
        else if (statusBaru === "selesai") {
          const { data: allQueues } = await supabase
            .from('queues')
            .select('status')
            .eq('nomor_antrian', nomorAntrian);

          if (allQueues && allQueues.every((q: any) => q.status === "selesai")) {
            pesanWA =
              `Halo ${nama},\n\n` +
              `Terima kasih telah melakukan sesi foto di Photobooth Mediatech An-Nur II! 📸\n\n` +
              `Untuk pengambilan hasil cetak pesanan Anda, silakan ambil di *Kantor SMA* pada tanggal *3 Juni 2026*.\n\n` +
              `Terima kasih banyak!`;
          }
        }

        // B4. BATAL
        else if (statusBaru === "batal") {
          pesanWA =
            `Halo ${nama},\n\n` +
            `Mohon maaf, antrian tiket *${nomorAntrian}* Anda telah dibatalkan oleh admin.\n` +
            `Jika ada pertanyaan, silakan hubungi petugas jaga.`;
        }

        // B5. DITUNDA
        else if (statusBaru === "ditunda") {
          pesanWA =
            `Halo ${nama},\n\n` +
            `Mohon maaf, antrian Anda dengan nomor *${nomorAntrian}* sedang ditunda.\n` +
            `Harap segera melapor ke petugas jaga di area Photobooth.\n\n` +
            `- Admin Photobooth`;
        }

        // B6. KEMBALI KE ANTRIAN (dari ditunda)
        else if (statusLama === "ditunda" && statusBaru === "menunggu") {
          pesanWA =
            `Halo ${nama},\n\n` +
            `Kehadiran Anda telah dikonfirmasi. ✅\n` +
            `Nomor antrian *${nomorAntrian}* telah dimasukkan kembali ke dalam daftar tunggu.\n` +
            `Harap bersiap di sekitar lokasi.`;
        }
      }
    }

    // ============================================
    // Kirim WA
    // ============================================
    if (pesanWA !== "") {
      console.log(`Sending WA to ${noWa}: ${pesanWA.substring(0, 50)}...`);
      const result = await sendWaFonnte(noWa, pesanWA);
      console.log("Fonnte result:", JSON.stringify(result));
      return new Response(JSON.stringify({ success: true, result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ message: "No relevant action taken" }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Error processing webhook:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
