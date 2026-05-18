// ============================================
// Monitor Page Logic — AntriPhotobooth
// ============================================

let backgrounds = [];
let currentCalled = {};
let nextInLine = {};
let delayedQueues = [];
let isAudioEnabled = false;

// Multi-Booth state
let currentBoothId = null;
let currentBoothInfo = null;

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
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
    await loadData();
    subscribeToUpdates();
}

// ============================================
// Data Loading
// ============================================
async function loadData() {
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
function renderColumns() {
    const container = document.getElementById('monitor-columns');
    const colors = ['bg-neoCyan', 'bg-neoPink', 'bg-neoYellow', 'bg-neoGreen'];

    container.innerHTML = backgrounds.map((bg, index) => {
        const called = currentCalled[bg.id];
        const num = called ? called.nomor_antrian : '---';
        const color = colors[index % colors.length];

        return `
        <div id="card-bg-${bg.id}" class="neo-card-monitor bg-white rounded-none p-6 flex flex-col items-center justify-center min-h-[300px] md:min-h-[400px] lg:h-full relative w-full h-full">
            
            <div class="absolute top-0 left-0 w-full p-2 md:p-4 border-b-4 border-black ${color} text-black text-center z-10 shadow-[0px_4px_0px_0px_#000]">
                <h2 class="text-xl md:text-2xl lg:text-3xl xl:text-4xl font-black tracking-tight uppercase truncate px-2">
                    ${bg.nama_background}
                </h2>
            </div>
            
            <div class="mt-14 md:mt-20 text-sm md:text-xl font-mono font-bold mb-2 md:mb-3 tracking-widest uppercase border-b-2 border-black pb-1">Nomor Antrian</div>
            
            <div id="num-bg-${bg.id}" class="number-display text-6xl sm:text-7xl md:text-[6rem] lg:text-5xl xl:text-6xl 2xl:text-[7rem] whitespace-nowrap font-black tracking-tighter text-black leading-none mb-4 md:mb-6 transition-all duration-300">
                ${num}
            </div>

            <div id="name-bg-${bg.id}" class="text-lg md:text-2xl lg:text-3xl font-bold uppercase bg-black text-white px-2 md:px-4 py-1 md:py-2 text-center w-[90%] md:w-full leading-tight border-4 border-black transition-all duration-300 ${called ? '' : 'opacity-0 scale-95'}">
                ${called ? called.nama_lengkap : '-'}
            </div>
            
            <div id="kelas-bg-${bg.id}" class="text-sm md:text-lg font-mono font-bold uppercase bg-white text-black border-4 border-black border-t-0 px-2 md:px-4 py-1 text-center w-[80%] md:w-3/4 leading-tight shadow-[4px_4px_0px_0px_#000] transition-all duration-300 mb-8 ${called ? '' : 'opacity-0 scale-95'}">
                ${called ? 'KLS: ' + called.kelas : '-'}
            </div>

            <div id="msg-bg-${bg.id}" class="absolute bottom-12 bg-neoPink border-2 md:border-4 border-black px-4 md:px-6 py-2 md:py-3 shadow-[4px_4px_0px_0px_#000] md:shadow-[6px_6px_0px_0px_#000] text-sm md:text-xl lg:text-2xl font-black uppercase tracking-widest opacity-0 transition-all duration-300 z-20 pointer-events-none transform translate-y-4">
                SILAKAN MASUK
            </div>

            <div class="absolute bottom-0 left-0 w-full bg-neoYellow border-t-4 border-black p-2 md:p-3 text-center text-xs md:text-sm font-bold uppercase flex justify-center items-center gap-2" id="next-bg-${bg.id}">
                NEXT: ${nextInLine[bg.id] ? `<span class="font-black text-sm md:text-base">${nextInLine[bg.id].nomor_antrian}</span> <span class="truncate max-w-[150px]">(${nextInLine[bg.id].nama_lengkap})</span>` : '-'}
            </div>
        </div>
        `;
    }).join('');
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
}

// ============================================
// Dynamic UI Updates
// ============================================
async function fetchNextInLine(bgId) {
    let query = supabaseClient
        .from('queues')
        .select('*')
        .eq('background_id', bgId)
        .eq('status', STATUS.MENUNGGU)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

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
        nextEl.innerHTML = `NEXT: <span class="font-black text-sm md:text-base">${data.nomor_antrian}</span> <span class="truncate max-w-[200px] xl:max-w-[250px]">(${data.nama_lengkap})</span>`;
    } else {
        nextInLine[bgId] = null;
        nextEl.innerHTML = `NEXT: -`;
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
            <span class="font-black text-lg tracking-tighter">${q.nomor_antrian}</span>
            <span class="font-bold text-[0.65rem] uppercase text-gray-700 truncate">${q.nama_lengkap}</span>
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
    } else if (!isJustCalled) {
        nameEl.classList.add('opacity-0', 'scale-95');
        kelasEl.classList.add('opacity-0', 'scale-95');
    }

    if (isJustCalled) {
        if (isAudioEnabled) playNotificationSound();

        cardEl.classList.add('calling-highlight');
        msgEl.classList.remove('opacity-0', 'translate-y-4');

        setTimeout(() => {
            cardEl.classList.remove('calling-highlight');
            msgEl.classList.add('opacity-0', 'translate-y-4');
        }, 5000);
    }
}
