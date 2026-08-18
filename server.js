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
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

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
      <title>Trạm Xuất Bản</title>
      <link rel="stylesheet" href="/style.css" />
    </head>
    <body>
      <header class="topbar">
        <a href="/" class="brand">
          <span class="stamp-mark"></span>
          <span class="brand-name">Trạm Xuất Bản</span>
        </a>
      </header>
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

const TRACKER_MARKER = 'FORM_TRACKER_V1';

function injectFormTracker(htmlCode, pageId) {
  if (htmlCode.includes(TRACKER_MARKER)) {
    return htmlCode;
  }

  const trackerScript = `
<!-- ${TRACKER_MARKER} -->
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
        <label>Email</label>
        <input type="email" name="email" placeholder="ban@email.com" required style="margin-bottom:14px;" />
        <label>Mật khẩu</label>
        <input type="password" name="password" placeholder="Tối thiểu 6 ký tự" required style="margin-bottom:18px;" />
        <button type="submit" class="btn-block">Đăng ký</button>
      </form>
      <p style="margin-top:16px; font-size:13px;">Đã có tài khoản? <a href="/login">Đăng nhập</a></p>
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
        <label>Email</label>
        <input type="email" name="email" placeholder="ban@email.com" required style="margin-bottom:14px;" />
        <label>Mật khẩu</label>
        <input type="password" name="password" placeholder="Mật khẩu của bạn" required style="margin-bottom:18px;" />
        <button type="submit" class="btn-block">Đăng nhập</button>
      </form>
      <p style="margin-top:16px; font-size:13px;">Chưa có tài khoản? <a href="/register">Đăng ký</a></p>
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

// ============ TRANG TỔNG QUAN ============
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

      <a href="/create" class="btn btn-block" style="margin-bottom:28px;">+ Tạo landing page</a>
    `;

    if (pages.length === 0) {
      listHtml += '<div class="card"><p style="font-size:14px; color:var(--ink-soft);">Chưa có trang nào. Bấm "Tạo landing page" để bắt đầu.</p></div>';
    } else {
      listHtml += '<div class="page-grid">';
      pages.forEach(page => {
        const leadCount = parseInt(page.lead_count, 10);
        const views = page.views || 0;
        const conversionRate = views > 0 ? ((leadCount / views) * 100).toFixed(1) : '0.0';
        const isLive = page.status === 'live';
        const badge = isLive
          ? '<span class="badge badge-live">&#9679; Đang chạy</span>'
          : '<span class="badge badge-draft">&#9675; Nháp</span>';

        listHtml += `
          <a href="/page/${page.id}/manage" class="page-card">
            <div class="page-card-top">
              <span class="page-card-title">${page.name}</span>
              ${badge}
            </div>
            <div class="page-slug">/page/${page.id}</div>
            <div class="page-stats">
              <span><strong>${views}</strong> Lượt xem</span>
              <span><strong>${leadCount}</strong> Lead</span>
              <span><strong>${conversionRate}%</strong> Chuyển đổi</span>
            </div>
          </a>
        `;
      });
      listHtml += '</div>';
    }

    res.send(layout(listHtml));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi lấy danh sách.</p>'));
  }
});

app.get('/pages', requireLogin, (req, res) => {
  res.redirect('/');
});

// ============ TRANG TẠO LANDING PAGE MỚI ============
app.get('/create', requireLogin, (req, res) => {
  const content = `
    <h1>Tạo landing page từ HTML</h1>
    <p class="subtitle"><a href="/">&larr; Quay lại tổng quan</a></p>

    <div class="card" style="font-size:13.5px; color:var(--ink-soft);">
      Dán hoặc upload 1 file HTML → hệ thống tự động xuất bản thành trang riêng của bạn.
    </div>

    <div class="card">
      <form action="/paste" method="POST">
        <label>Tiêu đề trang</label>
        <input type="text" name="pageName" placeholder="Vd: Landing ra mắt khóa học" required style="margin-bottom:18px;" />

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <label style="margin-bottom:0;">Nội dung HTML</label>
          <label style="font-weight:600; cursor: pointer; font-size: 13px; margin-bottom:0;">
            Upload .html
            <input type="file" id="fileUploadInput" accept=".html" style="display:none;" />
          </label>
        </div>
        <textarea name="htmlCode" id="htmlCodeArea" rows="14" placeholder="<!doctype html> ... dán HTML ở đây ..." required></textarea>

        <button type="submit" class="btn-block" style="margin-top: 16px;">Tạo landing page</button>
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
        <h2 style="text-transform:none; font-size:16px; color:var(--ink);">Upload thành công!</h2>
        <p style="margin:8px 0;">Xem trang tại: <a href="/page/${id}" target="_blank">/page/${id}</a></p>
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
        <h2 style="text-transform:none; font-size:16px; color:var(--ink);">Tạo trang thành công!</h2>
        <p style="margin:8px 0;">Xem trang tại: <a href="/page/${id}" target="_blank">/page/${id}</a></p>
        <a class="link-back" href="/">&larr; Quay lại tổng quan</a>
      </div>
    `;
    res.send(layout(content));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi lưu vào database.</p>'));
  }
});

