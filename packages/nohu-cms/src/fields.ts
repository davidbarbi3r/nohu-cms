/**
 * Vocabulaire du modèle de contenu : types de champs, pages, sections,
 * collections, et leur validation.
 *
 * Ce module ne dépend ni d'Astro ni de Node : il est importé par le build,
 * par l'admin (navigateur) et par le Worker Cloudflare.
 */

export type ScalarKind = 'text' | 'textarea' | 'url' | 'email' | 'date';

interface BaseField {
  label: string;
  /** Aide affichée sous le champ dans l'admin. */
  help?: string;
  /** Un champ optionnel peut être laissé vide. */
  optional?: boolean;
  /**
   * Champ technique, absent de l'admin (ancre, cadrage…). Sa valeur suit son
   * élément quand on réordonne une liste ; un nouvel élément reçoit la valeur
   * d'origine du champ.
   */
  hidden?: boolean;
}

export interface ScalarField extends BaseField {
  kind: ScalarKind;
  default: string;
  /** Longueur maximale (compteur dans l'admin, bloquant à l'enregistrement). */
  max?: number;
}

/** Texte mis en forme (HTML de l'éditeur, nettoyé au build). */
export interface RichTextField extends BaseField {
  kind: 'richtext';
  default: string;
}

/** Variante d'une image envoyée dans l'admin (servie sur `/media/…`). */
export interface ImageVariant {
  src: string;
  width: number;
}

export interface ImageValue {
  /**
   * `asset:<chemin depuis src/>` (image du projet, optimisée au build par
   * Astro), chemin dans `public/`, ou `/media/<id>/<largeur>.<ext>` (photo
   * envoyée dans l'admin).
   */
  src: string;
  alt: string;
  width?: number;
  height?: number;
  /** Variantes de largeurs, pour `srcset` (images envoyées dans l'admin). */
  srcset?: ImageVariant[];
}

export interface ImageField<
  V extends ImageValue | null = ImageValue | null,
> extends BaseField {
  kind: 'image';
  default: V;
}

/** Choix parmi une liste fermée (menu déroulant dans l'admin). */
export interface SelectField extends BaseField {
  kind: 'select';
  default: string;
  options: { value: string; label: string }[];
}

/** Champs autorisés dans les éléments d'une liste. */
export type ItemField = ScalarField | RichTextField | ImageField | SelectField;

export type ItemValues<I extends Record<string, ItemField>> = {
  [K in keyof I]: FieldValue<I[K]>;
};

export interface ListField<
  I extends Record<string, ItemField> = Record<string, ItemField>,
> extends BaseField {
  kind: 'list';
  /** Nom d'un élément, au singulier (« un tarif », « un avis »…). */
  itemLabel: string;
  /** Sous-champ utilisé comme titre de chaque élément replié dans l'admin. */
  itemTitle: keyof I & string;
  fields: I;
  default: ItemValues<I>[];
  min?: number;
  max?: number;
}

export type Field =
  ScalarField | RichTextField | SelectField | ImageField | ListField;

export type FieldValue<F> =
  F extends ListField<infer I>
    ? ItemValues<I>[]
    : F extends ImageField<infer V>
      ? V
      : string;

/** Valeur brute d'un champ, telle que stockée (JSON). */
export type StoredValue = FieldValue<Field>;

type ScalarOptions = Omit<ScalarField, 'kind' | 'label' | 'default'>;
type BaseOptions = Omit<BaseField, 'label'>;

const scalar =
  (kind: ScalarKind) =>
  (label: string, value = '', options: ScalarOptions = {}): ScalarField => ({
    kind,
    label,
    default: value,
    ...options,
  });

/**
 * Choix fermé : `select('Prof', [{ value: 'edwige', label: 'Edwige' }, …])`
 * ou `select('Lieu', ['sol', 'airs'])`. Valeur d'origine : la première option
 * si elle n'est pas donnée.
 */
export function select(
  label: string,
  options: (string | { value: string; label: string })[],
  value?: string,
  extra: BaseOptions = {},
): SelectField {
  const normalized = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );
  return {
    kind: 'select',
    label,
    options: normalized,
    default: value ?? normalized[0]?.value ?? '',
    ...extra,
  };
}

/** Préfixe des images du projet, résolues au build par `astro:assets`. */
export const ASSET_PREFIX = 'asset:';

/**
 * Image du projet comme valeur d'origine : chemin depuis `src/`
 * (`asset('assets/photos/grange.jpg', 'La grange')`). Elle est optimisée au
 * build ; une photo envoyée dans l'admin la remplace.
 */
export const asset = (path: string, alt: string): ImageValue => ({
  src: `${ASSET_PREFIX}${path.replace(/^\.?\/?(src\/)?/, '')}`,
  alt,
});

