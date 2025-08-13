// lib/convert-api/libre-office.ts
import { spawn, execFile } from "node:child_process";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import fsp from "fs/promises";
import pidusage from "pidusage";
import pidtree from "pidtree";

const sofficeCmd =
  process.env.SOFFICE_PATH ||
  (process.platform === "win32"
    ? "C:\\Program Files\\LibreOffice\\program\\soffice.exe"
    : "soffice");

let PERSISTENT_LO_PROFILE: string | null = null;

type LOMetrics = { vcpuMinutes: number; peakBytes: number };

async function getDescendantPids(rootPid: number): Promise<number[]> {
  // 1) cross-platform
  try {
    const pids = (await pidtree(rootPid, { root: true })) as number[];
    if (Array.isArray(pids) && pids.length >= 1) return pids;
  } catch {}
  // 2) Windows fallback (PowerShell Get-CimInstance)
  if (process.platform === "win32") {
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
          ],
          { windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
          (err, out) => (err ? reject(err) : resolve(out))
        );
      });
      const rows: Array<{ ProcessId: number; ParentProcessId: number }> = JSON.parse(stdout);
      const children = new Map<number, number[]>();
      for (const r of rows) {
        const arr = children.get(r.ParentProcessId) || [];
        arr.push(r.ProcessId);
        children.set(r.ParentProcessId, arr);
      }
      const stack = [rootPid];
      const all = new Set<number>([rootPid]);
      while (stack.length) {
        const cur = stack.pop()!;
        for (const c of children.get(cur) || []) if (!all.has(c)) { all.add(c); stack.push(c); }
      }
      return Array.from(all);
    } catch {}
  }
  // 3) Bất đắc dĩ
  return [rootPid];
}

async function runSofficeMeasured(args: string[], opts: any = {}): Promise<LOMetrics> {
  return new Promise<LOMetrics>((resolve, reject) => {
    const child = spawn(sofficeCmd, args, { stdio: ["ignore", "ignore", "pipe"], ...opts });

    let peakLO = 0;
    let cpuMsTotal = 0;
    let last = Date.now();

    const sample = async () => {
      const now = Date.now();
      const dt = Math.max(1, now - last); // ms
      last = now;
      try {
        const pids = await getDescendantPids(child.pid || 0);
        const stats = await pidusage(pids);
        let sumPct = 0;
        let sumMem = 0;
        for (const k of Object.keys(stats)) {
          const s: any = (stats as any)[k];
          sumPct += s?.cpu || 0;      // %
          sumMem += s?.memory || 0;   // bytes
        }
        if (sumMem > peakLO) peakLO = sumMem;
        cpuMsTotal += Math.round(dt * (sumPct / 100));
      } catch {}
    };

    const iv = setInterval(sample, 250);
    sample(); // lấy ngay 1 mẫu đầu

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => { clearInterval(iv); reject(e); });
    child.on("exit", (code) => {
      clearInterval(iv);
      const vcpuMinutes = (cpuMsTotal / 1000) / 60;
      console.log(`[mem-peak] LibreOffice(tree)=${(peakLO/1024/1024).toFixed(1)}MB | child_vcpu_minutes=${vcpuMinutes.toFixed(6)}`);
      if (code === 0) resolve({ vcpuMinutes, peakBytes: peakLO });
      else reject(new Error(`soffice exited ${code}. ${stderr.trim()}`));
    });
  });
}

/**
 * Fallback cũ: nhận Buffer -> ghi ra file tạm -> convert
 * (giữ lại để tương thích; KHÔNG tối ưu RAM bằng convertDocxFile)
 */
export async function convertDocxToPdf(inputDocxBuffer: Buffer) {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "docx2pdf-"));
  const inputPath = path.join(workDir, "input.docx");
  await fsp.writeFile(inputPath, inputDocxBuffer);
  return convertDocxFile(inputPath);
}

/** Khuyên dùng: truyền đường dẫn file trực tiếp */
export async function convertDocxFile(inputPath: string) {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "docx2pdf-"));

  if (!PERSISTENT_LO_PROFILE) {
    PERSISTENT_LO_PROFILE = await fsp.mkdtemp(path.join(os.tmpdir(), "lo-profile-"));
  }
  const loProfileUrl = pathToFileURL(PERSISTENT_LO_PROFILE).href;

  const args = [
    "--headless","--nologo","--nodefault","--nolockcheck","--norestore","--nocrashreport",
    `-env:UserInstallation=${loProfileUrl}`,
    "--convert-to","pdf:writer_pdf_Export",
    inputPath,
    "--outdir",workDir,
  ];

  const lo = await runSofficeMeasured(args);

  const files = await fsp.readdir(workDir);
  const pdf = files.find((f) => f.toLowerCase().endsWith(".pdf"));
  if (!pdf) throw new Error("No PDF produced by LibreOffice");

  return { pdfPath: path.join(workDir, pdf), workDir, lo };
}
