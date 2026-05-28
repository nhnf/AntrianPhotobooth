// ============================================
// Monitor Page Logic — AntriPhotobooth
// ============================================

let backgrounds = [];
let currentCalled = {};
let nextInLine = {};
let delayedQueues = [];
let isAudioEnabled = false;
let isVoiceEnabled = false;

// Multi-Booth state
let currentBoothId = null;
let currentBoothInfo = null;

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Load Dark Mode Preference
    if (localStorage.getItem('monitorDarkMode') === 'true') {
        document.body.classList.add('dark');
    }

    updateClock();
    setInterval(updateClock, 1000);

    // Baca booth dari URL
    currentBoothId = getBoothIdFromURL();
    if (currentBoothId) {
        currentBoothInfo = await loadBoothInfo(currentBoothId);
        if (currentBoothInfo) {
            // Tampilkan nama booth di header
            const boothNameEl = document.getElementById('booth-name');
            if (boothNameEl) boothNameEl.textContent = currentBoothInfo.nama_booth;
            document.title = currentBoothInfo.nama_booth + ' - Monitor Antrian';
        }
    }

    startMonitor();
});

function updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent = now.toLocaleTimeString('id-ID');
}

async function startMonitor() {
    isAudioEnabled = true;
    // isVoiceEnabled tidak diaktifkan otomatis — butuh klik tombol (browser policy)
    await loadData();
    subscribeToUpdates();
}

function toggleVoice() {
    isVoiceEnabled = !isVoiceEnabled;
    const btn = document.getElementById('voice-toggle-btn');
    if (!btn) return;

    if (isVoiceEnabled) {
        btn.dataset.active = 'true';
        btn.innerHTML = `<span class="text-lg">🔊</span><span class="leading-tight">Suara<br>Aktif</span>`;
        btn.classList.remove('bg-neoYellow');
        btn.classList.add('bg-neoGreen');
        // Ucapkan konfirmasi untuk "unlock" AudioContext browser
        speakAnnouncement('Sistem pengumuman suara aktif.');
    } else {
        btn.dataset.active = 'false';
        btn.innerHTML = `<span class="text-lg">🔇</span><span class="leading-tight">Aktifkan<br>Suara</span>`;
        btn.classList.remove('bg-neoGreen');
        btn.classList.add('bg-neoYellow');
        cancelAllSpeech();
    }
}

// ============================================
// Voice Settings Modal
// ============================================
function openVoiceSettings() {
    const modal = document.getElementById('voice-settings-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    populateVoiceList();
}

function closeVoiceSettings() {
    const modal = document.getElementById('voice-settings-modal');
    if (modal) modal.classList.add('hidden');
}

// Tutup modal jika klik di luar area panel
document.addEventListener('click', (e) => {
    const modal = document.getElementById('voice-settings-modal');
    if (modal && !modal.classList.contains('hidden') && e.target === modal) {
        closeVoiceSettings();
    }
});

function populateVoiceList() {
    const select = document.getElementById('voice-select');
    if (!select || !window.speechSynthesis) return;

    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
        // Tunggu sampai voices siap lalu coba lagi
        window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.onvoiceschanged = null;
            populateVoiceList();
        };
        return;
    }

    // Simpan pilihan sebelumnya
    const currentVal = select.value;

    select.innerHTML = '<option value="">-- Otomatis (Terbaik) --</option>';

    // Urutkan: id-ID online dulu, lalu id-ID offline, lalu sisanya
    const sorted = [...voices].sort((a, b) => {
        const aId = a.lang && a.lang.startsWith('id');
        const bId = b.lang && b.lang.startsWith('id');
        const aOnline = !a.localService;
        const bOnline = !b.localService;
        if (aId && !bId) return -1;
        if (!aId && bId) return 1;
        if (aOnline && !bOnline) return -1;
        if (!aOnline && bOnline) return 1;
        return a.name.localeCompare(b.name);
    });

    sorted.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        const isId = v.lang && v.lang.startsWith('id');
        const isOnline = !v.localService;
        const tag = isOnline ? '[Online] ' : '[Offline] ';
        const flag = isId ? '🇮🇩 ' : '';
        opt.textContent = `${flag}${tag}${v.name} (${v.lang})`;
        if (isId && isOnline) opt.style.fontWeight = 'bold';
        if (v.voiceURI === _selectedVoiceURI) opt.selected = true;
        select.appendChild(opt);
    });

    // Pulihkan pilihan jika masih ada
    if (currentVal) select.value = currentVal;
}

function onVoiceChange(voiceURI) {
    _selectedVoiceURI = voiceURI || null;
}

function onRateChange(val) {
    _voiceRate = parseFloat(val);
    const display = document.getElementById('rate-display');
    if (display) display.textContent = parseFloat(val).toFixed(2) + '×';
}

