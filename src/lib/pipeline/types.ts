import type { StampSettings, DesignData } from "@/types/stamp";

export interface StepFlags {
  thickenEnabled: boolean;
  smoothEnabled: boolean;
  tracerAlgorithm: string;
  thickenAlgorithm: string;
}

export interface StepVariant {
  id: string;
  label: string;
  description: string;
  step: PipelineStep;
}

export interface StepSlot {
  id: string;
  label: string;
  defaultId: string;
  variants: StepVariant[];
}

export type SyncStep = {
  name: string;
  type: "sync";
  enabled: (settings: StampSettings, flags: StepFlags) => boolean;
  process: (data: DesignData, settings: StampSettings) => DesignData;
};

export type WorkerStep = {
  name: string;
  type: "worker";
  enabled: (settings: StampSettings, flags: StepFlags) => boolean;
  createWorker: () => Worker;
  buildMessage: (data: DesignData, settings: StampSettings, flags: StepFlags) => unknown;
  parseResult: (message: unknown, prevData: DesignData) => DesignData | null;
  parseProgress?: (message: unknown) => number | null;
};

export type PipelineStep = SyncStep | WorkerStep;

export interface StepResult {
  data: DesignData | null;
  isProcessing: boolean;
  progress: number;
}
