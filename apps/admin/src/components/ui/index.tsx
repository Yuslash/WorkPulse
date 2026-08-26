import { forwardRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/format';

/**
 * The dashboard's primitives, in the warm cream / coral visual language:
 * pill-shaped controls, soft warm shadows instead of borders, Bricolage
 * Grotesque for headings. Every page inherits this by building on these
 * rather than styling raw elements.
 */

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg shadow-warm-md hover:brightness-105',
  secondary: 'bg-surface text-fg shadow-warm-sm hover:bg-elevated',
  ghost: 'text-muted hover:bg-elevated hover:text-fg',
  danger: 'bg-danger/10 text-danger hover:bg-danger/20',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // A loading button must not be clickable twice; disable it rather than
      // relying on the handler to be idempotent.
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-all duration-150 ease-spring active:translate-y-px',
        'disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/** A circular icon-only button — the "more" / "add" / "calendar" chip. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'sm' | 'md' | 'lg' }
>(function IconButton({ className, size = 'md', children, ...props }, ref) {
  const dims = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' }[size];

  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-surface text-fg shadow-warm-sm',
        'transition-all duration-150 ease-spring hover:-translate-y-0.5 active:translate-y-0',
        dims,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-full bg-elevated px-4 text-sm text-fg transition-all duration-150',
          'placeholder:text-muted/60 border-0 outline-none ring-0 shadow-none',
          'focus:outline-none focus:ring-0 focus:border-0 focus-visible:outline-none focus-visible:ring-0',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      />
    );
  },
);

/**
 * Kept for native `<select>` semantics where that genuinely matters (a plain
 * form field with no custom chrome needed). Everywhere a filter or a picker
 * is presented as UI chrome, use `Dropdown` instead — the OS renders a native
 * select's open menu itself, and there is no way to skin that popup to match
 * the rest of the app.
 */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'h-10 rounded-full bg-elevated px-4 text-sm font-medium text-fg transition-shadow duration-150',
          'focus:outline-none focus:ring-[3px] focus:ring-accent/20',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * A fully custom-styled dropdown: a pill trigger plus a floating panel drawn
 * in our own card/shadow language, following the same pattern as the shell's
 * "More" and profile menus. A native `<select>`'s open list is painted by the
 * OS and cannot be restyled — this is what makes a filter menu look like it
 * belongs to the same app as everything around it.
 */
export function Dropdown({
  id,
  value,
  onChange,
  options,
  ariaLabel,
  align = 'left',
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  ariaLabel: string;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="relative inline-block">
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-10 items-center gap-2 rounded-full bg-elevated px-4 text-sm font-semibold text-fg',
          'transition-shadow duration-150 focus:outline-none focus:ring-[3px] focus:ring-accent/20',
          className,
        )}
      >
        {selected?.label}
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} role="presentation" />
          <div
            role="listbox"
            aria-label={ariaLabel}
            className={cn(
              'absolute z-20 mt-2 max-h-[320px] min-w-[180px] overflow-y-auto animate-fade-in rounded-card bg-surface p-1.5 shadow-warm-md',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'block w-full rounded-full px-3.5 py-2.5 text-left text-sm font-semibold transition-colors duration-150',
                  option.value === value ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-elevated hover:text-fg',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-200 ease-in-out',
        'focus:outline-none focus-visible:outline-none focus:ring-0',
        'disabled:cursor-not-allowed disabled:opacity-40',
        checked
          ? 'bg-accent shadow-sm'
          : 'bg-border-strong/80 hover:bg-border-strong',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card overflow-hidden', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-6 py-4">
      <h2 className="font-display text-lg font-semibold tracking-tight text-fg">{title}</h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight text-fg">
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Big number + label, the dashboard's basic unit. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'active' | 'idle' | 'locked' | 'offline' | 'default';
}) {
  const toneClass =
    tone && tone !== 'default'
      ? { active: 'text-active', idle: 'text-idle', locked: 'text-locked', offline: 'text-offline' }[tone]
      : 'text-fg';

  return (
    // data-stat gives the browser tests a stable handle on each tile; the
    // visible label has no other anchor.
    <Card className="px-5 py-4" data-stat={label}>
      <div className="label">{label}</div>
      <div
        data-stat-value
        className={cn('tabular mt-1.5 font-display text-[28px] font-bold leading-none', toneClass)}
      >
        {value}
      </div>
      {hint && <div className="mt-1.5 text-xs text-faint">{hint}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-faint', className)} aria-hidden />;
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm text-faint">
      <Spinner />
      {label}
    </div>
  );
}

/**
 * Empty states carry a reason, not just "no data". On a monitoring dashboard
 * an empty table usually means something is wrong upstream (no agents
 * enrolled, nothing reported yet) and saying which saves a support ticket.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="font-display text-base font-semibold text-fg">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';

  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="font-display text-base font-semibold text-offline">Could not load this view</p>
      <p className="max-w-md text-sm text-muted">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry} className="mt-3">
          Try again
        </Button>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'success' | 'warn' | 'danger' | 'accent';
}) {
  const tones = {
    default: 'bg-elevated text-muted',
    success: 'bg-success/12 text-success',
    warn: 'bg-warn/12 text-warn',
    danger: 'bg-danger/12 text-danger',
    accent: 'bg-accent/12 text-accent',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-bold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function Table({
  children,
  className,
  maxHeight = 'max-h-[calc(100vh-270px)] min-h-[180px]',
}: {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  // The table content itself scrolls inside its container with sticky headers,
  // preventing long tables from forcing the whole page layout down.
  return (
    <div className={cn('relative overflow-x-auto overflow-y-auto rounded-card', maxHeight, className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'sticky top-0 z-10 bg-surface px-6 py-3 text-left text-2xs font-bold uppercase tracking-wider text-muted shadow-[inset_0_-1px_0_rgb(var(--border))] backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('border-t border-border px-6 py-3.5 text-fg', className)} {...props}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/40 p-4 backdrop-blur-[2px]"
      // Clicking the backdrop closes; clicking the panel must not.
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={cn('w-full animate-fade-in rounded-card bg-surface shadow-warm-app', width)}
      >
        <div className="px-6 py-4">
          <h2 className="font-display text-lg font-semibold tracking-tight text-fg">{title}</h2>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';
export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from './chart';
