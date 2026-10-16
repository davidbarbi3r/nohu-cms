/** Application d'administration : navigation, chargement initial, état de publication. */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { CmsConfig } from '../config';
import type { StoredValue } from '../fields';
import type { PublishStatus } from '../protocol';
import { publishBadge } from './publish-badge';
import { api, ApiError } from './api';
import { ConfigContext, PreviewContext, useConfig } from './context';
import { EntryEditor, EntryList } from './Entries';
import { PageEditor } from './PageEditor';
import {
  ConfirmProvider,
  Spinner,
  ToastProvider,
  useConfirm,
  useToast,
} from './ui';

type Route =
  | { name: 'entries'; collection: string }
  | { name: 'entry'; collection: string; id: string | null }
  | { name: 'page'; pageId: string };

/** Adresse (`#/…`) → écran. Par défaut : première collection, sinon première page. */
function parseRoute(config: CmsConfig, hash: string): Route {
  const path = hash.replace(/^#/, '');
  const collections = Object.keys(config.collections ?? {});
  const pages = Object.keys(config.pages);
  const entry = path.match(/^\/collections\/([^/]+)\/(.+)$/);
  if (entry && collections.includes(entry[1])) {
    return {
      name: 'entry',
      collection: entry[1],
      id: entry[2] === 'nouveau' ? null : entry[2],
    };
  }
  const list = path.match(/^\/collections\/([^/]+)$/);
  if (list && collections.includes(list[1])) {
    return { name: 'entries', collection: list[1] };
  }
  const page = path.match(/^\/pages\/(.+)$/);
  if (page && pages.includes(page[1])) {
    return { name: 'page', pageId: page[1] };
  }
  return collections.length
    ? { name: 'entries', collection: collections[0] }
    : { name: 'page', pageId: pages[0] };
}

export default function App({
  config,
  previews = {},
}: {
  config: CmsConfig;
  previews?: Record<string, string>;
}) {
  return (
    <ConfigContext.Provider value={config}>
      <PreviewContext.Provider value={previews}>
        <ToastProvider>
          <ConfirmProvider>
            <AdminShell />
          </ConfirmProvider>
        </ToastProvider>
      </PreviewContext.Provider>
    </ConfigContext.Provider>
  );
}

function AdminShell() {
  const config = useConfig();
  const collections = Object.entries(config.collections ?? {});
  const pageIds = Object.keys(config.pages);
  const toast = useToast();
  const confirm = useConfirm();
  const [email, setEmail] = useState('');
  const [fatal, setFatal] = useState<ApiError | null>(null);
  const [overrides, setOverrides] = useState<Record<
    string,
    StoredValue
  > | null>(null);
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(config, location.hash),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const dirty = useRef(false);
  const currentHash = useRef(location.hash);

  useEffect(() => {
    Promise.all([api.me(), api.content()])
      .then(([me, content]) => {
        setEmail(me.email);
        setOverrides(content.values);
      })
      .catch((error: ApiError) => setFatal(error));
  }, []);

  const askToLeave = useCallback(
    () =>
      dirty.current
        ? confirm({
            title: 'Quitter sans enregistrer ?',
            message:
              'Tes dernières modifications n’ont pas été enregistrées et seront perdues.',
            confirmLabel: 'Quitter sans enregistrer',
            cancelLabel: 'Rester sur la page',
            danger: true,
          })
        : Promise.resolve(true),
    [confirm],
  );

  /** Change à chaque navigation : l'éditeur affiché repart de zéro. */
  const [editorKey, setEditorKey] = useState(0);

  const navigate = useCallback(
    async (path: string, force = false) => {
      if (!force && !(await askToLeave())) return;
      dirty.current = false;
      currentHash.current = `#${path}`;
      history.pushState(null, '', `#${path}`);
      setRoute(parseRoute(config, `#${path}`));
      setEditorKey((key) => key + 1);
      setMenuOpen(false);
      window.scrollTo({ top: 0 });
    },
    [askToLeave],
  );

  /** Entrée tout juste créée : l'adresse change, mais l'éditeur reste en place. */
  const onEntryCreated = useCallback((collection: string, id: string) => {
    currentHash.current = `#/collections/${collection}/${id}`;
    history.replaceState(null, '', currentHash.current);
    setRoute({ name: 'entry', collection, id });
  }, []);

  useEffect(() => {
    const onPop = async () => {
      if (location.hash === currentHash.current) return;
      if (!(await askToLeave())) {
        history.pushState(null, '', currentHash.current);
        return;
      }
      dirty.current = false;
      currentHash.current = location.hash;
      setRoute(parseRoute(config, location.hash));
      setEditorKey((key) => key + 1);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [askToLeave]);

  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  const [status, setStatus] = useState<PublishStatus | null>(null);
  const refreshStatus = useCallback(() => {
    api
      .publishStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  useEffect(refreshStatus, [refreshStatus]);
  /** Une publication vient d'être demandée : on suit le build lancé. */
  const onPublished = refreshStatus;

  const republish = async () => {
    try {
      const result = await api.republish();
      toast(result.message, result.triggered ? 'success' : 'info');
      if (result.triggered) onPublished();
    } catch (error) {
      toast((error as ApiError).message, 'error');
    }
  };

  if (fatal) return <FatalScreen error={fatal} />;
  if (!overrides) {
    return (
      <div class="loading-screen">
        <Spinner label="Ouverture de l’espace admin…" />
      </div>
    );
  }

  const link = (
    path: string,
    label: string,
    active: boolean,
    extra?: string,
  ) => (
    <a
      href={`#${path}`}
      class={`nav-link${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault();
        navigate(path);
      }}
    >
      <span>{label}</span>
      {extra && <small>{extra}</small>}
    </a>
  );

  return (
    <div class="admin">
      <header class="topbar">
        <button
          type="button"
          class="topbar__menu"
          aria-expanded={menuOpen}
          aria-controls="admin-nav"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? 'Fermer' : 'Menu'}
        </button>
        <a class="topbar__brand" href="/" target="_blank" rel="noreferrer">
          {config.admin.logo && (
            <img class="brand-logo" src={config.admin.logo} alt="" />
          )}
          <span class="brand-name">{config.admin.title}</span>
          <small>Espace admin</small>
        </a>
        <PublishBadge
          status={status}
          onRepublish={republish}
          onRefresh={refreshStatus}
        />
        <div class="topbar__user">
          <span title={email}>{email}</span>
          <a href="/cdn-cgi/access/logout" class="link-button">
            Se déconnecter
          </a>
        </div>
      </header>

      <div class="layout">
        <nav
          id="admin-nav"
          class={`sidebar${menuOpen ? ' is-open' : ''}`}
          aria-label="Navigation de l’admin"
        >
          {collections.map(([name, definition]) => (
            <div key={name}>
              <p class="sidebar__title">{definition.label}</p>
              {link(
                `/collections/${name}`,
                'Tout voir',
                (route.name === 'entries' || route.name === 'entry') &&
                  route.collection === name &&
                  !(route.name === 'entry' && route.id === null),
              )}
              {link(
                `/collections/${name}/nouveau`,
                `+ Ajouter ${definition.itemLabel}`,
                route.name === 'entry' &&
                  route.collection === name &&
                  route.id === null,
              )}
            </div>
          ))}
          <p class="sidebar__title">Contenus du site</p>
          {pageIds.map((pageId) =>
            link(
              `/pages/${pageId}`,
              config.pages[pageId].label,
              route.name === 'page' && route.pageId === pageId,
              countOverrides(overrides, pageId),
            ),
          )}
          <a
            class="nav-link nav-link--external"
            href="/"
            target="_blank"
            rel="noreferrer"
          >
            <span>Voir le site ↗</span>
          </a>
        </nav>

        <main class="content" id="contenu">
          {route.name === 'entries' && (
            <EntryList
              key={route.collection}
              name={route.collection}
              navigate={navigate}
            />
          )}
          {route.name === 'entry' && (
            <EntryEditor
              key={editorKey}
              name={route.collection}
              id={route.id}
              navigate={navigate}
              onCreated={(id) => onEntryCreated(route.collection, id)}
              onDirtyChange={setDirty}
              onPublished={onPublished}
            />
          )}
          {route.name === 'page' && (
            <PageEditor
              key={route.pageId}
              pageId={route.pageId}
              overrides={overrides}
              onSaved={setOverrides}
              onDirtyChange={setDirty}
              onPublished={onPublished}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function countOverrides(
  overrides: Record<string, StoredValue>,
  pageId: string,
) {
  const count = Object.keys(overrides).filter((key) =>
    key.startsWith(`${pageId}.`),
  ).length;
  return count ? `${count} modifié${count > 1 ? 's' : ''}` : undefined;
}

/** Indique si une reconstruction a été demandée il y a moins de 3 minutes. */
/** Interrogation du Worker pendant un build en cours. */
const POLL_MS = 10_000;

/** État de la dernière mise en ligne (build Workers Builds) et « Republier ». */
function PublishBadge({
  status,
  onRepublish,
  onRefresh,
}: {
  status: PublishStatus | null;
  onRepublish: () => void;
  onRefresh: () => void;
}) {
  const badge = status ? publishBadge(status) : null;
  const poll = Boolean(badge?.poll);

  useEffect(() => {
    if (!poll) return;
    const timer = window.setInterval(onRefresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll, onRefresh]);

  if (!badge) return <div class="publish" />;
  return (
    <div
      class={`publish publish--${badge.tone}`}
      role="status"
      title={badge.help}
    >
      <span class="publish__dot" aria-hidden="true" />
      <span class="publish__label">{badge.label}</span>
      {badge.canRepublish && (
        <button
          type="button"
          class="link-button"
          onClick={onRepublish}
          title="Relance la mise en ligne du site, par exemple si une modification n’apparaît pas."
        >
          Republier
        </button>
      )}
    </div>
  );
}

function FatalScreen({ error }: { error: ApiError }) {
  const unauthorized = error.status === 401 || error.status === 403;
  return (
    <div class="fatal">
      <h1>{unauthorized ? 'Accès réservé' : 'L’admin ne répond pas'}</h1>
      <p>{error.message}</p>
      {unauthorized ? (
        <p>
          Seuls les comptes autorisés peuvent modifier le site.{' '}
          <a href="/cdn-cgi/access/logout">Se connecter avec un autre compte</a>
        </p>
      ) : (
        <button
          type="button"
          class="btn btn--primary"
          onClick={() => location.reload()}
        >
          Réessayer
        </button>
      )}
    </div>
  );
}
