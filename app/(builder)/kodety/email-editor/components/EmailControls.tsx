/**
 * Controles do inspetor do construtor de email.
 *
 * Construídos sobre os mesmos primitivos de `components/ui` que o editor de
 * sites usa, para a experiência ser idêntica. Não reusam
 * Os controles estruturais permanecem independentes do modelo `Layer`; cores
 * reutilizam apenas o `ColorPicker` visual compartilhado para que nenhum
 * editor caia no seletor nativo do navegador.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon, { type IconProps } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import ColorPicker from '@/app/(builder)/kodety/components/ColorPicker';

export function ControlRow({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-8 items-center gap-2', className)}>
      {label !== undefined && (
        <Label className="w-24 shrink-0 text-muted-foreground">{label}</Label>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * Comprimento CSS com unidade preservada. Mantém o texto digitado enquanto o
 * campo está focado, para não reformatar `1` em `1px` no meio da digitação.
 */
export function LengthField({
  value,
  placeholder,
  icon,
  onChange,
}: {
  value: string;
  placeholder?: string;
  icon?: IconProps['name'];
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    // Número puro ganha px: é o que o autor quis dizer em 99% dos casos.
    const normalized = /^-?\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
    setDraft(normalized);
    if (normalized !== value) onChange(normalized);
  };

  const input = (
    <InputGroupInput
      value={draft}
      placeholder={placeholder}
      onFocus={() => setEditing(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        setEditing(false);
        commit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );

  if (!icon) {
    return <InputGroup className="h-8">{input}</InputGroup>;
  }

  return (
    <InputGroup className="h-8">
      <InputGroupAddon>
        <Icon name={icon} className="size-3.5 text-muted-foreground" />
      </InputGroupAddon>
      {input}
    </InputGroup>
  );
}

/**
 * Cor com amostra clicável e campo hexadecimal.
 *
 * Sem gradiente, variável de cor ou binding de CMS: nenhum dos três sobrevive
 * num cliente de email, então oferecê-los seria uma promessa falsa.
 */
export function ColorField({
  value,
  placeholder = 'herdado',
  onChange,
  onClear,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onClear?: () => void;
}) {
  return (
    <div className="min-w-0 flex-1 *:w-full">
      <ColorPicker
        value={value}
        placeholder={placeholder}
        solidOnly
        onChange={onChange}
        onImmediateChange={onChange}
        onClear={onClear}
      />
    </div>
  );
}

/**
 * Variáveis resolvidas em PHP no momento do envio. A lista precisa espelhar
 * `Kodety_Email_Renderer::tokens()` — uma tag que não exista lá chega vazia na
 * caixa do destinatário.
 */
export const MERGE_TAGS: { group: string; items: { tag: string; label: string }[] }[] = [
  {
    group: 'Contato',
    items: [
      { tag: 'contact.first_name', label: 'Primeiro nome' },
      { tag: 'contact.name', label: 'Nome completo' },
      { tag: 'contact.email', label: 'Email' },
    ],
  },
  {
    group: 'Site',
    items: [
      { tag: 'site.name', label: 'Nome do site' },
      { tag: 'site.url', label: 'Endereço do site' },
    ],
  },
  {
    group: 'Obrigatórias',
    items: [
      { tag: 'unsubscribe_url', label: 'Link de descadastro' },
      { tag: 'view_in_browser_url', label: 'Ver no navegador' },
    ],
  },
];

/**
 * Campo de texto com inserção de variável em um clique.
 *
 * A tag entra no ponto do cursor e substitui a seleção, então marcar um trecho
 * e escolher a variável troca o trecho por ela — que é o gesto natural para
 * "este pedaço vira o nome da pessoa".
 */
export function MergeTagField({
  value,
  multiline = false,
  className,
  placeholder,
  onChange,
}: {
  value: string;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const ref = React.useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  // A seleção some quando o foco vai para o menu, então é capturada antes.
  const selection = React.useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  const remember = () => {
    const element = ref.current;
    if (!element) return;
    selection.current = {
      start: element.selectionStart ?? value.length,
      end: element.selectionEnd ?? value.length,
    };
  };

  const insert = (tag: string) => {
    const token = `{{${tag}}}`;
    const { start, end } = selection.current;
    const safeStart = Math.min(start, value.length);
    const safeEnd = Math.min(Math.max(end, safeStart), value.length);

    onChange(value.slice(0, safeStart) + token + value.slice(safeEnd));

    // Devolve o cursor logo depois da tag para continuar digitando.
    window.requestAnimationFrame(() => {
      const element = ref.current;
      if (!element) return;
      const caret = safeStart + token.length;
      element.focus();
      element.setSelectionRange(caret, caret);
      selection.current = { start: caret, end: caret };
    });
  };

  const shared = {
    value,
    placeholder,
    onSelect: remember,
    onKeyUp: remember,
    onClick: remember,
    onBlur: remember,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => onChange(event.target.value),
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {multiline ? (
        <Textarea ref={ref as React.Ref<HTMLTextAreaElement>} className={className} {...shared} />
      ) : (
        <Input ref={ref as React.Ref<HTMLInputElement>} className={className} {...shared} />
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {selection.current.end > selection.current.start
            ? 'A variável substitui o trecho selecionado.'
            : 'A variável entra no ponto do cursor.'}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" onMouseDown={remember}>
              <Icon name="hash" />
              Variável
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {MERGE_TAGS.map((group, index) => (
              <React.Fragment key={group.group}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{group.group}</DropdownMenuLabel>
                {group.items.map((item) => (
                  <DropdownMenuItem key={item.tag} onSelect={() => insert(item.tag)}>
                    <span className="flex min-w-0 flex-col">
                      <span>{item.label}</span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {`{{${item.tag}}}`}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * Área de upload de imagem.
 *
 * Um `<input type="file">` cru some no painel e não diz o que aceita. Uma
 * área grande é alvo de clique e de arraste ao mesmo tempo, e ainda cabe a
 * miniatura do que já foi escolhido — sem ela o autor não tem como conferir
 * a imagem sem ir até o canvas.
 */
export function UploadBox({
  value,
  uploading,
  onUpload,
}: {
  value: string;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const accept = (files: FileList | null) => {
    const file = files?.[0];
    // Arrastar qualquer arquivo é possível; só imagem faz sentido aqui.
    if (file && file.type.startsWith('image/')) onUpload(file);
  };

  return (
    <div
      className={cn(
        'relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed transition-colors',
        'aspect-[1.25/1] cursor-pointer bg-white/[0.03]',
        dragging ? 'border-primary bg-primary/10' : 'border-border hover:bg-white/[0.06]',
        uploading && 'pointer-events-none opacity-60',
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        accept(event.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
      aria-label="Enviar imagem"
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      {value && !uploading && (
        <img
          src={value}
          alt=""
          className="absolute inset-0 size-full object-contain p-2"
          // A miniatura é referência, não conteúdo: leitor de tela ignora.
          aria-hidden="true"
        />
      )}

      {(!value || dragging || uploading) && (
        <>
          <Icon name="upload" className="size-5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-muted-foreground">
            {uploading ? 'Enviando…' : dragging ? 'Solte aqui' : 'Upload'}
          </span>
        </>
      )}

      {value && !uploading && !dragging && (
        <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-[10px] font-medium text-white/80">
          Trocar imagem
        </span>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          accept(event.target.files);
          // Permite reenviar o mesmo arquivo depois de removê-lo.
          event.target.value = '';
        }}
      />
    </div>
  );
}

export function SelectField<T extends string>({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: T;
  options: { label: string; value: T }[];
  placeholder?: string;
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value || undefined} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger className="h-8 min-w-0 flex-1">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function IconToggleGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; icon: IconProps['name']; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
      {options.map((option) => (
        <Tooltip key={option.value}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={value === option.value ? 'secondary' : 'ghost'}
              size="icon-xs"
              aria-label={option.label}
              aria-pressed={value === option.value}
              onClick={() => onChange(option.value)}
            >
              <Icon name={option.icon} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{option.label}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
