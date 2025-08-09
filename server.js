const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());

// Health check siêu nhẹ
app.get('/health', (req, res) => res.status(200).send('ok'));

app.post('/convert', upload.single('file'), (req, res) => {
  const inputPath = path.resolve(req.file.path);
  const outputDir = path.resolve('./converted');
  const outputFileName = req.file.filename + '.pdf';
  const outputPath = path.join(outputDir, outputFileName);

  fs.mkdirSync(outputDir, { recursive: true });

  // Linux container trên Render: chỉ cần "soffice"
  const libreOfficePath = 'soffice';

  const command = `${libreOfficePath} --headless --convert-to pdf "${inputPath}" --outdir "${outputDir}"`;

  exec(command, (err, stdout, stderr) => {
    if (err) {
      console.error('LibreOffice error:', stderr || err);
      return res.status(500).send('Conversion failed');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=converted.pdf');
    fs.createReadStream(outputPath).pipe(res);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);

  // ===== Keep-Alive mỗi ~10 phút để tránh sleep (Render Free) =====
  // Ưu tiên KEEPALIVE_URL; fallback sang RENDER_EXTERNAL_URL/health
  const base = process.env.KEEPALIVE_URL
    || (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/health` : null);

  // Tránh tự-ping khi dev local
  if (base && process.env.NODE_ENV !== 'development') {
    const INTERVAL = Number(process.env.KEEPALIVE_INTERVAL_MS || 10 * 60 * 1000); // 10 phút
    const jitter = (ms) => ms + Math.floor(Math.random() * 15000); // +0–15s tránh trùng nhịp

    const ping = async () => {
      try {
        // phải gọi PUBLIC URL, không dùng localhost
        const res = await fetch(base, { method: 'GET' });
        console.log('[keepalive]', new Date().toISOString(), res.status);
      } catch (e) {
        // nuốt lỗi, không crash server
        console.log('[keepalive-error]', e?.message || e);
      }
    };

    // Gọi 1 phát sau khi start ~3–8s
    setTimeout(ping, jitter(5000));
    // Gọi định kỳ ~10 phút
    setInterval(ping, jitter(INTERVAL));
  } else {
    console.log('Keepalive disabled (no KEEPALIVE_URL/RENDER_EXTERNAL_URL or NODE_ENV=development).');
  }
});
