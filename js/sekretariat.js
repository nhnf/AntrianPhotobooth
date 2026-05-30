// ============================================
// Sekretariat Dashboard Logic — AntriPhotobooth
// ============================================

let allBooths = [];
let backgrounds = [];
let allCustomerData = []; // raw rows from queues
let groupedCustomers = []; // grouped by nomor_antrian
let filteredCustomers = []; // after search/filter
let currentBoothFilter = 'all';
let searchTimeout = null;
let isIncomeVisible = true;

// Modal Edit State
let editBgQuantities = {};
let editPiguraQty = 0;

// ============================================
// Notes helpers — pisahkan manual notes vs auto payment notes
// Format DB: "manual_notes\n---PAYMENT---\nKurang bayar: ..."
// ============================================
const PAYMENT_NOTE_DELIM = '\n---PAYMENT---\n';

function parseNotes(raw) {
    if (!raw) return { manual: '', payment: '' };
    const idx = raw.indexOf(PAYMENT_NOTE_DELIM);
    if (idx === -1) {
        // Backward compat: kalau notes lama berupa "Kurang bayar..." atau "Kelebihan bayar..."
        // anggap itu auto payment note
        if (raw.startsWith('Kurang bayar:') || raw.startsWith('Kelebihan bayar:')) {
            return { manual: '', payment: raw };
        }
        return { manual: raw, payment: '' };
    }
    return {
        manual: raw.substring(0, idx),
        payment: raw.substring(idx + PAYMENT_NOTE_DELIM.length)
    };
}

function combineNotes(manual, payment) {
    manual = (manual || '').trim();
    payment = (payment || '').trim();
    if (!manual && !payment) return '';
    if (!payment) return manual;
    if (!manual) return PAYMENT_NOTE_DELIM + payment;
    return manual + PAYMENT_NOTE_DELIM + payment;
}

const systemChannel = supabaseClient.channel('system-events', {
    config: { broadcast: { self: true } }
});

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    const authResult = await checkAuthWithRole(['admin']);
    if (!authResult) return;

    // Jalankan semua fetch awal secara paralel untuk mempercepat load
    await Promise.all([
        loadBooths(),
        loadBackgrounds(),
        fetchAllCustomers(),
        loadUsers(),
        loadBoothBgSettings()
    ]);

    // Render setelah semua data siap
    renderBoothSelector();
    renderBoothManagement();
    renderCalledPanel(); // backgrounds & allCustomerData sudah siap
    subscribeRealtime();
    systemChannel.subscribe();
});

// ============================================
// Data Loading
// ============================================
async function loadBooths() {
    const { data, error } = await supabaseClient
        .from('booths')
        .select('*')
        .order('id');
    if (error) { showPopup('Error', 'Gagal memuat booth: ' + error.message, true); return; }
    allBooths = data || [];
}

async function loadBackgrounds() {
    const { data, error } = await supabaseClient
        .from('backgrounds')
        .select('*')
        .order('id');
    if (error) { showPopup('Error', 'Gagal memuat backgrounds: ' + error.message, true); return; }
    backgrounds = data || [];
}

async function fetchAllCustomers() {
    const tbody = document.getElementById('table-body');
    const countEl = document.getElementById('table-count');
    
    if (tbody && allCustomerData.length === 0) {
        tbody.innerHTML = Array(5).fill().map(() => `
            <tr class="border-b-2 border-black/20 bg-white">
                <td class="p-3"><div class="skeleton h-4 w-6"></div></td>
                <td class="p-3"><div class="skeleton h-6 w-16 mb-1"></div><div class="skeleton h-3 w-20"></div></td>
                <td class="p-3"><div class="skeleton h-4 w-12"></div></td>
                <td class="p-3"><div class="skeleton h-5 w-32 mb-1"></div></td>
                <td class="p-3"><div class="skeleton h-4 w-8"></div></td>
                <td class="p-3"><div class="skeleton h-4 w-24"></div></td>
                <td class="p-3"><div class="skeleton h-4 w-32 mb-1"></div><div class="skeleton h-4 w-20"></div></td>
                <td class="p-3"><div class="skeleton h-5 w-24 mb-1"></div><div class="skeleton h-3 w-16"></div></td>
                <td class="p-3"><div class="skeleton h-6 w-20"></div></td>
                <td class="p-3"><div class="skeleton h-6 w-16"></div></td>
                <td class="p-3"><div class="skeleton h-8 w-8"></div></td>
            </tr>
        `).join('');
    } else if (countEl) {
        // BUG-049 FIX: subtle loading indicator untuk subsequent fetch
        countEl.style.opacity = '0.5';
    }

    let query = supabaseClient
        .from('queues')
        .select('*, backgrounds(nama_background)')
        .order('created_at', { ascending: false });

    if (currentBoothFilter !== 'all') {
        query = query.eq('booth_id', parseInt(currentBoothFilter));
    }

    const { data, error } = await query;
    if (error) {
        showPopup('Error', 'Gagal memuat data: ' + error.message, true);
        return;
    }

    allCustomerData = data || [];
    groupCustomers();
    applyFilters();
    
    // BUG-049 FIX: reset loading indicator
    if (countEl) countEl.style.opacity = '1';
    
    // renderCalledPanel hanya kalau backgrounds sudah loaded
    // (saat init paralel, backgrounds mungkin belum siap)
    if (backgrounds.length > 0) {
        renderCalledPanel();
    }
}

// ============================================
// Group customers by nomor_antrian
// ============================================
function groupCustomers() {
    const map = {};
    allCustomerData.forEach(row => {
        if (!map[row.nomor_antrian]) {
            map[row.nomor_antrian] = {
                nomor_antrian: row.nomor_antrian,
                nama_lengkap: row.nama_lengkap || '-',
                kelas: row.kelas || '-',
                alamat: row.alamat || '-',
                no_wa: row.no_wa || '',
                booth_id: row.booth_id,
                created_at: row.created_at,
                payment_status: row.payment_status || 'belum_lunas',
                payment_method: row.payment_method || null,
                notes: row.notes || '',
                picked_up: false,
                items: [],
                totalFoto: 0,
                totalPigura: 0,
                totalHarga: 0,
                statuses: []
            };
        }
        const g = map[row.nomor_antrian];
        g.items.push({
            id: row.id,
            background: row.backgrounds?.nama_background || '-',
            background_id: row.background_id,
            qty: row.jumlah_foto || 0,
            pigura: row.pigura || 0,
            status: row.status
        });
        g.totalFoto += (row.jumlah_foto || 0);
        // BUG FIX: pigura disimpan di setiap row (per background), tapi nilainya sama.
        // Ambil hanya dari row pertama agar tidak dihitung N× lipat.
        if (!g.piguraSet) { g.totalPigura = row.pigura || 0; g.piguraSet = true; }
        g.statuses.push(row.status);
        // Keep the latest notes, payment status, and pickup status
        if (row.notes) g.notes = row.notes;
        if (row.payment_status) g.payment_status = row.payment_status;
        if (row.payment_method) g.payment_method = row.payment_method;
        if (row.no_wa) g.no_wa = row.no_wa;
        if (row.picked_up) g.picked_up = true; // If any row is picked up, mark as picked up
    });

    // Calculate total price
    Object.values(map).forEach(g => {
        g.totalHarga = g.totalFoto * HARGA_PER_FOTO + g.totalPigura * HARGA_PIGURA;
    });

    groupedCustomers = Object.values(map).sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
    );
}

// ============================================
// Booth Selector
// ============================================
function renderBoothSelector() {
    const sel = document.getElementById('booth-selector');
    if (!sel) return;
    sel.innerHTML = '<option value="all">Semua Booth</option>' +
        allBooths.map(b =>
            `<option value="${b.id}" ${b.id.toString() === currentBoothFilter ? 'selected' : ''}>${b.nama_booth} (${b.ticket_prefix})</option>`
        ).join('');
}

function switchBooth(val) {
    currentBoothFilter = val;
    fetchAllCustomers();
}