function testVoice() {
    speakAnnouncement('Nomor antrian B-007, atas nama Budi Santoso, harap segera menuju area photobooth.');
}

// ============================================
// Data Loading
// ============================================

async function loadData() {
    const container = document.getElementById('monitor-columns');
    if (container && (!backgrounds || backgrounds.length === 0)) {
        container.innerHTML = Array(4).fill().map(() => `
            <div class="neo-card-monitor border-4 border-black flex flex-col relative h-[50vh] md:h-[60vh] overflow-hidden justify-center items-center p-4">
                <div class="skeleton w-3/4 h-12 mb-4"></div>
                <div class="skeleton w-1/2 h-24 mb-4"></div>
                <div class="skeleton w-full h-8 absolute bottom-0 left-0"></div>
            </div>
        `).join('');
    }

    try {
        const { data: bgs, error: bgError } = await supabaseClient.from('backgrounds').select('*').order('id');
        if (bgError) return console.error(bgError);
        backgrounds = bgs;

        let queueQuery = supabaseClient
            .from('queues')
            .select('*')
            .in('status', ACTIVE_STATUSES)
            .order('created_at', { ascending: true });

        // Filter per booth
        if (currentBoothId) queueQuery = queueQuery.eq('booth_id', currentBoothId);

        const { data: queues, error: qError } = await queueQuery;
        if (qError) return console.error(qError);

        backgrounds.forEach(bg => {
            const bgQs = queues.filter(q => q.background_id === bg.id);
            const called = bgQs.find(q => q.status === STATUS.DIPANGGIL);
            currentCalled[bg.id] = called || null;

            const next = bgQs.find(q => q.status === STATUS.MENUNGGU);
            nextInLine[bg.id] = next || null;
        });

        delayedQueues = queues.filter(q => q.status === STATUS.DITUNDA);

        renderColumns();
        renderDelayed();
    } catch (e) {
        console.error('loadData error:', e);
    }
}

// ============================================
// Render UI
// ============================================

/**
 * Auto-scale font size untuk nama panjang agar tetap terbaca.
 * Dipanggil setelah render/update nama.
 */
function autoScaleName(el) {
    if (!el) return;
    const name = el.textContent.trim();
    // Tentukan ukuran font berdasarkan panjang nama
    // Hanya set inline style, tidak ubah className (agar text-white tetap)
    if (name.length <= 12) {
        el.style.fontSize = '';
    } else if (name.length <= 20) {
        el.style.fontSize = 'clamp(1rem, 3vw, 1.75rem)';
    } else if (name.length <= 30) {
        el.style.fontSize = 'clamp(0.85rem, 2.5vw, 1.4rem)';
    } else {
        el.style.fontSize = 'clamp(0.75rem, 2vw, 1.1rem)';
    }
}

