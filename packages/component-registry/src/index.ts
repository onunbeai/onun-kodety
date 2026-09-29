import type { ComponentManifest } from '@coday/components';
import type { JSONValue, ResponsiveValue } from '@coday/control-schema';

export interface SlotReference { instanceId: string; layerId: string; componentId?: string }
export interface DataBinding { type: 'current-collection' | 'specific-item' | 'collection-query' | 'global-variable' | 'url-parameter' | 'authenticated-user' | 'server-function'; sourceId: string; fieldId?: string; query?: Record<string, JSONValue>; fallback?: JSONValue; transformId?: string }
export interface InstanceSizing { width?: number; height?: number; widthMode?: 'fixed' | 'fill' | 'hug' | 'intrinsic'; heightMode?: 'fixed' | 'fill' | 'hug' | 'intrinsic' }
export interface CodeComponentInstance {
  schemaVersion: string;
  id: string;
  componentId: string;
  componentVersion: string;
  props: Record<string, JSONValue>;
  responsiveProps?: Record<string, ResponsiveValue<JSONValue>>;
  bindings?: Record<string, DataBinding>;
  slots?: Record<string, SlotReference | SlotReference[]>;
  sizing: InstanceSizing;
  metadata: { createdAt: string; updatedAt: string };
}
export interface ComponentMigration { from: string; to: string; migrateProps(props: Record<string, JSONValue>): Record<string, JSONValue> }
export interface PublishedComponentVersion {
  id: string; version: string; schemaVersion: string; bundle: string; sourceMap?: string;
  moduleGraph?: Record<string, string>;
  /** Editable project source that produced this development build. */
  sourcePath?: string;
  /** Content identity of bundle + sidecars. Used to make runtime module URLs immutable. */
  bundleHash?: string;
  manifest: ComponentManifest; publishedAt: string; author: string; dependencies: string[]; changelog?: string;
}
export interface ComponentRegistrySnapshot { schemaVersion: string; components: PublishedComponentVersion[]; instances: CodeComponentInstance[] }
export interface RegistryStorage { read(): Promise<ComponentRegistrySnapshot | null>; write(snapshot: ComponentRegistrySnapshot): Promise<void> }

