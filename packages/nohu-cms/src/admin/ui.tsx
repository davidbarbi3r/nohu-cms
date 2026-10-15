/** Briques d'interface partagées de l'admin : notifications, confirmation, champs. */
import { createContext, type ComponentChildren } from 'preact';
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'preact/hooks';

/* ---------- Notifications ---------- */

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(
  () => undefined,
);

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      tone === 'error' ? 9000 : 5000,
    );
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div class="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} class={`toast toast--${toast.tone}`}>
            <span aria-hidden="true">
              {toast.tone === 'success'
                ? '✓'
                : toast.tone === 'error'
                  ? '!'
                  : 'i'}
            </span>
            <p>{toast.message}</p>
            <button
              type="button"
              aria-label="Fermer la notification"
              onClick={() =>
                setToasts((current) =>
                  current.filter((item) => item.id !== toast.id),
                )
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ---------- Confirmation ---------- */

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<
  (options: ConfirmOptions) => Promise<boolean>
>(async () => false);

export function ConfirmProvider({ children }: { children: ComponentChildren }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(value: boolean) => void>();
  const dialog = useRef<HTMLDialogElement>(null);

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOptions(next);
      }),
    [],
  );

  useEffect(() => {
    if (options && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
    }
  }, [options]);

  const close = (value: boolean) => {
    dialog.current?.close();
    setOptions(null);
    resolver.current?.(value);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialog}
        class="confirm"
        aria-labelledby="confirm-title"
        onCancel={(event) => {
          event.preventDefault();
          close(false);
        }}
      >
        {options && (
          <div>
            <h2 id="confirm-title">{options.title}</h2>
            <p>{options.message}</p>
            <div class="confirm__actions">
              <button
                type="button"
                class="btn btn--ghost"
                onClick={() => close(false)}
              >
                {options.cancelLabel ?? 'Annuler'}
              </button>
              <button
                type="button"
                class={`btn ${options.danger ? 'btn--danger' : 'btn--primary'}`}
                onClick={() => close(true)}
              >
                {options.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

/* ---------- Champs ---------- */

let uid = 0;
export const useId = (prefix: string) => {
  const id = useRef(`${prefix}-${++uid}`);
  return id.current;
};

/** Zone de texte qui grandit avec son contenu. */
export function AutoTextarea(props: {
  id: string;
  value: string;
  onInput: (value: string) => void;
  minRows?: number;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      id={props.id}
      rows={props.minRows ?? 3}
      value={props.value}
      placeholder={props.placeholder}
      aria-invalid={props.invalid || undefined}
      aria-describedby={props.describedBy}
      onInput={(event) => props.onInput(event.currentTarget.value)}
    />
  );
}

export function FieldShell(props: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  optional?: boolean;
  modified?: boolean;
  counter?: { length: number; max: number };
  onReset?: () => void;
  children: ComponentChildren;
}) {
  const over = props.counter && props.counter.length > props.counter.max;
  return (
    <div class={`field${props.error ? ' field--error' : ''}`}>
      <div class="field__head">
        <label for={props.id}>
          {props.label}
          {props.optional && <span class="field__optional"> (facultatif)</span>}
        </label>
        {props.modified && props.onReset && (
          <button type="button" class="link-button" onClick={props.onReset}>
            Rétablir le texte d’origine
          </button>
        )}
      </div>
      {props.children}
      <div class="field__foot">
        {props.error ? (
          <p class="field__error" id={`${props.id}-error`}>
            {props.error}
          </p>
        ) : props.help ? (
          <p class="field__help" id={`${props.id}-help`}>
            {props.help}
          </p>
        ) : (
          <span />
        )}
        {props.counter && (
          <span class={`field__counter${over ? ' is-over' : ''}`}>
            {props.counter.length} / {props.counter.max}
          </span>
        )}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div class="spinner" role="status">
      <span aria-hidden="true" />
      {label}
    </div>
  );
}

export const formatDateTime = (iso: string) =>
  iso
    ? new Intl.DateTimeFormat('fr-FR', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso))
    : '';
