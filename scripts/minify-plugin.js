const fs = require("fs");
const path = require("path");
const { minify } = require("terser");

const libDir = path.join(
    __dirname,
    "..",
    "plugins",
    "mblackman",
    "revision-history",
    "lib"
);

(async () => {
    const files = fs.readdirSync(libDir).filter((f) => f.endsWith(".js"));
    for (const f of files) {
        const full = path.join(libDir, f);
        const src = fs.readFileSync(full, "utf8");
        const result = await minify(src, {
            compress: true,
            mangle: true,
        });
        if (result.error) throw result.error;
        fs.writeFileSync(full, result.code);
        console.log(`minified ${f}`);
    }
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
