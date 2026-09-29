'use client';

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  Check,
  ChevronDown,
  Component,
  Copy,
  GripVertical,
  Hash,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
  Unlink,
  Upload,
} from '@/components/ui/gravity-icons';
import { WidgetIcon as SolarWidgetIcon } from '@solar-icons/react/bold-duotone/widget';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ycode-style/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ycode-style/ui/dropdown-menu';
import { Button } from '../ycode-style/ui/button';
import { Input } from '../ycode-style/ui/input';
import { Label } from '../ycode-style/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ycode-style/ui/select';
import { Textarea } from '../ycode-style/ui/textarea';
import YcodeSettingsPanel from '../ycode-style/SettingsPanel';
import type {
  HtmlComponentDefinition,
  HtmlComponentInstanceContext,
  HtmlComponentOverrides,
  HtmlComponentVariable,
  HtmlComponentVariableVariantOption,
  HtmlComponentVariableType,
  HtmlComponentVariant,
} from '@/lib/html-editor/html-components';
import {
  HTML_COMPONENT_VARIANT_ATTRIBUTE,
  createHtmlComponentId,
  htmlComponentVariableBindings,
  htmlComponentVariableHasVariantBinding,
  withHtmlComponentVariableBinding,
  withoutHtmlComponentVariableBinding,
} from '@/lib/html-editor/html-components';
import { cn } from '@/lib/utils';
import {
  HtmlSettingsSelectControl,
  HtmlSettingsTextControl,
  type HtmlSettingsFieldKind,
} from './HtmlSettingsControls';

const VARIABLE_TYPES: Array<{
  value: HtmlComponentVariableType;
  label: string;
  icon: typeof Type;
}> = [
  { value: 'text', label: 'Text', icon: Type },
  { value: 'rich_text', label: 'Rich text', icon: Type },
  { value: 'number', label: 'Number', icon: Hash },
  { value: 'image', label: 'Image', icon: ImageIcon },
  { value: 'link', label: 'Link', icon: Link2 },
  { value: 'audio', label: 'Audio', icon: Play },
  { value: 'video', label: 'Video', icon: Play },
  { value: 'icon', label: 'Icon', icon: Component },
  { value: 'variant', label: 'Variant', icon: Component },
];

type ComponentReorderDropEdge = 'before' | 'after' | null;

function ComponentReorderRow({
  id,
  dropEdge,
  className,
  children,
}: {
  id: string;
  dropEdge: ComponentReorderDropEdge;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef: setDropRef } = useDroppable({ id });
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef: setDragRef,
  } = useDraggable({ id });

  return (
    <div
      ref={node => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={cn('group relative flex select-none items-center', className)}
    >
      {dropEdge && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-1 z-20 h-0.5 rounded-full bg-[var(--kodety-accent)] shadow-[0_0_0_1px_rgb(147_147_255/0.25)]',
            dropEdge === 'before' ? '-top-px' : '-bottom-px',
          )}
        />
      )}
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="mr-1 grid size-3 shrink-0 cursor-grab touch-none place-items-center opacity-40 outline-none active:cursor-grabbing focus-visible:text-foreground"
        aria-label="Reorder"
      >
        <GripVertical className="size-3" />
      </span>
      {children}
    </div>
  );
}

export interface HtmlComponentAssetOption {
  path: string;
  mimeType: string;
  /** Value persisted in the variable. Falls back to `path`. */
  value?: string;
  /** Already-resolved browser URL, when the asset owner has one. */
  previewUrl?: string;
  /** Local project payload used to build an object URL for the preview. */
  data?: Uint8Array;
  text?: string;
}

export type HtmlComponentAssetUploadHandler = (
  file: File,
  variable: HtmlComponentVariable,
) => string | null | undefined | Promise<string | null | undefined>;

