// ============================================
// Pengambilan Dashboard Logic
// ============================================

let allBooths = [];
let backgrounds = [];
let allCustomerData = [];
let groupedCustomers = [];
let filteredCustomers = [];
let currentBoothFilter = 'all';
let searchFilter = '';
let statusFilter = 'all'; // all, belum, sudah
let currentUserRole = 'pengambilan';

const systemChannel = supabaseClient.channel('system-events', {
    config: { broadcast: { self: true } }
});

let currentUserId = '';

document.addEventListener('DOMContentLoaded', async () => {
    const authResult = await checkAuthWithRole(['admin', 'pengambilan']);
    if (!authResult) return;
    
    currentUserRole = authResult.profile ? authResult.profile.role : 'pengambilan';
    currentUserId = authResult.user.id;
    
    if (currentUserRole === 'admin') {
        document.getElementById('btn-to-sekretariat').classList.remove('hidden');
    }

    await Promise.all([loadBooths(), loadBackgrounds()]);
    renderBoothSelector();
    await fetchFinishedCustomers();
    subscribeRealtime();
    systemChannel.subscribe();
});

// ============================================
// Data Loading
// ============================================
async function loadBooths() {
    const { data: booths, error } = await supabaseClient.from('booths').select('*').eq('is_active', true).order('nama_booth');
    if (error || !booths) return;
    
    if (currentUserRole === 'pengambilan') {
        const { data: userAccess } = await supabaseClient.from('user_booth_access').select('booth_id').eq('user_id', currentUserId);
        if (userAccess && userAccess.length > 0) {
            const allowedBoothIds = userAccess.map(a => a.booth_id);
            allBooths = booths.filter(b => allowedBoothIds.includes(b.id));
        } else {
            allBooths = [];
        }
    } else {
        allBooths = booths;
    }
}

async function loadBackgrounds() {
    const { data, error } = await supabaseClient.from('backgrounds').select('*').order('id');
    if (!error && data) backgrounds = data;
}

function renderBoothSelector() {
    const selector = document.getElementById('booth-selector');
    if (!selector) return;

    let html = '<option value="all">Semua Booth</option>';
    allBooths.forEach(b => {
        html += `<option value="${b.id}">${b.nama_booth}</option>`;
    });
    selector.innerHTML = html;
}

function switchBooth(boothId) {
    currentBoothFilter = boothId;
    applyFilters();
}

async function fetchFinishedCustomers() {
    const container = document.getElementById('customer-cards');
    if (container && allCustomerData.length === 0) {
        container.innerHTML = Array(6).fill().map(() => `
            <div class="neo-card p-4 border-4 border-black bg-white shadow-[8px_8px_0px_0px_#000]">
                <div class="skeleton w-1/3 h-6 mb-2"></div>
                <div class="skeleton w-1/2 h-8 mb-4"></div>
                <div class="skeleton w-full h-16 mb-4"></div>
                <div class="skeleton w-full h-10"></div>
            </div>
        `).join('');
    }

    // We fetch all queues that are selesai or batal. But to group them, it's easier to fetch all queues
    // and then filter the groups.
    const { data, error } = await supabaseClient
        .from('queues')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching queues:", error);
        return;
    }

    allCustomerData = data;
    processCustomerData();
}

function processCustomerData() {
    const groups = {};

    allCustomerData.forEach(row => {
        if (!groups[row.nomor_antrian]) {
            groups[row.nomor_antrian] = {
                nomor_antrian: row.nomor_antrian,
                created_at: row.created_at,
                booth_id: row.booth_id,
                nama_lengkap: row.nama_lengkap || '-',
                kelas: row.kelas || '-',
                alamat: row.alamat || '-',
                no_wa: row.no_wa || '',
                notes: row.notes || '',
                payment_status: row.payment_status || 'belum_lunas',
                picked_up: false,
                items: [],
                totalPigura: 0
            };
        }
        
        const g = groups[row.nomor_antrian];
        g.totalPigura += (row.pigura || 0);
        if (row.picked_up) g.picked_up = true;
        
        const bg = backgrounds.find(b => b.id === row.background_id);
        const bgName = bg ? bg.nama_background : 'Background ' + row.background_id;

        const existingItem = groups[row.nomor_antrian].items.find(i => i.background_id === row.background_id && i.status === row.status);
        if (existingItem) {
            existingItem.qty += row.jumlah_foto;
        } else {
            groups[row.nomor_antrian].items.push({
                background_id: row.background_id,
                background: bgName,
                qty: row.jumlah_foto,
                status: row.status
            });
        }
    });

    groupedCustomers = Object.values(groups).map(g => {
        // Evaluate if this customer has finished all photos
        const allFinished = g.items.every(item => item.status === STATUS.SELESAI || item.status === STATUS.BATAL);
        g.isFinished = allFinished;
        return g;
    });

    // Keep all customers that have items (Opsi B: Tampilkan Semua)
    groupedCustomers = groupedCustomers.filter(g => g.items.length > 0);
    
    // Sort so newest are top
    groupedCustomers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    applyFilters();
}

