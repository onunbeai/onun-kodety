'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import FontPicker from '../../components/FontPicker';
import ColorPicker from '../../components/ColorPicker';
import {
  VisualMeasurementControl,
  VisualSelectControl,
} from '../../components/VisualStyleField';
import {
  ArrowsExpandHorizontal,
  Braces,
  Check,
  ChevronRight,
  Clock3,
  Droplet,
  Folder,
  Hash,
  Palette,
  Pencil,
  Plus,
  Search,
  Trash2,
  Type,
  Variable,
  X,
  type LucideIcon,
} from '@/components/ui/gravity-icons';
import {
  HTML_DESIGN_TOKEN_TYPES,
  createHtmlDesignTokenCollectionId,
  createHtmlDesignTokenId,
  designTokenDefaultValue,
  designTokenIdFromReference,
  designTokenReference,
  designTokenTypeForProperty,
  isDesignTokenCompatible,
  isDesignTokenDurationValue,
  normalizeHtmlDesignTokens,
  type HtmlDesignToken,
  type HtmlDesignTokenDocument,
  type HtmlDesignTokenType,
} from '@/lib/html-editor/design-tokens';
import {
  controlFontFamilyToCss,
  cssFontFamilyToControl,
} from '@/lib/html-editor/visual-style-adapter';
import { cn } from '@/lib/utils';

interface TokenDraft {
  id?: string;
  name: string;
  value: string;
  type: HtmlDesignTokenType;
  collectionId: string;
}

function tokenTypeLabel(type: HtmlDesignTokenType) {
  return HTML_DESIGN_TOKEN_TYPES.find(option => option.value === type)?.label || type;
}

const DESIGN_TOKEN_TYPE_ICONS: Record<HtmlDesignTokenType, LucideIcon> = {
  color: Palette,
  size: ArrowsExpandHorizontal,
  percentage: Hash,
  number: Hash,
  duration: Clock3,
  'font-family': Type,
  string: Braces,
};

function DesignTokenTypeIcon({
  type,
  className,
}: {
  type: HtmlDesignTokenType;
  className?: string;
}) {
  const Icon = DESIGN_TOKEN_TYPE_ICONS[type];
  return <Icon className={cn('size-3.5', className)} />;
}

