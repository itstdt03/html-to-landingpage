const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Tao cac bang can thiet neu chua co
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      html_content TEXT NOT NULL,
      owner_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('Database da san sang.');
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Cau hinh session: luu vao database, khong luu tren o dia tam
app.use(session({
  store: new pgSession({ pool: pool }),
  secret: 'day-la-chuoi-bi-mat-doi-sau-nay',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // Cookie song 7 ngay
}));

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

// Middleware: kiem tra da dang nhap chua, chan neu chua
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

// ============ TRANG DANG KY ============
app.get('/register', (req, res) => {
  const content = `
    <h1>Dang ky tai khoan</h1>
    <div class="card">
      <form action="/register" method="POST">
        <input type="email" name="email" placeholder="Email" required style="display:block; width:100%; padding:10px; margin-bottom:12px;" />
        <input type="password" name="password" placeholder="Mat khau" required style="display:block; width:100%; padding:10px; margin-bottom:16px;" />
        <button type="submit">Dang ky</button>
      </form>
      <p style="margin-top:16px;">Da co tai khoan? <a href="/login">Dang nhap</a></p>
    </div>
  `;
  res.send(layout(content));
});

app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.send(layout('<p>Vui long nhap day du.</p><a href="/register">Quay lai</a>'));
  }

  try {
    // Ma hoa mat khau truoc khi luu - khong bao gio luu mat khau thuong
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
      [email, hash]
    );

    // Tu dong dang nhap luon sau khi dang ky
    req.session.userId = result.rows[0].id;
    res.redirect('/');
  } catch (err) {
    if (err.code === '23505') {
      // Loi trung email (unique constraint)
      return res.send(layout('<p>Email nay da duoc dang ky roi.</p><a href="/register">Quay lai</a>'));
    }
    console.error(err);
    res.status(500).send(layout('<p>Co loi khi dang ky.</p>'));
  }
});

// ============ TRANG DANG NHAP ============
app.get('/login', (req, res) => {
  const content = `
    <h1>Dang nhap</h1>
    <div class="card">
      <form action="/login" method="POST">
        <input type="email" name="email" placeholder="Email" required style="display:block; width:100%; padding:10px; margin-bottom:12px;" />
        <input type="password" name="password" placeholder="Mat khau" required style="display:block; width:100%; padding:10px; margin-bottom:16px;" />
        <button type="submit">Dang nhap</button>
      </form>
      <p style="margin-top:16px;">Chua co tai khoan? <a href="/register">Dang ky</a></p>
    </div>
  `;
  res.send(layout(content));
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.send(layout('<p>Email hoac mat khau khong dung.</p><a href="/login">Quay lai</a>'));
    }

    const user = result.rows[0];
    // So sanh mat khau nhap vao voi ban da ma hoa trong database
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.send(layout('<p>Email hoac mat khau khong dung.</p><a href="/login">Quay lai</a>'));
    }

    req.session.userId = user.id;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Co loi khi dang nhap.</p>'));
  }
});

// ============ DANG XUAT ============
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ============ TRANG CHU (can dang nhap) ============
app.get('/', requireLogin, (req, res) => {
  const content = `
    <h1>Tao landing page cua ban</h1>
    <p class="subtitle">Dan code HTML, nhan link ngay. <a href="/logout">Dang xuat</a></p>

    <div class="card">
      <h2>Dan code HTML truc tiep</h2>
      <form action="/paste" method="POST">
        <textarea name="htmlCode" rows="12" placeholder="Dan code HTML vao day..."></textarea>
        <button type="submit">Tao trang</button>
      </form>
    </div>

    <p><a href="/pages">Xem cac trang cua ban &rarr;</a></p>
  `;
  res.send(layout(content));
});

app.post('/paste', requireLogin, async (req, res) => {
  const htmlCode = req.body.htmlCode;

  if (!htmlCode || htmlCode.trim() === '') {
    return res.send(layout('<p>Ban chua dan code nao ca.</p><a class="link-back" href="/">&larr; Quay lai</a>'));
  }

  const id = require('crypto').randomBytes(6).toString('hex');
  const name = 'Trang dan code (' + id + ')';

  try {
    await pool.query(
      'INSERT INTO pages (id, name, html_content, owner_id) VALUES ($1, $2, $3, $4)',
      [id, name, htmlCode, req.session.userId]
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

// Xem trang - KHONG can dang nhap, vi day la link cong khai cho nguoi khac xem
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

// Danh sach trang - chi hien thi trang cua CHINH nguoi dang dang nhap
app.get('/pages', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, created_at FROM pages WHERE owner_id = $1 ORDER BY created_at DESC',
      [req.session.userId]
    );
    const pages = result.rows;

    let listHtml = `
      <h1>Trang cua ban</h1>
      <p class="subtitle">Cac trang ban da tao</p>
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

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server dang chay tai port ${PORT}`);
  });
});