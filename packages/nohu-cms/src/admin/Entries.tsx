/** Liste et fiche d'édition des entrées d'une collection (articles…). */
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  emptyEntry,
  entryPath,
  knownAssets,
  slugify,
  validateEntry,
  type CollectionDef,
  type Entry,
  type EntryErrors,
  type EntryInput,
  type EntryStatus,
} from '../config';
import type { ImageValue, StoredValue } from '../fields';
import { formatDate } from '../format';
import { api, ApiError } from './api';
import { useConfig, usePreview } from './context';
import { FieldInput } from './fields';
import {
  FieldShell,
  formatDateTime,
  Spinner,
  useConfirm,
  useId,
  useToast,
} from './ui';

type Navigate = (path: string, force?: boolean) => void;

const toInput = (entry: Entry): EntryInput => ({
  title: entry.title,
  slug: entry.slug,
  status: entry.status,
  publishedAt: entry.publishedAt,
  data: entry.data,
});

/** Première image remplie de l'entrée, pour la vignette de la liste. */
function thumbnailOf(definition: CollectionDef, entry: Pick<Entry, 'data'>) {
  for (const [id, field] of Object.entries(definition.fields)) {
    if (field.kind !== 'image') continue;
    const image = (entry.data as Record<string, unknown>)[id] as
      ImageValue | null | undefined;
    if (image?.src) return image.src;
  }
  return null;
}

/** Complète les données avec les champs ajoutés à la config depuis l'enregistrement. */
function withDefaults(definition: CollectionDef, input: EntryInput) {
  const fresh = emptyEntry(definition);
  return { ...input, data: { ...fresh.data, ...input.data } };
}

export function EntryList({
  name,
  navigate,
}: {
  name: string;
  navigate: Navigate;
}) {
  const definition = useConfig().collections?.[name];
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    api
      .entries(name)
      .then((result) => setEntries(result.entries))
      .catch((error: ApiError) => setProblem(error.message));
  }, [name]);

  if (!definition) {
    return <p class="notice notice--error">Collection inconnue.</p>;
  }
  const newPath = `/collections/${name}/nouveau`;
  const drafts = (entries ?? []).filter((entry) => entry.status === 'draft');
  const published = (entries ?? []).filter(
    (entry) => entry.status === 'published',
  );

  return (
    <div class="editor">
      <header class="editor__head">
        <div>
          <p class="editor__kicker">Collection</p>
          <h1>{definition.label}</h1>
          <p class="editor__intro">
            {definition.help ??
              'Les entrées publiées apparaissent sur le site, chacune avec sa page. Un brouillon reste invisible tant qu’il n’est pas publié.'}
          </p>
        </div>
        <button
          type="button"
          class="btn btn--primary"
          onClick={() => navigate(newPath)}
        >
          + Ajouter {definition.itemLabel}
        </button>
      </header>

      {problem && <p class="notice notice--error">{problem}</p>}
      {!entries && !problem && <Spinner label="Chargement…" />}

      {entries && entries.length === 0 && (
        <div class="empty">
          <h2>Rien pour le moment</h2>
          <p>
            Crée la première entrée : un titre, puis le contenu. Tu pourras la
            garder en brouillon avant de la publier.
          </p>
          <button
            type="button"
            class="btn btn--primary"
            onClick={() => navigate(newPath)}
          >
            Ajouter {definition.itemLabel}
          </button>
        </div>
      )}

      {drafts.length > 0 && (
        <EntryGroup
          title="Brouillons"
          name={name}
          definition={definition}
          entries={drafts}
          navigate={navigate}
        />
      )}
      {published.length > 0 && (
        <EntryGroup
          title="En ligne"
          name={name}
          definition={definition}
          entries={published}
          navigate={navigate}
        />
      )}
    </div>
  );
}

