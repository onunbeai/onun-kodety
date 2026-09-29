/**
 * Entrada do construtor de email no runtime WordPress.
 *
 * Bundle separado do editor de sites: nenhuma linha do editor entra aqui, e
 * nada daqui pode quebrar o site publicado. O design system é compartilhado de
 * propósito — os controles precisam ser os mesmos para a experiência ser
 * consistente entre os dois construtores.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import KodetyEmailEditor from '../../app/(builder)/kodety/email-editor/components/KodetyEmailEditor';
import '../../app/globals.css';
import './email-editor.css';

document.documentElement.classList.add('dark');

const container = document.getElementById('kodety-email-root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <KodetyEmailEditor />
    </React.StrictMode>,
  );
}
