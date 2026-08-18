const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      page_id TEXT REFERENCES pages(id),
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('Database đã sẵn sàng.');
}

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  store: new pgSession({
    pool: pool,
    createTableIfMissing: true
  }),
  secret: 'day-la-chuoi-bi-mat-doi-sau-nay',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
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

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

// Tự động chèn script thu dữ liệu form vào HTML trước khi lưu
function injectFormTracker(htmlCode, pageId) {
  const trackerScript = `
<script>
(function() {
  document.querySelectorAll('form').forEach(function(form) {
    form.addEventListener('submit', function(e) {
      var formData = new FormData(form);
      var data = {};
      formData.forEach(function(value, key) {
        // Tim placeholder cua o input de lam nhan hien thi de doc hon
        var inputEl = form.querySelector('[name="' + key + '"]');
        var label = (inputEl && inputEl.placeholder) ? inputEl.placeholder : key;
        data[label] = value;
      });
      fetch('/page/${pageId}/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(function(err) {
        console.error('Không gửi được dữ liệu form:', err);
      });
      
     }, true);
  });
})();
</script>
`;

  if (htmlCode.toLowerCase().includes('</body>')) {
    return htmlCode.replace(/<\/body>/i, trackerScript + '</body>');
  }
  return htmlCode + trackerScript;
}

// ============ ĐĂNG KÝ ============
app.get('/register', (req, res) => {
  const content = `
    <h1>Đăng ký tài khoản</h1>
    <div class="card">
      <form action="/register" method="POST">
        <input type="email" name="email" placeholder="Email" required style="display:block; width:100%; padding:10px; margin-bottom:12px;" />
        <input type="password" name="password" placeholder="Mật khẩu" required style="display:block; width:100%; padding:10px; margin-bottom:16px;" />
        <button type="submit">Đăng ký</button>
      </form>
      <p style="margin-top:16px;">Đã có tài khoản? <a href="/login">Đăng nhập</a></p>
    </div>
  `;
  res.send(layout(content));
});

app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.send(layout('<p>Vui lòng nhập đầy đủ.</p><a href="/register">Quay lại</a>'));
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
      [email, hash]
    );

    req.session.userId = result.rows[0].id;
    res.redirect('/');
  } catch (err) {
    if (err.code === '23505') {
      return res.send(layout('<p>Email này đã được đăng ký rồi.</p><a href="/register">Quay lại</a>'));
    }
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi đăng ký.</p>'));
  }
});

// ============ ĐĂNG NHẬP ============
app.get('/login', (req, res) => {
  const content = `
    <h1>Đăng nhập</h1>
    <div class="card">
      <form action="/login" method="POST">
        <input type="email" name="email" placeholder="Email" required style="display:block; width:100%; padding:10px; margin-bottom:12px;" />
        <input type="password" name="password" placeholder="Mật khẩu" required style="display:block; width:100%; padding:10px; margin-bottom:16px;" />
        <button type="submit">Đăng nhập</button>
      </form>
      <p style="margin-top:16px;">Chưa có tài khoản? <a href="/register">Đăng ký</a></p>
    </div>
  `;
  res.send(layout(content));
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.send(layout('<p>Email hoặc mật khẩu không đúng.</p><a href="/login">Quay lại</a>'));
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.send(layout('<p>Email hoặc mật khẩu không đúng.</p><a href="/login">Quay lại</a>'));
    }

    req.session.userId = user.id;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi đăng nhập.</p>'));
  }
});

// ============ ĐĂNG XUẤT ============
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ============ TRANG CHỦ ============
app.get('/', requireLogin, (req, res) => {
  const content = `
    <h1>Tạo landing page của bạn</h1>
    <p class="subtitle">Upload file HTML hoặc dán code trực tiếp. <a href="/logout">Đăng xuất</a></p>

    <div class="card">
      <h2>Cách 1: Upload file HTML</h2>
      <form action="/upload" method="POST" enctype="multipart/form-data">
        <input type="file" name="htmlFile" accept=".html" required />
        <button type="submit">Upload</button>
      </form>
    </div>

    <div class="divider">hoặc</div>

    <div class="card">
      <h2>Cách 2: Dán code HTML trực tiếp</h2>
      <form action="/paste" method="POST">
        <textarea name="htmlCode" rows="12" placeholder="Dán code HTML vào đây..."></textarea>
        <button type="submit">Tạo trang</button>
      </form>
    </div>

    <p><a href="/pages">Xem các trang của bạn &rarr;</a></p>
  `;
  res.send(layout(content));
});

app.post('/upload', requireLogin, upload.single('htmlFile'), async (req, res) => {
  if (!req.file) {
    return res.send(layout('<p>Không có file nào được gửi lên.</p><a class="link-back" href="/">&larr; Quay lại</a>'));
  }

  const htmlCode = req.file.buffer.toString('utf-8');
  const id = crypto.randomBytes(6).toString('hex');
  const name = req.file.originalname;
  const finalHtml = injectFormTracker(htmlCode, id);

  try {
    await pool.query(
      'INSERT INTO pages (id, name, html_content, owner_id) VALUES ($1, $2, $3, $4)',
      [id, name, finalHtml, req.session.userId]
    );

    const content = `
      <div class="card" style="text-align: center;">
        <div class="success-icon">&#9989;</div>
        <h2>Upload thành công!</h2>
        <p>Xem trang tại: <a href="/page/${id}" target="_blank">/page/${id}</a></p>
        <a class="link-back" href="/">&larr; Quay lại</a>
      </div>
    `;
    res.send(layout(content));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi lưu vào database.</p>'));
  }
});