// ============================================
// Realtime Updates
// ============================================
function subscribeRealtime() {
    supabaseClient
        .channel('public:queues_pengambilan')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, () => {
            fetchFinishedCustomers();
        })
        .subscribe();
}

// ============================================
// Filtering & Search
// ============================================
document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        searchFilter = e.target.value.toLowerCase();
        applyFilters();
    }, 300);
});

function setFilter(status) {
    statusFilter = status;
    document.getElementById('filter-all').className = status === 'all' ? 'flex-1 md:flex-none bg-black text-white px-4 py-2 font-bold text-xs uppercase border-2 border-black transition-colors' : 'flex-1 md:flex-none bg-white text-black px-4 py-2 font-bold text-xs uppercase border-2 border-black hover:bg-gray-100 transition-colors';
    document.getElementById('filter-belum').className = status === 'belum' ? 'flex-1 md:flex-none bg-black text-white px-4 py-2 font-bold text-xs uppercase border-2 border-black transition-colors' : 'flex-1 md:flex-none bg-white text-black px-4 py-2 font-bold text-xs uppercase border-2 border-black hover:bg-gray-100 transition-colors';
    document.getElementById('filter-sudah').className = status === 'sudah' ? 'flex-1 md:flex-none bg-black text-white px-4 py-2 font-bold text-xs uppercase border-2 border-black transition-colors' : 'flex-1 md:flex-none bg-white text-black px-4 py-2 font-bold text-xs uppercase border-2 border-black hover:bg-gray-100 transition-colors';
    applyFilters();
}

function applyFilters() {
    filteredCustomers = groupedCustomers.filter(c => {
        // Enforce role-based booth access limit
        if (currentUserRole === 'pengambilan') {
            const hasAccess = allBooths.some(b => b.id === c.booth_id);
            if (!hasAccess) return false;
        }

        // Booth Filter
        if (currentBoothFilter !== 'all' && c.booth_id.toString() !== currentBoothFilter.toString()) {
            return false;
        }

        // Search Filter
        if (searchFilter) {
            const term = searchFilter;
            const matchName = c.nama_lengkap.toLowerCase().includes(term);
            const matchNo = c.nomor_antrian.toLowerCase().includes(term);
            const matchKelas = c.kelas.toLowerCase().includes(term);
            const matchAlamat = c.alamat.toLowerCase().includes(term);
            const matchWA = c.no_wa.toLowerCase().includes(term);
            if (!matchName && !matchNo && !matchKelas && !matchAlamat && !matchWA) return false;
        }

        // Status Filter
        if (statusFilter === 'belum' && c.picked_up) return false;
        if (statusFilter === 'sudah' && !c.picked_up) return false;

        return true;
    });

    renderCustomerTable();
    updateStats();
}

function updateStats() {
    const total = filteredCustomers.length;
    const sudah = filteredCustomers.filter(c => c.picked_up).length;
    const belum = total - sudah;

    document.getElementById('stat-total-selesai').textContent = total;
    document.getElementById('stat-belum-diambil').textContent = belum;
    document.getElementById('stat-sudah-diambil').textContent = sudah;
}

