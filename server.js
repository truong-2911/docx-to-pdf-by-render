const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());

// Lưu file upload vào thư mục tạm của hệ điều hành
const upload = multer({ dest: os.tmpdir() });

// Health check siêu nhẹ
app.get('/health', (req, res) => res.status(200).send('ok'));

function runSoffice(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('soffice', args, opts, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

app.post('/convert', upload.single('file'), async (req, res) => {
  // Tạo 1 thư mục tạm RIÊNG cho request này để dễ dọn
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'docx2pdf-'));
  const inputPath = req.file.path; // đường dẫn file DOCX do multer tạo

  try {
    // Convert bằng LibreOffice (Linux: chỉ cần 'soffice')
    const args = [
      '--headless',
      '--convert-to', 'pdf',
      inputPath,
      '--outdir', workDir,
    ];
    await runSoffice(args);

    // Tìm file PDF vừa sinh ra trong workDir (tên được tạo từ basename của input)
    const files = await fsp.readdir(workDir);
    const pdfName = files.find(f => f.toLowerCase().endsWith('.pdf'));
    if (!pdfName) throw new Error('PDF not found after conversion.');
    const pdfPath = path.join(workDir, pdfName);

    // Đọc PDF thành buffer và gửi về cho client
    const base = path.parse(req.file.originalname || 'converted').name;
    const pdfBuffer = await fsp.readFile(pdfPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    console.error('LibreOffice error:', e);
    res.status(500).send('Conversion failed');
  } finally {
    // Dọn rác: xoá file input và cả thư mục tạm (chứa PDF)
    setImmediate(async () => {
      try { await fsp.unlink(inputPath); } catch (_) {}
      try { await fsp.rm(workDir, { recursive: true, force: true }); } catch (_) {}
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);

  // ===== Keep-Alive mỗi ~10 phút để tránh sleep (Render Free) =====
  // Ưu tiên KEEPALIVE_URL; fallback sang RENDER_EXTERNAL_URL/health
  const base =
    process.env.KEEPALIVE_URL ||
    (process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/health`
      : null);

  if (base && process.env.NODE_ENV !== 'development') {
    const INTERVAL =
      Number(process.env.KEEPALIVE_INTERVAL_MS || 10 * 60 * 1000); // 10 phút
    const jitter = (ms) => ms + Math.floor(Math.random() * 15000); // +0–15s

    const ping = async () => {
      try {
        const res = await fetch(base, { method: 'GET' });
        console.log('[keepalive]', new Date().toISOString(), res.status);
      } catch (e) {
        console.log('[keepalive-error]', e?.message || e);
      }
    };

    setTimeout(ping, jitter(5000));       // ping sớm sau khi start
    setInterval(ping, jitter(INTERVAL));  // ping định kỳ
  } else {
    console.log(
      'Keepalive disabled (no KEEPALIVE_URL/RENDER_EXTERNAL_URL or NODE_ENV=development).'
    );
  }
});
