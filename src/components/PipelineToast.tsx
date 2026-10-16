"use client";

interface Props {
  isProcessing: boolean;
  pipelineProgress: number;
  pipelineStage: string;
}

/** Progress of the image/thicken pipeline, shown over the 3D viewport under its toolbar. */
export default function PipelineToast({ isProcessing, pipelineProgress, pipelineStage }: Props) {
  if (!isProcessing) return null;

  const label = pipelineStage || "Processing…";
  const progress = pipelineProgress;

  return (
    <div className="pointer-events-none absolute left-1/2 top-14 z-10 w-56 -translate-x-1/2 rounded-md border border-stone-300/70 bg-white/95 px-3 py-2 shadow-sm">
      <p className="mb-1.5 truncate text-xs font-medium text-stone-700">{label}</p>
      <div className="h-1 overflow-hidden rounded-full bg-stone-200">
        {progress < 0 ? (
          <div className="h-full w-1/3 rounded-full bg-accent-600 animate-[indeterminate_1.2s_ease-in-out_infinite]" />
        ) : (
          <div className="h-full rounded-full bg-accent-600" style={{ width: `${progress * 100}%` }} />
        )}
      </div>
    </div>
  );
}
