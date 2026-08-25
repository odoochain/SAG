/**
 * Batch ingest law documents from a directory of Markdown files into SAG.
 *
 * Usage:
 *   npx tsx scripts/batch-ingest-laws.ts <dir> [--source-id <uuid>] [--dry-run] [--concurrency <n>]
 *
 * Each .md file becomes one SAG document. The first `# heading` is used as title;
 * if absent, the filename (minus date suffix) is used instead.
 * The `<!-- INFO END -->` marker (common in lawrefbook exports) is stripped.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function flag(name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

function option(name: string, fallback: string): string {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return fallback;
  const val = args[i + 1];
  args.splice(i, 2);
  return val;
}

const dryRun = flag("--dry-run");
const concurrency = Number(option("--concurrency", "2"));
const sourceId = option("--source-id", randomUUID());
const sagBase = option("--sag-url", "http://localhost:4173");
const dir = args[0];

if (!dir) {
  console.error("Usage: npx tsx scripts/batch-ingest-laws.ts <directory> [options]");
  console.error("  --source-id <uuid>   SAG source (project) ID  (default: random)");
  console.error("  --sag-url <url>      SAG API base URL          (default: http://localhost:4173)");
  console.error("  --concurrency <n>    Parallel ingests           (default: 2)");
  console.error("  --dry-run            Parse only, don't call API");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse one .md file
// ---------------------------------------------------------------------------

interface LawDoc {
  file: string;
  title: string;
  content: string;
  date: string | null;
}

function parseLawFile(filename: string, raw: string): LawDoc {
  // Strip <!-- INFO END --> marker and everything before it if it's just metadata
  let content = raw.replace(/<!--\s*INFO\s*END\s*-->/g, "").trim();

  // Extract title from first # heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  let title: string;
  if (headingMatch) {
    title = headingMatch[1].trim();
  } else {
    // Fallback: filename without extension and date
    title = basename(filename, extname(filename)).replace(/\(\d{4}-\d{2}-\d{2}\)$/, "").trim();
  }

  // Extract date from filename pattern like (2021-12-13)
  const dateMatch = filename.match(/\((\d{4}-\d{2}-\d{2})\)/);
  const date = dateMatch ? dateMatch[1] : null;

  return { file: filename, title, content, date };
}

// ---------------------------------------------------------------------------
// Ingest via SAG HTTP API
// ---------------------------------------------------------------------------

interface IngestResult {
  documentId?: string;
  sourceId?: string;
  chunkCount?: number;
  eventCount?: number;
  entityCount?: number;
}

async function ingestOne(doc: LawDoc): Promise<IngestResult> {
  const body = {
    sourceId,
    title: doc.title,
    content: doc.content,
    metadata: {
      type: "地方性法规",
      region: "海南",
      date: doc.date,
      filename: doc.file,
    },
    extract: true,
    chunking: { mode: "heading_strict" as const },
  };

  const resp = await fetch(`${sagBase}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }

  return (await resp.json()) as IngestResult;
}

// ---------------------------------------------------------------------------
// Concurrency-limited mapper
// ---------------------------------------------------------------------------

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const entries = await readdir(dir);
  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();

  console.log(`Found ${mdFiles.length} .md files in ${dir}`);
  console.log(`Source ID: ${sourceId}`);
  console.log(`Concurrency: ${concurrency}`);
  if (dryRun) console.log("** DRY RUN — will not call SAG API **");
  console.log();

  // Parse all files
  const docs: LawDoc[] = [];
  for (const file of mdFiles) {
    const raw = await readFile(join(dir, file), "utf-8");
    docs.push(parseLawFile(file, raw));
  }

  // Quick stats
  const totalChars = docs.reduce((s, d) => s + d.content.length, 0);
  console.log(`Parsed ${docs.length} documents, ${(totalChars / 1024).toFixed(0)} KB total`);
  console.log();

  if (dryRun) {
    for (const d of docs.slice(0, 10)) {
      console.log(`  [${d.date ?? "no date"}] ${d.title}  (${d.content.length} chars)`);
    }
    if (docs.length > 10) console.log(`  ... and ${docs.length - 10} more`);
    return;
  }

  // Ingest
  let ok = 0;
  let fail = 0;
  const startTime = Date.now();

  await mapLimited(docs, concurrency, async (doc, i) => {
    const t0 = Date.now();
    try {
      const result = await ingestOne(doc);
      ok++;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `[${i + 1}/${docs.length}] ✓ ${doc.title}  — ${result.chunkCount ?? "?"} chunks, ${result.eventCount ?? "?"} events  (${elapsed}s)`
      );
    } catch (err) {
      fail++;
      console.error(`[${i + 1}/${docs.length}] ✗ ${doc.title}  — ${err instanceof Error ? err.message : err}`);
    }
  });

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log();
  console.log(`Done in ${totalSec}s — ${ok} succeeded, ${fail} failed`);
  console.log(`Source ID: ${sourceId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
