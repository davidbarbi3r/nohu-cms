/**
 * Éditeur de texte mis en forme (TipTap) : titres, gras, italique, listes,
 * citation, liens, images. Produit du HTML, nettoyé à nouveau au moment du
 * build (seules les images envoyées dans l'admin passent).
 *
 * `value` n'est lu qu'au montage : l'éditeur est la source de vérité pendant
 * la saisie (réinjecter la valeur du parent, toujours en retard d'une frappe,
 * effacerait des caractères). Pour remplacer le contenu, change la `key`.
 */
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiError } from './api';
import { ACCEPTED_IMAGES, inlineVariant, uploadImage } from './image';

interface Props {
  id: string;
  value: string;
  onChange: (html: string) => void;
  labelledBy: string;
  placeholder?: string;
}

const isEmptyHtml = (html: string) => html === '<p></p>' || html === '';

export function RichTextEditor({
  id,
  value,
  onChange,
  labelledBy,
  placeholder,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  const [, setTick] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [imageProblem, setImageProblem] = useState('');
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [imageAlt, setImageAlt] = useState('');
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const editor = new Editor({
      element: host.current,
      extensions: [
        StarterKit.configure({
          heading: { levels: [2, 3] },
          code: false,
          codeBlock: false,
          horizontalRule: false,
          link: {
            openOnClick: false,
            autolink: true,
            defaultProtocol: 'https',
            HTMLAttributes: { rel: null, target: null },
          },
        }),
        Image.configure({ inline: false }),
      ],
      content: value || '',
      editorProps: {
        attributes: {
          id,
          class: 'rte__content prose',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-labelledby': labelledBy,
          ...(placeholder ? { 'data-placeholder': placeholder } : {}),
        },
      },
      onUpdate: ({ editor: current }) => {
        const html = current.getHTML();
        onChangeRef.current(isEmptyHtml(html) ? '' : html);
      },
      onTransaction: () => setTick((tick) => tick + 1),
    });
    editorRef.current = editor;
    return () => editor.destroy();
  }, []);

  const editor = editorRef.current;
  const isEmpty = !value;

  const button = (
    label: string,
    title: string,
    active: boolean,
    run: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      class={`rte__button${active ? ' is-active' : ''}`}
      aria-pressed={active}
      title={title}
      aria-label={title}
      disabled={!editor || disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );

  const chain = () => editor!.chain().focus();

  const openLink = () => {
    setLinkValue(editor?.getAttributes('link').href ?? '');
    setLinkOpen(true);
  };

  const applyLink = () => {
    const href = linkValue.trim();
    if (!href) chain().extendMarkRange('link').unsetLink().run();
    else {
      const normalized = /^(https?:|mailto:|tel:|\/)/.test(href)
        ? href
        : `https://${href}`;
      chain().extendMarkRange('link').setLink({ href: normalized }).run();
    }
    setLinkOpen(false);
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setImageProblem('');
    if (file.type && !ACCEPTED_IMAGES.includes(file.type)) {
      setImageProblem('Ce fichier n’est pas une photo (JPEG, PNG ou WebP).');
      return;
    }
    setUploading(true);
    try {
      const upload = await uploadImage(file);
      setPendingImage(inlineVariant(upload).src);
      setImageAlt('');
    } catch (caught) {
      setImageProblem(
        caught instanceof ApiError
          ? caught.message
          : 'Cette photo n’a pas pu être lue. Essaie avec une photo JPEG ou PNG.',
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const insertImage = () => {
    if (!pendingImage || !imageAlt.trim()) return;
    chain().setImage({ src: pendingImage, alt: imageAlt.trim() }).run();
    setPendingImage(null);
  };

  const blockValue = editor?.isActive('heading', { level: 2 })
    ? 'h2'
    : editor?.isActive('heading', { level: 3 })
      ? 'h3'
      : 'p';

  return (
    <div class={`rte${isEmpty ? ' is-empty' : ''}`}>
      <div class="rte__toolbar" role="toolbar" aria-label="Mise en forme">
        <select
          class="rte__select"
          aria-label="Style du paragraphe"
          value={blockValue}
          disabled={!editor}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === 'p') chain().setParagraph().run();
            else
              chain()
                .setHeading({ level: next === 'h2' ? 2 : 3 })
                .run();
          }}
        >
          <option value="p">Texte normal</option>
          <option value="h2">Titre</option>
          <option value="h3">Sous-titre</option>
        </select>
        <span class="rte__sep" aria-hidden="true" />
        {button('G', 'Gras (Ctrl+B)', Boolean(editor?.isActive('bold')), () =>
          chain().toggleBold().run(),
        )}
        {button(
          'I',
          'Italique (Ctrl+I)',
          Boolean(editor?.isActive('italic')),
          () => chain().toggleItalic().run(),
        )}
        {button(
          'S',
          'Souligné (Ctrl+U)',
          Boolean(editor?.isActive('underline')),
          () => chain().toggleUnderline().run(),
        )}
        <span class="rte__sep" aria-hidden="true" />
        {button(
          '•',
          'Liste à puces',
          Boolean(editor?.isActive('bulletList')),
          () => chain().toggleBulletList().run(),
        )}
        {button(
          '1.',
          'Liste numérotée',
          Boolean(editor?.isActive('orderedList')),
          () => chain().toggleOrderedList().run(),
        )}
        {button('❝', 'Citation', Boolean(editor?.isActive('blockquote')), () =>
          chain().toggleBlockquote().run(),
        )}
        {button('🔗', 'Lien', Boolean(editor?.isActive('link')), openLink)}
        {button(
          uploading ? '…' : '🖼',
          uploading ? 'Envoi de la photo…' : 'Insérer une photo',
          false,
          () => fileInput.current?.click(),
          uploading,
        )}
        <span class="rte__sep" aria-hidden="true" />
        {button(
          '↶',
          'Annuler (Ctrl+Z)',
          false,
          () => chain().undo().run(),
          !editor?.can().undo(),
        )}
        {button(
          '↷',
          'Rétablir (Ctrl+Maj+Z)',
          false,
          () => chain().redo().run(),
          !editor?.can().redo(),
        )}
      </div>

      {linkOpen && (
        <div class="rte__link">
          <label for={`${id}-link`}>Adresse du lien</label>
          <input
            id={`${id}-link`}
            type="url"
            value={linkValue}
            placeholder="https://…"
            autoFocus
            onInput={(event) => setLinkValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') setLinkOpen(false);
            }}
          />
          <button
            type="button"
            class="btn btn--primary btn--small"
            onClick={applyLink}
          >
            {linkValue.trim() ? 'Appliquer' : 'Retirer le lien'}
          </button>
          <button
            type="button"
            class="btn btn--ghost btn--small"
            onClick={() => setLinkOpen(false)}
          >
            Fermer
          </button>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_IMAGES.join(',')}
        class="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => pickImage(event.currentTarget.files?.[0])}
      />
      {imageProblem && <p class="field__error">{imageProblem}</p>}
      {pendingImage && (
        <div class="rte__link">
          <img src={pendingImage} alt="" class="rte__thumb" />
          <label for={`${id}-alt`}>Description de la photo</label>
          <input
            id={`${id}-alt`}
            type="text"
            value={imageAlt}
            placeholder="Ex. Deux personnes en tenue de yoga"
            autoFocus
            onInput={(event) => setImageAlt(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                insertImage();
              }
              if (event.key === 'Escape') setPendingImage(null);
            }}
          />
          <button
            type="button"
            class="btn btn--primary btn--small"
            disabled={!imageAlt.trim()}
            onClick={insertImage}
          >
            Insérer
          </button>
          <button
            type="button"
            class="btn btn--ghost btn--small"
            onClick={() => setPendingImage(null)}
          >
            Annuler
          </button>
        </div>
      )}

      <div ref={host} class="rte__host" />
    </div>
  );
}
