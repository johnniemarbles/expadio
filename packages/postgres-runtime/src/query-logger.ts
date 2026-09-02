import type { PostgresClient, SqlQueryResult } from './index.ts';

export interface QueryLogger {
  logQuery(text: string, values: readonly unknown[], elapsed: number): void;
  logError(text: string, values: readonly unknown[], error: Error, elapsed: number): void;
}

export class ConsoleQueryLogger implements QueryLogger {
  readonly #slowThresholdMs: number;

  constructor(slowThresholdMs = 100) {
    this.#slowThresholdMs = slowThresholdMs;
  }

  logQuery(text: string, values: readonly unknown[], elapsed: number): void {
    if (elapsed > this.#slowThresholdMs) {
      console.warn(
        `[SLOW QUERY ${elapsed}ms] ${text.substring(0, 120)}${
          text.length > 120 ? '...' : ''
        }`,
      );
      if (values.length > 0 && values.length <= 5) {
        console.warn(`  params: ${JSON.stringify(values)}`);
      }
    }
  }

  logError(
    text: string,
    values: readonly unknown[],
    error: Error,
    elapsed: number,
  ): void {
    console.error(
      `[QUERY ERROR ${elapsed}ms] ${text.substring(0, 120)}${
        text.length > 120 ? '...' : ''
      }`,
    );
    if (values.length > 0 && values.length <= 5) {
      console.error(`  params: ${JSON.stringify(values)}`);
    }
    console.error(`  error: ${error.message}`);
  }
}

/**
 * Wraps a PostgresClient to instrument query timing and logging.
 * Helps identify slow queries and performance bottlenecks at runtime.
 *
 * **Usage:**
 * ```typescript
 * const client = await pool.connect();
 * const logged = new LoggingPostgresClient(client, new ConsoleQueryLogger(100));
 * // Now use logged instead of client
 * ```
 *
 * **Performance:** Minimal overhead (~1ms per query for logging itself).
 * Only log slow queries (>100ms) in production.
 */
export class LoggingPostgresClient implements PostgresClient {
  readonly #client: PostgresClient;
  readonly #logger: QueryLogger;

  constructor(client: PostgresClient, logger?: QueryLogger) {
    this.#client = client;
    this.#logger = logger ?? new ConsoleQueryLogger();
  }

  async query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const start = Date.now();
    const params = values ?? [];
    try {
      const result = await this.#client.query<Row>(text, params);
      const elapsed = Date.now() - start;
      this.#logger.logQuery(text, params, elapsed);
      return result;
    } catch (error) {
      const elapsed = Date.now() - start;
      this.#logger.logError(
        text,
        params,
        error instanceof Error ? error : new Error(String(error)),
        elapsed,
      );
      throw error;
    }
  }

  release?(): void {
    this.#client.release?.();
  }
}
