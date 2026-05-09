// ============================================
// Shared UI Components — AntriPhotobooth
// ============================================

/**
 * Show a popup modal dialog.
 * @param {string} title - Popup title
 * @param {string} message - HTML body content
 * @param {boolean} isError - If true, uses red background for title
 */
function showPopup(title, message, isError = false) {
    const color = isError ? 'bg-neoRed' : 'bg-neoYellow';
    const titleEl = document.getElementById('popup-title');
    titleEl.textContent = title;
    titleEl.className = `text-xl font-black uppercase tracking-tight border-b-4 border-black pb-1 mb-4 inline-block pr-4 ${color}`;
    document.getElementById('popup-body').innerHTML = message;

    document.getElementById('popup-actions').innerHTML = `
        <button onclick="closePopup()" class="flex-1 bg-black text-white font-black uppercase px-4 py-3 hover:bg-neoCyan hover:text-black transition-colors border-4 border-black shadow-[4px_4px_0px_0px_#000] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_#000]">TUTUP</button>
    `;

    _openPopup();
}

/**
 * Show a confirmation dialog with Cancel and Confirm buttons.
 * @param {string} title
 * @param {string} message - HTML body content
 * @param {string} confirmText - Text for the confirm button
 * @param {Function} onConfirm - Callback when user confirms
 */
function showConfirm(title, message, confirmText, onConfirm) {
    const titleEl = document.getElementById('popup-title');
    titleEl.textContent = title;
    titleEl.className = `text-xl font-black uppercase tracking-tight border-b-4 border-black pb-1 mb-4 inline-block pr-4 bg-neoPink`;
    document.getElementById('popup-body').innerHTML = message;

    document.getElementById('popup-actions').innerHTML = `
        <button onclick="closePopup()" class="flex-1 bg-white text-black font-black uppercase px-4 py-3 hover:bg-gray-200 transition-colors border-4 border-black shadow-[4px_4px_0px_0px_#000] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_#000]">BATAL</button>
        <button id="btn-confirm-action" class="flex-1 bg-neoRed text-black font-black uppercase px-4 py-3 hover:bg-black hover:text-white transition-colors border-4 border-black shadow-[4px_4px_0px_0px_#000] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_#000]">${confirmText}</button>
    `;

    document.getElementById('btn-confirm-action').onclick = () => {
        closePopup();
        onConfirm();
    };

    _openPopup();
}

/**
 * Close the popup modal.
 */
function closePopup() {
    const popup = document.getElementById('custom-popup');
    const content = document.getElementById('popup-content');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => popup.classList.add('hidden'), 200);
}

/**
 * Show a toast notification (slides from top).
 * @param {string} title
 * @param {string} body
 */
function showToast(title, body) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'bg-neoCyan border-4 border-black p-4 shadow-[4px_4px_0px_0px_#000] transform transition-all duration-300 -translate-y-[150%] opacity-0 pointer-events-auto cursor-pointer';
    toast.innerHTML = `
        <div class="font-black uppercase text-lg mb-1 leading-tight">${_sanitizeHTML(title)}</div>
        <div class="font-bold text-sm leading-tight">${_sanitizeHTML(body)}</div>
    `;

    toast.onclick = () => toast.remove();
    container.appendChild(toast);

    requestAnimationFrame(() => {
        setTimeout(() => toast.classList.remove('-translate-y-[150%]', 'opacity-0'), 50);
    });

    setTimeout(() => {
        toast.classList.add('-translate-y-[150%]', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 6000);
}

// --- Internal helpers ---

function _openPopup() {
    const popup = document.getElementById('custom-popup');
    const content = document.getElementById('popup-content');
    popup.classList.remove('hidden');
    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });
}

/**
 * Basic HTML sanitization to prevent XSS in toast messages.
 */
function _sanitizeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Returns the standard popup modal HTML to be inserted into pages.
 * Call this from your page JS or include the markup directly.
 */
function getPopupModalHTML() {
    return `
    <div id="custom-popup"
        class="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 hidden transition-opacity duration-200">
        <div class="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] p-6 max-w-sm w-full transform transition-all duration-300 scale-95 opacity-0"
            id="popup-content">
            <h2 id="popup-title"
                class="text-xl font-black uppercase tracking-tight border-b-4 border-black pb-1 mb-4 inline-block pr-4">
                Perhatian</h2>
            <div id="popup-body" class="font-bold mb-6 text-sm leading-relaxed"></div>
            <div id="popup-actions" class="flex gap-3">
                <button onclick="closePopup()"
                    class="flex-1 bg-black text-white font-black uppercase px-4 py-3 hover:bg-neoCyan hover:text-black transition-colors border-4 border-black shadow-[4px_4px_0px_0px_#000] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_#000]">TUTUP</button>
            </div>
        </div>
    </div>`;
}