export function HtmlComponentVariableLabel({
  label,
  variables,
  linkedVariableId,
  onLinkVariable,
  onUnlinkVariable,
  onCreateVariable,
  onManageVariables,
}: {
  label: string;
  variables: HtmlComponentVariable[];
  linkedVariableId?: string;
  onLinkVariable: (variableId: string) => void;
  onUnlinkVariable?: () => void;
  onCreateVariable: () => void;
  onManageVariables: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="variable" size="xs" className="min-w-0 justify-start px-0">
          <Plus className={cn('size-3', linkedVariableId && 'text-purple-300')} />
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {variables.length > 0 && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Link to variable</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {variables.map(variable => {
                    const VariableIcon = VARIABLE_TYPES.find(item => item.value === variable.type)?.icon || Component;
                    return (
                      <DropdownMenuItem key={variable.id} onClick={() => onLinkVariable(variable.id)}>
                        <VariableIcon className="size-3 opacity-60" />
                        {variable.name}
                        {linkedVariableId === variable.id && <Check className="ml-auto size-3" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={Boolean(linkedVariableId)} onClick={onCreateVariable}>
          Create variable
        </DropdownMenuItem>
        {linkedVariableId && onUnlinkVariable && (
          <DropdownMenuItem onClick={onUnlinkVariable}>
            <Unlink /> Unlink variable
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onManageVariables}>
          <Pencil /> Manage variables
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const HtmlComponentCard = memo(function HtmlComponentCard({
  component,
  previewDocument,
  onInsert,
  onEdit,
  onRename,
  onDelete,
}: {
  component: HtmlComponentDefinition;
  previewDocument: string;
  onInsert: () => void;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div data-ycode-native-ui className="group flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        onClick={onInsert}
        className="flex aspect-[2.44/1] w-full items-center overflow-hidden rounded-[10px] border border-white/[.075] bg-secondary p-1.5 text-left outline-none transition-[border-color,background-color] hover:border-[var(--kodety-accent-hover)]/70 hover:bg-white/[.055] focus-visible:border-[var(--kodety-accent-hover)]/70"
      >
        <iframe
          title={`${component.name} preview`}
          srcDoc={previewDocument}
          sandbox=""
          tabIndex={-1}
          className="pointer-events-none h-full w-full rounded border-0 bg-background"
        />
      </button>
      <div className="flex min-w-0 items-center gap-1 px-0.5">
        <SolarWidgetIcon className="size-3.5 shrink-0 text-white/40 transition-colors group-hover:text-[var(--kodety-accent-hover)]" />
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={component.name}
          onDoubleClick={onRename}
        >
          {component.name}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={event => event.stopPropagation()}
              aria-label="Component actions"
            >
              <MoreHorizontal className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" data-html-insert-menu-portal>
            <DropdownMenuItem onSelect={onEdit}><Pencil /> Edit</DropdownMenuItem>
            <DropdownMenuItem onSelect={onRename}><Type /> Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

export function HtmlCreateComponentDialog({
  open,
  initialName,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  initialName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  useEffect(() => {
    if (open) setName(initialName);
  }, [initialName, open]);
  const confirm = () => {
    const value = name.trim();
    if (!value) return;
    onConfirm(value);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-ycode-native-ui className="w-[320px] gap-0" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Create component</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4.5">
          <Input
            value={name}
            placeholder="Name"
            autoFocus
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') confirm();
            }}
          />
          <DialogFooter className="grid grid-cols-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!name.trim()} onClick={confirm}>Create</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HtmlRenameComponentDialog({
  open,
  currentName,
  title = 'Rename component',
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  currentName: string;
  title?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(currentName);
  useEffect(() => {
    if (open) setName(currentName);
  }, [currentName, open]);
  const confirm = () => {
    const value = name.trim();
    if (!value) return;
    onConfirm(value);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-ycode-native-ui className="w-[320px] gap-0" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4.5">
          <Input
            value={name}
            placeholder="Name"
            autoFocus
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') confirm();
            }}
          />
          <DialogFooter className="grid grid-cols-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!name.trim()} onClick={confirm}>Rename</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VariableValueField({
  variable,
  value,
  variants,
  onChange,
  onCommit,
  assetOptions = [],
  onUploadAsset,
}: {
  variable: HtmlComponentVariable;
  value: string;
  variants: HtmlComponentVariableVariantOption[];
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  assetOptions?: HtmlComponentAssetOption[];
  onUploadAsset?: HtmlComponentAssetUploadHandler;
}) {
  const mediaType = variable.type === 'image'
    || variable.type === 'audio'
    || variable.type === 'video'
    ? variable.type
    : null;
  const compatibleAssets = useMemo(() => assetOptions.filter(asset => (
    mediaType ? asset.mimeType.startsWith(`${mediaType}/`) : false
  )), [assetOptions, mediaType]);
  const selectedAsset = useMemo(() => {
    const reference = value.split(/[?#]/)[0].replaceAll('\\', '/').replace(/^\.\//, '');
    return compatibleAssets.find(asset => {
      const assetValue = asset.value || asset.path;
      const assetPath = asset.path.replaceAll('\\', '/').replace(/^\.\//, '');
      return assetValue === value
        || asset.path === value
        || reference === assetPath
        || reference.endsWith(`/${assetPath}`);
    });
  }, [compatibleAssets, value]);
  const [assetPreviewUrl, setAssetPreviewUrl] = useState('');
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploadInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selectedAsset) {
      setAssetPreviewUrl('');
      return;
    }
    if (selectedAsset.previewUrl) {
      setAssetPreviewUrl(selectedAsset.previewUrl);
      return;
    }
    const content = selectedAsset.text ?? selectedAsset.data;
    if (content === undefined) {
      setAssetPreviewUrl('');
      return;
    }
    const objectUrl = URL.createObjectURL(new Blob(
      [content as BlobPart],
      { type: selectedAsset.mimeType || 'application/octet-stream' },
    ));
    setAssetPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedAsset]);
  useEffect(() => () => {
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
  }, [uploadPreviewUrl]);
  const updateValue = (next: string) => {
    setUploadError('');
    setUploadPreviewUrl('');
    onChange(next);
  };
  const commitValue = (next: string) => onCommit?.(next);
  const uploadAsset = async (file: File) => {
    if (!onUploadAsset || !mediaType || uploading) return;
    setUploadError('');
    setUploadPreviewUrl(URL.createObjectURL(file));
    setUploading(true);
    try {
      const next = await onUploadAsset(file, variable);
      if (!next) {
        setUploadPreviewUrl('');
        return;
      }
      onChange(next);
      commitValue(next);
    } catch (error) {
      setUploadPreviewUrl('');
      setUploadError(error instanceof Error ? error.message : 'Could not upload this file.');
    } finally {
      setUploading(false);
    }
  };
  if (variable.type === 'variant') {
    return (
      <HtmlSettingsSelectControl
        label={variable.name || 'Variant'}
        kind="component"
        value={value || variable.defaultValue}
        allowUnset={false}
        options={variants.map(variant => ({ value: variant.id, label: variant.name }))}
        onChange={next => {
          updateValue(next);
          commitValue(next);
        }}
      />
    );
  }
  if (variable.type === 'rich_text') {
    return (
      <HtmlSettingsTextControl
        value={value}
        label={variable.name || 'Rich text'}
        kind="text"
        multiline
        placeholder={variable.placeholder || variable.name}
        onChange={updateValue}
        onCommit={commitValue}
      />
    );
  }
  const assetPicker = compatibleAssets.length ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" className="relative w-full justify-center px-8">
          Select <ChevronDown className="absolute right-3 size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 w-72 overflow-y-auto">
        {compatibleAssets.map(asset => (
          <DropdownMenuItem
            key={asset.path}
            onClick={() => {
              const next = asset.value || asset.path;
              updateValue(next);
              commitValue(next);
            }}
          >
            <span className="truncate">{asset.path.split('/').pop()}</span>
            {selectedAsset?.path === asset.path && <Check className="ml-auto size-3" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
  if (mediaType) {
    const previewUrl = uploadPreviewUrl
      || assetPreviewUrl
      || (value && !value.includes('{{') ? value : '');
    const accept = `${mediaType}/*`;
    return (
      <div className="space-y-2">
        {previewUrl && (
          <div className="min-h-20 overflow-hidden rounded-lg border border-border bg-secondary/30">
            {mediaType === 'image' ? (
              // Object URLs represent project/user-owned media selected locally.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="h-24 w-full object-contain" />
            ) : mediaType === 'video' ? (
              <video src={previewUrl} muted controls playsInline className="h-24 w-full object-contain" />
            ) : (
              <div className="flex h-20 items-center px-2">
                <audio src={previewUrl} controls className="w-full" />
              </div>
            )}
          </div>
        )}
        <HtmlSettingsTextControl
          value={value}
          label={variable.name || mediaType}
          kind={mediaType}
          placeholder={variable.placeholder || `${mediaType[0].toUpperCase()}${mediaType.slice(1)} URL or path`}
          onChange={updateValue}
          onCommit={commitValue}
        />
        {(assetPicker || onUploadAsset) && (
          <div className={cn('grid gap-2', assetPicker && onUploadAsset && 'grid-cols-2')}>
            {assetPicker}
            {onUploadAsset && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={uploading}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  <Upload className="size-3" /> {uploading ? 'Uploading…' : 'Upload'}
                </Button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  className="sr-only"
                  accept={accept}
                  disabled={uploading}
                  onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void uploadAsset(file);
                  }}
                />
              </>
            )}
          </div>
        )}
        {uploadError && <p role="alert" className="text-[10px] leading-4 text-red-400">{uploadError}</p>}
      </div>
    );
  }
  const fieldKind: HtmlSettingsFieldKind = variable.type === 'number'
    ? 'number'
    : variable.type === 'link'
      ? 'link'
      : variable.type === 'icon'
        ? 'component'
        : 'text';
  const input = (
    <HtmlSettingsTextControl
      value={value}
      label={variable.name || variable.type}
      kind={fieldKind}
      placeholder={variable.placeholder || variable.defaultValue || variable.name}
      onChange={updateValue}
      onCommit={commitValue}
    />
  );
  return assetPicker ? <div className="space-y-2">{input}{assetPicker}</div> : input;
}

export interface HtmlComponentVariantVariableBindingContext {
  variables: HtmlComponentVariable[];
  targetNodeId: string;
  onChange: (variables: HtmlComponentVariable[]) => void;
  onManage: (variableId?: string) => void;
}

export interface HtmlComponentVariantPropertyTarget {
  targetNodeId: string;
  componentName: string;
  variantId: string;
}

export function HtmlComponentInstancePanel({
  component,
  instance,
  onVariantChange,
  onOverridesChange,
  onOverridesPreview,
  onEdit,
  onOpenInteractions,
  onDetach,
  onManageVariables,
  variantVariableBinding,
  variantOptionsForVariable,
  assetOptions = [],
  onUploadAsset,
}: {
  component: HtmlComponentDefinition;
  instance: HtmlComponentInstanceContext;
  onVariantChange: (variantId: string) => void;
  onOverridesChange: (overrides: HtmlComponentOverrides) => void;
  /** Paint draft values in the canvas without history or persistence. */
  onOverridesPreview?: (overrides: HtmlComponentOverrides) => void;
  onEdit: () => void;
  onOpenInteractions: () => void;
  onDetach: () => void;
  onManageVariables: () => void;
  variantVariableBinding?: HtmlComponentVariantVariableBindingContext;
  variantOptionsForVariable?: (
    variable: HtmlComponentVariable,
  ) => HtmlComponentVariableVariantOption[];
  assetOptions?: HtmlComponentAssetOption[];
  onUploadAsset?: HtmlComponentAssetUploadHandler;
}) {
  const variantTargetNodeId = variantVariableBinding?.targetNodeId || '';
  const linkedVariantVariable = variantVariableBinding?.variables.find(variable => (
    htmlComponentVariableHasVariantBinding(variable, variantTargetNodeId)
  ));
  const compatibleVariantVariables = variantVariableBinding?.variables.filter(
    variable => variable.type === 'variant',
  ) || [];
  const removeVariantTargetBinding = (variable: HtmlComponentVariable) => (
    variable.type === 'variant'
      ? withoutHtmlComponentVariableBinding(
          withoutHtmlComponentVariableBinding(
            variable,
            variantTargetNodeId,
            HTML_COMPONENT_VARIANT_ATTRIBUTE,
          ),
          variantTargetNodeId,
          '',
        )
      : variable
  );
  const linkVariantVariable = (variableId: string) => {
    if (!variantVariableBinding || !variantTargetNodeId) return;
    const validVariantIds = new Set(component.variants.map(variant => variant.id));
    variantVariableBinding.onChange(variantVariableBinding.variables.map(variable => {
      const withoutTarget = removeVariantTargetBinding(variable);
      if (variable.id !== variableId) return withoutTarget;
      const linked = withHtmlComponentVariableBinding(withoutTarget, {
        targetNodeId: variantTargetNodeId,
        attribute: HTML_COMPONENT_VARIANT_ATTRIBUTE,
      });
      return validVariantIds.has(linked.defaultValue)
        ? linked
        : { ...linked, defaultValue: instance.variantId || component.variants[0]?.id || '' };
    }));
  };
  const createVariantVariable = () => {
    if (!variantVariableBinding || !variantTargetNodeId) return;
    const baseName = `${component.name} Variant`;
    const names = new Set(
      variantVariableBinding.variables.map(variable => variable.name.toLocaleLowerCase()),
    );
    let name = baseName;
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${baseName} ${suffix++}`;
    const variable: HtmlComponentVariable = {
      id: createHtmlComponentId('variable'),
      name,
      type: 'variant',
      bindings: [{
        targetNodeId: variantTargetNodeId,
        attribute: HTML_COMPONENT_VARIANT_ATTRIBUTE,
      }],
      targetNodeId: variantTargetNodeId,
      attribute: HTML_COMPONENT_VARIANT_ATTRIBUTE,
      defaultValue: instance.variantId || component.variants[0]?.id || '',
    };
    variantVariableBinding.onChange([
      ...variantVariableBinding.variables.map(removeVariantTargetBinding),
      variable,
    ]);
    variantVariableBinding.onManage(variable.id);
  };
  const overrideSignature = JSON.stringify(instance.overrides);
  const variableSignature = JSON.stringify(component.variables);
  const editableVariables = component.variables.filter(
    variable => variable.type === 'variant' || htmlComponentVariableBindings(variable).length > 0,
  );
  const effectiveValues = () => Object.fromEntries(
    editableVariables.map(variable => [
      variable.id,
      instance.overrides[variable.id] ?? variable.defaultValue,
    ]),
  );
  const [draftValues, setDraftValues] = useState<Record<string, string>>(effectiveValues);
  const draftValuesRef = useRef(draftValues);
  draftValuesRef.current = draftValues;
  const hasOverrides = editableVariables.some(
    variable => (draftValues[variable.id] ?? variable.defaultValue) !== variable.defaultValue,
  );
  useEffect(() => {
    const next = effectiveValues();
    draftValuesRef.current = next;
    setDraftValues(next);
  }, [instance.instanceId, overrideSignature, variableSignature]);
  const overridesFromValues = (values: Record<string, string>) => {
    const next = { ...instance.overrides };
    editableVariables.forEach(variable => {
      const value = values[variable.id] ?? variable.defaultValue;
      if (value === variable.defaultValue) delete next[variable.id];
      else next[variable.id] = value;
    });
    return next;
  };
  const updateDraftVariable = (variable: HtmlComponentVariable, value: string) => {
    const nextValues = { ...draftValuesRef.current, [variable.id]: value };
    draftValuesRef.current = nextValues;
    setDraftValues(nextValues);
    onOverridesPreview?.(overridesFromValues(nextValues));
  };
  const commitVariable = (variable: HtmlComponentVariable, value: string) => {
    const next = { ...instance.overrides };
    if (value === variable.defaultValue) delete next[variable.id];
    else next[variable.id] = value;
    if (JSON.stringify(next) !== overrideSignature) onOverridesChange(next);
  };
  const reset = () => {
    setDraftValues(Object.fromEntries(
      editableVariables.map(variable => [variable.id, variable.defaultValue]),
    ));
    onOverridesChange({});
  };
  return (
    <div data-ycode-native-ui className="divide-y divide-border">
      <YcodeSettingsPanel
        title="Component instance"
        isOpen
        onToggle={() => undefined}
        action={(
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!hasOverrides} onSelect={reset}><RotateCcw /> Reset all overrides</DropdownMenuItem>
              <DropdownMenuItem onSelect={onDetach}><Unlink /> Detach from component</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      >
        <div className="flex h-10 items-center gap-2 rounded-[10px] border border-white/[.045] bg-white/[.035] px-2">
          <div className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-white/[.055] text-white/55">
            <Component className="size-3.5" />
          </div>
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">{component.name}</span>
          {hasOverrides && <span className="text-[9px] font-normal text-white/38">Modified</span>}
        </div>
        <div className="grid grid-cols-3 items-center gap-2">
          {variantVariableBinding && variantTargetNodeId ? (
            <HtmlComponentVariableLabel
              label="Variant"
              variables={compatibleVariantVariables}
              linkedVariableId={linkedVariantVariable?.id}
              onLinkVariable={linkVariantVariable}
              onUnlinkVariable={() => {
                if (!linkedVariantVariable) return;
                variantVariableBinding.onChange(variantVariableBinding.variables.map(variable => (
                  variable.id === linkedVariantVariable.id
                    ? removeVariantTargetBinding(variable)
                    : variable
                )));
              }}
              onCreateVariable={createVariantVariable}
              onManageVariables={() => variantVariableBinding.onManage(linkedVariantVariable?.id)}
            />
          ) : (
            <Label>Variant</Label>
          )}
          <div className="col-span-2">
            <HtmlSettingsSelectControl
              label="Variant"
              kind="component"
              value={component.variants.some(variant => variant.id === instance.variantId) ? instance.variantId : (component.variants[0]?.id || '')}
              onChange={onVariantChange}
              allowUnset={false}
              options={component.variants.map(variant => ({ value: variant.id, label: variant.name }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-0.5 rounded-[10px] bg-white/[.045] p-0.5">
          <Button variant="ghost" className="h-8 rounded-[8px] bg-transparent" onClick={onEdit}>
            <Pencil /> Editar
          </Button>
          <Button variant="ghost" className="h-8 rounded-[8px] bg-transparent" onClick={onOpenInteractions}>
            <Sparkles /> Interações
          </Button>
        </div>
      </YcodeSettingsPanel>

      <YcodeSettingsPanel
        title="Properties"
        isOpen
        onToggle={() => undefined}
        action={(
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Manage component properties"
            onClick={onManageVariables}
          >
            <Pencil />
          </Button>
        )}
      >
        <div className="flex flex-col divide-y divide-border">
          {editableVariables.map(variable => {
            const value = draftValues[variable.id] ?? variable.defaultValue;
            const overridden = value !== variable.defaultValue;
            const VariableIcon = VARIABLE_TYPES.find(item => item.value === variable.type)?.icon || Component;
            return (
              <div
                key={variable.id}
                data-component-property={variable.type}
                className="grid grid-cols-3 items-start gap-2 py-3 first:pt-0 last:pb-0"
              >
                <Label variant="muted" className="flex min-w-0 items-center gap-1.5 pt-2">
                  <VariableIcon className="size-3 shrink-0 opacity-60" />
                  <span className="truncate">{variable.name}</span>
                </Label>
                <div className="col-span-2 flex min-w-0 items-start gap-1.5">
                  <div className="min-w-0 flex-1">
                    <VariableValueField
                      variable={variable}
                      value={value}
                      variants={variantOptionsForVariable?.(variable) || component.variants}
                      onChange={next => updateDraftVariable(variable, next)}
                      onCommit={next => commitVariable(variable, next)}
                      assetOptions={assetOptions}
                      onUploadAsset={onUploadAsset}
                    />
                  </div>
                  {overridden && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mt-0.5 size-7 shrink-0"
                      aria-label={`Reset ${variable.name} to component default`}
                      onPointerDown={event => event.preventDefault()}
                      onClick={() => {
                        setDraftValues(current => ({
                          ...current,
                          [variable.id]: variable.defaultValue,
                        }));
                        const next = { ...instance.overrides };
                        delete next[variable.id];
                        onOverridesChange(next);
                      }}
                    >
                      <RotateCcw />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {!editableVariables.length && (
          <div className="rounded-[10px] border border-white/[.045] bg-white/[.018] p-3">
            <p className="text-[11px] font-medium text-foreground/88">No exposed properties</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              Expose content or styles from the component master.
            </p>
            <Button variant="secondary" className="mt-3 w-full" onClick={onManageVariables}>
              <Plus /> Expose property
            </Button>
          </div>
        )}
      </YcodeSettingsPanel>
    </div>
  );
}

export function HtmlComponentVariablesDialog({
  open,
  component,
  initialVariableId,
  variantPropertyTarget,
  variantOptionsForVariable,
  assetOptions = [],
  onUploadAsset,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  component: HtmlComponentDefinition | null;
  initialVariableId?: string | null;
  variantPropertyTarget?: HtmlComponentVariantPropertyTarget;
  variantOptionsForVariable?: (
    variable: HtmlComponentVariable,
  ) => HtmlComponentVariableVariantOption[];
  assetOptions?: HtmlComponentAssetOption[];
  onUploadAsset?: HtmlComponentAssetUploadHandler;
  onOpenChange: (open: boolean) => void;
  onChange: (variables: HtmlComponentVariable[]) => void;
}) {
  const [variables, setVariables] = useState<HtmlComponentVariable[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingVariableId, setDraggingVariableId] = useState('');
  const [variableDropTargetId, setVariableDropTargetId] = useState('');
  const variableSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const selected = variables.find(variable => variable.id === selectedId) || variables[0] || null;
  const draggingVariable = variables.find(variable => variable.id === draggingVariableId) || null;
  const DraggingVariableIcon = draggingVariable
    ? VARIABLE_TYPES.find(item => item.value === draggingVariable.type)?.icon || Component
    : Component;
  useEffect(() => {
    if (!open) return;
    const next = component?.variables.map(variable => ({
      ...variable,
      bindings: htmlComponentVariableBindings(variable),
    })) || [];
    setVariables(next);
    setSelectedId(
      (initialVariableId && next.some(variable => variable.id === initialVariableId)
        ? initialVariableId
        : next[0]?.id) || null,
    );
  }, [component?.id, initialVariableId, open]);
  const update = (changes: Partial<HtmlComponentVariable>) => {
    if (!selected) return;
    setVariables(current => current.map(variable => (
      variable.id === selected.id ? { ...variable, ...changes } : variable
    )));
  };
  const addVariable = (type: HtmlComponentVariableType) => {
    const id = `variable-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`;
    const baseName = type === 'variant' && variantPropertyTarget
      ? `${variantPropertyTarget.componentName} Variant`
      : VARIABLE_TYPES.find(item => item.value === type)?.label || 'Variable';
    const names = new Set(variables.map(variable => variable.name.toLocaleLowerCase()));
    let name = baseName;
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${baseName} ${suffix++}`;
    const variantBinding = type === 'variant' && variantPropertyTarget
      ? [{
          targetNodeId: variantPropertyTarget.targetNodeId,
          attribute: HTML_COMPONENT_VARIANT_ATTRIBUTE,
        }]
      : [];
    const next: HtmlComponentVariable = {
      id,
      name,
      type,
      bindings: variantBinding,
      targetNodeId: variantBinding[0]?.targetNodeId || '',
      attribute: variantBinding[0]?.attribute || '',
      defaultValue: type === 'variant'
        ? variantPropertyTarget?.variantId || component?.variants[0]?.id || ''
        : '',
    };
    setVariables(current => [
      ...current.map(variable => (
        type === 'variant'
        && variantPropertyTarget
        && variable.type === 'variant'
          ? withoutHtmlComponentVariableBinding(
              withoutHtmlComponentVariableBinding(
                variable,
                variantPropertyTarget.targetNodeId,
                HTML_COMPONENT_VARIANT_ATTRIBUTE,
              ),
              variantPropertyTarget.targetNodeId,
              '',
            )
          : variable
      )),
      next,
    ]);
    setSelectedId(id);
  };
  const removeVariable = (variableId: string) => {
    const next = variables.filter(variable => variable.id !== variableId);
    setVariables(next);
    if (selectedId === variableId) setSelectedId(next[0]?.id || null);
  };
  const reorderVariable = (activeId: string, overId: string) => {
    if (!activeId || activeId === overId) return;
    setVariables(current => {
      const next = [...current];
      const from = next.findIndex(variable => variable.id === activeId);
      const to = next.findIndex(variable => variable.id === overId);
      if (from < 0 || to < 0) return current;
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  };
  if (!component) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-ycode-native-ui
        width="min(1120px, calc(100vw - 24px))"
        className="h-[640px] max-h-[calc(100dvh-144px)] w-[1120px] gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Component variables</DialogTitle>
        <div className="flex h-full min-h-0">
          <aside className="flex w-72 min-h-0 shrink-0 flex-col border-r border-border px-6">
            <header className="flex shrink-0 items-center justify-between py-5">
              <span className="text-sm font-medium">Component variables</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="secondary" className="size-7 rounded-md" aria-label="Add variable"><Plus /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {VARIABLE_TYPES.map(item => (
                    <DropdownMenuItem key={item.value} onClick={() => addVariable(item.value)}>
                      <item.icon /> {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </header>
            <DndContext
              sensors={variableSensors}
              collisionDetection={closestCenter}
              onDragStart={({ active }) => {
                const activeId = String(active.id);
                setDraggingVariableId(activeId);
                setVariableDropTargetId(activeId);
              }}
              onDragOver={({ over }) => setVariableDropTargetId(over ? String(over.id) : '')}
              onDragCancel={() => {
                setDraggingVariableId('');
                setVariableDropTargetId('');
              }}
              onDragEnd={({ active, over }) => {
                if (over) reorderVariable(String(active.id), String(over.id));
                setDraggingVariableId('');
                setVariableDropTargetId('');
              }}
            >
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto no-scrollbar">
                {variables.map((variable, variableIndex) => {
                  const Icon = VARIABLE_TYPES.find(item => item.value === variable.type)?.icon || Component;
                  const activeIndex = variables.findIndex(item => item.id === draggingVariableId);
                  const dropEdge: ComponentReorderDropEdge = (
                    draggingVariableId
                    && draggingVariableId !== variable.id
                    && variableDropTargetId === variable.id
                  )
                    ? (activeIndex < variableIndex ? 'after' : 'before')
                    : null;
                  return (
                    <ComponentReorderRow
                      key={variable.id}
                      id={variable.id}
                      dropEdge={dropEdge}
                      className={cn(
                        'h-8 w-full rounded-lg px-2 text-left text-xs',
                        selected?.id === variable.id ? 'bg-purple-500/20 text-purple-300' : 'text-muted-foreground hover:bg-secondary/50',
                      )}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center justify-start gap-1 text-left"
                        onClick={() => setSelectedId(variable.id)}
                      >
                        <Icon className="size-3 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{variable.name}</span>
                      </button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className={cn('ml-auto size-6 shrink-0', selected?.id === variable.id ? '' : 'opacity-0 group-hover:opacity-100')}
                        aria-label={`Delete ${variable.name}`}
                        onClick={() => removeVariable(variable.id)}
                      >
                        <Trash2 />
                      </Button>
                    </ComponentReorderRow>
                  );
                })}
              </div>
              <DragOverlay dropAnimation={null}>
                {draggingVariable && (
                  <div className="pointer-events-none flex h-8 min-w-40 max-w-64 items-center gap-1 rounded-lg border border-[var(--kodety-accent-hover)]/30 bg-[linear-gradient(rgb(147_147_255/.14),rgb(147_147_255/.14)),rgb(20_20_22/.94)] px-3 text-xs font-medium text-[var(--kodety-accent-hover)] shadow-xl backdrop-blur-sm">
                    <DraggingVariableIcon className="size-3 shrink-0" />
                    <span className="truncate">{draggingVariable.name}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
            {!variables.length && <p className="pb-5 text-xs leading-5 text-muted-foreground">No variables yet. Click + to add one.</p>}
          </aside>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-7 pt-14 no-scrollbar">
              {selected ? (
                <>
                  <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-4">
                    <Label variant="muted">Name</Label>
                    <Input value={selected.name} onChange={event => update({ name: event.target.value })} />
                  </div>
                  {['text', 'rich_text'].includes(selected.type) && (
                    <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-4">
                      <Label variant="muted">Placeholder</Label>
                      <Input value={selected.placeholder || ''} placeholder="Enter text..." onChange={event => update({ placeholder: event.target.value })} />
                    </div>
                  )}
                  <div className="border-t border-border" />
                  <div className="grid grid-cols-[132px_minmax(0,1fr)] items-start gap-4">
                    <Label variant="muted" className="pt-2">Default</Label>
                    <div className="min-w-0">
                      <VariableValueField
                        variable={selected}
                        value={selected.defaultValue}
                        variants={variantOptionsForVariable?.(selected) || component.variants}
                        assetOptions={assetOptions}
                        onUploadAsset={onUploadAsset}
                        onChange={defaultValue => update({ defaultValue })}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">Select or add a variable.</div>
              )}
            </div>
            <DialogFooter className="shrink-0 border-t border-border px-5 py-4">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  onChange(variables);
                  onOpenChange(false);
                }}
              >
                <Check /> Save variables
              </Button>
            </DialogFooter>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HtmlComponentVariantsSection({
  component,
  activeVariantId,
  onDone,
  onManageVariables,
  onOpenInteractions,
  onSelectVariant,
  onRenameVariant,
  onDuplicateVariant,
  onDeleteVariant,
  onReorderVariants,
}: {
  component: HtmlComponentDefinition;
  activeVariantId: string;
  onDone: () => void;
  onManageVariables: () => void;
  onOpenInteractions: () => void;
  onSelectVariant: (variantId: string) => void;
  onRenameVariant: (variant: HtmlComponentVariant) => void;
  onDuplicateVariant: (variantId: string) => void;
  onDeleteVariant: (variantId: string) => void;
  onReorderVariants: (variantIds: string[]) => void;
}) {
  const [draggingId, setDraggingId] = useState('');
  const [variantDropTargetId, setVariantDropTargetId] = useState('');
  const variantSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const draggingVariant = component.variants.find(variant => variant.id === draggingId) || null;
  const reorder = (activeId: string, overId: string) => {
    if (!activeId || activeId === overId) return;
    const ids = component.variants.map(variant => variant.id);
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorderVariants(ids);
  };
  return (
    <section data-ycode-native-ui data-kodety-onboarding="design-component-variants" className="shrink-0 border-b border-border pb-4">
      <div className="flex items-center gap-2 py-3">
        <div className="grid size-7 place-items-center rounded-lg bg-purple-500/20 text-purple-300"><Component className="size-3.5" /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{component.name}</p>
          <p className="text-[10px] text-muted-foreground">Editing component</p>
        </div>
        <Button size="sm" onClick={onDone}><Check /> Done</Button>
      </div>
      <header data-kodety-onboarding="component-options" className="py-3">
        <span className="block text-xs font-medium">Component variants</span>
        <div className="mt-2 grid grid-cols-2 gap-1">
          <Button variant="secondary" size="sm" className="w-full" onClick={onManageVariables}><Pencil /> Variables</Button>
          <Button variant="purple" size="sm" className="w-full" onClick={onOpenInteractions}><Sparkles /> Eventos</Button>
        </div>
      </header>
      <DndContext
        sensors={variantSensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => {
          const activeId = String(active.id);
          setDraggingId(activeId);
          setVariantDropTargetId(activeId);
        }}
        onDragOver={({ over }) => setVariantDropTargetId(over ? String(over.id) : '')}
        onDragCancel={() => {
          setDraggingId('');
          setVariantDropTargetId('');
        }}
        onDragEnd={({ active, over }) => {
          if (over) reorder(String(active.id), String(over.id));
          setDraggingId('');
          setVariantDropTargetId('');
        }}
      >
        <div data-kodety-onboarding="component-variants-list" className="flex flex-col gap-0.5">
          {component.variants.map((variant, variantIndex) => {
            const activeIndex = component.variants.findIndex(item => item.id === draggingId);
            const dropEdge: ComponentReorderDropEdge = (
              draggingId
              && draggingId !== variant.id
              && variantDropTargetId === variant.id
            )
              ? (activeIndex < variantIndex ? 'after' : 'before')
              : null;
            return (
              <ComponentReorderRow
                key={variant.id}
                id={variant.id}
                dropEdge={dropEdge}
                className={cn(
                  'h-8 rounded-lg px-3 text-xs',
                  activeVariantId === variant.id
                    ? 'bg-purple-500/20 text-purple-300'
                    : 'text-muted-foreground hover:bg-secondary/50',
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center justify-start gap-1 text-left"
                  onClick={() => onSelectVariant(variant.id)}
                  onDoubleClick={() => onRenameVariant(variant)}
                >
                  <Component className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{variant.name}</span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-6 opacity-0 group-hover:opacity-100"
                      onClick={event => event.stopPropagation()}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onRenameVariant(variant)}><Type /> Rename</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onDuplicateVariant(variant.id)}><Copy /> Duplicate</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={component.variants.length <= 1}
                      onSelect={() => onDeleteVariant(variant.id)}
                    >
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ComponentReorderRow>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {draggingVariant && (
            <div className="pointer-events-none flex h-8 min-w-40 max-w-64 items-center gap-1 rounded-lg border border-[var(--kodety-accent-hover)]/30 bg-[linear-gradient(rgb(147_147_255/.14),rgb(147_147_255/.14)),rgb(20_20_22/.94)] px-3 text-xs font-medium text-[var(--kodety-accent-hover)] shadow-xl backdrop-blur-sm">
              <Component className="size-3 shrink-0" />
              <span className="truncate">{draggingVariant.name}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
