// ============================================
// Customer Page Logic — AntriPhotobooth
// ============================================

let backgrounds = [];
let bgQuantities = {};
let piguraQty = 0;

let myQueueId = null;
let myTicketStatuses = {};
let realtimeChannel = null;
let allWaitingQueues = [];
let notifiedStates = {};

// ============================================
// Service Worker Registration
// ============================================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
        console.log('Service Worker terdaftar untuk Notifikasi HP');
    }).catch(e => console.error(e));
}

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    requestNotificationPermission();
    await loadBackgrounds();

    const savedQueueId = localStorage.getItem('myQueueId');
    if (savedQueueId) {
        await restoreQueue(savedQueueId);
    }
});

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

// ============================================
// System Channel (Admin commands)
// ============================================
let systemChannel;
function initSystemChannel() {
    systemChannel = supabaseClient.channel('system-events');

    systemChannel.on('broadcast', { event: 'clear_cache' }, (payload) => {
        if (payload.payload.action === 'wipe') {
            localStorage.removeItem('myQueueId');
            localStorage.removeItem('myPiguraQty');
            location.reload();
        }
    });

    systemChannel.on('broadcast', { event: 'update_prefix' }, (payload) => {
        const newPrefix = payload.payload.prefix;
        applyPrefix(newPrefix);
    });

    systemChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            setTimeout(() => {
                systemChannel.send({
                    type: 'broadcast',
                    event: 'request_prefix',
                    payload: {}
                });
            }, 1000);
        }
    });

    // Also subscribe to database changes on settings table for real-time prefix sync
    supabaseClient.channel('settings-sync')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'settings' }, (payload) => {
            if (payload.new && payload.new.key === 'ticket_prefix') {
                applyPrefix(payload.new.value);
            }
        })
        .subscribe();
}

function applyPrefix(newPrefix) {
    if (!newPrefix) return;
    localStorage.setItem('customerTicketPrefix', newPrefix);

    const indicator = document.getElementById('prefix-indicator');
    if (indicator) indicator.textContent = 'KODE: ' + newPrefix;

    const inputLacak = document.getElementById('input-lacak');
    if (inputLacak) inputLacak.placeholder = newPrefix + '-...';
}

// Load prefix from database (source of truth), then initialize channel
async function loadPrefixFromDB() {
    try {
        const { data, error } = await supabaseClient
            .from('settings')
            .select('value')
            .eq('key', 'ticket_prefix')
            .single();
        if (!error && data) {
            applyPrefix(data.value);
        }
    } catch (e) {
        console.error('Failed to load prefix from DB:', e);
    }
}

// Initialize: load from DB first, then start channel for live updates
loadPrefixFromDB();
initSystemChannel();

