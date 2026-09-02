// ============================================================
// toast.js — Universal Toast (tema OSIS neo-brutalist)
// Usage:
//   showToast('Tersimpan!')                    → success (default)
//   showToast('Ada yang salah nih', 'info')    → info (kuning)
//   showToast('Gagal', 'error')                → error (merah)
// ============================================================

(function () {
    let _container = null;

    function _getContainer() {
        if (_container && document.body.contains(_container)) return _container;
        _container = document.createElement('div');
        _container.id = 'toast-container';
        document.body.appendChild(_container);
        return _container;
    }

    window.showToast = function (msg, type = 'success') {
        const finalMsg = msg || 'Selesai';
        const container = _getContainer();

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icon = type === 'success'
            ? '<i class="fa-solid fa-circle-check"></i>'
            : type === 'error'
            ? '<i class="fa-solid fa-circle-exclamation"></i>'
            : '<i class="fa-solid fa-circle-info"></i>';

        toast.innerHTML = `${icon}<span>${finalMsg}</span>`;
        container.appendChild(toast);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => toast.classList.add('toast-show'));
        });

        const dismiss = () => {
            toast.classList.remove('toast-show');
            toast.classList.add('toast-hide');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        };

        const timer = setTimeout(dismiss, 2800);
        toast.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
    };
})();