// ============================================
// Render Table
// ============================================
function renderCustomerTable() {
    const tbody = document.getElementById('customer-table-body');
    const countEl = document.getElementById('table-count');
    if (!tbody) return;

    countEl.textContent = `${filteredCustomers.length} data`;

    if (filteredCustomers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center font-mono font-bold text-gray-400 uppercase py-8">Tidak ada data ditemukan</td></tr>';
        return;
    }

    tbody.innerHTML = filteredCustomers.map((c, i) => {
        const booth = allBooths.find(b => b.id === c.booth_id);
        
        let rowClass = 'bg-white';
        if (c.picked_up) {
            rowClass = 'bg-neoGreen';
        } else if (c.isFinished) {
            rowClass = 'bg-neoYellow';
        }
        
        const purchaseLines = c.items.map(item => {
            const statusIcon = item.status === STATUS.SELESAI ? '✅' :
                item.status === STATUS.DIPANGGIL ? '📢' :
                    item.status === STATUS.BATAL ? '❌' :
                        item.status === STATUS.DITUNDA ? '⏸️' : '⏳';
            return `${statusIcon} ${item.background} (${item.qty}x)`;
        });
        if (c.totalPigura > 0) purchaseLines.push(`🖼️ Pigura (${c.totalPigura}x)`);

        if (c.picked_up) {
            purchaseLines.push(`<div class="mt-1.5 text-neoGreen font-bold flex items-center gap-1">📦 Sudah Diambil</div>`);
        } else if (c.isFinished) {
            purchaseLines.push(`<div class="mt-1.5 text-neoRed font-black flex items-center gap-1">📦 Siap Diambil!</div>`);
        } else {
            purchaseLines.push(`<div class="mt-1.5 text-gray-500 font-mono text-[10px] font-bold flex items-center gap-1">⏳ Masih Proses Foto...</div>`);
        }

        return `
        <tr class="table-row border-b-2 border-black/20 ${rowClass}">
            <td class="p-3 font-mono font-bold text-sm text-center">${i + 1}</td>
            <td class="p-3">
                <div class="font-black text-lg tracking-tight">${c.nomor_antrian}</div>
                <div class="font-mono text-[10px] text-gray-500">${formatTime(c.created_at)}</div>
            </td>
            <td class="p-3">
                <span class="font-mono text-xs font-bold bg-bgLight border-2 border-black px-2 py-0.5">${booth?.nama_booth || '-'}</span>
            </td>
            <td class="p-3 font-bold uppercase text-sm">${c.nama_lengkap}</td>
            <td class="p-3 font-mono font-bold text-sm">${c.kelas}</td>
            <td class="p-3 font-bold text-xs uppercase">${c.alamat}</td>
            <td class="p-3">
                ${c.no_wa ? `
                <div class="flex flex-col gap-1 items-start">
                    <span class="font-mono font-bold text-xs">${c.no_wa}</span>
                    <a href="https://wa.me/${c.no_wa.startsWith('0') ? '62' + c.no_wa.substring(1) : c.no_wa}" target="_blank" class="inline-block text-[10px] bg-[#25D366] border-2 border-black text-white px-2 py-0.5 shadow-[2px_2px_0px_0px_#000] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_#000] transition-all">
                        <span class="font-mono font-bold">💬 Kirim WA</span>
                    </a>
                </div>
                ` : '<span class="font-mono text-xs text-gray-400 font-bold">-</span>'}
            </td>
            <td class="p-3">
                <div class="text-xs font-bold space-y-0.5">${purchaseLines.map(l => `<div>${l}</div>`).join('')}</div>
            </td>
            <td class="p-3 text-center">
                <button onclick="togglePickup('${c.nomor_antrian}', ${c.picked_up})"
                    class="btn-pickup inline-block px-3 py-2 font-black text-xs uppercase border-3 border-black shadow-[2px_2px_0px_0px_#000] ${c.picked_up ? 'bg-white' : 'bg-neoGreen'} w-full">
                    ${c.picked_up ? 'Batalkan' : '✓ Ambil'}
                </button>
            </td>
        </tr>`;
    }).join('');
}

// ============================================
// Toggle Pickup Status
// ============================================
async function togglePickup(nomorAntrian, isPickedUp) {
    const newStatus = !isPickedUp;

    // Update ALL rows for this customer to have picked_up = newStatus
    const { error } = await supabaseClient
        .from('queues')
        .update({ picked_up: newStatus })
        .eq('nomor_antrian', nomorAntrian);

    if (error) {
        showPopup('Error', 'Gagal update status: ' + error.message, true);
        return;
    }

    // Local state is updated via Realtime Subscription automatically!
}
