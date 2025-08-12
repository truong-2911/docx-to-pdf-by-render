// lib/convert-api/docx-to-pdf/multipart.ts (streaming-safe)
import { NextRequest } from "next/server";
import os from "os";
import path from "path";
import fsp from "fs/promises";
import fs from "fs";
import Busboy from "busboy";

type Parsed =
  | { fields: Record<string, string>; file?: { path: string; filename: string; size: number } }
  | { fields: Record<string, string> };

async function webStreamToNodeReadable(webReadable: ReadableStream<Uint8Array>) {
  // 1) Thử node:stream (chuẩn Node 18+)
  try {
    const mod: any = await import("node:stream");
    const Readable = mod?.Readable ?? mod?.default?.Readable;
    if (Readable?.fromWeb) return Readable.fromWeb(webReadable as any);
  } catch {}
  // 2) Thử 'stream' (trong một số bundler)
  try {
    const mod: any = await import("stream");
    const Readable = mod?.Readable ?? mod?.default?.Readable;
    if (Readable?.fromWeb) return Readable.fromWeb(webReadable as any);
  } catch {}
  // 3) Fallback: tự chuyển Web → Node bằng getReader()
  const mod: any = await import("node:stream");
  const Readable = mod?.Readable ?? mod?.default?.Readable;
  const nodeReadable: any = new Readable({ read() {} });
  const reader = (webReadable as any).getReader();

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { nodeReadable.push(null); break; }
        nodeReadable.push(Buffer.from(value));
      }
    } catch (err) {
      nodeReadable.destroy(err as any);
    }
  })();

  return nodeReadable;
}

export async function parseMultipartToTmp(
  req: NextRequest,
  { fieldName = "file", maxFileSize = 200 * 1024 * 1024 } = {}
): Promise<Parsed> {
  const ctype = req.headers.get("content-type") || "";
  if (!ctype.includes("multipart/form-data")) return { fields: {} };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "upload-"));
  const bb = Busboy({ headers: { "content-type": ctype }, limits: { fileSize: maxFileSize } });

  const fields: Record<string, string> = {};
  let fileInfo: { path: string; filename: string; size: number } | undefined;

  const done = new Promise<void>((resolve, reject) => {
    bb.on("field", (name, val) => (fields[name] = val));

    bb.on("file", (name, stream, info) => {
      if (name !== fieldName) { stream.resume(); return; }
      const filename = info.filename || "upload.bin";
      const filepath = path.join(tmpDir, filename);
      const ws = fs.createWriteStream(filepath);
      let size = 0;
      stream.on("data", (d: Buffer) => (size += d.length));
      stream.on("end", () => (fileInfo = { path: filepath, filename, size }));
      stream.on("error", reject);
      ws.on("error", reject);
      ws.on("finish", () => {});
      stream.pipe(ws);
    });

    // Busboy kết thúc parse
    bb.on("finish", resolve);
    bb.on("error", reject);
  });

  const webReadable = req.body as ReadableStream<Uint8Array> | null;
  if (!webReadable) return { fields: {} };

  const nodeReadable = await webStreamToNodeReadable(webReadable);
  nodeReadable.pipe(bb);
  await done;

  return { fields, file: fileInfo };
}