// ============================================
// Panel "Sedang Dipanggil / Masuk"
// ============================================
function renderCalledPanel() {
    const panel = document.getElementById('called-panel');
    if (!panel) return;

    if (backgrounds.length === 0) {
        panel.innerHTML = '<div class="font-mono font-bold text-gray-400 uppercase py-4">Background belum dimuat</div>';
        return;
    }

    const bgColors = ['bg-neoCyan', 'bg-neoPink', 'bg-neoYellow', 'bg-neoGreen'];

    // Kumpulkan semua antrian yang ditunda dari semua background
    const allDelayedRaw = allCustomerData.filter(q =>
        q.status === STATUS.DITUNDA &&
        (currentBoothFilter === 'all' || q.booth_id === parseInt(currentBoothFilter))
    );

    // Filter agar unik berdasarkan nomor_antrian
    const allDelayed = [];
    allDelayedRaw.forEach(q => {
        if (!allDelayed.find(u => u.nomor_antrian === q.nomor_antrian)) {
            allDelayed.push(q);
        }
    });

    // Simpan state focus pencarian agar tidak hilang saat realtime update
    let activeSearch = null;
    let selStart = 0;
    let selEnd = 0;
    const searchEl = document.getElementById('search-delayed');
    if (searchEl && document.activeElement === searchEl) {
        activeSearch = searchEl.value;
        selStart = searchEl.selectionStart;
        selEnd = searchEl.selectionEnd;
    }


    // Render kartu per background
    const bgCards = backgrounds.map((bg, index) => {
        const bgQueues = allCustomerData.filter(q =>
            q.background_id === bg.id &&
            (currentBoothFilter === 'all' || q.booth_id === parseInt(currentBoothFilter))
        );
        const currentCalled = bgQueues.find(q => q.status === STATUS.DIPANGGIL);
        const waitingList = bgQueues
            .filter(q => q.status === STATUS.MENUNGGU)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // Ascending (oldest first)

        // Ambil semua nomor yang sedang dipanggil di booth ini
        const calledNomors = allCustomerData.filter(q => q.status === STATUS.DIPANGGIL && (currentBoothFilter === 'all' || q.booth_id === parseInt(currentBoothFilter))).map(q => q.nomor_antrian);

        // Siapa yang berikutnya (yang sedang tidak dipanggil di bg lain)
        const nextInQueue = waitingList.find(q => !calledNomors.includes(q.nomor_antrian));
        const isNextBusy = waitingList.length > 0 && !nextInQueue;

        const headerColor = bgColors[index % bgColors.length];

        return `
        <div class="flex-1 min-w-0 border-4 border-black shadow-[6px_6px_0px_0px_#000] bg-white flex flex-col">
            <!-- Header -->
            <div class="flex justify-between items-center p-3 border-b-4 border-black ${headerColor}">
                <span class="font-black uppercase text-sm leading-tight">${bg.nama_background}</span>
                <span class="font-mono text-[10px] font-bold bg-black text-white px-1.5 py-0.5">Antri: ${waitingList.length}</span>
            </div>

            <!-- Nomor Antrian -->
            <div class="flex-1 flex flex-col items-center justify-center text-center p-4 bg-white">
                <div class="font-mono text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-500">Nomor Antrian</div>
                <div class="text-5xl font-black tracking-tighter leading-none mb-3 ${currentCalled ? 'text-black' : 'text-gray-300'}">
                    ${currentCalled ? currentCalled.nomor_antrian : '---'}
                </div>
                ${currentCalled ? `
                    <div class="w-full bg-black text-white font-black uppercase py-1.5 px-2 text-sm truncate mb-1">
                        ${currentCalled.nama_lengkap || '-'}
                    </div>
                    <div class="font-mono text-xs font-bold border-2 border-black px-2 py-0.5 uppercase">
                        KLS: ${currentCalled.kelas || '-'}
                    </div>
                ` : ''}
            </div>

            <!-- Next Footer -->
            <div class="border-t-4 border-black bg-neoYellow px-3 py-1.5 font-mono text-[10px] font-bold uppercase truncate">
                ${nextInQueue
                    ? `Next: ${nextInQueue.nomor_antrian} (${(nextInQueue.nama_lengkap || '-').substring(0, 14)}${(nextInQueue.nama_lengkap || '').length > 14 ? '...' : ''})`
                    : isNextBusy ? '<span class="text-neoRed font-black tracking-wider">SIBUK DI BG LAIN</span>' : 'Next: —'}
            </div>

            <!-- Action Buttons -->
            <div class="border-t-4 border-black flex flex-col">
                <button onclick="callNextSekretariat(${bg.id})" ${waitingList.length === 0 ? 'disabled' : ''}
                    class="w-full neo-button bg-neoCyan font-black uppercase py-2.5 text-xs border-0 ${waitingList.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}">
                    Panggil Berikutnya
                </button>
                ${currentCalled ? `
                <button onclick="repeatCallSekretariat('${currentCalled.nomor_antrian}', '${(currentCalled.nama_lengkap || '').replace(/'/g, "\\'")}', '${bg.nama_background.replace(/'/g, "\\'")}', ${bg.id})"
                    class="w-full neo-button bg-neoYellow font-black uppercase py-2 text-xs border-0 border-t-2 border-black hover:bg-black hover:text-neoYellow transition-colors">
                    🔔 Panggil Lagi
                </button>` : ''}
                <div class="grid grid-cols-3 border-t-4 border-black">
                    <button onclick="markCurrentAsSekretariat('${STATUS.SELESAI}', ${bg.id})" ${!currentCalled ? 'disabled' : ''}
                        class="bg-neoGreen font-bold uppercase py-2 text-[10px] border-r-2 border-black hover:bg-black hover:text-neoGreen transition-colors ${!currentCalled ? 'opacity-40 cursor-not-allowed' : ''}">Selesai</button>
                    <button onclick="markAsDelayedSekretariat(${bg.id})" ${!currentCalled ? 'disabled' : ''}
                        class="bg-neoYellow font-bold uppercase py-2 text-[10px] border-r-2 border-black hover:bg-black hover:text-neoYellow transition-colors ${!currentCalled ? 'opacity-40 cursor-not-allowed' : ''}">Tunda</button>
                    <button onclick="markCurrentAsSekretariat('${STATUS.BATAL}', ${bg.id})" ${!currentCalled ? 'disabled' : ''}
                        class="bg-white font-bold uppercase py-2 text-[10px] text-red-600 hover:bg-black hover:text-red-400 transition-colors ${!currentCalled ? 'opacity-40 cursor-not-allowed' : ''}">Batal</button>
                </div>
            </div>
        </div>`;
    }).join('');

    // Render panel DITUNDA terpisah di paling kanan
    const ditundaPanel = `
    <div class="flex-shrink-0 w-44 border-4 border-black shadow-[6px_6px_0px_0px_#000] bg-white flex flex-col">
        <!-- Header -->
        <div class="p-3 border-b-4 border-black bg-black text-center">
            <span class="font-black uppercase text-white text-sm tracking-widest">Ditunda</span>
        </div>
        <!-- Sub-header -->
        <div class="border-b-2 border-black px-2 py-1.5 bg-gray-100 flex flex-col gap-1.5">
            <span class="font-mono text-[10px] font-bold uppercase text-gray-500 text-center">Lapor Petugas</span>
            <input type="text" id="search-delayed" placeholder="Cari tiket..." 
                class="w-full text-xs font-bold font-mono p-1.5 border-2 border-black focus:outline-none focus:ring-2 focus:ring-neoCyan"
                value="${searchEl ? searchEl.value : ''}"
                oninput="filterDelayed(this.value)">
        </div>
        <!-- List -->
        <div class="flex-1 overflow-y-auto p-2 space-y-2 max-h-[280px] ${allDelayed.length === 0 ? 'flex items-center justify-center' : ''}" id="delayed-list-container">
            ${allDelayed.length === 0
                ? '<span class="font-mono text-[10px] text-gray-400 font-bold uppercase text-center">Tidak ada</span>'
                : allDelayed.map(q => `
                    <div class="delayed-item border-2 border-black p-2 bg-white shadow-[2px_2px_0px_0px_#000]">
                        <div class="font-black text-base">${q.nomor_antrian}</div>
                        <div class="font-mono text-[10px] uppercase font-bold text-gray-600 truncate">${q.nama_lengkap || '-'}</div>
                        <button onclick="returnToQueueSekretariat('${q.nomor_antrian}')"
                            class="mt-1.5 w-full bg-black text-white font-bold text-[10px] uppercase py-1 hover:bg-neoCyan hover:text-black transition-colors">
                            Hadir ✓
                        </button>
                    </div>
                `).join('')}
        </div>
        ${allDelayed.length > 0 ? `
        <div class="border-t-4 border-black bg-gray-100 px-3 py-1.5 flex justify-between items-center font-mono text-[10px] font-bold uppercase text-gray-500">
            <span>Total:</span>
            <span id="delayed-total-count">${allDelayed.length}</span>
        </div>` : ''}
    </div>`;

    panel.innerHTML = bgCards + ditundaPanel;

    // Kembalikan focus jika tadi sedang mengetik
    if (activeSearch !== null) {
        const newSearchEl = document.getElementById('search-delayed');
        if (newSearchEl) {
            newSearchEl.focus();
            newSearchEl.setSelectionRange(selStart, selEnd);
        }
    }
    
    // Terapkan filter jika ada text
    const currentQuery = document.getElementById('search-delayed')?.value || '';
    if (currentQuery) {
        filterDelayed(currentQuery);
    }
}

