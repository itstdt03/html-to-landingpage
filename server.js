const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const dataFile = path.join(__dirname, 'pages.json');
if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, '[]');
}

function readPages() {
  const raw = fs.readFileSync(dataFile, 'utf-8');
  return JSON.parse(raw);
}

function savePages(pages) {
  fs.writeFileSync(dataFile, JSON.stringify(pages, null, 2));
}

const upload = multer({ dest: uploadDir });

app.use(express.urlencoded({ extended: true }));

// Cho phep server phuc vu file tinh (CSS, anh...) tu thu muc "public"
app.use(express.static(path.join(__dirname, 'public')));

// Ham tien ich: bao ngoai 1 khung giao dien chung cho tat ca cac trang
function layout(content) {
  return `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8" />
      <title>HTML to Landingpage</title>
      <link rel="stylesheet" href="/style.css" />
    </head>
    <body>
      <div class="container">
        ${content}
      </div>
    </body>
    </html>
  `;
}

app.get('/', (req, res) => {
  const content = `
    <h1>Tao landing page cua ban</h1>
    <p class="subtitle">Upload file HTML hoac dan code truc tiep, nhan link ngay.</p>

    <div class="card">
      <h2>Cach 1: Upload file HTML</h2>
      <form action="/upload" method="POST" enctype="multipart/form-data">
        <input type="file" name="htmlFile" accept=".html" required />
        <button type="submit">Upload</button>
      </form>
    </div>

    <div class="card">
      <h2>Cach 2: Dan code HTML truc tiep</h2>
      <form action="/paste" method="POST">
        <textarea name="htmlCode" rows="12" placeholder="Dan code HTML vao day..."></textarea>
        <button type="submit">Tao trang</button>
      </form>
    </div>

    <p><a href="/pages">Xem danh sach tat ca cac trang da tao &rarr;</a></p>
  `;
  res.send(layout(content));
});

app.post('/upload', upload.single('htmlFile'), (req, res) => {
  if (!req.file) {
    return res.send(layout('<p>Khong co file nao duoc gui len.</p><a class="link-back" href="/">&larr; Quay lai</a>'));
  }

  const id = req.file.filename;
  const finalName = id + '.html';
  fs.renameSync(req.file.path, path.join(uploadDir, finalName));

  const pages = readPages();
  pages.push({
    id: id,
    name: req.file.originalname,
    createdAt: new Date().toISOString()
  });
  savePages(pages);

  const content = `
    <div class="card" style="text-align: center;">
      <div class="success-icon">&#9989;</div>
      <h2>Upload thanh cong!</h2>
      <p>Xem trang tai: <a href="/page/${id}" target="_blank">/page/${id}</a></p>
      <a class="link-back" href="/">&larr; Quay lai</a>
    </div>
  `;
  res.send(layout(content));
});

app.post('/paste', (req, res) => {
  const htmlCode = req.body.htmlCode;

  if (!htmlCode || htmlCode.trim() === '') {
    return res.send(layout('<p>Ban chua dan code nao ca.</p><a class="link-back" href="/">&larr; Quay lai</a>'));
  }

  const id = crypto.randomBytes(6).toString('hex');
  const filePath = path.join(uploadDir, id + '.html');

  fs.writeFileSync(filePath, htmlCode);

  const pages = readPages();
  pages.push({
    id: id,
    name: 'Trang dan code (' + id + ')',
    createdAt: new Date().toISOString()
  });
  savePages(pages);

  const content = `
    <div class="card" style="text-align: center;">
      <div class="success-icon">&#9989;</div>
      <h2>Tao trang thanh cong!</h2>
      <p>Xem trang tai: <a href="/page/${id}" target="_blank">/page/${id}</a></p>
      <a class="link-back" href="/">&larr; Quay lai</a>
    </div>
  `;
  res.send(layout(content));
});

app.get('/page/:id', (req, res) => {
  const id = req.params.id;
  const filePath = path.join(uploadDir, id + '.html');

  if (!fs.existsSync(filePath)) {
    return res.status(404).send(layout('<p>Khong tim thay trang nay.</p>'));
  }

  res.sendFile(filePath);
});

app.get('/pages', (req, res) => {
  const pages = readPages();

  let listHtml = `
    <h1>Danh sach cac trang</h1>
    <p class="subtitle">Tat ca cac trang ban da tao</p>
    <div class="card">
  `;

  if (pages.length === 0) {
    listHtml += '<p>Chua co trang nao.</p>';
  } else {
    listHtml += '<ul class="page-list">';
    pages.slice().reverse().forEach(page => {
      listHtml += `
        <li>
          <a href="/page/${page.id}" target="_blank">${page.name}</a>
          <span class="page-time">${new Date(page.createdAt).toLocaleString('vi-VN')}</span>
        </li>
      `;
    });
    listHtml += '</ul>';
  }

  listHtml += '</div><a class="link-back" href="/">&larr; Quay lai trang tao moi</a>';

  res.send(layout(listHtml));
});

app.listen(PORT, () => {
  console.log(`Server dang chay tai: http://localhost:${PORT}`);
});