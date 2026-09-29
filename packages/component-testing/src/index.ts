import type { ComponentManifest } from '@coday/components';
import { getControlAdapter, validateDefaults, type JSONValue } from '@coday/control-schema';

export interface ContractTestResult { passed: boolean; assertions: Array<{ name: string; passed: boolean; message?: string }> }
export function testComponentContract(manifest: ComponentManifest): ContractTestResult {
  const assertions: ContractTestResult['assertions'] = [];
  const check = (name: string, passed: boolean, message?: string) => assertions.push({ name, passed, ...(!passed && message ? { message } : {}) });
  check('stable-id', /^[a-z0-9][a-z0-9._-]+$/i.test(manifest.id), 'O ID precisa ser estável e seguro.');
  check('semantic-version', /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(manifest.version), 'Versão semântica inválida.');
  const defaults = validateDefaults(manifest.controls); check('valid-defaults', defaults.valid, defaults.issues.map(item => `${item.path}: ${item.message}`).join('; '));
  check('serializable-manifest', (() => { try { JSON.stringify(manifest); return true } catch { return false } })(), 'Manifest não serializável.');
  Object.entries(manifest.defaultProps).forEach(([key, value]) => {
    const control = manifest.controls[key]; if (!control) { check(`default:${key}`, false, 'Default sem controle.'); return; }
    check(`default:${key}`, getControlAdapter(control.type).validate(value, control, key).valid, 'Default incompatível com controle.');
  });
  return { passed: assertions.every(item => item.passed), assertions };
}

export function createFakeAsset(id = 'asset-1') { return { id, src: `https://assets.example.test/${id}.webp`, width: 1200, height: 800, alt: 'Imagem de teste' } }
export function createFakeCmsItem(values: Record<string, JSONValue>) { return { id: 'cms-item-1', ...values } }
export function expectSerializable(value: unknown) { const encoded = JSON.stringify(value); if (encoded === undefined) throw new Error('Valor não serializável.'); return JSON.parse(encoded) as JSONValue }
