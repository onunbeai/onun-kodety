'use client';

/**
 * Collection Field Selector
 *
 * Recursive component for selecting fields from a collection with nested reference support.
 * Reference fields appear as collapsible group headers, and their linked collection's fields
 * appear nested underneath. Multi-reference fields are excluded.
 */

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { selectVariants } from '@/components/ui/select';
import type { CollectionField, Collection, CollectionFieldType } from '@/types';
import { getFieldIcon, filterFieldGroupsByType, flattenFieldGroups, DISPLAYABLE_FIELD_TYPES } from '@/lib/collection-field-utils';

// Import and re-export from centralized location for backwards compatibility
import type { FieldSourceType, FieldGroup } from '@/lib/collection-field-utils';
export type { FieldSourceType, FieldGroup } from '@/lib/collection-field-utils';

/**
 * Derives the effective allowed types from pre-filtered field groups by collecting
 * all non-reference field types present. Used to constrain reference sub-options
 * to the same types that were used to filter the root level.
 */
function deriveAllowedTypesFromGroups(fieldGroups: FieldGroup[]): CollectionFieldType[] {
  const types = new Set<CollectionFieldType>();
  for (const group of fieldGroups) {
    for (const field of group.fields) {
      if (field.type !== 'reference' && field.type !== 'multi_reference') {
        types.add(field.type as CollectionFieldType);
      }
    }
  }
  return Array.from(types);
}

interface CollectionFieldListProps {
  /** Fields to display at the current level */
  fields: CollectionField[];
  /** All fields keyed by collection ID for resolving nested references */
  allFields: Record<string, CollectionField[]>;
  /** All collections for looking up collection names */
  collections: Collection[];
  /** Callback when a field is selected */
  onSelect: (fieldId: string, relationshipPath: string[], source?: FieldSourceType, layerId?: string) => void;
  /** Current relationship path (used internally for recursion) */
  relationshipPath?: string[];
  /** Source type for these fields (used internally for recursion) */
  source?: FieldSourceType;
  /** ID of the collection layer these fields belong to */
  layerId?: string;
  /** Depth level for indentation (used internally) */
  depth?: number;
  /** Allowed field types for filtering sub-options */
  allowedTypes?: CollectionFieldType[];
  /** Search query propagated through nested references */
  query?: string;
  /** Collections already traversed in the current reference path */
  visitedCollections?: Set<string>;
}

const MAX_REFERENCE_DEPTH = 6;

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function fieldMatchesQuery(
  field: CollectionField,
  query: string,
  allFields: Record<string, CollectionField[]>,
  allowedTypes: CollectionFieldType[] | undefined,
  visitedCollections: Set<string>,
): boolean {
  if (!query) return true;
  if (field.type === 'reference' && field.reference_collection_id && visitedCollections.has(field.reference_collection_id)) {
    return false;
  }
  const haystack = normalizeSearch(`${field.name} ${field.key || ''}`);
  if (haystack.includes(query)) return true;
  if (field.type !== 'reference' || !field.reference_collection_id) return false;

  const nextVisited = new Set(visitedCollections);
  nextVisited.add(field.reference_collection_id);
  return (allFields[field.reference_collection_id] || []).some(candidate => {
    if (candidate.type === 'multi_reference') return false;
    if (candidate.type !== 'reference' && allowedTypes?.length && !allowedTypes.includes(candidate.type)) return false;
    return fieldMatchesQuery(candidate, query, allFields, allowedTypes, nextVisited);
  });
}

/**
 * Single field item (selectable)
 */
function FieldItem({
  field,
  onSelect,
  depth = 0,
}: {
  field: CollectionField;
  onSelect: () => void;
  depth?: number;
}) {
  const iconName = getFieldIcon(field.type);

  return (
    <DropdownMenuItem
      onClick={onSelect}
      className="h-7 gap-2 rounded-[5px] px-2 text-[11px]"
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      <Icon name={iconName} className="size-3 text-muted-foreground shrink-0" />
      <span className="truncate">{field.name}</span>
    </DropdownMenuItem>
  );
}

/**
 * Reference field group (submenu)
 */