// ============ TRANG QUẢN LÝ CHI TIẾT 1 LANDING PAGE ============
app.get('/page/:id/manage', requireLogin, async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query(
      'SELECT * FROM pages WHERE id = $1 AND owner_id = $2',
      [id, req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).send(layout('<p>Bạn không có quyền quản lý trang này.</p>'));
    }

    const page = result.rows[0];
    const isLive = page.status === 'live';
    const badge = isLive
      ? '<span class="badge badge-live">&#9679; Đang chạy</span>'
      : '<span class="badge badge-draft">&#9675; Nháp</span>';

    const content = `
      <p class="back-link"><a href="/">&larr; Trang của bạn</a></p>

      <div class="detail-header">
        <div class="detail-title-row">
          <h1>${page.name}</h1>
          ${badge}
        </div>
        <div class="detail-slug">/page/${id}</div>
        <div class="detail-meta">
          Tạo ${new Date(page.created_at).toLocaleString('vi-VN')} &middot;
          Sửa ${new Date(page.updated_at).toLocaleString('vi-VN')} &middot;
          ${page.views || 0} lượt xem
        </div>
        <div class="detail-actions">
          <a href="/page/${id}" target="_blank" class="btn btn-sm">Mở trang &#8599;</a>
          <button type="button" class="btn btn-sm btn-outline" id="copyLinkBtn">Copy link</button>
          <form action="/page/${id}/toggle-status" method="POST" style="display:inline;">
            <button type="submit" class="btn btn-sm btn-outline">${isLive ? 'Gỡ xuống' : 'Xuất bản lại'}</button>
          </form>
          <form action="/page/${id}/delete" method="POST" style="display:inline;" onsubmit="return confirm('Bạn chắc chắn muốn xóa trang này? Không thể hoàn tác.');">
            <button type="submit" class="btn btn-sm btn-outline-danger">Xóa</button>
          </form>
        </div>
      </div>

      <div class="card">
        <h2>Xem trước</h2>
        <iframe src="/page/${id}/preview" class="iframe-preview"></iframe>
      </div>

      <div class="card">
        <h2>Đổi tên trang</h2>
        <form action="/page/${id}/rename" method="POST" style="display:flex; gap:8px;">
          <input type="text" name="newName" value="${page.name}" style="flex:1;" />
          <button type="submit">Lưu</button>
        </form>
      </div>

      <div class="card">
        <h2>Sửa nội dung HTML</h2>
        <form action="/page/${id}/update-html" method="POST">
          <textarea name="htmlCode" rows="14">${page.html_content}</textarea>
          <button type="submit" class="btn-block" style="margin-top:12px;">Lưu thay đổi</button>
        </form>
      </div>

      <p style="margin-bottom:18px;"><a href="/page/${id}/submissions">Xem dữ liệu form &rarr;</a></p>

      <script>
        document.getElementById('copyLinkBtn').addEventListener('click', function() {
          const url = window.location.origin + '/page/${id}';
          navigator.clipboard.writeText(url).then(function() {
            const btn = document.getElementById('copyLinkBtn');
            const oldText = btn.innerText;
            btn.innerText = 'Đã copy!';
            setTimeout(function() { btn.innerText = oldText; }, 1500);
          });
        });
      </script>
    `;
    res.send(layout(content));
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi tải trang quản lý.</p>'));
  }
});

app.get('/page/:id/preview', requireLogin, async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query(
      'SELECT html_content FROM pages WHERE id = $1 AND owner_id = $2',
      [id, req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).send('Không có quyền xem trang này.');
    }

    res.send(result.rows[0].html_content);
  } catch (err) {
    console.error(err);
    res.status(500).send('Có lỗi khi tải bản xem trước.');
  }
});

app.post('/page/:id/update-html', requireLogin, async (req, res) => {
  const id = req.params.id;
  const htmlCode = req.body.htmlCode;

  if (!htmlCode || htmlCode.trim() === '') {
    return res.redirect(`/page/${id}/manage`);
  }

  try {
    const check = await pool.query(
      'SELECT id FROM pages WHERE id = $1 AND owner_id = $2',
      [id, req.session.userId]
    );

    if (check.rows.length === 0) {
      return res.status(403).send(layout('<p>Bạn không có quyền với trang này.</p>'));
    }

    const finalHtml = injectFormTracker(htmlCode, id);
    await pool.query('UPDATE pages SET html_content = $1, updated_at = NOW() WHERE id = $2', [finalHtml, id]);

    res.redirect(`/page/${id}/manage`);
  } catch (err) {
    console.error(err);
    res.status(500).send(layout('<p>Có lỗi khi lưu thay đổi.</p>'));
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
          <li style="display: block; padding: 12px 0; border-bottom: 1px solid var(--border-soft);">
            <div style="font-size:13.5px;">${fields}</div>
            <div class="page-time">${new Date(row.created_at).toLocaleString('vi-VN')}</div>
          </li>
        `;
      });
      html += '</ul>';
    }

    html += `</div><a class="link-back" href="/page/${pageId}/manage">&larr; Quay lại quản lý trang</a>`;
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
    await pool.query('UPDATE pages SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, id]);

    res.redirect(`/page/${id}/manage`);
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
    return res.redirect(`/page/${id}/manage`);
  }

  try {
    await pool.query(
      'UPDATE pages SET name = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3',
      [newName.trim(), id, req.session.userId]
    );
    res.redirect(`/page/${id}/manage`);
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