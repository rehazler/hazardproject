// ─────────────────────────────────────────────────────────────────────────────
// auth.js — session state wrapper
// Depends on: api-client.js (loaded before this script)
// ─────────────────────────────────────────────────────────────────────────────

const auth = (() => {
    let _session = null;

    return {
        // Call once at page load. Populates _session and subscribes to changes.
        async init() {
            _session = await API.getSession();
            API.onAuthChange(s => { _session = s; });
        },

        // Returns true if an authenticated editor session exists.
        isEditor() { return !!_session; },

        getSession() { return _session; },

        async signIn(email, password) {
            const result = await API.signIn(email, password);
            _session = result.session;
            return result;
        },

        async signOut() {
            await API.signOut();
            _session = null;
        },
    };
})();
