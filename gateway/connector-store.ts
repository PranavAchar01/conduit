// Tigris-backed persistence for generated connectors.
// Stores code + service metadata (never secret values) so connectors survive redeploy.
// On boot, env values are re-read from process.env by name.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const PREFIX = "conduit-connectors/";

interface StoreRecord {
  code: string;
  serviceId?: string;
  /** Env var names (NOT values) needed at runtime — values are read from process.env on restore. */
  envKeys?: string[];
}

function makeClient(): S3Client | null {
  const bucket = process.env.TIGRIS_BUCKET;
  const key = process.env.AWS_ACCESS_KEY_ID;
  if (!bucket || !key) return null;
  return new S3Client({
    region: process.env.TIGRIS_REGION ?? "auto",
    endpoint: process.env.TIGRIS_ENDPOINT_URL ?? "https://t3.storage.dev",
    forcePathStyle: false,
  });
}

export async function saveConnector(
  name: string,
  code: string,
  serviceId?: string,
  envKeys?: string[],
): Promise<void> {
  const s3 = makeClient();
  const bucket = process.env.TIGRIS_BUCKET;
  if (!s3 || !bucket) return;
  const record: StoreRecord = { code, serviceId, envKeys };
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${PREFIX}${name}.json`,
      Body: JSON.stringify(record),
      ContentType: "application/json",
    }),
  );
  console.error(`[store] saved connector "${name}" to Tigris`);
}

export interface StoredConnector {
  name: string;
  code: string;
  serviceId?: string;
  envKeys?: string[];
}

export async function listSavedConnectors(): Promise<StoredConnector[]> {
  const s3 = makeClient();
  const bucket = process.env.TIGRIS_BUCKET;
  if (!s3 || !bucket) return [];
  try {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX }));
    const results: StoredConnector[] = [];
    for (const obj of list.Contents ?? []) {
      if (!obj.Key?.endsWith(".json")) continue;
      const name = obj.Key.slice(PREFIX.length, -5);
      if (!name) continue;
      try {
        const get = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
        const raw = (await get.Body?.transformToString()) ?? "";
        if (!raw) continue;
        const record: StoreRecord = JSON.parse(raw);
        results.push({ name, ...record });
      } catch {
        console.error(`[store] failed to fetch stored connector "${name}"`);
      }
    }
    return results;
  } catch (err) {
    console.error(`[store] listSavedConnectors failed: ${(err as Error).message}`);
    return [];
  }
}

export async function writeConnectorToDisk(dir: string, name: string, code: string): Promise<string> {
  const path = `${dir}${name}/index.ts`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, code, "utf8");
  return path;
}
