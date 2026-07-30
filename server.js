const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Ket noi toi database, lay chuoi ket noi tu bien moi truong DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Tao bang "pages" trong database neu chua co
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      html_content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('Database da san sang.');
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

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
    <p class="subtitle">Dan code HTML, nhan link ngay.</p>

    <div class="card">
      <h2>Dan code HTML truc tiep</h2>
      <form action="/paste" method="POST">
        <textarea name="htmlCode" rows="12" placeholder="Dan code HTML vao day..."></textarea>
        <button type="submit">Tao trang</button>
      </form>
    </div>

    <p><a href="/pages">Xem danh sach tat ca cac trang da tao &rarr;</a></p>
  `;
  res.send(layout(content));
});

// Tao trang moi: luu thang noi dung HTML vao database
app.post('/paste', async (req, res) => {
  const htmlCode = req.body.htmlCode;

  if (!htmlCode || htmlCode.trim() === '') {
    return res.send(layout('<p>Ban chua dan code nao ca.</p><a class="link-back" href="/">&larr; Quay lai</a>'));
  }

  const id = require('crypto').randomBytes(6).toString('hex');
  const name = 'Trang dan code (' + id + ')';

  try {
    await pool.query(
      'INSERT INTO pages (id, name, html_content) VALUES ($1, $2, $3)',
      [id, name, htmlCode]
    );

    const content = `
      <div class="card" style="text-align: center;">
        <div class="success-icon">&#9989;</div>
        <h2>Tao trang thanh cong!</h2>
        <p>Xem trang tai: <a href="/page/${id}" target="_blank">/page/${id}</a></p>
        <a class="link-back" href="/">&larr; Quay lai</a>
      </div>
    `;
    res.send(layout(content));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Co loi khi luu vao database.</p>'));
  }
});

// Xem lai 1 trang: lay noi dung HTML tu database
app.get('/page/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query('SELECT html_content FROM pages WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).send(layout('<p>Khong tim thay trang nay.</p>'));
    }

    res.send(result.rows[0].html_content);
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Co loi khi lay du lieu.</p>'));
  }
});

// Danh sach tat ca cac trang
app.get('/pages', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, created_at FROM pages ORDER BY created_at DESC');
    const pages = result.rows;

    let listHtml = `
      <h1>Danh sach cac trang</h1>
      <p class="subtitle">Tat ca cac trang ban da tao</p>
      <div class="card">
    `;

    if (pages.length === 0) {
      listHtml += '<p>Chua co trang nao.</p>';
    } else {
      listHtml += '<ul class="page-list">';
      pages.forEach(page => {
        listHtml += `
          <li>
            <a href="/page/${page.id}" target="_blank">${page.name}</a>
            <span class="page-time">${new Date(page.created_at).toLocaleString('vi-VN')}</span>
          </li>
        `;
      });
      listHtml += '</ul>';
    }

    listHtml += '</div><a class="link-back" href="/">&larr; Quay lai trang tao moi</a>';
    res.send(layout(listHtml));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Co loi khi lay danh sach.</p>'));
  }
});

// Khoi dong: tao bang truoc, roi moi mo server
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server dang chay tai port ${PORT}`);
  });
});