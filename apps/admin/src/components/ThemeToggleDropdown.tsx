import { useState } from 'react';
import { Check, ChevronDown, Moon, Palette, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/format';

export function ThemeToggleDropdown({ className }: { className?: string }) {
  const { theme, currentTheme, themes, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('relative inline-block text-left', className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-full bg-surface/90 px-3.5 py-2 text-xs font-semibold text-fg shadow-warm-sm border border-border/80 hover:bg-surface hover:shadow-warm-md transition-all duration-150 backdrop-blur-sm active:translate-y-px"
        aria-label="Change Theme"
        aria-expanded={open}
      >
        <span
          className="h-3.5 w-3.5 rounded-full border border-black/10 shrink-0 shadow-inner"
          style={{ backgroundColor: currentTheme.accentColor }}
        />
        <span className="hidden sm:inline font-medium text-fg">{currentTheme.name}</span>
        {currentTheme.mode === 'dark' ? (
          <Moon className="h-3 w-3 text-muted shrink-0" />
        ) : (
          <Sun className="h-3 w-3 text-muted shrink-0" />
        )}
        <ChevronDown
          className={cn('h-3.5 w-3.5 text-muted transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            role="presentation"
          />
          <div className="absolute right-0 z-50 mt-2 w-64 animate-fade-in rounded-card bg-surface p-2 shadow-warm-app border border-border/80 backdrop-blur-md">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Palette className="h-3.5 w-3.5 text-accent" />
                Select Theme
              </span>
              <span>{themes.length} Palettes</span>
            </div>

            <div className="mt-1 space-y-1">
              {themes.map((t) => {
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTheme(t.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-sub px-3 py-2.5 text-left text-xs transition-all duration-150',
                      isActive
                        ? 'bg-accent/12 text-accent font-bold'
                        : 'text-fg hover:bg-elevated font-medium',
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="h-4 w-4 rounded-full border border-black/15 shrink-0 shadow-sm"
                        style={{ backgroundColor: t.accentColor }}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{t.name}</div>
                        <div className="text-[10px] text-muted truncate">{t.tagline}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {t.mode === 'dark' ? (
                        <Moon className="h-3 w-3 text-muted/70" />
                      ) : (
                        <Sun className="h-3 w-3 text-muted/70" />
                      )}
                      {isActive && <Check className="h-3.5 w-3.5 text-accent" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
