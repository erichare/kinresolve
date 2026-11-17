/**
 * Single source of truth for the immutable GitHub Actions revisions that
 * workflow contract tests pin. Every workflow under .github/ must reference
 * these exact commit SHAs; bumping an action is a one-file edit here plus the
 * matching workflow updates in the same commit.
 */
export interface ActionPin {
  /** owner/repo slug of the action, e.g. "actions/checkout". */
  readonly action: string;
  /** Full 40-hex commit SHA the action is pinned to. */
  readonly sha: string;
  /** Human-readable release the SHA resolves to, recorded as a trailing comment. */
  readonly version: string;
}

export const ACTION_PINS = {
  checkout: {
    action: "actions/checkout",
    sha: "3d3c42e5aac5ba805825da76410c181273ba90b1",
    version: "v7.0.1"
  },
  setupNode: {
    action: "actions/setup-node",
    sha: "949feb2413d6458794dcd2491c4babbbce0c15c1",
    version: "v7.1.0"
  },
  uploadArtifact: {
    action: "actions/upload-artifact",
    sha: "cf430e030ddbb5b0abf93d22962f4752f3646cd9",
    version: "v7.0.2"
  },
  downloadArtifact: {
    action: "actions/download-artifact",
    sha: "9000827ccba6bdab643e8b6fd33ac0654aef8333",
    version: "v8.0.2"
  },
  attest: {
    action: "actions/attest",
    sha: "1e69f48acb82d1966a394da916b4c1698aa569d6",
    version: "v4.2.2"
  }
} as const satisfies Record<string, ActionPin>;

export type ActionPinName = keyof typeof ACTION_PINS;

/** "actions/checkout@<sha>" — the exact pinned uses reference. */
export function pinnedAction(name: ActionPinName): string {
  const pin = ACTION_PINS[name];
  return `${pin.action}@${pin.sha}`;
}

/** "actions/checkout@<sha> # v4" — the pinned reference with its version comment. */
export function pinnedActionWithComment(name: ActionPinName): string {
  return `${pinnedAction(name)} # ${ACTION_PINS[name].version}`;
}
