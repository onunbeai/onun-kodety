'use client';
import React, { useMemo, useState } from 'react';
import { PropertyInspector } from '@coday/property-inspector';
import { RuntimeRegistry, ComponentHost } from '@coday/component-runtime';
import { TransactionHistory, type CodeComponentInstance } from '@coday/component-registry';
import type { JSONValue } from '@coday/control-schema';
import { componentDefinition } from '../../../examples/basic-card/src/ProductCard';

const breakpoints = [{ id: 'primary', width: 1920 }, { id: 'tablet', width: 810, parentId: 'primary' }, { id: 'mobile', width: 480, parentId: 'tablet' }];
export default function ComponentPlayground() {
  const registry = useMemo(() => { const value = new RuntimeRegistry(); value.register(componentDefinition); return value }, []);
  const initial = useMemo<CodeComponentInstance>(() => ({ schemaVersion: '1.0.0', id: 'playground-instance', componentId: componentDefinition.manifest.id, componentVersion: componentDefinition.manifest.version, props: componentDefinition.manifest.defaultProps, sizing: {}, metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }), []);
  const history = useMemo(() => new TransactionHistory(initial), [initial]); const [instance, setInstance] = useState(initial); const [breakpoint, setBreakpoint] = useState('primary');
  const update = (property: string, value: JSONValue) => { const next = { ...instance, props: { ...instance.props, [property]: value }, metadata: { ...instance.metadata, updatedAt: new Date().toISOString() } }; history.update(next); setInstance(next) };
  return <main style={{ display: 'grid', gridTemplateColumns: '1fr 300px', minHeight: '100vh', background: '#101011' }}><section style={{ display: 'grid', placeItems: 'center', padding: 48, background: 'white' }}><ComponentHost instance={instance} registry={registry} breakpoints={breakpoints} activeBreakpoint={breakpoint} /></section><div><div style={{ padding: 8, display: 'flex', gap: 6 }}>{breakpoints.map(item => <button key={item.id} onClick={() => setBreakpoint(item.id)}>{item.width}</button>)}</div><PropertyInspector schema={componentDefinition.manifest.controls} values={instance.props} breakpoint={breakpoint} breakpoints={breakpoints} onChange={update} history={{ beginTransaction: label => history.beginTransaction(label), commitTransaction: () => { history.commitTransaction(); setInstance(history.current()) } }} /></div></main>;
}
