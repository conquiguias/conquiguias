const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "old_formulario.js");
const target = path.join(__dirname, "old_formulario_utf8.js");
try {
  const buf = fs.readFileSync(file);
  // BOM check FF FE (UTF-16 LE)
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    fs.writeFileSync(target, buf.slice(2).toString("utf16le"), "utf8");
  } else {
    fs.writeFileSync(target, buf.toString("utf8"), "utf8");
  }
  console.log("Converted");
} catch (e) {
  console.error(e);
}
