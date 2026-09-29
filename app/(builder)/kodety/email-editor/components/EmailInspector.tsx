/**
 * Inspetor do construtor de email.
 *
 * Reusa os controles reais do builder — `SettingsPanel`, `MarginPadding`
 * (modo `nativeCss`) e `RadiusValueControl` — porque as props deles já são
 * genéricas. Tipografia e cor são versões próprias construídas sobre os mesmos
 * primitivos de `components/ui`, sem os controles que não sobrevivem em email
 * (gradiente, sombra, transform, webfont).
 */

import React from 'react';
import MarginPadding, {
  type SpacingChanges,
  type SpacingValues,
} from '@/app/(builder)/kodety/components/MarginPadding';
import { RadiusValueControl } from '@/app/(builder)/kodety/components/RadiusValueControl';
import SettingsPanel from '@/app/(builder)/kodety/components/SettingsPanel';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { setColumnCount } from '@/lib/email-editor/operations';
import {
  EMAIL_FONT_STACKS,
  EMAIL_FONT_WEIGHTS,
  type EmailAlign,
  type EmailBlock,
  type EmailBox,
  type EmailDocument,
  type EmailRadius,
  type EmailSides,
  type EmailTypography,
} from '@/lib/email-editor/types';
import {
  ColorField,
  ControlRow,
  IconToggleGroup,
  LengthField,
  MergeTagField,
  SelectField,
  UploadBox,
} from './EmailControls';
import EmailRichText from './EmailRichText';

/**
 * Um patch pode ser uma função para ser resolvido contra o bloco mais recente.
 *
 * O widget de espaçamento dispara quatro `onChange` no mesmo tick quando o
 * shift está pressionado. Com patches literais, os quatro seriam calculados a
 * partir do mesmo bloco antigo e só o último sobreviveria.
 */
export type EmailBlockPatch = Partial<EmailBlock> | ((block: EmailBlock) => Partial<EmailBlock>);

interface EmailInspectorProps {
  document: EmailDocument;
  block: EmailBlock | null;
  uploading: boolean;
  onChange: (patch: EmailBlockPatch) => void;
  onDocumentChange: (document: EmailDocument) => void;
  onUploadImage: (file: File) => void;
}

const ALIGN_OPTIONS: { value: EmailAlign; icon: 'textAlignLeft' | 'textAlignCenter' | 'textAlignRight'; label: string }[] = [
  { value: 'left', icon: 'textAlignLeft', label: 'Esquerda' },
  { value: 'center', icon: 'textAlignCenter', label: 'Centro' },
  { value: 'right', icon: 'textAlignRight', label: 'Direita' },
];

