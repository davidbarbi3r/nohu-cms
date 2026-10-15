/** Saisie d'un champ, quel que soit son type (généré depuis cms.config.ts). */
import { useRef, useState } from 'preact/hooks';
import type {
  Field,
  ImageField,
  ImageValue,
  ItemField,
  ListField,
  RichTextField,
  ScalarField,
  StoredValue,
} from '../fields';
import { ApiError } from './api';
import { ACCEPTED_IMAGES, uploadImage } from './image';
import { RichTextEditor } from './RichTextEditor';
import { AutoTextarea, FieldShell, useConfirm, useId } from './ui';

export interface FieldInputProps<F extends Field = Field, V = StoredValue> {
  field: F;
  value: V;
  error?: string;
  /** Différent de la valeur d'origine (affiche « Rétablir »). */
  modified?: boolean;
  /** Change quand la valeur est remplacée de l'extérieur (éditeur riche). */
  revision?: number;
  onChange: (value: V) => void;
  onReset?: () => void;
}

export function FieldInput(props: FieldInputProps) {
  const { field } = props;
  if (field.kind === 'list') {
    return (
      <ListEditor
        {...(props as FieldInputProps<ListField, Record<string, unknown>[]>)}
      />
    );
  }
  if (field.kind === 'image') {
    return (
      <ImageInput
        {...(props as FieldInputProps<ImageField, ImageValue | null>)}
      />
    );
  }
  if (field.kind === 'richtext') {
    return (
      <RichTextInput {...(props as FieldInputProps<RichTextField, string>)} />
    );
  }
  return <ScalarInput {...(props as FieldInputProps<ScalarField, string>)} />;
}

const resetLabel = (field: Field) =>
  field.kind === 'list'
    ? 'Rétablir la liste d’origine'
    : field.kind === 'image'
      ? 'Rétablir la photo d’origine'
      : 'Rétablir le texte d’origine';

function ScalarInput(props: FieldInputProps<ScalarField, string>) {
  const { field } = props;
  const value = props.value ?? '';
  const id = useId('field');
  const describedBy = props.error
    ? `${id}-error`
    : field.help
      ? `${id}-help`
      : undefined;
  const type =
    field.kind === 'url'
      ? 'url'
      : field.kind === 'email'
        ? 'email'
        : field.kind === 'date'
          ? 'date'
          : 'text';
  return (
    <FieldShell
      id={id}
      label={field.label}
      help={field.help}
      error={props.error}
      optional={field.optional}
      modified={props.modified}
      onReset={props.onReset}
      counter={field.max ? { length: value.length, max: field.max } : undefined}
    >
      {field.kind === 'textarea' ? (
        <AutoTextarea
          id={id}
          value={value}
          minRows={2}
          invalid={Boolean(props.error)}
          describedBy={describedBy}
          onInput={props.onChange}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          inputMode={field.kind === 'url' ? 'url' : undefined}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      )}
    </FieldShell>
  );
}

function RichTextInput(props: FieldInputProps<RichTextField, string>) {
  const { field } = props;
  const id = useId('rte');
  return (
    <div class={`field${props.error ? ' field--error' : ''}`}>
      <div class="field__head">
        <span class="list-field__label" id={`${id}-label`}>
          {field.label}
          {field.optional && <span class="field__optional"> (facultatif)</span>}
        </span>
        {props.modified && props.onReset && (
          <button type="button" class="link-button" onClick={props.onReset}>
            {resetLabel(field)}
          </button>
        )}
      </div>
      <RichTextEditor
        key={props.revision ?? 0}
        id={id}
        labelledBy={`${id}-label`}
        value={props.value ?? ''}
        onChange={props.onChange}
      />
      {props.error ? (
        <p class="field__error">{props.error}</p>
      ) : (
        field.help && <p class="field__help">{field.help}</p>
      )}
    </div>
  );
}

