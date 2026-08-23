import { useState } from 'react';
import {
  Check,
  Moon,
  Sun,
  Palette,
  Search,
  Sparkles,
} from 'lucide-react';
import { useTheme, ThemeDefinition } from '@/lib/theme';
import { Badge, Button, Card, CardHeader, Input } from '@/components/ui';
import { cn } from '@/lib/format';

type ThemeCategory = 'all' | 'light' | 'dark';

export function ThemeSelectorSection() {
  const { theme, currentTheme, themes, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<ThemeCategory>('all');

  const lightCount = themes.filter((t) => t.mode === 'light').length;
  const darkCount = themes.filter((t) => t.mode === 'dark').length;

  const categoryTabs = [
    { id: 'all' as const, label: 'All Palettes', count: themes.length, icon: Sparkles },
    { id: 'light' as const, label: 'Light Themes', count: lightCount, icon: Sun },
    { id: 'dark' as const, label: 'Dark Themes', count: darkCount, icon: Moon },
  ];

  const filteredThemes = themes.filter((t) => {
    if (activeTab === 'light') return t.mode === 'light';
    if (activeTab === 'dark') return t.mode === 'dark';
    return true;
  });

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader
        title="Theme & Appearance"
        action={
          <div className="flex items-center gap-1.5 rounded-full bg-elevated px-3 py-1 text-2xs font-bold text-muted shadow-warm-sm">
            <Palette className="h-3.5 w-3.5 text-accent" />
            <span>5 Curated Palettes</span>
          </div>
        }
      />

      <div className="px-6 pb-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted max-w-xl">
            Choose from 5 hand-crafted palettes designed for contrast, focus, and visual delight. Switches take effect instantly across all dashboards, charts, and controls.
          </p>

          {/* Interactive Category Filter Tabs */}
          <div className="inline-flex items-center gap-1 rounded-full bg-elevated/80 p-1 shadow-warm-sm border border-border/60">
            {categoryTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150',
                    isActive
                      ? 'bg-accent text-accent-fg shadow-warm-sm'
                      : 'text-muted hover:text-fg hover:bg-surface'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.2 text-[10px] font-bold leading-none',
                      isActive ? 'bg-black/20 text-white' : 'bg-surface text-muted'
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Grid of filtered themes */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredThemes.map((t) => {
            const isSelected = t.id === theme;
            return (
              <ThemeCard
                key={t.id}
                themeDef={t}
                isSelected={isSelected}
                onSelect={(e) => setTheme(t.id, e)}
              />
            );
          })}
        </div>

        {/* Live Theme Playground */}
        <div className="mt-7 rounded-card border border-border/80 bg-elevated/70 p-5 shadow-warm-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3.5">
            <div className="flex items-center gap-2.5">
              <span
                className="h-3 w-3 rounded-full shadow-sm ring-1 ring-black/10"
                style={{ backgroundColor: currentTheme.accentColor }}
              />
              <span className="font-display text-sm font-bold text-fg">
                Live Theme Preview: {currentTheme.name}
              </span>
              <Badge tone={currentTheme.mode === 'dark' ? 'accent' : 'default'}>
                {currentTheme.mode === 'dark' ? 'Dark Theme' : 'Light Theme'}
              </Badge>
            </div>
            <span className="text-2xs font-semibold text-muted">
              Synchronized in real-time
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Interactive Components */}
            <div className="space-y-3 rounded-sub bg-surface p-4 shadow-warm-sm border border-border/60">
              <div className="label">Buttons & Controls</div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm">
                  Primary
                </Button>
                <Button variant="secondary" size="sm">
                  Secondary
                </Button>
                <Button variant="ghost" size="sm">
                  Ghost
                </Button>
                <Button variant="danger" size="sm">
                  Danger
                </Button>
              </div>

              <div className="pt-1">
                <div className="relative">
                  <Input
                    placeholder="Search input sample..."
                    defaultValue="Engineering & Design"
                    className="h-8.5 text-xs pr-8"
                    readOnly
                  />
                  <Search className="absolute right-3 top-2.5 h-3.5 w-3.5 text-muted" />
                </div>
              </div>
            </div>

            {/* Badges & Presence Status */}
            <div className="space-y-3 rounded-sub bg-surface p-4 shadow-warm-sm border border-border/60">
              <div className="label">Badges & Live Presence</div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="accent">Accent</Badge>
                <Badge tone="success">Active (48)</Badge>
                <Badge tone="warn">Idle (12)</Badge>
                <Badge tone="danger">Offline (3)</Badge>
                <Badge tone="default">Locked</Badge>
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-1 text-center">
                <div className="rounded-chip bg-elevated p-1.5">
                  <div className="h-2 w-2 mx-auto mb-1 rounded-full bg-active" />
                  <div className="text-[10px] font-bold text-fg">Active</div>
                </div>
                <div className="rounded-chip bg-elevated p-1.5">
                  <div className="h-2 w-2 mx-auto mb-1 rounded-full bg-idle" />
                  <div className="text-[10px] font-bold text-fg">Idle</div>
                </div>
                <div className="rounded-chip bg-elevated p-1.5">
                  <div className="h-2 w-2 mx-auto mb-1 rounded-full bg-locked" />
                  <div className="text-[10px] font-bold text-fg">Locked</div>
                </div>
                <div className="rounded-chip bg-elevated p-1.5">
                  <div className="h-2 w-2 mx-auto mb-1 rounded-full bg-offline" />
                  <div className="text-[10px] font-bold text-fg">Offline</div>
                </div>
              </div>
            </div>

            {/* Visualizer Palette */}
            <div className="space-y-3 rounded-sub bg-surface p-4 shadow-warm-sm border border-border/60">
              <div className="label">Chart Visualizer Palette</div>
              <div className="flex h-12 items-end gap-2 rounded-sub bg-elevated p-2">
                <div
                  className="flex-1 rounded-t bg-viz-1 transition-all duration-300"
                  style={{ height: '70%' }}
                  title="Series 1"
                />
                <div
                  className="flex-1 rounded-t bg-viz-2 transition-all duration-300"
                  style={{ height: '90%' }}
                  title="Series 2"
                />
                <div
                  className="flex-1 rounded-t bg-viz-3 transition-all duration-300"
                  style={{ height: '55%' }}
                  title="Series 3"
                />
                <div
                  className="flex-1 rounded-t bg-viz-4 transition-all duration-300"
                  style={{ height: '80%' }}
                  title="Series 4"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>4-Series Palette</span>
                <span className="font-mono text-accent font-semibold">100% Theme Sync</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

interface ThemeCardProps {
  themeDef: ThemeDefinition;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent<HTMLDivElement>) => void;
}

