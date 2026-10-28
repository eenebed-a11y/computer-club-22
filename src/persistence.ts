import { Db, MongoClient } from "mongodb";

import { StoreSnapshot, store } from "./store";

const DB_NAME = "computer_club";
const COLLECTION = "state";
const DOC_ID = "singleton";
const SAVE_DEBOUNCE_MS = 2_000;
const CONNECT_RETRY_MS = 10_000;
const SERVER_SELECTION_TIMEOUT_MS = 12_000;

type StateDocument = StoreSnapshot & { _id: string };

const uri = process.env.MONGODB_URI;

let client: MongoClient | null = null;
let db: Db | null = null;
let connected = false;
let saving = false;
let stopped = false;
let saveTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scheduleSave(): void {
  if (!connected || stopped) {
    return;
  }

  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    void save();
  }, SAVE_DEBOUNCE_MS);
}

async function writeSnapshot(): Promise<void> {
  if (!db) {
    return;
  }

  await db
    .collection<StateDocument>(COLLECTION)
    .updateOne({ _id: DOC_ID }, { $set: store.toSnapshot() }, { upsert: true });
}

async function save(): Promise<void> {
  if (!db || stopped) {
    return;
  }

  if (saving) {
    scheduleSave();
    return;
  }

  saving = true;

  try {
    await writeSnapshot();
  } catch (error) {
    console.error(`MongoDB: saqlashda xato (${errorText(error)})`);
    // Keyingi o'zgarishda yoki debounce taymerida qayta uriniladi.
    scheduleSave();
  } finally {
    saving = false;
  }
}

async function attemptConnect(): Promise<void> {
  if (stopped || connected || !uri) {
    return;
  }

  try {
    const candidate = new MongoClient(uri, {
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    });

    await candidate.connect();

    const database = candidate.db(DB_NAME);
    const collection = database.collection<StateDocument>(COLLECTION);
    const doc = await collection.findOne({ _id: DOC_ID });

    if (doc) {
      const { _id, ...snapshot } = doc;
      store.loadSnapshot(snapshot);
      console.log(
        `MongoDB: holat yuklandi (${snapshot.pcs.length} PC, ${snapshot.sessions.length} sessiya, ${snapshot.payments.length} to'lov)`,
      );
    } else {
      await collection.updateOne({ _id: DOC_ID }, { $set: store.toSnapshot() }, { upsert: true });
      console.log("MongoDB: boshlang'ich holat yozildi");
    }

    client = candidate;
    db = database;
    connected = true;
    store.onChange(scheduleSave);
    console.log(`MongoDB: ulandi (${DB_NAME}.${COLLECTION})`);
  } catch (error) {
    console.error(
      `MongoDB: ulanmadi (${errorText(error)}). Xotira rejimida davom etamiz, ${CONNECT_RETRY_MS / 1000} soniyadan keyin qayta urinamiz.`,
    );
    retryTimer = setTimeout(() => void attemptConnect(), CONNECT_RETRY_MS);
  }
}

/// Birinchi urinish tugagach qaytadi (muvaffaqiyatli yoki yo'q) — server shundan keyin ishga tushadi.
export async function initPersistence(): Promise<void> {
  if (!uri) {
    console.log("MONGODB_URI o'rnatilmagan — xotira rejimida ishlayapmiz.");
    return;
  }

  await attemptConnect();
}

/// Jarayon to'xtashidan oldin oxirgi holatni yozib qo'yish.
export async function flushPersistence(): Promise<void> {
  stopped = true;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (connected) {
    try {
      await writeSnapshot();
    } catch (error) {
      console.error(`MongoDB: yakuniy saqlashda xato (${errorText(error)})`);
    }
  }

  await client?.close();
}
