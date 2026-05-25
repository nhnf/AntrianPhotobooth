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
let isEditMode = false;
let originalQueueId = null;

// Multi-Booth state
let currentBoothId = null;   // integer, dari URL ?booth=ID
let currentBoothInfo = null; // { id, nama_booth, ticket_prefix }

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

    // Muat info booth dari URL
    currentBoothId = getBoothIdFromURL();
    if (currentBoothId) {
        currentBoothInfo = await loadBoothInfo(currentBoothId);
        if (!currentBoothInfo) {
            showPopup('Booth Tidak Ditemukan', 'URL booth tidak valid atau booth tidak aktif. Hubungi petugas.');
            return;
        }
        // Tampilkan nama booth di halaman
        applyBoothUI(currentBoothInfo);
    }

    await loadBackgrounds();

    // Cek apakah ada tiket tersimpan untuk booth ini
    const savedKey = 'myQueueId_booth_' + (currentBoothId || 'default');
    const savedQueueId = localStorage.getItem(savedKey) || localStorage.getItem('myQueueId');
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
// Booth UI
// ============================================
function applyBoothUI(booth) {
    if (!booth) return;
    // Update prefix indicator
    const indicator = document.getElementById('prefix-indicator');
    if (indicator) indicator.textContent = 'KODE: ' + booth.ticket_prefix;

    // Update placeholder lacak
    const inputLacak = document.getElementById('input-lacak');
    if (inputLacak) inputLacak.placeholder = booth.ticket_prefix + '-...';

    // Update nama booth di header
    const boothNameEl = document.getElementById('booth-name');
    if (boothNameEl) boothNameEl.textContent = booth.nama_booth;

    // Update title halaman
    document.title = booth.nama_booth + ' - Antrian Photobooth';
    
    // Update booth status alert
    updateBoothStatusAlert(booth);
}

// ============================================
// Booth Status & Quota Display
// ============================================

let countdownInterval = null;

function updateBoothStatusAlert(booth) {
    const overlay = document.getElementById('booth-status-overlay');
    const overlayContent = document.getElementById('booth-status-overlay-content');
    const quotaAlert = document.getElementById('quota-alert');
    const quotaContent = document.getElementById('quota-alert-content');
    
    if (!booth || !overlay || !overlayContent || !quotaAlert || !quotaContent) return;
    
    // Clear existing countdown
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    
    // Check sales time
    const now = new Date();
    const salesStart = booth.sales_start_datetime ? new Date(booth.sales_start_datetime) : null;
    
    if (salesStart && now < salesStart) {
        // BELUM DIBUKA - Tampilkan sebagai OVERLAY yang menutupi form
        const countdownEl = document.createElement('div');
        countdownEl.id = 'countdown-display';
        countdownEl.className = 'font-mono text-4xl font-black mt-4 mb-2';
        
        const updateCountdown = () => {
            const now = new Date();
            const diff = salesStart - now;
            
            if (diff <= 0) {
                clearInterval(countdownInterval);
                countdownInterval = null;
                // Reload booth info
                loadBoothInfo(currentBoothId).then(info => {
                    if (info) {
                        currentBoothInfo = info;
                        updateBoothStatusAlert(info);
                    }
                });
                return;
            }
            
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            
            let countdownText = '';
            if (days > 0) countdownText += `${days} hari `;
            countdownText += `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            
            countdownEl.textContent = countdownText;
        };
        
        overlayContent.innerHTML = `
            <div class="text-2xl font-black uppercase mb-2">PHOTOBOOTH<br>BELUM DIBUKA</div>
            <div class="text-sm font-bold mb-4">Buka: ${salesStart.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}</div>
        `;
        overlayContent.appendChild(countdownEl);
        
        updateCountdown();
        countdownInterval = setInterval(updateCountdown, 1000);
        
        overlay.classList.remove('hidden');
        quotaAlert.classList.add('hidden');
        
    } else {
        // SUDAH DIBUKA - Sembunyikan overlay
        overlay.classList.add('hidden');
        
        // Check quota - tampilkan sebagai alert biasa di dalam form
        if (booth.max_capacity !== null && booth.max_capacity !== undefined) {
            const currentCount = booth.current_ticket_count || 0;
            const remaining = booth.max_capacity - currentCount;
            const percentage = (currentCount / booth.max_capacity) * 100;
            
            let bgColor = 'bg-neoGreen';
            let message = '';
            
            if (remaining <= 0) {
                bgColor = 'bg-neoPink';
                message = `🎫 <b>KUOTA HABIS!</b> Tiket terjual: <b>${currentCount}/${booth.max_capacity}</b>`;
            } else if (percentage >= 80) {
                bgColor = 'bg-neoYellow';
                message = `🎫 <b>HAMPIR HABIS!</b> Sisa kuota: <b>${remaining}/${booth.max_capacity}</b> tiket`;
            } else {
                message = `🎫 Sisa kuota: <b>${remaining}/${booth.max_capacity}</b> tiket`;
            }
            
            quotaContent.innerHTML = message;
            quotaAlert.className = `mx-6 mt-6 mb-4 p-4 border-4 border-black shadow-[4px_4px_0px_0px_#000] text-center ${bgColor}`;
            quotaAlert.classList.remove('hidden');
        } else {
            quotaAlert.classList.add('hidden');
        }
    }
}

// ============================================
// Booth Access Validation
// ============================================

async function validateBoothAccess(boothId) {
    const booth = await loadBoothInfo(boothId);
    if (!booth) {
        return { allowed: false, message: 'Booth tidak ditemukan atau tidak aktif.' };
    }
    
    // Update current booth info
    currentBoothInfo = booth;
    
    // Check sales time
    const now = new Date();
    const salesStart = booth.sales_start_datetime ? new Date(booth.sales_start_datetime) : null;
    
    if (salesStart && now < salesStart) {
        const timeStr = salesStart.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' });
        return { 
            allowed: false, 
            message: `⏰ <b>Penjualan tiket belum dibuka.</b><br><br>Silakan kembali pada:<br><b>${timeStr}</b><br><br>Lihat countdown di atas untuk waktu tersisa.` 
        };
    }
    
    // Check quota
    if (booth.max_capacity !== null && booth.max_capacity !== undefined) {
        const currentCount = booth.current_ticket_count || 0;
        if (currentCount >= booth.max_capacity) {
            return { 
                allowed: false, 
                message: `🎫 <b>Maaf, kuota tiket sudah HABIS!</b><br><br>Tiket terjual: <b>${currentCount}/${booth.max_capacity}</b><br><br>Hubungi panitia untuk informasi lebih lanjut.` 
            };
        }
    }
    
    return { allowed: true };
}

// ============================================
// System Channel (Admin commands — clear cache)
// ============================================
let systemChannel;
function initSystemChannel() {
    systemChannel = supabaseClient.channel('system-events');

    systemChannel.on('broadcast', { event: 'clear_cache' }, (payload) => {
        if (payload.payload.action === 'wipe') {
            const savedKey = 'myQueueId_booth_' + (currentBoothId || 'default');
            localStorage.removeItem(savedKey);
            localStorage.removeItem('myQueueId');
            localStorage.removeItem('myPiguraQty');
            location.reload();
        }
    });

    // Listen perubahan booth prefix secara realtime
    if (currentBoothId) {
        supabaseClient.channel('booth-sync-' + currentBoothId)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'booths',
                filter: 'id=eq.' + currentBoothId }, async (payload) => {
                // Reload info booth jika prefix/nama/quota berubah
                currentBoothInfo = payload.new;
                if (currentBoothInfo) {
                    applyBoothUI(currentBoothInfo);
                }
            })
            .subscribe();
    }

    systemChannel.subscribe();
}

