export interface AiGeneratedOutputWrite {
  readonly tenantId: string;
  readonly invocationId: string;
  readonly connectorKey: string;
  readonly providerKey: string;
  readonly modelKey: string;
  readonly mediaType: string;
  readonly content: string;
  readonly generatedAt: string;
}

export interface AiGeneratedOutputReceipt {
  readonly outputReference: string;
  readonly contentDigest: string;
}

export interface AiGeneratedOutputStore {
  store(
    output: AiGeneratedOutputWrite,
  ): Promise<AiGeneratedOutputReceipt>;
}

export interface AiGeneratedOutputRecord extends AiGeneratedOutputWrite {
  readonly outputId: string;
  readonly outputReference: string;
  readonly contentDigest: string;
}

export interface AiGeneratedOutputReader {
  load(input: {
    readonly tenantId: string;
    readonly outputReference: string;
  }): Promise<AiGeneratedOutputRecord | null>;
}
