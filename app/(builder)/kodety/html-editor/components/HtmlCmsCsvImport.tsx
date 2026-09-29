'use client';

import { cmsFetch } from '@/lib/html-editor/cms-host';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from '@/components/ui/gravity-icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { builderOnboardingDialogProps, useBuilderOnboardingActive } from '@/lib/html-editor/onboarding-active';
import { KODETY_FIELD_TYPES, restEndpoint, slugifyFieldName } from './HtmlCmsManager';
import type { CmsType } from './HtmlCmsBindings';
import { HtmlSettingsFieldControl } from './HtmlProjectSettingsFieldControl';

interface CsvImportConfig {
  cmsCollectionsUrl?: string;
  cmsFieldsUrl?: string;
  cmsItemsUrl?: string;
  nonce?: string;
}

/** Native WordPress fields a CSV column can be mapped onto. */
const NATIVE_TARGETS: Array<{
  value: string;
  label: string;
  aliases: string[];
}> = [
  {
    value: 'title',
    label: 'Título (nativo)',
    aliases: ['title', 'titulo', 'título', 'name', 'nome'],
  },
  {
    value: 'excerpt',
    label: 'Resumo (nativo)',
    aliases: ['excerpt', 'resumo', 'summary', 'descricao', 'descrição', 'description'],
  },
  {
    value: 'content',
    label: 'Conteúdo (nativo)',
    aliases: ['content', 'conteudo', 'conteúdo', 'body', 'texto'],
  },
  {
    value: 'slug',
    label: 'Slug (nativo)',
    aliases: ['slug', 'permalink', 'url'],
  },
];

const MAP_IGNORE = '__ignore';
const MAP_NEW = '__new';
const MAX_CSV_BYTES = 15 * 1024 * 1024;
const MAX_IMPORT_ROWS = 1000;
const MAX_IMPORT_COLUMNS = 200;
const MAX_CELL_CHARACTERS = 200_000;

/** Names the PHP layer refuses as custom fields (they belong to the post itself). */
const RESERVED_FIELD_NAMES = new Set(['title', 'excerpt', 'content', 'featured_image', 'featured_image_alt', 'permalink', 'date', 'author', 'slug', 'status']);

interface ColumnPlan {
  header: string;
  /** Mapping target: MAP_IGNORE, MAP_NEW, a native key (title/…) or an existing field key (field:xxx). */
  action: string;
  /** For MAP_NEW columns: slug + type of the field to create. */
  newName: string;
  newType: string;
}

interface FieldDefinitionPayload {
  name: string;
  label: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  min?: number | '';
  max?: number | '';
  step?: number;
  unit?: string;
}

class CmsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly detail: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'CmsRequestError';
  }
}

function cmsRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isCmsRevisionToken(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

async function cmsRequestError(response: Response, fallbackMessage: string) {
  const payload = cmsRecord(await response.json().catch(() => null));
  const nested = cmsRecord(payload?.data);
  return new CmsRequestError(
    typeof payload?.message === 'string' ? payload.message : fallbackMessage,
    response.status,
    typeof payload?.code === 'string' ? payload.code : '',
    nested || payload,
  );
}

function isCmsRevisionError(error: unknown): error is CmsRequestError {
  return error instanceof CmsRequestError && (
    error.code === 'kodety_revision_conflict'
    || error.code === 'kodety_revision_required'
  );
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function decodeCsvBuffer(buffer: ArrayBuffer): {
  text: string;
  encoding: string;
} {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'UTF-16 LE',
    };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(Math.max(0, bytes.length - 2));
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1];
      swapped[index - 1] = bytes[index];
    }
    return {
      text: new TextDecoder('utf-16le').decode(swapped),
      encoding: 'UTF-16 BE',
    };
  }
  try {
    const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start)),
      encoding: 'UTF-8',
    };
  } catch {
    try {
      return {
        text: new TextDecoder('windows-1252').decode(bytes),
        encoding: 'Windows-1252',
      };
    } catch {
      return {
        text: new TextDecoder('iso-8859-1').decode(bytes),
        encoding: 'ISO-8859-1',
      };
    }
  }
}

/** Guess a delimiter from the first non-empty line (handles comma, semicolon and tab). */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n?|\n/).find(line => line.trim() !== '') || '';
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0) > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

