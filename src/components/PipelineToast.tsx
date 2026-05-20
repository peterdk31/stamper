"use client";

interface Props {
  isProcessing: boolean;
  pipelineProgress: number;
  pipelineStage: string;
  isAutoFitting: boolean;
}

export default function PipelineToast({ isProcessing, pipelineProgress, pipelineStage, isAutoFitting }: Props) {
  const active = isProcessing || isAutoFitting;
  if (!active) return null;

  const label = isAutoFitting && !isProcessing
    ? "Auto-fitting…"
    : pipelineStage || "Processing…";

  const progress = isAutoFitting && !isProcessing ? -1 : pipelineProgress;

  return (
    <div className="fixed bottom-3 left-3 right-3 z-50 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 sm:right-auto sm:w-64">
      <p className="text-sm font-medium text-gray-700 mb-2">{label}</p>
      {progress < 0 ? (
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full w-1/3 bg-amber-600 rounded-full animate-[indeterminate_1.2s_ease-in-out_infinite]" />
        </div>
      ) : (
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-600 rounded-full transition-[width] duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