export const isAssetSrc = (src: string) => src.startsWith(ASSET_PREFIX);

export const text = scalar('text');
export const textarea = scalar('textarea');
export const url = scalar('url');
export const email = scalar('email');
/** Date au format `AAAA-MM-JJ`. */
export const date = scalar('date');

export const richtext = (
  label: string,
  value = '',
  options: BaseOptions = {},
): RichTextField => ({ kind: 'richtext', label, default: value, ...options });

/**
 * Image. Seule une image `optional: true` peut être vide (`ImageValue |
 * null` dans les types) : une image obligatoire déclarée sans valeur
 * d'origine (`image('Photo')`, typique d'un champ de liste ou de collection)
 * est garantie par la validation.
 */
export function image<
  const V extends ImageValue | null = null,
  const O extends BaseOptions = BaseOptions,
>(
  label: string,
  value: V = null as V,
  options?: O,
): ImageField<O extends { optional: true } ? ImageValue | null : ImageValue> {
  return { kind: 'image', label, default: value as never, ...options };
}

export function list<const I extends Record<string, ItemField>>(
  label: string,
  config: {
    itemLabel: string;
    itemTitle: keyof I & string;
    fields: I;
    help?: string;
    min?: number;
    max?: number;
  },
  value: ItemValues<I>[] = [],
): ListField<I> {
  return { kind: 'list', label, default: value, ...config };
}

// ── Validation ───────────────────────────────────────────────────────────────

