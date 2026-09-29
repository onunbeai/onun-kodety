/**
 * Biblioteca de seções e templates.
 *
 * Cada item insere blocos reais do modelo — depois de inserida, a seção é
 * indistinguível de uma montada à mão: mesmo inspetor, mesmo lint, mesmo
 * renderizador.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { Component } from '@/components/ui/gravity-icons';
import { Input } from '@/components/ui/input';
import {
  EMAIL_SECTION_CATEGORIES,
  EMAIL_SECTION_PRESETS,
  EMAIL_STARTER_TEMPLATES,
  type EmailSectionPreset,
} from '@/lib/email-editor/presets';
import { SECTION_MIME } from '@/lib/email-editor/dnd';
import type { EmailDocument } from '@/lib/email-editor/types';
import { cn } from '@/lib/utils';

interface EmailSectionLibraryProps {
  hasContent: boolean;
  onInsertSection: (preset: EmailSectionPreset) => void;
  onApplyTemplate: (document: EmailDocument) => void;
}

export default function EmailSectionLibrary({
  hasContent,
  onInsertSection,
  onApplyTemplate,
}: EmailSectionLibraryProps) {
  const [query, setQuery] = React.useState('');
  const [openCategories, setOpenCategories] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(EMAIL_SECTION_CATEGORIES.map((category) => [category.id, true])),
  );

  const search = query.trim().toLowerCase();
  const matches = React.useMemo(
    () =>
      search
        ? EMAIL_SECTION_PRESETS.filter(
            (preset) =>
              preset.label.toLowerCase().includes(search) ||
              preset.description.toLowerCase().includes(search),
          )
        : EMAIL_SECTION_PRESETS,
    [search],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-11 items-center gap-2 border-b border-border/70 px-3">
        <Component className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Seções</span>
      </header>

      <div className="border-b border-border/70 p-2">
        <Input
          className="h-8"
          value={query}
          placeholder="Buscar seção"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!search && (
          <section className="mb-3">
            <h3 className="mb-1 px-1 text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
              Começar de um template
            </h3>
            <div className="flex flex-col gap-1">
              {EMAIL_STARTER_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="flex flex-col gap-0.5 rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-left hover:border-border hover:bg-muted/50"
                  onClick={() => {
                    // Trocar o template descarta o que já foi montado. Confirma
                    // só quando há algo a perder.
                    if (
                      hasContent &&
                      !window.confirm('Isto substitui todo o conteúdo atual. Continuar?')
                    ) {
                      return;
                    }
                    onApplyTemplate(template.build());
                  }}
                >
                  <span className="text-xs font-medium">{template.label}</span>
                  <span className="text-[10px] leading-snug text-muted-foreground">
                    {template.description}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {EMAIL_SECTION_CATEGORIES.map((category) => {
          const presets = matches.filter((preset) => preset.category === category.id);
          if (!presets.length) return null;

          const open = search ? true : openCategories[category.id];

          return (
            <section key={category.id} className="mb-1">
              <button
                type="button"
                className="flex w-full items-center gap-1 rounded-md px-1 py-1.5 text-left hover:bg-muted/50"
                onClick={() =>
                  setOpenCategories((current) => ({ ...current, [category.id]: !current[category.id] }))
                }
              >
                <Icon
                  name={open ? 'chevronDown' : 'chevronRight'}
                  className="size-3 text-muted-foreground"
                />
                <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                  {category.label}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">{presets.length}</span>
              </button>

              {open && (
                <div className="flex flex-col gap-1 pb-1">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy';
                        event.dataTransfer.setData(SECTION_MIME, preset.id);
                      }}
                      className={cn(
                        'flex cursor-grab flex-col gap-0.5 rounded-md border border-transparent px-2.5 py-1.5 text-left',
                        'hover:border-border/70 hover:bg-muted/50 active:cursor-grabbing',
                      )}
                      onClick={() => onInsertSection(preset)}
                    >
                      <span className="text-xs">{preset.label}</span>
                      <span className="text-[10px] leading-snug text-muted-foreground">
                        {preset.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {matches.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Nenhuma seção encontrada.
          </p>
        )}
      </div>

      <footer className="border-t border-border/70 p-2">
        <p className="text-[10px] leading-snug text-muted-foreground">
          Arraste a seção para a posição exata, ou clique para inserir abaixo do bloco
          selecionado. Imagens começam vazias — escolha o arquivo depois de inserir.
        </p>
      </footer>
    </div>
  );
}

export function LibraryTabs({
  value,
  onChange,
  onCollapse,
}: {
  value: 'layers' | 'library';
  onChange: (value: 'layers' | 'library') => void;
  onCollapse?: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 border-b border-border/70 p-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {([
          { id: 'layers' as const, label: 'Camadas', icon: 'layers' as const },
          { id: 'library' as const, label: 'Seções', icon: 'component' as const },
        ]).map((tab) => (
          <Button
            key={tab.id}
            type="button"
            size="sm"
            variant={value === tab.id ? 'secondary' : 'ghost'}
            className="min-w-0 flex-1"
            onClick={() => onChange(tab.id)}
          >
            <Icon name={tab.icon} />
            {tab.label}
          </Button>
        ))}
      </div>
      {onCollapse && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="shrink-0"
          aria-label="Recolher painel de conteúdo"
          aria-controls="email-editor-content-panel"
          aria-expanded={true}
          title="Recolher conteúdo"
          onClick={onCollapse}
        >
          <Icon name="chevronLeft" />
        </Button>
      )}
    </div>
  );
}