function filterDelayed(query) {
    query = query.toLowerCase();
    const items = document.querySelectorAll('.delayed-item');
    let visibleCount = 0;
    
    items.forEach(item => {
        const text = item.innerText.toLowerCase();
        if (text.includes(query)) {
            item.style.display = 'block';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });

    const totalEl = document.getElementById('delayed-total-count');
    if (totalEl) {
        totalEl.textContent = visibleCount;
    }
}

async function markCurrentAsSekretariat(status, bgId) {
    const bgQueues = allCustomerData.filter(q => q.background_id === bgId && (currentBoothFilter === 'all' || q.booth_id === parseInt(currentBoothFilter)));
    const currentCalled = bgQueues.find(q => q.status === STATUS.DIPANGGIL);
    if (currentCalled) {
        const { error } = await supabaseClient.from('queues').update({ status }).eq('id', currentCalled.id);
        if (error) showPopup('Error', 'Gagal update status: ' + error.message, true);
    }
}

async function markAsDelayedSekretariat(bgId) {
    const bgQueues = allCustomerData.filter(q => q.background_id === bgId && (currentBoothFilter === 'all' || q.booth_id === parseInt(currentBoothFilter)));
    const currentCalled = bgQueues.find(q => q.status === STATUS.DIPANGGIL);
    if (currentCalled) {
        const { error } = await supabaseClient.from('queues').update({ status: STATUS.DITUNDA })
            .eq('nomor_antrian', currentCalled.nomor_antrian)
            .in('status', [STATUS.MENUNGGU, STATUS.DIPANGGIL]);
        if (error) showPopup('Error', 'Gagal menunda: ' + error.message, true);
    }
}

async function returnToQueueSekretariat(nomor_antrian) {
    const { error } = await supabaseClient.from('queues').update({ status: STATUS.MENUNGGU })
        .eq('nomor_antrian', nomor_antrian).eq('status', STATUS.DITUNDA);
    if (error) showPopup('Error', 'Gagal mengembalikan antrian: ' + error.message, true);
}

// ============================================
// Repeat Call (Panggil Lagi)
// ============================================
async function repeatCallSekretariat(nomorAntrian, namaLengkap, namaBg, bgId) {
    const btn = event.currentTarget;
    const origText = btn.innerHTML;
    btn.innerHTML = '⏳ Memanggil...';
    btn.disabled = true;

    try {
        // Broadcast ke monitor via system channel agar ting-tong + voice berbunyi lagi
        await systemChannel.send({
            type: 'broadcast',
            event: 'repeat_call',
            payload: {
                nomor_antrian: nomorAntrian,
                nama_lengkap: namaLengkap,
                nama_background: namaBg,
                bg_id: bgId,
                booth_id: currentBoothFilter !== 'all' ? parseInt(currentBoothFilter) : null
            }
        });

        showPopup('Berhasil', `🔔 Memanggil ulang <b>${nomorAntrian}</b> — ${namaLengkap}`);
    } catch (e) {
        showPopup('Error', 'Gagal mengirim panggilan ulang: ' + e.message, true);
    } finally {
        setTimeout(() => {
            btn.innerHTML = origText;
            btn.disabled = false;
        }, 2000);
    }
}

async function callNextSekretariat(bgId) {
    // Pastikan booth sudah difilter jika diperlukan
    const bgQueues = allCustomerData.filter(q => q.background_id === bgId && (currentBoothFilter === 'all' || q.booth_id === parseInt(currentBoothFilter)));
    const currentCalled = bgQueues.find(q => q.status === STATUS.DIPANGGIL);
    
    // Ambil semua nomor yang sedang dipanggil di booth ini
    const calledNomors = allCustomerData.filter(q => q.status === STATUS.DIPANGGIL && (currentBoothFilter === 'all' || q.booth_id === parseInt(currentBoothFilter))).map(q => q.nomor_antrian);

    // Cari yang masih menunggu sesuai dengan urutan dashboard monitor
    const waitingList = bgQueues
        .filter(q => q.status === STATUS.MENUNGGU)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // Ascending (oldest first)
        
    // Pilih antrian pertama yang tidak sedang sibuk di background lain
    const nextWaiting = waitingList.find(q => !calledNomors.includes(q.nomor_antrian));

    if (!nextWaiting) {
        const anyWaiting = bgQueues.find(q => q.status === STATUS.MENUNGGU);
        showPopup('Informasi', anyWaiting 
            ? 'Antrian berikutnya sedang sibuk di background lain.' 
            : 'Tidak ada antrian yang menunggu untuk background ini.');
        return;
    }

    try {
        if (currentCalled) {
            await supabaseClient.from('queues').update({ status: STATUS.SELESAI }).eq('id', currentCalled.id);
        }
        await supabaseClient.from('queues').update({ status: STATUS.DIPANGGIL }).eq('id', nextWaiting.id);
        
        // Tabel akan terupdate otomatis via realtime subscription (postgres_changes)
    } catch (e) {
        showPopup('Error', 'Gagal memanggil antrian', true);
    }
}

// ============================================
// Stats Cards
// ============================================
function renderStatsCards() {
    const section = document.getElementById('stats-section');
    const extraSection = document.getElementById('extra-stats-section');
    if (!section || !extraSection) return;

    const total = filteredCustomers.length;
    const lunas = filteredCustomers.filter(c => c.payment_status === 'lunas').length;
    const belum = filteredCustomers.filter(c => c.payment_status === 'belum_lunas').length;
    const totalFoto = filteredCustomers.reduce((sum, c) => sum + c.totalFoto, 0);
    
    // Hitung kas masuk aktual (cash on hand) dengan memperhitungkan selisih bayar
    // - Lunas tanpa kelebihan = totalHarga (sudah dibayar penuh)
    // - Lunas + kelebihan bayar (belum dikembalikan) = totalHarga + kelebihan
    // - Belum lunas + kurang bayar = totalHarga - kurang bayar (sudah bayar sebagian)
    // - Belum lunas tanpa info kurang bayar = 0 (belum bayar sama sekali)
    let totalPendapatan = 0;
    let totalKekurangan = 0;     // total piutang dari customer
    let totalKelebihan = 0;      // total hutang yang harus dikembalikan
    
    filteredCustomers.forEach(c => {
        const parsed = parseNotes(c.notes);
        const paymentNote = parsed.payment || '';
        
        let kurangBayar = 0;
        let kelebihanBayar = 0;
        
        const matchKurang = paymentNote.match(/Kurang bayar:\s*Rp\s*([\d.,]+)/);
        const matchLebih = paymentNote.match(/Kelebihan bayar:\s*Rp\s*([\d.,]+)/);
        
        if (matchKurang) {
            kurangBayar = parseRupiah(matchKurang[0]);
        }
        if (matchLebih) {
            kelebihanBayar = parseRupiah(matchLebih[0]);
        }
        
        if (c.payment_status === 'lunas') {
            // Sudah lunas → kas masuk = totalHarga + kelebihan (cash di tangan)
            totalPendapatan += c.totalHarga + kelebihanBayar;
            totalKelebihan += kelebihanBayar;
        } else {
            // Belum lunas
            if (kurangBayar > 0) {
                // Sudah bayar sebagian (totalHarga - kurang)
                totalPendapatan += (c.totalHarga - kurangBayar);
                totalKekurangan += kurangBayar;
            }
            // Kalau belum lunas & tidak ada info kurang bayar → asumsi belum bayar (0)
        }
    });

    const bgStats = {};
    let totalPigura = 0;

    filteredCustomers.forEach(c => {
        totalPigura += c.totalPigura || 0;
        c.items.forEach(item => {
            if (!bgStats[item.background]) {
                bgStats[item.background] = 0;
            }
            bgStats[item.background] += item.qty;
        });
    });

    // Render Extra Stats (Backgrounds & Pigura)
    let extraHtml = '';
    const colors = ['bg-neoYellow', 'bg-neoPink', 'bg-neoGreen', 'bg-neoCyan'];
    let colorIndex = 0;

    Object.keys(bgStats).sort().forEach(bgName => {
        const color = colors[colorIndex % colors.length];
        extraHtml += `
            <div class="stat-card border-4 border-black ${color} p-4 shadow-[8px_8px_0px_0px_#000]">
                <div class="font-mono text-xs font-bold uppercase text-black/70">Total ${bgName}</div>
                <div class="text-3xl md:text-4xl font-black tracking-tighter mt-1">${bgStats[bgName]} <span class="text-lg">foto</span></div>
            </div>
        `;
        colorIndex++;
    });

    extraHtml += `
        <div class="stat-card border-4 border-black ${colors[colorIndex % colors.length]} p-4 shadow-[8px_8px_0px_0px_#000]">
            <div class="font-mono text-xs font-bold uppercase text-black/70">Total Pigura</div>
            <div class="text-3xl md:text-4xl font-black tracking-tighter mt-1">${totalPigura} <span class="text-lg">pcs</span></div>
        </div>
    `;
    extraSection.innerHTML = extraHtml;

    // Footer info untuk card pendapatan
    let pendapatanFooter = `dari ${lunas} customer lunas`;
    const footerExtras = [];
    if (totalKekurangan > 0) {
        footerExtras.push(`<span class="text-neoRed">⚠️ Piutang: ${formatCurrency(totalKekurangan)}</span>`);
    }
    if (totalKelebihan > 0) {
        footerExtras.push(`<span class="text-green-700">💰 Refund: ${formatCurrency(totalKelebihan)}</span>`);
    }
    if (footerExtras.length > 0) {
        pendapatanFooter += `<br>${footerExtras.join(' · ')}`;
    }

    section.innerHTML = `
        <div class="stat-card border-4 border-black bg-neoCyan p-4 shadow-[8px_8px_0px_0px_#000]">
            <div class="font-mono text-xs font-bold uppercase text-black/70">Total Pendaftar</div>
            <div class="text-4xl font-black tracking-tighter mt-1">${total}</div>
            <div class="font-mono text-xs font-bold mt-1">${totalFoto} foto keseluruhan</div>
        </div>
        <div class="stat-card border-4 border-black bg-neoGreen p-4 shadow-[8px_8px_0px_0px_#000]">
            <div class="font-mono text-xs font-bold uppercase text-black/70">Sudah Lunas</div>
            <div class="text-4xl font-black tracking-tighter mt-1">${lunas}</div>
            <div class="font-mono text-xs font-bold mt-1">${total > 0 ? Math.round(lunas / total * 100) : 0}%</div>
        </div>
        <div class="stat-card border-4 border-black bg-neoPink p-4 shadow-[8px_8px_0px_0px_#000]">
            <div class="font-mono text-xs font-bold uppercase text-black/70">Belum Lunas</div>
            <div class="text-4xl font-black tracking-tighter mt-1">${belum}</div>
            <div class="font-mono text-xs font-bold mt-1">${total > 0 ? Math.round(belum / total * 100) : 0}%</div>
        </div>
        <div class="stat-card border-4 border-black bg-neoYellow p-4 shadow-[8px_8px_0px_0px_#000]">
            <div class="flex justify-between items-start">
                <div class="font-mono text-xs font-bold uppercase text-black/70" title="Kas yang sudah diterima (memperhitungkan kurang/kelebihan bayar)">Kas Diterima</div>
                <button onclick="toggleIncomeVisibility()" class="text-xs border-2 border-black bg-white px-2 py-0.5 shadow-[2px_2px_0px_0px_#000] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_#000] transition-all">
                    ${isIncomeVisible ? '👁️' : '🙈'}
                </button>
            </div>
            <div class="text-3xl md:text-4xl font-black tracking-tighter mt-1">
                ${isIncomeVisible ? formatCurrency(totalPendapatan) : 'Rp ••••••••'}
            </div>
            <div class="font-mono text-[10px] font-bold mt-1 leading-tight">${pendapatanFooter}</div>
        </div>
    `;
}

function toggleIncomeVisibility() {
    isIncomeVisible = !isIncomeVisible;
    renderStatsCards();
}

// ============================================
// Search & Filter
// ============================================
function debounceSearch(query) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => applyFilters(), 250);
}

function applyFilters() {
    const searchQuery = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
    const paymentFilter = document.getElementById('filter-payment')?.value || 'all';
    const statusFilter = document.getElementById('filter-status')?.value || 'all';

    filteredCustomers = groupedCustomers.filter(c => {
        // Search filter
        if (searchQuery) {
            const match = c.nama_lengkap.toLowerCase().includes(searchQuery) ||
                c.nomor_antrian.toLowerCase().includes(searchQuery) ||
                (c.kelas && c.kelas.toLowerCase().includes(searchQuery)) ||
                (c.alamat && c.alamat.toLowerCase().includes(searchQuery));
            if (!match) return false;
        }

        // Payment filter
        if (paymentFilter !== 'all' && c.payment_status !== paymentFilter) return false;

        // Status filter
        if (statusFilter !== 'all') {
            if (statusFilter === 'active') {
                const hasActive = c.statuses.some(s => s === STATUS.MENUNGGU || s === STATUS.DIPANGGIL || s === STATUS.DITUNDA);
                if (!hasActive) return false;
            } else if (statusFilter === 'selesai') {
                const allDone = c.statuses.every(s => s === STATUS.SELESAI);
                if (!allDone) return false;
            } else if (statusFilter === 'batal') {
                const allCancelled = c.statuses.every(s => s === STATUS.BATAL);
                if (!allCancelled) return false;
            }
        }

        return true;
    });

    renderCustomerTable();
    renderStatsCards();
}

