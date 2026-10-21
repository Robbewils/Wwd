'use strict';
const path = require('path');
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.join(__dirname, '.env'));
    for (const name of Object.keys(process.env)) {
      if (!name.startsWith('\uFEFF')) continue;
      const normalizedName = name.slice(1);
      if (!Object.prototype.hasOwnProperty.call(process.env, normalizedName)) {
        process.env[normalizedName] = process.env[name];
      }
      delete process.env[name];
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { db, hashPassword, verifyPassword, DUMMY_HASH } = require('./db');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const COOKIE = PROD ? '__Host-sid' : 'sid'; // __Host- dwingt Secure + Path=/ af
const SESSION_MS = 8 * 60 * 60 * 1000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SERVICE_TYPES = new Set(['new_site_basic', 'new_site_premium', 'new_site_max', 'maintenance', 'other']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BREVO_SMTP_LOGIN = (process.env.BREVO_SMTP_LOGIN || '').trim();
const BREVO_SMTP_KEY = (process.env.BREVO_SMTP_KEY || '').trim();
const BREVO_SMTP_PORT = Number(process.env.BREVO_SMTP_PORT || 587);
const EMAIL_SENDER = (process.env.BREVO_FROM_EMAIL || 'robbe.wils09@gmail.com').trim();
const EMAIL_SENDER_NAME = (process.env.BREVO_FROM_NAME || 'Wilcotec').trim();
const ADMIN_NOTIFICATION_EMAIL = (process.env.ADMIN_NOTIFICATION_EMAIL || EMAIL_SENDER).trim();
const mailTransport = BREVO_SMTP_LOGIN && BREVO_SMTP_KEY && [465, 587, 2525].includes(BREVO_SMTP_PORT)
  ? nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: BREVO_SMTP_PORT,
    secure: BREVO_SMTP_PORT === 465,
    auth: { user: BREVO_SMTP_LOGIN, pass: BREVO_SMTP_KEY },
  })
  : null;

async function sendNotificationEmail(to, subject, text, notificationName) {
  if (!mailTransport) {
    console.error(`${notificationName} kon niet worden verzonden: Brevo SMTP is niet ingesteld.`);
    return false;
  }
  if (typeof to !== 'string' || to.length > 254 || !EMAIL_PATTERN.test(to.trim())) {
    console.error(`${notificationName} kon niet worden verzonden: er is geen geldig bestemmingsadres ingesteld.`);
    return false;
  }

  try {
    await mailTransport.sendMail({
      from: `${EMAIL_SENDER_NAME} <${EMAIL_SENDER}>`,
      to: to.trim(),
      subject,
      text,
    });
    return true;
  } catch (error) {
    console.error(`${notificationName} kon niet worden verzonden.`, error.code || error.message);
    return false;
  }
}

const EMAIL_VERIFICATION_MS = 10 * 60 * 1000;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
const emailVerificationSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
});
const emailVerificationCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function emailVerificationDigest(userId, email, code) {
  return crypto.createHmac('sha256', BREVO_SMTP_KEY)
    .update(`${userId}\0${email}\0${code}`)
    .digest('hex');
}

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY)); // bv. 1 achter nginx/Caddy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // De pagina's gebruiken inline CSS. JavaScript blijft beperkt tot same-origin bestanden.
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));

// Sessie-cookie -> req.user (in de database staat alleen de hash van het token)
app.use((req, res, next) => {
  const c = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  req.token = c ? c.slice(COOKIE.length + 1) : null;
  if (req.token) {
    req.user = db
      .prepare(`SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.expires_at > ?`)
      .get(sha256(req.token), Date.now());
  }
  next();
});

const dashboardPath = (user) => (user.role === 'admin' ? '/admin' : '/user');
const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.redirect('/');
  if (req.user.role !== role) return res.redirect(dashboardPath(req.user));
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
};
const requireApiRole = (role, unauthenticatedMessage = 'Log in om verder te gaan.') => (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.status(401).json({ error: unauthenticatedMessage });
  if (req.user.role !== role) return res.sendStatus(403);
  next();
};
const requireAuthenticatedApi = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.status(401).json({ error: 'Log in om verder te gaan.' });
  next();
};

