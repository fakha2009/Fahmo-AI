const DB_NAME = 'fahmo-ai';
const DB_VERSION = 1;
const STORES = ['analyses', 'drafts', 'settings', 'shares'];

let databasePromise;

function openDatabase() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB is not available'));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const storeName of STORES) {
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { keyPath: 'id' });
          if (storeName === 'analyses') {
            store.createIndex('updatedAt', 'updatedAt');
            store.createIndex('status', 'status');
          }
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return databasePromise;
}

async function transaction(storeName, mode, callback) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try { result = callback(store); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function dbPut(storeName, value) {
  return transaction(storeName, 'readwrite', (store) => requestToPromise(store.put(structuredClone(value))));
}

export async function dbGet(storeName, id) {
  const database = await openDatabase();
  const tx = database.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).get(id));
}

export async function dbDelete(storeName, id) {
  return transaction(storeName, 'readwrite', (store) => requestToPromise(store.delete(id)));
}

export async function dbGetAll(storeName) {
  const database = await openDatabase();
  const tx = database.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).getAll());
}

export async function dbClear(storeName) {
  return transaction(storeName, 'readwrite', (store) => requestToPromise(store.clear()));
}

export async function exportDatabase() {
  const result = {};
  for (const store of STORES) result[store] = await dbGetAll(store);
  return {
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    data: result
  };
}

export async function deleteDatabase() {
  if (databasePromise) {
    const database = await databasePromise.catch(() => null);
    database?.close();
    databasePromise = undefined;
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not delete database'));
    request.onblocked = () => reject(new Error('Database deletion is blocked by another tab'));
  });
}
