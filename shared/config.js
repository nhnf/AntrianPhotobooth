// ============================================
// Supabase Configuration — AntriPhotobooth
// ============================================

const SUPABASE_URL = 'https://mkxwbobcptdqnntqgzdl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1reHdib2JjcHRkcW5udHFnemRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyOTMwMzUsImV4cCI6MjA5Mzg2OTAzNX0.R1apR-zFUsVA17IVKbBDMIvIPLy0kWbLe8vTvEaqwiw';

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// Multi-Booth Helpers
// ============================================

/**
 * Ambil booth_id dari URL parameter ?booth=ID
 * Mengembalikan integer atau null jika tidak ada.
 */
function getBoothIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('booth');
    const id = parseInt(raw, 10);
    return isNaN(id) ? null : id;
}

/**
 * Load info booth (nama + prefix) dari database.
 * @param {number} boothId
 * @returns {Promise<{id, nama_booth, ticket_prefix}|null>}
 */
async function loadBoothInfo(boothId) {
    if (!boothId) return null;
    const { data, error } = await supabaseClient
        .from('booths')
        .select('id, nama_booth, ticket_prefix')
        .eq('id', boothId)
        .eq('is_active', true)
        .single();
    if (error || !data) return null;
    return data;
}

// ============================================
// Constants
// ============================================
const HARGA_PER_FOTO = 40000;
const HARGA_PIGURA = 35000;

const STATUS = {
    MENUNGGU: 'menunggu',
    DIPANGGIL: 'dipanggil',
    DITUNDA: 'ditunda',
    SELESAI: 'selesai',
    BATAL: 'batal'
};

const ACTIVE_STATUSES = [STATUS.MENUNGGU, STATUS.DIPANGGIL, STATUS.DITUNDA];

// ============================================
// Realtime subscription helper
// ============================================
function subscribeToQueues(callback) {
    const channel = supabaseClient
        .channel('public:queues')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'queues',
            },
            (payload) => callback(payload)
        )
        .subscribe();
    return channel;
}

// ============================================
// Audio notification (programmatic ting-tong)
// ============================================

/**
 * Play ting-tong sound. Returns a Promise yang resolve setelah suara selesai.
 */
function playNotificationSound() {
    return new Promise(resolve => {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const duration = 0.9; // total durasi ting-tong
            
            // First tone (ting) - higher pitch
            const osc1 = audioCtx.createOscillator();
            const gain1 = audioCtx.createGain();
            osc1.connect(gain1);
            gain1.connect(audioCtx.destination);
            osc1.frequency.setValueAtTime(830, audioCtx.currentTime);
            osc1.type = 'sine';
            gain1.gain.setValueAtTime(0.5, audioCtx.currentTime);
            gain1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
            osc1.start(audioCtx.currentTime);
            osc1.stop(audioCtx.currentTime + 0.5);
            
            // Second tone (tong) - lower pitch
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.connect(gain2);
            gain2.connect(audioCtx.destination);
            osc2.frequency.setValueAtTime(620, audioCtx.currentTime + 0.3);
            osc2.type = 'sine';
            gain2.gain.setValueAtTime(0.0001, audioCtx.currentTime);
            gain2.gain.setValueAtTime(0.5, audioCtx.currentTime + 0.3);
            gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
            osc2.start(audioCtx.currentTime + 0.3);
            osc2.stop(audioCtx.currentTime + duration);
            
            // Resolve setelah ting-tong selesai + sedikit jeda
            osc2.onended = () => {
                setTimeout(resolve, 150); // 150ms jeda sebelum voice
            };
        } catch (e) {
            resolve(); // kalau AudioContext gagal, tetap lanjut
        }
    });
}

// ============================================
// Voice Announcement (Text-to-Speech)
// ============================================

/**
 * Ucapkan teks pengumuman via Web Speech API (TTS).
 * 
 * BUG FIX: Sebelumnya langsung cancel() suara yang sedang berjalan.
 * Sekarang pakai queue — kalau sedang berbicara, tambahkan ke antrian
 * dan tunggu selesai baru mulai yang berikutnya.
 * 
 * Queue juga support ting-tong (type: 'sound') agar tidak tumpuk dengan voice.
 * Urutan: ting-tong → voice → ting-tong → voice → ...
 * 
 * @param {string} text - Teks yang akan diucapkan
 */
const _speechQueue = [];
let _isSpeaking = false;

/**
 * Tambahkan ting-tong + voice ke queue secara berurutan.
 * Dipanggil dari monitor.js saat ada panggilan baru.
 * @param {string} text
 * @param {boolean} withSound - true = ting-tong dulu sebelum voice
 */
function queueAnnouncement(text, withSound = false) {
    if (withSound) {
        _speechQueue.push({ type: 'sound' });
    }
    _speechQueue.push({ type: 'speech', text });
    
    if (!_isSpeaking) {
        _processSpeechQueue();
    }
}

// Backward compat: speakAnnouncement tanpa ting-tong
function speakAnnouncement(text) {
    queueAnnouncement(text, false);
}

