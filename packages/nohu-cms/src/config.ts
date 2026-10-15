/**
 * Structure d'un site : pages → sections → champs, et collections (articles,
 * événements…). La config est un objet sérialisable : elle est transmise
 * telle quelle à l'admin et relue par le Worker pour valider les écritures.
 */
import {
  collectAssets,
  isDate,
  isEmptyValue,
  normalizeValue,
  validateValue,
  type Field,
  type FieldValue,
  type StoredValue,
} from './fields';

export interface SectionDef<
  F extends Record<string, Field> = Record<string, Field>,
> {
  label: string;
  help?: string;
  fields: F;
}

export interface PageDef<
  S extends Record<string, SectionDef> = Record<string, SectionDef>,
> {
  label: string;
  /** Chemin public de la page, `null` pour les éléments communs à tout le site. */
  path: string | null;
  help?: string;
  sections: S;
}

export type EntrySort = 'date-desc' | 'date-asc' | 'title';

export interface CollectionDef<
  F extends Record<string, Field> = Record<string, Field>,
> {
  label: string;
  /** Nom d'une entrée, au singulier (« un article »). */
  itemLabel: string;
  /** Adresse d'une entrée sur le site, avec `[slug]` : `/blog/[slug]`. */
  path: string;
  help?: string;
  /** Ordre des entrées : par date de publication (défaut, récentes d'abord) ou titre. */
  sort?: EntrySort;
  fields: F;
}

export interface AdminOptions {
  /** Nom affiché en haut de l'admin (souvent le nom du site). */
  title: string;
  /** Couleur principale de l'admin (`#rrggbb`). */
  brandColor?: string;
  /** Logo affiché dans l'admin : chemin dans `public/`. */
  logo?: string;
}

export interface CmsConfig<
  P extends Record<string, PageDef> = Record<string, PageDef>,
  C extends Record<string, CollectionDef> = Record<string, CollectionDef>,
> {
  admin: AdminOptions;
  pages: P;
  collections?: C;
}

export type SectionValues<S extends SectionDef> = {
  [K in keyof S['fields']]: FieldValue<S['fields'][K]>;
};

export type PageValues<P extends PageDef> = {
  [K in keyof P['sections']]: SectionValues<P['sections'][K]>;
};

/** Tous les textes du site, typés depuis la config. */
export type Content<C extends CmsConfig> = {
  [K in keyof C['pages']]: PageValues<C['pages'][K]>;
};

export type EntryStatus = 'draft' | 'published';

export type EntryData<D extends CollectionDef> = {
  [K in keyof D['fields']]: FieldValue<D['fields'][K]>;
};

/** Ce que l'admin envoie pour créer ou modifier une entrée. */
export interface EntryInput<D extends CollectionDef = CollectionDef> {
  title: string;
  slug: string;
  status: EntryStatus;
  /** Date de publication `AAAA-MM-JJ` (aujourd'hui si vide au moment de publier). */
  publishedAt: string;
  data: EntryData<D>;
}

export interface Entry<
  D extends CollectionDef = CollectionDef,