// ============================================
// Background Loading & Selection
// ============================================
async function loadBackgrounds() {
    try {
        const { data, error } = await supabaseClient
            .from('backgrounds')
            .select('*')
            .order('id');

        const listEl = document.getElementById('bg-list');
        document.getElementById('loading-bgs').classList.add('hidden');

        if (error) {
            listEl.innerHTML = `<p class="bg-neoPink border-2 border-black p-4 font-bold text-center uppercase">Gagal memuat: ${error.message}</p>`;
            return;
        }

        backgrounds = data;
        backgrounds.forEach(bg => { bgQuantities[bg.id] = 0; });

        const colors = ['hover:bg-neoPink', 'hover:bg-neoYellow', 'hover:bg-neoCyan', 'hover:bg-neoGreen'];
        listEl.innerHTML = backgrounds.map((bg, idx) => {
            const color = colors[idx % colors.length];
            return `
            <div class="bg-white ${color} border-2 border-black p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all">
                <div class="text-center md:text-left flex-1">
                    <h3 class="text-xl font-black uppercase tracking-tight">${bg.nama_background}</h3>
                    <p class="font-mono text-xs font-bold text-gray-600 mt-1">${formatCurrency(HARGA_PER_FOTO)} / foto</p>
                </div>
                <div class="flex items-center bg-white border-2 border-black rounded-full overflow-hidden shrink-0">
                    <button onclick="changeQty(${bg.id}, -1)" class="w-12 h-10 bg-white hover:bg-gray-200 font-black text-xl flex items-center justify-center transition-colors border-r-2 border-black">-</button>
                    <span id="qty-${bg.id}" class="font-mono font-black text-lg w-10 text-center flex items-center justify-center bg-white h-10">0</span>
                    <button onclick="changeQty(${bg.id}, 1)" class="w-12 h-10 bg-white hover:bg-gray-200 font-black text-xl flex items-center justify-center transition-colors border-l-2 border-black">+</button>
                </div>
            </div>
            `;
        }).join('');

        // Tambahkan opsi pigura dan area total harga
        listEl.insertAdjacentHTML('afterend', `
            <div class="flex items-center gap-4 my-8">
                <div class="h-1 flex-1 bg-black"></div>
                <div class="font-mono text-xs font-bold uppercase bg-black text-white px-3 py-1 tracking-widest shadow-[2px_2px_0px_0px_#67e8f9]">TAMBAHAN</div>
                <div class="h-1 flex-1 bg-black"></div>
            </div>

            <div class="bg-white hover:bg-neoGreen border-2 border-black p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all">
                <div class="text-center md:text-left flex-1">
                    <h3 class="text-xl font-black uppercase tracking-tight">Pigura</h3>
                    <p class="font-mono text-xs font-bold text-gray-600 mt-1">${formatCurrency(HARGA_PIGURA)} / pcs</p>
                </div>
                <div class="flex items-center bg-white border-2 border-black rounded-full overflow-hidden shrink-0">
                    <button onclick="changePiguraQty(-1)" class="w-12 h-10 bg-white hover:bg-gray-200 font-black text-xl flex items-center justify-center transition-colors border-r-2 border-black">-</button>
                    <span id="qty-pigura" class="font-mono font-black text-lg w-10 text-center flex items-center justify-center bg-white h-10">0</span>
                    <button onclick="changePiguraQty(1)" class="w-12 h-10 bg-white hover:bg-gray-200 font-black text-xl flex items-center justify-center transition-colors border-l-2 border-black">+</button>
                </div>
            </div>

            <div id="total-price-box" class="mt-6 p-4 bg-neoYellow border-4 border-black shadow-[4px_4px_0px_0px_#000] text-center hidden">
                <div class="font-mono text-xs font-bold uppercase tracking-widest mb-1">Total Pembayaran</div>
                <div id="total-price" class="text-3xl font-black tracking-tight">Rp 0</div>
                <div id="total-qty-info" class="font-mono text-xs font-bold mt-1 text-gray-700"></div>
            </div>
        `);
    } catch (e) {
        console.error('loadBackgrounds error:', e);
    }
}

// ============================================
// Quantity Management
// ============================================
function changeQty(bgId, delta) {
    bgQuantities[bgId] += delta;
    if (bgQuantities[bgId] < 0) bgQuantities[bgId] = 0;
    if (bgQuantities[bgId] > 10) bgQuantities[bgId] = 10;
    document.getElementById(`qty-${bgId}`).textContent = bgQuantities[bgId];
    updateTotalPrice();
}

function changePiguraQty(delta) {
    piguraQty += delta;
    if (piguraQty < 0) piguraQty = 0;
    if (piguraQty > 20) piguraQty = 20;
    document.getElementById('qty-pigura').textContent = piguraQty;
    updateTotalPrice();
}

function updateTotalPrice() {
    const totalFoto = Object.values(bgQuantities).reduce((sum, qty) => sum + qty, 0);
    const hargaFoto = totalFoto * HARGA_PER_FOTO;
    const hargaPigura = piguraQty * HARGA_PIGURA;
    const totalHarga = hargaFoto + hargaPigura;
    const priceBox = document.getElementById('total-price-box');
    if (priceBox) {
        if (totalFoto > 0 || piguraQty > 0) {
            priceBox.classList.remove('hidden');
            document.getElementById('total-price').textContent = formatCurrency(totalHarga);
            let info = [];
            if (totalFoto > 0) info.push(totalFoto + ' foto');
            if (piguraQty > 0) info.push(piguraQty + ' pigura');
            document.getElementById('total-qty-info').textContent = info.join(' + ');
        } else {
            priceBox.classList.add('hidden');
        }
    }
}

