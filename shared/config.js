// ============================================
// Supabase Configuration - AntriPhotobooth
// ============================================

const SUPABASE_URL = 'https://mkxwbobcptdqnntqgzdl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1reHdib2JjcHRkcW5udHFnemRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyOTMwMzUsImV4cCI6MjA5Mzg2OTAzNX0.R1apR-zFUsVA17IVKbBDMIvIPLy0kWbLe8vTvEaqwiw';

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
// Utility functions
// ============================================
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getStatusBadgeClass(status) {
    switch(status) {
        case 'menunggu': return 'badge-waiting';
        case 'dipanggil': return 'badge-called';
        case 'selesai': return 'badge-done';
        case 'batal': return 'badge-cancelled';
        default: return '';
    }
}

function getStatusText(status) {
    switch(status) {
        case 'menunggu': return '⏳ Menunggu';
        case 'dipanggil': return '📢 Dipanggil';
        case 'selesai': return '✅ Selesai';
        case 'batal': return '❌ Batal';
        default: return status;
    }
}
