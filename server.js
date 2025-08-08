const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());

app.post('/convert', upload.single('file'), (req, res) => {
  const inputPath = path.resolve(req.file.path);
  const outputDir = path.resolve('./converted');
  const outputFileName = req.file.filename + '.pdf';
  const outputPath = path.join(outputDir, outputFileName);

  fs.mkdirSync(outputDir, { recursive: true });

  const libreOfficePath = 'soffice'; // ✅ Linux-compatible

  const command = `${libreOfficePath} --headless --convert-to pdf "${inputPath}" --outdir "${outputDir}"`;

  exec(command, (err, stdout, stderr) => {
    if (err) {
      console.error(stderr);
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
});
