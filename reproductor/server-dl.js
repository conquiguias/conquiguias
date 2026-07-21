// server-dl.js — Servidor local de descarga YouTube
// Puerto: 3099
// Uso: node server-dl.js
// Requiere: npm install @distube/ytdl-core

var http = require('http');
var url = require('url');

var PORT = 3099;
var YTDL = null;
try {
  YTDL = require('@distube/ytdl-core');
} catch (_) {}

var QUALITY_MAP = {
  '144p': { v: '144p', a: null },
  '360p': { v: '360p', a: null },
  '480p': { v: '480p', a: null },
  '720p': { v: '720p', a: null },
  '1080p': { v: '1080p', a: null },
  '128 kbps': { v: null, a: '128' },
  '192 kbps': { v: null, a: '192' },
  '256 kbps': { v: null, a: '256' },
  '320 kbps': { v: null, a: '320' }
};

function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function error(res, msg) {
  json(res, 200, { success: false, error: msg });
}

function getBestUrl(info, quality, format) {
  var formats = info.formats || [];

  if (format === 'mp3') {
    var audioOnly = formats.filter(function(f) {
      return f.hasAudio && !f.hasVideo;
    });
    if (audioOnly.length === 0) audioOnly = formats.filter(function(f) { return f.hasAudio; });
    var bitrateTarget = parseInt(quality, 10);
    if (bitrateTarget) {
      audioOnly.sort(function(a, b) {
        return Math.abs((b.audioBitrate || 0) - bitrateTarget) - Math.abs((a.audioBitrate || 0) - bitrateTarget);
      });
    }
    return audioOnly.length > 0 ? audioOnly[0].url : null;
  }

  var combined = formats.filter(function(f) { return f.hasVideo && f.hasAudio; });
  if (combined.length === 0) combined = formats.filter(function(f) { return f.hasVideo; });

  var heightMap = { '144': 144, '240': 240, '360': 360, '480': 480, '720': 720, '1080': 1080, '1440': 1440, '2160': 2160, '4320': 4320 };
  var targetH = heightMap[quality] || 720;

  combined.sort(function(a, b) {
    var ah = a.height || 0;
    var bh = b.height || 0;
    return Math.abs(bh - targetH) - Math.abs(ah - targetH);
  });
  return combined.length > 0 ? combined[0].url : null;
}

function handleRequest(req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (pathname !== '/api/yt-dl') {
    console.log('[server-dl] 404 ruta no encontrada:', pathname);
    return json(res, 404, { success: false, error: 'Ruta no encontrada' });
  }

  var id = (parsed.query.id || '').trim();
  var quality = (parsed.query.quality || '720p').trim();
  var format = (parsed.query.format || 'mp4').trim();

  console.log('[server-dl] solicitud recibida:', { id: id, quality: quality, format: format, ip: req.socket.remoteAddress });

  if (!id) {
    console.log('[server-dl] error: falta id');
    return error(res, 'Falta el par\u00e1metro id');
  }
  if (!YTDL) {
    console.log('[server-dl] error: ytdl-core no instalado');
    return error(res, 'ytdl-core no instalado. Ejecuta: npm install @distube/ytdl-core');
  }

  var opts = {};
  if (format === 'mp3') {
    opts.filter = 'audioonly';
  }

  YTDL.getInfo('https://www.youtube.com/watch?v=' + id, opts).then(function(info) {
    var dlUrl = getBestUrl(info, quality, format);
    if (!dlUrl) {
      console.log('[server-dl] no se encontr\u00f3 stream para', quality, '| formatos disponibles:', info.formats.length);
      return error(res, 'No se encontr\u00f3 un stream compatible para ' + quality);
    }
    console.log('[server-dl] \u00e9xito:', { id: id, quality: quality, format: format, title: info.videoDetails.title, urlLength: dlUrl.length });
    json(res, 200, { success: true, url: dlUrl, title: info.videoDetails.title });
  }).catch(function(err) {
    var msg = String(err.message || err);
    console.log('[server-dl] error ytdl-core:', { id: id, quality: quality, format: format, error: msg.slice(0, 200) });
    if (msg.indexOf('Video unavailable') !== -1) return error(res, 'Video no disponible');
    if (msg.indexOf('Private video') !== -1) return error(res, 'Video privado');
    if (msg.indexOf('copyright') !== -1) return error(res, 'Video bloqueado por copyright');
    error(res, 'Error al obtener informaci\u00f3n: ' + msg.slice(0, 120));
  });
}

http.createServer(handleRequest).listen(PORT, function() {
  console.log('YouTube Download Server en http://localhost:' + PORT + '/api/yt-dl');
  console.log('Ejemplo: http://localhost:' + PORT + '/api/yt-dl?id=dQw4w9WgXcQ&quality=720p&format=mp4');
  if (!YTDL) console.log('ADVERTENCIA: @distube/ytdl-core no est\u00e1 instalado. Ejecuta: npm install @distube/ytdl-core');
});