function ReferenceFieldGroup({
  field,
  allFields,
  collections,
  onSelect,
  relationshipPath,
  source,
  layerId,
  depth = 0,
  allowedTypes,
  query = '',
  visitedCollections = new Set<string>(),
}: {
  field: CollectionField;
  allFields: Record<string, CollectionField[]>;
  collections: Collection[];
  onSelect: (fieldId: string, relationshipPath: string[], source?: FieldSourceType, layerId?: string) => void;
  relationshipPath: string[];
  source?: FieldSourceType;
  layerId?: string;
  depth?: number;
  allowedTypes?: CollectionFieldType[];
  query?: string;
  visitedCollections?: Set<string>;
}) {
  const referencedCollectionId = field.reference_collection_id;
  if (!referencedCollectionId || depth >= MAX_REFERENCE_DEPTH || visitedCollections.has(referencedCollectionId)) {
    return null;
  }
  const referencedFields = referencedCollectionId ? allFields[referencedCollectionId] || [] : [];
  const referencedCollection = collections.find((c) => c.id === referencedCollectionId);
  const normalizedQuery = normalizeSearch(query);
  const queryMatchesReference = normalizeSearch(`${field.name} ${field.key || ''}`).includes(normalizedQuery);
  const childQuery = queryMatchesReference ? '' : normalizedQuery;
  const nextVisited = new Set(visitedCollections);
  nextVisited.add(referencedCollectionId);

  // Filter sub-fields: exclude multi_reference, apply allowedTypes if provided (keeping reference for deep nesting)
  const displayableFields = referencedFields.filter((f) => {
    if (f.type === 'multi_reference') return false;
    if (allowedTypes && allowedTypes.length > 0 && f.type !== 'reference') {
      if (!allowedTypes.includes(f.type)) return false;
    }
    return fieldMatchesQuery(f, childQuery, allFields, allowedTypes, nextVisited);
  });
  if (displayableFields.length === 0) return null;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        className="h-7 gap-2 rounded-[5px] px-2 text-[11px]"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <Icon name="database" className="size-3 text-muted-foreground shrink-0" />
        <span className="truncate">{field.name}</span>
      </DropdownMenuSubTrigger>

      {(
        <DropdownMenuSubContent className="max-h-[min(420px,70vh)] min-w-48 overflow-y-auto p-1">
          {referencedCollection && (
            <DropdownMenuLabel className="flex h-7 items-center justify-between gap-2 px-2 text-[10px] font-medium text-foreground/80">
              <span className="truncate">{referencedCollection.name}</span>
              <DropdownMenuShortcut className="shrink-0 text-[9px] tracking-normal">Referência</DropdownMenuShortcut>
            </DropdownMenuLabel>
          )}
          <CollectionFieldSelectorInner
            fields={displayableFields}
            allFields={allFields}
            collections={collections}
            onSelect={onSelect}
            relationshipPath={[...relationshipPath, field.id]}
            source={source}
            layerId={layerId}
            depth={depth + 1}
            allowedTypes={allowedTypes}
            query={childQuery}
            visitedCollections={nextVisited}
          />
        </DropdownMenuSubContent>
      )}
    </DropdownMenuSub>
  );
}

/**
 * Inner recursive component
 */
function CollectionFieldSelectorInner({
  fields,
  allFields,
  collections,
  onSelect,
  relationshipPath = [],
  source,
  layerId,
  depth = 0,
  allowedTypes,
  query = '',
  visitedCollections = new Set<string>(),
}: CollectionFieldListProps) {
  const normalizedQuery = normalizeSearch(query);
  // Filter out multi-reference fields
  const displayableFields = fields.filter((field) => {
    if (field.type === 'multi_reference') return false;
    return fieldMatchesQuery(field, normalizedQuery, allFields, allowedTypes, visitedCollections);
  });

  return (
    <div className="flex flex-col">
      {displayableFields.map((field) => {
        // Reference fields become collapsible groups
        if (field.type === 'reference' && field.reference_collection_id) {
          return (
            <ReferenceFieldGroup
              key={field.id}
              field={field}
              allFields={allFields}
              collections={collections}
              onSelect={onSelect}
              relationshipPath={relationshipPath}
              source={source}
              layerId={layerId}
              depth={depth}
              allowedTypes={allowedTypes}
              query={normalizedQuery}
              visitedCollections={visitedCollections}
            />
          );
        }

        // Regular fields are selectable
        return (
          <FieldItem
            key={field.id}
            field={field}
            depth={depth}
            onSelect={() => {
              if (relationshipPath.length > 0) {
                // Nested field: include relationship path
                onSelect(relationshipPath[0], [...relationshipPath.slice(1), field.id], source, layerId);
              } else {
                // Root field: no relationship path
                onSelect(field.id, [], source, layerId);
              }
            }}
          />
        );
      })}
    </div>
  );
}