function renderColumns() {
    const container = document.getElementById('monitor-columns');
    const colors = ['bg-neoCyan', 'bg-neoPink', 'bg-neoYellow', 'bg-neoGreen'];

    container.innerHTML = backgrounds.map((bg, index) => {
        const called = currentCalled[bg.id];
        const num = called ? called.nomor_antrian : '---';
        const color = colors[index % colors.length];

        return `
        <div id="card-bg-${bg.id}" class="neo-card-monitor bg-white rounded-none flex flex-col items-center min-h-[300px] md:min-h-[400px] lg:h-full relative w-full h-full overflow-hidden">
            
            <!-- Header background name -->
            <div class="w-full p-2 md:p-4 border-b-4 border-black ${color} text-black text-center z-10 shadow-[0px_4px_0px_0px_#000] shrink-0">
                <h2 class="text-xl md:text-2xl lg:text-3xl xl:text-4xl font-black tracking-tight uppercase truncate px-2">
                    ${escapeHTML(bg.nama_background)}
                </h2>
            </div>
            
            <!-- Main content -->
            <div class="flex-1 flex flex-col items-center justify-center p-4 md:p-6 w-full">
                <div class="text-sm md:text-xl font-mono font-bold mb-2 md:mb-3 tracking-widest uppercase border-b-2 border-black pb-1">Nomor Antrian</div>
                
                <div id="num-bg-${bg.id}" class="number-display text-6xl sm:text-7xl md:text-[6rem] lg:text-5xl xl:text-6xl 2xl:text-[7rem] whitespace-nowrap font-black tracking-tighter text-black leading-none mb-4 md:mb-6 transition-all duration-300">
                    ${num}
                </div>

                <div id="name-bg-${bg.id}" class="text-lg md:text-2xl lg:text-3xl font-bold uppercase bg-black text-white px-2 md:px-4 py-1 md:py-2 text-center w-full leading-tight border-4 border-black transition-all duration-300 break-words ${called ? '' : 'opacity-0 scale-95'}">
                    ${called ? escapeHTML(called.nama_lengkap) : '-'}
                </div>
                
                <div id="kelas-bg-${bg.id}" class="text-sm md:text-lg font-mono font-bold uppercase bg-white text-black border-4 border-black border-t-0 px-2 md:px-4 py-1 text-center w-[80%] md:w-3/4 leading-tight shadow-[4px_4px_0px_0px_#000] transition-all duration-300 ${called ? '' : 'opacity-0 scale-95'}">
                    ${called ? 'KLS: ' + escapeHTML(called.kelas) : '-'}
                </div>
            </div>

            <!-- SILAKAN MASUK badge -->
            <div class="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                <div id="msg-bg-${bg.id}" class="bg-neoPink border-2 md:border-4 border-black px-4 md:px-6 py-2 md:py-3 shadow-[4px_4px_0px_0px_#000] md:shadow-[6px_6px_0px_0px_#000] text-sm md:text-xl lg:text-2xl font-black uppercase tracking-widest opacity-0 transition-all duration-300 transform translate-y-4">
                    SILAKAN MASUK
                </div>
            </div>

            <!-- BERIKUTNYA footer -->
            <div class="w-full bg-neoYellow border-t-4 border-black px-3 py-2 md:py-3 text-center font-black uppercase shrink-0" id="next-bg-${bg.id}">
                <div class="text-[9px] md:text-[10px] tracking-widest text-black/50 mb-0.5">BERIKUTNYA</div>
                <div class="text-base md:text-xl lg:text-2xl leading-tight truncate">
                    ${nextInLine[bg.id] ? `${escapeHTML(nextInLine[bg.id].nomor_antrian)} — ${escapeHTML(nextInLine[bg.id].nama_lengkap)}` : '<span class="text-black/30">—</span>'}
                </div>
            </div>
        </div>
        `;
    }).join('');
    
    // Auto-scale nama setelah render
    backgrounds.forEach(bg => {
        autoScaleName(document.getElementById(`name-bg-${bg.id}`));
    });
}

// ============================================
// Realtime Subscription
// ============================================
function subscribeToUpdates() {
    // Channel unik per booth
    const channelName = currentBoothId ? `monitor-booth-${currentBoothId}` : 'monitor-queues';

    supabaseClient.channel(channelName)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, payload => {
            const newRecord = payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old;
            const eventType = payload.eventType;

            // Abaikan event dari booth lain
            if (currentBoothId && newRecord.booth_id && newRecord.booth_id !== currentBoothId) return;

            if (eventType === 'UPDATE') {
                if (newRecord.status === STATUS.DIPANGGIL) {
                    currentCalled[newRecord.background_id] = newRecord;
                    updateColumnUI(newRecord.background_id, newRecord.nomor_antrian, true, newRecord);
                }
                else if ([STATUS.SELESAI, STATUS.BATAL, STATUS.DITUNDA, STATUS.MENUNGGU].includes(newRecord.status)) {
                    const current = currentCalled[newRecord.background_id];
                    if (current && current.id === newRecord.id) {
                        currentCalled[newRecord.background_id] = null;
                        updateColumnUI(newRecord.background_id, '---', false, null);
                    }
                }

                if (newRecord.status === STATUS.DITUNDA) {
                    const existingIdx = delayedQueues.findIndex(q => q.id === newRecord.id);
                    if (existingIdx === -1) {
                        delayedQueues.push(newRecord);
                    } else {
                        delayedQueues[existingIdx] = newRecord;
                    }
                } else {
                    delayedQueues = delayedQueues.filter(q => q.id !== newRecord.id);
                }
                renderDelayed();
            }

            if (newRecord && newRecord.background_id) {
                fetchNextInLine(newRecord.background_id);
            }
        })
        .subscribe();

    // Listen perubahan nama booth secara realtime
    if (currentBoothId) {
        supabaseClient.channel('monitor-booth-info-' + currentBoothId)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'booths',
                filter: 'id=eq.' + currentBoothId }, async () => {
                currentBoothInfo = await loadBoothInfo(currentBoothId);
                if (currentBoothInfo) {
                    const boothNameEl = document.getElementById('booth-name');
                    if (boothNameEl) boothNameEl.textContent = currentBoothInfo.nama_booth;
                }
            })
            .subscribe();
    }

    // Listen repeat_call broadcast dari sekretariat
    supabaseClient.channel('system-events')
        .on('broadcast', { event: 'repeat_call' }, (payload) => {
            const data = payload.payload;
            if (!data) return;

            // Filter: hanya respons kalau booth cocok (atau broadcast ke semua)
            if (data.booth_id && currentBoothId && data.booth_id !== currentBoothId) return;

            if (isVoiceEnabled || isAudioEnabled) {
                const teks = `Nomor antrian ${data.nomor_antrian}, atas nama ${data.nama_lengkap}, harap segera menuju ${data.nama_background}.`;
                queueAnnouncement(teks, isAudioEnabled);
            }
        })
        .subscribe();
}