// Initialize system channel
initSystemChannel();

// ============================================
// Background Loading & Selection
// ============================================
async function loadBoothInfo(boothId) {
    if (!boothId) return null;
    const { data, error } = await supabaseClient
        .from('booths')
        .select('id, nama_booth, ticket_prefix, sales_start_datetime, max_capacity, current_ticket_count')
        .eq('id', boothId)
        .eq('is_active', true)
        .single();
    if (error || !data) return null;
    return data;
}

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
            const imgPath = `assets/bg${idx + 1}.jpeg`;
            return `
            <div class="bg-white ${color} border-2 border-black p-2 sm:p-3 flex flex-row items-center gap-2 sm:gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 transition-all">
                <div class="w-14 h-14 sm:w-20 sm:h-20 shrink-0 border-2 border-black bg-gray-200 overflow-hidden cursor-pointer hover:opacity-80 transition-opacity" onclick="openPreview('${imgPath}', '${bg.nama_background}')" title="Klik untuk perbesar">
                    <img src="${imgPath}" alt="${bg.nama_background}" class="w-full h-full object-cover" onerror="this.parentElement.style.display='none'">
                </div>
                <div class="text-left flex-1 min-w-0">
                    <h3 class="text-sm sm:text-lg font-black uppercase tracking-tight leading-tight">${bg.nama_background}</h3>
                    <p class="font-mono text-[10px] sm:text-xs font-bold text-gray-800 mt-0.5 sm:mt-1 whitespace-nowrap">${formatCurrency(HARGA_PER_FOTO)}/ft</p>
                </div>
                <div class="flex items-center bg-white border-2 border-black rounded-full overflow-hidden shrink-0">
                    <button onclick="changeQty(${bg.id}, -1)" class="w-8 h-8 sm:w-10 sm:h-10 bg-white hover:bg-gray-200 font-black text-lg sm:text-xl flex items-center justify-center transition-colors border-r-2 border-black">-</button>
                    <span id="qty-${bg.id}" class="font-mono font-black text-sm sm:text-lg w-6 sm:w-10 text-center flex items-center justify-center bg-white h-8 sm:h-10">0</span>
                    <button onclick="changeQty(${bg.id}, 1)" class="w-8 h-8 sm:w-10 sm:h-10 bg-white hover:bg-gray-200 font-black text-lg sm:text-xl flex items-center justify-center transition-colors border-l-2 border-black">+</button>
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

            <div class="bg-white hover:bg-neoGreen border-2 border-black p-3 sm:p-4 flex flex-row items-center gap-2 sm:gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 transition-all">
                <div class="text-left flex-1 min-w-0">
                    <h3 class="text-sm sm:text-xl font-black uppercase tracking-tight">Pigura</h3>
                    <p class="font-mono text-[10px] sm:text-xs font-bold text-gray-600 mt-0.5 sm:mt-1 whitespace-nowrap">${formatCurrency(HARGA_PIGURA)} / pcs</p>
                </div>
                <div class="flex items-center bg-white border-2 border-black rounded-full overflow-hidden shrink-0">
                    <button onclick="changePiguraQty(-1)" class="w-8 h-8 sm:w-12 sm:h-10 bg-white hover:bg-gray-200 font-black text-lg sm:text-xl flex items-center justify-center transition-colors border-r-2 border-black">-</button>
                    <span id="qty-pigura" class="font-mono font-black text-sm sm:text-lg w-6 sm:w-10 text-center flex items-center justify-center bg-white h-8 sm:h-10">0</span>
                    <button onclick="changePiguraQty(1)" class="w-8 h-8 sm:w-12 sm:h-10 bg-white hover:bg-gray-200 font-black text-lg sm:text-xl flex items-center justify-center transition-colors border-l-2 border-black">+</button>
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
// Image Preview Modal
// ============================================
function openPreview(src, title) {
    document.getElementById('preview-image-src').src = src;
    document.getElementById('preview-image-title').textContent = title;
    document.getElementById('image-preview-modal').classList.remove('hidden');
}

function closePreview() {
    document.getElementById('image-preview-modal').classList.add('hidden');
    document.getElementById('preview-image-src').src = "";
}

// ============================================
// Payment UI Handlers (Form)
// ============================================
function updatePaymentUI() {
    const isOnline = document.querySelector('input[name="payment_method"]:checked').value === 'online';
    const channelsContainer = document.getElementById('online-channels-container');
    if (isOnline) {
        channelsContainer.classList.remove('hidden');
    } else {
        channelsContainer.classList.add('hidden');
    }
}

// ============================================
// Price Difference Calculation (for Edit Mode)
// ============================================

/**
 * Helper: Pisahkan & gabungkan notes (manual + auto payment)
 */
const PAYMENT_NOTE_DELIM = '\n---PAYMENT---\n';

function parseNotesParts(raw) {
    if (!raw) return { manual: '', payment: '' };
    const idx = raw.indexOf(PAYMENT_NOTE_DELIM);
    if (idx === -1) {
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

function combineNotesParts(manual, payment) {
    manual = (manual || '').trim();
    payment = (payment || '').trim();
    if (!manual && !payment) return '';
    if (!payment) return manual;
    if (!manual) return PAYMENT_NOTE_DELIM + payment;
    return manual + PAYMENT_NOTE_DELIM + payment;
}

/**
 * Hitung selisih harga antara pesanan lama dan baru
 * Juga mengembalikan manual notes yang harus di-preserve
 */
async function calculatePriceDifference() {
    // Hitung total harga baru
    const selectedBgs = backgrounds.filter(bg => bgQuantities[bg.id] > 0);
    const newTotal = selectedBgs.reduce((sum, bg) => 
        sum + (bgQuantities[bg.id] * HARGA_PER_FOTO), 0) + 
        (piguraQty * HARGA_PIGURA);
    
    // Ambil data pesanan lama (termasuk notes lama)
    const { data: oldData, error } = await supabaseClient
        .from('queues')
        .select('jumlah_foto, pigura, payment_status, notes')
        .eq('nomor_antrian', originalQueueId);
    
    if (error || !oldData || oldData.length === 0) {
        return { 
            oldTotal: 0, 
            newTotal, 
            difference: newTotal, 
            needsPayment: true,
            needsRefund: false,
            wasLunas: false,
            manualNotes: ''
        };
    }
    
    // Hitung total harga lama
    const oldTotal = oldData.reduce((sum, row) => 
        sum + (row.jumlah_foto * HARGA_PER_FOTO) + ((row.pigura || 0) * HARGA_PIGURA), 0);
    
    const difference = newTotal - oldTotal;
    const wasLunas = oldData[0].payment_status === 'lunas';
    const needsPayment = wasLunas && difference > 0;
    const needsRefund = wasLunas && difference < 0;
    const manualNotes = parseNotesParts(oldData[0].notes).manual;
    
    return { 
        oldTotal, 
        newTotal, 
        difference, 
        needsPayment,
        needsRefund,
        wasLunas,
        manualNotes
    };
}

// ============================================
// Submit Queue
// ============================================
let pendingQueueData = null;

async function submitQueue() {
    const nama = sanitizeInput(document.getElementById('input-nama').value);
    const kelas = sanitizeInput(document.getElementById('input-kelas').value);
    const alamat = sanitizeInput(document.getElementById('input-alamat').value);
    const noWa = sanitizeInput(document.getElementById('input-wa').value, 20);

    if (!nama || !kelas || !alamat || !noWa) {
        showPopup("Perhatian", "Silakan lengkapi <b>Nama</b>, <b>Kelas</b>, <b>Alamat</b>, dan <b>No. WhatsApp</b>.");
        return;
    }

    const selectedBgs = backgrounds.filter(bg => bgQuantities[bg.id] > 0);
    if (selectedBgs.length === 0) {
        return showPopup("Pilih Background", "Anda harus memilih minimal <b>satu background photobooth</b>!");
    }

    if (!currentBoothId && !isEditMode) {
        return showPopup('Booth Tidak Diketahui', 'Buka halaman ini melalui QR Code yang disediakan panitia (URL harus menyertakan ?booth=ID).');
    }
    
    // VALIDASI WAKTU & KUOTA (skip jika edit mode)
    if (!isEditMode) {
        const validation = await validateBoothAccess(currentBoothId);
        if (!validation.allowed) {
            showPopup('Tidak Dapat Melanjutkan', validation.message);
            return;
        }
    }

    const paymentMethod = document.querySelector('input[name="payment_method"]:checked').value;
    let paymentChannel = null;
    if (paymentMethod === 'online') {
        paymentChannel = document.getElementById('payment-channel-select').value;
    }

    pendingQueueData = { nama, kelas, alamat, noWa, selectedBgs };

    // KONFIRMASI KHUSUS untuk edit pesanan yang sudah lunas dengan perubahan harga
    if (isEditMode) {
        const priceInfo = await calculatePriceDifference();
        
        if (priceInfo.wasLunas && priceInfo.difference !== 0) {
            let confirmMessage = '';
            let confirmTitle = '';
            
            if (priceInfo.needsPayment) {
                // Harga naik - perlu bayar tambahan
                confirmTitle = '⚠️ Perubahan Harga';
                confirmMessage = `Harga pesanan akan naik dari <b>${formatCurrency(priceInfo.oldTotal)}</b> menjadi <b>${formatCurrency(priceInfo.newTotal)}</b>.<br><br>` +
                    `Anda perlu membayar tambahan sebesar <b>${formatCurrency(priceInfo.difference)}</b>.<br><br>` +
                    `Lanjutkan?`;
            } else if (priceInfo.needsRefund) {
                // Harga turun - ada kelebihan bayar
                confirmTitle = '💰 Perubahan Harga';
                confirmMessage = `Harga pesanan akan turun dari <b>${formatCurrency(priceInfo.oldTotal)}</b> menjadi <b>${formatCurrency(priceInfo.newTotal)}</b>.<br><br>` +
                    `Kelebihan bayar sebesar <b>${formatCurrency(Math.abs(priceInfo.difference))}</b> akan dikembalikan.<br><br>` +
                    `Lanjutkan?`;
            }
            
            showConfirm(confirmTitle, confirmMessage, 'YA, LANJUTKAN', async () => {
                await executeSubmitQueue(null, null);
            });
            return;
        }
        
        await executeSubmitQueue(null, null);
    } else {
        await executeSubmitQueue(paymentMethod, paymentChannel);
    }
}

async function executeSubmitQueue(paymentMethod, paymentChannel) {
    if (!pendingQueueData) return;
    const { nama, kelas, alamat, noWa, selectedBgs } = pendingQueueData;

    document.getElementById('selection-section').classList.add('hidden');
    document.getElementById('ticket-section').classList.remove('hidden');
    document.getElementById('ticket-user-info').textContent = `${nama} - ${kelas} - ${alamat}`;
    document.getElementById('ticket-number').textContent = isEditMode ? originalQueueId : '...';
    document.getElementById('ticket-items').innerHTML = '<div class="text-center font-bold">Menyimpan ke server...</div>';
    
    document.getElementById('ticket-payment-status').textContent = 'Memproses...';

    try {
        // PENTING: Hitung selisih harga SEBELUM RPC dipanggil
        // (karena RPC akan mengupdate data lama di DB)
        let priceInfoBeforeUpdate = null;
        if (isEditMode) {
            priceInfoBeforeUpdate = await calculatePriceDifference();
            console.log('💰 Price info BEFORE update:', priceInfoBeforeUpdate);
        }

        // Siapkan data backgrounds
        const bgPayload = selectedBgs.map(bg => ({
            background_id: bg.id,
            jumlah_foto: bgQuantities[bg.id]
        }));

        let rpcResult, rpcError;

        if (isEditMode) {
            const res = await supabaseClient.rpc('update_queue_order', {
                p_nomor_antrian: originalQueueId,
                p_nama: nama,
                p_kelas: kelas,
                p_alamat: alamat,
                p_notes: priceInfoBeforeUpdate ? (priceInfoBeforeUpdate.manualNotes || '') : '',
                p_backgrounds: bgPayload,
                p_pigura: piguraQty,
                p_no_wa: noWa
            });
            rpcResult = res.data;
            rpcError = res.error;
        } else {
            const res = await supabaseClient.rpc('submit_queue', {
                p_booth_id: currentBoothId,
                p_nama: nama,
                p_kelas: kelas,
                p_alamat: alamat,
                p_backgrounds: bgPayload,
                p_pigura: piguraQty,
                p_no_wa: noWa
            });
            rpcResult = res.data;
            rpcError = res.error;
        }
        if (rpcError) throw rpcError;

        // Validate RPC result
        if (!rpcResult || typeof rpcResult !== 'object') {
            throw new Error('Invalid response from server');
        }
        
        if (!rpcResult.nomor_antrian) {
            throw new Error('Nomor antrian tidak ditemukan dalam response');
        }

        myQueueId = rpcResult.nomor_antrian;
        const insertedData = Array.isArray(rpcResult.rows) ? rpcResult.rows : [];
        
        if (insertedData.length === 0) {
            throw new Error('Data tiket tidak valid');
        }
        
        // Update payment method & channel in database if not edit mode
        if (!isEditMode && paymentMethod) {
            await supabaseClient
                .from('queues')
                .update({ 
                    payment_method: paymentMethod,
                    payment_channel: paymentChannel
                })
                .eq('nomor_antrian', myQueueId);
                
            updateTicketPaymentUI(paymentMethod, paymentChannel);
        } else if (isEditMode) {
            // SMART PAYMENT STATUS: Gunakan priceInfo yang dihitung SEBELUM RPC
            const priceInfo = priceInfoBeforeUpdate;
            const manualNotes = priceInfo ? (priceInfo.manualNotes || '') : '';
            
            let newPaymentStatus = null;
            let paymentNoteOnly = '';
            let shouldUpdate = false;
            
            if (priceInfo && priceInfo.wasLunas) {
                // Kasus 1: status awal LUNAS
                shouldUpdate = true;
                if (priceInfo.needsPayment) {
                    // Harga naik → status jadi belum lunas
                    newPaymentStatus = 'belum_lunas';
                    paymentNoteOnly = `Kurang bayar: ${formatCurrency(priceInfo.difference)} (dari ${formatCurrency(priceInfo.oldTotal)} → ${formatCurrency(priceInfo.newTotal)})`;
                } else if (priceInfo.needsRefund) {
                    // Harga turun → tetap lunas, ada kelebihan bayar
                    newPaymentStatus = 'lunas';
                    paymentNoteOnly = `Kelebihan bayar: ${formatCurrency(Math.abs(priceInfo.difference))} (akan dikembalikan)`;
                } else {
                    // Harga sama → tetap lunas, hapus payment note
                    newPaymentStatus = 'lunas';
                    paymentNoteOnly = '';
                }
            } else if (priceInfo) {
                // Kasus 2: status awal BELUM LUNAS
                // Recalculate berdasarkan total yang sudah dibayar (dari payment note lama)
                // Asumsi: kalau ada "Kurang bayar X", berarti sudah bayar (oldTotal - X)... 
                // Tapi karena kita tidak tracking pembayaran detail, cek apakah notes lama menunjukkan kurang bayar
                // Bersihkan saja payment notes kalau tidak ada selisih sama dengan oldTotal
                // (Logika konservatif: tidak ubah status, hanya bersihkan stale payment note kalau harga balik = oldTotal lama sebelum perubahan)
                shouldUpdate = false;
            }
            
            // Update database kalau perlu
            if (shouldUpdate && newPaymentStatus !== null) {
                const combinedNotes = combineNotesParts(manualNotes, paymentNoteOnly);
                
                console.log('🔧 Updating payment:', {
                    newPaymentStatus,
                    manualNotes,
                    paymentNoteOnly,
                    myQueueId
                });
                
                const { error: updateError } = await supabaseClient
                    .from('queues')
                    .update({ 
                        payment_status: newPaymentStatus,
                        notes: combinedNotes
                    })
                    .eq('nomor_antrian', myQueueId);
                
                if (updateError) {
                    console.error('❌ Error updating payment status:', updateError);
                } else {
                    console.log('✅ Payment status & notes updated');
                }
            }
            
            // Fetch current state untuk update UI
            const { data: qData } = await supabaseClient
                .from('queues')
                .select('payment_method, payment_channel, payment_status, notes')
                .eq('nomor_antrian', myQueueId)
                .limit(1)
                .single();
            
            if (qData) {
                refreshPaymentStatusUI(
                    qData.payment_status,
                    qData.payment_method,
                    qData.payment_channel,
                    qData.notes
                );
            }
        }

        document.getElementById('ticket-number').textContent = myQueueId;

        // Tampilkan item
        let html = '';
        insertedData.forEach(row => {
            const bg = backgrounds.find(b => b.id === row.background_id);
            if (bg) {
                html += `<div class="border-b-2 border-black border-dashed pb-2 last:border-0 font-bold text-sm">
                    ${bg.nama_background} <span class="float-right px-2 bg-neoYellow border border-black">${row.jumlah_foto}x</span>
                </div>`;
            }
        });
        document.getElementById('ticket-items').innerHTML = html;

        // Simpan state
        const savedKey = 'myQueueId_booth_' + currentBoothId;
        localStorage.setItem(savedKey, myQueueId);
        localStorage.setItem('myPiguraQty', piguraQty);
        saveToHistory(myQueueId);
        
        isEditMode = false;
        originalQueueId = null;
        document.getElementById('btn-submit-queue').textContent = "AMBIL TIKET";
        document.getElementById('btn-cancel-edit').classList.add('hidden');

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
        
        // Parse error messages from RPC function
        let errorMessage = err.message || 'Terjadi kesalahan sistem';
        
        if (errorMessage.includes('SALES_NOT_OPEN:')) {
            const timeStr = errorMessage.split(':')[1];
            const salesTime = new Date(timeStr);
            errorMessage = `⏰ <b>Penjualan tiket belum dibuka.</b><br><br>Silakan kembali pada:<br><b>${salesTime.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}</b>`;
        } else if (errorMessage.includes('CAPACITY_FULL:')) {
            const parts = errorMessage.split(':');
            const current = parts[1];
            const max = parts[2];
            errorMessage = `🎫 <b>Maaf, kuota tiket sudah HABIS!</b><br><br>Tiket terjual: <b>${current}/${max}</b><br><br>Hubungi panitia untuk informasi lebih lanjut.`;
        }
        
        showPopup("Kesalahan", errorMessage);
        resetApp();
    }
}

// ============================================
// Payment Execution Functions
// ============================================
function updateTicketPaymentUI(method, channel) {
    const statusEl = document.getElementById('ticket-payment-status');
    const methodTextEl = document.getElementById('ticket-payment-method-text');
    const onlineActions = document.getElementById('online-payment-actions');
    const tunaiActions = document.getElementById('tunai-payment-actions');
    
    if (method === 'online') {
        const channelName = channel ? channel.toUpperCase().replace('_VA', ' VA') : 'ONLINE';
        methodTextEl.textContent = `ONLINE (${channelName})`;
        statusEl.innerHTML = '⏳ MENUNGGU PEMBAYARAN';
        statusEl.className = 'mt-3 inline-block px-3 py-1 text-xs font-black uppercase border-2 border-black bg-neoYellow shadow-[2px_2px_0px_0px_#000]';
        onlineActions.classList.remove('hidden');
        tunaiActions.classList.add('hidden');
    } else {
        methodTextEl.textContent = 'TUNAI';
        statusEl.innerHTML = '💵 BAYAR DI KASIR SEKARANG';
        statusEl.className = 'mt-3 inline-block px-3 py-1 text-xs font-black uppercase border-2 border-black bg-white shadow-[2px_2px_0px_0px_#000] text-black animate-pulse';
        onlineActions.classList.add('hidden');
        tunaiActions.classList.remove('hidden');
    }
}

async function payNowOnline() {
    if (!myQueueId) return;
    
    const btn = document.querySelector('#online-payment-actions button');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'MENGALIHKAN...';
    btn.disabled = true;

    try {
        const { data: qData } = await supabaseClient
            .from('queues')
            .select('nama_lengkap, no_wa, payment_channel, notes')
            .eq('nomor_antrian', myQueueId)
            .limit(1)
            .single();
        
        let totalHarga = 0;
        let customerName = qData?.nama_lengkap || 'Customer';
        let customerPhone = qData?.no_wa || '08000000000';
        
        if (pendingQueueData) {
            const totalFoto = pendingQueueData.selectedBgs.reduce((sum, bg) => sum + bgQuantities[bg.id], 0);
            totalHarga = (totalFoto * HARGA_PER_FOTO) + (piguraQty * HARGA_PIGURA);
            customerName = pendingQueueData.nama;
            customerPhone = pendingQueueData.noWa;
        } else {
            // Re-calculate from state if page reloaded
            const totalFoto = Object.values(myTicketStatuses).reduce((sum, item) => sum + (item.qty || 0), 0);
            const savedPigura = parseInt(localStorage.getItem('myPiguraQty') || '0');
            totalHarga = (totalFoto * HARGA_PER_FOTO) + (savedPigura * HARGA_PIGURA);
        }
        
        // SMART AMOUNT: Kalau ada notes "Kurang bayar", tagih cuma selisihnya
        let amountToPay = totalHarga;
        let isPartialPayment = false;
        let kurangBayar = 0;
        
        if (qData?.notes) {
            const parsed = parseNotesParts(qData.notes);
            const matchKurang = parsed.payment.match(/Kurang bayar:\s*Rp\s*([\d.,]+)/);
            if (matchKurang) {
                kurangBayar = parseInt(matchKurang[1].replace(/[.,]/g, '')) || 0;
                if (kurangBayar > 0) {
                    amountToPay = kurangBayar;
                    isPartialPayment = true;
                }
            }
        }
        
        if (amountToPay <= 0) {
            showPopup('Info', 'Tidak ada tagihan yang perlu dibayar.');
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }
        
        // Konfirmasi sebelum redirect ke payment gateway
        if (isPartialPayment) {
            const confirmed = await new Promise(resolve => {
                showConfirm(
                    '💳 Bayar Selisih',
                    `Anda akan dibayarkan tagihan <b>kekurangan</b> sebesar:<br><br>` +
                    `<div class="text-2xl font-black text-center my-3">${formatCurrency(amountToPay)}</div>` +
                    `<div class="text-xs">Total pesanan: ${formatCurrency(totalHarga)}</div>` +
                    `<div class="text-xs">Sudah dibayar: ${formatCurrency(totalHarga - kurangBayar)}</div>`,
                    '🚀 BAYAR SEKARANG',
                    () => resolve(true)
                );
                // kalau user batal popup ditutup, anggap false
                const cancelBtn = document.querySelector('#popup-actions button:not(#btn-confirm-action)');
                if (cancelBtn) {
                    const origClick = cancelBtn.onclick;
                    cancelBtn.onclick = () => { if (origClick) origClick(); resolve(false); };
                }
            });
            if (!confirmed) {
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }
        }
        
        const { data: payData, error: payError } = await supabaseClient.functions.invoke('create-payment', {
            body: {
                nomor_antrian: myQueueId,
                amount: amountToPay,
                customer_name: customerName,
                customer_phone: customerPhone,
                channel_code: qData.payment_channel || 'qris',
                return_url: window.location.origin + '/payment-return.html?order_id=' + myQueueId,
                is_partial: isPartialPayment
            }
        });
        
        if (payError || (payData && payData.error)) {
            console.error("Payment Gateway Error:", payError || payData.error);
            showPopup('Gagal', 'Gagal membuat tagihan online. Silakan coba lagi atau bayar tunai.');
            btn.innerHTML = originalText;
            btn.disabled = false;
        } else if (payData && payData.data && payData.data.pay_url) {
            window.open(payData.data.pay_url, '_blank');
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    } catch (e) {
        console.error(e);
        showPopup('Error', 'Terjadi kesalahan sistem.');
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function openChangePaymentModal() {
    document.getElementById('change-payment-modal').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('change-payment-modal-content').classList.remove('scale-95', 'opacity-0');
    }, 10);
}

function closeChangePaymentModal() {
    document.getElementById('change-payment-modal-content').classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        document.getElementById('change-payment-modal').classList.add('hidden');
    }, 300);
}

async function confirmChangePayment(method, channel) {
    if (!myQueueId) return;
    closeChangePaymentModal();
    
    document.getElementById('ticket-payment-status').innerHTML = 'MEMPERBARUI...';
    
    try {
        await supabaseClient.from('queues').update({
            payment_method: method,
            payment_channel: channel
        }).eq('nomor_antrian', myQueueId);
        
        updateTicketPaymentUI(method, channel);
    } catch (e) {
        console.error(e);
        showPopup('Gagal', 'Gagal mengubah metode pembayaran.');
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
    const editBtn = document.getElementById('btn-edit-order');
    let canEdit = true;
    
    if (isAnyCalled) {
        cardEl.classList.add('called-state');
    } else {
        cardEl.classList.remove('called-state');
    }
    
    // Check if any status is dipanggil or selesai
    Object.values(myTicketStatuses).forEach(item => {
        if (item.status === STATUS.DIPANGGIL || item.status === STATUS.SELESAI || item.status === STATUS.BATAL) {
            canEdit = false;
        }
    });
    
    if (editBtn) {
        if (canEdit) {
            editBtn.classList.remove('hidden');
        } else {
            editBtn.classList.add('hidden');
        }
    }
}

// ============================================
// Edit Order
// ============================================
function editOrder() {
    isEditMode = true;
    originalQueueId = myQueueId;
    
    // Restore background quantities from current ticket
    Object.keys(bgQuantities).forEach(id => {
        bgQuantities[id] = 0;
        if (myTicketStatuses[id]) {
            bgQuantities[id] = myTicketStatuses[id].qty;
        }
        if (document.getElementById(`qty-${id}`)) {
            document.getElementById(`qty-${id}`).textContent = bgQuantities[id];
        }
    });
    
    // Restore pigura quantity
    const savedPigura = parseInt(localStorage.getItem('myPiguraQty') || '0');
    piguraQty = savedPigura;
    if (document.getElementById('qty-pigura')) {
        document.getElementById('qty-pigura').textContent = piguraQty;
    }
    
    // Update total price display
    updateTotalPrice();
    
    document.getElementById('ticket-section').classList.add('hidden');
    document.getElementById('selection-section').classList.remove('hidden');
    
    document.getElementById('btn-submit-queue').textContent = "SIMPAN PERUBAHAN";
    document.getElementById('btn-cancel-edit').classList.remove('hidden');
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEditOrder() {
    isEditMode = false;
    originalQueueId = null;
    
    document.getElementById('selection-section').classList.add('hidden');
    document.getElementById('ticket-section').classList.remove('hidden');
    
    document.getElementById('btn-submit-queue').textContent = "AMBIL TIKET";
    document.getElementById('btn-cancel-edit').classList.add('hidden');
    
    // Re-render quantities from the active ticket
    Object.keys(bgQuantities).forEach(id => {
        bgQuantities[id] = 0;
        if (myTicketStatuses[id]) {
            bgQuantities[id] = myTicketStatuses[id].qty;
        }
        if (document.getElementById(`qty-${id}`)) {
            document.getElementById(`qty-${id}`).textContent = bgQuantities[id];
        }
    });
    
    piguraQty = parseInt(localStorage.getItem('myPiguraQty') || '0');
    if (document.getElementById('qty-pigura')) {
        document.getElementById('qty-pigura').textContent = piguraQty;
    }
    updateTotalPrice();
}

// ============================================
// Realtime & Waiting Queue
// ============================================
async function fetchWaitingQueues() {
    let query = supabaseClient
        .from('queues')
        .select('id, background_id, created_at, status')
        .eq('status', STATUS.MENUNGGU);
    // Filter per booth jika ada
    if (currentBoothId) query = query.eq('booth_id', currentBoothId);
    const { data } = await query;
    allWaitingQueues = data || [];
}

function subscribeMyTicket() {
    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
    }

    // Channel unik per booth untuk efisiensi
    const channelName = currentBoothId ? `customer-booth-${currentBoothId}` : 'customer-all';
    realtimeChannel = supabaseClient.channel(channelName)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, async payload => {
            const newRow = payload.new || payload.old;

            if (newRow && newRow.nomor_antrian === myQueueId) {
                if (myTicketStatuses[newRow.background_id]) {
                    myTicketStatuses[newRow.background_id].status = newRow.status;
                }
                
                // Update payment status display ketika ada perubahan dari sekretariat
                if (payload.new) {
                    refreshPaymentStatusUI(payload.new.payment_status, payload.new.payment_method, payload.new.payment_channel, payload.new.notes);
                }
            }

            await fetchWaitingQueues();
            renderTicketStatuses();
        })
        .subscribe();
}

// Helper: Update tampilan status pembayaran berdasarkan data dari DB
function refreshPaymentStatusUI(paymentStatus, paymentMethod, paymentChannel, paymentNotes) {
    const statusEl = document.getElementById('ticket-payment-status');
    if (!statusEl) return;
    
    // Pisahkan manual notes (sekretariat) dan auto payment notes (kurang/kelebihan bayar)
    const parsed = parseNotesParts(paymentNotes || '');
    const paymentOnly = parsed.payment;
    
    if (paymentStatus === 'lunas') {
        if (paymentOnly && paymentOnly.includes('Kelebihan bayar')) {
            statusEl.innerHTML = '✅ LUNAS<br><span class="text-xs font-bold mt-1 block">💰 ' + paymentOnly + '</span>';
            statusEl.className = 'mt-3 inline-block px-3 py-2 text-xs font-black uppercase border-2 border-black bg-neoGreen shadow-[2px_2px_0px_0px_#000]';
        } else {
            statusEl.innerHTML = '✅ LUNAS';
            statusEl.className = 'mt-3 inline-block px-3 py-1 text-xs font-black uppercase border-2 border-black bg-neoGreen shadow-[2px_2px_0px_0px_#000]';
        }
        document.getElementById('online-payment-actions').classList.add('hidden');
        document.getElementById('tunai-payment-actions').classList.add('hidden');
    } else if (paymentStatus === 'belum_lunas' && paymentOnly && paymentOnly.includes('Kurang bayar')) {
        statusEl.innerHTML = '⚠️ BELUM LUNAS<br><span class="text-xs font-bold mt-1 block">💸 ' + paymentOnly + '</span>';
        statusEl.className = 'mt-3 inline-block px-3 py-2 text-xs font-black uppercase border-2 border-black bg-neoRed text-white shadow-[2px_2px_0px_0px_#000]';
        // Tampilkan tombol bayar sesuai payment method
        if (paymentMethod === 'online') {
            document.getElementById('online-payment-actions').classList.remove('hidden');
            document.getElementById('tunai-payment-actions').classList.add('hidden');
        } else {
            document.getElementById('online-payment-actions').classList.add('hidden');
            document.getElementById('tunai-payment-actions').classList.remove('hidden');
        }
    } else if (paymentMethod) {
        updateTicketPaymentUI(paymentMethod, paymentChannel);
    } else {
        statusEl.innerHTML = '⏳ BELUM PEMBAYARAN';
        statusEl.className = 'mt-3 inline-block px-3 py-1 text-xs font-black uppercase border-2 border-black bg-neoYellow shadow-[2px_2px_0px_0px_#000]';
        document.getElementById('online-payment-actions').classList.add('hidden');
        document.getElementById('tunai-payment-actions').classList.remove('hidden');
    }
}

// ============================================
// Notifications
// ============================================
async function showNotification(title, body) {
    const fullTitle = "Antrian Photobooth: " + title;
    
    // Vibrate (wrapped in try-catch to prevent errors)
    if ('vibrate' in navigator) {
        try {
            navigator.vibrate([500, 200, 500, 200, 1000]);
        } catch (e) {
            // Silently fail if vibrate is blocked
        }
    }

    // OS Notification
    if ('Notification' in window && Notification.permission === 'granted') {
        const logoUrl = new URL('logo-mm.png', self.location.origin + self.location.pathname.replace(/\/[^/]*$/, '/')).href;
        try {
            const reg = await navigator.serviceWorker.ready;
            reg.showNotification(fullTitle, {
                body: body,
                icon: logoUrl,
                badge: logoUrl,
                vibrate: [500, 200, 500, 200, 1000],
                requireInteraction: true
            });
        } catch (e) {
            new Notification(fullTitle, { 
                body: body, 
                icon: logoUrl, 
                badge: logoUrl 
            });
        }
    }

    // In-app toast
    showToast(title, body);

    // Sound (handle Promise rejection properly)
    try {
        const audio = new Audio('assets/audio.mp3');
        audio.volume = 0.5;
        audio.play().catch(e => {
            // Silently fail if autoplay is blocked by browser
        });
    } catch (e) {
        // Silently fail if Audio creation fails
    }
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
    // Hapus localStorage per booth
    const savedKey = 'myQueueId_booth_' + (currentBoothId || 'default');
    localStorage.removeItem(savedKey);
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
    document.getElementById('input-wa').value = '';
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

    let query = supabaseClient
        .from('queues')
        .select('*, backgrounds(nama_background)')
        .eq('nomor_antrian', queueId)
        .in('status', ACTIVE_STATUSES);

    // Jika ada booth, pastikan tiket milik booth yang sama
    if (currentBoothId) query = query.eq('booth_id', currentBoothId);

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
        showPopup("Tiket Kadaluarsa", `Antrian <b>${queueId}</b> tidak ditemukan, dibatalkan, atau sudah selesai.`);
        resetApp();
        return;
    }

    myQueueId = queueId;
    // Simpan per booth
    const savedKey = 'myQueueId_booth_' + (currentBoothId || 'default');
    localStorage.setItem(savedKey, myQueueId);
    saveToHistory(myQueueId);

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
    const noWa = data[0].no_wa || '';
    document.getElementById('ticket-user-info').textContent = `${nama} - ${kelas} - ${alamat}`;
    document.getElementById('ticket-number').textContent = myQueueId;
    
    // Restore form data for edit mode
    document.getElementById('input-nama').value = nama;
    document.getElementById('input-kelas').value = kelas;
    document.getElementById('input-alamat').value = alamat;
    document.getElementById('input-wa').value = noWa;

    // Restore payment status (gunakan helper agar konsisten)
    refreshPaymentStatusUI(
        data[0].payment_status,
        data[0].payment_method,
        data[0].payment_channel,
        data[0].notes
    );

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

// ============================================
// Riwayat Antrian
// ============================================
function saveToHistory(queueId) {
    let history = JSON.parse(localStorage.getItem('myQueueHistory') || '[]');
    if (!history.includes(queueId)) {
        history.push(queueId);
        localStorage.setItem('myQueueHistory', JSON.stringify(history));
    }
}

function lihatRiwayat() {
    let history = JSON.parse(localStorage.getItem('myQueueHistory') || '[]');
    if (history.length === 0) {
        showPopup('Riwayat Kosong', 'Anda belum memiliki riwayat tiket di perangkat ini.');
        return;
    }

    let html = "<p class='mb-4'>Riwayat tiket Anda sebelumnya:</p><div class='space-y-3 mt-3 max-h-60 overflow-y-auto pr-2'>";
    history.slice().reverse().forEach(nomor => {
        html += `
            <div class="bg-bgLight border-2 border-black p-3 shadow-[2px_2px_0px_0px_#000] flex justify-between items-center">
                <span class="font-black bg-white px-2 py-1 border-2 border-black text-lg">${nomor}</span>
                <button onclick="restoreQueue('${nomor}'); closePopup();" class="bg-neoCyan text-black border-2 border-black font-bold px-3 py-1 text-xs uppercase hover:bg-black hover:text-white transition-colors">Lihat Tiket</button>
            </div>
        `;
    });
    html += "</div>";
    showPopup('Riwayat Tiket', html);
}