app.post('/paste', requireLogin, async (req, res) => {
  const htmlCode = req.body.htmlCode;

  if (!htmlCode || htmlCode.trim() === '') {
    return res.send(layout('<p>Bạn chưa dán code nào cả.</p><a class="link-back" href="/">&larr; Quay lại</a>'));
  }

  const id = crypto.randomBytes(6).toString('hex');
  const name = 'Trang dán code (' + id + ')';
  const finalHtml = injectFormTracker(htmlCode, id);

  try {
    await pool.query(
      'INSERT INTO pages (id, name, html_content, owner_id) VALUES ($1, $2, $3, $4)',
      [id, name, finalHtml, req.session.userId]
    );

    const content = `
      <div class="card" style="text-align: center;">
        <div class="success-icon">&#9989;</div>
        <h2>Tạo trang thành công!</h2>
        <p>Xem trang tại: <a href="/page/${id}" target="_blank">/page/${id}</a></p>
        <a class="link-back" href="/">&larr; Quay lại</a>
      </div>
    `;
    res.send(layout(content));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi lưu vào database.</p>'));
  }
});

app.get('/page/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query('SELECT html_content FROM pages WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).send(layout('<p>Không tìm thấy trang này.</p>'));
    }

    res.send(result.rows[0].html_content);
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi lấy dữ liệu.</p>'));
  }
});

app.post('/page/:id/submit', express.json(), async (req, res) => {
  const pageId = req.params.id;
  const formData = req.body;

  try {
    await pool.query(
      'INSERT INTO submissions (page_id, data) VALUES ($1, $2)',
      [pageId, JSON.stringify(formData)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Có lỗi khi lưu dữ liệu.' });
  }
});

app.get('/page/:id/submissions', requireLogin, async (req, res) => {
  const pageId = req.params.id;

  try {
    const pageCheck = await pool.query(
      'SELECT name FROM pages WHERE id = $1 AND owner_id = $2',
      [pageId, req.session.userId]
    );

    if (pageCheck.rows.length === 0) {
      return res.status(403).send(layout('<p>Bạn không có quyền xem trang này.</p>'));
    }

    const result = await pool.query(
      'SELECT data, created_at FROM submissions WHERE page_id = $1 ORDER BY created_at DESC',
      [pageId]
    );

    let html = `<h1>Dữ liệu form: ${pageCheck.rows[0].name}</h1><div class="card">`;

    if (result.rows.length === 0) {
      html += '<p>Chưa có ai gửi form nào.</p>';
    } else {
      html += '<ul class="page-list">';
      result.rows.forEach(row => {
        const fields = Object.entries(row.data)
          .map(([key, value]) => `<strong>${key}:</strong> ${value}`)
          .join(' &nbsp;|&nbsp; ');
        html += `
          <li style="display: block;">
            <div>${fields}</div>
            <div class="page-time">${new Date(row.created_at).toLocaleString('vi-VN')}</div>
          </li>
        `;
      });
      html += '</ul>';
    }

    html += '</div><a class="link-back" href="/pages">&larr; Quay lại danh sách trang</a>';
    res.send(layout(html));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi lấy dữ liệu.</p>'));
  }
});

app.post('/page/:id/delete', requireLogin, async (req, res) => {
  const id = req.params.id;

  try {
    await pool.query(
      'DELETE FROM pages WHERE id = $1 AND owner_id = $2',
      [id, req.session.userId]
    );
    res.redirect('/pages');
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi xóa trang.</p>'));
  }
});

app.post('/page/:id/rename', requireLogin, async (req, res) => {
  const id = req.params.id;
  const newName = req.body.newName;

  if (!newName || newName.trim() === '') {
    return res.redirect('/pages');
  }

  try {
    await pool.query(
      'UPDATE pages SET name = $1 WHERE id = $2 AND owner_id = $3',
      [newName.trim(), id, req.session.userId]
    );
    res.redirect('/pages');
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi đổi tên.</p>'));
  }
});

app.get('/pages', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, created_at FROM pages WHERE owner_id = $1 ORDER BY created_at DESC',
      [req.session.userId]
    );
    const pages = result.rows;

    let listHtml = `
      <h1>Trang của bạn</h1>
      <p class="subtitle">Các trang bạn đã tạo</p>
      <div class="card">
    `;

    if (pages.length === 0) {
      listHtml += '<p>Chưa có trang nào.</p>';
    } else {
      listHtml += '<ul class="page-list">';
      pages.forEach(page => {
        listHtml += `
          <li>
            <div style="flex: 1;">
              <a href="/page/${page.id}" target="_blank">${page.name}</a>
              <div class="page-time">${new Date(page.created_at).toLocaleString('vi-VN')}</div>
              <div><a href="/page/${page.id}/submissions" style="font-size: 13px;">Xem dữ liệu form &rarr;</a></div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <form action="/page/${page.id}/rename" method="POST" style="display: flex; gap: 6px;">
                <input type="text" name="newName" placeholder="Tên mới" style="padding: 6px; font-size: 13px; width: 120px;" />
                <button type="submit" style="padding: 6px 12px; font-size: 13px;">Đổi tên</button>
              </form>
              <form action="/page/${page.id}/delete" method="POST" onsubmit="return confirm('Bạn chắc chắn muốn xóa trang này?');">
                <button type="submit" style="padding: 6px 12px; font-size: 13px; background: #dc2626;">Xóa</button>
              </form>
            </div>
          </li>
        `;
      });
      listHtml += '</ul>';
    }

    listHtml += '</div><a class="link-back" href="/">&larr; Quay lại trang tạo mới</a>';
    res.send(layout(listHtml));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi lấy danh sách.</p>'));
  }
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
  });
});