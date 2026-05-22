const ytdl = require('@distube/ytdl-core');

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 30;

const ipHits = new Map();

function setSecurityHeaders(res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function json(res, statusCode, payload) {
    res.status(statusCode).json(payload);
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
    const now = Date.now();
    const existing = ipHits.get(ip);

    if (!existing || existing.resetAt <= now) {
        ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
        return false;
    }

    existing.count += 1;
    if (existing.count > RATE_MAX_REQUESTS) {
        return true;
    }

    return false;
}

function extractYouTubeUrl(req) {
    const fromQuery = req.query?.url;
    const fromVideoUrl = req.query?.videoUrl;
    const fromV = req.query?.v;

    if (typeof fromQuery === 'string' && fromQuery.trim()) {
        return fromQuery.trim();
    }

    if (typeof fromVideoUrl === 'string' && fromVideoUrl.trim()) {
        return fromVideoUrl.trim();
    }

    if (typeof fromV === 'string' && fromV.trim()) {
        return `https://www.youtube.com/watch?v=${fromV.trim()}`;
    }

    return null;
}

function isValidYouTubeHost(hostname) {
    const host = hostname.toLowerCase();
    return (
        host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host === 'youtu.be' ||
        host === 'www.youtu.be'
    );
}

function validateYouTubeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { ok: false, error: 'Debes enviar una URL de YouTube en ?url=' };
    }

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, error: 'La URL no es válida.' };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, error: 'Solo se permiten URLs http/https.' };
    }

    if (!isValidYouTubeHost(parsed.hostname)) {
        return { ok: false, error: 'La URL debe pertenecer a YouTube.' };
    }

    return { ok: true, url: parsed.toString() };
}

function parseDurationSeconds(lengthSeconds) {
    const totalSeconds = Number(lengthSeconds || 0);
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return null;
    }
    return totalSeconds;
}

module.exports = async function audioYouTube(req, res) {
    setSecurityHeaders(res);

    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, {
            success: false,
            error: 'Método no permitido. Usa GET.'
        });
    }

    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
        return json(res, 429, {
            success: false,
            error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.'
        });
    }

    const requestedUrl = extractYouTubeUrl(req);
    const validated = validateYouTubeUrl(requestedUrl);
    if (!validated.ok) {
        return json(res, 400, {
            success: false,
            error: validated.error
        });
    }

    try {
        const info = await ytdl.getInfo(validated.url);
        const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

        if (!audioFormats || audioFormats.length === 0) {
            return json(res, 404, {
                success: false,
                error: 'No se encontró un formato de audio disponible para este video.'
            });
        }

        const bestAudio = ytdl.chooseFormat(audioFormats, {
            quality: 'highestaudio'
        });

        if (!bestAudio?.url) {
            return json(res, 404, {
                success: false,
                error: 'No fue posible resolver la URL temporal de audio.'
            });
        }

        const details = info.videoDetails || {};
        const thumbnails = Array.isArray(details.thumbnails) ? details.thumbnails : [];
        const thumbnail = thumbnails.length ? thumbnails[thumbnails.length - 1].url : null;

        return json(res, 200, {
            success: true,
            title: details.title || null,
            duration: parseDurationSeconds(details.lengthSeconds),
            thumbnail,
            audio: bestAudio.url
        });
    } catch (error) {
        const message = (error && error.message ? error.message : '').toLowerCase();
        const isPrivateOrUnavailable =
            message.includes('private') ||
            message.includes('unavailable') ||
            message.includes('not available') ||
            message.includes('age-restricted');

        return json(res, isPrivateOrUnavailable ? 404 : 500, {
            success: false,
            error: isPrivateOrUnavailable
                ? 'El video no está disponible para extracción de audio.'
                : 'Error interno al resolver el audio temporal.'
        });
    }
};
