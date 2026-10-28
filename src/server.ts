import { app } from "./app";
import { flushPersistence, initPersistence } from "./persistence";

const port = Number(process.env.PORT ?? 4000);

async function main(): Promise<void> {
  // MongoDB'dan holat yuklanmaguncha kutamiz. Ulanmasa ham server ishga tushadi —
  // klub MongoDB'siz qolib ketmasligi kerak.
  await initPersistence();

  app.listen(port, () => {
    console.log(`Computer Club MVP server running on http://localhost:${port}`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void flushPersistence().then(() => process.exit(0));
  });
}

void main();