// ============================================
// Submit Queue
// ============================================
async function submitQueue() {
    const nama = sanitizeInput(document.getElementById('input-nama').value, 100);
    const kelas = sanitizeInput(document.getElementById('input-kelas').value, 50);
    const alamat = sanitizeInput(document.getElementById('input-alamat').value, 200);

    if (!nama || !kelas) {
        return showPopup("Data Belum Lengkap", "Harap isi <b>Nama</b> dan <b>Kelas/Asal</b> Anda sebelum mengambil tiket.");
    }

    const selectedBgs = backgrounds.filter(bg => bgQuantities[bg.id] > 0);

    if (selectedBgs.length === 0) {
        return showPopup("Pilih Background", "Anda harus memilih minimal <b>satu background photobooth</b>!");
    }

    document.getElementById('selection-section').classList.add('hidden');
    document.getElementById('ticket-section').classList.remove('hidden');
    document.getElementById('ticket-user-info').textContent = `${nama} - ${kelas} - ${alamat}`;
    document.getElementById('ticket-number').textContent = '...';
    document.getElementById('ticket-items').innerHTML = '<div class="text-center font-bold">Mendaftarkan ke server...</div>';

    try {
        const { data: existingTickets, error: countError } = await supabaseClient
            .from('queues')
            .select('nomor_antrian')
            .neq('status', STATUS.BATAL);

        if (countError) throw countError;

        const prefix = localStorage.getItem('customerTicketPrefix') || 'PB';

        const uniqueNumbers = new Set(
            (existingTickets || [])
                .filter(t => t.nomor_antrian.startsWith(prefix + '-'))
                .map(t => t.nomor_antrian)
        );
        const nextNum = uniqueNumbers.size + 1;
        const myQueueNumber = prefix + '-' + String(nextNum).padStart(3, '0');

        myQueueId = myQueueNumber;

        const rowsToInsert = selectedBgs.map((bg, idx) => ({
            nomor_antrian: myQueueId,
            background_id: bg.id,
            status: STATUS.MENUNGGU,
            nama_lengkap: nama,
            kelas: kelas,
            alamat: alamat,
            jumlah_foto: bgQuantities[bg.id],
            pigura: idx === 0 ? piguraQty : 0
        }));

        const { data: insertedData, error: insertError } = await supabaseClient
            .from('queues')
            .insert(rowsToInsert)
            .select();

        if (insertError) throw insertError;

        document.getElementById('ticket-number').textContent = myQueueId;

        localStorage.setItem('myQueueId', myQueueId);
        localStorage.setItem('myPiguraQty', piguraQty);

        myTicketStatuses = {};
        insertedData.forEach(row => {
            const bgName = selectedBgs.find(b => b.id === row.background_id).nama_background;
            myTicketStatuses[row.background_id] = {
                id: row.id,
                created_at: row.created_at,
                name: bgName,
                qty: row.jumlah_foto,
                status: row.status
            };
        });

        await fetchWaitingQueues();
        renderTicketStatuses();
        updateTicketPrice();
        subscribeMyTicket();

    } catch (err) {
        console.error(err);
        showPopup("Kesalahan Sistem", "Terjadi kesalahan: " + err.message);
        resetApp();
    }
}

// ============================================
// Ticket Display & Status
// ============================================
function updateTicketPrice() {
    const totalFoto = Object.values(myTicketStatuses).reduce((sum, item) => sum + (item.qty || 0), 0);
    const savedPigura = parseInt(localStorage.getItem('myPiguraQty') || '0');
    const hargaFoto = totalFoto * HARGA_PER_FOTO;
    const hargaPigura = savedPigura * HARGA_PIGURA;
    const totalHarga = hargaFoto + hargaPigura;
    const priceEl = document.getElementById('ticket-total-price');
    const qtyEl = document.getElementById('ticket-total-qty');
    if (priceEl) priceEl.textContent = formatCurrency(totalHarga);
    if (qtyEl) {
        let info = [];
        if (totalFoto > 0) info.push(totalFoto + ' foto');
        if (savedPigura > 0) info.push(savedPigura + ' pigura');
        qtyEl.textContent = info.join(' + ');
    }
}

