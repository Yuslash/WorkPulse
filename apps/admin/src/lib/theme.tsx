import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeId =
  | 'warm-cream'
  | 'obsidian-midnight'
  | 'nordic-frost'
  | 'emerald-forest'
  | 'cyberpunk-sunset'
  | 'azure-pulse';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  mode: 'light' | 'dark';
  accentColor: string;
  surfaceColor: string;
  bgColor: string;
  fgColor: string;
  previewPalette: {
    bg: string;
    surface: string;
    elevated: string;
    accent: string;
    accentFg: string;
    text: string;
    muted: string;
    active: string;
  };
  description: string;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'azure-pulse',
    name: 'Azure Pulse',
    tagline: 'Modern High-Precision Blue',
    mode: 'light',
    accentColor: '#256EFF',
    surfaceColor: '#FFFFFF',
    bgColor: '#E8ECF2',
    fgColor: '#1A1A1A',
    previewPalette: {
      bg: '#E8ECF2',
      surface: '#FFFFFF',
      elevated: '#DFE5EE',
      accent: '#256EFF',
      accentFg: '#FFFFFF',
      text: '#1A1A1A',
      muted: '#6B7280',
      active: '#16A34A',
    },
    description:
      'High-precision SaaS light theme with crisp porcelain cards, refined graphite canvas depth, and electric brand blue accents.',
  },
  {
    id: 'warm-cream',
    name: 'Warm Cream',
    tagline: 'Signature Editorial Classic',
    mode: 'light',
    accentColor: '#F0875C',
    surfaceColor: '#FAF8F4',
    bgColor: '#E9E7E2',
    fgColor: '#1C1A17',
    previewPalette: {
      bg: '#E9E7E2',
      surface: '#FAF8F4',
      elevated: '#F3F0EA',
      accent: '#F0875C',
      accentFg: '#FFFFFF',
      text: '#1C1A17',
      muted: '#938C82',
      active: '#3FA65E',
    },
    description:
      'The original WorkPulse editorial warmth. Cream parchment ground with energized coral accents and rich espresso typography.',
  },
  {
    id: 'obsidian-midnight',
    name: 'Obsidian Midnight',
    tagline: 'Cyber Luxury & High Contrast',
    mode: 'dark',
    accentColor: '#6366F1',
    surfaceColor: '#151B26',
    bgColor: '#0D1017',
    fgColor: '#F3F5F9',
    previewPalette: {
      bg: '#0D1017',
      surface: '#151B26',
      elevated: '#1E2634',
      accent: '#6366F1',
      accentFg: '#FFFFFF',
      text: '#F3F5F9',
      muted: '#9AA8BA',
      active: '#34D399',
    },
    description:
      'Deep cosmic dark backdrop with glowing electric indigo highlights and crisp silver typography. Engineered for night focus and OLED displays.',
  },
  {
    id: 'nordic-frost',
    name: 'Nordic Frost',
    tagline: 'Pure Ice & Oceanic Azure',
    mode: 'light',
    accentColor: '#0EA5E9',
    surfaceColor: '#FFFFFF',
    bgColor: '#EEF2F6',
    fgColor: '#0F172A',
    previewPalette: {
      bg: '#EEF2F6',
      surface: '#FFFFFF',
      elevated: '#E4EBF3',
      accent: '#0EA5E9',
      accentFg: '#FFFFFF',
      text: '#0F172A',
      muted: '#64748B',
      active: '#10B981',
    },
    description:
      'Clean Scandinavian minimalist light palette with pure porcelain cards, subtle ice-grey depth, and vivid azure sky accents.',
  },
  {
    id: 'emerald-forest',
    name: 'Emerald Forest',
    tagline: 'Velvet Spruce & Radiant Mint',
    mode: 'dark',
    accentColor: '#10B981',
    surfaceColor: '#11241C',
    bgColor: '#0A1611',
    fgColor: '#ECFDF5',
    previewPalette: {
      bg: '#0A1611',
      surface: '#11241C',
      elevated: '#193127',
      accent: '#10B981',
      accentFg: '#0A1611',
      text: '#ECFDF5',
      muted: '#91B4A5',
      active: '#34D399',
    },
    description:
      'Sophisticated deep botanical dark theme with velvety evergreen tones and luminous spring mint highlights.',
  },
  {
    id: 'cyberpunk-sunset',
    name: 'Cyberpunk Sunset',
    tagline: 'Neon Violet & Glowing Amber',
    mode: 'dark',
    accentColor: '#F43F5E',
    surfaceColor: '#1C1428',
    bgColor: '#120D1A',
    fgColor: '#FDF4FF',
    previewPalette: {
      bg: '#120D1A',
      surface: '#1C1428',
      elevated: '#291E3A',
      accent: '#F43F5E',
      accentFg: '#FFFFFF',
      text: '#FDF4FF',
      muted: '#C0A5D4',
      active: '#34D399',
    },
    description:
      'High-energy synthwave night theme with deep plum velvet surfaces, neon rose focal points, and radiant amber micro-accents.',
  },
];

const THEME_STORAGE_KEY = 'workpulse_theme_v1';

export type SwitchThemeEvent =
  | React.MouseEvent<HTMLElement>
  | MouseEvent
  | { clientX: number; clientY: number };

interface ThemeContextType {
  theme: ThemeId;
  currentTheme: ThemeDefinition;
  themes: ThemeDefinition[];
  setTheme: (theme: ThemeId, event?: SwitchThemeEvent) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

function getInitialTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    if (saved && THEMES.some((t) => t.id === saved)) {
      return saved;
    }
  } catch {
    // fallback
  }
  return 'azure-pulse';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(getInitialTheme);

  const applyThemeToDOM = (themeId: ThemeId) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', themeId);
    const selected = THEMES.find((t) => t.id === themeId);
    if (selected) {
      root.style.colorScheme = selected.mode;
    }
  };

  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  const setTheme = (newTheme: ThemeId, event?: SwitchThemeEvent) => {
    if (newTheme === theme) return;

    const commitTheme = () => {
      setThemeState(newTheme);
      applyThemeToDOM(newTheme);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      } catch {
        // storage unavailable
      }
    };

    // Check if View Transitions API is supported
    const isViewTransitionSupported =
      typeof document !== 'undefined' &&
      'startViewTransition' in document &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!isViewTransitionSupported) {
      commitTheme();
      return;
    }

    // Determine click origin for circular ripple expansion
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;

    if (event && 'clientX' in event && event.clientX > 0) {
      x = event.clientX;
      y = event.clientY;
    }

    // Calculate distance to furthest corner of screen
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    // Start View Transition
    const doc = document as unknown as {
      startViewTransition: (callback: () => void) => {
        ready: Promise<void>;
      };
    };

    const transition = doc.startViewTransition(() => {
      commitTheme();
    });

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ];

      document.documentElement.animate(
        {
          clipPath: clipPath,
        },
        {
          duration: 650,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        }
      );
    });
  };

  const currentTheme = THEMES.find((t) => t.id === theme) ?? THEMES[0]!;

  return (
    <ThemeContext.Provider value={{ theme, currentTheme, themes: THEMES, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
