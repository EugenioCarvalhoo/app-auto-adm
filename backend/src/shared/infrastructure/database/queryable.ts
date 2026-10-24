import type { QueryResult, QueryResultRow } from 'pg';

/** Qualquer coisa que execute SQL parametrizado: o Pool ou um PoolClient (transação). */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}
