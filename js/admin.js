// ============================================
// Admin Dashboard Logic — AntriPhotobooth (Multi-Booth)
// ============================================

let backgrounds = [];
let allQueues = [];
let allBooths = [];
let currentBoothId = null; // booth yang sedang dikelola admin
const cardColors = ['bg-neoYellow', 'bg-neoPink', 'bg-neoGreen'];



// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    const authResult = await checkAuthWithRole(['admin', 'foto']);
    if (!authResult) return;

    await loadBooths();
    await loadBackgrounds();

    if (allBooths.length > 0) {
        currentBoothId = allBooths[0].id;
        renderBoothSelector();

        await fetchQueues();
    } else {
        document.getElementById('admin-columns').innerHTML =
            '<div class="col-span-3 text-center font-bold py-8">Belum ada booth. Tambahkan booth terlebih dahulu.</div>';
    }

    subscribeToUpdates();

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
                    <div class="font-bold text-lg uppercase bg-black text-white py-1 mb-2">${currentCalled.nama_lengkap}</div>
                    <div class="flex justify-center items-center gap-2">
                        <div class="font-mono font-bold border-2 border-black bg-white px-2 py-1 uppercase">KLS: ${currentCalled.kelas}</div>
                        <div class="font-mono font-black border-2 border-black bg-neoYellow text-black px-3 py-1 text-lg shadow-[2px_2px_0px_0px_#000] uppercase">FOTO: ${currentCalled.jumlah_foto}x</div>
                    </div>
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
                                <span class="font-mono font-black bg-neoYellow text-black border-2 border-black px-2 py-0.5 text-sm shadow-[1px_1px_0px_0px_#000]">${q.jumlah_foto}x Foto</span>
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

    showConfirm('Panggil Antrian', `Panggil antrian <b>${nextWaiting.nomor_antrian}</b>?${currentCalled ? '<br><br><i>Antrian saat ini akan ditandai selesai.</i>' : ''}`, 'PANGGIL', async () => {
        try {
            if (currentCalled) await supabaseClient.from('queues').update({ status: STATUS.SELESAI }).eq('id', currentCalled.id);
            await supabaseClient.from('queues').update({ status: STATUS.DIPANGGIL }).eq('id', nextWaiting.id);
        } catch (e) { showPopup('Error', 'Gagal memanggil antrian', true); }
    });
}

async function returnToQueue(nomor_antrian) {
    showConfirm('Kembalikan Antrian', `Kembalikan antrian <b>${nomor_antrian}</b> ke daftar tunggu?`, 'KEMBALIKAN', async () => {
        const { error } = await supabaseClient.from('queues').update({ status: STATUS.MENUNGGU })
            .eq('nomor_antrian', nomor_antrian).eq('status', STATUS.DITUNDA);
        if (error) showPopup('Error', 'Gagal mengembalikan antrian: ' + error.message, true);
    });
}

async function markAsDelayed(bgId) {
    const currentCalled = allQueues.find(q => q.background_id === bgId && q.status === STATUS.DIPANGGIL);
    if (currentCalled) {
        showConfirm('Tunda Antrian', `Tunda antrian <b>${currentCalled.nomor_antrian}</b>?`, 'TUNDA', async () => {
            const { error } = await supabaseClient.from('queues').update({ status: STATUS.DITUNDA })
                .eq('nomor_antrian', currentCalled.nomor_antrian)
                .in('status', [STATUS.MENUNGGU, STATUS.DIPANGGIL]);
            if (error) showPopup('Error', 'Gagal menunda: ' + error.message, true);
        });
    }
}

async function markCurrentAs(status, bgId) {
    const currentCalled = allQueues.find(q => q.background_id === bgId && q.status === STATUS.DIPANGGIL);
    if (currentCalled) {
        const actionText = status === STATUS.SELESAI ? 'SELESAI' : 'BATAL';
        showConfirm(`Tandai ${actionText}`, `Tandai antrian <b>${currentCalled.nomor_antrian}</b> sebagai ${actionText}?`, actionText, async () => {
            const { error } = await supabaseClient.from('queues').update({ status }).eq('id', currentCalled.id);
            if (error) showPopup('Error', 'Gagal update status: ' + error.message, true);
        });
    }
}


