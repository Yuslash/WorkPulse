import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/format';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent text-accent-fg shadow-warm-sm',
        secondary: 'border-border/80 bg-elevated text-fg',
        destructive: 'border-transparent bg-danger/15 text-danger',
        success: 'border-transparent bg-active/15 text-active',
        warning: 'border-transparent bg-warn/15 text-warn',
        outline: 'border-border text-fg',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