function renderTicketStatuses() {
    const container = document.getElementById('ticket-items');
    let isAnyCalled = false;

    const html = Object.keys(myTicketStatuses).map(bgId => {
        const item = myTicketStatuses[bgId];
        if (!notifiedStates[item.id]) notifiedStates[item.id] = {};

        let statusBadge = '';
        let bgClass = 'bg-white';
        let positionInfo = '';

        if (item.status === STATUS.DIPANGGIL) {
            statusBadge = '<span class="bg-neoYellow border-2 border-black px-2 py-1 shadow-[2px_2px_0px_0px_#000]">SILAKAN MASUK!</span>';
            bgClass = 'bg-neoYellow';
            isAnyCalled = true;

            if (!notifiedStates[item.id].called) {
                showNotification("Giliran Anda!", `Waktunya menuju ${item.name} sekarang!`);
                notifiedStates[item.id].called = true;
            }
        } else if (item.status === STATUS.DITUNDA) {
            statusBadge = '<span class="bg-neoPink text-black border-2 border-black px-2 py-1 font-black">DITUNDA | HARAP HUBUNGI PETUGAS</span>';
            bgClass = 'bg-neoPink bg-opacity-30';
        } else if (item.status === STATUS.SELESAI || item.status === STATUS.BATAL) {
            statusBadge = '<span class="bg-gray-300 border-2 border-black px-2 py-1">SELESAI</span>';
            bgClass = 'bg-gray-200 opacity-60';
        } else {
            statusBadge = '<span class="bg-white border-2 border-black px-2 py-1">MENUNGGU</span>';

            const aheadCount = allWaitingQueues.filter(q =>
                q.background_id == bgId &&
                new Date(q.created_at) < new Date(item.created_at)
            ).length;

            positionInfo = `<div class="mt-3 font-mono font-bold text-xs bg-black text-white inline-block px-2 py-1 shadow-[2px_2px_0px_0px_#000] max-w-full break-words whitespace-normal">Di depan Anda: ${aheadCount} orang</div>`;

            if (aheadCount === 3 && !notifiedStates[item.id].three) {
                showNotification("Bersiap-siap!", `Sisa 3 antrian lagi di depan Anda untuk ${item.name}.`);
                notifiedStates[item.id].three = true;
            }
            if (aheadCount === 1 && !notifiedStates[item.id].one) {
                showNotification("Hampir tiba!", `Sisa 1 antrian lagi! Segera mendekat ke ${item.name}.`);
                notifiedStates[item.id].one = true;
            }
        }

        return `
        <div class="border-2 border-black p-4 flex flex-col space-y-3 ${bgClass} shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            <div class="flex flex-wrap justify-between items-center font-black uppercase text-lg leading-tight gap-2">
                <div class="flex items-center flex-wrap gap-2 w-full">${item.name} <span class="text-xs font-mono font-bold bg-white border border-black text-black px-1.5 rounded-sm whitespace-nowrap">${item.qty}x</span></div>
            </div>
            <div class="font-bold text-xs tracking-widest">
                ${statusBadge}
            </div>
            ${positionInfo}
        </div>
        `;
    }).join('');

    container.innerHTML = html;

    const cardEl = document.getElementById('ticket-card');
    if (isAnyCalled) cardEl.classList.add('called-state');
    else cardEl.classList.remove('called-state');
}

// ============================================
// Realtime & Waiting Queue
// ============================================
async function fetchWaitingQueues() {
    const { data } = await supabaseClient
        .from('queues')
        .select('id, background_id, created_at, status')
        .eq('status', STATUS.MENUNGGU);
    allWaitingQueues = data || [];
}

