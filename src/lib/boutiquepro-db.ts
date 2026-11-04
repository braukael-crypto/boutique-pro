export const DB_NAME = "BoutiqueProDB";
export const DB_VERSION = 5;

export const STORE_NAME = "products";
export const MOVEMENT_STORE = "stockMovements";
export const SALES_STORE = "sales";
export const CUSTOMER_STORE = "customers";
export const CREDIT_PAYMENT_STORE = "creditPayments";
export const EXPENSE_STORE = "expenses";

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

      if (!db.objectStoreNames.contains(CUSTOMER_STORE)) {
        const customerStore = db.createObjectStore(CUSTOMER_STORE, {
          keyPath: "id",
        });
        customerStore.createIndex("name", "name", { unique: false });
        customerStore.createIndex("phone", "phone", { unique: false });
      }

      if (!db.objectStoreNames.contains(EXPENSE_STORE)) {
        const expenseStore = db.createObjectStore(EXPENSE_STORE, { keyPath: "id" });
        expenseStore.createIndex("date", "date", { unique: false });
        expenseStore.createIndex("category", "category", { unique: false });
      }

      if (!db.objectStoreNames.contains(CREDIT_PAYMENT_STORE)) {
        const paymentStore = db.createObjectStore(CREDIT_PAYMENT_STORE, {
          keyPath: "id",
        });
        paymentStore.createIndex("saleId", "saleId", { unique: false });
        paymentStore.createIndex("customerId", "customerId", {
          unique: false,
        });
        paymentStore.createIndex("date", "date", { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}
