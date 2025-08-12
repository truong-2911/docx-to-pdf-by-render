import { spawn } from "child_process";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import fsp from "fs/promises";
import pidusage from "pidusage";

const sofficeCmd =
  process.env.SOFFICE_PATH ||
  (process.platform === "win32"
    ? "C:\\Program Files\\LibreOffice\\program\\soffice.exe"
    : "soffice");

const human = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

let PERSISTENT_LO_PROFILE: string | null = null;

async function runSofficeMeasured(args: string[], opts: any = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(sofficeCmd, args, { stdio: ["ignore","ignore","pipe"], ...opts });

    let peakNode = 0, peakLO = 0, err = "";
    const t = setInterval(async () => {
      const rss = process.memoryUsage().rss || 0;
      if (rss > peakNode) peakNode = rss;
      try {
        const stat = await pidusage(child.pid || 0);
        if (stat?.memory && stat.memory > peakLO) peakLO = stat.memory;
      } catch {}
    }, 300);

    child.stderr.on("data", d => err += d.toString());
    child.on("error", e => { clearInterval(t); reject(e); });
    child.on("exit", code => {
      clearInterval(t);
      console.log(`[mem-peak] Node RSS: ${human(peakNode)} | LibreOffice: ${human(peakLO)} | TOTAL≈ ${human(peakNode + peakLO)}`);
      if (code === 0) resolve();
      else reject(new Error(`soffice exited ${code}. ${err.trim()}`));
    });
  });
}

export async function convertDocxToPdf(inputDocxBuffer: Buffer) {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "docx2pdf-"));
  const inputPath = path.join(workDir, "input.docx");
  await fsp.writeFile(inputPath, inputDocxBuffer);

  try {
    if (!PERSISTENT_LO_PROFILE) {
      PERSISTENT_LO_PROFILE = await fsp.mkdtemp(path.join(os.tmpdir(), "lo-profile-"));
    }
    const loProfileUrl = pathToFileURL(PERSISTENT_LO_PROFILE).href;

    const args = [
      "--headless", "--nologo", "--nodefault", "--nolockcheck", "--norestore", "--nocrashreport",
      `-env:UserInstallation=${loProfileUrl}`,
      "--convert-to", "pdf:writer_pdf_Export",
      inputPath,
      "--outdir", workDir
    ];

    await runSofficeMeasured(args);

    const files = await fsp.readdir(workDir);
    const pdfName = files.find(f => f.toLowerCase().endsWith(".pdf"));
    if (!pdfName) throw new Error("No PDF produced by LibreOffice");
    const pdfPath = path.join(workDir, pdfName);
    return { pdfPath, workDir };
  } catch (e) {
    // giữ workDir cho debug nếu cần
    throw e;
  }
}
