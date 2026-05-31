// Tigris-backed persistence for generated connectors.
// Saves each connector's source to the frontier bucket under conduit-connectors/.
// On gateway boot, loadSavedConnectors() restores them so they survive redeployment.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const PREFIX = "conduit-connectors/";

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

export async function saveConnector(name: string, code: string): Promise<void> {
  const s3 = makeClient();
  const bucket = process.env.TIGRIS_BUCKET;
  if (!s3 || !bucket) return;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${PREFIX}${name}.ts`,
      Body: code,
      ContentType: "text/plain",
    }),
  );
  console.error(`[store] saved connector "${name}" to Tigris`);
}

export interface StoredConnector {
  name: string;
  code: string;
}

export async function listSavedConnectors(): Promise<StoredConnector[]> {
  const s3 = makeClient();
  const bucket = process.env.TIGRIS_BUCKET;
  if (!s3 || !bucket) return [];
  try {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX }));
    const results: StoredConnector[] = [];
    for (const obj of list.Contents ?? []) {
      if (!obj.Key?.endsWith(".ts")) continue;
      const name = obj.Key.slice(PREFIX.length, -3);
      if (!name) continue;
      try {
        const get = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
        const code = (await get.Body?.transformToString()) ?? "";
        if (code) results.push({ name, code });
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
