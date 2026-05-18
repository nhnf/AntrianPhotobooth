// ============================================
// Admin Dashboard Logic — AntriPhotobooth (Multi-Booth)
// ============================================

let backgrounds = [];
let allQueues = [];
let allBooths = [];
let currentBoothId = null; // booth yang sedang dikelola admin
const cardColors = ['bg-neoYellow', 'bg-neoPink', 'bg-neoGreen'];

const systemChannel = supabaseClient.channel('system-events', {
    config: { broadcast: { self: true } }
});

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    const user = await checkAuth();
    if (!user) return;

    await loadBooths();
    await loadBackgrounds();

    if (allBooths.length > 0) {
        currentBoothId = allBooths[0].id;
        renderBoothSelector();
        renderBoothManagement();
        await fetchQueues();
    } else {
        document.getElementById('admin-columns').innerHTML =
            '<div class="col-span-3 text-center font-bold py-8">Belum ada booth. Tambahkan booth terlebih dahulu.</div>';
    }

    subscribeToUpdates();
    systemChannel.subscribe();
});

// ============================================
// Booth Data
// ============================================
async function loadBooths() {
    const { data, error } = await supabaseClient
        .from('booths')
        .select('*')
        .order('id');
    if (error) { showPopup('Error', 'Gagal memuat data booth: ' + error.message, true); return; }
    allBooths = data || [];
}

async function loadBackgrounds() {
    const { data, error } = await supabaseClient.from('backgrounds').select('*').order('id');
    if (error) return showPopup('Error', error.message, true);
    backgrounds = data || [];
}

// ============================================
// Booth Selector (header dropdown)
// ============================================
function renderBoothSelector() {
    const sel = document.getElementById('booth-selector');
    if (!sel) return;
    sel.innerHTML = allBooths.map(b =>
        `<option value="${b.id}" ${b.id === currentBoothId ? 'selected' : ''}>${b.nama_booth} (${b.ticket_prefix})</option>`
    ).join('');
}

async function switchBooth(id) {
    currentBoothId = parseInt(id);
    await fetchQueues();
}

// ============================================
// Booth Management UI
// ============================================
function renderBoothManagement() {
    const container = document.getElementById('booth-management-list');
    if (!container) return;
    container.innerHTML = allBooths.map(b => `
        <div class="flex flex-wrap items-center gap-2 p-3 border-2 border-black bg-white shadow-[2px_2px_0px_0px_#000]">
            <span class="font-black uppercase flex-1 min-w-[120px]">${b.nama_booth}</span>
            <span class="font-mono bg-neoCyan border-2 border-black px-2 py-0.5 text-sm font-bold">${b.ticket_prefix}</span>
            <input type="text" id="edit-name-${b.id}" value="${b.nama_booth}"
                class="border-2 border-black px-2 py-1 text-sm font-bold w-32 focus:outline-none focus:ring-2 focus:ring-neoCyan">
            <input type="text" id="edit-prefix-${b.id}" value="${b.ticket_prefix}"
                class="border-2 border-black px-2 py-1 text-sm font-bold w-20 uppercase focus:outline-none focus:ring-2 focus:ring-neoCyan"
                maxlength="5">
            <button onclick="saveBooth(${b.id})"
                class="neo-button bg-neoGreen font-bold uppercase py-1 px-3 text-sm">Simpan</button>
            <button onclick="showBoothQR(${b.id})"
                class="neo-button bg-neoCyan font-bold uppercase py-1 px-3 text-sm">📱 QR Customer</button>
            <button onclick="copyBoothURL(${b.id}, 'monitor')"
                class="neo-button bg-neoYellow font-bold uppercase py-1 px-3 text-sm">📺 Monitor</button>
            <button onclick="deleteBooth(${b.id})"
                class="neo-button bg-white border-neoRed font-bold uppercase py-1 px-3 text-sm text-red-600">Hapus</button>
        </div>
    `).join('');
}