function _processSpeechQueue() {
    if (_speechQueue.length === 0) {
        _isSpeaking = false;
        return;
    }
    
    _isSpeaking = true;
    const item = _speechQueue.shift();
    
    if (item.type === 'sound') {
        // Ting-tong: tunggu selesai lalu proses berikutnya
        playNotificationSound().then(() => {
            _isSpeaking = false;
            _processSpeechQueue();
        });
        return;
    }
    
    // item.type === 'speech'
    const text = item.text;
    if (!window.speechSynthesis) {
        _isSpeaking = false;
        _processSpeechQueue();
        return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'id-ID';
    utterance.rate = _voiceRate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    utterance.onend = () => {
        _isSpeaking = false;
        _processSpeechQueue();
    };
    
    utterance.onerror = () => {
        _isSpeaking = false;
        _processSpeechQueue();
    };

    const trySpeak = () => {
        const voices = window.speechSynthesis.getVoices();

        let chosen = voices.find(v => v.lang && v.lang.startsWith('id') && !v.localService);
        if (!chosen) chosen = voices.find(v => v.lang && v.lang.startsWith('id'));
        if (_selectedVoiceURI) {
            const manual = voices.find(v => v.voiceURI === _selectedVoiceURI);
            if (manual) chosen = manual;
        }

        if (chosen) utterance.voice = chosen;
        window.speechSynthesis.speak(utterance);
        
        // Chrome bug workaround: resume kalau pause sendiri
        const resumeTimer = setInterval(() => {
            if (!window.speechSynthesis.speaking) {
                clearInterval(resumeTimer);
                return;
            }
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
            }
        }, 10000);
        
        utterance.addEventListener('end', () => clearInterval(resumeTimer), { once: true });
        utterance.addEventListener('error', () => clearInterval(resumeTimer), { once: true });
    };

    if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.onvoiceschanged = null;
            trySpeak();
        };
    } else {
        trySpeak();
    }
}

/**
 * Hentikan semua suara dan kosongkan antrian.
 * Dipanggil saat voice dimatikan dari UI.
 */
function cancelAllSpeech() {
    _speechQueue.length = 0;
    _isSpeaking = false;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
}

// State untuk konfigurasi voice (bisa diubah dari UI)
let _voiceRate = 0.9;          // Rate optimal: cukup lambat tapi tidak patah-patah
let _selectedVoiceURI = null;  // null = otomatis pilih terbaik

/**
 * Kembalikan daftar semua voice yang tersedia (untuk UI selector).
 */
function getAvailableVoices() {
    return window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}


// ============================================
// Utility functions
// ============================================
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatCurrency(amount) {
    return 'Rp ' + amount.toLocaleString('id-ID');
}

/**
 * BUG-022 FIX: Safe integer parser. Selalu return non-negative int.
 */
function safeParseInt(val, defaultVal = 0) {
    const n = parseInt(val);
    if (isNaN(n) || n < 0) return defaultVal;
    return n;
}

/**
 * BUG-046 FIX: Extract jumlah Rupiah dari string (e.g. "Rp 40.000").
 */
function parseRupiah(str) {
    if (!str) return 0;
    const m = String(str).match(/Rp\s*([\d.,]+)/);
    if (!m) return 0;
    const digits = m[1].replace(/\D/g, '');
    return safeParseInt(digits);
}

function getStatusBadgeClass(status) {
    switch(status) {
        case STATUS.MENUNGGU: return 'badge-waiting';
        case STATUS.DIPANGGIL: return 'badge-called';
        case STATUS.SELESAI: return 'badge-done';
        case STATUS.BATAL: return 'badge-cancelled';
        default: return '';
    }
}

function getStatusText(status) {
    switch(status) {
        case STATUS.MENUNGGU: return '⏳ Menunggu';
        case STATUS.DIPANGGIL: return '📢 Dipanggil';
        case STATUS.SELESAI: return '✅ Selesai';
        case STATUS.BATAL: return '❌ Batal';
        default: return status;
    }
}

/**
 * Sanitize user input — strip HTML tags, trim, escape special chars, dan limit length.
 * BUG-040 FIX: regex lama bisa di-bypass dengan partial tag (e.g. `<img src=x` tanpa `>`).
 * Sekarang strip ALL angle brackets + escape entities.
 * @param {string} input
 * @param {number} maxLength
 * @returns {string}
 */
function sanitizeInput(input, maxLength = 100) {
    if (!input) return '';
    return String(input)
        .replace(/<[^>]*>?/g, '')      // strip HTML tags (termasuk yang tidak ditutup)
        .replace(/[<>]/g, '')           // strip sisa angle brackets liar
        .replace(/javascript:/gi, '')   // strip javascript: scheme
        .replace(/on\w+\s*=/gi, '')     // strip event handlers (onclick=, onerror=, dll)
        .trim()
        .slice(0, maxLength);
}

/**
 * Escape HTML untuk render aman di innerHTML / template literal.
 * BUG-018/019 FIX: helper global agar konsisten dipakai di semua dashboard.
 * @param {*} str
 * @returns {string}
 */
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

/**
 * Escape untuk dipakai di HTML attribute (e.g. value="..." atau onclick="...('${id}')")
 */
function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