// ============================================
// Customer Table
// ============================================
function renderCustomerTable() {
    const tbody = document.getElementById('customer-table-body');
    const countEl = document.getElementById('table-count');
    if (!tbody) return;

    countEl.textContent = `${filteredCustomers.length} data`;

    if (filteredCustomers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center font-mono font-bold text-gray-400 uppercase py-8">Tidak ada data ditemukan</td></tr>';
        return;
    }

    tbody.innerHTML = filteredCustomers.map((c, i) => {
        const booth = allBooths.find(b => b.id === c.booth_id);
        const isLunas = c.payment_status === 'lunas';

        // Purchase summary
        const allFinished = c.items.every(item => item.status === STATUS.SELESAI || item.status === STATUS.BATAL);
        
        const purchaseLines = c.items.map(item => {
            const statusIcon = item.status === STATUS.SELESAI ? '✅' :
                item.status === STATUS.DIPANGGIL ? '📢' :
                    item.status === STATUS.BATAL ? '❌' :
                        item.status === STATUS.DITUNDA ? '⏸️' : '⏳';
            return `${statusIcon} ${escapeHTML(item.background)} (${item.qty}x)`;
        });
        if (c.totalPigura > 0) purchaseLines.push(`🖼️ Pigura (${c.totalPigura}x)`);
        
        // Tampilkan status pengambilan
        if (allFinished && c.picked_up) {
            purchaseLines.push(`<div class="mt-1 text-neoGreen">📦 Sudah Diambil</div>`);
        } else if (allFinished && !c.picked_up) {
            purchaseLines.push(`<div class="mt-1 text-neoRed font-black">📦 Belum Diambil</div>`);
        }
        
        // Parse notes untuk separate manual vs auto payment notes
        const parsedNotes = parseNotes(c.notes);
        const paymentNote = parsedNotes.payment;
        
        // Siapkan badge selisih pembayaran (klik untuk resolve)
        let paymentDiffBadge = '';
        if (paymentNote) {
            if (paymentNote.includes('Kurang bayar:')) {
                const match = paymentNote.match(/Kurang bayar:\s*(Rp\s*[\d.,]+)/);
                const amountText = match ? match[1] : '';
                paymentDiffBadge = `<button onclick="resolvePaymentDiff('${c.nomor_antrian}', 'kurang')" title="Klik kalau sudah dilunasi"
                    class="mt-1 text-[10px] font-black uppercase text-white bg-neoRed border-2 border-black px-1.5 py-0.5 inline-block hover:bg-black transition-colors cursor-pointer">⚠️ Kurang ${amountText}</button>`;
            } else if (paymentNote.includes('Kelebihan bayar:')) {
                const match = paymentNote.match(/Kelebihan bayar:\s*(Rp\s*[\d.,]+)/);
                const amountText = match ? match[1] : '';
                paymentDiffBadge = `<button onclick="resolvePaymentDiff('${c.nomor_antrian}', 'lebih')" title="Klik kalau sudah dikembalikan"
                    class="mt-1 text-[10px] font-black uppercase text-white bg-green-600 border-2 border-black px-1.5 py-0.5 inline-block hover:bg-black transition-colors cursor-pointer">💰 Lebih ${amountText}</button>`;
            }
        }

        let rowClass = '';
        if (allFinished) {
            rowClass = isLunas ? 'bg-neoGreen' : 'bg-neoYellow';
        } else {
            rowClass = isLunas ? 'bg-green-50' : 'bg-white';
        }

        return `
        <tr class="table-row border-b-2 border-black/20 ${rowClass}">
            <td class="p-3 font-mono font-bold text-sm text-center">${i + 1}</td>
            <td class="p-3">
                <div class="font-black text-lg tracking-tight">${escapeHTML(c.nomor_antrian)}</div>
                <div class="font-mono text-[10px] text-gray-500">${formatTime(c.created_at)}</div>
            </td>
            <td class="p-3">
                <span class="font-mono text-xs font-bold bg-bgLight border-2 border-black px-2 py-0.5">${escapeHTML(booth?.nama_booth || '-')}</span>
            </td>
            <td class="p-3 font-bold uppercase text-sm">
                <div>${escapeHTML(c.nama_lengkap)}</div>
                ${c.no_wa ? `<a href="https://wa.me/${escapeAttr(c.no_wa.startsWith('0') ? '62' + c.no_wa.substring(1) : c.no_wa)}" target="_blank" class="inline-block mt-1 text-xs bg-[#25D366] border-2 border-black text-white px-2 py-0.5 shadow-[2px_2px_0px_0px_#000] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_#000] transition-all"><span class="font-mono font-bold">💬 WA</span></a>` : ''}
            </td>
            <td class="p-3 font-mono font-bold text-sm">${escapeHTML(c.kelas)}</td>
            <td class="p-3 font-bold text-sm text-gray-700">${escapeHTML(c.alamat)}</td>
            <td class="p-3">
                <div class="text-xs font-bold space-y-0.5">${purchaseLines.map(l => `<div>${l}</div>`).join('')}</div>
            </td>
            <td class="p-3 text-right">
                <div class="font-black text-base">${formatCurrency(c.totalHarga)}</div>
                <div class="font-mono text-[10px] text-gray-500">${c.totalFoto} foto${c.totalPigura > 0 ? ` + ${c.totalPigura} pigura` : ''}</div>
                ${paymentDiffBadge}
            </td>
            <td class="p-3 text-center">
                <button onclick="togglePaymentMethod('${escapeAttr(c.nomor_antrian)}')" class="mb-1 transition-transform hover:scale-105 active:scale-95 cursor-pointer block w-full">
                ${c.payment_method === 'online' ? '<div class="text-[10px] font-black uppercase text-neoCyan bg-black px-1 py-0.5 border-2 border-transparent hover:border-neoCyan">💳 ONLINE</div>' : 
                  c.payment_method === 'tunai' ? '<div class="text-[10px] font-black uppercase text-black bg-neoYellow border-2 border-black px-1 py-0.5 hover:bg-black hover:text-neoYellow">💵 TUNAI</div>' : 
                  '<div class="text-[10px] font-black uppercase text-black bg-gray-200 border-2 border-black px-1 py-0.5 hover:bg-black hover:text-white">➖ KOSONG</div>'}
                </button>
                <button onclick="togglePayment('${escapeAttr(c.nomor_antrian)}')"
                    class="payment-badge inline-block px-3 py-2 font-black text-xs uppercase border-3 border-black shadow-[2px_2px_0px_0px_#000] ${isLunas ? 'bg-neoGreen' : 'bg-neoRed'} w-full mb-1">
                    ${isLunas ? '✅ LUNAS' : '❌ BELUM'}
                </button>
                ${allFinished ? `
                <button onclick="togglePickupStatus('${escapeAttr(c.nomor_antrian)}')"
                    class="payment-badge inline-block px-3 py-2 font-black text-xs uppercase border-3 border-black shadow-[2px_2px_0px_0px_#000] ${c.picked_up ? 'bg-neoCyan' : 'bg-white'} w-full">
                    ${c.picked_up ? '📦 DIAMBIL' : '📦 BELUM'}
                </button>
                ` : ''}
            </td>
            <td class="p-3">
                <input type="text" value="${escapeAttr(parsedNotes.manual)}" placeholder="..."
                    class="notes-input w-full border-2 border-black/30 px-2 py-1 text-xs font-bold focus:outline-none focus:border-black bg-transparent min-w-[100px]"
                    onchange="saveNotes('${escapeAttr(c.nomor_antrian)}', this.value)"
                    onfocus="this.classList.add('border-black', 'bg-white')"
                    onblur="this.classList.remove('border-black', 'bg-white')">
            </td>
            <td class="p-3 text-center">
                <button onclick="openEditModal('${escapeAttr(c.nomor_antrian)}')"
                    class="neo-button bg-neoCyan font-bold uppercase py-1.5 px-3 text-xs">✏️ Edit</button>
            </td>
        </tr>`;
    }).join('');
}

// ============================================
// Payment Toggle
// ============================================
async function togglePayment(nomorAntrian) {
    const customer = groupedCustomers.find(c => c.nomor_antrian === nomorAntrian);
    if (!customer) return;

    const newStatus = customer.payment_status === 'lunas' ? 'belum_lunas' : 'lunas';
    const statusText = newStatus === 'lunas' ? 'LUNAS' : 'BELUM LUNAS';

    showConfirm('Ubah Status Pembayaran', `Ubah status pembayaran <b>${nomorAntrian}</b> menjadi <b>${statusText}</b>?`, 'UBAH', async () => {
        const updatePayload = { payment_status: newStatus };

        // BUG-005 FIX: Saat toggle ke LUNAS, clear payment note (kurang/lebih bayar)
        // tapi preserve manual notes
        if (newStatus === 'lunas') {
            const parsed = parseNotes(customer.notes);
            if (parsed.payment) {
                updatePayload.notes = combineNotes(parsed.manual, '');
            }
        }

        const { error } = await supabaseClient
            .from('queues')
            .update(updatePayload)
            .eq('nomor_antrian', nomorAntrian);

        if (error) {
            showPopup('Error', 'Gagal mengubah status pembayaran: ' + error.message, true);
            return;
        }

        // Update local data
        customer.payment_status = newStatus;
        if (updatePayload.notes !== undefined) customer.notes = updatePayload.notes;
        allCustomerData.forEach(row => {
            if (row.nomor_antrian === nomorAntrian) {
                row.payment_status = newStatus;
                if (updatePayload.notes !== undefined) row.notes = updatePayload.notes;
            }
        });

        applyFilters();
    });
}

// ============================================
// Payment Method Toggle
// ============================================
async function togglePaymentMethod(nomorAntrian) {
    const customer = groupedCustomers.find(c => c.nomor_antrian === nomorAntrian);
    if (!customer) return;

    let newMethod = 'tunai';
    if (!customer.payment_method || customer.payment_method === 'tunai') {
        newMethod = 'online';
    }

    showConfirm('Ubah Metode Pembayaran', `Ubah metode pembayaran <b>${nomorAntrian}</b> menjadi <b>${newMethod.toUpperCase()}</b>?`, 'UBAH', async () => {
        const { error } = await supabaseClient
            .from('queues')
            .update({ payment_method: newMethod })
            .eq('nomor_antrian', nomorAntrian);

        if (error) {
            showPopup('Error', 'Gagal mengubah metode pembayaran: ' + error.message, true);
            return;
        }

        // Update local data
        customer.payment_method = newMethod;
        allCustomerData.forEach(row => {
            if (row.nomor_antrian === nomorAntrian) row.payment_method = newMethod;
        });

        applyFilters();
    });
    // BUG-031 FIX: dihilangkan applyFilters() yang dipanggil di luar callback
    // (sebelumnya jalan meskipun user batal di confirm dialog)
}

// ============================================
// Pickup Status Toggle
// ============================================
async function togglePickupStatus(nomorAntrian) {
    const customer = groupedCustomers.find(c => c.nomor_antrian === nomorAntrian);
    if (!customer) return;

    const newStatus = !customer.picked_up;
    const statusText = newStatus ? 'SUDAH DIAMBIL' : 'BELUM DIAMBIL';

    showConfirm('Ubah Status Pengambilan', `Ubah status pengambilan tiket <b>${nomorAntrian}</b> menjadi <b>${statusText}</b>?`, 'UBAH', async () => {
        // BUG-030 RLS hardening: pakai RPC instead of direct UPDATE
        const { error } = await supabaseClient.rpc('pengambilan_set_pickup', {
            p_nomor_antrian: nomorAntrian,
            p_picked_up: newStatus
        });

        if (error) {
            showPopup('Error', 'Gagal mengubah status pengambilan: ' + error.message, true);
            return;
        }

        // Update local data
        customer.picked_up = newStatus;
        allCustomerData.forEach(row => {
            if (row.nomor_antrian === nomorAntrian) row.picked_up = newStatus;
        });

        applyFilters();
        showPopup('Berhasil', `✅ Status pengambilan tiket <b>${nomorAntrian}</b> berhasil diubah menjadi <b>${statusText}</b>.`);
    });
}