async function saveBooth(boothId) {
    const nama = document.getElementById(`edit-name-${boothId}`)?.value.trim();
    const prefix = document.getElementById(`edit-prefix-${boothId}`)?.value.trim().toUpperCase();
    if (!nama || !prefix) return showPopup('Error', 'Nama dan prefix tidak boleh kosong.', true);

    const { error } = await supabaseClient
        .from('booths')
        .update({ nama_booth: nama, ticket_prefix: prefix })
        .eq('id', boothId);

    if (error) return showPopup('Error', 'Gagal menyimpan: ' + error.message, true);

    await loadBooths();
    renderBoothSelector();
    renderBoothManagement();
    showPopup('Sukses', `✅ Booth berhasil diperbarui! Prefix: <b>${prefix}</b>`);
}

async function addBooth() {
    const nama = document.getElementById('new-booth-name')?.value.trim();
    const prefix = document.getElementById('new-booth-prefix')?.value.trim().toUpperCase();
    if (!nama || !prefix) return showPopup('Error', 'Isi nama booth dan prefix terlebih dahulu.', true);

    const { error } = await supabaseClient
        .from('booths')
        .insert({ nama_booth: nama, ticket_prefix: prefix, is_active: true });

    if (error) return showPopup('Error', 'Gagal menambah booth: ' + error.message, true);

    document.getElementById('new-booth-name').value = '';
    document.getElementById('new-booth-prefix').value = '';

    await loadBooths();
    renderBoothSelector();
    renderBoothManagement();
    showPopup('Sukses', `✅ Booth <b>${nama}</b> berhasil ditambahkan!`);
}

async function deleteBooth(boothId) {
    if (allBooths.length <= 1) return showPopup('Tidak Bisa', 'Minimal harus ada 1 booth aktif.', true);
    showConfirm('Hapus Booth', 'Yakin ingin menghapus booth ini? Antrian yang sudah ada akan tetap tersimpan (booth_id menjadi null).',
        'YA, HAPUS', async () => {
            const { error } = await supabaseClient.from('booths').delete().eq('id', boothId);
            if (error) return showPopup('Error', 'Gagal menghapus: ' + error.message, true);
            await loadBooths();
            if (currentBoothId === boothId) currentBoothId = allBooths[0]?.id || null;
            renderBoothSelector();
            renderBoothManagement();
            await fetchQueues();
            showPopup('Sukses', '✅ Booth berhasil dihapus.');
        });
}

function copyBoothURL(boothId, page) {
    const base = window.location.origin + window.location.pathname.replace('admin.html', '');
    const url = `${base}${page}.html?booth=${boothId}`;
    navigator.clipboard.writeText(url).then(() => {
        showPopup('URL Disalin!', `URL <b>${page}</b> untuk booth ini:<br><br><code class="bg-gray-100 px-2 py-1 break-all text-xs">${url}</code><br><br>Berhasil disalin ke clipboard.`);
    });
}

