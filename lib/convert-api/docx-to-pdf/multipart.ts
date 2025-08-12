import Busboy from "busboy";
import os from "os";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { Readable } from "stream";
import type { NextRequest } from "next/server";

export type UploadedFile = {
  fieldname: string;
  filename: string;
  mimeType: string;
  path: string;
  size: number;
};

export async function parseMultipartToTmp(
  req: NextRequest,
  opts: { fieldName?: string; maxFileSize?: number } = {}
): Promise<{ fields: Record<string, string>; file?: UploadedFile }> {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new Error("Content-Type must be multipart/form-data");
  }

  const maxFileSize = opts.maxFileSize ?? 200 * 1024 * 1024; // 200MB
  const fieldName = opts.fieldName || "file";

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "upload-"));
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

  const busboy = Busboy({ headers, limits: { fileSize: maxFileSize } });
  const nodeStream = Readable.fromWeb(req.body as any);

  const fields: Record<string, string> = {};
  let uploaded: UploadedFile | undefined;
  const fileWrites: Promise<void>[] = [];

  const done = new Promise<void>((resolve, reject) => {
    busboy.on("field", (name, val) => {
      fields[name] = val;
    });

    busboy.on("file", (name, file, info) => {
      const { filename, mimeType } = info;
      const safe = (filename || "upload.bin").replace(/[^\w.\-]+/g, "_");
      const outPath = path.join(tmpRoot, `${Date.now()}_${safe}`);
      const write = fs.createWriteStream(outPath, { flags: "w" });
      let size = 0;

      file.on("data", (d: Buffer) => (size += d.length));
      file.on("limit", () => reject(new Error("File too large")));
      file.pipe(write);

      const p = new Promise<void>((res, rej) => {
        write.on("finish", () => {
          if (name === fieldName) {
            uploaded = { fieldname: name, filename: safe, mimeType, path: outPath, size };
          }
          res();
        });
        write.on("error", rej);
      });

      fileWrites.push(p);
    });

    busboy.on("error", reject);
    busboy.on("finish", async () => {
      try {
        // 🔴 chờ toàn bộ file ghi xong mới resolve
        await Promise.all(fileWrites);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });

  nodeStream.pipe(busboy);
  await done;

  return { fields, file: uploaded };
}
