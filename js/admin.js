// ============================================
// Admin Dashboard Logic — AntriPhotobooth
// ============================================

let backgrounds = [];
let allQueues = [];
const cardColors = ['bg-neoYellow', 'bg-neoPink', 'bg-neoGreen'];

// Setup Supabase Realtime channel
const systemChannel = supabaseClient.channel('system-events', {
    config: { broadcast: { self: true } }
});

// Manage Prefix System
let currentPrefix = localStorage.getItem('adminTicketPrefix') || 'PB';

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Auth guard — redirect to login if not authenticated
    const user = await checkAuth();
    if (!user) return;

    document.getElementById('admin-prefix').value = currentPrefix;
    await loadInitialData();
    subscribeToUpdates();
    initPrefixSystem();
});

// ============================================
// Prefix System
// ============================================
function initPrefixSystem() {
    systemChannel.on('broadcast', { event: 'request_prefix' }, () => {
        systemChannel.send({
            type: 'broadcast',
            event: 'update_prefix',
            payload: { prefix: currentPrefix }
        });
    });

    systemChannel.subscribe();
}

function changePrefix(newPrefix) {
    if (!newPrefix) return;
    currentPrefix = newPrefix;
    localStorage.setItem('adminTicketPrefix', newPrefix);
    systemChannel.send({
        type: 'broadcast',
        event: 'update_prefix',
        payload: { prefix: newPrefix }
    });
    showPopup("Info", `Kode tiket berhasil diubah menjadi ${newPrefix}. Pelanggan yang sedang membuka web otomatis menggunakan kode ini.`);
}

// ============================================
// Data Loading
// ============================================
async function loadInitialData() {
    try {
        const { data: bgs, error: bgError } = await supabaseClient.from('backgrounds').select('*').order('id');
        if (bgError) return showPopup("Error", bgError.message, true);
        backgrounds = bgs;

        await fetchQueues();
    } catch (e) {
        console.error('loadInitialData error:', e);
        showPopup("Error", "Gagal memuat data awal: " + e.message, true);
    }
}

async function fetchQueues() {
    try {
        const { data: queues, error } = await supabaseClient
            .from('queues')
            .select('*')
            .in('status', [STATUS.MENUNGGU, STATUS.DIPANGGIL, STATUS.DITUNDA])
            .order('created_at', { ascending: true });

        if (error) return showPopup("Error", error.message, true);
        allQueues = queues;
        renderColumns();
    } catch (e) {
        console.error('fetchQueues error:', e);
    }
}

// ============================================
// Realtime Subscription
// ============================================
function subscribeToUpdates() {
    supabaseClient.channel('admin-queues')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, () => {
            fetchQueues();
        })
        .subscribe();
}

