/* Tools layouts are downloaded only on WordPress Tools screens. */
window.KodetyNativeTools = ({ body, wrap, config, header, text, create, icon, direct }) => {
if (!body.matches('.tools-php,.import-php,.export-php,.site-health-php,.export-personal-data-php,.erase-personal-data-php')) return;
      wrap.classList.add('kdw-tools-workspace');
      const navigation = create('nav', 'kdw-tools-nav');
      navigation.setAttribute('aria-label', text('Ferramentas do WordPress', 'WordPress tools'));
      const routes = [
        ['tools.php',text('Visão geral','Overview'),'tools',text('Recursos de manutenção do WordPress.','WordPress maintenance resources.')],
        ['import.php',text('Importar','Import'),'upload',text('Traga conteúdo de outra plataforma.','Bring content from another platform.')],
        ['export.php',text('Exportar','Export'),'download',text('Transfira o conteúdo para outro site.','Transfer content to another site.')],
        ['site-health.php',text('Diagnóstico','Site health'),'shield',text('Confira a configuração e a saúde do site.','Review the configuration and health of your site.')],
        ['export-personal-data.php',text('Exportar dados pessoais','Export personal data'),'users',text('Gerencie solicitações de acesso aos dados.','Manage requests to access personal data.')],
        ['erase-personal-data.php',text('Apagar dados pessoais','Erase personal data'),'trash',text('Gerencie solicitações de remoção de dados.','Manage requests to remove personal data.')],
      ];
      const available = routes.filter(([route]) => document.querySelector(`#menu-tools a[href="${route}"]`));
      available.forEach(([route,label]) => {
        const link = create('a','',label);
        link.href = new URL(route, config.adminUrl).href;
        if (window.location.pathname.endsWith('/'+route)) link.setAttribute('aria-current','page');
        navigation.append(link);
      });
      if (navigation.children.length) (header || wrap.querySelector('h1'))?.after(navigation);
      if (body.classList.contains('tools-php')) {
        const grid = create('div','kdw-tools-grid');
        available.slice(1).forEach(([route,label,symbol,description]) => {
          const link = create('a','kdw-tool-link');
          link.href = new URL(route,config.adminUrl).href;
          const copy = create('div');
          copy.append(create('strong','',label),create('p','',description));
          link.append(icon(symbol),copy,icon('arrow-right'));
          grid.append(link);
        });
        navigation.after(grid);
      }
      if (body.classList.contains('export-php')) {
        const notes = create('details','kdw-tools-notes');
        notes.append(create('summary','',text('Como funciona a exportação','How export works')));
        direct(wrap,'p').forEach(node=>notes.append(node));
        if (notes.children.length > 1) navigation.after(notes);
        const form = wrap.querySelector('form');
        const title = direct(wrap,'h2')[0];
        if (title && form) form.prepend(title);
        form?.querySelectorAll('fieldset > p').forEach(line=>{if(line.querySelector('input[type="radio"]'))line.classList.add('kdw-export-choice');});
      }
      const importers = wrap.querySelector('table.importers');
      if (importers) {
        const card = create('section', 'kdw-importers');
        importers.before(card);
        card.append(importers);
        importers.querySelectorAll('tr.importer-item').forEach(row => {
          const system = row.querySelector('.import-system');
          const actions = row.querySelector('.importer-action');
          system?.prepend(icon('upload'));
          if (actions) {
            actions.childNodes.forEach(node=>{if(node.nodeType===3 && /^[\s|]*$/.test(node.textContent))node.textContent='';});
            const footer = create('td','kdw-importer-actions');
            footer.append(actions);
            row.append(footer);
          }
        });
      }
      for (const form of direct(wrap, 'form')) {
        if (!form.querySelector('.wp-list-table') && form.querySelector('input:not([type="hidden"]),select,textarea,button')) form.classList.add('kdw-tools-form');
      }
};
