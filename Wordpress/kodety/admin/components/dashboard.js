/* global document, window */

(() => {
  'use strict';

  const body = document.body;

  const adminUiLocale = () => window.kodetyAdminI18n?.locale
    || document.documentElement.dataset.kodetyUiLocale
    || document.documentElement.lang
    || 'pt-BR';

  if (!body?.classList.contains('index-php')) return;

  const mountIcon = (name, className = '') => {
    const icon = document.createElement('span');
    icon.className = `kodety-dashboard-icon${className ? ` ${className}` : ''}`;
    icon.dataset.kodetyIcon = name;
    icon.setAttribute('aria-hidden', 'true');
    window.KodetyIcons?.mount?.(icon, name);
    return icon;
  };

  const readableSiteName = (copy) => {
    const value = String(copy || '')
      .replace(/^Visão geral de\s+/i, '')
      .replace(/\.$/, '');
    return value || 'seu site';
  };

  const enhanceHeader = (root) => {
    const header = root.querySelector('.kodety-control-head');
    const copy = header?.querySelector(':scope > div');
    const kicker = copy?.querySelector('.kodety-control-kicker');
    const title = copy?.querySelector('h2');
    const description = copy?.querySelector('p');
    const actions = header?.querySelector('.kodety-control-actions');
    if (!header || !copy || !kicker || !title || !description || !actions) return;

    const siteName = readableSiteName(description.textContent);

    kicker.textContent = '';
    kicker.classList.add('kodety-dashboard-breadcrumb');
    const area = document.createElement('span');
    area.textContent = 'Onun Kodety';
    const separator = mountIcon('chevron-right');
    const page = document.createElement('strong');
    page.textContent = 'Painel';
    kicker.append(area, separator, page);

    title.textContent = 'Visão geral';
    description.textContent = `Acompanhe o conteúdo e a saúde de ${siteName}.`;

    const controls = document.createElement('div');
    controls.className = 'kodety-dashboard-controls';

    const now = new Date();
    const date = document.createElement('time');
    date.className = 'kodety-dashboard-period';
    date.dateTime = now.toISOString();
    date.append(
      mountIcon('calendar'),
      document.createTextNode(
        new Intl.DateTimeFormat(adminUiLocale(), {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }).format(now),
      ),
    );

    const refresh = document.createElement('button');
    refresh.className = 'kodety-dashboard-refresh';
    refresh.type = 'button';
    const refreshLabel = document.createElement('span');
    refreshLabel.textContent = 'Atualizar';
    refresh.append(mountIcon('refresh'), refreshLabel);

    const refreshStatus = document.createElement('span');
    refreshStatus.className = 'screen-reader-text';
    refreshStatus.setAttribute('role', 'status');
    refreshStatus.setAttribute('aria-live', 'polite');
    refresh.addEventListener('click', () => {
      refresh.classList.add('is-loading');
      refresh.disabled = true;
      refresh.setAttribute('aria-busy', 'true');
      refreshLabel.textContent = 'Atualizando…';
      refreshStatus.textContent = 'Atualizando os dados do painel.';
      window.location.reload();
    });

    controls.append(date, refresh, refreshStatus);

    const side = document.createElement('div');
    side.className = 'kodety-control-head-side';
    actions.remove();
    side.append(controls);
    header.appendChild(side);
  };

  const enhanceMetrics = (root) => {
    const metrics = Array.from(root.querySelectorAll('.kodety-control-metric'));
    metrics.forEach((metric, index) => {
      metric.classList.add(`is-metric-${index + 1}`);
      if (index === 0) metric.classList.add('is-featured');

      const arrow = mountIcon('chevron-right', 'kodety-metric-arrow');
      metric.append(arrow);
    });
  };

  const rowKind = (row) => {
    const type = String(row.querySelector('.kodety-content-main small')?.textContent || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR');
    return type.includes('pagina') ? 'page' : 'post';
  };

  const enhanceActivity = (panel) => {
    if (!panel) return;
    panel.id = 'kodety-dashboard-activity';
    panel.classList.add('kodety-activity-panel');

    const head = panel.querySelector('.kodety-control-panel-head');
    const title = head?.querySelector('h3');
    const description = head?.querySelector('p');
    if (title) title.textContent = 'Atividade de conteúdo';
    if (description) description.textContent = 'Páginas e posts alterados recentemente';

    const rows = Array.from(panel.querySelectorAll('.kodety-content-row'));
    rows.forEach((row) => {
      row.dataset.kind = rowKind(row);
      const time = row.querySelector('time');
      if (time && time.textContent && !/atrás$/i.test(time.textContent.trim())) {
        time.textContent = `${time.textContent.trim()} atrás`;
      }
    });

    if (!rows.length) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'kodety-activity-toolbar';

    const filters = document.createElement('div');
    filters.className = 'kodety-activity-filters';
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filtrar atividade');

    const status = document.createElement('span');
    status.className = 'kodety-activity-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const choices = [
      ['all', 'Tudo'],
      ['page', 'Páginas'],
      ['post', 'Posts'],
    ];

    const applyFilter = (kind) => {
      let visible = 0;
      rows.forEach((row) => {
        const shouldShow = kind === 'all' || row.dataset.kind === kind;
        row.hidden = !shouldShow;
        if (shouldShow) visible += 1;
      });

      filters.querySelectorAll('button').forEach((button) => {
        const current = button.dataset.filter === kind;
        button.classList.toggle('is-current', current);
        button.setAttribute('aria-pressed', String(current));
      });
      status.textContent = `${visible} ${visible === 1 ? 'item' : 'itens'}`;
    };

    choices.forEach(([kind, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.filter = kind;
      button.textContent = label;
      button.addEventListener('click', () => applyFilter(kind));
      filters.appendChild(button);
    });

    toolbar.append(filters, status);
    head?.insertAdjacentElement('afterend', toolbar);
    applyFilter('all');
  };

  const enhancePanels = (root) => {
    const grid = root.querySelector('.kodety-control-grid');
    if (!grid) return;

    const panels = Array.from(grid.querySelectorAll(':scope > .kodety-control-panel'));
    const activity = panels[0];

    enhanceActivity(activity);
    panels.slice(1).forEach((panel) => panel.remove());
  };

  const enhance = () => {
    const root = document.querySelector('.kodety-control-center');
    if (!root || root.dataset.kodetyDashboardEnhanced === 'true') return;
    root.id = 'kodety-dashboard-overview';
    root.dataset.kodetyDashboardEnhanced = 'true';
    root.classList.add('kodety-dashboard');

    enhanceHeader(root);
    enhanceMetrics(root);
    enhancePanels(root);
    window.KodetyIcons?.scan?.(root);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance, { once: true });
  } else {
    enhance();
  }
})();