interface CollectionFieldSelectorProps {
  /** Field groups to display, each with their own source and label */
  fieldGroups: FieldGroup[];
  /** All fields keyed by collection ID for resolving nested references */
  allFields: Record<string, CollectionField[]>;
  /** All collections for looking up collection names */
  collections: Collection[];
  /** Callback when a field is selected */
  onSelect: (fieldId: string, relationshipPath: string[], source?: FieldSourceType, layerId?: string) => void;
  /** Allowed field types for filtering sub-options in reference fields */
  allowedTypes?: CollectionFieldType[];
  /** Optional search query, including nested reference fields */
  query?: string;
}

/**
 * Collection Field Selector
 *
 * Renders multiple field groups (e.g. collection layer + page collection) with labels.
 * Reference fields use submenus for their nested fields.
 */
export function CollectionFieldSelector({
  fieldGroups,
  allFields,
  collections,
  onSelect,
  allowedTypes,
  query = '',
}: CollectionFieldSelectorProps) {
  // Derive effective types from the incoming groups when not explicitly provided.
  // Call sites already pre-filter groups to specific types, so the non-reference
  // types present in the groups reflect the intended constraint.
  const effectiveAllowedTypes = allowedTypes ?? deriveAllowedTypesFromGroups(fieldGroups);

  // Single filter pass: keeps only matching fields and excludes reference fields
  // whose referenced collections have no matching sub-fields (via allFields check).
  const nonEmptyGroups = filterFieldGroupsByType(
    fieldGroups,
    effectiveAllowedTypes.length > 0 ? effectiveAllowedTypes : DISPLAYABLE_FIELD_TYPES,
    { allFields },
  );

  const visibleGroups = nonEmptyGroups.map(group => {
    const normalizedQuery = normalizeSearch(query);
    const groupMatchesQuery = normalizeSearch(`${group.label || ''} ${group.detail || ''}`).includes(normalizedQuery);
    const groupQuery = groupMatchesQuery ? '' : normalizedQuery;
    return {
      ...group,
      fields: group.fields.filter(field => (
        field.type !== 'multi_reference'
        && fieldMatchesQuery(field, groupQuery, allFields, effectiveAllowedTypes, new Set<string>())
      )),
      query: groupQuery,
    };
  }).filter(group => group.fields.length > 0);

  if (visibleGroups.length === 0) {
    return (
      <div role="status" className="px-3 py-4 text-center text-[10px] text-muted-foreground">
        {query ? 'Nenhum campo corresponde à busca.' : 'Nenhum campo disponível.'}
      </div>
    );
  }

  return (
    <div>
      {visibleGroups.map((group, index) => {
        const groupKey = `${group.source || 'default'}-${group.layerId || index}`;
        return (
          <div key={groupKey}>
            {/* Add separator between groups (not before first) */}
            {index > 0 && <DropdownMenuSeparator />}
            {(group.label || group.detail) && (
              <DropdownMenuLabel className="flex h-7 items-center justify-between gap-2 px-2 text-[10px] font-medium text-foreground/80">
                <span className="truncate">{group.label}</span>
                {group.detail && (
                  <DropdownMenuShortcut className="max-w-28 truncate text-[9px] tracking-normal">
                    {group.detail}
                  </DropdownMenuShortcut>
                )}
              </DropdownMenuLabel>
            )}
            <CollectionFieldSelectorInner
              fields={group.fields}
              allFields={allFields}
              collections={collections}
              onSelect={onSelect}
              relationshipPath={[]}
              source={group.source}
              layerId={group.layerId}
              depth={0}
              allowedTypes={effectiveAllowedTypes}
              query={group.query}
              visitedCollections={new Set<string>()}
            />
          </div>
        );
      })}
    </div>
  );
}

