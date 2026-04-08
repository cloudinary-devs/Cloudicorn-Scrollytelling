/**
 * Netlify Function: validate prize challenge URLs and append a row to Google Sheets.
 * Env: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, CHALLENGE_SHEET_ID, CHALLENGE_SHEET_TAB
 * Must match client CONFIG.PRIZE_CHALLENGE / CONFIG.CLOUDINARY in main.js.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// netlify dev + esbuild often do not inject .env into the function process; load repo-root .env.
(function loadRepoEnv() {
  const tryPaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '..', '.env'),
    path.join(__dirname, '..', '..', '..', '.env')
  ];
  for (const p of tryPaths) {
    try {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p });
        return;
      }
    } catch {
      /* ignore */
    }
  }
})();

const { google } = require('googleapis');

const CLOUD = 'jen-demos';
const IMAGE_ID = 'floating-cloudicorn.png';

const VALIDATORS = {
  generativeBackgroundReplacePrompt: (n) =>
    /e_gen_background_replace/.test(n) &&
    /prompt_/.test(n) &&
    /f_auto/.test(n) &&
    /q_auto/.test(n),
  generativeReplacePrompt: (n) =>
    /e_gen_replace/.test(n) &&
    /from_/.test(n) &&
    /to_/.test(n) &&
    /f_auto/.test(n) &&
    /q_auto/.test(n)
};

const TASK_KEYS = [
  'generativeBackgroundReplacePrompt',
  'generativeReplacePrompt'
];

function normalizeChain(chain) {
  if (!chain) return '';
  return chain
    .toLowerCase()
    .split('/')
    .filter((seg) => seg && !/^v\d+$/.test(seg))
    .join('/');
}

function extractChainFromUrl(urlString) {
  try {
    const u = new URL(String(urlString).trim());
    if (!u.hostname.endsWith('cloudinary.com')) {
      return { ok: false, error: 'Not a Cloudinary URL' };
    }
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] !== CLOUD) {
      return { ok: false, error: 'Wrong cloud' };
    }
    const uploadIdx = parts.indexOf('upload');
    if (uploadIdx < 0) return { ok: false, error: 'Missing upload path' };
    let rest = parts.slice(uploadIdx + 1);
    if (rest[0] && /^v\d+$/.test(rest[0])) rest = rest.slice(1);
    if (rest.length < 2) return { ok: false, error: 'Incomplete URL' };
    const lastSeg = rest[rest.length - 1];
    if (lastSeg.toLowerCase() !== IMAGE_ID.toLowerCase()) {
      return { ok: false, error: 'Wrong public ID' };
    }
    const chain = rest.slice(0, -1).join('/');
    return { ok: true, chain };
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
}