// ============================================
// Resolve payment difference (kurang/lebih bayar)
// Dipanggil saat sekretariat klik badge di kolom Total
// ============================================
async function resolvePaymentDiff(nomorAntrian, type) {
    const customer = groupedCustomers.find(c => c.nomor_antrian === nomorAntrian);
    if (!customer) return;

    const parsed = parseNotes(customer.notes);
    const paymentOnly = parsed.payment;

    // Match jumlah dari payment note
    let amountText = '';
    const m = paymentOnly.match(/(Rp\s*[\d.,]+)/);
    if (m) amountText = m[1];

    let title, message, confirmText, newPaymentStatus;
    if (type === 'kurang') {
        title = '💵 Lunasi Kekurangan';
        message = `Konfirmasi: Customer <b>${customer.nama_lengkap}</b> (${nomorAntrian}) sudah melunasi kekurangan sebesar <b>${amountText}</b>?<br><br>Status akan berubah jadi <b>LUNAS</b> dan badge selisih dihapus.`;
        confirmText = '✅ SUDAH DILUNASI';
        newPaymentStatus = 'lunas';
    } else {
        title = '💰 Kembalikan Kelebihan';
        message = `Konfirmasi: Kelebihan bayar sebesar <b>${amountText}</b> sudah dikembalikan ke customer <b>${customer.nama_lengkap}</b> (${nomorAntrian})?<br><br>Badge kelebihan bayar akan dihapus.`;
        confirmText = '✅ SUDAH DIKEMBALIKAN';
        newPaymentStatus = 'lunas';
    }

    showConfirm(title, message, confirmText, async () => {
        // Hapus payment note, preserve manual notes
        const newCombined = combineNotes(parsed.manual, '');

        const { error } = await supabaseClient
            .from('queues')
            .update({
                payment_status: newPaymentStatus,
                notes: newCombined
            })
            .eq('nomor_antrian', nomorAntrian);

        if (error) {
            showPopup('Error', 'Gagal menyimpan: ' + error.message, true);
            return;
        }

        // Update local state
        customer.notes = newCombined;
        customer.payment_status = newPaymentStatus;
        allCustomerData.forEach(row => {
            if (row.nomor_antrian === nomorAntrian) {
                row.notes = newCombined;
                row.payment_status = newPaymentStatus;
            }
        });

        applyFilters();
        showPopup('Berhasil',
            type === 'kurang'
                ? `✅ Pembayaran <b>${nomorAntrian}</b> sudah dilunasi.`
                : `✅ Kelebihan bayar <b>${nomorAntrian}</b> sudah dikembalikan.`
        );
    });
}

// ============================================
// Notes inline save (preserves auto payment notes)
// BUG-007 FIX: re-fetch payment notes dari DB sebelum combine,
// mencegah resurrect stale payment note dari local cache
// ============================================
async function saveNotes(nomorAntrian, manualNotes) {
    const trimmed = (manualNotes || '').trim();

    // Re-fetch payment notes terkini dari DB (race-safe)
    const { data: fresh, error: fetchErr } = await supabaseClient
        .from('queues')
        .select('notes')
        .eq('nomor_antrian', nomorAntrian)
        .limit(1)
        .single();

    if (fetchErr) {
        showPopup('Error', 'Gagal membaca catatan: ' + fetchErr.message, true);
        return;
    }

    const existingPayment = parseNotes(fresh?.notes || '').payment;

    // Gabungkan manual notes baru dengan payment notes terkini dari DB
    const combined = combineNotes(trimmed, existingPayment);

    const { error } = await supabaseClient
        .from('queues')
        .update({ notes: combined })
        .eq('nomor_antrian', nomorAntrian);

    if (error) {
        showPopup('Error', 'Gagal menyimpan catatan: ' + error.message, true);
        return;
    }

    // Update local
    const customer = groupedCustomers.find(c => c.nomor_antrian === nomorAntrian);
    if (customer) customer.notes = combined;
    allCustomerData.forEach(row => {
        if (row.nomor_antrian === nomorAntrian) row.notes = combined;
    });
}

// ============================================
// Edit Modal
// ============================================
function openEditModal(nomorAntrian) {
    const customer = groupedCustomers.find(c => c.nomor_antrian === nomorAntrian);
    if (!customer) return;

    document.getElementById('edit-nomor-antrian').value = nomorAntrian;
    document.getElementById('edit-nama').value = customer.nama_lengkap === '-' ? '' : customer.nama_lengkap;
    document.getElementById('edit-kelas').value = customer.kelas === '-' ? '' : customer.kelas;
    document.getElementById('edit-alamat').value = customer.alamat === '-' ? '' : customer.alamat;
    document.getElementById('edit-wa').value = customer.no_wa || '';
    document.getElementById('edit-notes').value = parseNotes(customer.notes).manual;

    // Initialize edit order state
    editBgQuantities = {};
    backgrounds.forEach(bg => { editBgQuantities[bg.id] = 0; });
    editPiguraQty = customer.totalPigura || 0;
    
    // Populate existing quantities
    customer.items.forEach(item => {
        if (editBgQuantities[item.background_id] !== undefined) {
            editBgQuantities[item.background_id] += item.qty;
        }
    });
    
    renderEditBackgrounds();

    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('edit-modal-content');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });
}

function renderEditBackgrounds() {
    const listEl = document.getElementById('edit-bg-list');
    if (!listEl) return;
    
    const colors = ['hover:bg-neoPink', 'hover:bg-neoYellow', 'hover:bg-neoCyan', 'hover:bg-neoGreen'];
    listEl.innerHTML = backgrounds.map((bg, idx) => {
        const color = colors[idx % colors.length];
        return `
        <div class="bg-white ${color} border-2 border-black p-2 flex justify-between items-center gap-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            <div class="font-black uppercase text-sm leading-tight flex-1 truncate">${bg.nama_background}</div>
            <div class="flex items-center bg-white border-2 border-black rounded-full overflow-hidden shrink-0 h-8">
                <button type="button" onclick="changeEditQty(${bg.id}, -1)" class="w-8 h-full bg-white hover:bg-gray-200 font-black flex items-center justify-center transition-colors border-r-2 border-black">-</button>
                <span id="edit-qty-${bg.id}" class="font-mono font-black text-sm w-8 text-center flex items-center justify-center bg-white h-full">${editBgQuantities[bg.id]}</span>
                <button type="button" onclick="changeEditQty(${bg.id}, 1)" class="w-8 h-full bg-white hover:bg-gray-200 font-black flex items-center justify-center transition-colors border-l-2 border-black">+</button>
            </div>
        </div>
        `;
    }).join('');
    
    document.getElementById('edit-qty-pigura').textContent = editPiguraQty;
}

function changeEditQty(bgId, delta) {
    editBgQuantities[bgId] += delta;
    if (editBgQuantities[bgId] < 0) editBgQuantities[bgId] = 0;
    if (editBgQuantities[bgId] > 10) editBgQuantities[bgId] = 10;
    const el = document.getElementById(`edit-qty-${bgId}`);
    if (el) el.textContent = editBgQuantities[bgId];
}

function changeEditPiguraQty(delta) {
    editPiguraQty += delta;
    if (editPiguraQty < 0) editPiguraQty = 0;
    if (editPiguraQty > 20) editPiguraQty = 20;
    const el = document.getElementById('edit-qty-pigura');
    if (el) el.textContent = editPiguraQty;
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('edit-modal-content');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 200);
}

async function saveCustomerEdit() {
    const nomorAntrian = document.getElementById('edit-nomor-antrian').value;
    const nama = document.getElementById('edit-nama').value.trim();
    const kelas = document.getElementById('edit-kelas').value.trim();
    const alamat = document.getElementById('edit-alamat').value.trim();
    const wa = document.getElementById('edit-wa').value.trim();
    const manualNotes = document.getElementById('edit-notes').value.trim();

    // BUG-007 FIX: re-fetch payment notes dari DB (race-safe), bukan dari cache
    const { data: fresh, error: fetchErr } = await supabaseClient
        .from('queues')
        .select('notes')
        .eq('nomor_antrian', nomorAntrian)
        .limit(1)
        .single();
    
    if (fetchErr) {
        showPopup('Error', 'Gagal membaca data: ' + fetchErr.message, true);
        return;
    }
    
    const existingPayment = parseNotes(fresh?.notes || '').payment;
    const notes = combineNotes(manualNotes, existingPayment);

    if (!nama) {
        showPopup('Error', 'Nama tidak boleh kosong.', true);
        return;
    }

    // Check order validity
    const selectedBgs = backgrounds.filter(bg => editBgQuantities[bg.id] > 0);
    if (selectedBgs.length === 0) {
        showPopup('Error', 'Minimal satu background harus dipilih.', true);
        return;
    }

    const bgPayload = selectedBgs.map(bg => ({
        background_id: bg.id,
        jumlah_foto: editBgQuantities[bg.id]
    }));

    const { data, error } = await supabaseClient.rpc('update_queue_order', {
        p_nomor_antrian: nomorAntrian,
        p_nama: nama,
        p_kelas: kelas,
        p_alamat: alamat,
        p_notes: notes,
        p_backgrounds: bgPayload,
        p_pigura: editPiguraQty,
        p_no_wa: wa
    });

    if (error) {
        showPopup('Error', 'Gagal menyimpan: ' + error.message, true);
        return;
    }

    closeEditModal();
    showPopup('Sukses', `✅ Data & pesanan <b>${nama}</b> berhasil diperbarui!`);
    await fetchAllCustomers();
}

// ============================================
// Realtime Subscription
// ============================================
let realtimeQueueChannel = null;
let realtimeBoothChannel = null;
let realtimeRefetchTimer = null;
let pendingNotesEdits = {}; // BUG-027 FIX: track notes input yang sedang aktif diketik

