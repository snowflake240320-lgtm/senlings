const { google } = require("googleapis");
const { Readable } = require("stream");

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

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  const drive = google.drive({ version: "v3", auth });

  // base64 DataURL → Buffer
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");

  // フォルダを取得または作成するヘルパー
  async function getOrCreateFolder(name, parentId) {
    const q = [
      `mimeType='application/vnd.google-apps.folder'`,
      `name='${name.replace(/'/g, "\\'")}'`,
      `'${parentId}' in parents`,
      `trashed=false`,
    ].join(" and ");

    const { data } = await drive.files.list({
      q,
      fields: "files(id)",
      spaces: "drive",
    });

    if (data.files.length > 0) return data.files[0].id;

    const { data: folder } = await drive.files.create({
      requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
      fields: "id",
    });
    return folder.id;
  }

  // Senlings写真/{projectId}/{date}/ の階層を確保
  const senlingsId  = await getOrCreateFolder("Senlings写真", rootFolderId);
  const projectFId  = await getOrCreateFolder(projectId, senlingsId);
  const dateFId     = await getOrCreateFolder(date, projectFId);

  // ファイルをアップロード
  const { data: file } = await drive.files.create({
    requestBody: { name: filename, parents: [dateFId] },
    media: {
      mimeType: "image/jpeg",
      body: Readable.from(buffer),
    },
    fields: "id,name,webViewLink",
  });

  return res.status(200).json({ id: file.id, name: file.name, url: file.webViewLink });
};
