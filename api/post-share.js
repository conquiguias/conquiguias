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

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
  if (/^data:/i.test(value)) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${origin}${value}`;
  return "";
}

function isLikelyImageUrl(value) {
  const url = String(value || "").trim();
  if (!url) return false;
  return /\.(?:jpe?g|png|gif|webp|bmp|svg|avif)(?:$|[?#])/i.test(url);
}

function extractYouTubeVideoId(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";

  try {
    const parsed = new URL(value);
    const host = (parsed.hostname || "").toLowerCase();
    let candidate = "";

    if (host === "youtu.be") {
      candidate = (parsed.pathname || "").split("/").filter(Boolean)[0] || "";
    } else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      candidate = parsed.searchParams.get("v") || "";
      if (!candidate) {
        const segments = (parsed.pathname || "").split("/").filter(Boolean);
        const marker = segments.findIndex((seg) => ["embed", "shorts", "live", "v"].includes(seg));
        if (marker >= 0 && segments[marker + 1]) {
          candidate = segments[marker + 1];
        }
      }
    }

    candidate = String(candidate || "").trim();
    if (!/^[a-zA-Z0-9_-]{10,15}$/.test(candidate)) return "";
    return candidate;
  } catch (_error) {
    return "";
  }
}

function getYouTubeThumbnail(rawUrl) {
  const videoId = extractYouTubeVideoId(rawUrl);
  if (!videoId) return "";
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function normalizeProfilePhotoForPreview(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";

  if (/dummyimage\.com\/(?:40x40|45x45|64x64)/i.test(value)) {
    return "";
  }

  if (/googleusercontent\.com/i.test(value) && /=s\d+-c/i.test(value)) {
    return value.replace(/=s\d+-c/i, "=s1200-c");
  }

  return value;
}

function extractImgurId(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";

  try {
    const parsed = new URL(value);
    if (!/imgur\.com$/i.test(parsed.hostname)) return "";

    const fileName = (parsed.pathname || "").split("/").filter(Boolean).pop() || "";
    if (!fileName) return "";

    const dotAt = fileName.lastIndexOf(".");
    let imgurId = dotAt > 0 ? fileName.slice(0, dotAt) : fileName;

    if (imgurId.length > 6 && /[sbtmlh]$/i.test(imgurId)) {
      imgurId = imgurId.slice(0, -1);
    }

    if (!/^[a-z0-9]+$/i.test(imgurId)) return "";
    return imgurId;
  } catch (_error) {
    return "";
  }
}

function resolveImgurVideoPoster(post, origin) {
  const directCandidates = [
    post?.imgurData?.thumbnail,
    post?.imgurData?.thumb,
    post?.imgurData?.poster,
  ];

  for (const candidate of directCandidates) {
    const abs = toAbsoluteUrl(candidate, origin);
    if (abs) return abs;
  }

  const mp4Candidates = [post?.imgurData?.mp4, post?.mediaUrl];
  for (const mp4Candidate of mp4Candidates) {
    const absMp4 = toAbsoluteUrl(mp4Candidate, origin);
    if (!absMp4) continue;
    const imgurId = extractImgurId(absMp4);
    if (imgurId) return `https://i.imgur.com/${imgurId}.jpg`;
    if (/i\.imgur\.com\/[^/?#]+\.mp4(?:$|[?#])/i.test(absMp4)) {
      return absMp4.replace(/\.mp4(?=$|[?#])/i, ".jpg");
    }
  }

  const imgurId = String(post?.imgurData?.id || "").trim();
  if (/^[a-z0-9]+$/i.test(imgurId)) {
    return `https://i.imgur.com/${imgurId}.jpg`;
  }

  return "";
}

function resolvePreviewImage(post, origin) {
  const coverCandidates = [
    post?.radiocover,
    post?.posterUrl,
    post?.thumbnailUrl,
    post?.thumbnail,
    post?.thumbUrl,
    post?.poster,
    post?.imgurData?.thumbnail,
    post?.imgurData?.thumb,
    post?.imgurData?.poster,
  ];

  for (const candidate of coverCandidates) {
    const abs = toAbsoluteUrl(candidate, origin);
    if (abs) return abs;
  }

  const imgurPoster = resolveImgurVideoPoster(post, origin);
  if (imgurPoster) return imgurPoster;

  const youTubeThumb = toAbsoluteUrl(getYouTubeThumbnail(post?.mediaUrl), origin);
  if (youTubeThumb) return youTubeThumb;

  const mediaUrl = toAbsoluteUrl(post?.mediaUrl, origin);
  if (mediaUrl && isLikelyImageUrl(mediaUrl)) return mediaUrl;

  const profileCandidates = [
    normalizeProfilePhotoForPreview(post?.coverimage),
    normalizeProfilePhotoForPreview(post?.userPhoto),
    normalizeProfilePhotoForPreview(post?.photoURL),
  ];
  for (const candidate of profileCandidates) {
    const abs = toAbsoluteUrl(candidate, origin);
    if (abs) return abs;
  }

  return `${origin}/images/logo1.png`;
}

async function handleSitemap(req, res) {
  const origin = getOrigin(req);
  const urls = [
    { loc: `${origin}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${origin}/post`, changefreq: "daily", priority: "0.8" },
    { loc: `${origin}/sitemap.xml`, changefreq: "daily", priority: "0.5" },
  ];

  try {
    const postsSnap = await admin
      .firestore()
      .collection("posts")
      .where("status", "==", "approved")
      .orderBy("timestamp", "desc")
      .limit(1000)
      .get();

    postsSnap.forEach((docSnap) => {
      const post = docSnap.data() || {};
      const loc = `${origin}/share/${encodeURIComponent(docSnap.id)}`;
      const rawDate = post.timestamp || post.creado || "";
      let lastmod = "";
      const parsed = new Date(rawDate);
      if (!Number.isNaN(parsed.getTime())) {
        lastmod = parsed.toISOString();
      }

      urls.push({
        loc,
        lastmod,
        changefreq: "weekly",
        priority: "0.7",
      });
    });
  } catch (_error) {
    // Mantener solo URLs estáticas si falla la lectura de posts
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((item) => {
      const lastmodTag = item.lastmod
        ? `    <lastmod>${escapeXml(item.lastmod)}</lastmod>\n`
        : "";
      return `  <url>\n    <loc>${escapeXml(item.loc)}</loc>\n${lastmodTag}    <changefreq>${escapeXml(item.changefreq)}</changefreq>\n    <priority>${escapeXml(item.priority)}</priority>\n  </url>`;
    })
    .join("\n")}\n</urlset>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1200");
  return res.status(200).send(xml);
}

module.exports = async (req, res) => {
  const action = String(req.query?.action || "").trim().toLowerCase();
  const postId = String(req.query?.id || "").trim();

  if (action === "sitemap" || (!action && !postId)) {
    return handleSitemap(req, res);
  }

  const origin = getOrigin(req);
  const encodedPostId = encodeURIComponent(postId);
  const viewUrl = postId ? `${origin}/post/${encodedPostId}` : `${origin}/post`;
  const shareUrl = postId ? `${origin}/share/${encodedPostId}` : `${origin}/share`;

  let title = "Post | Conquiguias World";
  let description = "Mira esta publicación en Conquiguias World.";
  let imageUrl = `${origin}/images/logo1.png`;
  let ogType = "article";
  let authorName = "Conquiguias World";
  let publishedAt = "";

  if (postId) {
    try {
      const snap = await admin.firestore().collection("posts").doc(postId).get();
      if (snap.exists) {
        const post = snap.data() || {};
        const author = normalizeText(post.userName || "Usuario", 60);
        const postDescription = normalizeText(post.description || "", 220);
        const rawPublishedAt = post.timestamp || post.creado || "";

        title = postDescription
          ? `${author}: ${normalizeText(post.description, 90)}`
          : `${author} publicó en Conquiguias World`;

        description =
          postDescription ||
          "Mira esta publicación en Conquiguias World.";

        imageUrl = resolvePreviewImage(post, origin);
        authorName = author || "Conquiguias World";
        const parsedDate = new Date(rawPublishedAt);
        if (!Number.isNaN(parsedDate.getTime())) {
          publishedAt = parsedDate.toISOString();
        }
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
  const escapedAuthor = escapeHtml(authorName);
  const escapedPublishedAt = escapeHtml(publishedAt);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SocialMediaPosting",
    headline: title,
    description,
    image: imageUrl,
    url: shareUrl,
    mainEntityOfPage: shareUrl,
    author: {
      "@type": "Person",
      name: authorName,
    },
    publisher: {
      "@type": "Organization",
      name: "Conquiguias World",
      logo: {
        "@type": "ImageObject",
        url: `${origin}/logo1.png`,
      },
    },
  };

  if (publishedAt) {
    structuredData.datePublished = publishedAt;
    structuredData.dateModified = publishedAt;
  }

  const structuredDataJson = JSON.stringify(structuredData).replace(/<\//g, "<\\/");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");

  return res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <meta name="description" content="${escapedDescription}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />

    <meta property="og:site_name" content="Conquiguias World" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:image" content="${escapedImage}" />
    <meta property="og:image:secure_url" content="${escapedImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Vista previa de publicación" />
    <meta property="og:url" content="${escapedShareUrl}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="article:author" content="${escapedAuthor}" />
    ${publishedAt ? `<meta property="article:published_time" content="${escapedPublishedAt}" />` : ""}

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    <meta name="twitter:image" content="${escapedImage}" />
    <meta name="twitter:image:alt" content="Vista previa de publicación" />

    <link rel="canonical" href="${escapedShareUrl}" />
    <script type="application/ld+json">${structuredDataJson}</script>
    <script>
      (function () {
        var ua = (navigator.userAgent || "").toLowerCase();
        var isBot = /bot|crawler|spider|facebookexternalhit|whatsapp|twitterbot|slackbot|discordbot|linkedinbot|telegrambot|googlebot|bingbot|skypeuripreview|pinterest|vkshare|line\//.test(ua);
        if (!isBot) {
          setTimeout(function () {
            window.location.replace(${JSON.stringify(viewUrl)});
          }, 900);
        }
      })();
    </script>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
      .wrap { max-width: 760px; margin: 32px auto; padding: 0 16px; }
      .card { border: 1px solid #334155; border-radius: 12px; background: #1e293b; overflow: hidden; }
      .cover { display: block; width: 100%; max-height: 380px; object-fit: cover; background: #111827; }
      .content { padding: 16px; }
      .title { font-size: 20px; margin: 0 0 10px; }
      .desc { color: #cbd5e1; line-height: 1.45; margin: 0 0 14px; }
      .meta { font-size: 12px; color: #94a3b8; margin-bottom: 12px; }
      .btn { display: inline-block; text-decoration: none; background: #3b82f6; color: #fff; padding: 10px 14px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <img class="cover" src="${escapedImage}" alt="Vista previa de publicación" />
        <div class="content">
          <h1 class="title">${escapedTitle}</h1>
          <p class="desc">${escapedDescription}</p>
          ${publishedAt ? `<div class="meta">Publicado: ${escapedPublishedAt}</div>` : ""}
          <a class="btn" href="${escapedViewUrl}">Abrir publicación</a>
        </div>
      </div>
    </div>
  </body>
</html>`);
};