function subscribeRealtime() {
    // BUG-013 FIX: cleanup channel lama sebelum subscribe baru
    if (realtimeQueueChannel) {
        supabaseClient.removeChannel(realtimeQueueChannel);
    }
    if (realtimeBoothChannel) {
        supabaseClient.removeChannel(realtimeBoothChannel);
    }
    
    // Subscribe to queue changes (debounced)
    realtimeQueueChannel = supabaseClient.channel('sekretariat-queues')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, () => {
            // BUG-027 FIX: debounce + skip kalau user lagi ngetik notes
            if (realtimeRefetchTimer) clearTimeout(realtimeRefetchTimer);
            realtimeRefetchTimer = setTimeout(() => {
                // Skip refetch kalau ada notes input yang sedang focus
                const activeEl = document.activeElement;
                if (activeEl && activeEl.classList.contains('notes-input')) {
                    // Reschedule check setiap 2 detik sampai user blur
                    realtimeRefetchTimer = setTimeout(() => {
                        if (!document.activeElement?.classList.contains('notes-input')) {
                            fetchAllCustomers();
                        }
                    }, 2000);
                    return;
                }
                fetchAllCustomers();
            }, 300);
        })
        .subscribe();
    
    // Subscribe to booth changes (quota counter, config updates)
    realtimeBoothChannel = supabaseClient.channel('sekretariat-booths')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'booths' }, (payload) => {
            // Update booth info in local state
            const booth = allBooths.find(b => b.id === payload.new.id);
            if (booth) {
                Object.assign(booth, payload.new);
                renderBoothManagement();
            }
        })
        .subscribe();
}

// BUG-013 FIX: cleanup pada unload
window.addEventListener('beforeunload', () => {
    if (realtimeQueueChannel) supabaseClient.removeChannel(realtimeQueueChannel);
    if (realtimeBoothChannel) supabaseClient.removeChannel(realtimeBoothChannel);
});

