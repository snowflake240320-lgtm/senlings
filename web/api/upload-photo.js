const crypto = require("crypto");

function b64url(buf) {
  return (Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken(credentials) {
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss:   credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
  }));

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const jwt = `${signingInput}.${b64url(sign.sign(credentials.private_key))}`;

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

async function driveGet(path, token) {
  const res  = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Drive GET error: ${res.status}`);
  return data;
}

async function drivePost(path, body, token) {
  const res  = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Drive POST error: ${res.status}`);
  return data;
}

async function getOrCreateFolder(name, parentId, token) {
  const q = `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`;
  const { files } = await driveGet(`/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`, token);
  if (files.length > 0) return files[0].id;
  const folder = await drivePost("/files?fields=id", {
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents:  [parentId],
  }, token);
  return folder.id;
}

async function uploadFile(filename, imageBuffer, parentId, token) {
  const boundary = "senlingsbound";
  const meta     = JSON.stringify({ name: filename, parents: [parentId] });
  const body     = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
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
  if (!res.ok) throw new Error(data.error?.message ?? `Upload error: ${res.status}`);
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
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
    // Vercel環境変数で \n がエスケープされている場合の対処
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");

    const token       = await getAccessToken(credentials);
    const imageBuffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");

    const senlingsId = await getOrCreateFolder("Senlings写真", rootFolderId, token);
    const projectFId = await getOrCreateFolder(projectId,      senlingsId,   token);
    const dateFId    = await getOrCreateFolder(date,           projectFId,   token);

    const file = await uploadFile(filename, imageBuffer, dateFId, token);
    return res.status(200).json({ id: file.id, name: file.name, url: file.webViewLink });

  } catch (err) {
    console.error("upload-photo error:", err);
    return res.status(500).json({ error: err.message });
  }
};
