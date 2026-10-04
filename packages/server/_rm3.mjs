// Removes the structurally broken harness so it can be rewritten cleanly.
import fs from "node:fs";
try {
  fs.unlinkSync("verify/journey3.ts");
  console.log("removed broken journey3.ts");
} catch (e) {
  console.log("nothing to remove:", e.message);
}