function ThemeCard({ themeDef, isSelected, onSelect }: ThemeCardProps) {
  const { name, tagline, mode, accentColor, previewPalette, description } = themeDef;

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(e as unknown as React.MouseEvent<HTMLDivElement>);
        }
      }}
      className={cn(
        'group relative flex flex-col justify-between overflow-hidden rounded-card p-4 text-left transition-all duration-200 ease-spring cursor-pointer',
        'border-2 focus:outline-none',
        isSelected
          ? 'border-accent bg-surface shadow-warm-md ring-2 ring-accent/30 -translate-y-0.5'
          : 'border-border/80 bg-surface/80 hover:bg-surface hover:border-border hover:shadow-warm-sm'
      )}
    >
      <div>
        {/* Top Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-warm-sm ring-1 ring-black/10"
              style={{ backgroundColor: accentColor, color: previewPalette.accentFg }}
            >
              {mode === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-base font-bold text-fg leading-tight">
                  {name}
                </span>
                {isSelected && (
                  <span className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-fg animate-fade-in shadow-warm-sm">
                    <Check className="h-3 w-3 stroke-[3]" /> Active
                  </span>
                )}
              </div>
              <span className="text-2xs font-semibold text-muted">{tagline}</span>
            </div>
          </div>

          <Badge tone={mode === 'dark' ? 'default' : 'accent'}>
            {mode === 'dark' ? 'Dark' : 'Light'}
          </Badge>
        </div>

        {/* Mini Mockup Window */}
        <div
          className="mt-3.5 overflow-hidden rounded-sub p-2.5 shadow-warm-sm transition-transform duration-200 group-hover:scale-[1.01] border border-black/5"
          style={{ backgroundColor: previewPalette.bg }}
        >
          {/* Mock Topbar */}
          <div
            className="flex items-center justify-between rounded-full px-2.5 py-1.5 shadow-sm border border-black/5"
            style={{ backgroundColor: previewPalette.surface }}
          >
            <div className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: previewPalette.accent }}
              />
              <div
                className="h-2 w-10 rounded-full"
                style={{ backgroundColor: previewPalette.text, opacity: 0.8 }}
              />
            </div>
            <div className="flex items-center gap-1">
              <div
                className="rounded-full px-2 py-0.5 text-[8px] font-bold"
                style={{
                  backgroundColor: previewPalette.accent,
                  color: previewPalette.accentFg,
                }}
              >
                Nav
              </div>
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: previewPalette.active }}
              />
            </div>
          </div>

          {/* Mock Content Card */}
          <div
            className="mt-2 rounded-chip p-2 border border-black/5"
            style={{ backgroundColor: previewPalette.surface }}
          >
            <div className="flex items-center justify-between">
              <div
                className="h-2 w-16 rounded"
                style={{ backgroundColor: previewPalette.muted, opacity: 0.6 }}
              />
              <div
                className="h-2 w-6 rounded"
                style={{ backgroundColor: previewPalette.accent }}
              />
            </div>
            <div className="mt-2 flex items-center gap-1">
              <div
                className="h-3 w-8 rounded-sm"
                style={{ backgroundColor: previewPalette.elevated }}
              />
              <div
                className="h-3 w-12 rounded-sm"
                style={{ backgroundColor: previewPalette.elevated }}
              />
              <div
                className="ml-auto h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: previewPalette.active }}
              />
            </div>
          </div>
        </div>

        {/* Theme Description */}
        <p className="mt-3 text-xs leading-relaxed text-muted line-clamp-2">
          {description}
        </p>
      </div>

      {/* Palette Color Swatches */}
      <div className="mt-3.5 flex items-center justify-between border-t border-border/80 pt-2.5">
        <span className="text-[11px] font-semibold text-muted">Palette Tokens</span>
        <div className="flex items-center gap-1.5">
          <span
            className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-sm"
            style={{ backgroundColor: previewPalette.bg }}
            title="Background"
          />
          <span
            className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-sm"
            style={{ backgroundColor: previewPalette.surface }}
            title="Surface Card"
          />
          <span
            className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-sm"
            style={{ backgroundColor: previewPalette.elevated }}
            title="Elevated Container"
          />
          <span
            className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-sm"
            style={{ backgroundColor: previewPalette.accent }}
            title="Primary Accent"
          />
          <span
            className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-sm"
            style={{ backgroundColor: previewPalette.active }}
            title="Active Presence"
          />
        </div>
      </div>
    </div>
  );
}
