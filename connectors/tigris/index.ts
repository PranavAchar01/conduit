// ─────────────────────────────────────────────────────────────────────────────
// TIGRIS CONNECTOR (prebuilt — ships in repo, §4 item 2)
// Tigris is S3-compatible, so we wrap the AWS S3 client pointed at the Tigris
// endpoint. Credentials/endpoint come from env (AWS_ACCESS_KEY_ID etc.).
// ─────────────────────────────────────────────────────────────────────────────
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  S3Client,
  ListBucketsCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.TIGRIS_REGION ?? "auto",
  endpoint: process.env.TIGRIS_ENDPOINT_URL ?? "https://t3.storage.dev",
  // Credentials are read by the SDK from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
  forcePathStyle: false,
});

const DEFAULT_BUCKET = process.env.TIGRIS_BUCKET;

function bucketOf(args: Record<string, unknown>): string {
  const b = (args.bucket as string) || DEFAULT_BUCKET;
  if (!b) throw new Error("no bucket given and TIGRIS_BUCKET is unset");
  return b;
}

const TOOLS: Tool[] = [
  { name: "list_buckets", description: "List all Tigris buckets.", inputSchema: { type: "object", properties: {} } },
  {
    name: "create_bucket",
    description: "Create a new Tigris bucket.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name to create" },
      },
      required: ["bucket"],
    },
  },
  {
    name: "list_objects",
    description: "List object keys in a bucket (optionally under a prefix).",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name (defaults to TIGRIS_BUCKET)" },
        prefix: { type: "string", description: "Optional key prefix" },
        max_keys: { type: "number", description: "Max results (default 1000)" },
      },
    },
  },
  {
    name: "upload",
    description: "Upload (put) a text or JSON object to a bucket at the given key.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name (defaults to TIGRIS_BUCKET)" },
        key: { type: "string", description: "Object key / path" },
        content: { type: "string", description: "Text or JSON content to store" },
        content_type: { type: "string", description: "MIME type (default text/plain)" },
      },
      required: ["key", "content"],
    },
  },
  {
    name: "read",
    description: "Read an object from a bucket by key. Returns its text content.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name (defaults to TIGRIS_BUCKET)" },
        key: { type: "string", description: "Object key" },
      },
      required: ["key"],
    },
  },
  {
    name: "stat",
    description: "Get metadata (size, last modified, content-type) for an object without downloading it.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name (defaults to TIGRIS_BUCKET)" },
        key: { type: "string", description: "Object key" },
      },
      required: ["key"],
    },
  },
  {
    name: "delete_object",
    description: "Delete a single object from a bucket.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name (defaults to TIGRIS_BUCKET)" },
        key: { type: "string", description: "Object key to delete" },
      },
      required: ["key"],
    },
  },
  {
    name: "delete_objects",
    description: "Delete multiple objects from a bucket in one call (up to 1000 keys).",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name (defaults to TIGRIS_BUCKET)" },
        keys: { type: "array", items: { type: "string" }, description: "List of object keys to delete" },
      },
      required: ["keys"],
    },
  },
];

async function handleCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "list_buckets": {
      const out = await s3.send(new ListBucketsCommand({}));
      const names = (out.Buckets ?? []).map((b) => b.Name).filter(Boolean).join("\n");
      return { content: [{ type: "text" as const, text: names || "(no buckets)" }] };
    }
    case "create_bucket": {
      const bucket = String(args.bucket ?? "").trim();
      if (!bucket) throw new Error("bucket name required");
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      return { content: [{ type: "text" as const, text: `created bucket ${bucket}` }] };
    }
    case "list_objects": {
      const out = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketOf(args),
          Prefix: (args.prefix as string) || undefined,
          MaxKeys: args.max_keys ? Number(args.max_keys) : 1000,
        }),
      );
      const rows = (out.Contents ?? []).map((o) => `${o.Key}\t${o.Size}B\t${o.LastModified?.toISOString() ?? ""}`);
      return { content: [{ type: "text" as const, text: rows.join("\n") || "(empty)" }] };
    }
    case "upload": {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketOf(args),
          Key: String(args.key),
          Body: String(args.content ?? ""),
          ContentType: String(args.content_type ?? "text/plain"),
        }),
      );
      return { content: [{ type: "text" as const, text: `uploaded ${args.key}` }] };
    }
    case "read": {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucketOf(args), Key: String(args.key) }));
      const body = await out.Body?.transformToString();
      return { content: [{ type: "text" as const, text: body ?? "" }] };
    }
    case "stat": {
      const out = await s3.send(new HeadObjectCommand({ Bucket: bucketOf(args), Key: String(args.key) }));
      const info = JSON.stringify({
        size: out.ContentLength,
        lastModified: out.LastModified,
        contentType: out.ContentType,
        etag: out.ETag,
      }, null, 2);
      return { content: [{ type: "text" as const, text: info }] };
    }
    case "delete_object": {
      await s3.send(new DeleteObjectCommand({ Bucket: bucketOf(args), Key: String(args.key) }));
      return { content: [{ type: "text" as const, text: `deleted ${args.key}` }] };
    }
    case "delete_objects": {
      const keys = (args.keys as string[]).map((k) => ({ Key: k }));
      const out = await s3.send(
        new DeleteObjectsCommand({ Bucket: bucketOf(args), Delete: { Objects: keys } }),
      );
      const deleted = (out.Deleted ?? []).length;
      const errors = (out.Errors ?? []).map((e) => `${e.Key}: ${e.Message}`).join(", ");
      return { content: [{ type: "text" as const, text: `deleted ${deleted} objects${errors ? ` | errors: ${errors}` : ""}` }] };
    }
    default:
      return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true };
  }
}

const server = new Server({ name: "tigris", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    return await handleCall(req.params.name, args);
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: `Error in ${req.params.name}: ${(err as Error).message}` }],
      isError: true,
    };
  }
});
await server.connect(new StdioServerTransport());
