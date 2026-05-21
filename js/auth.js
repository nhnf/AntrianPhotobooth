// ============================================
// Auth Module — AntriPhotobooth
// ============================================

/**
 * Check if user is authenticated and has required role.
 * Redirect to login or appropriate dashboard if not allowed.
 * @param {string[]} allowedRoles Array of allowed roles (e.g. ['admin', 'foto'])
 * @returns {Promise<{user: object, profile: object}|null>} 
 */
async function checkAuthWithRole(allowedRoles = []) {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) {
        window.location.href = 'index.html';
        return null;
    }

    const profile = await getUserProfile(session.user.id);
    const userRole = profile ? profile.role : 'foto'; // fallback

    if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
        // Redirect to their default dashboard
        window.location.href = getRedirectByRole(userRole);
        return null;
    }

    return { user: session.user, profile };
}

/**
 * Fetch user profile to get the role
 * @param {string} userId 
 */
async function getUserProfile(userId) {
    const { data, error } = await supabaseClient
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();
    
    if (error) {
        console.error("Error fetching profile:", error);
        return null;
    }
    return data;
}

/**
 * Get the default dashboard URL based on role
 * @param {string} role 
 */
function getRedirectByRole(role) {
    switch (role) {
        case 'admin': return 'sekretariat.html';
        case 'foto': return 'admin.html';
        case 'pengambilan': return 'pengambilan.html';
        default: return 'admin.html';
    }
}

/**
 * Check if user is authenticated. Redirect to login if not. (Legacy)
 */
async function checkAuth() {
    return checkAuthWithRole(); // default no role check
}

/**
 * Login with email and password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, error?: string, role?: string}>}
 */
async function loginWithEmail(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        return { success: false, error: error.message };
    }

    const profile = await getUserProfile(data.user.id);
    const role = profile ? profile.role : 'foto';

    return { success: true, role };
}

/**
 * Logout the current user and redirect to login page.
 */
async function logout() {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
}

/**
 * Get the current session (useful for checking login state).
 * @returns {Promise<object|null>}
 */
async function getSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
}