function subscribeMyTicket() {
    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabaseClient.channel(`customer-all`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, async payload => {
            const newRow = payload.new || payload.old;

            if (newRow && newRow.nomor_antrian === myQueueId) {
                if (myTicketStatuses[newRow.background_id]) {
                    myTicketStatuses[newRow.background_id].status = newRow.status;
                }
            }

            await fetchWaitingQueues();
            renderTicketStatuses();
        })
        .subscribe();
}

// ============================================
// Notifications
// ============================================
async function showNotification(title, body) {
    // Vibrate
    if ('vibrate' in navigator) {
        navigator.vibrate([500, 200, 500, 200, 1000]);
    }

    // OS Notification
    if ('Notification' in window && Notification.permission === 'granted') {
        const logoUrl = new URL('logo-mm.png', self.location.origin + self.location.pathname.replace(/\/[^/]*$/, '/')).href;
        try {
            const reg = await navigator.serviceWorker.ready;
            reg.showNotification(title, {
                body: body,
                icon: logoUrl,
                badge: logoUrl,
                vibrate: [500, 200, 500, 200, 1000],
                requireInteraction: true
            });
        } catch (e) {
            new Notification(title, { body: body });
        }
    }

    // In-app toast
    showToast(title, body);

    // Sound
    try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.volume = 0.5;
        audio.play();
    } catch (e) { }
}

