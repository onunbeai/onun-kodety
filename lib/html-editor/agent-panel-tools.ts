'use client';

export type AgentPanelActionKind = 'click' | 'setValue' | 'toggle' | 'focus';

export interface AgentPanelAction {
  expectedRevision: string;
  controlId: string;
  action: AgentPanelActionKind;
  value?: string;
  checked?: boolean;
  confirmDestructive?: boolean;
}

interface AgentPanelControl {
  id: string;
  kind: string;
  label: string;
  value?: string;
  checked?: boolean;
  disabled: boolean;
  expanded?: boolean;
  selected?: boolean;
  href?: string;
  scope: 'workspace' | 'dialog' | 'menu';
}

const controlIds = new WeakMap<HTMLElement, string>();
const controlsById = new Map<string, HTMLElement>();
let nextControlId = 1;

function panelSurface(value: string) {
  return value.trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9_-]+/g, '-');
}

function visible(element: HTMLElement) {
  if (element.hidden || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function controlId(element: HTMLElement) {
  const current = controlIds.get(element);
  if (current) return current;
  const id = `panel-${nextControlId++}`;
  controlIds.set(element, id);
  controlsById.set(id, element);
  return id;
}

function compactText(value: unknown, maximum = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function referencedText(element: HTMLElement, attribute: string) {
  const ids = compactText(element.getAttribute(attribute), 500).split(/\s+/).filter(Boolean);
  return ids.map(id => compactText(document.getElementById(id)?.textContent)).filter(Boolean).join(' ');
}

function accessibleLabel(element: HTMLElement) {
  const formControl = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const labels = 'labels' in formControl && formControl.labels
    ? Array.from(formControl.labels).map(label => compactText(label.textContent)).filter(Boolean).join(' ')
    : '';
  return compactText(
    element.getAttribute('aria-label')
    || referencedText(element, 'aria-labelledby')
    || labels
    || element.getAttribute('title')
    || element.getAttribute('placeholder')
    || element.textContent
    || element.getAttribute('name')
    || element.id,
  );
}

function controlKind(element: HTMLElement) {
  const role = compactText(element.getAttribute('role'), 60);
  if (role) return role;
  if (element instanceof HTMLInputElement) return element.type || 'input';
  if (element instanceof HTMLTextAreaElement) return 'textarea';
  if (element instanceof HTMLSelectElement) return 'select';
  if (element instanceof HTMLAnchorElement) return 'link';
  if (element.isContentEditable) return 'contenteditable';
  return element.tagName.toLocaleLowerCase('en-US');
}

function controlValue(element: HTMLElement) {
  if (element instanceof HTMLInputElement) {
    if (['password', 'file'].includes(element.type)) return undefined;
    if (['checkbox', 'radio'].includes(element.type)) return undefined;
    return compactText(element.value, 1200);
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return compactText(element.value, 1200);
  }
  if (element.isContentEditable) return compactText(element.textContent, 1200);
  return undefined;
}

function serializeControl(element: HTMLElement, scope: AgentPanelControl['scope']): AgentPanelControl {
  const checked = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
    ? element.checked
    : element.getAttribute('aria-checked') === null
      ? undefined
      : element.getAttribute('aria-checked') === 'true';
  const href = element instanceof HTMLAnchorElement ? element.href : undefined;
  return {
    id: controlId(element),
    kind: controlKind(element),
    label: accessibleLabel(element),
    ...(controlValue(element) !== undefined ? { value: controlValue(element) } : {}),
    ...(checked !== undefined ? { checked } : {}),
    disabled: 'disabled' in element
      ? Boolean((element as HTMLButtonElement).disabled)
      : element.getAttribute('aria-disabled') === 'true',
    ...(element.getAttribute('aria-expanded') !== null
      ? { expanded: element.getAttribute('aria-expanded') === 'true' }
      : {}),
    ...(element.getAttribute('aria-selected') !== null
      ? { selected: element.getAttribute('aria-selected') === 'true' }
      : {}),
    ...(href ? { href: compactText(href, 1000) } : {}),
    scope,
  };
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
].join(',');

function activeWorkspaceRoot(surface: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-kodety-agent-surface]'))
    .find(element => element.dataset.kodetyAgentSurface === panelSurface(surface) && visible(element)) || null;
}

function collectControls(root: HTMLElement, scope: AgentPanelControl['scope']) {
  return Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
    .filter(element => visible(element) && !element.closest('[data-workspace-agent-dock]'))
    .map(element => serializeControl(element, scope));
}

function panelState(surface: string, query = '') {
  const root = activeWorkspaceRoot(surface);
  if (!root) throw new Error(`O painel visual “${surface}” não está montado.`);
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"], [role="listbox"]'))
    .filter(visible);
  const controls = [
    ...collectControls(root, 'workspace'),
    ...overlays.flatMap(overlay => collectControls(
      overlay,
      overlay.getAttribute('role') === 'dialog' ? 'dialog' : 'menu',
    )),
  ];
  const unique = Array.from(new Map(controls.map(control => [control.id, control])).values());
  const normalizedQuery = compactText(query).toLocaleLowerCase('pt-BR');
  const filtered = normalizedQuery
    ? unique.filter(control => `${control.label} ${control.kind} ${control.value || ''}`.toLocaleLowerCase('pt-BR').includes(normalizedQuery))
    : unique;
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, [role="heading"]'))
    .filter(visible)
    .map(element => compactText(element.textContent))
    .filter(Boolean)
    .slice(0, 80);
  const revisionSource = JSON.stringify({ surface: panelSurface(surface), controls: unique, headings });
  return {
    surface: panelSurface(surface),
    revision: `panel:${hash(revisionSource)}`,
    headings,
    controls: filtered.slice(0, 300),
    controlCount: unique.length,
    truncated: filtered.length > 300,
    guidance: 'Use controlId com kodety_panel_action. Depois de navegar, abrir um menu ou alterar um campo, leia o painel novamente antes da próxima ação.',
  };
}

export function snapshotAgentPanel(surface: string, args: Record<string, unknown> = {}) {
  return panelState(surface, typeof args.query === 'string' ? args.query : '');
}

function nativeValueSetter(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('Este campo não aceita atualização nativa.');
  setter.call(element, value);
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function nativeCheckedSetter(element: HTMLInputElement, checked: boolean) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
  if (!setter) throw new Error('Este controle não aceita atualização nativa.');
  setter.call(element, checked);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function settlePanel() {
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
}

export async function actOnAgentPanel(surface: string, args: AgentPanelAction) {
  if (!['click', 'setValue', 'toggle', 'focus'].includes(args.action)) {
    throw new Error('A ação solicitada não é suportada pelo painel visual.');
  }
  if (args.action === 'setValue' && typeof args.value !== 'string') {
    throw new Error('setValue exige o valor completo do campo.');
  }
  if (args.action === 'toggle' && typeof args.checked !== 'boolean') {
    throw new Error('toggle exige o estado final checked.');
  }
  const before = panelState(surface);
  if (args.expectedRevision !== before.revision) {
    throw new Error(`O painel mudou para ${before.revision}. Leia novamente antes de agir.`);
  }
  const element = controlsById.get(args.controlId);
  if (!element || !element.isConnected || !visible(element)) {
    throw new Error('O controle não está mais disponível. Leia o painel novamente.');
  }
  const label = accessibleLabel(element);
  const destructive = /excluir|apagar|remover|desativar|delete|remove|disable/i.test(label);
  if (destructive && args.confirmDestructive !== true) {
    throw new Error('Esta ação é destrutiva. Confirme a intenção do usuário e envie confirmDestructive=true.');
  }
  if ('disabled' in element && (element as HTMLButtonElement).disabled) {
    throw new Error(`O controle “${label || args.controlId}” está desabilitado.`);
  }

  if (args.action === 'click') {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    element.click();
  } else if (args.action === 'focus') {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.focus();
  } else if (args.action === 'setValue') {
    const value = typeof args.value === 'string' ? args.value : '';
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (['password', 'file', 'checkbox', 'radio'].includes(element.type)) {
        throw new Error('Use a ação apropriada para este tipo de controle.');
      }
      nativeValueSetter(element, value);
    } else if (element instanceof HTMLSelectElement) {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (element.isContentEditable) {
      element.focus();
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else {
      throw new Error('Este controle não aceita setValue.');
    }
  } else if (args.action === 'toggle') {
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
      nativeCheckedSetter(element, args.checked === true);
    } else if (element.getAttribute('role') === 'switch' || element.getAttribute('role') === 'checkbox') {
      const current = element.getAttribute('aria-checked') === 'true';
      if (current !== (args.checked === true)) element.click();
    } else {
      throw new Error('Este controle não aceita toggle.');
    }
  }

  await settlePanel();
  const after = panelState(surface);
  return {
    applied: true,
    action: args.action,
    control: { id: args.controlId, label },
    revision: after.revision,
    headings: after.headings,
    controls: after.controls.slice(0, 80),
    controlCount: after.controlCount,
  };
}

export function isNativePanelWorkspace(value: string) {
  return ['settings', 'kodefy', 'cms', 'analytics', 'localization', 'members', 'templates'].includes(panelSurface(value));
}
