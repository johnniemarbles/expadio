import Link from 'next/link';
import { DeniedState, StatePill } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { fetchApi } from '../../../../lib/live-adapter';
import type { RouteSearchParams } from '../../../../lib/request-context';
import styles from './page.module.css';
import { CloneActiveDraftButton } from './CloneActiveDraftButton';
import { ReturnIndustryPackToDraftButton } from './ReturnIndustryPackToDraftButton';
import { PublishIndustryPackButton } from './PublishIndustryPackButton';

interface IndustryPackCatalogItem {
  readonly verticalKey: string;
  readonly label: string;
  readonly workType: string;
  readonly caseSchemaVersion: number;
  readonly caseFields: readonly {
    readonly key: string;
    readonly label: string;
    readonly type: string;
    readonly required: boolean;
  }[];
}

interface PackCatalogResponse {
  readonly verticalKey: string | null;
  readonly catalog: readonly IndustryPackCatalogItem[];
}

interface VersionSummary {
  readonly verticalKey: string;
  readonly version: number;
  readonly scope: 'TENANT' | 'PLATFORM';
  readonly source: string;
  readonly state: string;
  readonly revision: number;
  readonly label: string;
  readonly createdBySubjectId: string;
  readonly createdAt: string;
  readonly updatedBySubjectId: string;
  readonly updatedAt: string;
  readonly submittedBySubjectId?: string;
  readonly submittedAt?: string;
  readonly publishedBySubjectId?: string;
  readonly publishedAt?: string;
}

interface VersionsResponse {
  readonly verticalKey: string;
  readonly tenantVersions: readonly VersionSummary[];
  readonly platformVersions: readonly VersionSummary[];
}

function firstParam(
  searchParams: Awaited<RouteSearchParams>,
  key: string,
): string | undefined {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function pillState(state: string): 'Published' | 'Review' | 'Draft' | null {
  switch (state) {
    case 'PUBLISHED':
      return 'Published';
    case 'IN_REVIEW':
      return 'Review';
    case 'DRAFT':
      return 'Draft';
    default:
      return null;
  }
}

export default async function IndustryPacksPage({
  searchParams,
}: {
  searchParams: RouteSearchParams;
}) {
  const resolvedSearchParams = await searchParams;
  const catalogResult = await fetchApi<PackCatalogResponse>('/api/tenancy/packs');
  if (isDenied(catalogResult)) return <DeniedState result={catalogResult} />;

  const requestedVertical = firstParam(resolvedSearchParams, 'vertical');
  const selectedVertical =
    requestedVertical?.trim().toLowerCase()
    || catalogResult.verticalKey
    || catalogResult.catalog[0]?.verticalKey
    || null;

  const selectedPack = selectedVertical === null
    ? null
    : catalogResult.catalog.find((pack) => pack.verticalKey === selectedVertical) ?? null;

  const versionsResult = selectedVertical === null
    ? null
    : await fetchApi<VersionsResponse>(
        `/api/configuration/industry-packs/versions?verticalKey=${encodeURIComponent(selectedVertical)}`,
      );

  if (versionsResult !== null && isDenied(versionsResult)) {
    return <DeniedState result={versionsResult} />;
  }

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Business Configuration</p>
          <h1 id="page-title">Industry Packs</h1>
          <p>Inspect governed vertical configuration, version history, and the active tenant binding.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="catalog-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="catalog-title">Pack catalogue</h2>
            <p>Select a vertical to inspect its authored and platform version history.</p>
          </div>
          {selectedVertical !== null && selectedVertical === catalogResult.verticalKey ? (
            <CloneActiveDraftButton />
          ) : null}
        </div>
        <div className={styles.packGrid}>
          {catalogResult.catalog.map((pack) => {
            const active = pack.verticalKey === selectedVertical;
            return (
              <Link
                key={pack.verticalKey}
                href={`/configuration/industry-packs?vertical=${encodeURIComponent(pack.verticalKey)}`}
                className={active ? `${styles.packCard} ${styles.packCardActive}` : styles.packCard}
                aria-current={active ? 'page' : undefined}
              >
                <span className={styles.packLabel}>{pack.label}</span>
                <span className={styles.packMeta}>{pack.workType} · schema v{pack.caseSchemaVersion}</span>
                {pack.verticalKey === catalogResult.verticalKey ? (
                  <span className={styles.boundBadge}>Tenant binding</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </section>

      {selectedPack !== null && versionsResult !== null ? (
        <>
          <section className={styles.summaryGrid} aria-label="Selected Industry Pack summary">
            <article className={styles.summaryCard}>
              <span>Vertical</span>
              <strong>{selectedPack.label}</strong>
            </article>
            <article className={styles.summaryCard}>
              <span>Work type</span>
              <strong>{selectedPack.workType}</strong>
            </article>
            <article className={styles.summaryCard}>
              <span>Schema</span>
              <strong>v{selectedPack.caseSchemaVersion}</strong>
            </article>
            <article className={styles.summaryCard}>
              <span>Declared fields</span>
              <strong>{selectedPack.caseFields.length}</strong>
            </article>
          </section>

          <VersionTable
            title="Tenant-authored versions"
            versions={versionsResult.tenantVersions}
            emptyMessage="No tenant-authored versions yet."
          />
          <VersionTable
            title="Platform versions"
            versions={versionsResult.platformVersions}
            emptyMessage="No platform versions are visible for this vertical."
          />
        </>
      ) : (
        <section className={styles.emptyState}>
          No Industry Pack is currently available to inspect.
        </section>
      )}
    </>
  );
}

function VersionTable({
  title,
  versions,
  emptyMessage,
}: {
  readonly title: string;
  readonly versions: readonly VersionSummary[];
  readonly emptyMessage: string;
}) {
  return (
    <section className={styles.panel} aria-labelledby={`${title.replaceAll(' ', '-').toLowerCase()}-title`}>
      <div className={styles.panelHeading}>
        <div>
          <h2 id={`${title.replaceAll(' ', '-').toLowerCase()}-title`}>{title}</h2>
        </div>
      </div>
      {versions.length === 0 ? (
        <p className={styles.emptyRow}>{emptyMessage}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Version</th>
                <th>Label</th>
                <th>State</th>
                <th>Revision</th>
                <th>Updated</th>
                <th>Published</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={`${version.scope}:${version.verticalKey}:${version.version}`}>
                  <td><span className={styles.code}>v{version.version}</span></td>
                  <td><strong>{version.label}</strong></td>
                  <td>
                    {pillState(version.state) === null
                      ? <span className={styles.stateText}>{version.state}</span>
                      : <StatePill state={pillState(version.state)!} />}
                  </td>
                  <td>{version.revision}</td>
                  <td>{new Date(version.updatedAt).toLocaleString()}</td>
                  <td>{version.publishedAt ? new Date(version.publishedAt).toLocaleString() : '—'}</td>
                  <td>
                    {version.scope === 'TENANT' && version.state === 'DRAFT' ? (
                      <Link
                        href={`/configuration/industry-packs/drafts/${encodeURIComponent(version.verticalKey)}/${version.version}`}
                      >
                        Open draft
                      </Link>
                    ) : version.scope === 'TENANT' && version.state === 'IN_REVIEW' ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <ReturnIndustryPackToDraftButton
                          verticalKey={version.verticalKey}
                          version={version.version}
                        />
                        <PublishIndustryPackButton
                          verticalKey={version.verticalKey}
                          version={version.version}
                        />
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
