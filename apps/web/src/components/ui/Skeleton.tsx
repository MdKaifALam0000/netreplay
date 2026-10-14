import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'rect' | 'circle' | 'text';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  variant = 'rect',
  ...props
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'animate-pulse bg-zinc-800/60 rounded',
          variant === 'circle' && 'rounded-full',
          variant === 'text' && 'h-4 w-full rounded',
          className
        )
      )}
      {...props}
    />
  );
};
