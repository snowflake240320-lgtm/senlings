const crypto = require("crypto");

// ----------------------------------------------------------------
// JWT生成 → OAuth2アクセストークン取得
// ----------------------------------------------------------------
function b64url(input) {
  const b64 = Buffer.isBuffer(input)
    ? input.toString("base64")
    : Buffer.from(typeof input === "string" ? input : JSON.stringify(input)).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(credentials) {
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url({ alg: "RS256", typ: "JWT" });
  const payload = b64url({
    iss:   credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
  });

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const sig = b64url(Buffer.from(sign.sign(credentials.private_key, "base64"), "base64"));
  const jwt = `${signingInput}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Auth failed: ${data.error_description ?? data.error}`);
  return data.access_token;
}

// ----------------------------------------------------------------
// Drive API ヘルパー
// ----------------------------------------------------------------
async function driveGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Drive API error");
  return data;
}

async function drivePost(url, body, token) {
  const res = await fetch(url, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Drive API error");
  return data;
}

async function getOrCreateFolder(name, parentId, token) {
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and '${parentId}' in parents and trashed=false`;
  const { files } = await driveGet(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
    token
  );
  if (files.length > 0) return files[0].id;

  const folder = await drivePost(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    token
  );
  return folder.id;
}

async function uploadFile(filename, imageBuffer, parentId, token) {
  const boundary = "senlingsbound";
  const meta     = JSON.stringify({ name: filename, parents: [parentId] });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`
    ),
    imageBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Upload failed");
  return data;
}

// ----------------------------------------------------------------
// ハンドラー
// ----------------------------------------------------------------
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { projectId, date, filename, dataUrl } = req.body ?? {};
  if (!projectId || !date || !filename || !dataUrl) {
    return res.status(400).json({ error: "Missing required fields: projectId, date, filename, dataUrl" });
  }

  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const rootFolderId       = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!serviceAccountJson || !rootFolderId) {
    return res.status(500).json({ error: "Google Drive env vars not configured" });
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    return res.status(500).json({ error: "Invalid GOOGLE_SERVICE_ACCOUNT_JSON" });
  }

  const token       = await getAccessToken(credentials);
  const imageBuffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");

  // Senlings写真/{projectId}/{date}/ の階層を確保
  const senlingsId = await getOrCreateFolder("Senlings写真", rootFolderId, token);
  const projectFId = await getOrCreateFolder(projectId,      senlingsId,   token);
  const dateFId    = await getOrCreateFolder(date,           projectFId,   token);

  const file = await uploadFile(filename, imageBuffer, dateFId, token);
  return res.status(200).json({ id: file.id, name: file.name, url: file.webViewLink });
};
