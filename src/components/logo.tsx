export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {/* cartao branco para o barco oficial (casco escuro) ficar visivel no menu navy */}
      <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white p-1.5">
        <img
          src="/nauticflow-icon.png"
          alt="NauticFlow"
          className="h-6 w-auto object-contain"
        />
      </span>
      {!compact && (
        <span className="font-display text-lg font-semibold leading-none tracking-tight">
          <span className="text-white">Nautic</span>
          <span className="text-brand-light">Flow</span>
        </span>
      )}
    </div>
  );
}
