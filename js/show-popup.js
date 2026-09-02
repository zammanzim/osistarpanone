/**
 * OSIS TARPAN ONE — UNIVERSAL POPUP SYSTEM
 * Pengganti alert()/confirm() dengan tema neo-brutalist.
 *
 * showPopup(msg, type) → Promise
 *   type: 'info' | 'success' | 'error' | 'confirm' | 'form'
 *
 * Contoh:
 *   await showPopup("Yakin hapus?", "confirm")  → true / false
 *   await showPopup("Gagal koneksi", "error")   → true (tombol OK)
 *   const nilai = await showPopup("Isi nama?", "form", { title: "Form", fields: [...] })
 */

window.showPopup = function (msg, type = 'info', options = {}) {
    return new Promise((resolve) => {
        // 1. Bersihkan popup lama jika ada
        const existing = document.getElementById('uniOverlay');
        if (existing) existing.remove();

        // 2. Buat elemen baru
        const overlay = document.createElement('div');
        overlay.id = 'uniOverlay';
        overlay.className = 'uni-overlay';

        // 3. Tentukan Icon & Tombol berdasarkan Tipe
        let iconHtml = '';
        let btnsHtml = '';
        let iconClass = 'uni-icon';
        let contentHtml = `<p class="uni-msg">${msg}</p>`;

        if (type === 'success') {
            iconClass += ' success';
            iconHtml = '<i class="fa-solid fa-check"></i>';
            btnsHtml = `<button class="uni-btn" id="uniBtnOk">OK</button>`;
        } else if (type === 'error') {
            iconClass += ' error';
            iconHtml = '<i class="fa-solid fa-xmark"></i>';
            btnsHtml = `<button class="uni-btn" id="uniBtnOk">OK</button>`;
        } else if (type === 'confirm') {
            iconClass += ' warning';
            iconHtml = '<i class="fa-solid fa-exclamation"></i>';
            btnsHtml = `
                <div class="uni-actions">
                    <button class="uni-btn-cancel" id="uniBtnNo">Tidak</button>
                    <button class="uni-btn-confirm" id="uniBtnYes">Iya</button>
                </div>
            `;
        } else if (type === 'form') {
            iconClass += ' info';
            iconHtml = options.icon || '<i class="fa-solid fa-pen-to-square"></i>';

            // Format fields: [{ name, label, type, placeholder, value, options }]
            const fields = options.fields || [{
                name: 'value',
                label: msg,
                type: 'text',
                placeholder: options.placeholder || '',
                value: options.value || ''
            }];

            const fieldsHtml = fields.map(f => {
                if (f.type === 'select') {
                    const optionsHtml = (f.options || []).map(opt => `
                        <option value="${opt.value}" ${opt.value === f.value ? 'selected' : ''}>${opt.label}</option>
                    `).join('');
                    return `
                        <div class="uni-form-group">
                            ${f.label ? `<label>${f.label}</label>` : ''}
                            <select id="uniInput_${f.name}" class="uni-input">
                                ${optionsHtml}
                            </select>
                        </div>
                    `;
                }
                return `
                    <div class="uni-form-group">
                        ${f.label ? `<label>${f.label}</label>` : ''}
                        <input type="${f.type || 'text'}"
                               id="uniInput_${f.name}"
                               placeholder="${f.placeholder || ''}"
                               value="${f.value || ''}"
                               class="uni-input"
                               autocomplete="off">
                    </div>
                `;
            }).join('');

            contentHtml = `
                <div class="uni-form-container">
                    ${options.title ? `<h3 class="uni-title">${options.title}</h3>` : ''}
                    ${!options.title ? `<p class="uni-msg">${msg}</p>` : ''}
                    ${fieldsHtml}
                </div>
            `;

            btnsHtml = `
                <div class="uni-actions">
                    <button class="uni-btn-cancel" id="uniBtnNo">Batal</button>
                    <button class="uni-btn-confirm" id="uniBtnYes">Simpan</button>
                </div>
            `;
        } else {
            iconClass += ' info';
            iconHtml = '<i class="fa-solid fa-info"></i>';
            btnsHtml = `<button class="uni-btn" id="uniBtnOk">OK</button>`;
        }

        // 4. Masukkan HTML
        overlay.innerHTML = `
            <div class="uni-box">
                <div class="${iconClass}">${iconHtml}</div>
                ${contentHtml}
                ${btnsHtml}
            </div>`;

        document.body.appendChild(overlay);

        // Animasi masuk + auto focus buat form
        setTimeout(() => {
            overlay.classList.add('active');
            if (type === 'form') {
                const firstInput = overlay.querySelector('input');
                if (firstInput) {
                    firstInput.focus();
                    firstInput.select();
                }
            }
        }, 10);

        // --- LOGIC PENUTUPAN ---
        const close = (result) => {
            overlay.classList.remove('active');
            document.removeEventListener('keydown', handleKey);

            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 250);

            if (type === 'form' && result === true) {
                const fields = options.fields || [{ name: 'value' }];
                const data = {};
                fields.forEach(f => {
                    const el = document.getElementById(`uniInput_${f.name}`);
                    if (el) data[f.name] = el.value;
                });
                resolve(fields.length === 1 ? Object.values(data)[0] : data);
            } else if (type === 'form' && result === false) {
                resolve(null);
            } else {
                resolve(result);
            }
        };

        // --- EVENT HANDLERS ---
        const handleKey = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                close(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (type === 'confirm' || type === 'form') close(false);
                else close(true);
            }
        };
        document.addEventListener('keydown', handleKey);

        if (type === 'confirm' || type === 'form') {
            document.getElementById('uniBtnYes').onclick = () => close(true);
            document.getElementById('uniBtnNo').onclick = () => close(false);
            overlay.onclick = (e) => { if (e.target === overlay) close(false); };
        } else {
            document.getElementById('uniBtnOk').onclick = () => close(true);
            overlay.onclick = (e) => { if (e.target === overlay) close(true); };
        }
    });
};

window.closePopup = function () {
    const overlay = document.getElementById('uniOverlay');
    if (overlay) overlay.click();
};
