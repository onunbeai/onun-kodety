/**
 * Editor de texto rico do construtor de email.
 *
 * Usa o mesmo TipTap do editor de sites, mas com um conjunto de extensões
 * deliberadamente curto: só o que sobrevive em cliente de email. Sem heading
 * (o bloco Título existe para isso), sem citação, sem código, sem imagem
 * embutida — cada um deles produziria markup que o Outlook renderiza errado.
 *
 * Não reusa `CanvasTextEditor` porque aquele depende de `Layer`, das stores do
 * builder e das variáveis de CMS.
 */

import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import History from '@tiptap/extension-history';
import { EmailHardBreak, EmailLink } from '@/lib/email-editor/tiptap';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MERGE_TAGS } from './EmailControls';

interface EmailRichTextProps {
  value: string;
  onChange: (html: string) => void;
}

export default function EmailRichText({ value, onChange }: EmailRichTextProps) {
  const editor = useEditor({
    // O editor monta fora do SSR; sem isto o React reclama de hidratação.
    immediatelyRender: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      Underline,
      Strike,
      EmailHardBreak,
      History,
      EmailLink,
    ],
    content: value,
    editorProps: {
      attributes: {
        class:
          'min-h-32 rounded-md border border-input bg-transparent px-3 py-2 text-xs leading-relaxed outline-none focus-visible:border-ring',
      },
    },
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
  });

  // Sincroniza quando o documento muda por fora (desfazer, trocar de bloco).
  React.useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === value) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  const applyLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('Endereço do link', previous ?? 'https://');
    if (href === null) return;

    if (href.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
        <MarkButton editor={editor} mark="bold" icon="bold" label="Negrito" />
        <MarkButton editor={editor} mark="italic" icon="italic" label="Itálico" />
        <MarkButton editor={editor} mark="underline" icon="underline" label="Sublinhado" />
        <MarkButton editor={editor} mark="strike" icon="strikethrough" label="Riscado" />

        <span className="mx-1 h-4 w-px bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={editor.isActive('link') ? 'secondary' : 'ghost'}
              size="icon-xs"
              aria-label="Link"
              onClick={applyLink}
            >
              <Icon name="link" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Link</p>
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Inserir variável">
                  <Icon name="hash" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Inserir variável</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-56">
            {MERGE_TAGS.map((group, index) => (
              <React.Fragment key={group.group}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{group.group}</DropdownMenuLabel>
                {group.items.map((item) => (
                  <DropdownMenuItem
                    key={item.tag}
                    onSelect={() => {
                      // Substitui a seleção — marcar um trecho e escolher a
                      // variável troca o trecho por ela.
                      editor.chain().focus().insertContent(`{{${item.tag}}}`).run();
                    }}
                  >
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

      <EditorContent editor={editor} />
    </div>
  );
}

function MarkButton({
  editor,
  mark,
  icon,
  label,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  mark: 'bold' | 'italic' | 'underline' | 'strike';
  icon: 'bold' | 'italic' | 'underline' | 'strikethrough';
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={editor.isActive(mark) ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={label}
          aria-pressed={editor.isActive(mark)}
          onClick={() => editor.chain().focus().toggleMark(mark).run()}
        >
          <Icon name={icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