/** Minimal RFC-4180-ish CSV parser with quoted-field and embedded-newline support. */
function parseCsv(input: string, delimiter: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (text[i + 1] === '\n') i++;
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('Há uma aspa sem fechamento no arquivo CSV.');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty rows (trailing newline, blank lines).
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

/** Infer a Kodety field type from a column's sample values. */
function inferFieldType(samples: string[]): string {
  const values = samples.map(value => value.trim()).filter(value => value !== '');
  if (!values.length) return 'text';
  const every = (test: (value: string) => boolean) => values.every(test);
  if (every(value => ['true', 'false', 'sim', 'nao', 'não', 'yes', 'no', '1', '0'].includes(value.toLowerCase()))) return 'boolean';
  if (every(value => value !== '' && !Number.isNaN(Number(value.replace(',', '.'))))) return 'number';
  if (every(value => /^https?:\/\/\S+$/i.test(value))) return 'url';
  if (every(value => /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/.test(value))) return 'date';
  if (values.some(value => value.length > 140)) return 'textarea';
  return 'text';
}

function convertValue(raw: string, type: string): unknown {
  const value = raw.trim();
  if (type === 'boolean') return ['true', 'sim', 'yes', '1'].includes(value.toLowerCase());
  if (type === 'number') {
    if (value === '') return '';
    const numeric = Number(value.replace(',', '.'));
    return Number.isNaN(numeric) ? '' : numeric;
  }
  return raw;
}

export function HtmlCmsCsvImport({
  open,
  onOpenChange,
  wp,
  types,
  initialType,
  schemaRevision,
  onRevisionConflict,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wp: CsvImportConfig;
  types: CmsType[];
  initialType?: string;
  schemaRevision: string;
  onRevisionConflict: (message?: string) => void | Promise<void>;
  onImported: (slug: string, revision: string) => void;
}) {
  const onboardingActive = useBuilderOnboardingActive();
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [parseError, setParseError] = useState('');
  const [parseNotice, setParseNotice] = useState('');
  const [detectedEncoding, setDetectedEncoding] = useState('');
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [targetSlug, setTargetSlug] = useState(initialType || '');
  const [newCollection, setNewCollection] = useState({
    name: '',
    singular: '',
    slug: '',
  });
  const [status, setStatus] = useState<'draft' | 'publish'>('draft');
  const [plans, setPlans] = useState<ColumnPlan[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileReaderRef = useRef<FileReader | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  // The modal mounts for one import session. Keep the schema token from that
  // exact read instead of silently rebasing prepared rows when the parent
  // receives an invalidation event from another tab.
  const schemaRevisionSnapshotRef = useRef(schemaRevision);

  const targetType = useMemo(() => types.find(type => type.slug === targetSlug), [types, targetSlug]);
  const canPublishTarget = mode === 'new' || targetType?.capabilities?.publish !== false;
  /** Existing custom fields (source kodety/acf) available as mapping targets. */
  const existingCustomFields = useMemo(() => (targetType?.fields || []).filter(field => field.key.startsWith('field:')), [targetType]);

  const resetState = useCallback(() => {
    fileReaderRef.current?.abort();
    fileReaderRef.current = null;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    setFileName('');
    setHeaders([]);
    setRows([]);
    setParseError('');
    setParseNotice('');
    setDetectedEncoding('');
    setPlans([]);
    setImporting(false);
    setProgress({ done: 0, total: 0, failed: 0 });
    setNewCollection({ name: '', singular: '', slug: '' });
  }, []);

  useEffect(() => {
    if (!open) resetState();
    else if (initialType) setTargetSlug(initialType);
  }, [open, initialType, resetState]);

  useEffect(() => {
    if (!canPublishTarget && status === 'publish') setStatus('draft');
  }, [canPublishTarget, status]);

  /** Build the initial column→field plan whenever the file or target changes. */
  const buildPlans = useCallback((cols: string[], sampleRows: string[][], forMode: 'new' | 'existing', type?: CmsType) => {
    const usedNative = new Set<string>();
    const usedNewNames = new Set(
      (forMode === 'existing' ? type?.fields || [] : []).filter(field => field.key.startsWith('field:')).map(field => field.key.replace(/^field:/, '')),
    );
    const uniqueNewName = (header: string, index: number) => {
      const initial = slugifyFieldName(header) || `campo_${index + 1}`;
      let candidate = initial;
      let suffix = 2;
      while (usedNewNames.has(candidate) || RESERVED_FIELD_NAMES.has(candidate)) {
        candidate = `${initial.slice(0, Math.max(1, 38 - String(suffix).length))}_${suffix}`;
        suffix += 1;
      }
      usedNewNames.add(candidate);
      return candidate;
    };
    return cols.map((header, index) => {
      const samples = sampleRows.map(row => row[index] ?? '');
      const suggestedType = inferFieldType(samples);
      const normalized = normalizeHeader(header);
      if (forMode === 'existing' && type) {
        // Try to match an existing custom field by key or label.
        const customMatch = (type.fields || []).find(
          field => field.key.startsWith('field:') && (normalizeHeader(field.label) === normalized || field.key === `field:${slugifyFieldName(header)}`),
        );
        if (customMatch)
          return {
            header,
            action: customMatch.key,
            newName: '',
            newType: suggestedType,
          };
        // Then a native field (only once each).
        const nativeMatch = NATIVE_TARGETS.find(target => !usedNative.has(target.value) && target.aliases.includes(normalized));
        if (nativeMatch) {
          usedNative.add(nativeMatch.value);
          return {
            header,
            action: nativeMatch.value,
            newName: '',
            newType: suggestedType,
          };
        }
        return {
          header,
          action: MAP_NEW,
          newName: uniqueNewName(header, index),
          newType: suggestedType,
        };
      }
      // New collection: reserved native names (title/excerpt/content/slug) map to
      // the native field so their data lands in the right place instead of an
      // orphaned custom field the PHP layer would reject as a reserved name.
      const nativeMatch = NATIVE_TARGETS.find(target => !usedNative.has(target.value) && target.aliases.includes(normalized));
      if (nativeMatch) {
        usedNative.add(nativeMatch.value);
        return {
          header,
          action: nativeMatch.value,
          newName: '',
          newType: suggestedType,
        };
      }
      // Fall back to the first column as the title when nothing else claimed it.
      if (!usedNative.has('title') && index === 0) {
        usedNative.add('title');
        return {
          header,
          action: 'title',
          newName: '',
          newType: suggestedType,
        };
      }
      return {
        header,
        action: MAP_NEW,
        newName: uniqueNewName(header, index),
        newType: suggestedType,
      };
    });
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      setParseError('');
      setParseNotice('');
      setDetectedEncoding('');
      if (file.size > MAX_CSV_BYTES) {
        setParseError(`O arquivo excede ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} MB. Divida-o em arquivos menores para importar com segurança.`);
        return;
      }
      fileReaderRef.current?.abort();
      const reader = new FileReader();
      fileReaderRef.current = reader;
      reader.onload = () => {
        if (fileReaderRef.current !== reader) return;
        fileReaderRef.current = null;
        try {
          if (!(reader.result instanceof ArrayBuffer)) throw new Error('Não foi possível decodificar o arquivo.');
          const decoded = decodeCsvBuffer(reader.result);
          const text = decoded.text;
          const delimiter = detectDelimiter(text);
          const table = parseCsv(text, delimiter);
          if (table.length < 2) {
            setParseError('O arquivo precisa ter um cabeçalho e ao menos uma linha de dados.');
            return;
          }
          const cols = table[0].map(cell => cell.trim());
          if (cols.some(cell => cell === '')) {
            setParseError('Todas as colunas do cabeçalho precisam de um nome.');
            return;
          }
          if (cols.length > MAX_IMPORT_COLUMNS) {
            setParseError(`O arquivo possui ${cols.length} colunas. O limite seguro é ${MAX_IMPORT_COLUMNS}.`);
            return;
          }
          if (table.length - 1 > MAX_IMPORT_ROWS) {
            setParseError(`O arquivo possui ${table.length - 1} linhas. Divida-o em lotes de até ${MAX_IMPORT_ROWS} itens.`);
            return;
          }
          const oversizedRow = table.slice(1).findIndex(row => row.length > cols.length);
          if (oversizedRow >= 0) {
            setParseError(`A linha ${oversizedRow + 2} possui mais valores do que o cabeçalho.`);
            return;
          }
          const oversizedCell = table.slice(1).findIndex(row => row.some(cell => cell.length > MAX_CELL_CHARACTERS));
          if (oversizedCell >= 0) {
            setParseError(`A linha ${oversizedCell + 2} contém um valor excessivamente grande.`);
            return;
          }
          const shortRows = table.slice(1).filter(row => row.length < cols.length).length;
          const duplicateHeaders = cols.filter(
            (header, index) => cols.findIndex(candidate => normalizeHeader(candidate) === normalizeHeader(header)) !== index,
          ).length;
          const dataRows = table.slice(1).map(row => Array.from({ length: cols.length }, (_, index) => row[index] ?? ''));
          setFileName(file.name);
          setHeaders(cols);
          setRows(dataRows);
          setDetectedEncoding(decoded.encoding);
          const notices = [
            shortRows
              ? `${shortRows} linha${shortRows === 1 ? '' : 's'} curta${shortRows === 1 ? '' : 's'} foi${shortRows === 1 ? '' : 'ram'} preenchida${shortRows === 1 ? '' : 's'} com valores vazios.`
              : '',
            duplicateHeaders ? 'Há títulos de coluna repetidos; confira os destinos antes de importar.' : '',
            decoded.encoding !== 'UTF-8' ? `Codificação ${decoded.encoding} detectada e convertida.` : '',
          ].filter(Boolean);
          setParseNotice(notices.join(' '));
          const suggested = slugifyFieldName(file.name.replace(/\.[^.]+$/, ''));
          setNewCollection({
            name: file.name.replace(/\.[^.]+$/, ''),
            singular: '',
            slug: suggested,
          });
          setPlans(buildPlans(cols, dataRows.slice(0, 20), mode, targetType));
        } catch (error) {
          setParseError(error instanceof Error ? error.message : 'Não foi possível ler o CSV.');
        }
      };
      reader.onerror = () => {
        if (fileReaderRef.current !== reader) return;
        fileReaderRef.current = null;
        setParseError('Não foi possível ler o arquivo.');
      };
      reader.readAsArrayBuffer(file);
    },
    [buildPlans, mode, targetType],
  );

  useEffect(
    () => () => {
      fileReaderRef.current?.abort();
      importAbortRef.current?.abort();
    },
    [],
  );

  // Recompute the plan when the user switches mode or target collection.
  useEffect(() => {
    if (!headers.length) return;
    setPlans(buildPlans(headers, rows.slice(0, 20), mode, targetType));
  }, [mode, targetSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePlan = (index: number, patch: Partial<ColumnPlan>) =>
    setPlans(current => current.map((plan, planIndex) => (planIndex === index ? { ...plan, ...patch } : plan)));

  const request = useCallback(
    async (url: string, body: unknown, signal?: AbortSignal) => {
      const response = await cmsFetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wp.nonce || '',
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) throw await cmsRequestError(response, 'A requisição falhou.');
      return response.json();
    },
    [wp.nonce],
  );

  const newFieldColumns = useMemo(() => plans.filter(plan => plan.action === MAP_NEW && plan.newName.trim() !== ''), [plans]);
  const mappedColumns = useMemo(() => plans.filter(plan => plan.action !== MAP_IGNORE), [plans]);
  const mappingIssues = useMemo(() => {
    const issues: string[] = [];
    if (mode === 'existing' && newFieldColumns.length) {
      issues.push('Para importar em uma collection existente, mapeie apenas campos já criados ou ignore a coluna.');
    }
    const usedTargets = new Set<string>();
    const usedNewNames = new Set<string>();
    const existingNames = new Set(existingCustomFields.map(field => field.key.replace(/^field:/, '')));
    plans.forEach(plan => {
      if (plan.action === MAP_IGNORE) return;
      if (plan.action === MAP_NEW) {
        const name = slugifyFieldName(plan.newName);
        if (!name) issues.push(`Defina o identificador do campo “${plan.header}”.`);
        else if (RESERVED_FIELD_NAMES.has(name)) issues.push(`“${name}” é um campo nativo; escolha-o em Destino ou use outro identificador.`);
        else if (existingNames.has(name)) issues.push(`O campo “${name}” já existe; selecione-o em Destino.`);
        else if (usedNewNames.has(name)) issues.push(`O campo “${name}” foi configurado mais de uma vez.`);
        else usedNewNames.add(name);
        return;
      }
      if (usedTargets.has(plan.action)) issues.push(`O destino “${plan.action}” recebe mais de uma coluna.`);
      else usedTargets.add(plan.action);
    });
    return Array.from(new Set(issues));
  }, [existingCustomFields, mode, newFieldColumns.length, plans]);

  const canImport = useMemo(() => {
    if (!headers.length || importing || !isCmsRevisionToken(schemaRevisionSnapshotRef.current)) return false;
    if (mappingIssues.length || mappedColumns.length === 0) return false;
    if (mode === 'new') return newCollection.name.trim() !== '';
    return targetSlug !== '';
  }, [headers.length, importing, mappingIssues.length, mappedColumns.length, mode, newCollection.name, targetSlug]);

  const runImport = useCallback(async () => {
    if (!wp.cmsItemsUrl) {
      toast.error('Endpoint de itens indisponível.');
      return;
    }
    if (mappingIssues.length) {
      toast.error(mappingIssues[0]);
      return;
    }
    const startingRevision = schemaRevisionSnapshotRef.current;
    if (!isCmsRevisionToken(startingRevision)) {
      await onRevisionConflict('A revisão atual do CMS não está disponível. Os dados foram recarregados antes da importação.');
      return;
    }
    const controller = new AbortController();
    importAbortRef.current?.abort();
    importAbortRef.current = controller;
    setImporting(true);
    setProgress({ done: 0, total: rows.length, failed: 0 });
    let done = 0;
    let createdCollectionSlug = '';
    let expectedRevision = startingRevision;
    try {
      let slug = targetSlug;

      // 1) Resolve the destination collection.
      if (mode === 'new') {
        if (!wp.cmsCollectionsUrl) throw new Error('Endpoint de collections indisponível.');
        const created = (await request(
          wp.cmsCollectionsUrl,
          {
            name: newCollection.name.trim(),
            singular: newCollection.singular.trim() || newCollection.name.trim(),
            slug: newCollection.slug.trim() || newCollection.name.trim(),
            expectedRevision,
          },
          controller.signal,
        )) as { slug?: string; revision?: string };
        if (!created.slug) throw new Error('A collection não retornou um identificador.');
        if (!isCmsRevisionToken(created.revision)) throw new Error('A collection foi criada sem confirmar a nova revisão.');
        slug = created.slug;
        createdCollectionSlug = created.slug;
        expectedRevision = created.revision;
      }
      if (!slug) throw new Error('Selecione uma collection de destino.');

      // 2) Create any missing custom fields (POST replaces the whole set, so
      //    merge with the collection's current definitions first).
      if (newFieldColumns.length && !wp.cmsFieldsUrl) {
        throw new Error('Endpoint de campos indisponível para criar o mapeamento do CSV.');
      }
      if (newFieldColumns.length && mode === 'existing') {
        throw new Error('Crie os campos na collection antes de importar o CSV.');
      }
      if (newFieldColumns.length && wp.cmsFieldsUrl) {
        const existing: FieldDefinitionPayload[] = [];
        const existingNames = new Set(existing.map(field => field.name));
        const additions: FieldDefinitionPayload[] = [];
        newFieldColumns.forEach(plan => {
          const name = slugifyFieldName(plan.newName) || plan.newName;
          // Reserved names route to the matching native field instead (step 3),
          // so never try to create them as custom fields.
          if (!name || existingNames.has(name) || RESERVED_FIELD_NAMES.has(name)) return;
          existingNames.add(name);
          additions.push({
            name,
            label: plan.header,
            type: plan.newType || 'text',
            description: '',
            required: false,
            default: plan.newType === 'boolean' ? false : '',
            min: '',
            max: '',
            step: 1,
            unit: '',
          });
        });
        if (additions.length) {
          const savedFields = (await request(
            restEndpoint(wp.cmsFieldsUrl, `/${encodeURIComponent(slug)}`),
            { fields: [...existing, ...additions], expectedRevision },
            controller.signal,
          )) as { revision?: string };
          if (!isCmsRevisionToken(savedFields.revision)) throw new Error('Os campos foram salvos sem confirmar a nova revisão.');
          expectedRevision = savedFields.revision;
        }
      }

      // 3) Resolve each mapped column to a final value key + type.
      const resolved = plans
        .map((plan, columnIndex) => {
          if (plan.action === MAP_IGNORE) return null;
          if (plan.action === MAP_NEW) {
            const name = slugifyFieldName(plan.newName) || plan.newName;
            // A "new field" whose slug is reserved becomes its native counterpart.
            if (RESERVED_FIELD_NAMES.has(name))
              return {
                columnIndex,
                valueKey: name,
                type: plan.newType || 'text',
              };
            return {
              columnIndex,
              valueKey: `field:${name}`,
              type: plan.newType || 'text',
            };
          }
          const existingType = existingCustomFields.find(field => field.key === plan.action)?.type;
          return {
            columnIndex,
            valueKey: plan.action,
            type: existingType || 'text',
          };
        })
        .filter((entry): entry is { columnIndex: number; valueKey: string; type: string } => entry !== null);

      // 4) Commit every row in one WordPress request. The backend suppresses
      //    item-saved events until all writes have durable readback and removes
      //    every earlier row if any later row fails.
      const items = rows.map(row => {
        const values: Record<string, unknown> = {
          status: canPublishTarget ? status : 'draft',
        };
        resolved.forEach(({ columnIndex, valueKey, type }) => {
          if (columnIndex < 0 || !valueKey || valueKey === 'field:') return;
          const cell = row[columnIndex] ?? '';
          if (cell.trim() === '') return;
          values[valueKey] = convertValue(cell, type);
        });
        return { values };
      });
      const result = (await request(
        restEndpoint(wp.cmsItemsUrl, `/${encodeURIComponent(slug)}/import`),
        { items, expectedRevision },
        controller.signal,
      )) as { imported?: number; revision?: string };
      if (!isCmsRevisionToken(result.revision)) throw new Error('O lote foi importado sem confirmar a revisão do CMS.');
      expectedRevision = result.revision;
      done = Number.isFinite(result.imported) ? Number(result.imported) : rows.length;
      setProgress({ done, total: rows.length, failed: 0 });
      toast.success(`${done} ${done === 1 ? 'item importado' : 'itens importados'} para o WordPress.`);
      onImported(slug, expectedRevision);
      onOpenChange(false);
    } catch (error) {
      let rollbackError = '';
      let rollbackRevisionConflict = false;
      const backendRollbackFailed = error instanceof CmsRequestError && error.detail?.rollbackFailed === true;
      if (isCmsRevisionError(error)) {
        await onRevisionConflict(
          createdCollectionSlug
            ? 'O CMS mudou em outra aba durante a importação. A collection recém-criada foi preservada para não apagar alterações concorrentes; revise-a antes de continuar.'
            : undefined,
        );
        return;
      }
      if (!backendRollbackFailed) {
        try {
          if (createdCollectionSlug && wp.cmsCollectionsUrl) {
            const cleanupResponse = await cmsFetch(
              restEndpoint(wp.cmsCollectionsUrl, `/${encodeURIComponent(createdCollectionSlug)}`),
              {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: {
                  'Content-Type': 'application/json',
                  'X-WP-Nonce': wp.nonce || '',
                },
                body: JSON.stringify({
                  confirmation: createdCollectionSlug,
                  deleteItems: false,
                  expectedRevision,
                }),
              },
            );
            if (!cleanupResponse.ok) throw await cmsRequestError(cleanupResponse, 'A collection nova não pôde ser removida.');
            const cleanup = (await cleanupResponse.json()) as { revision?: string };
            if (!isCmsRevisionToken(cleanup.revision)) {
              throw new Error('A reversão não confirmou a nova revisão do CMS.');
            }
            expectedRevision = cleanup.revision;
          }
        } catch (rollbackFailure) {
          rollbackRevisionConflict = isCmsRevisionError(rollbackFailure);
          rollbackError = rollbackFailure instanceof Error ? rollbackFailure.message : 'a reversão automática falhou';
        }
      }
      if (rollbackRevisionConflict) {
        await onRevisionConflict('O CMS mudou em outra aba durante a reversão. A collection nova foi preservada para não apagar alterações concorrentes; revise-a antes de continuar.');
        return;
      }
      const message = error instanceof Error ? error.message : 'Não foi possível concluir a importação.';
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        if (rollbackError) toast.error(`Importação cancelada, mas ${rollbackError}. Revise a collection antes de tentar novamente.`);
        else toast.warning('Importação cancelada antes do commit. As alterações preparatórias foram revertidas.');
      } else if (backendRollbackFailed) {
        toast.error(`${message} O WordPress não confirmou a reversão completa; revise os itens antes de tentar novamente.`);
      } else if (rollbackError) {
        toast.error(`${message} A reversão automática falhou: ${rollbackError}.`);
      } else {
        toast.error(`${message} As alterações preparatórias foram revertidas.`);
      }
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
      setImporting(false);
    }
  }, [
    canPublishTarget,
    existingCustomFields,
    mappingIssues,
    mode,
    newCollection,
    newFieldColumns,
    onImported,
    onOpenChange,
    onRevisionConflict,
    plans,
    request,
    rows,
    status,
    targetSlug,
    wp.cmsCollectionsUrl,
    wp.cmsFieldsUrl,
    wp.cmsItemsUrl,
    wp.nonce,
  ]);

  const optionsForColumn = useMemo(() => {
    const nativeOptions = NATIVE_TARGETS.map(target => ({
      value: target.value,
      label: target.label,
    }));
    const customOptions = existingCustomFields.map(field => ({
      value: field.key,
      label: `${field.label} · campo`,
    }));
    return { nativeOptions, customOptions };
  }, [existingCustomFields]);
  const progressPercent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Dialog
      open={open}
      modal={!onboardingActive}
      onOpenChange={nextOpen => {
        if (!nextOpen && importing) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        {...builderOnboardingDialogProps(onboardingActive)}
        data-kodety-cms-surface
        showCloseButton={!importing}
        className="flex max-h-[min(900px,92dvh)] w-[calc(100vw-24px)] max-w-4xl flex-col gap-0 overflow-hidden rounded-[10px] border-white/[.08] bg-[var(--kodety-panel)] p-0"
      >
        <div className="flex items-start gap-3 border-b border-[var(--kodety-divider-strong)] px-4 py-4 sm:px-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-white/[.045] text-white/35">
            <FileSpreadsheet className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle>Importar CSV</DialogTitle>
            <DialogDescription data-kodety-cms-description>
              Defina o destino e confira o mapeamento antes de criar qualquer item no WordPress.
            </DialogDescription>
          </div>
        </div>

        <div className="min-h-0 flex-1 divide-y divide-white/[0.07] overflow-y-auto px-4 sm:px-5">
          {/* File picker */}
          <section data-kodety-onboarding="cms-import-file" className="py-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div>
                <p className="text-xs font-medium">Arquivo</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">CSV com cabeçalho; vírgula, ponto e vírgula e tabulação são detectados.</p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) handleFile(file);
              }}
            />
            {!headers.length ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                data-kodety-cms-card
                className="flex min-h-14 w-full items-center gap-3 rounded-[9px] border border-dashed border-white/[0.12] bg-white/[.02] px-3 py-2.5 text-left outline-none transition-colors hover:border-[var(--kodety-focus)]/60 hover:bg-white/[0.035] focus-visible:border-[var(--kodety-focus)] focus-visible:ring-0 motion-reduce:transition-none"
              >
                <Upload className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium">Selecionar arquivo CSV</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">O arquivo só será lido; a importação começa após sua confirmação.</span>
                </span>
              </button>
            ) : (
              <div data-kodety-cms-card className="flex min-h-14 items-stretch overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.025]">
                <span className="grid w-11 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.06] text-white/30">
                  <FileSpreadsheet className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
                  <p className="truncate text-xs font-medium">{fileName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {headers.length} colunas · {rows.length} linhas
                    {detectedEncoding ? ` · ${detectedEncoding}` : ''}
                  </p>
                </div>
                <Button className="mr-2 self-center" size="xs" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  Trocar
                </Button>
              </div>
            )}
            {parseError && (
              <p role="alert" className="mt-2 text-[11px] text-red-300">
                {parseError}
              </p>
            )}
            {parseNotice && (
              <p role="status" className="mt-2 text-[10px] leading-relaxed text-amber-300">
                {parseNotice}
              </p>
            )}
          </section>

          {headers.length > 0 && (
            <>
              {/* Destination */}
              <section data-kodety-onboarding="cms-import-destination" className="space-y-4 py-4">
                <div>
                  <p className="text-xs font-medium">Destino</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Crie uma collection ou envie os registros para uma estrutura existente.</p>
                </div>
                <div
                  role="group"
                  aria-label="Destino da importação"
                  className="grid grid-cols-2 gap-1 rounded-[9px] border border-white/[.045] bg-white/[.02] p-1"
                >
                  {(['new', 'existing'] as const).map(value => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={mode === value}
                      onClick={() => setMode(value)}
                      className={`h-9 rounded-[7px] px-3 text-[11px] outline-none transition-colors motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)] ${mode === value ? 'bg-[var(--kodety-accent-muted)] font-medium text-[var(--kodety-accent-hover)]' : 'text-muted-foreground hover:bg-white/[.035] hover:text-foreground'}`}
                    >
                      {value === 'new' ? 'Nova collection' : 'Collection existente'}
                    </button>
                  ))}
                </div>

                {mode === 'new' ? (
                  <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
                    <label className="grid gap-1">
                      <Label variant="muted">Nome</Label>
                      <HtmlSettingsFieldControl label="Nome" kind="collection">
                        <Input
                          value={newCollection.name}
                          placeholder="Ex.: Produtos"
                          onChange={event =>
                            setNewCollection(current => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </HtmlSettingsFieldControl>
                    </label>
                    <label className="grid gap-1">
                      <Label variant="muted">Singular</Label>
                      <HtmlSettingsFieldControl label="Singular" kind="text">
                        <Input
                          value={newCollection.singular}
                          placeholder="Ex.: Produto"
                          onChange={event =>
                            setNewCollection(current => ({
                              ...current,
                              singular: event.target.value,
                            }))
                          }
                        />
                      </HtmlSettingsFieldControl>
                    </label>
                    <label className="grid gap-1">
                      <Label variant="muted">Slug da URL</Label>
                      <HtmlSettingsFieldControl label="Slug da URL" kind="link">
                        <Input
                          value={newCollection.slug}
                          placeholder="produtos"
                          onChange={event =>
                            setNewCollection(current => ({
                              ...current,
                              slug: event.target.value,
                            }))
                          }
                        />
                      </HtmlSettingsFieldControl>
                    </label>
                  </div>
                ) : (
                  <label className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
                    <Label variant="muted">Collection de destino</Label>
                    <HtmlSettingsFieldControl label="Collection de destino" kind="collection">
                      <Select value={targetSlug || undefined} onValueChange={setTargetSlug}>
                        <SelectTrigger>
                          <SelectValue placeholder="Escolher collection…" />
                        </SelectTrigger>
                        <SelectContent>
                          {types.map(type => (
                            <SelectItem key={type.slug} value={type.slug}>
                              {type.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </HtmlSettingsFieldControl>
                  </label>
                )}
              </section>

              {/* Column mapping */}
              <section data-kodety-onboarding="cms-import-mapping" className="space-y-3 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Mapeamento</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Revise onde cada coluna será salva.</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {newFieldColumns.length} novo
                    {newFieldColumns.length === 1 ? '' : 's'} campo
                    {newFieldColumns.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div data-kodety-cms-card className="overflow-hidden rounded-[9px] border border-white/[.065] bg-white/[.015]">
                  <div className="hidden grid-cols-[minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1.25fr)] gap-3 border-b bg-white/[0.02] px-3 py-2 text-[9px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
                    <span>Coluna do CSV</span>
                    <span>Destino</span>
                    <span>Configuração</span>
                  </div>
                  <div className="divide-y divide-white/[0.07]">
                    {plans.map((plan, index) => (
                      <div
                        key={`${plan.header}:${index}`}
                        className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1.25fr)] sm:items-center sm:gap-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium" title={plan.header}>
                            {plan.header}
                          </span>
                          <span className="block truncate text-[9px] text-muted-foreground" title={rows[0]?.[index] || ''}>
                            {rows[0]?.[index] || 'Sem valor na primeira linha'}
                          </span>
                        </span>
                        <div className="min-w-0">
                          <Select
                            value={plan.action}
                            onValueChange={value =>
                              updatePlan(index, {
                                action: value,
                                newName: value === MAP_NEW && !plan.newName ? slugifyFieldName(plan.header) : plan.newName,
                              })
                            }
                          >
                            <SelectTrigger className="h-8 w-full text-[11px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={MAP_NEW}>Criar novo campo</SelectItem>
                              <SelectItem value={MAP_IGNORE}>Ignorar coluna</SelectItem>
                              {optionsForColumn.nativeOptions.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                              {optionsForColumn.customOptions.length > 0 && <div className="my-1 border-t" />}
                              {optionsForColumn.customOptions.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {plan.action === MAP_NEW ? (
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_112px] gap-1.5">
                            <Input
                              value={plan.newName}
                              aria-label={`Identificador do campo ${plan.header}`}
                              placeholder="identificador_do_campo"
                              className="h-8 font-mono text-[10px]"
                              onChange={event =>
                                updatePlan(index, {
                                  newName: slugifyFieldName(event.target.value),
                                })
                              }
                            />
                            <Select value={plan.newType} onValueChange={value => updatePlan(index, { newType: value })}>
                              <SelectTrigger className="h-8 text-[11px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {KODETY_FIELD_TYPES.map(option => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            {plan.action === MAP_IGNORE ? 'Esta coluna não será importada.' : 'Usará o campo selecionado.'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {mappingIssues.length > 0 && (
                  <div role="alert" className="space-y-1 border-l-2 border-amber-400/70 pl-2.5 text-[10px] leading-relaxed text-amber-200">
                    {mappingIssues.slice(0, 3).map(issue => (
                      <p key={issue}>{issue}</p>
                    ))}
                    {mappingIssues.length > 3 && (
                      <p>
                        Mais {mappingIssues.length - 3} problema
                        {mappingIssues.length - 3 === 1 ? '' : 's'} de mapeamento.
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* Preview */}
              <section data-kodety-onboarding="cms-import-preview" className="space-y-3 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium">Prévia</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Primeiras linhas do arquivo, antes da conversão de tipos.</p>
                  </div>
                  {(headers.length > 6 || rows.length > 3) && <span className="shrink-0 text-[9px] text-muted-foreground">Amostra de 3 × 6</span>}
                </div>
                <div data-kodety-cms-card className="overflow-x-auto rounded-[9px] border border-white/[0.08] bg-white/[.015]">
                  <table className="min-w-full table-fixed text-left text-[10px]">
                    <thead className="bg-white/[0.025] text-muted-foreground">
                      <tr>
                        {headers.slice(0, 6).map((header, index) => (
                          <th key={`${header}:${index}`} className="min-w-32 border-r border-white/[0.07] px-2 py-1.5 font-medium last:border-r-0">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.07]">
                      {rows.slice(0, 3).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.slice(0, 6).map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className="max-w-52 truncate border-r border-white/[0.07] px-2 py-1.5 text-foreground/80 last:border-r-0"
                              title={cell}
                            >
                              {cell || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Status */}
              <section data-kodety-onboarding="cms-import-status" className="flex flex-wrap items-center gap-3 py-4">
                <label className="grid min-w-64 flex-1 gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
                  <Label variant="muted">Status dos itens</Label>
                  <HtmlSettingsFieldControl label="Status dos itens" kind="option">
                    <Select value={status} onValueChange={value => setStatus(value as 'draft' | 'publish')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Rascunho</SelectItem>
                        {canPublishTarget ? <SelectItem value="publish">Publicado</SelectItem> : null}
                      </SelectContent>
                    </Select>
                  </HtmlSettingsFieldControl>
                </label>
                <span className="text-[10px] text-muted-foreground">
                  {rows.length} item{rows.length === 1 ? '' : 's'} · {mappedColumns.length} coluna
                  {mappedColumns.length === 1 ? '' : 's'} mapeada
                  {mappedColumns.length === 1 ? '' : 's'}
                </span>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--kodety-divider-strong)] px-4 py-3 sm:px-5">
          {importing && (
            <div
              className="mb-2 h-1 overflow-hidden rounded-full bg-white/[0.07]"
              role="progressbar"
              aria-label="Progresso da importação"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <div className="h-full bg-[var(--kodety-accent)] transition-[width] motion-reduce:transition-none" style={{ width: `${progressPercent}%` }} />
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-[10px] text-muted-foreground" role="status" aria-live="polite">
              {importing ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" /> Importando {progress.done}/{progress.total}
                  {progress.failed ? ` · ${progress.failed} falhas` : ''}…
                </span>
              ) : progress.total && progress.done === progress.total ? (
                <span className="flex items-center gap-1.5 text-emerald-300">
                  <CheckCircle2 className="size-3" /> Concluído
                </span>
              ) : (
                <span>{headers.length ? 'Nenhuma alteração foi feita ainda.' : 'Selecione um arquivo para começar.'}</span>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={importing} onClick={() => onOpenChange(false)}>
                {importing ? 'Confirmando lote…' : 'Cancelar'}
              </Button>
              <Button size="sm" disabled={!canImport} onClick={() => void runImport()}>
                {importing ? <Loader2 className="animate-spin" /> : <Upload />} {mode === 'new' ? 'Criar e importar' : 'Importar itens'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
