/**
 * Retry ingesting the 25 failed Hainan law documents.
 * Usage: npx tsx scripts/retry-failed-ingest.ts
 */

import { readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";

const DIR = "G:\\1-lawiaorg\\lawrefbook.github.io\\content\\docs\\DLC\\海南地方法规\\地方性法规\\海南";
const SOURCE_ID = "20000000-0000-0000-0000-000000000001";
const SAG_URL = "http://localhost:4173";
const CONCURRENCY = 2;

const FAILED_TITLES = [
  "三亚市三亚河保护管理规定",
  "三亚市制定地方性法规条例",
  "三沙市人民代表大会常务委员会人事任免规定",
  "三沙市制定地方性法规条例",
  "儋州市东坡文化资源保护利用规定",
  "海南省东坡文化保护发展规定",
  "海南省公安机关警务辅助人员管理条例",
  "海南省各级人民代表大会常务委员会信访工作规定",
  "海南省反间谍工作条例",
  "海南省国防教育条例",
  "海南省大气污染防治条例",
  "海南省宗教事务管理若干规定",
  "海南省实施《中华人民共和国消费者权益保护法》办法",
  "海南省实施《中华人民共和国野生动物保护法》办法",
  "海南省实施宪法宣誓制度办法",
  "海南省无规定动物疫病区管理条例",
  "海南省松涛水库生态环境保护规定",
  "海南省林木种子管理条例",
  "海南省绿色建筑发展条例",
  "海南省自然保护区条例",
  "海南省船舶污染防治条例",
  "海口市历史文化名城保护条例",
  "海口市城市供水排水节约用水管理条例",
  "海口市烟花爆竹管理若干规定",
  "海口市生活垃圾分类管理办法",
];

interface LawDoc {
  file: string;
  title: string;
  content: string;
  date: string | null;
}

function parseLawFile(filename: string, raw: string): LawDoc {
  let content = raw.replace(/<!--\s*INFO\s*END\s*-->/g, "").trim();
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const title = headingMatch
    ? headingMatch[1].trim()
    : basename(filename, extname(filename)).replace(/\(\d{4}-\d{2}-\d{2}\)$/, "").trim();
  const dateMatch = filename.match(/\((\d{4}-\d{2}-\d{2})\)/);
  return { file: filename, title, content, date: dateMatch ? dateMatch[1] : null };
}

async function ingestOne(doc: LawDoc) {
  const resp = await fetch(`${SAG_URL}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceId: SOURCE_ID,
      title: doc.title,
      content: doc.content,
      metadata: { type: "地方性法规", region: "海南", date: doc.date, filename: doc.file },
      extract: true,
      chunking: { mode: "heading_strict" },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
  return (await resp.json()) as { chunkCount?: number; eventCount?: number };
}

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

async function main() {
  const { readdir } = await import("node:fs/promises");
  const allFiles = await readdir(DIR);
  const mdFiles = allFiles.filter((f) => f.endsWith(".md"));

  const docs: LawDoc[] = [];
  for (const file of mdFiles) {
    const raw = await readFile(join(DIR, file), "utf-8");
    const doc = parseLawFile(file, raw);
    if (FAILED_TITLES.includes(doc.title)) {
      docs.push(doc);
    }
  }

  console.log(`Found ${docs.length}/${FAILED_TITLES.length} failed documents to retry`);
  console.log(`Source ID: ${SOURCE_ID}`);
  console.log(`LLM_TIMEOUT_MS: 180000 (3 minutes)`);
  console.log();

  let ok = 0, fail = 0;
  const t0 = Date.now();

  await mapLimited(docs, CONCURRENCY, async (doc, i) => {
    const dt = Date.now();
    try {
      const r = await ingestOne(doc);
      ok++;
      console.log(`[${i + 1}/${docs.length}] ✓ ${doc.title}  — ${r.chunkCount ?? "?"} chunks, ${r.eventCount ?? "?"} events  (${((Date.now() - dt) / 1000).toFixed(1)}s)`);
    } catch (err) {
      fail++;
      console.error(`[${i + 1}/${docs.length}] ✗ ${doc.title}  — ${err instanceof Error ? err.message : err}`);
    }
  });

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${ok} succeeded, ${fail} failed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
