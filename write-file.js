const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
fs.writeFileSync(data.path, data.content, "utf8");
console.log("Written", data.path);