function showBoothQR(boothId) {
    const booth = allBooths.find(b => b.id === boothId);
    if (!booth) return;

    const base = window.location.origin + window.location.pathname.replace('admin.html', '');
    const url = `${base}customer.html?booth=${boothId}`;

    const htmlContent = `
        <div class="flex flex-col items-center justify-center p-2">
            <p class="text-xs font-mono text-gray-500 mb-4 text-center">Scan QR Code ini untuk mendaftar antrian di <b>${booth.nama_booth}</b></p>
            <div id="qrcode-container" class="border-4 border-black p-4 bg-white shadow-[4px_4px_0px_0px_#000] mb-4 flex items-center justify-center"></div>
            <input type="text" readonly id="booth-share-link" value="${url}" 
                class="w-full text-center border-2 border-black p-2 font-mono text-xs mb-4 bg-gray-50 outline-none select-all" onclick="this.select()">
            <div class="flex gap-2 w-full">
                <button onclick="downloadQRCodeImage('${booth.nama_booth}')" 
                    class="flex-1 bg-neoGreen text-black font-black uppercase px-3 py-2.5 hover:bg-black hover:text-white transition-colors border-4 border-black shadow-[2px_2px_0px_0px_#000] hover:shadow-[4px_4px_0px_0px_#000] hover:-translate-y-[2px] text-xs">💾 Simpan PNG</button>
                <button onclick="navigator.clipboard.writeText('${url}'); showPopup('Disalin!', 'Link pendaftaran berhasil disalin ke clipboard.')" 
                    class="flex-1 bg-neoCyan text-black font-black uppercase px-3 py-2.5 hover:bg-black hover:text-white transition-colors border-4 border-black shadow-[2px_2px_0px_0px_#000] hover:shadow-[4px_4px_0px_0px_#000] hover:-translate-y-[2px] text-xs">📋 Salin Link</button>
            </div>
        </div>
    `;

    showPopup(`QR — ${booth.nama_booth}`, htmlContent);

    // Render QR Code immediately after modal is active
    setTimeout(() => {
        const container = document.getElementById("qrcode-container");
        if (container) {
            container.innerHTML = ""; // Clear
            new QRCode(container, {
                text: url,
                width: 180,
                height: 180,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
        }
    }, 100);
}

function downloadQRCodeImage(boothName) {
    const img = document.querySelector("#qrcode-container img");
    const filename = `QR-${boothName.replace(/\s+/g, '-').toLowerCase()}.png`;

    if (img && img.src) {
        const a = document.createElement("a");
        a.href = img.src;
        a.download = filename;
        a.click();
    } else {
        const canvas = document.querySelector("#qrcode-container canvas");
        if (canvas) {
            const a = document.createElement("a");
            a.href = canvas.toDataURL("image/png");
            a.download = filename;
            a.click();
        } else {
            showPopup("Error", "Gagal mengunduh QR Code. Silakan coba lagi.", true);
        }
    }
}

// ============================================
// Data Loading & Queues
// ============================================
async function fetchQueues() {
    if (!currentBoothId) return;
    try {
        const { data: queues, error } = await supabaseClient
            .from('queues')
            .select('*')
            .in('status', [STATUS.MENUNGGU, STATUS.DIPANGGIL, STATUS.DITUNDA])
            .eq('booth_id', currentBoothId)
            .order('created_at', { ascending: true });

        if (error) return showPopup('Error', error.message, true);
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
    supabaseClient.channel('admin-queues-all')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, (payload) => {
            const row = payload.new || payload.old;
            // Hanya refresh jika event dari booth yang sedang aktif
            if (row && row.booth_id === currentBoothId) fetchQueues();
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
            <div class="flex justify-between items-center p-4 border-b-4 border-black ${headerColor}">
                <h2 class="text-2xl font-black uppercase tracking-tight">${bg.nama_background}</h2>
                <span class="font-mono font-bold bg-white border-2 border-black px-2 py-1 shadow-[2px_2px_0px_0px_#000]">Antri: ${waitingList.length}</span>
            </div>

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

            <div class="p-4 grid grid-cols-3 gap-2 border-b-4 border-black bg-bgLight">
                <button onclick="callNext(${bg.id})" ${waitingList.length === 0 ? 'disabled' : ''}
                    class="neo-button col-span-3 bg-neoCyan font-black uppercase py-4 text-lg">
                    Panggil Berikutnya
                </button>
                <button onclick="markCurrentAs('${STATUS.SELESAI}', ${bg.id})" ${!currentCalled ? 'disabled' : ''}
                    class="neo-button bg-neoGreen font-bold uppercase py-2 text-sm">Selesai</button>
                <button onclick="markAsDelayed(${bg.id})" ${!currentCalled ? 'disabled' : ''}
                    class="neo-button bg-neoYellow font-bold uppercase py-2 text-sm">Tunda</button>
                <button onclick="markCurrentAs('${STATUS.BATAL}', ${bg.id})" ${!currentCalled ? 'disabled' : ''}
                    class="neo-button bg-white font-bold uppercase py-2 text-sm text-red-600">Batal</button>
            </div>

            ${delayedList.length > 0 ? `
            <div class="p-4 bg-neoYellow border-b-4 border-black">
                <div class="font-mono text-sm font-bold uppercase mb-3 border-b-2 border-black pb-1">Ditunda (${delayedList.length})</div>
                <div class="space-y-2">
                    ${delayedList.map(q => `
                        <div class="flex justify-between items-center p-2 bg-white border-2 border-black shadow-[2px_2px_0px_0px_#000]">
                            <div>
                                <div class="font-black">${q.nomor_antrian}</div>
                                <div class="text-xs font-bold uppercase">${q.nama_lengkap}</div>
                            </div>
                            <button onclick="returnToQueue('${q.nomor_antrian}')" class="bg-black text-white px-3 py-1 font-bold text-xs uppercase neo-button">Hadir</button>
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            <div class="flex-1 min-h-[200px] p-6 bg-white">
                <div class="font-mono text-sm font-bold uppercase mb-4 border-b-2 border-black pb-2">Daftar Menunggu</div>
                <div class="space-y-3 overflow-y-auto max-h-[300px] pr-2">
                    ${waitingList.length > 0 ? waitingList.map(q => {
                        const isBusy = currentlyCalledAnywhere.includes(q.nomor_antrian);
                        return `
                        <div class="flex flex-col p-3 border-2 border-black shadow-[2px_2px_0px_0px_#000] relative bg-white">
                            <div class="flex justify-between items-center border-b-2 border-black pb-1 mb-1">
                                <span class="font-black text-xl">${q.nomor_antrian}</span>
                                <span class="font-mono font-bold bg-black text-white px-2 py-0.5">${q.jumlah_foto}x</span>
                            </div>
                            <div class="font-bold text-sm uppercase truncate">${q.nama_lengkap || '-'}</div>
                            <div class="font-mono text-xs uppercase text-gray-600">${q.kelas || '-'}</div>
                            ${isBusy ? `
                                <div class="absolute inset-0 bg-white/90 flex flex-col items-center justify-center border-2 border-neoRed" style="z-index:10">
                                    <span class="font-black text-neoRed uppercase text-lg">SIBUK</span>
                                    <span class="font-mono text-xs font-bold">DI BACKGROUND LAIN</span>
                                </div>
                            ` : ''}
                        </div>`;
                    }).join('') : `<div class="text-center py-4 font-mono font-bold text-gray-400 uppercase">Tidak ada antrian</div>`}
                </div>
            </div>
        </div>`;
    }).join('');
}

// ============================================
// Queue Actions
// ============================================
async function callNext(bgId) {
    const bgQueues = allQueues.filter(q => q.background_id === bgId);
    const currentCalled = bgQueues.find(q => q.status === STATUS.DIPANGGIL);
    const calledNomors = allQueues.filter(q => q.status === STATUS.DIPANGGIL).map(q => q.nomor_antrian);
    const nextWaiting = bgQueues.find(q => q.status === STATUS.MENUNGGU && !calledNomors.includes(q.nomor_antrian));

    if (!nextWaiting) {
        const anyWaiting = bgQueues.find(q => q.status === STATUS.MENUNGGU);
        showPopup('Informasi', anyWaiting
            ? 'Antrian berikutnya sedang sibuk di background lain.'
            : 'Tidak ada antrian yang menunggu.');
        return;
    }
    try {
        if (currentCalled) await supabaseClient.from('queues').update({ status: STATUS.SELESAI }).eq('id', currentCalled.id);
        await supabaseClient.from('queues').update({ status: STATUS.DIPANGGIL }).eq('id', nextWaiting.id);
    } catch (e) { showPopup('Error', 'Gagal memanggil antrian', true); }
}

async function returnToQueue(nomor_antrian) {
    const { error } = await supabaseClient.from('queues').update({ status: STATUS.MENUNGGU })
        .eq('nomor_antrian', nomor_antrian).eq('status', STATUS.DITUNDA);
    if (error) showPopup('Error', 'Gagal mengembalikan antrian: ' + error.message, true);
}

async function markAsDelayed(bgId) {
    const currentCalled = allQueues.find(q => q.background_id === bgId && q.status === STATUS.DIPANGGIL);
    if (currentCalled) {
        const { error } = await supabaseClient.from('queues').update({ status: STATUS.DITUNDA })
            .eq('nomor_antrian', currentCalled.nomor_antrian)
            .in('status', [STATUS.MENUNGGU, STATUS.DIPANGGIL]);
        if (error) showPopup('Error', 'Gagal menunda: ' + error.message, true);
    }
}

async function markCurrentAs(status, bgId) {
    const currentCalled = allQueues.find(q => q.background_id === bgId && q.status === STATUS.DIPANGGIL);
    if (currentCalled) {
        const { error } = await supabaseClient.from('queues').update({ status }).eq('id', currentCalled.id);
        if (error) showPopup('Error', 'Gagal update status: ' + error.message, true);
    }
}

// ============================================
// Cache & Reset (per booth)
// ============================================
async function broadcastClearCache() {
    showConfirm('Wipe Cache', '⚠️ Tombol ini akan menghapus paksa cache tiket di SEMUA HP pelanggan booth ini. Lanjutkan?',
        'YA, WIPE', async () => {
            await systemChannel.send({ type: 'broadcast', event: 'clear_cache', payload: { action: 'wipe' } });
            showPopup('Sukses', '✅ Sinyal pembersihan cache telah disebarkan!');
        });
}

function resetAllQueues() {
    const booth = allBooths.find(b => b.id === currentBoothId);
    showConfirm('Reset Antrian Booth',
        `Yakin ingin menghapus SEMUA antrian booth <b>${booth?.nama_booth || ''}</b>? Data terhapus permanen.`,
        'YA, RESET', async () => {
            try {
                const { data: rows } = await supabaseClient.from('queues').select('id').eq('booth_id', currentBoothId);
                if (rows && rows.length > 0) {
                    await supabaseClient.from('queues').delete().in('id', rows.map(r => r.id));
                }
                await systemChannel.send({ type: 'broadcast', event: 'clear_cache', payload: { action: 'wipe' } });
                showPopup('Sukses', '✅ Semua antrian booth ini dihapus!');
                fetchQueues();
            } catch (e) { showPopup('Error', 'Gagal reset: ' + e.message, true); }
        });
}

// ============================================
// Export / PDF
// ============================================
async function exportData() {
    const { data, error } = await supabaseClient.from('queues').select('*').eq('booth_id', currentBoothId);
    if (error) return showPopup('Error', error.message, true);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `backup-booth${currentBoothId}-${new Date().toISOString().slice(0,10)}.json`;
    a.href = url; a.click(); URL.revokeObjectURL(url);
    showPopup('Berhasil', '✅ Data antrian booth ini berhasil diekspor.');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) throw new Error('Format tidak valid.');
            showConfirm('Import Data', `Ditemukan ${data.length} baris. Import akan MENGGANTIKAN data booth ini. Lanjutkan?`,
                'YA, IMPORT', async () => {
                    const { data: rows } = await supabaseClient.from('queues').select('id').eq('booth_id', currentBoothId);
                    if (rows?.length) await supabaseClient.from('queues').delete().in('id', rows.map(r => r.id));
                    const clean = data.map(({ id, ...rest }) => ({ ...rest, booth_id: currentBoothId }));
                    const { error } = await supabaseClient.from('queues').insert(clean);
                    if (error) throw error;
                    showPopup('Berhasil', '✅ Import berhasil!');
                    fetchQueues();
                    document.getElementById('import-file').value = '';
                });
        } catch (err) { showPopup('Error', 'Gagal membaca file: ' + err.message, true); }
    };
    reader.readAsText(file);
}

async function downloadPDF() {
    const booth = allBooths.find(b => b.id === currentBoothId);
    const { data, error } = await supabaseClient.from('queues')
        .select('*, backgrounds(nama_background)')
        .eq('booth_id', currentBoothId)
        .neq('status', STATUS.BATAL)
        .order('created_at', { ascending: true });

    if (error) return showPopup('Error', error.message, true);
    if (!data || data.length === 0) return showPopup('Tidak Ada Data', 'Belum ada data pendaftar.');

    const grouped = {};
    data.forEach(row => {
        if (!grouped[row.nomor_antrian]) {
            grouped[row.nomor_antrian] = { nomor: row.nomor_antrian, nama: row.nama_lengkap || '-', kelas: row.kelas || '-', alamat: row.alamat || '-', items: [], totalFoto: 0, totalPigura: 0 };
        }
        grouped[row.nomor_antrian].items.push({ background: row.backgrounds?.nama_background || '-', qty: row.jumlah_foto || 0, status: row.status });
        grouped[row.nomor_antrian].totalFoto += (row.jumlah_foto || 0);
        grouped[row.nomor_antrian].totalPigura += (row.pigura || 0);
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(20); doc.setFont('helvetica', 'bold');
    doc.text(`LAPORAN PENDAFTAR — ${booth?.nama_booth?.toUpperCase() || 'PHOTOBOOTH'}`, 148.5, 18, { align: 'center' });
    doc.setFontSize(9);
    const now = new Date();
    doc.text(`Dicetak: ${now.toLocaleString('id-ID')}`, 148.5, 28, { align: 'center' });

    let no = 1, grandFoto = 0, grandPigura = 0, grandHarga = 0;
    const tableData = Object.values(grouped).map(g => {
        const harga = g.totalFoto * HARGA_PER_FOTO + g.totalPigura * HARGA_PIGURA;
        grandFoto += g.totalFoto; grandPigura += g.totalPigura; grandHarga += harga;
        const detail = g.items.map(i => `- ${i.background} (${i.qty}x) [${i.status.toUpperCase()}]`);
        if (g.totalPigura > 0) detail.push(`- Pigura (${g.totalPigura}x)`);
        return [no++, g.nomor, g.nama, g.kelas, detail.join('\n'), formatCurrency(harga)];
    });

    doc.autoTable({
        startY: 33,
        head: [['No', 'Tiket', 'Nama', 'Kelas/Asal', 'Pembelian', 'Total']],
        body: tableData,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, lineWidth: 0.3 },
        headStyles: { fillColor: [253, 224, 71], textColor: [0,0,0], fontStyle: 'bold', halign: 'center' },
        columnStyles: { 0: { halign:'center', cellWidth:10 }, 1: { halign:'center', cellWidth:22, fontStyle:'bold' }, 2: { cellWidth:40 }, 3: { cellWidth:35 }, 4: { cellWidth:100 }, 5: { halign:'right', cellWidth:38, fontStyle:'bold' } },
    });

    const fy = doc.lastAutoTable.finalY + 4;
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.setFillColor(103, 232, 249);
    doc.rect(14, fy, doc.internal.pageSize.width - 28, 10, 'F');
    doc.rect(14, fy, doc.internal.pageSize.width - 28, 10, 'S');
    doc.text(`TOTAL: ${Object.keys(grouped).length} Pendaftar | ${grandFoto} Foto | ${grandPigura} Pigura | ${formatCurrency(grandHarga)}`, 148.5, fy + 7, { align: 'center' });

    doc.save(`Laporan-${booth?.nama_booth || 'Booth'}-${now.toISOString().slice(0,10)}.pdf`);
    showPopup('Sukses', '✅ Laporan PDF berhasil diunduh!');
}