export default function EmailInspector({
  document,
  block,
  uploading,
  onChange,
  onDocumentChange,
  onUploadImage,
}: EmailInspectorProps) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({
    content: true,
    typography: true,
    spacing: true,
    size: true,
    appearance: true,
    document: true,
  });

  const toggle = (key: string) => setOpen((current) => ({ ...current, [key]: !current[key] }));

  if (!block) {
    return (
      <div className="flex h-full flex-col overflow-y-auto px-3">
        <DocumentPanel
          document={document}
          isOpen={open.document}
          onToggle={() => toggle('document')}
          onChange={onDocumentChange}
        />
      </div>
    );
  }

  const typography = 'typography' in block ? block.typography : null;
  const patchTypography = (patch: Partial<EmailTypography>) => {
    if (!typography) return;
    onChange((live) => ({
      typography: { ...('typography' in live ? live.typography : typography), ...patch },
    }) as Partial<EmailBlock>);
  };
  const patchBox = (patch: Partial<EmailBox>) =>
    onChange((live) => ({ box: { ...live.box, ...patch } }) as Partial<EmailBlock>);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3">
      <SettingsPanel title="Conteúdo" collapsible isOpen={open.content} onToggle={() => toggle('content')}>
        <div className="flex flex-col gap-2 pb-3">
          {block.type === 'heading' && (
            <>
              <ControlRow label="Texto">
                <MergeTagField
                  multiline
                  className="min-h-16"
                  value={block.text}
                  onChange={(text) => onChange({ text } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <ControlRow label="Nível">
                <SelectField
                  value={String(block.level)}
                  options={[
                    { label: 'H1', value: '1' },
                    { label: 'H2', value: '2' },
                    { label: 'H3', value: '3' },
                  ]}
                  onChange={(value) => onChange({ level: Number(value) as 1 | 2 | 3 } as Partial<EmailBlock>)}
                />
              </ControlRow>
            </>
          )}

          {block.type === 'text' && (
            <>
              <EmailRichText
                value={block.html}
                onChange={(html) => onChange({ html } as Partial<EmailBlock>)}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Shift+Enter quebra a linha sem criar parágrafo.
              </p>
            </>
          )}

          {block.type === 'image' && (
            <>
              <UploadBox value={block.src} uploading={uploading} onUpload={onUploadImage} />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                A imagem vai para a biblioteca de mídia do site. Arraste um arquivo ou clique para escolher.
              </p>
              <ControlRow label="URL">
                <Input
                  className="h-8"
                  value={block.src}
                  placeholder="https://"
                  onChange={(event) => onChange({ src: event.target.value } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <ControlRow label="Alt">
                <Input
                  className="h-8"
                  value={block.alt}
                  onChange={(event) => onChange({ alt: event.target.value } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Muitos clientes bloqueiam imagens por padrão — esse texto é o que aparece no lugar.
              </p>
              <ControlRow label="Link">
                <Input
                  className="h-8"
                  value={block.href}
                  placeholder="https://"
                  onChange={(event) => onChange({ href: event.target.value } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <ControlRow label="Largura">
                <LengthField
                  value={block.width}
                  icon="maxSize"
                  onChange={(value) => onChange({ width: value } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <ControlRow label="Alinhamento">
                <IconToggleGroup
                  value={block.align}
                  options={ALIGN_OPTIONS}
                  onChange={(align) => onChange({ align } as Partial<EmailBlock>)}
                />
              </ControlRow>
            </>
          )}

          {block.type === 'button' && (
            <>
              <ControlRow label="Texto">
                <MergeTagField
                  className="h-8"
                  value={block.label}
                  onChange={(label) => onChange({ label } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <ControlRow label="Link">
                <MergeTagField
                  className="h-8"
                  value={block.href}
                  placeholder="https://"
                  onChange={(href) => onChange({ href } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <ControlRow label="Fundo">
                <ColorField
                  value={block.backgroundColor}
                  onChange={(value) => onChange({ backgroundColor: value } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <ControlRow label="Padding">
                <LengthField
                  value={block.paddingY}
                  icon="rows"
                  onChange={(value) => onChange({ paddingY: value } as Partial<EmailBlock>)}
                />
                <LengthField
                  value={block.paddingX}
                  icon="columns"
                  onChange={(value) => onChange({ paddingX: value } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <RadiusValueControl
                label="Arredondamento"
                mode={block.radius.mode}
                value={block.radius.all}
                topLeft={block.radius.topLeft}
                topRight={block.radius.topRight}
                bottomRight={block.radius.bottomRight}
                bottomLeft={block.radius.bottomLeft}
                onValueChange={(value) => patchRadius(onChange, block.radius, { all: value })}
                onTopLeftChange={(value) => patchRadius(onChange, block.radius, { topLeft: value })}
                onTopRightChange={(value) => patchRadius(onChange, block.radius, { topRight: value })}
                onBottomRightChange={(value) => patchRadius(onChange, block.radius, { bottomRight: value })}
                onBottomLeftChange={(value) => patchRadius(onChange, block.radius, { bottomLeft: value })}
                onModeToggle={() =>
                  patchRadius(onChange, block.radius, {
                    mode: block.radius.mode === 'all' ? 'individual' : 'all',
                  })
                }
              />
              <ControlRow label="Largura total">
                <Switch
                  checked={block.fullWidth}
                  onCheckedChange={(checked) => onChange({ fullWidth: checked } as Partial<EmailBlock>)}
                />
              </ControlRow>
            </>
          )}

          {block.type === 'divider' && (
            <>
              <ControlRow label="Cor">
                <ColorField value={block.color} onChange={(value) => onChange({ color: value } as Partial<EmailBlock>)} />
              </ControlRow>
              <ControlRow label="Espessura">
                <LengthField
                  value={block.thickness}
                  onChange={(value) => onChange({ thickness: value } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <ControlRow label="Largura">
                <LengthField
                  value={block.lineWidth}
                  icon="maxSize"
                  placeholder="100%"
                  onChange={(lineWidth) => onChange({ lineWidth } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <ControlRow label="Alinhamento">
                <IconToggleGroup
                  value={block.align}
                  options={ALIGN_OPTIONS}
                  onChange={(align) => onChange({ align } as Partial<EmailBlock>)}
                />
              </ControlRow>
            </>
          )}

          {block.type === 'spacer' && (
            <ControlRow label="Altura">
              <LengthField value={block.height} onChange={(value) => onChange({ height: value } as Partial<EmailBlock>)} />
            </ControlRow>
          )}

          {block.type === 'html' && (
            <>
              <Textarea
                className="min-h-40 font-mono text-xs"
                value={block.code}
                onChange={(event) => onChange({ code: event.target.value } as Partial<EmailBlock>)}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Use tabelas e estilos inline. Nada de script, form ou iframe.
              </p>
            </>
          )}

          {block.type === 'columns' && (
            <>
              <ControlRow label="Colunas">
                <SelectField
                  value={String(block.columns.length)}
                  options={[1, 2, 3, 4].map((count) => ({ label: String(count), value: String(count) }))}
                  onChange={(value) => onDocumentChange(setColumnCount(document, block.id, Number(value)))}
                />
              </ControlRow>
              <ControlRow label="Espaço">
                <LengthField
                  value={block.gap}
                  icon="horizontalGap"
                  onChange={(value) => onChange({ gap: value } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <ControlRow label="Alinhar">
                <IconToggleGroup
                  value={block.verticalAlign}
                  options={[
                    { value: 'top', icon: 'alignStart', label: 'Topo' },
                    { value: 'middle', icon: 'alignCenter', label: 'Meio' },
                    { value: 'bottom', icon: 'alignEnd', label: 'Base' },
                  ]}
                  onChange={(verticalAlign) => onChange({ verticalAlign } as Partial<EmailBlock>)}
                />
              </ControlRow>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                No mobile as colunas empilham automaticamente.
              </p>
            </>
          )}
        </div>
      </SettingsPanel>

      {typography && (
        <SettingsPanel title="Tipografia" collapsible isOpen={open.typography} onToggle={() => toggle('typography')}>
          <div className="flex flex-col gap-2 pb-3">
            <ControlRow label="Fonte">
              <SelectField
                value={typography.fontFamily || document.settings.fontFamily}
                options={EMAIL_FONT_STACKS.map((stack) => ({ label: stack.label, value: stack.value }))}
                onChange={(fontFamily) => patchTypography({ fontFamily })}
              />
            </ControlRow>
            <ControlRow label="Peso">
              <SelectField
                value={typography.fontWeight}
                options={EMAIL_FONT_WEIGHTS}
                onChange={(fontWeight) => patchTypography({ fontWeight })}
              />
            </ControlRow>
            <ControlRow label="Tamanho">
              <LengthField
                value={typography.fontSize}
                icon="type"
                onChange={(fontSize) => patchTypography({ fontSize })}
              />
              <LengthField
                value={typography.lineHeight}
                icon="lineHeight"
                onChange={(lineHeight) => patchTypography({ lineHeight })}
              />
            </ControlRow>
            <ControlRow label="Espaçamento">
              <LengthField
                value={typography.letterSpacing}
                icon="letterSpacing"
                placeholder="normal"
                onChange={(letterSpacing) => patchTypography({ letterSpacing })}
              />
            </ControlRow>
            <ControlRow label="Cor">
              <ColorField value={typography.color} onChange={(color) => patchTypography({ color })} />
            </ControlRow>
            <ControlRow label="Alinhamento">
              <IconToggleGroup
                value={typography.align}
                options={ALIGN_OPTIONS}
                onChange={(align) => patchTypography({ align })}
              />
            </ControlRow>
            <ControlRow label="Caixa">
              <SelectField
                value={typography.textTransform}
                options={[
                  { label: 'Normal', value: 'none' },
                  { label: 'MAIÚSCULAS', value: 'uppercase' },
                  { label: 'minúsculas', value: 'lowercase' },
                  { label: 'Capitalizado', value: 'capitalize' },
                ]}
                onChange={(textTransform) =>
                  patchTypography({ textTransform: textTransform as EmailTypography['textTransform'] })
                }
              />
            </ControlRow>
          </div>
        </SettingsPanel>
      )}

      <SettingsPanel title="Espaçamento" collapsible isOpen={open.spacing} onToggle={() => toggle('spacing')}>
        <div className="pb-3">
          <MarginPadding
            nativeCss
            values={toSpacingValues(block.box)}
            onChange={(property, value) =>
              onChange((live) => ({
                box: { ...live.box, ...applySpacing(live.box, property, value) },
              }) as Partial<EmailBlock>)
            }
            onBatchChange={(changes) =>
              onChange((live) => ({
                box: applySpacingChanges(live.box, changes),
              }) as Partial<EmailBlock>)
            }
          />
        </div>
      </SettingsPanel>

      <SettingsPanel title="Tamanho" collapsible isOpen={open.size} onToggle={() => toggle('size')}>
        <div className="flex flex-col gap-2 pb-3">
          <ControlRow label="Largura">
            <LengthField
              value={block.box.width}
              icon="maxSize"
              placeholder="100%"
              onChange={(width) => patchBox({ width })}
            />
          </ControlRow>
          <ControlRow label="Altura">
            <LengthField
              value={block.box.height}
              icon="minSize"
              placeholder="automática"
              onChange={(height) => patchBox({ height })}
            />
          </ControlRow>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            A altura é aplicada na célula da tabela, onde os clientes de email a
            respeitam. Ela funciona como altura mínima: conteúdo maior expande o
            bloco em vez de ser cortado.
          </p>
        </div>
      </SettingsPanel>

      <SettingsPanel title="Aparência" collapsible isOpen={open.appearance} onToggle={() => toggle('appearance')}>
        <div className="flex flex-col gap-2 pb-3">
          <ControlRow label="Fundo">
            <ColorField
              value={block.box.backgroundColor}
              onChange={(backgroundColor) => patchBox({ backgroundColor })}
              onClear={() => patchBox({ backgroundColor: '' })}
            />
          </ControlRow>
          <ControlRow label="Borda">
            <SelectField
              value={block.box.borderStyle}
              options={[
                { label: 'Nenhuma', value: 'none' },
                { label: 'Sólida', value: 'solid' },
                { label: 'Tracejada', value: 'dashed' },
                { label: 'Pontilhada', value: 'dotted' },
              ]}
              onChange={(borderStyle) => patchBox({ borderStyle: borderStyle as EmailBox['borderStyle'] })}
            />
          </ControlRow>
          {block.box.borderStyle !== 'none' && (
            <>
              <ControlRow label="Espessura">
                <LengthField value={block.box.borderWidth} onChange={(borderWidth) => patchBox({ borderWidth })} />
              </ControlRow>
              <ControlRow label="Cor da borda">
                <ColorField value={block.box.borderColor} onChange={(borderColor) => patchBox({ borderColor })} />
              </ControlRow>
            </>
          )}
          {/* O botão tem o próprio arredondamento em Conteúdo; dois controles
              para a mesma coisa só confundiriam. */}
          {block.type !== 'button' && (
            <RadiusValueControl
              label="Arredondamento"
              mode={block.box.radius.mode}
              value={block.box.radius.all}
              topLeft={block.box.radius.topLeft}
              topRight={block.box.radius.topRight}
              bottomRight={block.box.radius.bottomRight}
              bottomLeft={block.box.radius.bottomLeft}
              onValueChange={(value) => patchBox({ radius: { ...block.box.radius, all: value } })}
              onTopLeftChange={(value) => patchBox({ radius: { ...block.box.radius, topLeft: value } })}
              onTopRightChange={(value) => patchBox({ radius: { ...block.box.radius, topRight: value } })}
              onBottomRightChange={(value) => patchBox({ radius: { ...block.box.radius, bottomRight: value } })}
              onBottomLeftChange={(value) => patchBox({ radius: { ...block.box.radius, bottomLeft: value } })}
              onModeToggle={() =>
                patchBox({
                  radius: {
                    ...block.box.radius,
                    mode: block.box.radius.mode === 'all' ? 'individual' : 'all',
                  },
                })
              }
            />
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {block.type === 'image'
              ? 'Borda e arredondamento são aplicados na própria imagem. O Outlook desktop ignora o arredondamento e mostra o canto reto.'
              : block.type === 'button'
                ? 'A borda vai no botão — deixe o fundo vazio para um botão vazado. O Outlook desktop ignora o arredondamento.'
                : 'Bordas arredondadas são ignoradas pelo Outlook desktop, que mostra o canto reto.'}
          </p>
        </div>
      </SettingsPanel>
    </div>
  );
}

function DocumentPanel({
  document,
  isOpen,
  onToggle,
  onChange,
}: {
  document: EmailDocument;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (document: EmailDocument) => void;
}) {
  const documentRef = React.useRef(document);
  documentRef.current = document;
  const patch = (settings: Partial<EmailDocument['settings']>) => {
    const current = documentRef.current;
    const next = { ...current, settings: { ...current.settings, ...settings } };
    documentRef.current = next;
    onChange(next);
  };

  return (
    <SettingsPanel title="Documento" collapsible isOpen={isOpen} onToggle={onToggle}>
      <div className="flex flex-col gap-2 pb-3">
        <ControlRow label="Largura">
          <LengthField value={document.settings.width} icon="maxSize" onChange={(width) => patch({ width })} />
        </ControlRow>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          600px é o padrão que cabe em todo cliente de email.
        </p>
        <ControlRow label="Fonte">
          <SelectField
            value={document.settings.fontFamily}
            options={EMAIL_FONT_STACKS.map((stack) => ({ label: stack.label, value: stack.value }))}
            onChange={(fontFamily) => patch({ fontFamily })}
          />
        </ControlRow>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Só fontes do sistema: webfont não carrega no Outlook nem no Gmail app.
        </p>
        <ControlRow label="Fundo">
          <ColorField
            value={document.settings.backgroundColor}
            onChange={(backgroundColor) => patch({ backgroundColor })}
          />
        </ControlRow>
        <ControlRow label="Conteúdo">
          <ColorField
            value={document.settings.contentBackground}
            onChange={(contentBackground) => patch({ contentBackground })}
          />
        </ControlRow>
        <ControlRow label="Texto">
          <ColorField value={document.settings.textColor} onChange={(textColor) => patch({ textColor })} />
        </ControlRow>
        <ControlRow label="Links">
          <ColorField value={document.settings.linkColor} onChange={(linkColor) => patch({ linkColor })} />
        </ControlRow>
        <ControlRow label="Sublinhar">
          <Switch
            checked={document.settings.linkUnderline}
            onCheckedChange={(linkUnderline) => patch({ linkUnderline })}
          />
        </ControlRow>
        <Label className="mt-2 text-muted-foreground">Padding do conteúdo</Label>
        <MarginPadding
          nativeCss
          mode="padding"
          values={sidesToSpacing(document.settings.contentPadding)}
          onChange={(property, value) =>
            patch({
              contentPadding: applySideValue(
                documentRef.current.settings.contentPadding,
                property,
                value,
              ),
            })
          }
          onBatchChange={(changes) =>
            patch({
              contentPadding: applySideValues(
                documentRef.current.settings.contentPadding,
                changes,
              ),
            })
          }
        />
      </div>
    </SettingsPanel>
  );
}

// --- Adaptadores entre o modelo do email e o SpacingValues do builder ------

function toSpacingValues(box: EmailBox): SpacingValues {
  return {
    marginTop: box.margin.top,
    marginRight: box.margin.right,
    marginBottom: box.margin.bottom,
    marginLeft: box.margin.left,
    paddingTop: box.padding.top,
    paddingRight: box.padding.right,
    paddingBottom: box.padding.bottom,
    paddingLeft: box.padding.left,
  };
}

function sidesToSpacing(value: EmailSides): SpacingValues {
  return {
    marginTop: '',
    marginRight: '',
    marginBottom: '',
    marginLeft: '',
    paddingTop: value.top,
    paddingRight: value.right,
    paddingBottom: value.bottom,
    paddingLeft: value.left,
  };
}

function applySpacing(box: EmailBox, property: keyof SpacingValues, value: string): Partial<EmailBox> {
  const isMargin = property.startsWith('margin');
  const side = property.replace(/^(margin|padding)/, '').toLowerCase() as keyof EmailSides;
  const target = isMargin ? box.margin : box.padding;
  const next = { ...target, [side]: value };
  return isMargin ? { margin: next } : { padding: next };
}

function applySpacingChanges(box: EmailBox, changes: SpacingChanges): EmailBox {
  let next = box;
  for (const [property, value] of Object.entries(changes)) {
    if (typeof value !== 'string') continue;
    next = {
      ...next,
      ...applySpacing(next, property as keyof SpacingValues, value),
    };
  }
  return next;
}

function applySideValue(current: EmailSides, property: keyof SpacingValues, value: string): EmailSides {
  const side = property.replace(/^(margin|padding)/, '').toLowerCase() as keyof EmailSides;
  return { ...current, [side]: value };
}

function applySideValues(current: EmailSides, changes: SpacingChanges): EmailSides {
  let next = current;
  for (const [property, value] of Object.entries(changes)) {
    if (typeof value !== 'string') continue;
    next = applySideValue(next, property as keyof SpacingValues, value);
  }
  return next;
}

function patchRadius(
  onChange: (patch: EmailBlockPatch) => void,
  radius: EmailRadius,
  patch: Partial<EmailRadius>,
): void {
  onChange({ radius: { ...radius, ...patch } } as Partial<EmailBlock>);
}
