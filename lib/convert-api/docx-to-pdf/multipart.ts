// lib/convert-api/docx-to-pdf/multipart.ts
import { NextRequest } from "next/server";
import os from "os";
import path from "path";
import fsp from "fs/promises";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import busboy from "busboy";

export async function parseMultipartToTmp(
  req: NextRequest,
  { fieldName = "file", maxFileSize = 200 * 1024 * 1024 } = {}
): Promise<{
  fields: Record<string, string>;
  file?: { path: string; filename: string; size: number };
}> {
  // 1) Kiểm tra header
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return { fields: {} };
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "upload-"));
  const bb = busboy({
    headers: { "content-type": contentType },
    limits: { fileSize: maxFileSize },
  });

  const fields: Record<string, string> = {};
  let fileInfo: { path: string; filename: string; size: number } | undefined;

  const fileWrites: Promise<void>[] = [];

  const done = new Promise<void>((resolve, reject) => {
    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (name, stream, info) => {
      if (name !== fieldName) {
        // Không phải field file mong muốn -> bỏ qua
        stream.resume();
        return;
      }
      const filename = info.filename || "upload.bin";
      const filepath = path.join(tmpDir, filename);

      let size = 0;
      stream.on("data", (chunk: Buffer) => (size += chunk.length));

      const out = createWriteStream(filepath);
      const p = new Promise<void>((res, rej) => {
        out.on("close", () => {
          fileInfo = { path: filepath, filename, size };
          res();
        });
        out.on("error", rej);
      });

      stream.pipe(out);
      fileWrites.push(p);
    });

    bb.on("error", reject);

    // ✅ Chờ tất cả fileWrites xong rồi mới resolve
    bb.on("finish", async () => {
      try {
        await Promise.all(fileWrites);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });

  // 2) Stream body → Busboy (không cần arrayBuffer)
  const nodeReadable = Readable.fromWeb(req.body as any);
  nodeReadable.pipe(bb);

  await done;
  return { fields, file: fileInfo };
}