// ---- Publieke hoofdpagina en rolgebonden pagina's ----
app.get(['/', '/main.html'], (req, res) => {
  if (req.user) return res.redirect(dashboardPath(req.user));
  res.sendFile(path.join(__dirname, 'public', 'main.html'));
});
app.get(['/user', '/user.html'], requireRole('klant'), (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'user', 'user.html'));
});
app.get('/user.js', requireRole('klant'), (req, res) => {
  res.type('application/javascript').sendFile(path.join(__dirname, 'private', 'user', 'user.js'));
});
app.get(['/admin', '/admin.html'], requireRole('admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'admin', 'admin.html'));
});
app.get('/admin.js', requireRole('admin'), (req, res) => {
  res.type('application/javascript').sendFile(path.join(__dirname, 'private', 'admin', 'admin.js'));
});
app.get('/login', (req, res) => {
  if (req.user) return res.redirect(dashboardPath(req.user));
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/account', (req, res) => res.redirect(req.user ? dashboardPath(req.user) : '/'));
app.use(express.static(path.join(__dirname, 'public'), { index: false })); // enige map die publiek is

// ---- API ----
const requireJson = (req, res, next) => (req.is('application/json') ? next() : res.sendStatus(415));
app.get('/api/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    isLoggedIn: Boolean(req.user),
    username: req.user?.username ?? null,
  });
});
app.get('/api/user/overview', requireApiRole('klant'), (req, res) => {
  const user = db.prepare('SELECT payment_needed AS paymentNeeded FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

  const pendingPayments = db.prepare(`
    SELECT id, COALESCE(NULLIF(TRIM(title), ''), 'Aanvraag #' || id) AS title
    FROM service_requests
    WHERE user_id = ? AND status = 'closed' AND payment_completed = 0
    ORDER BY updated_at DESC, id DESC
  `).all(req.user.id);

  res.json({
    paymentNeeded: Number(user.paymentNeeded) === 1,
    pendingPayments,
  });
});
app.get('/api/admin/dashboard', requireApiRole('admin'), (req, res) => {
  const serviceRequests = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open,
      COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS inProgress,
      COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) AS closed
    FROM service_requests
  `).get();
  const users = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN role = 'klant' THEN 1 ELSE 0 END), 0) AS customers
    FROM users
  `).get();
  // Older databases may use total_revenue and derive profit from a coefficient.
  const revenueColumns = new Set(db.pragma('table_info(revenue)').map((column) => column.name));
  const amountColumn = revenueColumns.has('amount')
    ? 'amount'
    : revenueColumns.has('total_revenue')
      ? 'total_revenue'
      : null;
  const profitExpression = amountColumn && revenueColumns.has('profit')
    ? (revenueColumns.has('coefficient') ? `COALESCE(profit, ${amountColumn} * coefficient)` : 'profit')
    : amountColumn && revenueColumns.has('coefficient')
      ? `${amountColumn} * coefficient`
      : null;
  let revenue = { total: 0, profit: 0, entries: 0, profitAvailable: true };

  if (amountColumn) {
    if (profitExpression) {
      const totals = db.prepare(`
        SELECT
          COALESCE(SUM(${amountColumn}), 0) AS total,
          COALESCE(SUM(${profitExpression}), 0) AS profit,
          COUNT(*) AS entries,
          COUNT(${profitExpression}) AS profitEntries
        FROM revenue
      `).get();
      revenue = {
        total: totals.total,
        profit: totals.profit,
        entries: totals.entries,
        profitAvailable: totals.entries === 0 || totals.entries === totals.profitEntries,
      };
    } else {
      const totals = db.prepare(`SELECT COALESCE(SUM(${amountColumn}), 0) AS total, COUNT(*) AS entries FROM revenue`).get();
      revenue = {
        total: totals.total,
        profit: 0,
        entries: totals.entries,
        profitAvailable: totals.entries === 0,
      };
    }
  } else {
    revenue.profitAvailable = false;
  }

  const now = new Date();
  const currentWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  currentWeek.setUTCDate(currentWeek.getUTCDate() - ((currentWeek.getUTCDay() + 6) % 7));
  const weeks = Array.from({ length: 52 }, (_, index) => new Date(
    currentWeek.getTime() + (index - 51) * 7 * 24 * 60 * 60 * 1000
  ));
  const weekKeys = weeks.map((week) => week.toISOString().slice(0, 10));
  const weekLabels = weeks.map((week) => new Intl.DateTimeFormat('nl-BE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(week).replace(/\.$/, ''));
  const dateToWeekKey = (value) => {
    if (value === null || value === undefined || value === '') return null;
    let date;
    const numericValue = Number(value);
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) {
      if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
      date = new Date(numericValue < 1e11 ? numericValue * 1000 : numericValue);
    } else {
      const textValue = String(value);
      const sqliteDate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(textValue)
        ? `${textValue.replace(' ', 'T')}Z`
        : textValue;
      date = new Date(sqliteDate);
    }
    if (Number.isNaN(date.getTime())) return null;
    const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    return weekStart.toISOString().slice(0, 10);
  };
  const aggregateByWeek = (rows, getValue) => {
    const totals = new Map(weekKeys.map((key) => [key, 0]));
    rows.forEach((row) => {
      const key = dateToWeekKey(row.date);
      if (!totals.has(key)) return;
      const value = getValue(row);
      if (Number.isFinite(value)) totals.set(key, totals.get(key) + value);
    });
    return weekKeys.map((key) => totals.get(key));
  };
  const userDateColumn = new Set(db.pragma('table_info(users)').map((column) => column.name)).has('created_at');
  const requestDateColumn = new Set(db.pragma('table_info(service_requests)').map((column) => column.name)).has('created_at');
  const userRows = userDateColumn ? db.prepare('SELECT created_at AS date FROM users').all() : [];
  const requestRows = requestDateColumn ? db.prepare('SELECT created_at AS date FROM service_requests').all() : [];
  const profitRows = amountColumn && revenueColumns.has('date')
    ? db.prepare(`
      SELECT date, ${profitExpression || 'NULL'} AS profit
      FROM revenue
    `).all()
    : [];
  const newUsersByWeek = aggregateByWeek(userRows, () => 1);
  let usersBeforePeriod = Math.max(0, users.total - newUsersByWeek.reduce((sum, value) => sum + value, 0));
  const cumulativeUsersByWeek = newUsersByWeek.map((value) => {
    usersBeforePeriod += value;
    return usersBeforePeriod;
  });
  const trends = {
    weeks: weekLabels,
    users: cumulativeUsersByWeek,
    requests: aggregateByWeek(requestRows, () => 1),
    profit: aggregateByWeek(profitRows, (row) => row.profit === null
      ? 0
      : Number(row.profit)),
    profitComplete: revenue.profitAvailable,
  };

  res.json({ serviceRequests, users, revenue, trends });
});
app.get('/api/admin/requests', requireApiRole('admin'), (req, res) => {
  const requestColumns = new Set(db.pragma('table_info(service_requests)').map((column) => column.name));
  const revenueColumns = new Set(db.pragma('table_info(revenue)').map((column) => column.name));
  const titleExpression = requestColumns.has('title') ? 'r.title' : 'NULL';
  const descriptionExpression = requestColumns.has('description') ? 'r.description' : 'NULL';
  const createdAtExpression = requestColumns.has('created_at') ? 'r.created_at' : 'NULL';
  const adminNotesExpression = requestColumns.has('admin_notes') ? 'r.admin_notes' : 'NULL';
  const paymentAmountColumn = revenueColumns.has('amount') ? 'amount' : revenueColumns.has('total_revenue') ? 'total_revenue' : null;
  const paymentAmountExpression = paymentAmountColumn ? `rv.${paymentAmountColumn}` : 'NULL';
  const paymentProfitExpression = revenueColumns.has('profit') ? 'rv.profit' : 'NULL';
  const orderExpression = requestColumns.has('created_at') ? 'r.created_at DESC, r.id DESC' : 'r.id DESC';
  const requests = db.prepare(`
    SELECT
      r.id,
      ${titleExpression} AS title,
      ${descriptionExpression} AS description,
      r.status,
      r.service_type AS serviceType,
      r.payment_completed AS paymentCompleted,
      r.payment_date AS paymentDate,
      ${paymentAmountExpression} AS paymentAmount,
      ${paymentProfitExpression} AS paymentProfit,
      ${createdAtExpression} AS createdAt,
      ${adminNotesExpression} AS adminNotes,
      u.username
    FROM service_requests r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN revenue rv ON rv.request_id = r.id
    ORDER BY ${orderExpression}
  `).all();

  res.json({ requests });
});
app.get('/api/user/requests', requireApiRole('klant'), (req, res) => {
  const requests = db.prepare(`
    SELECT
      r.id,
      r.title,
      r.description,
      r.status,
      r.service_type AS serviceType,
      r.created_at AS createdAt,
      r.admin_notes AS adminNotes
    FROM service_requests r
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC, r.id DESC
  `).all(req.user.id);
  res.json({ requests });
});
// Browserverzoeken die iets wijzigen accepteren alleen deze origin.
const requireSameOrigin = (req, res, next) => {
  try {
    const origin = req.get('origin');
    const requestOrigin = new URL(`${req.protocol}://${req.get('host')}`).origin;
    if (!origin || new URL(origin).origin !== requestOrigin) return res.sendStatus(403);
    next();
  } catch {
    res.sendStatus(403);
  }
};
const json = express.json({ limit: '1kb' });
const accountJson = express.json({ limit: '2kb' });
const userContentJson = express.json({ limit: '24kb' });
app.get('/api/user/profile', requireApiRole('klant'), (req, res) => {
  const user = db.prepare(`
    SELECT email, email_verified AS emailVerified, pending_email AS pendingEmail
    FROM users WHERE id = ?
  `).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });
  res.json({
    email: user.email || '',
    emailVerified: Number(user.emailVerified) === 1,
    pendingEmail: user.pendingEmail || '',
  });
});
app.put('/api/user/profile', requireApiRole('klant'), emailVerificationSendLimiter, requireSameOrigin, requireJson, accountJson, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Vul een geldig e-mailadres in.' });
  }

  const user = db.prepare('SELECT email, email_verified AS emailVerified FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });
  if (Number(user.emailVerified) === 1 && user.email?.toLowerCase() === email) {
    return res.json({ ok: true, email: user.email, emailVerified: true, alreadyVerified: true });
  }

  if (!mailTransport) {
    return res.status(503).json({ error: 'Brevo SMTP is nog niet volledig ingesteld op de server.' });
  }

  const existingUser = db.prepare(`
    SELECT id FROM users
    WHERE id <> ? AND (
      email = ? COLLATE NOCASE OR
      pending_email = ? COLLATE NOCASE
    )
  `).get(req.user.id, email, email);
  if (existingUser) return res.status(409).json({ error: 'Dit e-mailadres is al gekoppeld aan een ander account.' });

  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  const codeHash = emailVerificationDigest(req.user.id, email, code);
  try {
    await mailTransport.sendMail({
      from: `${EMAIL_SENDER_NAME} <${EMAIL_SENDER}>`,
      to: email,
      subject: 'Verifieer je e-mailadres voor Wilcotec',
      text: `Je verificatiecode is ${code}.\n\nVul deze code binnen 10 minuten in op je Wilcotec-account. Als je deze aanvraag niet hebt gedaan, kun je deze e-mail negeren.`,
    });
  } catch (error) {
    console.error('Verificatiemail kon niet worden verzonden.', error.code || error.message);
    return res.status(503).json({ error: 'De verificatiemail kon niet worden verzonden. Controleer het adres en probeer het opnieuw.' });
  }

  const expiresAt = Date.now() + EMAIL_VERIFICATION_MS;
  db.prepare(`
    UPDATE users
    SET pending_email = ?, email_verification_code_hash = ?,
        email_verification_expires_at = ?, email_verification_attempts = 0
    WHERE id = ?
  `).run(email, codeHash, expiresAt, req.user.id);
  res.json({ ok: true, email: user.email || '', emailVerified: Number(user.emailVerified) === 1, pendingEmail: email });
});
app.post('/api/user/profile/verify', requireApiRole('klant'), emailVerificationCheckLimiter, requireSameOrigin, requireJson, accountJson, (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Vul de code van 6 cijfers in.' });

  const user = db.prepare(`
    SELECT pending_email AS pendingEmail,
           email_verification_code_hash AS codeHash,
           email_verification_expires_at AS expiresAt,
           email_verification_attempts AS attempts
    FROM users WHERE id = ?
  `).get(req.user.id);
  if (!user?.pendingEmail || !user.codeHash || !user.expiresAt) {
    return res.status(400).json({ error: 'Vraag eerst een nieuwe verificatiecode aan.' });
  }
  if (user.expiresAt <= Date.now()) {
    db.prepare(`
      UPDATE users SET email_verification_code_hash = NULL,
        email_verification_expires_at = NULL, email_verification_attempts = 0
      WHERE id = ?
    `).run(req.user.id);
    return res.status(400).json({ error: 'De code is verlopen. Vraag een nieuwe verificatiecode aan.' });
  }
  if (user.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Te veel onjuiste pogingen. Vraag een nieuwe verificatiecode aan.' });
  }

  const expectedHash = Buffer.from(user.codeHash, 'hex');
  const submittedHash = Buffer.from(emailVerificationDigest(req.user.id, user.pendingEmail, code), 'hex');
  if (expectedHash.length !== submittedHash.length || !crypto.timingSafeEqual(expectedHash, submittedHash)) {
    db.prepare('UPDATE users SET email_verification_attempts = email_verification_attempts + 1 WHERE id = ?').run(req.user.id);
    return res.status(400).json({ error: 'De verificatiecode is onjuist.' });
  }

  const emailInUse = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?')
    .get(user.pendingEmail, req.user.id);
  if (emailInUse) return res.status(409).json({ error: 'Dit e-mailadres is al gekoppeld aan een ander account.' });

  try {
    db.prepare(`
      UPDATE users
      SET email = pending_email, email_verified = 1, pending_email = NULL,
          email_verification_code_hash = NULL, email_verification_expires_at = NULL,
          email_verification_attempts = 0
      WHERE id = ?
    `).run(req.user.id);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Dit e-mailadres is al gekoppeld aan een ander account.' });
    }
    throw error;
  }
  res.json({ ok: true, email: user.pendingEmail, emailVerified: true });
});
app.put('/api/admin/requests/:id', requireApiRole('admin'), requireSameOrigin, requireJson, userContentJson, async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isSafeInteger(requestId) || requestId < 1) {
    return res.status(400).json({ error: 'Ongeldig aanvraagnummer.' });
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const status = req.body?.status;
  const adminNotes = typeof req.body?.adminNotes === 'string' ? req.body.adminNotes.trim() : '';
  const serviceType = req.body?.serviceType;
  const paymentCompleted = req.body?.paymentCompleted;
  const paymentDateInput = req.body?.paymentDate;
  const paymentAmountInput = req.body?.paymentAmount;
  const paymentProfitInput = req.body?.paymentProfit;
  if (!title || title.length > 120 || description.length < 3 || description.length > 4000 ||
      !['open', 'in_progress', 'closed'].includes(status) || adminNotes.length > 2000 ||
      !SERVICE_TYPES.has(serviceType) || typeof paymentCompleted !== 'boolean') {
    return res.status(400).json({ error: 'Controleer de aanvraaggegevens, dienst en betaalstatus.' });
  }

  const requestColumns = new Set(db.pragma('table_info(service_requests)').map((column) => column.name));
  const existingRequest = db.prepare(`
    SELECT r.payment_completed AS paymentCompleted, r.status AS previousStatus,
           u.email AS userEmail, u.username
    FROM service_requests r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
  `).get(requestId);
  if (!existingRequest) return res.status(404).json({ error: 'Aanvraag niet gevonden.' });
  const existingPaymentCompleted = Number(existingRequest.paymentCompleted) === 1;
  const canEditPayment = status === 'closed';
  if (!canEditPayment && paymentCompleted && !existingPaymentCompleted) {
    return res.status(400).json({ error: 'Een aanvraag moet klaar zijn voordat je deze als betaald kunt markeren.' });
  }

  let paymentDate = null;
  let paymentAmount = null;
  let paymentProfit = null;
  if (canEditPayment && paymentCompleted) {
    if (typeof paymentDateInput !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDateInput)) {
      return res.status(400).json({ error: 'Vul een betaaldatum, opbrengst en winst in voor een betaalde aanvraag.' });
    }
    const parsedPaymentDate = new Date(`${paymentDateInput}T00:00:00.000Z`);
    if (Number.isNaN(parsedPaymentDate.getTime()) || parsedPaymentDate.toISOString().slice(0, 10) !== paymentDateInput) {
      return res.status(400).json({ error: 'Vul een geldige betaaldatum in.' });
    }
    paymentDate = parsedPaymentDate.getTime();
    const parsedAmount = typeof paymentAmountInput === 'string' && paymentAmountInput.trim() !== ''
      ? Number(paymentAmountInput)
      : Number.NaN;
    const parsedProfit = typeof paymentProfitInput === 'string' && paymentProfitInput.trim() !== ''
      ? Number(paymentProfitInput)
      : Number.NaN;
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0 || parsedAmount > 100000000 ||
        !Number.isFinite(parsedProfit) || Math.abs(parsedProfit) > 100000000) {
      return res.status(400).json({ error: 'Vul een geldige opbrengst en winst in.' });
    }
    paymentAmount = Math.round(parsedAmount * 100) / 100;
    paymentProfit = Math.round(parsedProfit * 100) / 100;
  }

  const revenueColumns = new Set(db.pragma('table_info(revenue)').map((column) => column.name));
  const revenueAmountColumn = revenueColumns.has('amount')
    ? 'amount'
    : revenueColumns.has('total_revenue')
      ? 'total_revenue'
      : null;
  if (canEditPayment && paymentCompleted && !revenueAmountColumn) {
    return res.status(500).json({ error: 'De opbrengst kan niet worden opgeslagen.' });
  }
  const updateFields = ['title = ?', 'description = ?', 'status = ?'];
  const values = [title, description, status];
  if (requestColumns.has('service_type')) {
    updateFields.push('service_type = ?');
    values.push(serviceType);
  }
  if (canEditPayment && requestColumns.has('payment_completed')) {
    updateFields.push('payment_completed = ?');
    values.push(paymentCompleted ? 1 : 0);
  }
  if (canEditPayment && requestColumns.has('payment_date')) {
    updateFields.push('payment_date = ?');
    values.push(paymentDate);
  }
  if (requestColumns.has('updated_at')) {
    updateFields.push('updated_at = ?');
    values.push(Date.now());
  }
  if (requestColumns.has('admin_notes')) {
    updateFields.push('admin_notes = ?');
    values.push(adminNotes);
  }
  values.push(requestId);

  const saveRequest = db.transaction(() => {
    const result = db.prepare(`UPDATE service_requests SET ${updateFields.join(', ')} WHERE id = ?`).run(...values);
    if (result.changes === 0) return false;

    if (canEditPayment && paymentCompleted) {
      const existingRevenue = db.prepare('SELECT id FROM revenue WHERE request_id = ?').get(requestId);
      if (existingRevenue) {
        db.prepare(`UPDATE revenue SET ${revenueAmountColumn} = ?, profit = ?, date = ? WHERE request_id = ?`)
          .run(paymentAmount, paymentProfit, paymentDate, requestId);
      } else {
        db.prepare(`INSERT INTO revenue (${revenueAmountColumn}, profit, date, request_id) VALUES (?, ?, ?, ?)`)
          .run(paymentAmount, paymentProfit, paymentDate, requestId);
      }
    } else if (canEditPayment) {
      db.prepare('DELETE FROM revenue WHERE request_id = ?').run(requestId);
    }
    return true;
  });
  if (!saveRequest()) return res.status(404).json({ error: 'Aanvraag niet gevonden.' });

  if (status === 'closed' && existingRequest.previousStatus !== 'closed') {
    await sendNotificationEmail(
      existingRequest.userEmail,
      `Je aanvraag is klaar: ${title}`,
      `Hallo ${existingRequest.username || ''},\n\nJe aanvraag #${requestId} (${title}) is klaar.\n\nMet vriendelijke groet,\n${EMAIL_SENDER_NAME}`,
      `Melding aan gebruiker voor aanvraag #${requestId}`
    );
  }

  res.json({ ok: true });
});
app.delete('/api/admin/requests/:id', requireApiRole('admin'), requireSameOrigin, (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isSafeInteger(requestId) || requestId < 1) return res.status(400).json({ error: 'Ongeldig aanvraagnummer.' });
  const deleteRequest = db.transaction(() => {
    const result = db.prepare('DELETE FROM service_requests WHERE id = ?').run(requestId);
    if (result.changes > 0) db.prepare('DELETE FROM revenue WHERE request_id = ?').run(requestId);
    return result;
  });
  const result = deleteRequest();
  if (result.changes === 0) return res.status(404).json({ error: 'Aanvraag niet gevonden.' });
  res.json({ ok: true });
});
app.put('/api/user/requests/:id', requireApiRole('klant'), requireSameOrigin, requireJson, userContentJson, (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isSafeInteger(requestId) || requestId < 1) return res.status(400).json({ error: 'Ongeldig aanvraagnummer.' });
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const serviceType = req.body?.serviceType;
  if (!title || title.length > 120 || description.length < 3 || description.length > 4000 || !SERVICE_TYPES.has(serviceType)) {
    return res.status(400).json({ error: 'Vul een titel, beschrijving en geldig servicetype in.' });
  }

  const request = db.prepare('SELECT id FROM service_requests WHERE id = ? AND user_id = ?').get(requestId, req.user.id);
  if (!request) return res.status(404).json({ error: 'Aanvraag niet gevonden.' });
  const now = Date.now();
  db.prepare('UPDATE service_requests SET title = ?, description = ?, service_type = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(title, description, serviceType, now, requestId, req.user.id);
  res.json({ ok: true });
});
app.delete('/api/user/requests/:id', requireApiRole('klant'), requireSameOrigin, (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isSafeInteger(requestId) || requestId < 1) return res.status(400).json({ error: 'Ongeldig aanvraagnummer.' });
  const deleteRequest = db.transaction(() => {
    const result = db.prepare('DELETE FROM service_requests WHERE id = ? AND user_id = ?').run(requestId, req.user.id);
    if (result.changes > 0) db.prepare('DELETE FROM revenue WHERE request_id = ?').run(requestId);
    return result;
  });
  const result = deleteRequest();
  if (result.changes === 0) return res.status(404).json({ error: 'Aanvraag niet gevonden.' });
  res.json({ ok: true });
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
});
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});