export default CollectionFieldSelector;

interface FieldSelectDropdownProps {
  /** Field groups with labels and sources */
  fieldGroups: FieldGroup[];
  /** All fields keyed by collection ID for resolving nested references */
  allFields: Record<string, CollectionField[]>;
  /** All collections for looking up collection names */
  collections: Collection[];
  /** Currently selected field ID */
  value?: string | null;
  /** Callback when a field is selected - receives encoded value with source/layerId */
  onSelect: (fieldId: string, relationshipPath: string[], source?: FieldSourceType, layerId?: string) => void;
  /** Placeholder text when no field is selected */
  placeholder?: string;
  /** Whether the dropdown is disabled */
  disabled?: boolean;
  /** Additional class names for the trigger button */
  className?: string;
  /** Field types to filter to (defaults to all displayable types) */
  allowedFieldTypes?: CollectionFieldType[];
}

/**
 * Field Select Dropdown
 *
 * A complete dropdown component for selecting CMS fields with submenu support.
 * Use this as a drop-in replacement for Select-based field selectors.
 */
export function FieldSelectDropdown({
  fieldGroups,
  allFields,
  collections,
  value,
  onSelect,
  placeholder = 'Select...',
  disabled = false,
  className,
  allowedFieldTypes,
}: FieldSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Filter field groups by allowed types
  const filteredGroups = useMemo(() => {
    const types = allowedFieldTypes && allowedFieldTypes.length > 0 ? allowedFieldTypes : DISPLAYABLE_FIELD_TYPES;
    return filterFieldGroupsByType(fieldGroups, types, { allFields });
  }, [fieldGroups, allowedFieldTypes, allFields]);

  // Find the selected field for display
  const selectedField = useMemo(() => {
    if (!value) return null;
    const allFlatFields = flattenFieldGroups(filteredGroups);
    return allFlatFields.find(f => f.id === value) || null;
  }, [value, filteredGroups]);

  const handleSelect = (fieldId: string, relationshipPath: string[], source?: FieldSourceType, layerId?: string) => {
    onSelect(fieldId, relationshipPath, source, layerId);
    setIsOpen(false);
  };

  const hasFields = filteredGroups.length > 0;

  return (
    <DropdownMenu open={isOpen} onOpenChange={nextOpen => {
      setIsOpen(nextOpen);
      if (!nextOpen) setQuery('');
    }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            selectVariants({ variant: 'default', size: 'sm' }),
            'w-full cursor-pointer',
            className
          )}
          disabled={disabled || !hasFields}
        >
          <span className="flex items-center gap-2 truncate">
            {selectedField ? (
              <>
                <Icon name={getFieldIcon(selectedField.type)} className="size-3 text-muted-foreground shrink-0" />
                <span className="truncate">{selectedField.name}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{hasFields ? placeholder : 'No fields available'}</span>
            )}
          </span>
          <Icon name="chevronDown" className="size-2.5 opacity-50 shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="max-h-[min(440px,70vh)] w-64 max-w-[calc(100vw-24px)] overflow-y-auto p-1"
        align="end"
      >
        <DropdownMenuLabel className="sticky top-0 z-10 bg-popover p-1">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => event.stopPropagation()}
              placeholder="Buscar campos…"
              aria-label="Buscar campos da collection"
              className="h-7 border-white/[0.08] bg-[#2b2b2b] pl-7 text-[11px]"
              autoFocus
            />
          </div>
        </DropdownMenuLabel>
        <CollectionFieldSelector
          fieldGroups={filteredGroups}
          allFields={allFields}
          collections={collections}
          onSelect={handleSelect}
          allowedTypes={allowedFieldTypes}
          query={query}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
