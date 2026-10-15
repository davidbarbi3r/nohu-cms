/** Formulaire des contenus d'une page, généré depuis cms.config.ts. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { fieldKey, listFields } from '../config';
import {
  normalizeValue,
  sameValue,
  validateValue,
  type Field,
  type StoredValue,
} from '../fields';
import { api, ApiError } from './api';
import { useConfig } from './context';
import { FieldInput } from './fields';
import { useConfirm, useToast } from './ui';

type Values = Record<string, StoredValue>;

interface Props {
  pageId: string;
  overrides: Values;
  onSaved: (overrides: Values) => void;
  onDirtyChange: (dirty: boolean) => void;
  onPublished: () => void;
}

const defaultOf = (field: Field) => normalizeValue(field, field.default);

export function PageEditor({
  pageId,
  overrides,
  onSaved,
  onDirtyChange,
  onPublished,
}: Props) {
  const config = useConfig();
  const pageDef = config.pages[pageId];
  const toast = useToast();
  const confirm = useConfirm();

  const refs = useMemo(
    () => listFields(config.pages, pageId),
    [config, pageId],
  );

  const initial = useMemo(() => {
    const values: Values = {};
    for (const { key, field } of refs) {
      values[key] = overrides[key] ?? defaultOf(field);
    }
    return values;
  }, [refs, overrides]);

  // `initial` suit les valeurs enregistrées ; `draft` garde ce qui est tapé,
  // y compris pendant un enregistrement (l'éditeur est recréé par page).
  const [draft, setDraft] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  /** Incrémenté quand une valeur est remplacée d'un bloc (éditeurs riches). */
  const [revision, setRevision] = useState(0);

  const dirtyKeys = refs
    .map(({ key }) => key)
    .filter((key) => !sameValue(draft[key], initial[key]));
  const dirty = dirtyKeys.length > 0;

  useEffect(() => onDirtyChange(dirty), [dirty]);

  const update = (key: string, value: StoredValue) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const reset = (key: string, field: Field) => {
    update(key, defaultOf(field));
    setRevision((value) => value + 1);
  };

  const save = async () => {
    const found: Record<string, string> = {};
    for (const { key, field } of refs) {
      if (!dirtyKeys.includes(key)) continue;
      const error = validateValue(field, draft[key]);
      if (error) found[key] = `« ${field.label} » ${error}.`;
    }
    setErrors(found);
    if (Object.keys(found).length) {
      toast('Certains champs sont à corriger avant d’enregistrer.', 'error');
      document
        .getElementById(`section-${Object.keys(found)[0].split('.')[1]}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    setSaving(true);
    try {
      const values = Object.fromEntries(
        dirtyKeys.map((key) => [key, draft[key]]),
      );
      const result = await api.saveContent(pageId, values);
      const next = { ...overrides };
      for (const { key, field } of refs) {
        if (!(key in values)) continue;
        if (sameValue(values[key], defaultOf(field))) delete next[key];
        else next[key] = values[key];
      }
      onSaved(next);
      if (result.triggered) onPublished();
      toast(result.message, result.triggered ? 'success' : 'info');
    } catch (error) {
      const apiError = error as ApiError;
      setErrors(apiError.fields ?? {});
      toast(apiError.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    const ok = await confirm({
      title: 'Annuler les modifications ?',
      message: `Les ${dirtyKeys.length} modification(s) non enregistrée(s) de cette page seront perdues.`,
      confirmLabel: 'Oui, tout annuler',
      cancelLabel: 'Continuer à modifier',
      danger: true,
    });
    if (ok) {
      setDraft(initial);
      setErrors({});
      setRevision((value) => value + 1);
    }
  };

  if (!pageDef) return <p class="notice notice--error">Page inconnue.</p>;

  return (
    <div class="editor">
      <header class="editor__head">
        <div>
          <p class="editor__kicker">Contenus du site</p>
          <h1>{pageDef.label}</h1>
          {pageDef.help && <p class="editor__intro">{pageDef.help}</p>}
        </div>
        {pageDef.path && (
          <a
            class="btn btn--ghost"
            href={pageDef.path}
            target="_blank"
            rel="noreferrer"
          >
            Voir la page ↗
          </a>
        )}
      </header>

      {Object.keys(pageDef.sections).length > 1 && (
        <nav class="section-nav" aria-label="Sections de la page">
          {Object.entries(pageDef.sections).map(([sectionId, sectionDef]) => (
            <a
              key={sectionId}
              href={`#section-${sectionId}`}
              onClick={(event) => {
                event.preventDefault();
                document
                  .getElementById(`section-${sectionId}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {sectionDef.label}
            </a>
          ))}
        </nav>
      )}

      {Object.entries(pageDef.sections).map(([sectionId, sectionDef]) => (
        <section class="card" id={`section-${sectionId}`} key={sectionId}>
          <h2>{sectionDef.label}</h2>
          {sectionDef.help && <p class="card__help">{sectionDef.help}</p>}
          <div class="card__fields">
            {Object.entries(sectionDef.fields).map(([fieldId, field]) => {
              const key = fieldKey(pageId, sectionId, fieldId);
              return (
                <FieldInput
                  key={key}
                  field={field}
                  value={draft[key]}
                  error={errors[key]}
                  revision={revision}
                  modified={!sameValue(draft[key], defaultOf(field))}
                  onChange={(value) => update(key, value)}
                  onReset={() => reset(key, field)}
                />
              );
            })}
          </div>
        </section>
      ))}

      <div class={`savebar${dirty ? ' is-visible' : ''}`} aria-hidden={!dirty}>
        <p>
          <strong>{dirtyKeys.length}</strong>{' '}
          {dirtyKeys.length > 1
            ? 'modifications non enregistrées'
            : 'modification non enregistrée'}
        </p>
        <div>
          <button
            type="button"
            class="btn btn--ghost"
            onClick={discard}
            disabled={saving || !dirty}
          >
            Annuler
          </button>
          <button
            type="button"
            class="btn btn--primary"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer et publier'}
          </button>
        </div>
      </div>
    </div>
  );
}