// ============================================
// Download Ticket Image
// ============================================
async function downloadTicketImage() {
    const ticketCard = document.getElementById('ticket-card');
    if (!ticketCard) return;

    const btn = event.target.closest('button');
    const origText = btn.innerHTML;
    btn.innerHTML = '\u23f3 MENYIMPAN...';
    btn.disabled = true;

    try {
        const canvas = await html2canvas(ticketCard, {
            backgroundColor: '#ffffff',
            scale: 3,
            useCORS: true,
            allowTaint: true,
            logging: false
        });

        const link = document.createElement('a');
        link.download = `Tiket-${myQueueId || 'Photobooth'}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        showPopup("Berhasil", "\ud83d\udcf7 Tiket berhasil diunduh sebagai gambar!");
    } catch (e) {
        console.error(e);
        showPopup("Error", "Gagal menyimpan tiket: " + e.message);
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
}

// ============================================
// App Reset & Restore
// ============================================
function resetApp() {
    localStorage.removeItem('myQueueId');
    localStorage.removeItem('myPiguraQty');

    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
    }
    myQueueId = null;
    piguraQty = 0;
    document.getElementById('selection-section').classList.remove('hidden');
    document.getElementById('ticket-section').classList.add('hidden');

    // Reset form
    document.getElementById('input-nama').value = '';
    document.getElementById('input-kelas').value = '';
    document.getElementById('input-alamat').value = '';
    document.getElementById('input-lacak').value = '';
    if (document.getElementById('qty-pigura')) document.getElementById('qty-pigura').textContent = '0';

    // Reset quantities
    Object.keys(bgQuantities).forEach(id => {
        bgQuantities[id] = 0;
        if (document.getElementById(`qty-${id}`)) {
            document.getElementById(`qty-${id}`).textContent = '0';
        }
    });
}

async function restoreQueue(queueId) {
    document.getElementById('selection-section').classList.add('hidden');
    document.getElementById('ticket-section').classList.remove('hidden');
    document.getElementById('ticket-items').innerHTML = '<div class="text-center font-bold">Memulihkan tiket Anda...</div>';

    const { data, error } = await supabaseClient
        .from('queues')
        .select('*, backgrounds(nama_background)')
        .eq('nomor_antrian', queueId)
        .in('status', ACTIVE_STATUSES);

    if (error || !data || data.length === 0) {
        showPopup("Tiket Kadaluarsa", `Antrian <b>${queueId}</b> tidak ditemukan, dibatalkan, atau sudah selesai.`);
        resetApp();
        return;
    }

    myQueueId = queueId;
    localStorage.setItem('myQueueId', myQueueId);

    myTicketStatuses = {};
    data.forEach(row => {
        myTicketStatuses[row.background_id] = {
            id: row.id,
            created_at: row.created_at,
            name: row.backgrounds.nama_background,
            qty: row.jumlah_foto,
            status: row.status
        };
    });

    const nama = data[0].nama_lengkap || '';
    const kelas = data[0].kelas || '';
    const alamat = data[0].alamat || '';
    document.getElementById('ticket-user-info').textContent = `${nama} - ${kelas} - ${alamat}`;
    document.getElementById('ticket-number').textContent = myQueueId;

    await fetchWaitingQueues();
    renderTicketStatuses();
    updateTicketPrice();
    subscribeMyTicket();
}

// ============================================
// Track Ticket
// ============================================
async function lacakTiket() {
    const input = document.getElementById('input-lacak').value.trim();
    if (input.length < 3) {
        showPopup("Terlalu Pendek", "Masukkan minimal <b>3 huruf/angka</b> untuk melacak.");
        return;
    }

    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    btn.innerHTML = '...';
    btn.disabled = true;

    let query = supabaseClient
        .from('queues')
        .select('nomor_antrian, nama_lengkap, kelas')
        .in('status', ACTIVE_STATUSES);

    const currentPrefixVal = localStorage.getItem('customerTicketPrefix') || 'PB';
    if (input.toUpperCase().startsWith(currentPrefixVal + '-')) {
        query = query.eq('nomor_antrian', input.toUpperCase());
    } else {
        query = query.ilike('nama_lengkap', `%${input}%`);
    }

    const { data, error } = await query;

    btn.innerHTML = originalText;
    btn.disabled = false;

    if (error || !data || data.length === 0) {
        showPopup("Tidak Ditemukan", "Antrian tidak ditemukan. Pastikan ejaan nama benar dan antrian Anda belum diproses sampai selesai.");
        return;
    }

    // Group by nomor_antrian
    const uniqueTickets = [];
    const seen = new Set();
    data.forEach(r => {
        if (!seen.has(r.nomor_antrian)) {
            seen.add(r.nomor_antrian);
            uniqueTickets.push(r);
        }
    });

    if (uniqueTickets.length > 1) {
        let html = "<p class='mb-2'>Ditemukan beberapa tiket aktif:</p><div class='space-y-3 mt-3 max-h-48 overflow-y-auto pr-2'>";
        uniqueTickets.forEach(t => {
            html += `
                <div class="bg-bgLight border-2 border-black p-2 shadow-[2px_2px_0px_0px_#000]">
                    <span class="font-black bg-neoYellow px-2 border-2 border-black inline-block mb-1">${t.nomor_antrian}</span>
                    <div class="leading-tight uppercase font-black">${t.nama_lengkap}</div>
                    <div class="font-mono text-xs uppercase">${t.kelas}</div>
                </div>
            `;
        });
        html += "</div><p class='mt-4 text-xs font-mono bg-neoPink p-2 border-2 border-black'>Copy/Ketik <b>Nomor Tiket</b> di atas untuk melacak secara spesifik.</p>";
        showPopup("Pilih Tiket Anda", html);
        return;
    }

    restoreQueue(uniqueTickets[0].nomor_antrian);
}

// Customer-specific popup (with random color)
function showPopup(title, bodyHTML) {
    const colors = ['bg-neoYellow', 'bg-neoPink', 'bg-neoCyan', 'bg-neoGreen'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const titleEl = document.getElementById('popup-title');
    titleEl.textContent = title;
    titleEl.className = `text-xl font-black uppercase tracking-tight border-b-4 border-black pb-1 mb-4 inline-block pr-4 ${randomColor}`;

    document.getElementById('popup-body').innerHTML = bodyHTML;
    const popup = document.getElementById('custom-popup');
    const content = document.getElementById('popup-content');

    popup.classList.remove('hidden');
    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });
}

function closePopup() {
    const popup = document.getElementById('custom-popup');
    const content = document.getElementById('popup-content');

    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        popup.classList.add('hidden');
    }, 300);
}