app.put('/api/account/password', requireAuthenticatedApi, passwordChangeLimiter, requireSameOrigin, requireJson, accountJson, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || currentPassword.length < 1 || currentPassword.length > 200 ||
      typeof newPassword !== 'string' || newPassword.length < 5 || newPassword.length > 200) {
    return res.status(400).json({ error: 'Het nieuwe wachtwoord moet minstens 5 tekens bevatten.' });
  }

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const currentPasswordMatches = await verifyPassword(currentPassword, user ? user.password_hash : DUMMY_HASH);
  if (!user || !currentPasswordMatches) {
    return res.status(400).json({ error: 'Het huidige wachtwoord is onjuist.' });
  }

  const passwordHash = await hashPassword(newPassword);
  const updatePassword = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .run(req.user.id, sha256(req.token));
  });
  updatePassword();
  res.json({ ok: true });
});

app.post('/api/login', loginLimiter, requireSameOrigin, requireJson, json, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || username.length < 1 || username.length > 32 ||
      typeof password !== 'string' || password.length < 5 || password.length > 200) {
    return res.status(400).json({ error: 'Ongeldige invoer' });
  }
  const user = db.prepare('SELECT id, password_hash, role FROM users WHERE username = ?').get(username);
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Onjuiste gebruikersnaam of wachtwoord' });

  const token = crypto.randomBytes(32).toString('base64url'); // altijd een nieuw token
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), user.id, Date.now() + SESSION_MS);
  res.cookie(COOKIE, token, { httpOnly: true, secure: PROD, sameSite: 'lax', maxAge: SESSION_MS, path: '/' });
  res.json({ ok: true, next: dashboardPath(user) });
});

