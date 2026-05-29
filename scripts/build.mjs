import { copyFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const src = "src/web";
const dest = "dist/web";

mkdirSync(dest, { recursive: true });

for (const entry of readdirSync(src, { withFileTypes: true })) {
  const srcPath = join(src, entry.name);
  const destPath = join(dest, entry.name);
  if (entry.isDirectory()) {
    mkdirSync(destPath, { recursive: true });
    for (const file of readdirSync(srcPath)) {
      copyFileSync(join(srcPath, file), join(destPath, file));
    }
  } else {
    copyFileSync(srcPath, destPath);
  }
}
