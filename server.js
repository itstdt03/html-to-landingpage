const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

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

  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'live'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      page_id TEXT REFERENCES pages(id),
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_page_id_fkey`);
  await pool.query(`
    ALTER TABLE submissions
    ADD CONSTRAINT submissions_page_id_fkey
    FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
  `);

  console.log('Database đã sẵn sàng.');
}

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  store: new pgSession({ pool: pool, createTableIfMissing: true }),
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

function injectFormTracker(htmlCode, pageId) {
  const trackerScript = `
<script>
(function() {
  document.querySelectorAll('form').forEach(function(form) {
    form.addEventListener('submit', function(e) {
      var formData = new FormData(form);
      var data = {};
      formData.forEach(function(value, key) {
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

// ============ TRANG TỔNG QUAN (dashboard) ============
app.get('/', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.created_at, p.views, p.status, COUNT(s.id) AS lead_count
       FROM pages p
       LEFT JOIN submissions s ON s.page_id = p.id
       WHERE p.owner_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.session.userId]
    );
    const pages = result.rows;

    let listHtml = `
      <h1>Landing page của bạn</h1>
      <p class="subtitle">Xây, xuất bản và theo dõi landing page. <a href="/logout">Đăng xuất</a></p>

      <a href="/create" style="display:block; text-align:center; background:#111; color:#fff; padding:14px; border-radius:10px; font-weight:700; margin-bottom:28px;">+ Tạo landing page</a>

      <div class="card">
    `;

    if (pages.length === 0) {
      listHtml += '<p>Chưa có trang nào. Bấm "Tạo landing page" để bắt đầu.</p>';
    } else {
      listHtml += '<ul class="page-list">';
      pages.forEach(page => {
        const leadCount = parseInt(page.lead_count, 10);
        const views = page.views || 0;
        const conversionRate = views > 0 ? ((leadCount / views) * 100).toFixed(1) : '0.0';
        const isLive = page.status === 'live';
        const badge = isLive
          ? '<span style="background:#E7F5EC; color:#1E8A4C; font-size:11px; font-weight:700; padding:3px 9px; border-radius:999px; white-space:nowrap;">&#9679; Đang chạy</span>'
          : '<span style="background:#F0F0EC; color:#888; font-size:11px; font-weight:700; padding:3px 9px; border-radius:999px; white-space:nowrap;">&#9675; Nháp</span>';

        listHtml += `
          <li style="display:block;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
              <a href="/page/${page.id}" target="_blank" style="font-weight:700;">${page.name}</a>
              ${badge}
            </div>
            <div style="display:flex; gap:16px; font-size:12px; color:#888; margin-bottom:8px; flex-wrap:wrap;">
              <span><strong>${views}</strong> lượt xem</span>
              <span><strong>${leadCount}</strong> lead</span>
              <span><strong>${conversionRate}%</strong> chuyển đổi</span>
              <span>${new Date(page.created_at).toLocaleString('vi-VN')}</span>
            </div>
            <div><a href="/page/${page.id}/submissions" style="font-size: 13px;">Xem dữ liệu form &rarr;</a></div>
            <div style="display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap;">
              <form action="/page/${page.id}/toggle-status" method="POST">
                <button type="submit" style="padding: 6px 12px; font-size: 13px;">${isLive ? 'Chuyển sang Nháp' : 'Xuất bản (chuyển Live)'}</button>
              </form>
              <form action="/page/${page.id}/rename" method="POST" style="display: flex; gap: 6px;">
                <input type="text" name="newName" placeholder="Tên mới" style="padding: 6px; font-size: 13px; width: 110px;" />
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

    listHtml += '</div>';
    res.send(layout(listHtml));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi lấy danh sách.</p>'));
  }
});

// Giu lai duong link /pages cu, tu dong chuyen ve trang chu de khong hong link cu
app.get('/pages', requireLogin, (req, res) => {
  res.redirect('/');
});

// ============ TRANG TẠO LANDING PAGE MỚI ============
app.get('/create', requireLogin, (req, res) => {
  const content = `
    <h1>Tạo landing page từ HTML</h1>
    <p class="subtitle"><a href="/">&larr; Quay lại tổng quan</a></p>

    <div class="card" style="background: #eff6ff; border-color: #bfdbfe; color: #1e40af; font-size: 14px;">
      Dán hoặc upload 1 file HTML → hệ thống tự động xuất bản thành trang riêng của bạn.
    </div>

    <div class="card">
      <form action="/paste" method="POST">
        <label style="display:block; font-weight: 600; margin-bottom: 6px;">Tiêu đề trang <span style="color:#dc2626;">*</span></label>
        <input type="text" name="pageName" placeholder="Vd: Landing ra mắt khóa học" required style="display:block; width:100%; padding:10px; margin-bottom:16px;" />

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <label style="font-weight: 600;">Nội dung HTML <span style="color:#dc2626;">*</span></label>
          <label style="color: #4f46e5; cursor: pointer; font-size: 14px;">
            Upload .html
            <input type="file" id="fileUploadInput" accept=".html" style="display:none;" />
          </label>
        </div>
        <textarea name="htmlCode" id="htmlCodeArea" rows="14" placeholder="<!doctype html> ... dán HTML ở đây ..." required></textarea>

        <button type="submit" style="width: 100%; margin-top: 16px; padding: 14px;">Tạo landing page</button>
      </form>
    </div>

    <script>
      document.getElementById('fileUploadInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
          document.getElementById('htmlCodeArea').value = evt.target.result;
        };
        reader.readAsText(file, 'UTF-8');
      });
    </script>
  `;
  res.send(layout(content));
});

app.post('/upload', requireLogin, upload.single('htmlFile'), async (req, res) => {
  if (!req.file) {
    return res.send(layout('<p>Không có file nào được gửi lên.</p><a class="link-back" href="/create">&larr; Quay lại</a>'));
  }

  const htmlCode = req.file.buffer.toString('utf-8');
  const id = crypto.randomBytes(6).toString('hex');
  const name = (req.body.pageName && req.body.pageName.trim() !== '')
    ? req.body.pageName.trim()
    : req.file.originalname;
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
        <a class="link-back" href="/">&larr; Quay lại tổng quan</a>
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
  const pageName = req.body.pageName;

  if (!htmlCode || htmlCode.trim() === '') {
    return res.send(layout('<p>Bạn chưa nhập nội dung HTML.</p><a class="link-back" href="/create">&larr; Quay lại</a>'));
  }
  if (!pageName || pageName.trim() === '') {
    return res.send(layout('<p>Bạn chưa đặt tiêu đề cho trang.</p><a class="link-back" href="/create">&larr; Quay lại</a>'));
  }

  const id = crypto.randomBytes(6).toString('hex');
  const name = pageName.trim();
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
        <a class="link-back" href="/">&larr; Quay lại tổng quan</a>
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
    const result = await pool.query('SELECT html_content, status FROM pages WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).send(layout('<p>Không tìm thấy trang này.</p>'));
    }

    const page = result.rows[0];

    if (page.status === 'draft') {
      return res.send(layout('<div class="card" style="text-align:center;"><p>Trang này hiện đang ở chế độ nháp, chưa xuất bản.</p></div>'));
    }

    await pool.query('UPDATE pages SET views = views + 1 WHERE id = $1', [id]);

    res.send(page.html_content);
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

    let html = `
      <h1>Dữ liệu form: ${pageCheck.rows[0].name}</h1>
      <p style="margin-bottom: 16px;"><a href="/page/${pageId}/export">&#128190; Tải file Excel (.xlsx)</a></p>
      <div class="card">
    `;

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

    html += '</div><a class="link-back" href="/">&larr; Quay lại tổng quan</a>';
    res.send(layout(html));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi lấy dữ liệu.</p>'));
  }
});

app.get('/page/:id/export', requireLogin, async (req, res) => {
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

    if (result.rows.length === 0) {
      return res.send(layout('<p>Chưa có dữ liệu nào để xuất.</p><a class="link-back" href="/">&larr; Quay lại</a>'));
    }

    const allKeys = new Set();
    result.rows.forEach(row => {
      Object.keys(row.data).forEach(key => allKeys.add(key));
    });
    const headers = Array.from(allKeys);
    headers.push('Thời gian');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Dữ liệu form');

    sheet.columns = headers.map(header => ({ header: header, key: header, width: 20 }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

    result.rows.forEach(row => {
      const rowData = {};
      headers.forEach(header => {
        rowData[header] = header === 'Thời gian'
          ? new Date(row.created_at).toLocaleString('vi-VN')
          : row.data[header];
      });
      sheet.addRow(rowData);
    });

    headers.forEach((header, colIndex) => {
      const column = sheet.getColumn(colIndex + 1);
      column.eachCell({ includeEmpty: false }, function(cell, rowNumber) {
        if (rowNumber === 1) return;
        if (typeof cell.value === 'string' && /^\d+$/.test(cell.value)) {
          cell.numFmt = '@';
        }
      });
    });

    sheet.columns.forEach(column => {
      let maxLength = column.header ? column.header.length : 10;
      column.eachCell({ includeEmpty: true }, function(cell) {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > maxLength) maxLength = len;
      });
      column.width = maxLength + 4;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="du-lieu-form-${pageId}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi xuất dữ liệu.</p>'));
  }
});

app.post('/page/:id/toggle-status', requireLogin, async (req, res) => {
  const id = req.params.id;

  try {
    const check = await pool.query(
      'SELECT status FROM pages WHERE id = $1 AND owner_id = $2',
      [id, req.session.userId]
    );
    if (check.rows.length === 0) {
      return res.status(403).send(layout('<p>Bạn không có quyền với trang này.</p>'));
    }

    const newStatus = check.rows[0].status === 'live' ? 'draft' : 'live';
    await pool.query('UPDATE pages SET status = $1 WHERE id = $2', [newStatus, id]);

    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi đổi trạng thái.</p>'));
  }
});

app.post('/page/:id/delete', requireLogin, async (req, res) => {
  const id = req.params.id;

  try {
    await pool.query('DELETE FROM pages WHERE id = $1 AND owner_id = $2', [id, req.session.userId]);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi xóa trang.</p>'));
  }
});

app.post('/page/:id/rename', requireLogin, async (req, res) => {
  const id = req.params.id;
  const newName = req.body.newName;

  if (!newName || newName.trim() === '') {
    return res.redirect('/');
  }

  try {
    await pool.query(
      'UPDATE pages SET name = $1 WHERE id = $2 AND owner_id = $3',
      [newName.trim(), id, req.session.userId]
    );
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi đổi tên.</p>'));
  }
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
  });
});