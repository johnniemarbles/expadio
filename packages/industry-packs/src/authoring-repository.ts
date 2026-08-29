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
