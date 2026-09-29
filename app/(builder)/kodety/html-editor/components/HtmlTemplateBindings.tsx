'use client';

import { Link2, Trash2 } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SettingsPanel from '@/app/(builder)/kodety/components/SettingsPanel';
import type { BuilderTemplateField, BuilderTemplateProvider } from '@/lib/html-editor/editor-types';
import type { SelectionSnapshot } from '@/lib/html-editor/types';

const TEMPLATE_BINDING_TARGETS = ['content', 'href', 'src', 'alt', 'title'] as const;
type TemplateBindingTarget = (typeof TEMPLATE_BINDING_TARGETS)[number];

function defaultTarget(selection: SelectionSnapshot): TemplateBindingTarget {
  if (selection.tag === 'a') return 'href';
  if (['img', 'source', 'video'].includes(selection.tag)) return 'src';
  return 'content';
}

function fieldSupportsTarget(field: BuilderTemplateField, target: TemplateBindingTarget) {
  if (target === 'src') return field.type === 'image' || field.type === 'url';
  if (target === 'href') return field.type === 'url' || field.type === 'text';
  if (target === 'alt' || target === 'title') return field.type !== 'richtext' && field.type !== 'image';
  return field.type !== 'image' && field.type !== 'url';
}

const targetLabels: Record<TemplateBindingTarget, string> = {
  content: 'Conteúdo do elemento',
  href: 'Link (href)',
  src: 'Imagem ou mídia (src)',
  alt: 'Texto alternativo (alt)',
  title: 'Atributo title',
};

export function HtmlTemplateBindings({
  provider,
  selection,
  onAttributesChange,
}: {
  provider: BuilderTemplateProvider;
  selection: SelectionSnapshot;
  onAttributesChange: (changes: Record<string, string>) => void;
}) {
  const fallbackTarget = defaultTarget(selection);
  const boundTarget = TEMPLATE_BINDING_TARGETS.find(target =>
    Boolean(selection.attributes[`data-kodety-template-bind-${target}`]),
  );
  const target = boundTarget || fallbackTarget;
  const binding = selection.attributes[`data-kodety-template-bind-${target}`] || '';
  const action = selection.attributes['data-kodety-template-action'] || '';
  const compatibleFields = provider.fields.filter(field => fieldSupportsTarget(field, target));

  const changeBinding = (fieldKey: string) => {
    const next = fieldKey === '__fixed' ? '' : fieldKey;
    onAttributesChange({
      'data-kodety-template-provider': next || action ? provider.id : '',
      [`data-kodety-template-bind-${target}`]: next,
    });
  };

  const changeTarget = (nextTarget: string) => {
    if (!TEMPLATE_BINDING_TARGETS.includes(nextTarget as TemplateBindingTarget) || nextTarget === target) return;
    onAttributesChange({
      [`data-kodety-template-bind-${target}`]: '',
      [`data-kodety-template-bind-${nextTarget}`]: binding,
      'data-kodety-template-provider': binding || action ? provider.id : '',
    });
  };

  const clearBinding = () => {
    const changes: Record<string, string> = {
      'data-kodety-template-provider': action ? provider.id : '',
    };
    TEMPLATE_BINDING_TARGETS.forEach(bindingTarget => {
      changes[`data-kodety-template-bind-${bindingTarget}`] = '';
    });
    onAttributesChange(changes);
  };

  return (
    <SettingsPanel title={provider.name} isOpen onToggle={() => {}}>
      <div className="space-y-3 py-1">
        <div className="flex items-start gap-2 text-[10px] leading-4 text-muted-foreground">
          <Link2 className="mt-0.5 size-3.5 shrink-0" />
          <p>Conecte este elemento às variáveis fornecidas pela extensão. O CMS não participa deste template.</p>
        </div>
        <div className="space-y-1.5">
          <Label variant="muted">Variável</Label>
          <Select value={binding || '__fixed'} onValueChange={changeBinding}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Conteúdo fixo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__fixed">Conteúdo fixo</SelectItem>
              {compatibleFields.map(field => (
                <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {binding && (
          <>
            <div className="space-y-1.5">
              <Label variant="muted">Aplicar em</Label>
              <Select value={target} onValueChange={changeTarget}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEMPLATE_BINDING_TARGETS.map(item => (
                    <SelectItem key={item} value={item}>{targetLabels[item]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" size="xs" variant="secondary" className="w-full" onClick={clearBinding}>
              <Trash2 className="size-3.5" /> Remover conexão
            </Button>
          </>
        )}
        {provider.actions && provider.actions.length > 0 && (
          <div className="space-y-1.5 border-t border-border/70 pt-3">
            <Label variant="muted">Ação ao clicar</Label>
            <Select
              value={action || '__none'}
              onValueChange={nextAction => {
                const next = nextAction === '__none' ? '' : nextAction;
                onAttributesChange({
                  'data-kodety-template-action': next,
                  'data-kodety-template-provider': next || binding ? provider.id : '',
                });
              }}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Nenhuma ação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Nenhuma ação</SelectItem>
                {provider.actions.map(item => (
                  <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </SettingsPanel>
  );
}