> extends EntryInput<D> {
  id: string;
  collection: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export type CollectionName<C extends CmsConfig> = keyof NonNullable<
  C['collections']
> &
  string;

export type CollectionOf<
  C extends CmsConfig,
  N extends CollectionName<C>,
> = NonNullable<C['collections']>[N];

// ── Déclaration ──────────────────────────────────────────────────────────────

export function section<const F extends Record<string, Field>>(
  label: string,
  fields: F,
  help?: string,
): SectionDef<F> {
  return help ? { label, help, fields } : { label, fields };
}

export function page<const S extends Record<string, SectionDef>>(
  label: string,
  path: string | null,
  sections: S,
  help?: string,
): PageDef<S> {
  return help ? { label, path, help, sections } : { label, path, sections };
}

export function collection<const F extends Record<string, Field>>(
  label: string,
  options: Omit<CollectionDef<F>, 'label'>,
): CollectionDef<F> {
  return { label, ...options };
}

/** Point d'entrée de `cms.config.ts`. Vérifie la config dès son chargement. */
export function defineCms<const C extends CmsConfig>(config: C): C {
  const problems = checkConfig(config);
  if (problems.length) {
    throw new Error(
      `[nohu-cms] cms.config.ts invalide :\n- ${problems.join('\n- ')}`,
    );
  }
  return config;
}

// ── Parcours ─────────────────────────────────────────────────────────────────

const assetsCache = new WeakMap<CmsConfig, ReadonlySet<string>>();

/**
 * Images du projet (`asset:…`) citées dans la config : les seules qu'une
 * valeur enregistrée peut désigner (ex. après réordonnancement d'une liste).
 */
export function knownAssets(config: CmsConfig): ReadonlySet<string> {
  let assets = assetsCache.get(config);
  if (!assets) {
    assets = collectAssets(config);
    assetsCache.set(config, assets);
  }
  return assets;
}

/** Clé de stockage d'un champ de page : `page.section.champ`. */
export const fieldKey = (pageId: string, sectionId: string, fieldId: string) =>
  `${pageId}.${sectionId}.${fieldId}`;

export interface FieldRef {
  key: string;
  pageId: string;
  sectionId: string;
  fieldId: string;
  field: Field;
}

export function listFields(
  pages: Record<string, PageDef>,
  onlyPage?: string,
): FieldRef[] {
  const refs: FieldRef[] = [];
  for (const [pageId, pageDef] of Object.entries(pages)) {
    if (onlyPage && pageId !== onlyPage) continue;
    for (const [sectionId, sectionDef] of Object.entries(pageDef.sections)) {
      for (const [fieldId, field] of Object.entries(sectionDef.fields)) {
        refs.push({
          key: fieldKey(pageId, sectionId, fieldId),
          pageId,
          sectionId,
          fieldId,
          field,
        });
      }
    }
  }
  return refs;
}

/** Adresse publique d'une entrée : `/blog/[slug]` → `/blog/mon-article`. */
export const entryPath = (definition: CollectionDef, slug: string) =>
  definition.path.replace('[slug]', slug);

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

// ── Vérification de la config ────────────────────────────────────────────────

const ID = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const RESERVED_ENTRY_FIELDS = ['title', 'slug', 'status', 'publishedAt'];

function checkFields(
  where: string,
  fields: Record<string, Field>,
  problems: string[],
  { checkDefaults }: { checkDefaults: boolean },
) {
  for (const [fieldId, field] of Object.entries(fields)) {
    const at = `${where}.${fieldId}`;
    if (!ID.test(fieldId)) problems.push(`${at} : identifiant invalide`);
    if (!field.label?.trim()) problems.push(`${at} : libellé manquant`);
    if (field.kind === 'list') {
      if (!(field.itemTitle in field.fields)) {
        problems.push(`${at} : itemTitle « ${field.itemTitle} » inconnu`);
      }
      for (const [subId, subField] of Object.entries(field.fields)) {
        if (!ID.test(subId)) {
          problems.push(`${at}.${subId} : identifiant invalide`);
        }
        if ((subField.kind as string) === 'list') {
          problems.push(`${at}.${subId} : pas de liste dans une liste`);
        }
      }
      for (const [index, item] of field.default.entries()) {
        const keys = Object.keys(item).sort().join(',');
        const expected = Object.keys(field.fields).sort().join(',');
        if (keys !== expected) {
          problems.push(
            `${at} : l'élément ${index + 1} doit avoir exactement les sous-champs ${expected}`,
          );
        }
      }
    }
    if (checkDefaults) {
      const error = validateValue(field, normalizeValue(field, field.default));
      if (error) problems.push(`${at} : valeur d'origine invalide (${error})`);
    }
  }
}

/** Liste les problèmes de la config (vide si tout va bien). */
export function checkConfig(config: CmsConfig): string[] {
  const problems: string[] = [];
  if (!config.admin?.title?.trim()) problems.push('admin.title manquant');
  if (config.admin?.brandColor && !COLOR.test(config.admin.brandColor)) {
    problems.push('admin.brandColor doit être au format #rrggbb');
  }
  const paths = new Set<string>();
  for (const [pageId, pageDef] of Object.entries(config.pages ?? {})) {
    if (!ID.test(pageId))
      problems.push(`pages.${pageId} : identifiant invalide`);
    if (pageDef.path !== null) {
      if (!pageDef.path.startsWith('/')) {
        problems.push(`pages.${pageId} : le chemin doit commencer par /`);
      }
      if (paths.has(pageDef.path)) {
        problems.push(`pages.${pageId} : chemin ${pageDef.path} en double`);
      }
      paths.add(pageDef.path);
    }
    for (const [sectionId, sectionDef] of Object.entries(pageDef.sections)) {
      if (!ID.test(sectionId)) {
        problems.push(`pages.${pageId}.${sectionId} : identifiant invalide`);
      }
      checkFields(`${pageId}.${sectionId}`, sectionDef.fields, problems, {
        checkDefaults: true,
      });
    }
  }
  for (const [name, definition] of Object.entries(config.collections ?? {})) {
    const at = `collections.${name}`;
    if (!ID.test(name)) problems.push(`${at} : identifiant invalide`);
    if (!definition.path?.includes('[slug]')) {
      problems.push(`${at} : path doit contenir [slug] (ex. /blog/[slug])`);
    }
    for (const reserved of RESERVED_ENTRY_FIELDS) {
      if (reserved in definition.fields) {
        problems.push(`${at}.${reserved} : nom réservé (champ intégré)`);
      }
    }
    checkFields(at, definition.fields, problems, { checkDefaults: false });
  }
  return problems;
}

// ── Entrées de collection ────────────────────────────────────────────────────

export type EntryErrors = Record<string, string>;

/** Valeurs vierges d'une nouvelle entrée. */
export function emptyEntry<D extends CollectionDef>(
  definition: D,
): EntryInput<D> {
  return {
    title: '',
    slug: '',
    status: 'draft',
    publishedAt: '',
    data: Object.fromEntries(
      Object.entries(definition.fields).map(([id, field]) => [
        id,
        field.default,
      ]),
    ) as EntryData<D>,
  };
}

/** Garde uniquement les champs connus, sous leur forme attendue. */
export function cleanEntryInput(
  definition: CollectionDef,
  raw: unknown,
): EntryInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const rawData =
    typeof source.data === 'object' && source.data !== null
      ? (source.data as Record<string, unknown>)
      : {};
  const asText = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';
  const title = asText(source.title);
  return {
    title,
    slug: slugify(asText(source.slug) || title),
    status: source.status === 'published' ? 'published' : 'draft',
    publishedAt: asText(source.publishedAt),
    data: Object.fromEntries(
      Object.entries(definition.fields).map(([id, field]) => [
        id,
        normalizeValue(field, rawData[id] ?? field.default),
      ]),
    ) as Record<string, StoredValue>,
  };
}

