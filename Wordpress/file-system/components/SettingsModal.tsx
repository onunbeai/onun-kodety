import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Database, Loader2, Lock, Save, UploadCloud } from '../../../components/ui/gravity-icons';
import type { FileSystemApi } from '../api';
import type { FileSystemSettings } from '../types';
import { Button, Modal, Spinner, TextInput } from './ui';

function normalizedSettings(value: FileSystemSettings): FileSystemSettings {
  return {
    ...value,
    mode: value.mode === 'remote' ? 'remote' : 'local',
    remote_url: typeof value.remote_url === 'string' ? value.remote_url : '',
    remote_token: '',
    clear_remote_token: false,
		remote_signing_secret: '',
		clear_remote_signing_secret: false,
  };
}

export function SettingsModal({
  api,
  open,
  onClose,
  onSaved,
}: {
  api: FileSystemApi;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [settings, setSettings] = useState<FileSystemSettings>({ mode: 'local' });
  const [initial, setInitial] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const serialized = useMemo(() => JSON.stringify(settings), [settings]);
  const dirty = serialized !== initial;

  useEffect(() => {
    let active = true;
    if (!open) return () => { active = false; };
    setLoading(true);
    setError('');
    setSaved(false);
    api.getSettings()
      .then(value => {
        if (!active) return;
        const next = normalizedSettings(value);
        setSettings(next);
        setInitial(JSON.stringify(next));
      })
      .catch(reason => active && setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as configurações.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api, open]);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError('');
    try {
      const payload: FileSystemSettings = {
        mode: settings.mode,
        remote_url: String(settings.remote_url || ''),
      };
      if (settings.remote_token) payload.remote_token = String(settings.remote_token);
      if (settings.clear_remote_token) payload.clear_remote_token = true;
			if (settings.remote_signing_secret) payload.remote_signing_secret = String(settings.remote_signing_secret);
			if (settings.clear_remote_signing_secret) payload.clear_remote_signing_secret = true;
      const result = await api.saveSettings(payload);
      const next = normalizedSettings(result);
      setSettings(next);
      setInitial(JSON.stringify(next));
      setSaved(true);
      onSaved?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar as configurações.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Storage settings"
      description="Escolha onde o Onun Kodety File System executa as operações de arquivo."
      width="min(620px, calc(100vw - 32px))"
      onClose={onClose}
      footer={<><span className="kfs-settings__save-state" role="status">{saved ? <><Check size={12} /> Configurações salvas</> : dirty ? 'Alterações não salvas' : ''}</span><Button variant="quiet" onClick={onClose}>Fechar</Button><Button variant="primary" disabled={!dirty || loading || saving} onClick={() => void save()}>{saving ? <Loader2 size={13} /> : <Save size={13} />}Salvar</Button></>}
    >
      {loading ? <div className="kfs-modal-loading"><Spinner label="Carregando configurações" /><span>Carregando configurações…</span></div> : (
        <div className="kfs-settings">
          {error && <div className="kfs-inline-error" role="alert"><AlertTriangle size={13} /><span>{error}</span></div>}
          <fieldset className="kfs-settings__modes">
            <legend>Backend mode</legend>
            <label className={settings.mode === 'local' ? 'is-active' : ''}>
              <input type="radio" name="backend-mode" value="local" checked={settings.mode === 'local'} onChange={() => { setSettings(current => ({ ...current, mode: 'local' })); setSaved(false); }} />
              <span><Database size={17} /></span>
              <div><strong>Local WordPress</strong><small>Usa o storage isolado gerenciado por este plugin.</small></div>
              <i />
            </label>
            <label className={settings.mode === 'remote' ? 'is-active' : ''}>
              <input type="radio" name="backend-mode" value="remote" checked={settings.mode === 'remote'} onChange={() => { setSettings(current => ({ ...current, mode: 'remote' })); setSaved(false); }} />
              <span><UploadCloud size={17} /></span>
              <div><strong>Remote Asset API</strong><small>Conecta a um serviço compatível via HTTPS.</small></div>
              <i />
            </label>
          </fieldset>
          <div className={`kfs-settings__remote ${settings.mode !== 'remote' ? 'is-disabled' : ''}`}>
            <label className="kfs-field"><span>Remote API URL</span><TextInput type="url" value={String(settings.remote_url || '')} placeholder="https://assets.example.com/api" disabled={settings.mode !== 'remote'} onChange={event => { setSettings(current => ({ ...current, remote_url: event.target.value })); setSaved(false); }} /></label>
            <label className="kfs-field"><span>Access token</span><div className="kfs-settings__secret"><Lock size={13} /><TextInput type="password" value={String(settings.remote_token || '')} placeholder={settings.remote_token_set ? 'Token configurado — deixe vazio para manter' : 'Cole o token do backend'} disabled={settings.mode !== 'remote'} autoComplete="new-password" onChange={event => { setSettings(current => ({ ...current, remote_token: event.target.value, clear_remote_token: false })); setSaved(false); }} /></div></label>
            {settings.remote_token_set && <label className="kfs-settings__clear"><input type="checkbox" checked={Boolean(settings.clear_remote_token)} disabled={settings.mode !== 'remote'} onChange={event => { setSettings(current => ({ ...current, clear_remote_token: event.target.checked, remote_token: event.target.checked ? '' : current.remote_token })); setSaved(false); }} /><span>Remover token salvo</span></label>}
			<label className="kfs-field"><span>Request signing secret</span><div className="kfs-settings__secret"><Lock size={13} /><TextInput type="password" value={String(settings.remote_signing_secret || '')} placeholder={settings.remote_signing_secret_set ? 'Secret configurado — deixe vazio para manter' : 'Use um secret diferente, com 32+ caracteres'} disabled={settings.mode !== 'remote'} autoComplete="new-password" onChange={event => { setSettings(current => ({ ...current, remote_signing_secret: event.target.value, clear_remote_signing_secret: false })); setSaved(false); }} /></div></label>
			{settings.remote_signing_secret_set && <label className="kfs-settings__clear"><input type="checkbox" checked={Boolean(settings.clear_remote_signing_secret)} disabled={settings.mode !== 'remote'} onChange={event => { setSettings(current => ({ ...current, clear_remote_signing_secret: event.target.checked, remote_signing_secret: event.target.checked ? '' : current.remote_signing_secret })); setSaved(false); }} /><span>Remover signing secret salvo</span></label>}
			<p>As duas credenciais ficam criptografadas e nunca são retornadas pela API. Campos vazios preservam os valores já configurados.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}
