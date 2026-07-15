export type LaunchMediaSegment = {
  durationSeconds: number;
  image: string;
  text: string;
};

export function buildWebVtt(segments: readonly LaunchMediaSegment[]): string;

export function buildTranscript(
  segments: readonly LaunchMediaSegment[],
  sourceCommit: string
): string;