/**
 * Règles d'une entrée. Un brouillon peut être incomplet ; une entrée publiée
 * doit avoir tous ses champs obligatoires. Clés d'erreur : `title`, `slug`,
 * `publishedAt`, `data.<champ>`.
 */
export function validateEntry(
  definition: CollectionDef,
  input: EntryInput,
  assets?: ReadonlySet<string>,
): EntryErrors {
  const errors: EntryErrors = {};
  const draft = input.status !== 'published';

  if (!input.title.trim()) errors.title = 'Le titre est obligatoire.';
  else if (input.title.length > 160) errors.title = '160 caractères maximum.';

  if (!input.slug || slugify(input.slug) !== input.slug) {
    errors.slug =
      'Adresse invalide : lettres minuscules, chiffres et tirets uniquement.';
  }
  if (input.publishedAt && !isDate(input.publishedAt)) {
    errors.publishedAt = 'Date invalide.';
  }

  for (const [id, field] of Object.entries(definition.fields)) {
    const value = (input.data as Record<string, unknown>)[id];
    const error = validateValue(field, value, { draft, assets });
    if (error) {
      errors[`data.${id}`] =
        !draft && isEmptyValue(field, value)
          ? `« ${field.label} » est obligatoire pour publier.`
          : `« ${field.label} » ${error}.`;
    }
  }
  return errors;
}

/** Ligne brute de la table D1 `cms_entries`. */
export interface EntryRow {
  id: string;
  collection: string;
  slug: string;
  status: string;
  title: string;
  published_at: string;
  data: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

/** Ligne D1 → entrée ; `data` n'est pas encore confrontée à la config. */
export function entryFromRow(row: EntryRow): Entry {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.data || '{}');
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch {
    // Données illisibles : les valeurs d'origine prendront le relais.
  }
  return {
    id: String(row.id),
    collection: String(row.collection),
    slug: String(row.slug),
    status: row.status === 'published' ? 'published' : 'draft',
    title: String(row.title),
    publishedAt: String(row.published_at ?? ''),
    data: data as Entry['data'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    updatedBy: String(row.updated_by),
  };
}

/** Tri des entrées selon la collection (récentes d'abord par défaut). */
export function sortEntries<E extends Pick<Entry, 'title' | 'publishedAt'>>(
  entries: E[],
  sort: EntrySort = 'date-desc',
): E[] {
  const byTitle = (a: E, b: E) => a.title.localeCompare(b.title, 'fr');
  return [...entries].sort((a, b) => {
    if (sort === 'title') return byTitle(a, b);
    const order =
      sort === 'date-asc'
        ? a.publishedAt.localeCompare(b.publishedAt)
        : b.publishedAt.localeCompare(a.publishedAt);
    return order || byTitle(a, b);
  });
}
