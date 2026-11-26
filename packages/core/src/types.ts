export type TrustStatus = 'draft' | 'community' | 'verified' | 'expert-reviewed';

export interface Person {
  name: string;
  github?: string;
  url?: string;
}

export interface Reviewer extends Person {
  role: string;
  reviewed_version: string;
  date: string;
}

export interface Dependency {
  name: string;
  version: string;
}

export interface Source {
  title: string;
  url: string;
  kind: 'standard' | 'rfc' | 'guide' | 'paper' | 'library-docs';
}

export interface VerificationEnv {
  name: string;
  required: boolean;
  description: string;
  default?: string;
}

export interface Verification {
  framework: string;
  command: string;
  runtime: string;
  env: VerificationEnv[];
}

/** Parsed and schema-valid blueprint.yaml. */
export interface BlueprintManifest {
  spec_version: string;
  name: string;
  version: string;
  title: string;
  summary: string;
  category: string;
  status: TrustStatus;
  authors: Person[];
  reviewers: Reviewer[];
  stacks: string[];
  depends_on: Dependency[];
  sources: Source[];
  verification: Verification;
  last_reviewed: string;
  license?: string;
  tags?: string[];
}

export interface RegistryEntry {
  name: string;
  version: string;
  title: string;
  summary: string;
  category: string;
  stacks: string[];
  status: TrustStatus;
  tags: string[];
  depends_on: Dependency[];
  /** Directory of the blueprint relative to the registry root, posix separators. */
  path: string;
  /** Every file of the blueprint relative to `path`, sorted, posix separators. */
  files: string[];
}

export interface Registry {
  spec_version: string;
  blueprints: RegistryEntry[];
}

export interface Issue {
  /** File relative to the blueprint directory, if the issue is tied to one. */
  file?: string;
  message: string;
}

export interface ValidationResult {
  dir: string;
  name?: string;
  manifest?: BlueprintManifest;
  errors: Issue[];
  warnings: Issue[];
}

export interface ChecklistItem {
  id: string;
  kind: 'automated' | 'manual';
  text: string;
}

export interface LoadedBlueprint {
  entry: RegistryEntry;
  manifest: BlueprintManifest;
  /** File contents keyed by path relative to the blueprint directory. */
  files: Record<string, string>;
}