// ============================================
// Export CSV
// ============================================
function exportCSV() {
    if (filteredCustomers.length === 0) {
        showPopup('Tidak Ada Data', 'Tidak ada data untuk di-export.');
        return;
    }

    const headers = ['No', 'Tiket', 'Booth', 'Nama', 'No WA', 'Kelas', 'Alamat', 'Total Foto', 'Total Pigura', 'Total Harga', 'Status Bayar', 'Catatan', 'Tanggal'];
    const rows = filteredCustomers.map((c, i) => {
        const booth = allBooths.find(b => b.id === c.booth_id);
        return [
            i + 1,
            c.nomor_antrian,
            booth?.nama_booth || '-',
            `"${c.nama_lengkap}"`,
            `"${c.no_wa}"`,
            `"${c.kelas}"`,
            `"${c.alamat}"`,
            c.totalFoto,
            c.totalPigura,
            c.totalHarga,
            c.payment_status === 'lunas' ? 'Lunas' : 'Belum Lunas',
            `"${c.notes || ''}"`,
            new Date(c.created_at).toLocaleString('id-ID')
        ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const BOM = '\uFEFF'; // UTF-8 BOM for Excel compatibility
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `sekretariat-data-${new Date().toISOString().slice(0, 10)}.csv`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    showPopup('Berhasil', '✅ Data berhasil di-export sebagai CSV.');
}

// ============================================
// Export PDF
// ============================================
function downloadPDF() {
    if (filteredCustomers.length === 0) {
        showPopup('Tidak Ada Data', 'Tidak ada data untuk dicetak.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape', 'mm', 'a4');

    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('LAPORAN SEKRETARIAT — PHOTOBOOTH', 148.5, 18, { align: 'center' });
    doc.setFontSize(9);
    const now = new Date();
    doc.text(`Dicetak: ${now.toLocaleString('id-ID')}`, 148.5, 28, { align: 'center' });

    const boothLabel = currentBoothFilter === 'all' ? 'Semua Booth' : (allBooths.find(b => b.id === parseInt(currentBoothFilter))?.nama_booth || '-');
    doc.text(`Booth: ${boothLabel}`, 14, 28);

    let no = 1;
    let grandTotal = 0;
    let grandFoto = 0;

    const tableData = filteredCustomers.map(c => {
        const booth = allBooths.find(b => b.id === c.booth_id);
        grandTotal += c.totalHarga;
        grandFoto += c.totalFoto;

        const detail = c.items.map(i => `- ${i.background} (${i.qty}x) [${i.status.toUpperCase()}]`);
        if (c.totalPigura > 0) detail.push(`- Pigura (${c.totalPigura}x)`);

        return [
            no++,
            c.nomor_antrian,
            c.nama_lengkap + (c.no_wa ? `\n(${c.no_wa})` : ''),
            c.kelas,
            detail.join('\n'),
            formatCurrency(c.totalHarga),
            c.payment_status === 'lunas' ? '✓ LUNAS' : '✗ BELUM',
            c.notes || '-'
        ];
    });

    doc.autoTable({
        startY: 33,
        head: [['No', 'Tiket', 'Nama/WA', 'Kelas', 'Pembelian', 'Total', 'Bayar', 'Catatan']],
        body: tableData,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2, lineWidth: 0.3 },
        headStyles: { fillColor: [249, 168, 212], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
        columnStyles: {
            0: { halign: 'center', cellWidth: 8 },
            1: { halign: 'center', cellWidth: 22, fontStyle: 'bold' },
            2: { cellWidth: 35 },
            3: { cellWidth: 25 },
            4: { cellWidth: 85 },
            5: { halign: 'right', cellWidth: 30, fontStyle: 'bold' },
            6: { halign: 'center', cellWidth: 22 },
            7: { cellWidth: 40 }
        },
    });

    const fy = doc.lastAutoTable.finalY + 4;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(103, 232, 249);
    doc.rect(14, fy, doc.internal.pageSize.width - 28, 10, 'F');
    doc.rect(14, fy, doc.internal.pageSize.width - 28, 10, 'S');

    const lunasCount = filteredCustomers.filter(c => c.payment_status === 'lunas').length;
    const lunasTotal = filteredCustomers.filter(c => c.payment_status === 'lunas').reduce((s, c) => s + c.totalHarga, 0);
    doc.text(`TOTAL: ${filteredCustomers.length} Pendaftar | ${grandFoto} Foto | Lunas: ${lunasCount} (${formatCurrency(lunasTotal)}) | Grand Total: ${formatCurrency(grandTotal)}`, 148.5, fy + 7, { align: 'center' });

    doc.save(`Laporan-Sekretariat-${now.toISOString().slice(0, 10)}.pdf`);
    showPopup('Sukses', '✅ Laporan PDF berhasil diunduh!');
}

// ============================================
// Utility
// ============================================
// escapeHTML() & escapeAttr() sekarang global di shared/config.js (BUG-018/019 FIX)

// ============================================
// Booth Management UI
// ============================================

// ============================================
// Background Toggle UI (Buka / Kunci per Booth)
// ============================================
let boothBgSettings = {}; // { booth_id: { bg_id: is_active } }

async function loadBoothBgSettings() {
    const { data, error } = await supabaseClient
        .from('booth_background_settings')
        .select('booth_id, background_id, is_active');
    if (error) { console.error('loadBoothBgSettings error:', error); return; }
    
    boothBgSettings = {};
    (data || []).forEach(row => {
        if (!boothBgSettings[row.booth_id]) boothBgSettings[row.booth_id] = {};
        boothBgSettings[row.booth_id][row.background_id] = row.is_active;
    });
}

async function toggleBackground(boothId, bgId, newStatus) {
    const bg = backgrounds.find(b => b.id === bgId);
    const booth = allBooths.find(b => b.id === boothId);
    if (!bg || !booth) return;

    const action = newStatus ? 'membuka' : 'mengunci';
    const actionLabel = newStatus ? 'BUKA' : 'KUNCI';

    showConfirm(
        `${newStatus ? '🔓' : '🔒'} ${actionLabel} Background`,
        `${newStatus ? 'Buka' : 'Kunci'} background <b>${escapeHTML(bg.nama_background)}</b> untuk booth <b>${escapeHTML(booth.nama_booth)}</b>?`,
        `YA, ${actionLabel}`,
        async () => {
            // Upsert ke booth_background_settings
            const { error } = await supabaseClient
                .from('booth_background_settings')
                .upsert({ booth_id: boothId, background_id: bgId, is_active: newStatus },
                    { onConflict: 'booth_id,background_id' });

            if (error) {
                console.error('toggleBackground error:', error);
                showPopup('Error', 'Gagal ' + action + ' background: ' + error.message, true);
                return;
            }

            // Update local state
            if (!boothBgSettings[boothId]) boothBgSettings[boothId] = {};
            boothBgSettings[boothId][bgId] = newStatus;
            // Re-render hanya section background di booth card yang bersangkutan
            const bgTogglesEl = document.getElementById(`bg-toggles-${boothId}`);
            if (bgTogglesEl) {
                const settings = boothBgSettings[boothId];
                bgTogglesEl.innerHTML = backgrounds.map(bg => {
                    const active = settings[bg.id] !== false;
                    return `
                    <button onclick="toggleBackground(${boothId}, ${bg.id}, ${!active})"
                        class="flex items-center gap-1.5 px-2 py-1.5 border-2 border-black font-bold text-xs uppercase transition-colors ${active ? 'bg-neoGreen hover:bg-neoRed hover:text-white' : 'bg-gray-200 hover:bg-neoGreen'}">
                        <span>${active ? '🟢' : '🔴'}</span>
                        <span class="truncate">${escapeHTML(bg.nama_background)}</span>
                    </button>`;
                }).join('');
            }
            showPopup('Berhasil', `✅ Background <b>${escapeHTML(bg.nama_background)}</b> berhasil ${newStatus ? 'dibuka' : 'dikunci'} untuk booth <b>${escapeHTML(booth.nama_booth)}</b>.`);
        }
    );
}

function renderBoothManagement() {
    const container = document.getElementById('booth-management-list');
    if (!container) return;
    container.innerHTML = allBooths.map(b => {
        const salesDatetime = b.sales_start_datetime ? formatDatetimeLocal(b.sales_start_datetime) : '';
        const salesEndDatetime = b.sales_end_datetime ? formatDatetimeLocal(b.sales_end_datetime) : '';
        const isUnlimited = b.max_capacity === null || b.max_capacity === undefined;
        const currentCount = b.current_ticket_count || 0;
        const maxCap = b.max_capacity || 30;
        
        return `
        <div class="border-4 border-black bg-white shadow-[4px_4px_0px_0px_#000] mb-3">
            <!-- Header: Nama & Prefix -->
            <div class="flex flex-wrap items-center gap-2 p-3 bg-neoYellow border-b-4 border-black">
                <span class="font-black uppercase flex-1 min-w-[120px]">${b.nama_booth}</span>
                <span class="font-mono bg-black text-white border-2 border-black px-2 py-0.5 text-sm font-bold">${b.ticket_prefix}</span>
                <input type="text" id="edit-name-${b.id}" value="${b.nama_booth}"
                    class="border-2 border-black px-2 py-1 text-sm font-bold w-32 focus:outline-none focus:ring-2 focus:ring-neoCyan">
                <input type="text" id="edit-prefix-${b.id}" value="${b.ticket_prefix}"
                    class="border-2 border-black px-2 py-1 text-sm font-bold w-20 uppercase focus:outline-none focus:ring-2 focus:ring-neoCyan"
                    maxlength="5">
                <button onclick="saveBooth(${b.id})"
                    class="neo-button bg-neoGreen font-bold uppercase py-1 px-3 text-sm">💾 Simpan</button>
            </div>
            
            <!-- Pengaturan Waktu & Kuota -->
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <!-- Waktu Mulai Penjualan -->
                    <div class="flex flex-col gap-1">
                        <label class="font-mono text-xs font-bold uppercase flex items-center gap-2">
                            ⏰ Tanggal & Jam Buka Penjualan
                            <span class="text-[9px] font-normal text-gray-500">(Kosongkan = Selalu Buka)</span>
                        </label>
                        <input type="datetime-local" 
                               id="sales-datetime-${b.id}" 
                               value="${salesDatetime}"
                               class="border-2 border-black px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-neoCyan">
                    </div>
                    
                    <!-- Waktu Tutup Penjualan -->
                    <div class="flex flex-col gap-1">
                        <label class="font-mono text-xs font-bold uppercase flex items-center gap-2">
                            🔒 Tanggal & Jam Tutup Penjualan
                            <span class="text-[9px] font-normal text-gray-500">(Kosongkan = Tidak Ada Batas)</span>
                        </label>
                        <input type="datetime-local" 
                               id="sales-end-datetime-${b.id}" 
                               value="${salesEndDatetime}"
                               class="border-2 border-black px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-neoPink">
                    </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <!-- Batas Kuota -->
                    <div class="flex flex-col gap-1">
                        <label class="font-mono text-xs font-bold uppercase flex items-center gap-2">
                            🎫 Batas Kuota Tiket
                            <label class="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" 
                                       id="unlimited-${b.id}" 
                                       ${isUnlimited ? 'checked' : ''}
                                       onchange="toggleUnlimited(${b.id})"
                                       class="w-4 h-4">
                                <span class="text-[10px] font-normal">Tanpa Batas</span>
                            </label>
                        </label>
                        <input type="number" 
                               id="capacity-${b.id}" 
                               value="${maxCap}"
                               min="1"
                               ${isUnlimited ? 'disabled' : ''}
                               class="border-2 border-black px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-neoCyan disabled:bg-gray-100 disabled:text-gray-400">
                    </div>
                </div>
                
                <!-- Status Kuota & Reset -->
                <div class="flex flex-col sm:flex-row gap-3 items-start sm:items-center p-3 bg-bgLight border-2 border-black">
                    <div class="flex-1">
                        <div class="font-mono text-xs font-bold uppercase text-gray-700 mb-1">📊 Status Kuota Saat Ini:</div>
                        <div class="font-black text-2xl" id="quota-status-${b.id}">
                            ${currentCount} / ${isUnlimited ? '∞' : maxCap}
                        </div>
                        ${!isUnlimited && maxCap > 0 ? `
                        <div class="mt-1 h-2 bg-white border border-black overflow-hidden">
                            <div class="h-full bg-neoCyan transition-all" style="width: ${Math.min((currentCount / maxCap) * 100, 100)}%"></div>
                        </div>
                        ` : ''}
                    </div>
                    <button onclick="resetQuota(${b.id})" 
                            class="neo-button bg-neoPink font-bold uppercase py-2 px-4 text-sm whitespace-nowrap">
                        🔄 Reset Counter
                    </button>
                </div>
                
                <!-- Buka / Kunci Background per Booth -->
                <div class="border-t-2 border-black pt-3">
                    <div class="font-mono text-xs font-bold uppercase mb-2">🖼️ Buka / Kunci Background:</div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2" id="bg-toggles-${b.id}">
                        ${backgrounds.map(bg => {
                            const settings = boothBgSettings[b.id] || {};
                            const isActive = settings[bg.id] !== false;
                            return `
                            <button onclick="toggleBackground(${b.id}, ${bg.id}, ${!isActive})"
                                class="flex items-center gap-1.5 px-2 py-1.5 border-2 border-black font-bold text-xs uppercase transition-colors ${isActive ? 'bg-neoGreen hover:bg-neoRed hover:text-white' : 'bg-gray-200 hover:bg-neoGreen'}">
                                <span>${isActive ? '🟢' : '🔴'}</span>
                                <span class="truncate">${escapeHTML(bg.nama_background)}</span>
                            </button>`;
                        }).join('')}
                    </div>
                </div>
                
                <!-- Tombol Simpan Pengaturan -->
                <button onclick="saveBoothSettings(${b.id})" 
                        class="w-full neo-button bg-neoGreen font-black uppercase py-3 px-4 text-base">
                    💾 SIMPAN PENGATURAN WAKTU & KUOTA
                </button>
                
                <!-- Tombol Aksi Lainnya -->
                <div class="flex flex-wrap gap-2 pt-2 border-t-2 border-black">
                    <button onclick="showBoothQR(${b.id})"
                        class="flex-1 neo-button bg-neoCyan font-bold uppercase py-2 px-3 text-xs">📱 QR Customer</button>
                    <button onclick="copyBoothURL(${b.id}, 'monitor')"
                        class="flex-1 neo-button bg-neoYellow font-bold uppercase py-2 px-3 text-xs">📺 Monitor</button>
                    <button onclick="deleteBooth(${b.id})"
                        class="flex-1 neo-button bg-neoRed text-white font-bold uppercase py-2 px-3 text-xs">🗑️ Hapus</button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// ============================================
// Booth Quota & Schedule Management
// ============================================

function toggleUnlimited(boothId) {
    const checkbox = document.getElementById(`unlimited-${boothId}`);
    const input = document.getElementById(`capacity-${boothId}`);
    if (checkbox && input) {
        input.disabled = checkbox.checked;
        if (checkbox.checked) {
            input.classList.add('bg-gray-100', 'text-gray-400');
        } else {
            input.classList.remove('bg-gray-100', 'text-gray-400');
        }
    }
}

async function saveBoothSettings(boothId) {
    const salesDatetimeInput = document.getElementById(`sales-datetime-${boothId}`);
    const salesEndDatetimeInput = document.getElementById(`sales-end-datetime-${boothId}`);
    const unlimitedCheckbox = document.getElementById(`unlimited-${boothId}`);
    const capacityInput = document.getElementById(`capacity-${boothId}`);
    
    if (!salesDatetimeInput || !unlimitedCheckbox || !capacityInput) {
        return showPopup('Error', 'Elemen form tidak ditemukan.', true);
    }
    
    const salesDatetime = salesDatetimeInput.value ? new Date(salesDatetimeInput.value).toISOString() : null;
    const salesEndDatetime = salesEndDatetimeInput?.value ? new Date(salesEndDatetimeInput.value).toISOString() : null;
    const isUnlimited = unlimitedCheckbox.checked;
    const capacity = isUnlimited ? null : parseInt(capacityInput.value);
    
    if (!isUnlimited && (isNaN(capacity) || capacity < 1)) {
        return showPopup('Error', 'Kuota harus minimal 1 tiket jika tidak unlimited.', true);
    }
    
    // Validasi: jam tutup harus setelah jam buka
    if (salesDatetime && salesEndDatetime && new Date(salesEndDatetime) <= new Date(salesDatetime)) {
        return showPopup('Error', 'Jam tutup harus setelah jam buka penjualan.', true);
    }
    
    try {
        const { error } = await supabaseClient
            .from('booths')
            .update({
                sales_start_datetime: salesDatetime,
                sales_end_datetime: salesEndDatetime,
                max_capacity: capacity
            })
            .eq('id', boothId);
            
        if (error) throw error;
        
        await loadBooths();
        renderBoothManagement();
        
        const booth = allBooths.find(b => b.id === boothId);
        const boothName = booth?.nama_booth || 'Booth';
        
        let message = `✅ Pengaturan <b>${boothName}</b> berhasil disimpan!<br><br>`;
        if (salesDatetime) {
            message += `⏰ Penjualan dibuka: <b>${new Date(salesDatetime).toLocaleString('id-ID')}</b><br>`;
        } else {
            message += `⏰ Penjualan: <b>Selalu Buka</b><br>`;
        }
        if (capacity) {
            message += `🎫 Kuota maksimal: <b>${capacity} tiket</b>`;
        } else {
            message += `🎫 Kuota: <b>Tanpa Batas</b>`;
        }
        
        showPopup('Berhasil', message);
    } catch (e) {
        console.error(e);
        showPopup('Gagal', 'Gagal menyimpan pengaturan: ' + e.message, true);
    }
}

async function resetQuota(boothId) {
    const booth = allBooths.find(b => b.id === boothId);
    if (!booth) return;
    
    showConfirm(
        'Reset Counter Kuota',
        `Yakin ingin mereset counter kuota untuk <b>${booth.nama_booth}</b>?<br><br>Counter akan kembali ke <b>0</b>.`,
        'YA, RESET',
        async () => {
            try {
                const { error } = await supabaseClient.rpc('reset_booth_quota', {
                    p_booth_id: boothId
                });
                
                if (error) throw error;
                
                await loadBooths();
                renderBoothManagement();
                showPopup('Berhasil', `✅ Counter kuota <b>${booth.nama_booth}</b> berhasil direset!`);
            } catch (e) {
                console.error(e);
                showPopup('Gagal', 'Gagal reset kuota: ' + e.message, true);
            }
        }
    );
}

function formatDatetimeLocal(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
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
            if (currentBoothFilter === boothId.toString()) {
                currentBoothFilter = 'all';
            }
            renderBoothSelector();
            renderBoothManagement();
            await fetchAllCustomers();
            showPopup('Sukses', '✅ Booth berhasil dihapus.');
        });
}

function copyBoothURL(boothId, page) {
    const base = window.location.origin + window.location.pathname.replace('sekretariat.html', '');
    const url = `${base}${page}.html?booth=${boothId}`;
    navigator.clipboard.writeText(url).then(() => {
        showPopup('URL Disalin!', `URL <b>${page}</b> untuk booth ini:<br><br><code class="bg-gray-100 px-2 py-1 break-all text-xs">${url}</code><br><br>Berhasil disalin ke clipboard.`);
    });
}

function showBoothQR(boothId) {
    const booth = allBooths.find(b => b.id === boothId);
    if (!booth) return;

    const base = window.location.origin + window.location.pathname.replace('sekretariat.html', '');
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
// Cache, Export, & Reset (per booth)
// ============================================
async function broadcastClearCache() {
    if (currentBoothFilter === 'all') return showPopup('Error', 'Pilih booth spesifik terlebih dahulu untuk melakukan wipe cache.', true);
    const boothId = parseInt(currentBoothFilter);
    showConfirm('Wipe Cache', '⚠️ Tombol ini akan menghapus paksa cache tiket di SEMUA HP pelanggan booth ini. Lanjutkan?',
        'YA, WIPE', async () => {
            // BUG-035 FIX: kirim boothId agar customer hanya respons untuk booth-nya
            await systemChannel.send({ type: 'broadcast', event: 'clear_cache', payload: { action: 'wipe', boothId } });
            showPopup('Sukses', '✅ Sinyal pembersihan cache telah disebarkan!');
        });
}

function resetAllQueues() {
    if (currentBoothFilter === 'all') return showPopup('Error', 'Pilih booth spesifik terlebih dahulu untuk reset antrian.', true);
    const boothId = parseInt(currentBoothFilter);
    const booth = allBooths.find(b => b.id === boothId);
    showConfirm('Reset Antrian Booth',
        `Yakin ingin menghapus SEMUA antrian booth <b>${booth?.nama_booth || ''}</b>? Data terhapus permanen.`,
        'YA, RESET', async () => {
            try {
                const { data: rows } = await supabaseClient.from('queues').select('id').eq('booth_id', boothId);
                if (rows && rows.length > 0) {
                    await supabaseClient.from('queues').delete().in('id', rows.map(r => r.id));
                }
                await systemChannel.send({ type: 'broadcast', event: 'clear_cache', payload: { action: 'wipe', boothId } });
                showPopup('Sukses', '✅ Semua antrian booth ini dihapus!');
                fetchAllCustomers();
            } catch (e) { showPopup('Error', 'Gagal reset: ' + e.message, true); }
        });
}

async function exportData() {
    if (currentBoothFilter === 'all') return showPopup('Error', 'Pilih booth spesifik terlebih dahulu untuk export.', true);
    const boothId = parseInt(currentBoothFilter);
    const { data, error } = await supabaseClient.from('queues').select('*').eq('booth_id', boothId);
    if (error) return showPopup('Error', error.message, true);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `backup-booth${boothId}-${new Date().toISOString().slice(0,10)}.json`;
    a.href = url; a.click(); URL.revokeObjectURL(url);
    showPopup('Berhasil', '✅ Data antrian booth ini berhasil diekspor JSON.');
}

function importData(event) {
    if (currentBoothFilter === 'all') {
        document.getElementById('import-file').value = '';
        return showPopup('Error', 'Pilih booth spesifik terlebih dahulu untuk import.', true);
    }
    const boothId = parseInt(currentBoothFilter);
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) throw new Error('Format tidak valid.');
            showConfirm('Import Data', `Ditemukan ${data.length} baris. Import akan MENGGANTIKAN data booth ini. Lanjutkan?`,
                'YA, IMPORT', async () => {
                    const { data: rows } = await supabaseClient.from('queues').select('id').eq('booth_id', boothId);
                    if (rows?.length) await supabaseClient.from('queues').delete().in('id', rows.map(r => r.id));
                    const clean = data.map(({ id, ...rest }) => ({ ...rest, booth_id: boothId }));
                    const { error } = await supabaseClient.from('queues').insert(clean);
                    if (error) throw error;
                    showPopup('Berhasil', '✅ Import berhasil!');
                    fetchAllCustomers();
                    document.getElementById('import-file').value = '';
                });
        } catch (err) { showPopup('Error', 'Gagal membaca file: ' + err.message, true); }
    };
    reader.readAsText(file);
}

// ============================================
// User Management
// ============================================

let allUsers = [];
let allBoothAccess = [];

async function loadUsers() {
    // Parallelkan 2 query sekaligus
    const [
        { data: users, error: errUsers },
        { data: access, error: errAccess }
    ] = await Promise.all([
        supabaseClient.from('user_profiles').select('*').order('created_at'),
        supabaseClient.from('user_booth_access').select('*')
    ]);
    
    if (!errUsers && users) allUsers = users;
    if (!errAccess && access) allBoothAccess = access;

    renderUserManagement();
}

function renderUserManagement() {
    const listEl = document.getElementById('user-management-list');
    if (!listEl) return;

    if (allUsers.length === 0) {
        listEl.innerHTML = '<div class="text-sm font-bold text-gray-500">Belum ada data user.</div>';
        return;
    }

    listEl.innerHTML = allUsers.map(u => {
        // Find which booths this user has access to
        const userAccess = allBoothAccess.filter(a => a.user_id === u.id).map(a => a.booth_id);
        
        let boothCheckboxes = '';
        if (u.role === 'pengambilan') {
            const checkboxes = allBooths.map(b => {
                const isChecked = userAccess.includes(b.id) ? 'checked' : '';
                return `
                <label class="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" onchange="toggleUserBoothAccess('${u.id}', ${b.id}, this.checked)" ${isChecked} class="w-4 h-4 text-neoCyan border-2 border-black rounded-none focus:ring-black">
                    <span class="text-xs font-bold">${b.nama_booth}</span>
                </label>
                `;
            }).join('');

            boothCheckboxes = `
                <div class="bg-gray-50 border-2 border-black p-2 mt-2">
                    <div class="text-[10px] font-mono font-bold uppercase mb-1 text-gray-500">Akses Booth (Khusus Pengambilan):</div>
                    <div class="flex flex-wrap gap-3">
                        ${checkboxes}
                    </div>
                </div>
            `;
        }

        return `
        <div class="border-4 border-black p-4 bg-white shadow-[4px_4px_0px_0px_#000] flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
            <div class="flex-1 space-y-2 w-full">
                <div class="text-sm font-mono font-bold bg-neoYellow border-2 border-black px-2 py-1 inline-block mb-1 shadow-[2px_2px_0px_0px_#000]">
                    📧 ${u.email || 'Email tidak tersedia'}
                </div>
                <div class="flex flex-col sm:flex-row gap-2 w-full max-w-lg">
                    <input type="text" id="user-name-${u.id}" value="${u.display_name}" placeholder="Nama Tampilan"
                        class="border-2 border-black px-2 py-1 font-bold focus:outline-none focus:ring-2 focus:ring-neoCyan flex-1">
                    <select id="user-role-${u.id}" 
                        class="border-2 border-black px-2 py-1 font-bold focus:outline-none focus:ring-2 focus:ring-neoCyan sm:w-32 bg-white" onchange="if(this.value !== '${u.role}') showPopup('Info', 'Simpan perubahan untuk menerapkan pengaturan.', false)">
                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                        <option value="foto" ${u.role === 'foto' ? 'selected' : ''}>Foto</option>
                        <option value="pengambilan" ${u.role === 'pengambilan' ? 'selected' : ''}>Pengambilan</option>
                    </select>
                    <button onclick="updateUser('${u.id}')" class="neo-button bg-neoCyan font-bold px-3 py-1 text-xs">Simpan</button>
                    <button onclick="changeUserPassword('${u.id}', '${u.email}')" class="neo-button bg-black text-white font-bold px-3 py-1 text-xs">🔑 Password</button>
                    <button onclick="deleteUser('${u.id}', '${u.email}')" class="neo-button bg-neoRed font-bold px-3 py-1 text-xs text-white">Hapus</button>
                </div>
                ${boothCheckboxes}
            </div>
        </div>
        `;
    }).join('');
}

async function updateUser(userId) {
    const newName = document.getElementById(`user-name-${userId}`).value.trim();
    const newRole = document.getElementById(`user-role-${userId}`).value;

    if (!newName) return showPopup('Error', 'Nama tampilan tidak boleh kosong!', true);

    const { error } = await supabaseClient
        .from('user_profiles')
        .update({ display_name: newName, role: newRole })
        .eq('id', userId);

    if (error) {
        showPopup('Error', 'Gagal update user: ' + error.message, true);
    } else {
        showPopup('Sukses', '✅ User berhasil diupdate!');
        loadUsers();
    }
}

async function changeUserPassword(userId, email) {
    showPrompt(
        'Ubah Password', 
        `Masukkan password baru untuk akun <b>${email}</b> (minimal 6 karakter):`, 
        'Password Baru', 
        'SIMPAN', 
        async (newPassword) => {
            if (!newPassword || newPassword.trim().length < 6) {
                return showPopup('Error', 'Password minimal harus 6 karakter!', true);
            }

            const { error } = await supabaseClient.rpc('update_user_password', {
                target_user_id: userId,
                new_password: newPassword.trim()
            });

            if (error) {
                showPopup('Error', 'Gagal mengubah password: ' + error.message, true);
            } else {
                showPopup('Sukses', `✅ Password untuk ${email} berhasil diubah!`);
            }
        }
    );
}

async function deleteUser(userId, email) {
    showConfirm('Hapus Akun', `Yakin ingin menghapus akun ${email}? Tindakan ini tidak dapat dibatalkan.`, 'HAPUS', async () => {
        const { error } = await supabaseClient.rpc('delete_user_account', { target_user_id: userId });
        if (error) {
            showPopup('Error', 'Gagal menghapus akun: ' + error.message, true);
        } else {
            showPopup('Sukses', '✅ Akun berhasil dihapus!');
            loadUsers();
        }
    });
}

async function toggleUserBoothAccess(userId, boothId, hasAccess) {
    if (hasAccess) {
        // Insert
        const { error } = await supabaseClient
            .from('user_booth_access')
            .insert({ user_id: userId, booth_id: boothId });
        if (error && error.code !== '23505') { // Ignore unique violation
            showPopup('Error', 'Gagal menambah akses: ' + error.message, true);
        }
    } else {
        // Delete
        const { error } = await supabaseClient
            .from('user_booth_access')
            .delete()
            .match({ user_id: userId, booth_id: boothId });
        if (error) {
            showPopup('Error', 'Gagal menghapus akses: ' + error.message, true);
        }
    }
}

async function handleCreateUser(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-user');
    const name = document.getElementById('new-user-name').value.trim();
    const email = document.getElementById('new-user-email').value.trim();
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;

    if (!name || !email || !password || !role) return;

    btn.disabled = true;
    btn.textContent = 'Membuat...';

    const { data, error } = await supabaseClient.rpc('create_new_user', {
        user_email: email,
        user_password: password,
        user_name: name,
        user_role: role
    });

    btn.disabled = false;
    btn.textContent = 'Buat Akun';

    if (error) {
        showPopup('Gagal', 'Tidak dapat membuat akun: ' + error.message, true);
    } else {
        document.getElementById('form-create-user').reset();
        showPopup('Sukses', '✅ Akun baru berhasil dibuat!');
        loadUsers();
    }
}

