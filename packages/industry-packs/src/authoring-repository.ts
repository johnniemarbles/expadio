import type {
  CreateIndustryPackDraft,
  IndustryPackAuthoringScope,
  IndustryPackVersion,
  IndustryPackVersionIdentity,
  UpdateIndustryPackDraft,
} from './authoring.ts';

export interface IndustryPackVersionRepository {
  createDraft(input: CreateIndustryPackDraft): Promise<IndustryPackVersion>;

  updateDraft(input: UpdateIndustryPackDraft): Promise<IndustryPackVersion>;

  findByIdentity(input: {
    readonly scope: IndustryPackAuthoringScope;
    readonly identity: IndustryPackVersionIdentity;
  }): Promise<IndustryPackVersion | null>;

  listVersions(input: {
    readonly scope: IndustryPackAuthoringScope;
    readonly verticalKey: string;
  }): Promise<readonly IndustryPackVersion[]>;
}


/**
 * Separate write-side port for atomic lifecycle mutation. Kept apart from the
 * draft/version repository so existing read/draft adapters are not implicitly
 * widened when lifecycle support is introduced.
 */
export interface IndustryPackLifecycleRepository {
  transitionLifecycle(input: {
    readonly scope: IndustryPackAuthoringScope;
    readonly identity: IndustryPackVersionIdentity;
    readonly expectedState: IndustryPackVersion['state'];
    readonly next: IndustryPackVersion;
  }): Promise<IndustryPackVersion>;
}