function DesignTokenIconAction({
  label,
  children,
  onClick,
  disabled = false,
  embedded = false,
  danger = false,
  className,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  embedded?: boolean;
  danger?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'grid size-8 shrink-0 place-items-center text-[var(--kodety-text-tertiary)] outline-none transition-[background-color,color,opacity] hover:bg-white/[.065] hover:text-[var(--kodety-text)] disabled:pointer-events-none disabled:text-[var(--kodety-text-disabled)]',
            embedded
              ? 'focus-visible:bg-white/[.055] focus-visible:text-[var(--kodety-accent-hover)]'
              : 'rounded-[7px] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]/70',
            danger && 'hover:bg-[color-mix(in_srgb,var(--kodety-danger)_10%,transparent)] hover:text-[var(--kodety-danger)]',
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="z-[700]" side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function DesignTokenTextControl({
  value,
  onChange,
  placeholder,
  ariaLabel,
  icon: FieldIcon,
  autoFocus = false,
  mono = false,
  actions,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  icon?: LucideIcon;
  autoFocus?: boolean;
  mono?: boolean;
  actions?: ReactNode;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <div
      data-design-token-field
      className="group/design-token-field flex h-8 min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] hover:bg-white/[.065] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065]"
      onPointerDown={event => event.stopPropagation()}
    >
      {FieldIcon && (
        <span
          aria-hidden="true"
          className="grid h-full w-8 shrink-0 place-items-center text-white/35 transition-colors group-hover/design-token-field:text-white/55 group-focus-within/design-token-field:text-[var(--kodety-accent-hover)]"
        >
          <FieldIcon className="size-3.5" />
        </span>
      )}
      <input
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        onChange={event => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        className={cn(
          'h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-[11px] text-[var(--kodety-text)] outline-none placeholder:text-white/35',
          mono && 'font-mono tabular-nums',
        )}
      />
      {actions && (
        <span className="flex h-full shrink-0 divide-x divide-white/[.055] border-l border-white/[.055] bg-black/10">
          {actions}
        </span>
      )}
    </div>
  );
}

function tokenSwatch(token: HtmlDesignToken) {
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-white/[.045] text-[var(--kodety-text-tertiary)]">
      <DesignTokenTypeIcon type={token.type} />
    </span>
  );
}

function tokenValuePreview(token: HtmlDesignToken) {
  if (token.type === 'color') {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="kodety-transparency-preview">
          <span className="kodety-color-swatch-checker absolute inset-0 z-0" />
          <span className="absolute inset-0 z-10" style={{ background: token.value }} />
        </span>
        <span className="truncate font-mono text-[10px] text-[var(--kodety-text-secondary)]">{token.value}</span>
      </span>
    );
  }
  if (token.type === 'font-family') {
    return (
      <span
        className="block truncate text-[11px] text-[var(--kodety-text-secondary)]"
        style={{ fontFamily: token.value }}
      >
        {token.value}
      </span>
    );
  }
  return <span className="block truncate font-mono text-[10px] text-[var(--kodety-text-secondary)]">{token.value}</span>;
}

function NewDesignTokenMenu({
  onSelect,
  label = 'Nova variável',
  secondary = false,
}: {
  onSelect: (type: HtmlDesignTokenType) => void;
  label?: string;
  secondary?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant={secondary ? 'secondary' : 'default'}
          className={cn(
            'h-8 shrink-0 gap-1.5 rounded-[8px] px-2.5 text-[10px]',
            !secondary && 'bg-[var(--kodety-accent)] text-white hover:bg-[var(--kodety-accent-hover)]',
            secondary && 'border-transparent bg-white/[.05] text-[var(--kodety-text-secondary)] hover:bg-white/[.065] hover:text-[var(--kodety-text)]',
          )}
        >
          <Plus className="size-3.5" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-design-token-ui
        align="end"
        className="z-[620] w-52 rounded-[9px] border-white/[.08] bg-[var(--kodety-panel)] p-1 shadow-[0_10px_24px_rgba(0,0,0,.24)]"
      >
        {HTML_DESIGN_TOKEN_TYPES.map(option => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onSelect(option.value)}
            className="min-h-9 rounded-[6px] px-2 text-[10px]"
          >
            <span className="grid size-5 place-items-center rounded-[5px] bg-white/[.045] text-[var(--kodety-text-tertiary)]">
              <DesignTokenTypeIcon type={option.value} className="size-3" />
            </span>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TokenEditor({
  draft,
  collections,
  compact = false,
  onChange,
  onCancel,
  onSave,
}: {
  draft: TokenDraft;
  collections: HtmlDesignTokenDocument['collections'];
  compact?: boolean;
  onChange: (next: TokenDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const typeOptions = HTML_DESIGN_TOKEN_TYPES.map(option => ({
    value: option.value,
    label: option.label,
    icon: <DesignTokenTypeIcon type={option.value} className="size-3.5" />,
  }));
  const collectionOptions = collections.map(collection => ({
    value: collection.id,
    label: collection.name,
    icon: <Folder className="size-3.5" />,
  }));
  const setType = (type: HtmlDesignTokenType) => onChange({
    ...draft,
    type,
    value: type === draft.type ? draft.value : designTokenDefaultValue(type),
  });
  const canSave = Boolean(
    draft.name.trim()
    && draft.value.trim()
    && (draft.type !== 'duration' || isDesignTokenDurationValue(draft.value)),
  );
  const fieldLabelClassName = 'text-[10px] font-medium text-[var(--kodety-text-tertiary)]';
  const floatingSelectClassName =
    'z-[620] w-[min(240px,calc(100vw-24px))] shadow-[0_10px_24px_rgba(0,0,0,.24)]';

  return (
    <div
      data-design-token-ui
      data-design-token-editor
      data-kodety-onboarding="variables-editor"
      className={cn(
        'grid gap-2.5',
        compact
          ? 'p-2.5'
          : 'rounded-[10px] border border-white/[.075] bg-white/[.015] p-3',
      )}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <div className="grid min-w-0 gap-1.5">
        <span className={fieldLabelClassName}>Nome</span>
        <DesignTokenTextControl
          autoFocus
          value={draft.name}
          placeholder={draft.type === 'font-family' ? 'Ex.: H1 / Display' : 'Ex.: Brand / Primary'}
          ariaLabel="Nome da variável"
          icon={Variable}
          onChange={name => onChange({ ...draft, name })}
          onKeyDown={event => {
            if (event.key === 'Enter' && canSave) onSave();
          }}
        />
      </div>
      <div className={cn('grid min-w-0 gap-2', compact ? 'grid-cols-1' : 'grid-cols-2')}>
        <div className="grid min-w-0 gap-1.5">
          <span className={fieldLabelClassName}>Tipo</span>
          <VisualSelectControl
            value={draft.type}
            options={typeOptions}
            onValueChange={value => setType(value as HtmlDesignTokenType)}
            ariaLabel="Tipo da variável"
            contentDataDesignTokenUi
            contentClassName={floatingSelectClassName}
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <span className={fieldLabelClassName}>Coleção</span>
          <VisualSelectControl
            value={draft.collectionId}
            options={collectionOptions}
            onValueChange={collectionId => onChange({ ...draft, collectionId })}
            ariaLabel="Coleção da variável"
            contentDataDesignTokenUi
            contentClassName={floatingSelectClassName}
          />
        </div>
      </div>
      {draft.type === 'font-family' ? (
        <div className="grid min-w-0 gap-1.5">
          <span className={fieldLabelClassName}>Fonte</span>
          <FontPicker
            value={cssFontFamilyToControl(draft.value)}
            onChange={value => onChange({
              ...draft,
              value: controlFontFamilyToCss(value),
            })}
            triggerIcon={<Type className="size-3.5" />}
            triggerClassName="!h-8 !rounded-[8px] !border-transparent !bg-white/[.05] !px-2 text-[11px] hover:!bg-white/[.065] focus-visible:!border-[var(--kodety-focus)]/70 focus-visible:!ring-0 data-[state=open]:!border-[var(--kodety-focus)]/70 data-[state=open]:!bg-white/[.065]"
            popoverContentClassName="z-[620]"
          />
          <p className="text-[9px] leading-3.5 text-[var(--kodety-info-copy)]">
            A variável guarda a família. O peso continua livre no controle Weight.
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-1.5">
          <span className={fieldLabelClassName}>Valor</span>
          {draft.type === 'color' ? (
            <div className="min-w-0 *:w-full">
              <ColorPicker
                value={draft.value}
                onChange={value => onChange({ ...draft, value })}
                onImmediateChange={value => onChange({ ...draft, value })}
                popoverContentClassName="z-[620]"
                popoverSide="right"
                popoverAlign="start"
                triggerClassName="!h-8 !w-full !rounded-[8px] !border-transparent !bg-white/[.05] !px-2 text-[11px] hover:!border-transparent hover:!bg-white/[.065] focus-visible:!border-[var(--kodety-focus)]/70 focus-visible:!ring-0 data-[state=open]:!border-[var(--kodety-focus)]/70 data-[state=open]:!bg-white/[.065]"
                onClear={() => onChange({ ...draft, value: 'transparent' })}
                solidOnly
              />
            </div>
          ) : draft.type === 'size' || draft.type === 'percentage' || draft.type === 'number' || draft.type === 'duration' ? (
            <VisualMeasurementControl
              glyph={draft.type === 'duration' ? 'duration' : 'value'}
              icon={<DesignTokenTypeIcon type={draft.type} className="size-3.5" />}
              value={draft.value}
              onChange={value => onChange({ ...draft, value })}
              ariaLabel="Valor da variável"
              placeholder={designTokenDefaultValue(draft.type)}
              step={draft.type === 'number' ? 0.1 : 1}
              inputMode={draft.type === 'duration' ? 'text' : 'decimal'}
              className="w-full"
            />
          ) : (
            <DesignTokenTextControl
              value={draft.value}
              placeholder={designTokenDefaultValue(draft.type)}
              ariaLabel="Valor da variável"
              icon={Braces}
              mono
              onChange={value => onChange({ ...draft, value })}
            />
          )}
        </div>
      )}
      <div className="flex justify-end gap-1.5 pt-1">
        <Button size="xs" variant="ghost" className="h-7 rounded-[7px] px-2.5 text-[10px]" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          size="xs"
          className="h-7 gap-1.5 rounded-[7px] bg-[var(--kodety-accent)] px-2.5 text-[10px] text-[var(--kodety-accent-foreground)] hover:bg-[var(--kodety-accent-hover)]"
          disabled={!canSave}
          onClick={onSave}
        >
          <Check className="size-3" /> Salvar
        </Button>
      </div>
    </div>
  );
}

export function HtmlDesignTokenManager({
  document,
  onChange,
  onClose,
  editTokenId,
  onEditTokenHandled,
}: {
  document: HtmlDesignTokenDocument;
  onChange: (next: HtmlDesignTokenDocument) => void;
  onClose?: () => void;
  editTokenId?: string | null;
  onEditTokenHandled?: () => void;
}) {
  const normalized = normalizeHtmlDesignTokens(document);
  const [collectionId, setCollectionId] = useState(normalized.collections[0].id);
  const activeCollectionId = normalized.collections.some(item => item.id === collectionId)
    ? collectionId
    : normalized.collections[0].id;
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<TokenDraft | null>(null);
  const [addingCollection, setAddingCollection] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const activeCollection = normalized.collections.find(item => item.id === activeCollectionId)
    || normalized.collections[0];
  const collectionTokenCounts = useMemo(() => {
    const counts = new Map<string, number>();
    normalized.tokens.forEach(token => {
      counts.set(token.collectionId, (counts.get(token.collectionId) || 0) + 1);
    });
    return counts;
  }, [normalized.tokens]);

  const visibleTokens = normalized.tokens.filter(token => (
    token.collectionId === activeCollectionId
    && (!query.trim() || `${token.name} ${token.value} ${token.type}`.toLowerCase().includes(query.trim().toLowerCase()))
  ));

  const beginCreate = (type: HtmlDesignTokenType = 'color') => {
    setDraft({
      name: '',
      value: designTokenDefaultValue(type),
      type,
      collectionId: activeCollectionId,
    });
  };
  const saveCollection = () => {
    const name = collectionName.trim();
    if (!name) return;
    const id = createHtmlDesignTokenCollectionId();
    onChange({
      ...normalized,
      collections: [...normalized.collections, { id, name }],
    });
    setCollectionId(id);
    setCollectionName('');
    setAddingCollection(false);
  };
  const saveDraft = () => {
    if (!draft?.name.trim() || !draft.value.trim()) return;
    if (draft.type === 'duration' && !isDesignTokenDurationValue(draft.value)) return;
    const token: HtmlDesignToken = {
      id: draft.id || createHtmlDesignTokenId(),
      collectionId: draft.collectionId,
      name: draft.name.trim(),
      type: draft.type,
      value: draft.value.trim(),
    };
    const exists = normalized.tokens.some(item => item.id === token.id);
    onChange({
      ...normalized,
      tokens: exists
        ? normalized.tokens.map(item => item.id === token.id ? token : item)
        : [...normalized.tokens, token],
    });
    setDraft(null);
  };

  useEffect(() => {
    if (!editTokenId) return;
    const token = normalized.tokens.find(item => item.id === editTokenId);
    onEditTokenHandled?.();
    if (!token) return;
    setCollectionId(token.collectionId);
    setQuery('');
    setDraft({
      id: token.id,
      name: token.name,
      value: token.value,
      type: token.type,
      collectionId: token.collectionId,
    });
  }, [editTokenId]);

  return (
    <div
      className="grid min-h-0 min-w-0 flex-1 grid-cols-[196px_minmax(0,1fr)]"
      data-design-token-ui
      data-kodety-onboarding-draft={draft || addingCollection ? '' : undefined}
    >
      <aside data-kodety-onboarding="variables-collections" className="flex min-h-0 min-w-0 flex-col border-r border-[var(--kodety-divider)] bg-[var(--kodety-panel)]">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[12px] font-semibold tracking-[-0.01em]">Variáveis</h2>
            <p className="truncate text-[8px] text-muted-foreground">Tokens do projeto</p>
          </div>
          <DesignTokenIconAction
            label="Nova coleção"
            onClick={() => setAddingCollection(true)}
          >
            <Plus className="size-3.5" />
          </DesignTokenIconAction>
          {onClose && (
            <DesignTokenIconAction
              label="Fechar Variáveis"
              onClick={onClose}
            >
              <X className="size-3.5" />
            </DesignTokenIconAction>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[8px] font-semibold uppercase tracking-[.1em] text-muted-foreground">
              Coleções
            </span>
            <span className="text-[8px] tabular-nums text-muted-foreground/60">
              {normalized.collections.length}
            </span>
          </div>

          {addingCollection && (
            <div className="mb-2">
              <DesignTokenTextControl
                autoFocus
                value={collectionName}
                onChange={setCollectionName}
                placeholder="Nome da coleção"
                ariaLabel="Nome da coleção"
                icon={Folder}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setAddingCollection(false);
                    setCollectionName('');
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    saveCollection();
                  }
                }}
                actions={(
                  <>
                    <DesignTokenIconAction
                      embedded
                      label="Cancelar coleção"
                      onClick={() => {
                        setAddingCollection(false);
                        setCollectionName('');
                      }}
                    >
                      <X className="size-3" />
                    </DesignTokenIconAction>
                    <DesignTokenIconAction
                      embedded
                      label="Salvar coleção"
                      disabled={!collectionName.trim()}
                      onClick={saveCollection}
                    >
                      <Check className="size-3" />
                    </DesignTokenIconAction>
                  </>
                )}
              />
            </div>
          )}

          <div className="grid gap-1">
            {normalized.collections.map(collection => {
              const active = activeCollectionId === collection.id;
              return (
                <button
                  type="button"
                  key={collection.id}
                  onClick={() => {
                    setCollectionId(collection.id);
                    setDraft(null);
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group flex min-h-10 min-w-0 items-center gap-2 rounded-[8px] px-2 text-left outline-none transition-colors hover:bg-white/[.055] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]/70',
                    active && 'bg-white/[.09] text-[var(--kodety-text)]',
                  )}
                >
                  <span className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-[6px] bg-white/[.035] text-[var(--kodety-text-tertiary)]',
                    active && 'bg-white/[.09] text-[var(--kodety-text)]',
                  )}>
                    <Folder className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[10px] font-medium">
                    {collection.name}
                  </span>
                  <span className="text-[8px] tabular-nums text-muted-foreground/70">
                    {collectionTokenCounts.get(collection.id) || 0}
                  </span>
                  <ChevronRight className={cn(
                    'size-3 shrink-0 text-muted-foreground/50 transition-transform',
                    active && 'translate-x-0.5 text-zinc-300',
                  )} />
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <header data-kodety-onboarding="variables-tools" className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[0.07] px-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[12px] font-semibold">{activeCollection.name}</h3>
            <p className="text-[8px] text-muted-foreground">
              {collectionTokenCounts.get(activeCollectionId) || 0} variáveis
            </p>
          </div>
          <div className="w-[min(260px,42%)] min-w-0 shrink">
            <DesignTokenTextControl
              value={query}
              onChange={setQuery}
              placeholder="Buscar variáveis…"
              ariaLabel="Buscar variáveis"
              icon={Search}
              actions={query ? (
                <DesignTokenIconAction embedded label="Limpar busca" onClick={() => setQuery('')}>
                  <X className="size-3" />
                </DesignTokenIconAction>
              ) : undefined}
            />
          </div>
          <NewDesignTokenMenu onSelect={beginCreate} />
        </header>

        {draft && (
          <div className="shrink-0 border-b border-white/[0.07] bg-white/[0.012] p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-[6px] bg-white/[.05] text-[var(--kodety-text-tertiary)]">
                <DesignTokenTypeIcon type={draft.type} className="size-3.5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold">
                  {draft.id ? 'Editar variável' : 'Nova variável'}
                </p>
                <p className="text-[8px] text-muted-foreground">{tokenTypeLabel(draft.type)}</p>
              </div>
            </div>
            <TokenEditor
              draft={draft}
              collections={normalized.collections}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={saveDraft}
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!draft && !visibleTokens.length ? (
            <div className="grid min-h-72 place-items-center px-6 text-center">
              <div>
                <span className="mx-auto inline-flex size-11 items-center justify-center rounded-[10px] bg-white/[.045] text-[var(--kodety-text-tertiary)]">
                  <Droplet className="size-5" />
                </span>
                <p className="mt-3 text-[11px] font-medium">
                  {query ? 'Nenhuma variável encontrada' : 'Nenhuma variável nesta coleção'}
                </p>
                <p className="mx-auto mt-1 max-w-[230px] text-[9px] leading-4 text-muted-foreground">
                  {query
                    ? 'Tente buscar por outro nome, valor ou tipo.'
                    : 'Crie valores reutilizáveis para cores, tamanhos, fontes e propriedades CSS.'}
                </p>
                {!query && (
                  <div className="mt-3 flex justify-center">
                    <NewDesignTokenMenu onSelect={beginCreate} label="Criar variável" secondary />
                  </div>
                )}
              </div>
            </div>
          ) : visibleTokens.length ? (
            <div data-kodety-onboarding="variables-values" role="table" aria-label={`Variáveis de ${activeCollection.name}`}>
              <div
                role="row"
                className="sticky top-0 z-10 grid h-9 grid-cols-[minmax(0,1.1fr)_minmax(170px,0.9fr)_64px] items-center border-b border-white/[0.07] bg-[var(--kodety-panel)] px-3 text-[8px] font-semibold uppercase tracking-[.08em] text-muted-foreground"
              >
                <span role="columnheader">Nome</span>
                <span role="columnheader">Valor base</span>
                <span role="columnheader" className="sr-only">Ações</span>
              </div>
              {visibleTokens.map(token => (
                <div
                  role="row"
                  key={token.id}
                  className="group grid min-h-12 grid-cols-[minmax(0,1.1fr)_minmax(170px,0.9fr)_64px] items-center border-b border-white/[0.045] px-3 transition-colors hover:bg-white/[0.028]"
                >
                  <div role="cell" className="flex min-w-0 items-center gap-2.5 pr-3">
                    {tokenSwatch(token)}
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-medium text-zinc-100">{token.name}</p>
                      <p className="truncate text-[8px] text-muted-foreground">{tokenTypeLabel(token.type)}</p>
                    </div>
                  </div>
                  <div role="cell" className="min-w-0 pr-3">
                    {tokenValuePreview(token)}
                  </div>
                  <div role="cell" className="flex items-center justify-end gap-0.5">
                    <DesignTokenIconAction
                      label={`Editar ${token.name}`}
                      className="size-7 rounded-[6px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => setDraft({
                        id: token.id,
                        name: token.name,
                        value: token.value,
                        type: token.type,
                        collectionId: token.collectionId,
                      })}
                    >
                      <Pencil className="size-3.5" />
                    </DesignTokenIconAction>
                    <DesignTokenIconAction
                      danger
                      label={`Excluir ${token.name} e preservar os valores aplicados`}
                      className="size-7 rounded-[6px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => onChange({
                        ...normalized,
                        tokens: normalized.tokens.filter(item => item.id !== token.id),
                      })}
                    >
                      <Trash2 className="size-3.5" />
                    </DesignTokenIconAction>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function HtmlDesignTokenPanel({
  width,
  document,
  onChange,
  onClose,
  editTokenId,
  onEditTokenHandled,
}: {
  width: number;
  document: HtmlDesignTokenDocument;
  onChange: (next: HtmlDesignTokenDocument) => void;
  onClose: () => void;
  editTokenId?: string | null;
  onEditTokenHandled?: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const preferredWidth = Math.max(760, Math.min(860, width + 580));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const path = event.composedPath();
      if (panelRef.current && path.includes(panelRef.current)) return;
      if (path.some(item => (
        item instanceof Element
        && item.closest('[data-variables-panel-trigger], [data-design-token-ui], [data-kodety-onboarding-ui]')
      ))) return;
      onClose();
    };
    globalThis.document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => globalThis.document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [onClose]);

  return (
    <section
      ref={panelRef}
      id="html-editor-variables-panel"
      data-kodety-onboarding="design-variables-panel"
      data-design-token-ui
      className="absolute inset-y-0 left-0 z-[80] flex min-h-0 overflow-hidden border-r border-[var(--kodety-divider)] bg-[var(--kodety-panel)]"
      style={{ width: `min(${preferredWidth}px, calc(100vw - 64px))` }}
      onPointerDown={event => event.stopPropagation()}
      aria-label="Painel Variáveis"
    >
      <HtmlDesignTokenManager
        document={document}
        onChange={onChange}
        onClose={onClose}
        editTokenId={editTokenId}
        onEditTokenHandled={onEditTokenHandled}
      />
    </section>
  );
}

const SECTION_FIELD_PROPERTIES: Record<string, Record<string, string>> = {
  typography: {
    font: 'font-family',
    weight: 'font-weight',
    size: 'font-size',
    color: 'color',
    align: 'text-align',
    transform: 'text-transform',
    'line clamp': '-webkit-line-clamp',
    'text wrap': 'text-wrap',
  },
  layout: {
    justify: 'justify-content',
    gap: 'gap',
    wrap: 'flex-wrap',
  },
  'self layout': {
    'self align': 'align-self',
  },
  size: {
    width: 'width',
    height: 'height',
    'min w': 'min-width',
    'min h': 'min-height',
    'max w': 'max-width',
    'max h': 'max-height',
    overflow: 'overflow',
    'aspect ratio': 'aspect-ratio',
  },
  position: {
    type: 'position',
    'z index': 'z-index',
  },
  effects: {
    opacity: 'opacity',
    blur: 'filter',
    'bg blur': 'backdrop-filter',
  },
  backgrounds: {
    color: 'background-color',
  },
  border: {
    border: 'border',
    outline: 'outline',
  },
  transform: {
    origin: 'transform-origin',
    scale: 'scale',
    rotate: 'rotate',
  },
  transition: {
    property: 'transition-property',
    duration: 'transition-duration',
    easing: 'transition-timing-function',
    delay: 'transition-delay',
  },
};

const DESIGN_TOKEN_SECTION_ALIASES: Record<string, string> = {
  borders: 'border',
  sizing: 'size',
  transforms: 'transform',
  transitions: 'transition',
};

const ARIA_PROPERTY_PATTERNS: Array<[RegExp, string]> = [
  [/^width(?: value| preset)?$/i, 'width'],
  [/^height(?: value| preset)?$/i, 'height'],
  [/^min(?:imum)? width(?: value| preset)?$/i, 'min-width'],
  [/^min(?:imum)? height(?: value| preset)?$/i, 'min-height'],
  [/^max(?:imum)? width(?: value| preset)?$/i, 'max-width'],
  [/^max(?:imum)? height(?: value| preset)?$/i, 'max-height'],
  [/^margem superior$/i, 'margin-top'],
  [/^margem direita$/i, 'margin-right'],
  [/^margem inferior$/i, 'margin-bottom'],
  [/^margem esquerda$/i, 'margin-left'],
  [/^padding superior$/i, 'padding-top'],
  [/^padding direito$/i, 'padding-right'],
  [/^padding inferior$/i, 'padding-bottom'],
  [/^padding esquerdo$/i, 'padding-left'],
  [/^espaçamento entre itens$/i, 'gap'],
  [/^espaçamento horizontal$/i, 'column-gap'],
  [/^espaçamento vertical$/i, 'row-gap'],
];

function sectionAndLabel(control: HTMLElement) {
  const section = control.closest<HTMLElement>(
    '[data-design-token-section], [data-slot="inspector-section"]',
  );
  if (!section) return { section: '', label: '', row: null as HTMLElement | null };
  const content = section.querySelector<HTMLElement>('[data-slot="inspector-section-content"]');
  const titleId = content?.getAttribute('aria-labelledby') || '';
  const sectionTitle = section.dataset.designTokenSection || (
    titleId
      ? section.querySelector<HTMLElement>(`#${CSS.escape(titleId)}`)
        ?.textContent || ''
      : section.querySelector<HTMLElement>('header')?.textContent || ''
  );
  const row = control.closest<HTMLElement>(
    '[class~="grid-cols-3"], [class~="grid-cols-[72px_minmax(0,1fr)]]',
  );
  const label = row?.querySelector<HTMLElement>(':scope > [data-slot="label"]')?.textContent
    || row?.firstElementChild?.textContent
    || '';
  return {
    section: sectionTitle.trim().toLowerCase(),
    label: label.trim().toLowerCase(),
    row,
  };
}

function inferredProperty(control: HTMLElement) {
  const explicit = control.closest<HTMLElement>('[data-design-token-property]')
    ?.dataset.designTokenProperty;
  if (explicit) return explicit;

  const aria = control.getAttribute('aria-label') || '';
  const ariaMatch = ARIA_PROPERTY_PATTERNS.find(([pattern]) => pattern.test(aria.trim()));
  if (ariaMatch) return ariaMatch[1];

  const context = sectionAndLabel(control);
  if (context.section === 'position' && context.label === 'offset' && context.row) {
    const fields = Array.from(context.row.querySelectorAll<HTMLElement>('input'));
    const index = fields.indexOf(control.closest('input') as HTMLElement);
    return ['left', 'top', 'right', 'bottom'][index] || null;
  }
  if (context.section === 'typography' && context.label === 'spacing' && context.row) {
    const fields = Array.from(context.row.querySelectorAll<HTMLElement>('input'));
    const index = fields.indexOf(control.closest('input') as HTMLElement);
    return ['letter-spacing', 'line-height'][index] || null;
  }
  const section = DESIGN_TOKEN_SECTION_ALIASES[context.section] || context.section;
  return SECTION_FIELD_PROPERTIES[section]?.[context.label] || null;
}

function connectorControl(target: EventTarget | null) {
  if (!(target instanceof HTMLElement) || target.closest('[data-design-token-ui]')) return null;
  const control = target.closest<HTMLElement>(DESIGN_TOKEN_INTERACTIVE_SELECTOR);
  if (!control || control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') return null;
  const property = inferredProperty(control);
  return property ? { control, property } : null;
}

const DESIGN_TOKEN_INTERACTIVE_SELECTOR = [
  'input:not([type="search"]):not([type="file"]):not([type="range"])',
  'textarea',
  'select',
  '[data-slot="input-group"]',
  '[data-slot="select-trigger"]',
  'button[data-variant="input"]',
  '[data-design-token-control]',
].join(',');

const DESIGN_TOKEN_CONTROL_SELECTOR = [
  '[data-design-token-property]',
  DESIGN_TOKEN_INTERACTIVE_SELECTOR,
].join(',');

const DESIGN_TOKEN_STROKE_TARGETS = [
  '[data-slot="input-group"]',
  '[data-design-token-control]',
  '[data-slot="select-trigger"]',
  '[data-slot="textarea"]',
  '[data-slot="input"]',
  'button[data-variant="input"]',
  'input:not([type="search"]):not([type="file"]):not([type="range"])',
];

function designTokenStrokeTarget(owner: HTMLElement, fallback: HTMLElement) {
  if (owner.matches('.kodety-radius-control__corner')) return owner;
  const radiusSurface = owner.closest<HTMLElement>('.kodety-radius-control__field');
  if (radiusSurface) return radiusSurface;
  const compoundSurface = owner.closest<HTMLElement>('[data-slot="input-group"]');
  if (compoundSurface) return compoundSurface;
  for (const selector of DESIGN_TOKEN_STROKE_TARGETS) {
    if (owner.matches(selector)) return owner;
    const nested = owner.querySelector<HTMLElement>(selector);
    if (nested) return nested;
  }
  return fallback;
}

interface ConnectorTarget {
  property: string;
  left: number;
  top: number;
}

function connectorTargetForControl(control: HTMLElement, property: string): ConnectorTarget {
  const visualControl = control.closest<HTMLElement>(
    '.kodety-radius-control__field, [data-slot="input-group"], [data-design-token-control]',
  ) || control;
  const controlRect = visualControl.getBoundingClientRect();
  // The visible 8px dot remains anchored over the field corner, while its
  // 32px hit area overlaps the field. There is therefore no dead strip when
  // the pointer travels from the input to the variable affordance.
  return {
    property,
    left: Math.max(0, Math.min(window.innerWidth - 32, controlRect.right - 16)),
    top: Math.max(0, Math.min(window.innerHeight - 32, controlRect.top - 16)),
  };
}

export function useHtmlDesignTokenConnector({
  document,
  styleValues,
  onDocumentChange,
  onBind,
  onEditToken,
}: {
  document: HtmlDesignTokenDocument;
  styleValues: Record<string, string>;
  onDocumentChange: (next: HtmlDesignTokenDocument) => void;
  onBind: (property: string, value: string) => void;
  onEditToken: (tokenId: string) => void;
}) {
  const normalized = normalizeHtmlDesignTokens(document);
  const [target, setTarget] = useState<ConnectorTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TokenDraft | null>(null);
  const [connectorRoot, setConnectorRoot] = useState<HTMLElement | null>(null);
  const leaveTimerRef = useRef<number | null>(null);

  const cancelLeave = useCallback(() => {
    if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = null;
  }, []);
  const scheduleLeave = useCallback(() => {
    if (open || leaveTimerRef.current !== null) return;
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null;
      setTarget(null);
    }, 180);
  }, [open]);
  const closeFloatingConnector = useCallback(() => {
    cancelLeave();
    setTarget(null);
    setOpen(false);
    setDraft(null);
  }, [cancelLeave]);

  const onPointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.target instanceof Element
      && event.target.closest('[data-design-token-ui]')
    ) {
      cancelLeave();
      return;
    }
    const match = connectorControl(event.target);
    if (!match) {
      scheduleLeave();
      return;
    }
    cancelLeave();
    const next = connectorTargetForControl(match.control, match.property);
    setTarget(current => (
      current
      && current.property === next.property
      && Math.abs(current.left - next.left) < 1
      && Math.abs(current.top - next.top) < 1
        ? current
        : next
    ));
  }, [cancelLeave, scheduleLeave]);

  const property = target?.property || '';
  const currentValue = property ? styleValues[property] || '' : '';
  const boundId = designTokenIdFromReference(currentValue);
  const boundToken = boundId
    ? normalized.tokens.find(token => token.id === boundId) || null
    : null;
  const compatible = property
    ? normalized.tokens.filter(token => isDesignTokenCompatible(token, property))
    : [];

  useEffect(() => {
    if (!connectorRoot) return;
    const clearConnectedState = () => {
      connectorRoot
        .querySelectorAll<HTMLElement>('[data-design-token-connected]')
        .forEach(control => {
          control.removeAttribute('data-design-token-connected');
          control.removeAttribute('data-design-token-locked');
        });
      connectorRoot
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-design-token-managed-readonly]')
        .forEach(control => {
          control.readOnly = false;
          control.removeAttribute('readonly');
          control.removeAttribute('aria-readonly');
          control.removeAttribute('data-design-token-managed-readonly');
        });
    };
    const syncConnectedStrokes = () => {
      clearConnectedState();
      connectorRoot
        .querySelectorAll<HTMLElement>(DESIGN_TOKEN_CONTROL_SELECTOR)
        .forEach(control => {
          const connectedProperty = inferredProperty(control);
          if (
            !connectedProperty
            || !designTokenIdFromReference(styleValues[connectedProperty] || '')
          ) return;
          const owner = control.closest<HTMLElement>('[data-design-token-property]') || control;
          const strokeTarget = designTokenStrokeTarget(owner, control);
          strokeTarget.setAttribute('data-design-token-connected', 'true');
          strokeTarget.setAttribute('data-design-token-locked', 'true');
          const editableControls = owner.matches('input, textarea')
            ? [owner]
            : Array.from(owner.querySelectorAll<HTMLElement>('input, textarea'));
          editableControls.forEach(editable => {
            if (
              !(editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement)
              || editable.readOnly
            ) return;
            editable.readOnly = true;
            editable.setAttribute('readonly', '');
            editable.setAttribute('aria-readonly', 'true');
            editable.setAttribute('data-design-token-managed-readonly', 'true');
          });
        });
    };
    const openConnectedActions = (event: Event) => {
      const match = connectorControl(event.target);
      if (!match || !designTokenIdFromReference(styleValues[match.property] || '')) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget(connectorTargetForControl(match.control, match.property));
      setDraft(null);
      setOpen(true);
    };
    const openConnectedFromKeyboard = (event: KeyboardEvent) => {
      const match = connectorControl(event.target);
      if (!match || !designTokenIdFromReference(styleValues[match.property] || '')) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Enter' || event.key === ' ') openConnectedActions(event);
    };
    const closeOnGeometryChange = (event: Event) => {
      if (
        event.target instanceof Element
        && event.target.closest('[data-design-token-ui]')
      ) return;
      closeFloatingConnector();
    };
    syncConnectedStrokes();
    const observer = new MutationObserver(syncConnectedStrokes);
    observer.observe(connectorRoot, { childList: true, subtree: true });
    connectorRoot.addEventListener('pointerdown', openConnectedActions, true);
    connectorRoot.addEventListener('click', openConnectedActions, true);
    connectorRoot.addEventListener('keydown', openConnectedFromKeyboard, true);
    globalThis.document.addEventListener('scroll', closeOnGeometryChange, true);
    window.addEventListener('resize', closeFloatingConnector);
    return () => {
      observer.disconnect();
      connectorRoot.removeEventListener('pointerdown', openConnectedActions, true);
      connectorRoot.removeEventListener('click', openConnectedActions, true);
      connectorRoot.removeEventListener('keydown', openConnectedFromKeyboard, true);
      globalThis.document.removeEventListener('scroll', closeOnGeometryChange, true);
      window.removeEventListener('resize', closeFloatingConnector);
      clearConnectedState();
    };
  }, [closeFloatingConnector, connectorRoot, styleValues]);

  const beginCreate = () => {
    if (!target) return;
    const type = designTokenTypeForProperty(target.property, currentValue);
    setDraft({
      name: '',
      type,
      collectionId: normalized.collections[0].id,
      value: boundToken?.value || currentValue || designTokenDefaultValue(type),
    });
  };
  const saveAndBind = () => {
    if (!draft?.name.trim() || !draft.value.trim() || !target) return;
    if (draft.type === 'duration' && !isDesignTokenDurationValue(draft.value)) return;
    const token: HtmlDesignToken = {
      id: createHtmlDesignTokenId(),
      name: draft.name.trim(),
      value: draft.value.trim(),
      type: draft.type,
      collectionId: draft.collectionId,
    };
    onDocumentChange({ ...normalized, tokens: [...normalized.tokens, token] });
    onBind(target.property, designTokenReference(token.id));
    setDraft(null);
    setOpen(false);
  };

  const overlayContent = target ? (
    <div
      data-design-token-ui
      className="pointer-events-auto fixed z-[580] size-8"
      style={{ left: target.left, top: target.top }}
      onPointerEnter={cancelLeave}
      onPointerLeave={scheduleLeave}
    >
      <button
        type="button"
        aria-label={`Conectar ${target.property} a uma variável`}
        title={`Conectar ${target.property} a uma variável`}
        onClick={() => {
          setOpen(value => !value);
          setDraft(null);
        }}
        className="group/token grid size-8 place-items-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]/80"
      >
        <span className={cn(
          'grid size-2 place-items-center rounded-full border border-[var(--kodety-accent-hover)]/90 bg-[var(--kodety-accent)] text-[var(--kodety-accent-foreground)] shadow-[0_2px_6px_rgba(0,0,0,.45)] transition-[width,height]',
          !boundToken && 'group-hover/token:size-3 group-focus-visible/token:size-3',
        )}>
          {boundToken ? (
            <span className="size-0.5 rounded-full bg-white" />
          ) : (
            <Plus className="size-2 opacity-0 transition-opacity group-hover/token:opacity-100 group-focus-visible/token:opacity-100" />
          )}
        </span>
      </button>
      {open && (
        <div
          className="absolute right-2 top-[26px] w-[252px] overflow-hidden rounded-[10px] border border-white/[.08] bg-[var(--kodety-panel)] text-[var(--kodety-text)] shadow-[var(--kodety-shadow-popover)]"
          onPointerDown={event => event.stopPropagation()}
        >
          <header className="flex h-9 items-center gap-2 border-b border-white/[0.07] px-2.5">
            <Variable className="size-3.5 text-[var(--kodety-accent-hover)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold">
                {boundToken ? boundToken.name : `Conectar · ${target.property}`}
              </p>
              <p className="truncate text-[8px] text-zinc-500">
                {boundToken
                  ? `Conectada a ${target.property}`
                  : tokenTypeLabel(designTokenTypeForProperty(target.property, currentValue))}
              </p>
            </div>
            <DesignTokenIconAction
              label="Fechar menu de variável"
              className="size-6 rounded-[6px]"
              onClick={() => {
                setOpen(false);
                setDraft(null);
              }}
            >
              <X className="size-3" />
            </DesignTokenIconAction>
          </header>
          {draft ? (
            <TokenEditor
              compact
              draft={draft}
              collections={normalized.collections}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={saveAndBind}
            />
          ) : (
            <>
              <div className="max-h-56 overflow-y-auto p-1.5">
                {compatible.map(token => (
                  <button
                    type="button"
                    key={token.id}
                    onClick={() => {
                      onBind(target.property, designTokenReference(token.id));
                      setOpen(false);
                    }}
                    className={cn(
                      'flex min-h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left hover:bg-white/[0.06]',
                      token.id === boundId && 'bg-[var(--kodety-accent-muted)]',
                    )}
                  >
                    {tokenSwatch(token)}
                    <span className="min-w-0 flex-1 truncate text-[10px]">{token.name}</span>
                    <span className="max-w-[74px] truncate font-mono text-[8px] text-zinc-500">{token.value}</span>
                    {token.id === boundId && <Check className="size-3 text-[var(--kodety-accent-hover)]" />}
                  </button>
                ))}
              </div>
              <footer className="grid gap-0.5 border-t border-white/[0.07] p-1.5">
                {boundToken && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onEditToken(boundToken.id);
                        setOpen(false);
                      }}
                      className="flex h-8 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-[6px] px-2 text-[10px] text-[var(--kodety-accent-hover)] hover:bg-[var(--kodety-accent-muted)]"
                    >
                      <Pencil className="size-3 shrink-0" />
                      <span className="min-w-0 truncate">Editar no painel de Variáveis</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onBind(target.property, boundToken.value);
                        setOpen(false);
                      }}
                      className="flex h-8 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-[6px] px-2 text-[10px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                    >
                      <X className="size-3 shrink-0" />
                      <span className="min-w-0 truncate">Desconectar e manter {boundToken.value}</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={beginCreate}
                  className="flex h-8 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-[6px] px-2 text-[10px] font-medium text-[var(--kodety-accent-hover)] hover:bg-[var(--kodety-accent-muted)]"
                >
                  <Plus className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">Criar nova variável</span>
                </button>
              </footer>
            </>
          )}
        </div>
      )}
    </div>
  ) : null;
  const overlay = overlayContent && typeof globalThis.document !== 'undefined'
    ? createPortal(overlayContent, globalThis.document.body)
    : null;

  return {
    rootRef: setConnectorRoot,
    connectorProps: {
      onPointerMoveCapture,
      onPointerLeave: scheduleLeave,
    },
    overlay,
  };
}