const isUrl = (value: string) => {
  if (value.startsWith('/') || value.startsWith('#')) return true;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const isDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

/** Médias envoyés dans l'admin : `/media/<uuid>/<largeur>.<webp|jpg>`. */
export const MEDIA_SRC =
  /^\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(\d{2,4})\.(webp|jpg)$/;

export const mediaId = (src: string) => MEDIA_SRC.exec(src)?.[1] ?? null;

/** Image du projet, image de `public/` ou média envoyé dans l'admin. */
const isImageSrc = (value: string) =>
  MEDIA_SRC.test(value) ||
  (isAssetSrc(value) &&
    /^asset:[^/\\][^\\]*$/.test(value) &&
    !value.includes('..')) ||
  (value.startsWith('/') && !value.startsWith('//') && !value.includes('..'));

const isPositiveInt = (value: unknown) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= 10000;

function checkImage(
  field: ImageField,
  value: unknown,
  options: ValidateOptions = {},
): string | null {
  if (value === null || value === undefined) {
    return field.optional ? null : 'est obligatoire';
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'doit être une image';
  }
  const image = value as Partial<ImageValue>;
  if (typeof image.src !== 'string' || !isImageSrc(image.src)) {
    return 'a une adresse d’image invalide';
  }
  if (
    isAssetSrc(image.src) &&
    options.assets &&
    !options.assets.has(image.src)
  ) {
    return 'désigne une image du site inconnue';
  }
  if (typeof image.alt !== 'string' || !image.alt.trim()) {
    return 'doit avoir une description (texte alternatif)';
  }
  if (image.alt.length > 300) return 'a une description trop longue';
  if (image.width !== undefined && !isPositiveInt(image.width)) {
    return 'a une largeur invalide';
  }
  if (image.height !== undefined && !isPositiveInt(image.height)) {
    return 'a une hauteur invalide';
  }
  if (image.srcset !== undefined) {
    const id = mediaId(image.src);
    const valid =
      Array.isArray(image.srcset) &&
      image.srcset.length <= 6 &&
      id !== null &&
      image.srcset.every(
        (variant) =>
          typeof variant?.src === 'string' &&
          mediaId(variant.src) === id &&
          isPositiveInt(variant.width),
      );
    if (!valid) return 'a des variantes invalides';
  }
  return null;
}

function checkScalar(field: ScalarField, value: unknown): string | null {
  if (typeof value !== 'string') return 'doit être un texte';
  const trimmed = value.trim();
  if (!trimmed && !field.optional) return 'ne peut pas être vide';
  if (field.max && value.length > field.max) {
    return `dépasse ${field.max} caractères`;
  }
  if (trimmed && field.kind === 'url' && !isUrl(trimmed)) {
    return 'doit être un lien valide (https://…)';
  }
  if (trimmed && field.kind === 'email' && !isEmail(trimmed)) {
    return 'doit être une adresse email valide';
  }
  if (trimmed && field.kind === 'date' && !isDate(trimmed)) {
    return 'doit être une date valide';
  }
  return null;
}

const RICH_TEXT_MAX = 200_000;

function checkRichText(field: RichTextField, value: unknown): string | null {
  if (typeof value !== 'string') return 'doit être un texte';
  if (!field.optional && isEmptyValue(field, value)) {
    return 'ne peut pas être vide';
  }
  return value.length > RICH_TEXT_MAX ? 'est trop long' : null;
}

function checkSelect(field: SelectField, value: unknown): string | null {
  if (typeof value !== 'string') return 'doit être un choix';
  if (!value) return field.optional ? null : 'doit être choisi';
  return field.options.some((option) => option.value === value)
    ? null
    : 'n’est pas un choix possible';
}

function checkItem(field: ItemField, value: unknown, options: ValidateOptions) {
  if (field.kind === 'image') return checkImage(field, value, options);
  if (field.kind === 'richtext') return checkRichText(field, value);
  if (field.kind === 'select') return checkSelect(field, value);
  return checkScalar(field, value);
}

export interface ValidateOptions {
  /** Brouillon : les champs obligatoires peuvent rester vides. */
  draft?: boolean;
  /**
   * Images du projet autorisées (`asset:…` cités dans la config). Sans cette
   * liste, tout chemin `asset:` bien formé est accepté.
   */
  assets?: ReadonlySet<string>;
}

/** Valeur vide (champ non rempli). */
export function isEmptyValue(field: Field, value: unknown): boolean {
  if (field.kind === 'list') return Array.isArray(value) && !value.length;
  if (field.kind === 'image') return value === null || value === undefined;
  if (field.kind === 'richtext') {
    return (
      typeof value === 'string' &&
      !value
        .replace(/<(?!img)[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim()
    );
  }
  return typeof value === 'string' && !value.trim();
}

/**
 * Vérifie qu'une valeur respecte la définition du champ.
 * Retourne un message d'erreur en français, ou `null` si tout va bien.
 */
export function validateValue(
  field: Field,
  value: unknown,
  options: ValidateOptions = {},
): string | null {
  if (options.draft && isEmptyValue(field, value)) return null;
  if (field.kind === 'image') return checkImage(field, value, options);
  if (field.kind === 'richtext') return checkRichText(field, value);
  if (field.kind === 'select') return checkSelect(field, value);
  if (field.kind !== 'list') return checkScalar(field, value);
  if (!Array.isArray(value)) return 'doit être une liste';
  if (field.min !== undefined && value.length < field.min) {
    return `doit contenir au moins ${field.min} élément(s)`;
  }
  if (field.max !== undefined && value.length > field.max) {
    return `ne peut pas contenir plus de ${field.max} éléments`;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return `élément ${index + 1} invalide`;
    }
    for (const [subId, subField] of Object.entries(field.fields)) {
      const raw = (item as Record<string, unknown>)[subId];
      const missing = raw === undefined || raw === null;
      if (options.draft && missing) continue;
      const error = checkItem(
        subField,
        missing ? (subField.kind === 'image' ? null : '') : raw,
        options,
      );
      if (error) return `élément ${index + 1}, « ${subField.label} » ${error}`;
    }
  }
  return null;
}

function normalizeImage(value: unknown): ImageValue | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const image: ImageValue = {
    src: typeof raw.src === 'string' ? raw.src.trim() : '',
    alt: typeof raw.alt === 'string' ? raw.alt.trim() : '',
  };
  if (typeof raw.width === 'number') image.width = raw.width;
  if (typeof raw.height === 'number') image.height = raw.height;
  if (Array.isArray(raw.srcset)) {
    image.srcset = raw.srcset.map((variant) => ({
      src: typeof variant?.src === 'string' ? variant.src : '',
      width: typeof variant?.width === 'number' ? variant.width : 0,
    }));
  }
  return image.src ? image : null;
}

function normalizeItem(field: ItemField, value: unknown) {
  if (field.kind === 'image') return normalizeImage(value);
  return typeof value === 'string' ? value : '';
}

/** Ne garde que la forme attendue par le champ, pour un stockage propre. */
export function normalizeValue(field: Field, value: unknown): StoredValue {
  if (field.kind === 'image') return normalizeImage(value);
  if (field.kind !== 'list') return typeof value === 'string' ? value : '';
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const clean: Record<string, unknown> = {};
    for (const [subId, subField] of Object.entries(field.fields)) {
      clean[subId] = normalizeItem(
        subField,
        (item as Record<string, unknown>)?.[subId],
      );
    }
    return clean;
  }) as StoredValue;
}

export const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Identifiants des médias (`/media/<id>/…`) cités dans une valeur quelconque. */
export function referencedMedia(serialized: string): string[] {
  const ids = serialized.matchAll(
    /\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//g,
  );
  return [...new Set([...ids].map((match) => match[1]))];
}

/** Toutes les images du projet (`asset:…`) citées dans une valeur quelconque. */
export function collectAssets(value: unknown, found = new Set<string>()) {
  if (typeof value === 'string') {
    if (isAssetSrc(value)) found.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectAssets(item, found);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAssets(item, found);
  }
  return found;
}