// ============================================
// Dynamic UI Updates
// ============================================
async function fetchNextInLine(bgId) {


    // Filter per booth (tidak bisa chain setelah maybeSingle, build dulu)
    let q = supabaseClient
        .from('queues')
        .select('*')
        .eq('background_id', bgId)
        .eq('status', STATUS.MENUNGGU);

    if (currentBoothId) q = q.eq('booth_id', currentBoothId);

    const { data } = await q.order('created_at', { ascending: true }).limit(1).maybeSingle();

    const nextEl = document.getElementById(`next-bg-${bgId}`);
    if (!nextEl) return;

    if (data) {
        nextInLine[bgId] = data;
        nextEl.innerHTML = `<div class="text-[9px] md:text-[10px] tracking-widest text-black/50 mb-0.5">BERIKUTNYA</div><div class="text-base md:text-xl lg:text-2xl leading-tight truncate">${escapeHTML(data.nomor_antrian)} — ${escapeHTML(data.nama_lengkap)}</div>`;
    } else {
        nextInLine[bgId] = null;
        nextEl.innerHTML = `<div class="text-[9px] md:text-[10px] tracking-widest text-black/50 mb-0.5">BERIKUTNYA</div><div class="text-base md:text-xl lg:text-2xl text-black/30">—</div>`;
    }
}

function renderDelayed() {
    const container = document.getElementById('delayed-container');
    const listContent = document.getElementById('delayed-list-content');

    if (delayedQueues.length === 0) {
        container.classList.add('hidden');
        return;
    }

    const uniqueDelayed = [];
    delayedQueues.forEach(q => {
        if (!uniqueDelayed.find(u => u.nomor_antrian === q.nomor_antrian)) {
            uniqueDelayed.push(q);
        }
    });

    listContent.innerHTML = uniqueDelayed.map(q =>
        `<div class="border-2 border-black p-1.5 bg-white shadow-[2px_2px_0px_0px_#000] flex flex-col leading-tight">
            <span class="font-black text-lg tracking-tighter">${escapeHTML(q.nomor_antrian)}</span>
            <span class="font-bold text-[0.65rem] uppercase text-gray-700 truncate">${escapeHTML(q.nama_lengkap)}</span>
        </div>`
    ).join('');

    container.classList.remove('hidden');
}

function updateColumnUI(bgId, number, isJustCalled, record) {
    const cardEl = document.getElementById(`card-bg-${bgId}`);
    const numEl = document.getElementById(`num-bg-${bgId}`);
    const msgEl = document.getElementById(`msg-bg-${bgId}`);
    const nameEl = document.getElementById(`name-bg-${bgId}`);
    const kelasEl = document.getElementById(`kelas-bg-${bgId}`);

    if (!cardEl) return;

    numEl.textContent = number;

    if (record && isJustCalled) {
        nameEl.textContent = record.nama_lengkap;
        kelasEl.textContent = 'KLS: ' + record.kelas;
        nameEl.classList.remove('opacity-0', 'scale-95');
        kelasEl.classList.remove('opacity-0', 'scale-95');
        autoScaleName(nameEl); // auto-scale font untuk nama panjang
    } else if (!isJustCalled) {
        nameEl.classList.add('opacity-0', 'scale-95');
        kelasEl.classList.add('opacity-0', 'scale-95');
    }

    if (isJustCalled) {
        // Ting-tong + voice dimasukkan ke queue secara berurutan
        // queueAnnouncement(text, withSound=true) = ting-tong dulu, lalu voice
        if (isVoiceEnabled && record) {
            const bg = backgrounds.find(b => b.id === record.background_id);
            const namaBg = bg ? bg.nama_background : '';
            const teks = `Nomor antrian ${record.nomor_antrian}, atas nama ${record.nama_lengkap}, harap segera menuju ${namaBg}.`;
            // withSound=true: ting-tong masuk queue dulu, baru voice
            queueAnnouncement(teks, isAudioEnabled);
        } else if (isAudioEnabled) {
            // Voice dimatikan tapi audio aktif: ting-tong saja
            playNotificationSound();
        }

        cardEl.classList.add('calling-highlight');
        msgEl.classList.remove('opacity-0', 'translate-y-4');

        setTimeout(() => {
            cardEl.classList.remove('calling-highlight');
            msgEl.classList.add('opacity-0', 'translate-y-4');
        }, 5000);
    }
}

// ============================================
// Dark Mode Toggle
// ============================================
function toggleDarkMode() {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    localStorage.setItem('monitorDarkMode', isDark);
}
