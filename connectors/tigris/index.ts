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
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
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
    name: "list_objects",
    description: "List object keys in a bucket (optionally under a prefix).",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name (defaults to TIGRIS_BUCKET)" },
        prefix: { type: "string", description: "Optional key prefix" },
      },
    },
  },
  {
    name: "upload",
    description: "Upload (put) a text object to a bucket at the given key.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name (defaults to TIGRIS_BUCKET)" },
        key: { type: "string", description: "Object key" },
        content: { type: "string", description: "Text content to store" },
      },
      required: ["key", "content"],
    },
  },
  {
    name: "read",
    description: "Read a text object from a bucket by key.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name (defaults to TIGRIS_BUCKET)" },
        key: { type: "string", description: "Object key" },
      },
      required: ["key"],
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
    case "list_objects": {
      const out = await s3.send(
        new ListObjectsV2Command({ Bucket: bucketOf(args), Prefix: (args.prefix as string) || undefined }),
      );
      const keys = (out.Contents ?? []).map((o) => o.Key).filter(Boolean).join("\n");
      return { content: [{ type: "text" as const, text: keys || "(empty)" }] };
    }
    case "upload": {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketOf(args),
          Key: String(args.key),
          Body: String(args.content ?? ""),
          ContentType: "text/plain",
        }),
      );
      return { content: [{ type: "text" as const, text: `uploaded ${args.key}` }] };
    }
    case "read": {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucketOf(args), Key: String(args.key) }));
      const body = await out.Body?.transformToString();
      return { content: [{ type: "text" as const, text: body ?? "" }] };
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
