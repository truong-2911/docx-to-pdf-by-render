// lib/convert-api/docx-to-pdf/multipart.ts (streaming)
import { NextRequest } from "next/server";
import os from "os";
import path from "path";
import fsp from "fs/promises";
import fs from "fs";
import Busboy from "busboy";

export async function parseMultipartToTmp(
  req: NextRequest,
  { fieldName = "file", maxFileSize = 200 * 1024 * 1024 } = {}
): Promise<{ fields: Record<string, string>; file?: { path: string; filename: string; size: number } }> {
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

    bb.on("close", resolve);
    bb.on("error", reject);
  });

  // pipe web stream -> busboy
  const webReadable = req.body as ReadableStream<Uint8Array> | null;
  if (!webReadable) return { fields: {} };

  // Convert Web ReadableStream to Node stream
  const nodeReadable = (await import("stream")).Readable.fromWeb(webReadable as any);
  nodeReadable.pipe(bb);
  await done;

  return { fields, file: fileInfo };
}