// ============================================
// Render UI
// ============================================
function renderColumns() {
    const container = document.getElementById('admin-columns');

    const currentlyCalledAnywhere = allQueues
        .filter(q => q.status === STATUS.DIPANGGIL)
        .map(q => q.nomor_antrian);

    container.innerHTML = backgrounds.map((bg, index) => {
        const bgQueues = allQueues.filter(q => q.background_id === bg.id);
        const currentCalled = bgQueues.find(q => q.status === STATUS.DIPANGGIL);
        const waitingList = bgQueues.filter(q => q.status === STATUS.MENUNGGU);
        const delayedList = bgQueues.filter(q => q.status === STATUS.DITUNDA);

        const headerColor = cardColors[index % cardColors.length];

        return `
        <div class="flex flex-col h-full border-4 border-black shadow-[8px_8px_0px_0px_#000] bg-white">
            <!-- Column Header -->
            <div class="flex justify-between items-center p-4 border-b-4 border-black ${headerColor}">
                <h2 class="text-2xl font-black uppercase tracking-tight">${bg.nama_background}</h2>
                <span class="font-mono font-bold bg-white border-2 border-black px-2 py-1 shadow-[2px_2px_0px_0px_#000]">Antri: ${waitingList.length}</span>
            </div>

            <!-- CURRENT CALLED -->
            <div class="p-6 text-center border-b-4 border-black bg-white">
                <div class="font-mono text-sm font-bold uppercase mb-2">Sedang Dipanggil</div>
                <div class="text-6xl font-black tracking-tighter ${currentCalled ? 'text-black' : 'text-gray-300'} mb-2">
                    ${currentCalled ? currentCalled.nomor_antrian : '--'}
                </div>
                ${currentCalled ? `
                    <div class="font-bold text-lg uppercase bg-black text-white py-1 mb-1">${currentCalled.nama_lengkap}</div>
                    <div class="font-mono font-bold border-2 border-black inline-block px-2">KLS: ${currentCalled.kelas} | FOTO: ${currentCalled.jumlah_foto}x</div>
                ` : ''}
            </div>

            <!-- ACTIONS -->
            <div class="p-4 grid grid-cols-3 gap-2 border-b-4 border-black bg-bgLight">
                <button onclick="callNext(${bg.id})" ${waitingList.length === 0 ? 'disabled' : ''} 
                    class="neo-button col-span-3 bg-neoCyan font-black uppercase py-4 text-lg">
                    Panggil Berikutnya
                </button>
                
                <button onclick="markCurrentAs('${STATUS.SELESAI}', ${bg.id})" ${!currentCalled ? 'disabled' : ''}
                    class="neo-button bg-neoGreen font-bold uppercase py-2 text-sm">
                    Selesai
                </button>
                
                <button onclick="markAsDelayed(${bg.id})" ${!currentCalled ? 'disabled' : ''}
                    class="neo-button bg-neoYellow font-bold uppercase py-2 text-sm">
                    Tunda
                </button>

                <button onclick="markCurrentAs('${STATUS.BATAL}', ${bg.id})" ${!currentCalled ? 'disabled' : ''}
                    class="neo-button bg-white font-bold uppercase py-2 text-sm text-red-600">
                    Batal
                </button>
            </div>

            <!-- DAFTAR DITUNDA -->
            ${delayedList.length > 0 ? `
            <div class="p-4 bg-neoYellow border-b-4 border-black">
                <div class="font-mono text-sm font-bold uppercase mb-3 border-b-2 border-black pb-1">Daftar Ditunda (${delayedList.length})</div>
                <div class="space-y-2">
                    ${delayedList.map(q => `
                        <div class="flex justify-between items-center p-2 bg-white border-2 border-black shadow-[2px_2px_0px_0px_#000]">
                            <div>
                                <div class="font-black">${q.nomor_antrian}</div>
                                <div class="text-xs font-bold uppercase">${q.nama_lengkap}</div>
                            </div>
                            <button onclick="returnToQueue('${q.nomor_antrian}')" class="bg-black text-white px-3 py-1 font-bold text-xs uppercase neo-button hover:-translate-y-0.5 hover:-translate-x-0.5">
                                Hadir
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            <!-- WAITING LIST -->
            <div class="flex-1 min-h-[200px] p-6 bg-white">
                <div class="font-mono text-sm font-bold uppercase mb-4 border-b-2 border-black pb-2">Daftar Menunggu</div>
                <div class="space-y-3 overflow-y-auto max-h-[300px] pr-2">
                    ${waitingList.length > 0 ? waitingList.map((q) => {
            const isBusy = currentlyCalledAnywhere.includes(q.nomor_antrian);
            return `
                        <div class="flex flex-col p-3 border-2 border-black shadow-[2px_2px_0px_0px_#000] relative bg-white">
                            <div class="flex justify-between items-center border-b-2 border-black pb-1 mb-1">
                                <span class="font-black text-xl">${q.nomor_antrian}</span>
                                <span class="font-mono font-bold bg-black text-white px-2 py-0.5">${q.jumlah_foto}x</span>
                            </div>
                            <div class="font-bold text-sm uppercase truncate" title="${q.nama_lengkap}">${q.nama_lengkap || '-'}</div>
                            <div class="font-mono text-xs uppercase text-gray-600">${q.kelas || '-'}</div>
                            
                            ${isBusy ? `
                                <div class="absolute inset-0 bg-white/90 backdrop-blur-[1px] flex flex-col items-center justify-center border-2 border-neoRed" style="z-index: 10;">
                                    <span class="font-black text-neoRed uppercase text-lg">SIBUK</span>
                                    <span class="font-mono text-xs font-bold text-center px-2">DI BACKGROUND LAIN</span>
                                </div>
                            ` : ''}
                        </div>
                        `;
        }).join('') : `
                        <div class="text-center py-4 font-mono font-bold text-gray-400 uppercase">Tidak ada antrian</div>
                    `}
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// ============================================
// Queue Actions
// ============================================
async function callNext(bgId) {
    const bgQueues = allQueues.filter(q => q.background_id === bgId);
    const currentCalled = bgQueues.find(q => q.status === STATUS.DIPANGGIL);

    const currentlyCalledAnywhere = allQueues
        .filter(q => q.status === STATUS.DIPANGGIL)
        .map(q => q.nomor_antrian);

    const nextWaiting = bgQueues.find(q =>
        q.status === STATUS.MENUNGGU && !currentlyCalledAnywhere.includes(q.nomor_antrian)
    );

    if (!nextWaiting) {
        const anyWaiting = bgQueues.find(q => q.status === STATUS.MENUNGGU);
        if (anyWaiting) {
            showPopup("Harap Tunggu", "Antrian berikutnya sedang sibuk berfoto di background lain. Sistem otomatis menunggunya. Belum ada antrian lain yang tersedia.");
        } else {
            showPopup("Informasi", "Tidak ada antrian yang menunggu.");
        }
        return;
    }

    try {
        if (currentCalled) {
            await supabaseClient.from('queues').update({ status: STATUS.SELESAI }).eq('id', currentCalled.id);
        }

        await supabaseClient.from('queues').update({ status: STATUS.DIPANGGIL }).eq('id', nextWaiting.id);
    } catch (e) {
        console.error(e);
        showPopup("Error", "Gagal memanggil antrian", true);
    }
}

async function returnToQueue(nomor_antrian) {
    try {
        const { error } = await supabaseClient
            .from('queues')
            .update({ status: STATUS.MENUNGGU })
            .eq('nomor_antrian', nomor_antrian)
            .eq('status', STATUS.DITUNDA);
        if (error) throw error;
    } catch (e) {
        console.error(e);
        showPopup("Error", "Gagal mengembalikan antrian: " + e.message, true);
    }
}

async function markAsDelayed(bgId) {
    const currentCalled = allQueues.find(q => q.background_id === bgId && q.status === STATUS.DIPANGGIL);
    if (currentCalled) {
        try {
            const { error } = await supabaseClient
                .from('queues')
                .update({ status: STATUS.DITUNDA })
                .eq('nomor_antrian', currentCalled.nomor_antrian)
                .in('status', [STATUS.MENUNGGU, STATUS.DIPANGGIL]);
            if (error) throw error;
        } catch (e) {
            console.error("Error delaying status:", e);
            showPopup("Error", "Gagal menunda antrian: " + e.message, true);
        }
    }
}

async function markCurrentAs(status, bgId) {
    const currentCalled = allQueues.find(q => q.background_id === bgId && q.status === STATUS.DIPANGGIL);
    if (currentCalled) {
        try {
            const { error } = await supabaseClient.from('queues').update({ status: status }).eq('id', currentCalled.id);
            if (error) throw error;
        } catch (e) {
            console.error("Error updating status:", e);
            showPopup("Error", "Gagal mengupdate status: " + e.message, true);
        }
    }
}

// ============================================
// Cache & Reset
// ============================================
async function broadcastClearCache() {
    showConfirm(
        "Wipe Cache",
        "⚠️ PERINGATAN: Tombol ini akan menghapus paksa memori (cache) tiket di SEMUA HP pelanggan yang saat ini membuka web antrian.<br><br>Yakin ingin mereset cache pelanggan?",
        "YA, WIPE CACHE",
        async () => {
            await systemChannel.send({
                type: 'broadcast',
                event: 'clear_cache',
                payload: { action: 'wipe' }
            });
            showPopup("Sukses", "✅ Sinyal pembersihan cache telah disebarkan ke semua pelanggan!");
        }
    );
}

function resetAllQueues() {
    showConfirm(
        "Reset Semua Antrian",
        "YAKIN INGIN MENGHAPUS SEMUA DATA ANTRIAN? Semua data akan terhapus permanen dan nomor tiket kembali ke PB-001.",
        "YA, RESET",
        async () => {
            try {
                const { data: allRows, error: fetchErr } = await supabaseClient
                    .from('queues')
                    .select('id');

                if (fetchErr) throw fetchErr;

                if (allRows && allRows.length > 0) {
                    const ids = allRows.map(row => row.id);
                    const { error: delErr } = await supabaseClient
                        .from('queues')
                        .delete()
                        .in('id', ids);

                    if (delErr) throw delErr;
                }

                await systemChannel.send({
                    type: 'broadcast',
                    event: 'clear_cache',
                    payload: { action: 'wipe' }
                });

                showPopup("Sukses", "✅ Semua antrian dibatalkan! Nomor tiket berikutnya akan mulai dari PB-001.");
                fetchQueues();
            } catch (e) {
                console.error(e);
                showPopup("Error", "Gagal mereset: " + e.message, true);
            }
        }
    );
}

// ============================================
// Export / Import / PDF
// ============================================
async function exportData() {
    try {
        const { data, error } = await supabaseClient.from('queues').select('*');
        if (error) throw error;

        const dataStr = JSON.stringify(data, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const now = new Date().toISOString().slice(0, 10);
        link.download = `backup-photobooth-${now}.json`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
        showPopup("Berhasil", "✅ Data antrian berhasil diekspor ke file JSON.");
    } catch (e) {
        console.error(e);
        showPopup("Error", "Gagal mengekspor data: " + e.message, true);
    }
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) throw new Error("Format file tidak valid (bukan daftar antrian).");

            showConfirm(
                "Import Data JSON",
                `Ditemukan ${data.length} baris data. Proses import akan MENGHAPUS SEMUA data saat ini dan menimpanya dengan data dari file JSON. Lanjutkan?`,
                "YA, IMPORT",
                async () => {
                    try {
                        const { data: allRows } = await supabaseClient.from('queues').select('id');
                        if (allRows && allRows.length > 0) {
                            await supabaseClient.from('queues').delete().in('id', allRows.map(r => r.id));
                        }

                        const cleanData = data.map(row => {
                            const { id, ...rest } = row;
                            return rest;
                        });

                        const { error } = await supabaseClient.from('queues').insert(cleanData);
                        if (error) throw error;

                        showPopup("Berhasil", "✅ Data berhasil dipulihkan (import)!");
                        fetchQueues();
                    } catch (importErr) {
                        console.error(importErr);
                        showPopup("Error", "Gagal melakukan import: " + importErr.message, true);
                    } finally {
                        document.getElementById('import-file').value = "";
                    }
                }
            );
        } catch (err) {
            console.error(err);
            showPopup("Error", "Gagal membaca file JSON: " + err.message, true);
            document.getElementById('import-file').value = "";
        }
    };
    reader.readAsText(file);
}

async function downloadPDF() {
    try {
        const { data, error } = await supabaseClient
            .from('queues')
            .select('*, backgrounds(nama_background)')
            .neq('status', STATUS.BATAL)
            .order('created_at', { ascending: true });

        if (error) throw error;
        if (!data || data.length === 0) {
            return showPopup("Tidak Ada Data", "Belum ada data pendaftar yang bisa diunduh.");
        }

        // Group by nomor_antrian
        const grouped = {};
        data.forEach(row => {
            if (!grouped[row.nomor_antrian]) {
                grouped[row.nomor_antrian] = {
                    nomor: row.nomor_antrian,
                    nama: row.nama_lengkap || '-',
                    kelas: row.kelas || '-',
                    alamat: row.alamat || '-',
                    items: [],
                    totalFoto: 0,
                    totalPigura: 0
                };
            }
            grouped[row.nomor_antrian].items.push({
                background: row.backgrounds?.nama_background || '-',
                qty: row.jumlah_foto || 0,
                status: row.status
            });
            grouped[row.nomor_antrian].totalFoto += (row.jumlah_foto || 0);
            grouped[row.nomor_antrian].totalPigura += (row.pigura || 0);
        });

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('landscape', 'mm', 'a4');

        // Header
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('LAPORAN DATA PENDAFTAR PHOTOBOOTH', 148.5, 18, { align: 'center' });

        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.text('Mediatech An-Nur II', 148.5, 25, { align: 'center' });

        const now = new Date();
        const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        doc.setFontSize(9);
        doc.text(`Dicetak: ${dateStr}, ${timeStr}`, 148.5, 31, { align: 'center' });

        // Table data
        const tableData = [];
        let no = 1;
        let grandTotalFoto = 0;
        let grandTotalPigura = 0;
        let grandTotalHarga = 0;

        Object.values(grouped).forEach(g => {
            let pembelianList = g.items.map(i => `- ${i.background} (${i.qty}x) [${i.status.toUpperCase()}]`);
            if (g.totalPigura > 0) {
                pembelianList.push(`- Pigura (${g.totalPigura}x)`);
            }
            const pembelianDetails = pembelianList.join('\n');

            const hargaFoto = g.totalFoto * HARGA_PER_FOTO;
            const hargaPigura = g.totalPigura * HARGA_PIGURA;
            const totalHarga = hargaFoto + hargaPigura;

            grandTotalFoto += g.totalFoto;
            grandTotalPigura += g.totalPigura;
            grandTotalHarga += totalHarga;

            tableData.push([
                no++,
                g.nomor,
                g.nama,
                g.kelas,
                pembelianDetails,
                formatCurrency(totalHarga)
            ]);
        });

        doc.autoTable({
            startY: 36,
            head: [['No', 'Tiket', 'Nama Lengkap', 'Kelas/Asal', 'Pembelian', 'Total Harga']],
            body: tableData,
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 2, lineWidth: 0.3, lineColor: [0, 0, 0] },
            headStyles: { fillColor: [253, 224, 71], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', lineWidth: 0.5 },
            columnStyles: {
                0: { halign: 'center', cellWidth: 10 },
                1: { halign: 'center', cellWidth: 20, fontStyle: 'bold' },
                2: { cellWidth: 45 },
                3: { cellWidth: 35 },
                4: { cellWidth: 100 },
                5: { halign: 'right', cellWidth: 40, fontStyle: 'bold' }
            },
            alternateRowStyles: { fillColor: [245, 245, 245] },
            didDrawPage: function (data) {
                doc.setFontSize(8);
                doc.setFont('helvetica', 'italic');
                doc.text('Photobooth Mediatech An-Nur II', 14, doc.internal.pageSize.height - 8);
                doc.text('Halaman ' + doc.internal.getNumberOfPages(), doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 8, { align: 'right' });
            }
        });

        // Summary row
        const finalY = doc.lastAutoTable.finalY + 4;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(103, 232, 249);
        doc.rect(14, finalY, doc.internal.pageSize.width - 28, 10, 'F');
        doc.setDrawColor(0);
        doc.rect(14, finalY, doc.internal.pageSize.width - 28, 10, 'S');
        doc.text(`TOTAL: ${Object.keys(grouped).length} Pendaftar | ${grandTotalFoto} Foto | ${grandTotalPigura} Pigura | ${formatCurrency(grandTotalHarga)}`, 148.5, finalY + 7, { align: 'center' });

        doc.save(`Laporan-Photobooth-${now.toISOString().slice(0, 10)}.pdf`);
        showPopup("Sukses", "\u2705 Laporan PDF berhasil diunduh!");

    } catch (e) {
        console.error(e);
        showPopup("Error", "Gagal mengunduh PDF: " + e.message, true);
    }
}