function validateTask(taskIndex, urlString) {
  const key = TASK_KEYS[taskIndex];
  if (!key) return { ok: false, error: 'Bad task' };
  const parsed = extractChainFromUrl(urlString);
  if (!parsed.ok) return parsed;
  const n = normalizeChain(parsed.chain);
  const fn = VALIDATORS[key];
  if (!fn(n)) {
    return { ok: false, error: `Task ${taskIndex + 1} transformation invalid` };
  }
  return { ok: true };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

/**
 * Normalize GOOGLE_PRIVATE_KEY from env (Netlify, .env, or pasted JSON).
 * Fixes common mistakes that cause ERR_OSSL_UNSUPPORTED / ASN1 decoder errors.
 */
function normalizePrivateKey(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let k = raw.trim();
  if (k.charCodeAt(0) === 0xfeff) k = k.slice(1);
  if (k.startsWith('{')) {
    try {
      const parsed = JSON.parse(k);
      if (typeof parsed.private_key === 'string') k = parsed.private_key;
    } catch {
      /* not JSON */
    }
  }
  if (
    (k.startsWith('"') && k.endsWith('"')) ||
    (k.startsWith("'") && k.endsWith("'"))
  ) {
    k = k.slice(1, -1);
  }
  k = k.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  return k.trim();
}

/** PKCS#8 uses "BEGIN PRIVATE KEY"; PKCS#1 uses "BEGIN RSA PRIVATE KEY". Prior regex wrongly required extra chars before "PRIVATE". */
function looksLikePemPrivateKey(key) {
  const k = key.trim();
  if (k.length < 80) return false;
  const begin = /-----BEGIN ([^-]+)-----/.exec(k);
  const end = /-----END ([^-]+)-----/.exec(k);
  if (!begin || !end) return false;
  const label = begin[1];
  return /PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY|OPENSSH PRIVATE KEY/.test(label);
}

/** Trim BOM, CRLF, accidental quotes from .env / Netlify UI pastes. */
function sanitizeEnvToken(raw, fallback) {
  let s = typeof raw === 'string' ? raw : '';
  s = s.replace(/^\uFEFF/, '').trim();
  if (/^["'].*["']$/.test(s)) s = s.slice(1, -1);
  s = s.replace(/\r/g, '').trim();
  return s || fallback;
}

/**
 * A1 range with a safely quoted sheet title (required if the name has spaces/special chars;
 * also avoids parse errors from stray characters in env).
 * @see https://developers.google.com/sheets/api/guides/concepts#a1_notation
 */
function sheetRangeA1(tabName, cellRange) {
  const name = sanitizeEnvToken(tabName, 'Submissions');
  const escaped = `'${name.replace(/'/g, "''")}'`;
  return `${escaped}!${cellRange}`;
}

exports.handler = async (event) => {
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: 'Method not allowed' })
    };
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = sanitizeEnvToken(process.env.CHALLENGE_SHEET_ID, '');
  const tab = sanitizeEnvToken(
    process.env.CHALLENGE_SHEET_TAB || 'Submissions',
    'Submissions'
  );

  if (!email || !rawKey || !sheetId) {
    const missing = [];
    if (!email) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    if (!rawKey) missing.push('GOOGLE_PRIVATE_KEY');
    if (!sheetId) missing.push('CHALLENGE_SHEET_ID');
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Server not configured',
        detail:
          'Set these environment variables (local: project-root .env loaded by this function; production: Netlify Site settings → Environment variables): ' +
          missing.join(', ')
      })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: 'Invalid JSON' })
    };
  }

  const eventSlug = typeof body.event === 'string' ? body.event.trim() : '';
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const emailAddr = typeof body.email === 'string' ? body.email.trim() : '';
  const url1 = typeof body.url1 === 'string' ? body.url1.trim() : '';
  const url2 = typeof body.url2 === 'string' ? body.url2.trim() : '';
  const eventName =
    typeof body.eventName === 'string' ? body.eventName.trim() : eventSlug;

  if (!eventSlug || !firstName || !lastName || !emailAddr || !url1 || !url2) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        ok: false,
        error:
          'Missing required fields: event, firstName, lastName, email, url1, url2'
      })
    };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: 'Invalid email' })
    };
  }

  const v1 = validateTask(0, url1);
  if (!v1.ok) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: `url1: ${v1.error}` })
    };
  }

  const v2 = validateTask(1, url2);
  if (!v2.ok) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: `url2: ${v2.error}` })
    };
  }

  const privateKey = normalizePrivateKey(rawKey);
  if (!looksLikePemPrivateKey(privateKey)) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Invalid GOOGLE_PRIVATE_KEY',
        detail:
          'Key must be a PEM block from the service account JSON (private_key). In .env use one line with \\n between lines, or double-quoted multiline. If this persists, the value may be truncated (unquoted multiline in .env only keeps the first line).'
      })
    };
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: email,
        private_key: privateKey
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const ts = new Date().toISOString();
    const range = sheetRangeA1(tab, 'A:H');
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            ts,
            eventSlug,
            eventName,
            firstName,
            lastName,
            emailAddr,
            url1,
            url2
          ]
        ]
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('Sheets append error', err);
    const msg = String(err.message || err);
    const parseHint = /parse range|not found|does not exist|Unable to parse/i.test(msg)
      ? ' Check that a tab named exactly like CHALLENGE_SHEET_TAB exists (default Submissions), or set CHALLENGE_SHEET_TAB to your real tab name (e.g. Sheet1). Share the sheet with the service account email.'
      : '';
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Failed to write to spreadsheet',
        detail: msg + parseHint
      })
    };
  }
};