function compareVersions(left: string, right: string) {
  const a = left.split(/[.-]/).map(Number); const b = right.split(/[.-]/).map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function versionKey(id: string, version: string) { return `${id}@${version}` }

export class ComponentRegistry {
  private versions = new Map<string, PublishedComponentVersion>();
  private instances = new Map<string, CodeComponentInstance>();
  private migrations = new Map<string, ComponentMigration[]>();
  constructor(private readonly storage?: RegistryStorage) {}

  async hydrate() {
    const snapshot = await this.storage?.read();
    snapshot?.components.forEach(component => this.versions.set(versionKey(component.id, component.version), clone(component)));
    snapshot?.instances.forEach(instance => this.instances.set(instance.id, clone(instance)));
  }
  async persist() { await this.storage?.write(this.snapshot()) }
  snapshot(): ComponentRegistrySnapshot { return { schemaVersion: '1.0.0', components: [...this.versions.values()].map(clone), instances: [...this.instances.values()].map(clone) } }
  publish(component: PublishedComponentVersion) {
    if (component.id !== component.manifest.id || component.version !== component.manifest.version) throw new Error('Bundle e manifest possuem identidades incompatíveis.');
    this.versions.set(versionKey(component.id, component.version), clone(component));
    return component;
  }
  get(id: string, version: string) { const found = this.versions.get(versionKey(id, version)); return found ? clone(found) : undefined }
  list(id?: string) { return [...this.versions.values()].filter(item => !id || item.id === id).sort((a, b) => compareVersions(b.version, a.version)).map(clone) }
  latest(id: string) { return this.list(id)[0] }
  registerMigration(componentId: string, migration: ComponentMigration) {
    const list = this.migrations.get(componentId) || [];
    if (list.some(item => item.from === migration.from && item.to === migration.to)) throw new Error('Migration duplicada.');
    this.migrations.set(componentId, [...list, migration]);
  }
  createInstance(componentId: string, version?: string, initial: Partial<CodeComponentInstance> = {}) {
    const component = version ? this.get(componentId, version) : this.latest(componentId);
    if (!component) throw new Error(`Componente ${componentId}${version ? `@${version}` : ''} não encontrado.`);
    const now = new Date().toISOString();
    const instance: CodeComponentInstance = {
      schemaVersion: '1.0.0', id: initial.id || globalThis.crypto?.randomUUID?.() || `cci-${Date.now().toString(36)}`,
      componentId, componentVersion: component.version, props: { ...component.manifest.defaultProps, ...initial.props },
      responsiveProps: initial.responsiveProps, bindings: initial.bindings, slots: initial.slots,
      sizing: {
        widthMode: component.manifest.sizing.width,
        heightMode: component.manifest.sizing.height,
        width: component.manifest.sizing.defaultWidth,
        height: component.manifest.sizing.defaultHeight,
        ...initial.sizing,
      },
      metadata: { createdAt: initial.metadata?.createdAt || now, updatedAt: now },
    };
    this.instances.set(instance.id, clone(instance)); return clone(instance);
  }
  getInstance(id: string) { const found = this.instances.get(id); return found ? clone(found) : undefined }
  updateInstance(id: string, updater: (current: CodeComponentInstance) => CodeComponentInstance) {
    const current = this.getInstance(id); if (!current) throw new Error(`Instância ${id} não encontrada.`);
    const next = updater(current); next.metadata.updatedAt = new Date().toISOString(); this.instances.set(id, clone(next)); return clone(next);
  }
  removeInstance(id: string) { return this.instances.delete(id) }
  previewUpgrade(instanceId: string, targetVersion: string) {
    const instance = this.getInstance(instanceId); if (!instance) throw new Error('Instância não encontrada.');
    const target = this.get(instance.componentId, targetVersion); if (!target) throw new Error('Versão de destino não encontrada.');
    if (compareVersions(targetVersion, instance.componentVersion) < 0) return { instance: { ...instance, componentVersion: targetVersion }, migrations: [] as ComponentMigration[], incompatible: false };
    const chain: ComponentMigration[] = []; let version = instance.componentVersion; const available = this.migrations.get(instance.componentId) || [];
    while (version !== targetVersion) {
      const next = available.filter(item => item.from === version && compareVersions(item.to, targetVersion) <= 0).sort((a, b) => compareVersions(b.to, a.to))[0];
      if (!next) return { instance, migrations: chain, incompatible: true };
      chain.push(next); version = next.to;
    }
    const props = chain.reduce((current, migration) => migration.migrateProps(current), clone(instance.props));
    return { instance: { ...instance, componentVersion: targetVersion, props }, migrations: chain, incompatible: false };
  }
  upgrade(instanceId: string, targetVersion: string) {
    const preview = this.previewUpgrade(instanceId, targetVersion); if (preview.incompatible) throw new Error('Não existe uma cadeia completa de migrations.');
    this.instances.set(instanceId, clone(preview.instance)); return preview.instance;
  }
  rollback(instanceId: string, snapshot: CodeComponentInstance) {
    if (snapshot.id !== instanceId) throw new Error('Snapshot pertence a outra instância.');
    this.instances.set(instanceId, clone(snapshot)); return clone(snapshot);
  }
}

export interface HistoryEntry<T> { label: string; before: T; after: T; timestamp: number }
export class TransactionHistory<T> {
  private undoEntries: HistoryEntry<T>[] = []; private redoEntries: HistoryEntry<T>[] = [];
  private transaction?: { label: string; before: T; current: T };
  private pending?: ReturnType<typeof setTimeout>;
  constructor(private state: T, private readonly cloneState: (value: T) => T = clone, private readonly limit = 200) {}
  current() { return this.cloneState(this.state) }
  beginTransaction(label: string) { if (!this.transaction) this.transaction = { label, before: this.cloneState(this.state), current: this.cloneState(this.state) } }
  update(value: T) { this.state = this.cloneState(value); if (this.transaction) this.transaction.current = this.cloneState(value) }
  commitTransaction() {
    if (!this.transaction) return;
    if (JSON.stringify(this.transaction.before) !== JSON.stringify(this.transaction.current)) this.push({ label: this.transaction.label, before: this.transaction.before, after: this.transaction.current, timestamp: Date.now() });
    this.transaction = undefined;
  }
  cancelTransaction() { if (this.transaction) this.state = this.transaction.before; this.transaction = undefined }
  commit(value: T, label: string, debounceMs = 0) {
    const before = this.cloneState(this.state); this.state = this.cloneState(value);
    if (!debounceMs) { this.push({ label, before, after: this.current(), timestamp: Date.now() }); return; }
    if (!this.transaction) this.beginTransaction(label); this.update(value); if (this.pending) clearTimeout(this.pending); this.pending = setTimeout(() => this.commitTransaction(), debounceMs);
  }
  undo() { const entry = this.undoEntries.pop(); if (!entry) return this.current(); this.redoEntries.push(entry); this.state = this.cloneState(entry.before); return this.current() }
  redo() { const entry = this.redoEntries.pop(); if (!entry) return this.current(); this.undoEntries.push(entry); this.state = this.cloneState(entry.after); return this.current() }
  canUndo() { return this.undoEntries.length > 0 } canRedo() { return this.redoEntries.length > 0 }
  private push(entry: HistoryEntry<T>) { this.undoEntries.push(entry); this.undoEntries = this.undoEntries.slice(-this.limit); this.redoEntries = [] }
}

export class MemoryRegistryStorage implements RegistryStorage {
  private value: ComponentRegistrySnapshot | null = null;
  async read() { return this.value ? clone(this.value) : null }
  async write(snapshot: ComponentRegistrySnapshot) { this.value = clone(snapshot) }
}
