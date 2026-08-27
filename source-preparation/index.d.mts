export type SourceLocation = Readonly<Record<string, unknown>>;

export class SourcePreparationError extends Error {
  readonly category: string;
  readonly code: string;
  readonly location?: SourceLocation;
  readonly cycle?: readonly SourceDependencyEdge[];
  constructor(category: string, code: string, message: string, location?: SourceLocation);
}

export interface SourceSnapshot {
  readonly physicalPath: string;
  readonly dependencyIdentity: string;
  readonly logicalIdentity: string;
  readonly originalBytes: Uint8Array;
}

export interface SourceDependencyReference {
  readonly specifier: string;
  readonly location: SourceLocation;
}

export interface SourceDependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly location: SourceLocation;
}

export interface SourceInspection<State = unknown> {
  readonly state?: State;
  readonly compilerBytes: Uint8Array;
  readonly dependencies: readonly SourceDependencyReference[];
  readonly maskedRanges: readonly SourceLocation[];
}

export interface SourceProfile<Configuration = unknown, State = unknown> {
  inspectEntry(
    snapshot: SourceSnapshot,
    configuration: Configuration,
  ): SourceInspection<State> | Promise<SourceInspection<State>>;
  inspectDependency(
    snapshot: SourceSnapshot,
    state: State,
  ): SourceInspection<State> | Promise<SourceInspection<State>>;
}

export interface SourceReader {
  readonly root: string;
  resolveEntry(specifier: string): Promise<SourceSnapshot>;
  resolveDependency(importer: SourceSnapshot, specifier: string): Promise<SourceSnapshot>;
}

export interface SourceLimits {
  readonly maxParts?: number;
  readonly maxDepth?: number;
  readonly maxLogicalPathBytes?: number;
  readonly maxRetainedPathBytes?: number;
  readonly maxBank?: number;
}

export interface SourcePlacement {
  readonly defaultBank?: number;
  readonly banks?: Readonly<Record<string, number>>;
}

export interface ResolvedSourcePart extends SourceSnapshot {
  readonly ordinal: number;
  readonly bank: number;
  readonly compilerBytes: Uint8Array;
  readonly dependencies: readonly SourceDependencyReference[];
  readonly maskedRanges: readonly SourceLocation[];
  readonly includeStack: readonly SourceDependencyEdge[];
  readonly provenance: Readonly<Record<string, unknown>>;
}

export interface ResolvedSourceProject<State = unknown> {
  readonly parts: readonly ResolvedSourcePart[];
  readonly bankArray: readonly number[];
  readonly state: State;
  readonly retainedPathBytes: number;
}

export const NODE_SOURCE_LIMITS: Readonly<Required<SourceLimits>>;

export function createNodeSourceReader(
  root: string,
  options?: { readonly filesystem?: typeof import("node:fs/promises") },
): Promise<SourceReader>;

export function joinSourcePlacement(options: {
  readonly parts: readonly Omit<ResolvedSourcePart, "ordinal" | "bank" | "provenance">[];
  readonly reader: SourceReader;
  readonly placement?: SourcePlacement;
  readonly limits: Required<SourceLimits>;
}): Promise<Pick<ResolvedSourceProject, "parts" | "bankArray">>;

export function resolveSourceProject<Configuration = unknown, State = unknown>(options: {
  readonly reader: SourceReader;
  readonly entry: string;
  readonly profile: SourceProfile<Configuration, State>;
  readonly configuration: Configuration;
  readonly placement?: SourcePlacement;
  readonly limits?: SourceLimits;
}): Promise<ResolvedSourceProject<State>>;

export const passthroughProfile: SourceProfile<unknown, undefined>;
