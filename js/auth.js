// ============================================
// Auth Module — AntriPhotobooth
// ============================================

/**
 * Check if user is authenticated. Redirect to login if not.
 * Call this at the top of protected pages (admin.html).
 * @returns {Promise<object|null>} The user object if authenticated
 */
async function checkAuth() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) {
        window.location.href = 'login.html';
        return null;
    }
    return session.user;
}

/**
 * Login with email and password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function loginWithEmail(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        return { success: false, error: error.message };
    }

    return { success: true };
}

/**
 * Logout the current user and redirect to login page.
 */
async function logout() {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

/**
 * Get the current session (useful for checking login state).
 * @returns {Promise<object|null>}
 */
async function getSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
}
