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
function playNotificationSound() {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
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
    gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.9);
    osc2.start(audioCtx.currentTime + 0.3);
    osc2.stop(audioCtx.currentTime + 0.9);
}

// ============================================
// Voice Announcement (Text-to-Speech)
// ============================================

/**
 * Ucapkan teks pengumuman via Web Speech API (TTS).
 * Membutuhkan interaksi user sebelumnya agar browser mengizinkan audio.
 * @param {string} text - Teks yang akan diucapkan
 */
function speakAnnouncement(text) {
    if (!window.speechSynthesis) return;

    // Hentikan ucapan yang sedang berjalan
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'id-ID';
    utterance.rate = _voiceRate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const trySpeak = () => {
        const voices = window.speechSynthesis.getVoices();

        // Prioritas 1: Voice id-ID yang Online/Neural (kualitas terbaik)
        // Chrome: "Google Bahasa Indonesia", Edge: "Microsoft Andika Online"
        let chosen = voices.find(v =>
            v.lang && v.lang.startsWith('id') && !v.localService
        );

        // Prioritas 2: Semua voice id-ID (termasuk offline)
        if (!chosen) chosen = voices.find(v => v.lang && v.lang.startsWith('id'));

        // Prioritas 3: Voice yang dipilih manual lewat UI
        if (_selectedVoiceURI) {
            const manual = voices.find(v => v.voiceURI === _selectedVoiceURI);
            if (manual) chosen = manual;
        }

        if (chosen) utterance.voice = chosen;
        window.speechSynthesis.speak(utterance);
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
 * Sanitize user input — strip HTML tags, trim, and limit length.
 * @param {string} input
 * @param {number} maxLength
 * @returns {string}
 */
function sanitizeInput(input, maxLength = 100) {
    if (!input) return '';
    return input.replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}
