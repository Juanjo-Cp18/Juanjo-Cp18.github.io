document.addEventListener('DOMContentLoaded', () => {
    // Elementos del DOM
    const fileInput = document.getElementById('icsFile');
    const dateSelect = document.getElementById('dateSelect');
    const configBtn = document.getElementById('toggleConfigBtn');
    const configPanel = document.getElementById('configPanel');
    const messageTemplate = document.getElementById('messageTemplate');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const resultsSection = document.getElementById('resultsSection');
    const eventsList = document.getElementById('eventsList');
    const eventCount = document.getElementById('eventCount');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const fileLabel = document.querySelector('.file-custom-label');

    // Manual Send Elements
    const toggleManualBtn = document.getElementById('toggleManualBtn');
    const manualPanel = document.getElementById('manualPanel');
    const manualPhone = document.getElementById('manualPhone');
    const manualMessage = document.getElementById('manualMessage');
    const manualSendBtn = document.getElementById('manualSendBtn');

    // Modal elementos
    const helpBtn = document.getElementById('helpBtn');
    const helpModal = document.getElementById('helpModal');
    const closeBtnTop = document.querySelector('.close-modal-top');
    const closeBtnBottom = document.querySelector('.close-modal-bottom');

    // Estado local
    let rawEvents = [];

    // Cargar configuración guardada
    const savedTemplate = localStorage.getItem('saFusioTemplate');
    if (savedTemplate) {
        messageTemplate.value = savedTemplate;
    }

    // Configuración inicial de fecha
    const today = new Date().toISOString().split('T')[0];
    dateSelect.value = today;

    // Event Listeners
    configBtn.addEventListener('click', () => {
        configPanel.classList.toggle('hidden');
    });

    // Manual Send Toggle
    toggleManualBtn.addEventListener('click', () => {
        manualPanel.classList.toggle('hidden');
        if (!manualPanel.classList.contains('hidden')) {
            populateManualMessage();
        }
    });

    function populateManualMessage() {
        const template = messageTemplate.value;
        const selectedDateStr = dateSelect.value;
        let dateStr = '...';

        if (selectedDateStr) {
            const date = new Date(selectedDateStr);
            dateStr = date.toLocaleDateString();
        }

        // Reemplazamos fecha, y dejamos hora como placeholder para que el usuario la ponga
        let message = template.replace('{fecha}', dateStr).replace('{hora}', '...');
        manualMessage.value = message;
        updateManualLink();
    }

    // Manual Send Logic
    function updateManualLink() {
        const phone = manualPhone.value.replace(/\D/g, '');
        const message = encodeURIComponent(manualMessage.value);

        if (phone.length >= 9) {
            manualSendBtn.href = `https://web.whatsapp.com/send?phone=${phone}&text=${message}`;
            manualSendBtn.classList.remove('disabled');
        } else {
            manualSendBtn.href = '#';
            manualSendBtn.classList.add('disabled');
        }
    }

    manualPhone.addEventListener('input', updateManualLink);
    manualMessage.addEventListener('input', updateManualLink);

    // Modal Listeners - Lógica simplificada y robusta
    function openModal() {
        // Es vital quitar la clase hidden porque tiene !important
        helpModal.classList.remove('hidden');
        helpModal.style.display = 'flex';
    }

    function closeModal() {
        helpModal.classList.add('hidden');
        helpModal.style.display = 'none';
    }

    helpBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
    });

    // Asignar eventos de cierre directamente
    if (closeBtnTop) {
        closeBtnTop.onclick = (e) => {
            e.preventDefault();
            closeModal();
        };
    }

    if (closeBtnBottom) {
        closeBtnBottom.onclick = (e) => {
            e.preventDefault();
            closeModal();
        };
    }

    // Cerrar al hacer clic fuera
    window.onclick = (e) => {
        if (e.target === helpModal) {
            closeModal();
        }
    };

    saveConfigBtn.addEventListener('click', () => {
        const template = messageTemplate.value;
        localStorage.setItem('saFusioTemplate', template);

        // Feedback visual simple
        const originalText = saveConfigBtn.textContent;
        saveConfigBtn.textContent = '¡Guardado! ✅';
        setTimeout(() => {
            saveConfigBtn.textContent = originalText;
        }, 2000);

        renderEvents(); // Re-renderizar por si cambió algo
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            fileLabel.textContent = file.name;
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result;
                rawEvents = parseICS(content);
                renderEvents();
            };
            reader.readAsText(file);
        }
    });

    dateSelect.addEventListener('change', () => {
        renderEvents();
        if (!manualPanel.classList.contains('hidden')) {
            populateManualMessage();
        }
    });

    messageTemplate.addEventListener('input', () => {
        renderEvents();
        // Opcional: actualizar manual si está abierto, pero cuidado con sobrescribir
        // Decisión: No sobrescribir mientras escribe, solo al abrir o cambiar fecha.
    });

    selectAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.select-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
    });

    // Función principal de Parsing ICS
    function parseICS(content) {
        const events = [];
        const lines = content.split(/\r\n|\n|\r/);
        let currentEvent = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith('BEGIN:VEVENT')) {
                currentEvent = {};
            } else if (line.startsWith('END:VEVENT')) {
                if (currentEvent) events.push(currentEvent);
                currentEvent = null;
            } else if (currentEvent) {
                if (line.startsWith('DTSTART')) {
                    const value = line.split(':')[1];
                    currentEvent.start = parseICSDate(value);
                } else if (line.startsWith('SUMMARY:')) {
                    currentEvent.summary = line.substring(8);
                } else if (line.startsWith('DESCRIPTION:')) {
                    currentEvent.description = line.substring(12);
                }
            }
        }
        return events;
    }

    function parseICSDate(icsDateString) {
        if (!icsDateString) return null;
        const year = icsDateString.substring(0, 4);
        const month = icsDateString.substring(4, 6);
        const day = icsDateString.substring(6, 8);
        const hour = icsDateString.substring(9, 11);
        const minute = icsDateString.substring(11, 13);

        let dateIso = `${year}-${month}-${day}T${hour}:${minute}:00`;

        if (icsDateString.endsWith('Z')) {
            dateIso += 'Z';
        }

        return new Date(dateIso);
    }

    function extractPhone(text) {
        if (!text) return '';
        const phoneRegex = /(?:\+34|0034)?[\s\.-]*[6789](?:[\s\.-]*\d){8}/g;
        const matches = text.match(phoneRegex);
        return matches ? matches[0].replace(/\D/g, '') : '';
    }

    function renderEvents() {
        const selectedDateStr = dateSelect.value;
        if (!selectedDateStr || rawEvents.length === 0) return;

        const selectedDate = new Date(selectedDateStr);

        const filteredEvents = rawEvents.filter(event => {
            if (!event.start) return false;
            return event.start.toDateString() === selectedDate.toDateString();
        });

        filteredEvents.sort((a, b) => a.start - b.start);

        eventsList.innerHTML = '';
        eventCount.textContent = filteredEvents.length;

        if (filteredEvents.length > 0) {
            resultsSection.classList.remove('hidden');
        } else {
            resultsSection.classList.add('hidden');
        }

        filteredEvents.forEach((event, index) => {
            const timeStr = event.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = event.start.toLocaleDateString();

            let phone = extractPhone(event.description) || extractPhone(event.summary);

            let template = messageTemplate.value;
            let message = template.replace('{fecha}', dateStr).replace('{hora}', timeStr);
            let encodedMessage = encodeURIComponent(message);

            const card = document.createElement('div');
            card.className = 'event-card';

            const whatsappLink = phone
                ? `https://web.whatsapp.com/send?phone=${phone}&text=${encodedMessage}`
                : '#';

            const btnClass = phone ? 'whatsapp-btn' : 'whatsapp-btn disabled';

            card.innerHTML = `
                <div class="event-info">
                    <div class="event-time">${timeStr}</div>
                    <div class="event-desc"><strong>${event.summary || 'Sin título'}</strong></div>
                    <div class="event-phone">
                        <span>📱</span>
                        <input type="text" class="phone-input" value="${phone}" placeholder="Añadir teléfono" data-index="${index}">
                    </div>
                </div>
                <div class="event-actions">
                    <input type="checkbox" class="select-checkbox" checked>
                    <a href="${whatsappLink}" target="_blank" class="${btnClass}" id="btn-${index}">
                        Enviar WhatsApp 🚀
                    </a>
                </div>
            `;

            eventsList.appendChild(card);

            const phoneInput = card.querySelector('.phone-input');
            const sendBtn = card.querySelector(`#btn-${index}`);

            phoneInput.addEventListener('input', (e) => {
                const newPhone = e.target.value.replace(/\D/g, '');
                if (newPhone.length >= 9) {
                    sendBtn.href = `https://web.whatsapp.com/send?phone=${newPhone}&text=${encodedMessage}`;
                    sendBtn.classList.remove('disabled');
                } else {
                    sendBtn.href = '#';
                    sendBtn.classList.add('disabled');
                }
            });
        });
    }
});
