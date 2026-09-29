(() => {
    'use strict';

    const initializeInstallFeedback = page => {
        const form = page?.querySelector('[data-kodety-update-install-form]');
        const button = form?.querySelector('button[type="submit"]');
        if (!form || !button || form.dataset.feedbackReady) return;
        form.dataset.feedbackReady = 'true';
        let idleLabel = '';
        let idleWidth = '';
        form.addEventListener('submit', event => {
            if (form.dataset.installing === 'true' || button.disabled) {
                event.preventDefault();
                return;
            }
            if (event.defaultPrevented) return;
            form.dataset.installing = 'true';
            idleLabel = button.textContent;
            idleWidth = button.style.width;
            button.style.width = `${button.getBoundingClientRect().width}px`;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            button.setAttribute('aria-label', 'Instalando atualização');
            const spinner = document.createElement('span');
            spinner.className = 'kodety-update-install-spinner';
            spinner.setAttribute('aria-hidden', 'true');
            button.replaceChildren(spinner);
            const checkButton = page.querySelector('[data-kodety-update-check-form]')?.querySelector('button[type="submit"]');
            if (checkButton) checkButton.disabled = true;
            // Keep the native authenticated POST and its server-side error handling.
        });
        window.addEventListener('pageshow', event => {
            if (!event.persisted || form.dataset.installing !== 'true') return;
            form.dataset.installing = 'false';
            button.textContent = idleLabel;
            button.style.width = idleWidth;
            button.disabled = false;
            button.setAttribute('aria-busy', 'false');
            button.removeAttribute('aria-label');
        });
    };

    const initializeUpdateCheck = () => {
        const page = document.querySelector('[data-kodety-updates-page]');
        initializeInstallFeedback(page);
        const navigation = page?.querySelector('.kodety-updates-nav');
        if (navigation && !navigation.dataset.ready) {
            navigation.dataset.ready = 'true';
            const links = Array.from(navigation.querySelectorAll('a[href^="#"]'));
            const updateLocation = () => {
                const current = links.find(link => link.hash === window.location.hash) || links[0];
                links.forEach(link => {
                    if (link === current) link.setAttribute('aria-current', 'location');
                    else link.removeAttribute('aria-current');
                });
            };
            window.addEventListener('hashchange', updateLocation);
            updateLocation();
        }
        if (!page || page.dataset.kodetyUpdatesReady || typeof window.fetch !== 'function'
            || typeof AbortController !== 'function') return;
        const checkUrl = page.dataset.kodetyUpdateCheckUrl;
        const nonce = page.dataset.kodetyUpdateNonce;
        const card = page.querySelector('#kodety-update-status');
        const checkForm = page.querySelector('[data-kodety-update-check-form]');
        const checkButton = checkForm?.querySelector('button[type="submit"]');
        const installForm = page.querySelector('[data-kodety-update-install-form]');
        const installButton = installForm?.querySelector('button[type="submit"]');
        const label = page.querySelector('[data-kodety-update-status-label]');
        const icon = page.querySelector('[data-kodety-update-status-icon]');
        const title = page.querySelector('#kodety-update-status-title');
        const copy = page.querySelector('[data-kodety-update-status-copy]');
        const notes = page.querySelector('[data-kodety-update-preview-notes]');
        const latestVersion = page.querySelector('[data-kodety-update-latest-version]');
        const checkedAt = page.querySelector('[data-kodety-update-checked-at]');
        if (!checkUrl || !nonce || !card || !checkForm || !checkButton || !installForm
            || !installButton || !label || !icon || !title || !copy || !notes || !latestVersion || !checkedAt) return;
        page.dataset.kodetyUpdatesReady = 'true';

        let checking = false;
        const idleButtonLabel = checkButton.textContent;
        const setStatus = (kind, statusLabel, statusTitle, statusCopy) => {
            for (const value of ['unchecked', 'available', 'current', 'error']) {
                card.classList.toggle(`kodety-updates-card--${value}`, value === kind);
            }
            window.KodetyIcons?.mount?.(icon, kind === 'error' ? 'warning' : kind === 'current' ? 'shield' : 'package');
            label.textContent = statusLabel;
            title.textContent = statusTitle;
            copy.textContent = statusCopy;
        };

        const checkForUpdates = async () => {
            if (checking || installForm.dataset.installing === 'true') return;
            checking = true;
            checkButton.disabled = true;
            checkButton.textContent = 'Verificando…';
            label.textContent = 'Verificando…';
            card.setAttribute('aria-busy', 'true');
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 20000);
            try {
                const response = await window.fetch(checkUrl, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json', 'X-WP-Nonce': nonce },
                    signal: controller.signal,
                });
                const status = await response.json().catch(() => null);
                if (installForm.dataset.installing === 'true') return;
                if (!response.ok) {
                    throw new Error(typeof status?.message === 'string' ? status.message : 'Não foi possível buscar atualizações.');
                }
                if (typeof status?.updateAvailable !== 'boolean' || typeof status.latestVersion !== 'string'
                    || !status.latestVersion || typeof status.checkedAtLabel !== 'string' || !status.checkedAtLabel) {
                    throw new Error('O servidor de atualizações do Onun Kodety respondeu de forma inesperada.');
                }
                const available = status.updateAvailable;
                setStatus(
                    available ? 'available' : 'current',
                    available ? 'Atualização disponível' : 'Tudo em dia',
                    available ? `Onun Kodety ${status.latestVersion} está pronto para instalar` : 'Você está usando a versão mais recente',
                    available
                        ? (typeof status.summary === 'string' && status.summary.trim() ? status.summary : 'Uma nova versão do Builder está pronta para instalar.')
                        : 'Nenhuma versão mais recente foi encontrada no canal oficial do Onun Kodety.',
                );
                latestVersion.textContent = status.latestVersion;
                checkedAt.textContent = status.checkedAtLabel;
                installForm.hidden = !available;
                installButton.disabled = !available;
                installButton.textContent = `Instalar versão ${status.latestVersion}`;
                const items = available && Array.isArray(status.changelog)
                    ? status.changelog.filter(item => typeof item === 'string').slice(0, 4)
                    : [];
                notes.replaceChildren(...items.map(item => {
                    const li = document.createElement('li');
                    li.textContent = item;
                    return li;
                }));
                notes.hidden = !items.length;
            } catch (error) {
                if (installForm.dataset.installing === 'true') return;
                setStatus('error', 'Verificação indisponível', 'Não foi possível verificar agora',
                    controller.signal.aborted
                        ? 'A verificação demorou mais que o esperado. Tente novamente.'
                        : error instanceof Error ? error.message : 'Não foi possível buscar atualizações.');
                notes.hidden = true;
            } finally {
                window.clearTimeout(timeout);
                checking = false;
                checkButton.disabled = installForm.dataset.installing === 'true';
                checkButton.textContent = idleButtonLabel;
                card.setAttribute('aria-busy', 'false');
            }
        };

        checkForm.addEventListener('submit', event => {
            event.preventDefault();
            void checkForUpdates();
        });
        window.addEventListener('pageshow', event => {
            if (event.persisted) void checkForUpdates();
        });
        void checkForUpdates();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeUpdateCheck, { once: true });
    } else {
        initializeUpdateCheck();
    }

    document.addEventListener('change', (event) => {
        const input = event.target instanceof HTMLInputElement
            ? event.target.closest('[data-kodety-upload-input]')
            : null;
        if (!(input instanceof HTMLInputElement) || !input.files?.length) return;
        const form = input.closest('[data-kodety-upload-form]');
        if (!(form instanceof HTMLFormElement)) return;

        const label = form.querySelector('[data-kodety-upload-label]');
        const text = form.querySelector('[data-kodety-upload-label-text]');
        label?.classList.add('is-uploading');
        label?.setAttribute('aria-disabled', 'true');
        if (text) text.textContent = 'Instalando ZIP…';
        form.submit();
    });
})();
