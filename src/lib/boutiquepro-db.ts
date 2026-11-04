export const DB_NAME = "BoutiqueProDB";
export const DB_VERSION = 3;

export const STORE_NAME = "products";
export const MOVEMENT_STORE = "stockMovements";
export const SALES_STORE = "sales";

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(MOVEMENT_STORE)) {
        const movementStore = db.createObjectStore(MOVEMENT_STORE, {
          keyPath: "id",
        });
        movementStore.createIndex("productId", "productId", {
          unique: false,
        });
        movementStore.createIndex("date", "date", { unique: false });
      }

      if (!db.objectStoreNames.contains(SALES_STORE)) {
        const salesStore = db.createObjectStore(SALES_STORE, {
          keyPath: "id",
        });
        salesStore.createIndex("date", "date", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