function EntryGroup(props: {
  title: string;
  name: string;
  definition: CollectionDef;
  entries: Entry[];
  navigate: Navigate;
}) {
  const preview = usePreview();
  return (
    <section class="entry-group">
      <h2>{props.title}</h2>
      <ul class="entry-rows">
        {props.entries.map((entry) => {
          const thumbnail = thumbnailOf(props.definition, entry);
          const live = entry.status === 'published';
          return (
            <li key={entry.id}>
              <a
                class="entry-row"
                href={`#/collections/${props.name}/${entry.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  props.navigate(`/collections/${props.name}/${entry.id}`);
                }}
              >
                <span class="entry-row__thumb">
                  {thumbnail && preview(thumbnail) ? (
                    <img src={preview(thumbnail)} alt="" loading="lazy" />
                  ) : (
                    <span aria-hidden="true">◌</span>
                  )}
                </span>
                <span class="entry-row__text">
                  <strong>{entry.title || 'Sans titre'}</strong>
                  <span>
                    {live && entry.publishedAt
                      ? `Publié le ${formatDate(entry.publishedAt)}`
                      : `Modifié le ${formatDateTime(entry.updatedAt)}`}
                  </span>
                </span>
                <span class={`badge badge--${live ? 'live' : 'draft'}`}>
                  {live ? 'En ligne' : 'Brouillon'}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface EditorProps {
  name: string;
  id: string | null;
  navigate: Navigate;
  onCreated: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onPublished: () => void;
}

export function EntryEditor({
  name,
  id,
  navigate,
  onCreated,
  onDirtyChange,
  onPublished,
}: EditorProps) {
  const config = useConfig();
  const definition = config.collections?.[name] as CollectionDef;
  const toast = useToast();
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState<Entry | null>(null);
  const [baseline, setBaseline] = useState<EntryInput>(() =>
    emptyEntry(definition),
  );
  const [draft, setDraft] = useState<EntryInput>(baseline);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<EntryErrors>({});
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  /** Identifiant que l'on vient de créer : inutile de recharger le formulaire. */
  const createdId = useRef<string | null>(null);
  const ids = {
    title: useId('e'),
    slug: useId('e'),
    publishedAt: useId('e'),
  };
  const listPath = `/collections/${name}`;

  useEffect(() => {
    if (!id) return;
    api
      .entry(name, id)
      .then(({ entry }) => {
        setLoaded(entry);
        if (id === createdId.current) return;
        const input = withDefaults(definition, toInput(entry));
        setBaseline(input);
        setDraft(input);
        setSlugTouched(true);
        setRevision((value) => value + 1);
      })
      .catch((error: ApiError) => setProblem(error.message));
  }, [name, id]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => onDirtyChange(dirty), [dirty]);

  const clearError = (key: string) => {
    if (!errors[key]) return;
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const setMeta = <K extends 'title' | 'slug' | 'publishedAt'>(
    key: K,
    value: string,
  ) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'title' && !slugTouched) next.slug = slugify(value);
      return next;
    });
    clearError(key);
  };

  const setData = (fieldId: string, value: StoredValue) => {
    setDraft((current) => ({
      ...current,
      data: { ...current.data, [fieldId]: value },
    }));
    clearError(`data.${fieldId}`);
  };

  const submit = async (status: EntryStatus) => {
    const snapshot = draft;
    const input: EntryInput = {
      ...snapshot,
      status,
      slug: snapshot.slug || slugify(snapshot.title),
    };
    const found = validateEntry(definition, input, knownAssets(config));
    setErrors(found);
    if (Object.keys(found).length) {
      toast(
        status === 'published'
          ? 'Il manque des informations pour publier.'
          : 'Certains champs sont à corriger.',
        'error',
      );
      return;
    }
    setSaving(true);
    try {
      const result = id
        ? await api.updateEntry(name, id, input)
        : await api.createEntry(name, input);
      const saved = (await api.entry(name, result.id)).entry;
      const savedInput = withDefaults(definition, toInput(saved));
      setLoaded(saved);
      setBaseline(savedInput);
      // Ce qui a été tapé pendant l'enregistrement reste à enregistrer.
      setDraft((current) =>
        current === snapshot
          ? savedInput
          : {
              ...current,
              status,
              slug: savedInput.slug,
              publishedAt: savedInput.publishedAt,
            },
      );
      toast(result.message, result.triggered ? 'success' : 'info');
      if (result.triggered) onPublished();
      if (!id) {
        createdId.current = result.id;
        onCreated(result.id);
      }
    } catch (error) {
      const apiError = error as ApiError;
      setErrors(apiError.fields ?? {});
      toast(apiError.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    const ok = await confirm({
      title: 'Supprimer définitivement ?',
      message: `« ${draft.title || 'Sans titre'} » sera supprimé, avec ses photos. Cette action est irréversible.`,
      confirmLabel: 'Supprimer définitivement',
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await api.deleteEntry(name, id);
      toast(result.message, 'success');
      if (result.triggered) onPublished();
      navigate(listPath, true);
    } catch (error) {
      toast((error as ApiError).message, 'error');
    }
  };

  if (problem) return <p class="notice notice--error">{problem}</p>;
  if (id && !loaded) return <Spinner label="Chargement…" />;

  const published = draft.status === 'published';
  const wasPublished = baseline.status === 'published';

  return (
    <div class="editor">
      <header class="editor__head">
        <div>
          <a
            class="back-link"
            href={`#${listPath}`}
            onClick={(event) => {
              event.preventDefault();
              navigate(listPath);
            }}
          >
            ← {definition.label}
          </a>
          <h1>
            {id
              ? draft.title || 'Sans titre'
              : `Ajouter ${definition.itemLabel}`}
          </h1>
          {loaded && (
            <p class="editor__intro">
              Dernière modification le {formatDateTime(loaded.updatedAt)} par{' '}
              {loaded.updatedBy}.
            </p>
          )}
        </div>
        <span
          class={`badge badge--${wasPublished ? 'live' : 'draft'} badge--large`}
        >
          {wasPublished ? 'En ligne' : 'Brouillon'}
        </span>
      </header>

      <div class="entry-layout">
        <div class="entry-main">
          <section class="card">
            <h2>Contenu</h2>
            <div class="card__fields">
              <FieldShell id={ids.title} label="Titre" error={errors.title}>
                <input
                  id={ids.title}
                  type="text"
                  value={draft.title}
                  maxLength={160}
                  aria-invalid={errors.title ? true : undefined}
                  onInput={(event) =>
                    setMeta('title', event.currentTarget.value)
                  }
                />
              </FieldShell>
              {Object.entries(definition.fields).map(([fieldId, field]) => (
                <FieldInput
                  key={fieldId}
                  field={field}
                  value={
                    (draft.data as Record<string, StoredValue>)[fieldId] ?? null
                  }
                  error={errors[`data.${fieldId}`]}
                  revision={revision}
                  onChange={(value) => setData(fieldId, value)}
                />
              ))}
            </div>
          </section>

          <details class="card card--quiet">
            <summary>Réglages avancés</summary>
            <div class="card__fields">
              <FieldShell
                id={ids.slug}
                label="Adresse de la page"
                help={`La page sera visible sur ${entryPath(definition, draft.slug || '…')}. Évite de la changer une fois la page partagée.`}
                error={errors.slug}
              >
                <input
                  id={ids.slug}
                  type="text"
                  value={draft.slug}
                  onInput={(event) => {
                    setSlugTouched(true);
                    setMeta('slug', slugify(event.currentTarget.value));
                  }}
                />
              </FieldShell>
              <FieldShell
                id={ids.publishedAt}
                label="Date de publication"
                optional
                help="Remplie automatiquement à la première publication. Sert à trier les entrées."
                error={errors.publishedAt}
              >
                <input
                  id={ids.publishedAt}
                  type="date"
                  value={draft.publishedAt}
                  onInput={(event) =>
                    setMeta('publishedAt', event.currentTarget.value)
                  }
                />
              </FieldShell>
            </div>
          </details>
        </div>

        <aside class="entry-side">
          <div class="card">
            <h2>Publication</h2>
            <p class="card__help">
              {published
                ? 'Visible sur le site. Chaque enregistrement met le site à jour (deux à trois minutes).'
                : 'Brouillon : visible seulement ici. Publie-le quand il est prêt.'}
            </p>
            <div class="side-actions">
              {published ? (
                <>
                  <button
                    type="button"
                    class="btn btn--primary"
                    disabled={saving || (!dirty && wasPublished)}
                    onClick={() => submit('published')}
                  >
                    {saving ? 'Enregistrement…' : 'Enregistrer et publier'}
                  </button>
                  <button
                    type="button"
                    class="btn btn--ghost"
                    disabled={saving}
                    onClick={() => submit('draft')}
                  >
                    Repasser en brouillon
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    class="btn btn--primary"
                    disabled={saving}
                    onClick={() => submit('published')}
                  >
                    {saving ? 'Enregistrement…' : 'Publier sur le site'}
                  </button>
                  <button
                    type="button"
                    class="btn btn--ghost"
                    disabled={saving || (!dirty && Boolean(id))}
                    onClick={() => submit('draft')}
                  >
                    Enregistrer le brouillon
                  </button>
                </>
              )}
              {wasPublished && baseline.slug && (
                <a
                  class="link-button"
                  href={entryPath(definition, baseline.slug)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Voir la page ↗
                </a>
              )}
            </div>
            {dirty && <p class="side-dirty">Modifications non enregistrées</p>}
          </div>

          {id && (
            <button
              type="button"
              class="btn btn--danger-ghost"
              onClick={remove}
            >
              Supprimer
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
