import { cn } from '@/lib/utils';

interface KodetyLoadingScreenProps {
  className?: string;
  label?: string;
  progress?: number;
}

function KodetyLoadingMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 114 122"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M51.1932 122L0 61L113.183 94.8289V122H51.1932Z" fill="currentColor" />
      <path d="M51.1932 0L0 61L113.183 27.1711V0H51.1932Z" fill="currentColor" />
    </svg>
  );
}

function KodetyLoadingScreen({
  className,
  label = 'Carregando',
  progress,
}: KodetyLoadingScreenProps) {
  const determinate = Number.isFinite(progress);
  const normalizedProgress = determinate
    ? Math.max(0, Math.min(100, Math.round(progress as number)))
    : undefined;

  return (
    <div
      data-kodety-loading-screen
      data-loading-progress={normalizedProgress}
      className={cn(
        'flex min-h-full min-w-full items-center justify-center overflow-hidden bg-[#050505] text-white',
        className,
      )}
      role="status"
      aria-busy={normalizedProgress !== 100}
      aria-label={label}
    >
      <div className="flex -translate-y-2 flex-col items-center">
        <KodetyLoadingMark className="h-[34px] w-8" />
        <div
          className="mt-7 h-px w-[min(220px,46vw)] overflow-hidden bg-white/25"
          role="progressbar"
          aria-label={label}
          aria-valuemin={determinate ? 0 : undefined}
          aria-valuemax={determinate ? 100 : undefined}
          aria-valuenow={normalizedProgress}
        >
          <span
            className={cn(
              'block h-full bg-white',
              determinate
                ? 'origin-left transition-[width] duration-200 ease-out motion-reduce:transition-none'
                : 'kodety-loading-bar-indeterminate w-2/5',
            )}
            style={determinate ? { width: `${normalizedProgress}%` } : undefined}
          />
        </div>
        <span className="sr-only" aria-live="polite">
          {determinate ? `${label}: ${normalizedProgress}%` : label}
        </span>
      </div>
    </div>
  );
}

export { KodetyLoadingMark, KodetyLoadingScreen };