app.post('/api/register', registerLimiter, requireSameOrigin, requireJson, json, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(username) ||
      typeof password !== 'string' || password.length < 5 || password.length > 200) {
    return res.status(400).json({ error: 'Account kon niet worden aangemaakt. Controleer de gebruikersnaam en invoer.' });
  }

  const passwordHash = await hashPassword(password);
  try {
    db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, datetime())')
      .run(username, passwordHash, 'klant');
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Account kon niet worden aangemaakt. Controleer de gebruikersnaam en invoer.' });
    }
    throw err;
  }
  res.status(201).json({ ok: true });
});

app.post('/api/user/requests', requireApiRole('klant'), requireSameOrigin, requireJson, userContentJson, async (req, res) => {
  const user = db.prepare('SELECT email, email_verified AS emailVerified FROM users WHERE id = ?').get(req.user.id);
  if (!user?.email || Number(user.emailVerified) !== 1 || user.email.length > 254 || !EMAIL_PATTERN.test(user.email.trim())) {
    return res.status(409).json({ error: 'Verifieer eerst je e-mailadres bij Instellingen voordat je een aanvraag verstuurt.' });
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const serviceType = req.body?.serviceType;
  if (!title || title.length > 120 || description.length < 3 || description.length > 4000 || !SERVICE_TYPES.has(serviceType)) {
    return res.status(400).json({ error: 'Vul een titel, beschrijving en geldig servicetype in.' });
  }

  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO service_requests (user_id, title, description, status, created_at, updated_at, service_type)
    VALUES (?, ?, ?, 'open', ?, ?, ?)
  `).run(req.user.id, title, description, now, now, serviceType);
  await sendNotificationEmail(
    ADMIN_NOTIFICATION_EMAIL,
    `Nieuwe aanvraag #${result.lastInsertRowid}: ${title}`,
    `Er is een nieuwe aanvraag ingediend.\n\nAanvraag: #${result.lastInsertRowid}\nGebruiker: ${req.user.username}\nTitel: ${title}\nDienst: ${serviceType}\n\nBeschrijving:\n${description}`,
    `Melding voor nieuwe aanvraag #${result.lastInsertRowid}`
  );
  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

app.post('/api/logout', requireSameOrigin, requireJson, json, (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(req.token));
  res.clearCookie(COOKIE, { httpOnly: true, secure: PROD, sameSite: 'lax', path: '/' });
  res.json({ ok: true });
});

// Verlopen sessies opruimen
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 60 * 60 * 1000).unref();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server draait op poort ${PORT}`);
});