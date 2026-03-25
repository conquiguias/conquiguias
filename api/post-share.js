const admin = require("firebase-admin");

if (!admin.apps.length) {
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "conquiguias-world-85ccd.firebasestorage.app",
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value, maxLen = 220) {
  const clean = String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trim()}…`;
}

function getOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = req.headers.host || "conquiguias.vercel.app";
  return `${forwardedProto}://${host}`;
}

function toAbsoluteUrl(rawUrl, origin) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${origin}${value}`;
  return "";
}

function resolvePreviewImage(post, origin) {
  const candidates = [
    post?.thumbnailUrl,
    post?.posterUrl,
    post?.radiocover,
    post?.imgurData?.thumbnail,
    post?.imgurData?.poster,
    post?.userPhoto,
  ];

  for (const candidate of candidates) {
    const abs = toAbsoluteUrl(candidate, origin);
    if (abs) return abs;
  }

  return `${origin}/images/logo1.png`;
}

module.exports = async (req, res) => {
  const postId = String(req.query?.id || "").trim();
  const origin = getOrigin(req);
  const viewUrl = `${origin}/post?id=${encodeURIComponent(postId)}`;
  const shareUrl = `${origin}/api/post-share?id=${encodeURIComponent(postId)}`;

  let title = "Post | Conquiguias World";
  let description = "Mira esta publicación en Conquiguias World.";
  let imageUrl = `${origin}/images/logo1.png`;
  let ogType = "article";

  if (postId) {
    try {
      const snap = await admin.firestore().collection("posts").doc(postId).get();
      if (snap.exists) {
        const post = snap.data() || {};
        const author = normalizeText(post.userName || "Usuario", 60);
        const postDescription = normalizeText(post.description || "", 220);

        title = postDescription
          ? `${author}: ${normalizeText(post.description, 90)}`
          : `${author} publicó en Conquiguias World`;

        description =
          postDescription ||
          "Mira esta publicación en Conquiguias World.";

        imageUrl = resolvePreviewImage(post, origin);
        if (String(post?.mediaType || "").toLowerCase().startsWith("video/")) {
          ogType = "video.other";
        }
      }
    } catch (_error) {
      // fallback a metadatos por defecto
    }
  }

  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedImage = escapeHtml(imageUrl);
  const escapedShareUrl = escapeHtml(shareUrl);
  const escapedViewUrl = escapeHtml(viewUrl);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");

  return res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <meta name="description" content="${escapedDescription}" />

    <meta property="og:site_name" content="Conquiguias World" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:image" content="${escapedImage}" />
    <meta property="og:url" content="${escapedShareUrl}" />
    <meta property="og:type" content="${ogType}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    <meta name="twitter:image" content="${escapedImage}" />

    <link rel="canonical" href="${escapedShareUrl}" />
    <meta http-equiv="refresh" content="0;url=${escapedViewUrl}" />
    <script>
      window.location.replace(${JSON.stringify(viewUrl)});
    </script>
  </head>
  <body>
    <p>Redirigiendo a la publicación… <a href="${escapedViewUrl}">Abrir post</a></p>
  </body>
</html>`);
};
