# Prize challenge: Google Sheet via Apps Script (alternative)

**Preferred:** use the built-in Netlify function [`netlify/functions/submit-challenge.js`](../netlify/functions/submit-challenge.js) and Google Sheets API (see [README.md](../README.md) Prize challenge section).

This document is an optional **client-only** flow: the prize lab POSTs JSON to an HTTPS URL you set in `CONFIG.PRIZE_CHALLENGE.SUBMIT_ENDPOINT` or `<meta name="challenge-submit-endpoint" content="https://...">` in `index.html`.

## 1. Create a Google Sheet

Add a header row, for example:

| timestamp | event | eventName | fullName | cloudName | url1 | url2 |

## 2. Apps Script

1. In the Sheet: **Extensions → Apps Script**.
2. Replace `Code.gs` with something like:

```javascript
const SHEET_NAME = 'Submissions';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        'timestamp',
        'event',
        'eventName',
        'fullName',
        'cloudName',
        'url1',
        'url2'
      ]);
    }
    sheet.appendRow([
      body.timestamp || '',
      body.event || '',
      body.eventName || '',
      body.fullName || '',
      body.cloudName || '',
      body.url1 || '',
      body.url2 || ''
    ]);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}

function doGet() {
  return ContentService.createTextOutput('Prize challenge endpoint is POST-only.');
}

function jsonResponse(obj, statusCode) {
  const out = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
  // Apps Script Web Apps do not expose status codes to browsers the same way as HTTP servers;
  // success/failure is in the JSON body.
  return out;
}
```

3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (required for public booth devices)

4. Copy the **Web app URL** and paste it into the meta tag or `SUBMIT_ENDPOINT`.

## 3. CORS

If the browser blocks the request with a CORS error, try:

- Redeploy the script after changes, or  
- Put a small **Netlify Function** (or other server) in front that forwards the POST to the Sheet with a server-side API, or  
- Use a third-party form-to-Sheet product that gives you a CORS-friendly URL.

The app sends:

```json
{
  "event": "wearedevs2026",
  "eventName": "We Are Developers 2026",
  "fullName": "Ada Lovelace",
  "cloudName": "jen-demos",
  "url1": "https://res.cloudinary.com/...",
  "url2": "https://res.cloudinary.com/..."
}
```

`cloudName` is optional; omit the field or send `""` if not collected.

## 4. Event slug

Booth buttons can set `data-event="your-slug"` so the URL becomes `?challenge=true&event=your-slug`. Add a label in `CONFIG.PRIZE_CHALLENGE.EVENT_LABELS` in `main.js` for a friendly **eventName** stored in the sheet.