function ImageInput(props: FieldInputProps<ImageField, ImageValue | null>) {
  const { field, value } = props;
  const id = useId('image');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [dragging, setDragging] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setProblem('');
    if (file.type && !ACCEPTED_IMAGES.includes(file.type)) {
      setProblem(
        'Ce fichier n’est pas une photo. Choisis un fichier JPEG, PNG ou WebP.',
      );
      return;
    }
    setBusy(true);
    try {
      const upload = await uploadImage(file);
      props.onChange({
        src: upload.src,
        alt: value?.alt ?? '',
        width: upload.width,
        height: upload.height,
        srcset: upload.srcset,
      });
    } catch (caught) {
      setProblem(
        caught instanceof ApiError
          ? caught.message
          : 'Cette photo n’a pas pu être lue. Essaie avec une photo JPEG ou PNG.',
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const error = problem || props.error;
  return (
    <div class={`field${error ? ' field--error' : ''}`}>
      <div class="field__head">
        <span class="list-field__label" id={`${id}-label`}>
          {field.label}
          {field.optional && <span class="field__optional"> (facultatif)</span>}
        </span>
        {props.modified && props.onReset && (
          <button type="button" class="link-button" onClick={props.onReset}>
            {resetLabel(field)}
          </button>
        )}
      </div>
      <div class="cover">
        {value ? (
          <div class="cover__preview">
            <img src={value.src} alt="" />
            <div class="cover__actions">
              <button
                type="button"
                class="btn btn--soft btn--small"
                onClick={() => input.current?.click()}
                disabled={busy}
              >
                {busy ? 'Envoi…' : 'Changer la photo'}
              </button>
              <button
                type="button"
                class="btn btn--ghost btn--small"
                onClick={() => props.onChange(null)}
                disabled={busy}
              >
                Retirer
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            class={`cover__drop${dragging ? ' is-dragging' : ''}${error ? ' is-invalid' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handle(event.dataTransfer?.files[0]);
            }}
            disabled={busy}
            aria-labelledby={`${id}-label`}
            aria-describedby={error ? `${id}-error` : undefined}
          >
            <span class="cover__icon" aria-hidden="true">
              ＋
            </span>
            <strong>{busy ? 'Envoi de la photo…' : 'Ajouter une photo'}</strong>
            <span>Clique ou glisse une photo ici (JPEG, PNG ou WebP)</span>
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_IMAGES.join(',')}
          class="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => handle(event.currentTarget.files?.[0])}
        />
      </div>
      {value && (
        <div class="cover__alt">
          <label for={`${id}-alt`}>Description de la photo</label>
          <input
            id={`${id}-alt`}
            type="text"
            value={value.alt}
            aria-invalid={error ? true : undefined}
            onInput={(event) =>
              props.onChange({ ...value, alt: event.currentTarget.value })
            }
          />
          <p class="field__help">
            Lue par les lecteurs d’écran et par Google. Décris simplement ce que
            montre la photo.
          </p>
        </div>
      )}
      {error ? (
        <p class="field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        field.help && <p class="field__help">{field.help}</p>
      )}
    </div>
  );
}

const emptyItemValue = (field: ItemField) =>
  field.kind === 'image' ? null : '';

/** Titre d'un élément replié : son sous-champ `itemTitle`. */
function itemTitleOf(field: ListField, item: Record<string, unknown>) {
  const raw = item[field.itemTitle];
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object' && 'alt' in raw) {
    return String((raw as ImageValue).alt).trim();
  }
  return '';
}

function ListEditor(
  props: FieldInputProps<ListField, Record<string, unknown>[]>,
) {
  const { field } = props;
  const value = props.value ?? [];
  const confirm = useConfirm();
  const [open, setOpen] = useState<number | null>(null);
  const canRemove = value.length > (field.min ?? 0);
  const canAdd = field.max === undefined || value.length < field.max;

  const move = (index: number, delta: number) => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    props.onChange(next);
    if (open === index) setOpen(index + delta);
  };

  const remove = async (index: number) => {
    const title = itemTitleOf(field, value[index]) || `élément ${index + 1}`;
    const ok = await confirm({
      title: 'Supprimer cet élément ?',
      message: `« ${title} » sera retiré de la liste. Tu pourras encore annuler tant que tu n’as pas enregistré.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    props.onChange(value.filter((_, itemIndex) => itemIndex !== index));
    setOpen(null);
  };

  const add = () => {
    const empty = Object.fromEntries(
      Object.entries(field.fields).map(([subId, subField]) => [
        subId,
        emptyItemValue(subField),
      ]),
    );
    props.onChange([...value, empty]);
    setOpen(value.length);
  };

  return (
    <div class={`list-field${props.error ? ' field--error' : ''}`}>
      <div class="field__head">
        <span class="list-field__label">{field.label}</span>
        {props.modified && props.onReset && (
          <button type="button" class="link-button" onClick={props.onReset}>
            {resetLabel(field)}
          </button>
        )}
      </div>
      {field.help && <p class="field__help">{field.help}</p>}
      {props.error && <p class="field__error">{props.error}</p>}

      <ol class="list-items">
        {value.map((item, index) => {
          const expanded = open === index;
          const title = itemTitleOf(field, item) || 'Sans titre';
          return (
            <li key={index} class={`list-item${expanded ? ' is-open' : ''}`}>
              <div class="list-item__bar">
                <button
                  type="button"
                  class="list-item__toggle"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : index)}
                >
                  <span class="list-item__index">{index + 1}</span>
                  <span class="list-item__title">{title}</span>
                  <span class="list-item__chevron" aria-hidden="true">
                    {expanded ? '−' : '+'}
                  </span>
                </button>
                <div class="list-item__tools">
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Monter « ${title} »`}
                    title="Monter"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Descendre « ${title} »`}
                    title="Descendre"
                    disabled={index === value.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    class="icon-button icon-button--danger"
                    aria-label={`Supprimer « ${title} »`}
                    title={
                      canRemove
                        ? 'Supprimer'
                        : `Il faut garder au moins ${field.min} élément(s)`
                    }
                    disabled={!canRemove}
                    onClick={() => remove(index)}
                  >
                    ×
                  </button>
                </div>
              </div>
              {expanded && (
                <div class="list-item__body">
                  {Object.entries(field.fields).map(([subId, subField]) => (
                    <FieldInput
                      key={subId}
                      field={subField}
                      value={
                        (item[subId] ?? emptyItemValue(subField)) as StoredValue
                      }
                      onChange={(subValue) =>
                        props.onChange(
                          value.map((current, itemIndex) =>
                            itemIndex === index
                              ? { ...current, [subId]: subValue }
                              : current,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {canAdd && (
        <button type="button" class="btn btn--soft" onClick={add}>
          + Ajouter {field.itemLabel}
        </button>
      )}
    </div>
  );
}
