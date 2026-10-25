import * as duckdb from "@duckdb/duckdb-wasm";
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import { assetUrl } from "./data";

export interface Database {
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
}

export type Progress = (stage: string, loaded: number, total: number) => void;

const PARQUET = "passagiere.parquet";

async function download(url: string, progress: Progress): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);
  const total = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    progress("Daten werden geladen", loaded, total);
  }
  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer;
}

export async function openDatabase(progress: Progress): Promise<Database> {
  progress("Datenbank wird gestartet", 0, 1);
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const buffer = await download(assetUrl(`data/${PARQUET}`), progress);
  progress("Tabelle wird aufgebaut", 1, 1);
  await db.registerFileBuffer(PARQUET, buffer);
  const conn = await db.connect();
  await conn.query(`CREATE TABLE p AS SELECT * FROM read_parquet('${PARQUET}')`);
  return { db, conn };
}

export async function queryRows<T = Record<string, any>>(database: Database, sql: string): Promise<T[]> {
  const table = await database.conn.query(sql);
  return table.toArray().map((row: any) => row.toJSON() as T);
}

export async function exportCsv(database: Database, selectSql: string): Promise<Blob> {
  const target = `export_${Date.now()}.csv`;
  await database.conn.query(`COPY (${selectSql}) TO '${target}' (HEADER, DELIMITER ';')`);
  const bytes = await database.db.copyFileToBuffer(target);
  await database.db.dropFile(target);
  return new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), new Uint8Array(bytes)], { type: "text/csv;charset=utf-8" });
}

export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
