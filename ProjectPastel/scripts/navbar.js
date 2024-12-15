async function loadNavbar() {
    try {
        // Dynamically detect base path
        const basePath = window.location.pathname.replace(/\/[^/]*$/, '/');
        const response = await fetch(`${basePath}navbar.html`);
        if (!response.ok) throw new Error('Failed to load navbar');
        const navbarHTML = await response.text();
        document.getElementById('navbar-placeholder').innerHTML = navbarHTML;
    } catch (error) {
        console.error('Error loading navbar:', error);
    }
}
document.addEventListener('DOMContentLoaded', loadNavbar);
