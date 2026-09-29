/**
 * Extensões TipTap mínimas para o construtor de email.
 *
 * O projeto não tem `@tiptap/extension-link` nem `extension-hard-break`
 * instalados, e o `RichTextLink` do editor de sites carrega o modelo de link
 * do builder (asset, page, campo de CMS) — nada disso existe em email. São
 * poucas linhas escrever exatamente o necessário, sem dependência nova.
 */

import { Mark, Node, mergeAttributes } from '@tiptap/core';

export interface EmailLinkOptions {
  HTMLAttributes: Record<string, string>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    emailLink: {
      setLink: (attributes: { href: string }) => ReturnType;
      unsetLink: () => ReturnType;
    };
  }
}

/**
 * Link simples. Não valida protocolo de propósito: `{{unsubscribe_url}}` é um
 * destino legítimo aqui e seria recusado por qualquer validação de URL.
 */
export const EmailLink = Mark.create<EmailLinkOptions>({
  name: 'link',
  priority: 1000,
  keepOnSplit: false,
  inclusive: false,

  addOptions() {
    return { HTMLAttributes: { target: '_blank', rel: 'noopener' } };
  },

  addAttributes() {
    return {
      href: { default: null },
      target: { default: '_blank' },
      rel: { default: 'noopener' },
    };
  },

  parseHTML() {
    return [{ tag: 'a[href]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setLink:
        (attributes) =>
        ({ chain }) =>
          chain().setMark(this.name, attributes).run(),
      unsetLink:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name, { extendEmptyMarkRange: true }).run(),
    };
  },
});

/** Quebra de linha com Shift+Enter, que vira `<br>` no email. */
export const EmailHardBreak = Node.create({
  name: 'hardBreak',
  group: 'inline',
  inline: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'br' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['br', mergeAttributes(HTMLAttributes)];
  },

  addKeyboardShortcuts() {
    return {
      'Shift-Enter': () => this.editor.commands.insertContent({ type: this.name }),
    };
  },
});
