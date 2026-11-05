"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { openDatabase, STORE_NAME, MOVEMENT_STORE } from "@/lib/boutiquepro-db";

type Product = {
  id: number;
  name: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;
  quantity: number;
  minStock: number;
};

type StockMovement = {
  id: number;
  productId: number;
  productName: string;
  type: "IN" | "OUT";
  quantity: number;
  reason: string;
  date: string;
  stockBefore: number;
  stockAfter: number;
};


async function getProducts(): Promise<Product[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME).getAll();

    request.onsuccess = () => {
      db.close();
      resolve(request.result as Product[]);
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function saveProduct(product: Product): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(product);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}


async function getMovements(): Promise<StockMovement[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const request = db.transaction(MOVEMENT_STORE, "readonly")
      .objectStore(MOVEMENT_STORE).getAll();

    request.onsuccess = () => {
      db.close();
      const movements = request.result as StockMovement[];
      resolve(movements.sort((a, b) => b.date.localeCompare(a.date)));
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function applyStockMovement(
  productId: number,
  type: "IN" | "OUT",
  quantity: number,
  reason: string
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("La quantité doit être un entier supérieur à zéro.");
  }

  if (!reason.trim()) {
    throw new Error("Veuillez préciser le motif du mouvement.");
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [STORE_NAME, MOVEMENT_STORE],
      "readwrite"
    );

    const productStore = transaction.objectStore(STORE_NAME);
    const movementStore = transaction.objectStore(MOVEMENT_STORE);
    const request = productStore.get(productId);
    let failure: Error | null = null;

    request.onsuccess = () => {
      const product = request.result as Product | undefined;

      if (!product) {
        failure = new Error("Produit introuvable.");
        transaction.abort();
        return;
      }

      const stockBefore = product.quantity;

      if (type === "OUT" && quantity > stockBefore) {
        failure = new Error("Stock insuffisant pour cette sortie.");
        transaction.abort();
        return;
      }

      const stockAfter = type === "IN"
        ? stockBefore + quantity
        : stockBefore - quantity;

      productStore.put({ ...product, quantity: stockAfter });

      movementStore.add({
        id: Date.now(),
        productId: product.id,
        productName: product.name,
        type,
        quantity,
        reason: reason.trim(),
        date: new Date().toISOString(),
        stockBefore,
        stockAfter,
      } satisfies StockMovement);
    };

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onabort = () => {
      db.close();
      reject(failure || transaction.error || new Error("Mouvement annulé."));
    };

    transaction.onerror = () => {
      db.close();
    };
  });
}

export default function StockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movementProductId, setMovementProductId] = useState("");
  const [movementType, setMovementType] = useState<"IN" | "OUT">("IN");
  const [movementQuantity, setMovementQuantity] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [movementError, setMovementError] = useState("");
  const [movementSuccess, setMovementSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Alimentation");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [minStock, setMinStock] = useState("5");

  useEffect(() => {
    Promise.all([getProducts(), getMovements()])
      .then(([loadedProducts, loadedMovements]) => {
        setProducts(loadedProducts);
        setMovements(loadedMovements);
        if (loadedProducts.length > 0) {
          setMovementProductId(String(loadedProducts[0].id));
        }
      })
      .catch(() => setError("Impossible de charger les données du stock."))
      .finally(() => setLoaded(true));
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const purchase = Number(purchasePrice);
    const selling = Number(sellingPrice);
    const qty = Number(quantity);
    const minimum = Number(minStock);

    if (
      !name.trim() ||
      !Number.isFinite(purchase) || purchase < 0 ||
      !Number.isFinite(selling) || selling <= 0 ||
      !Number.isInteger(qty) || qty < 0 ||
      !Number.isInteger(minimum) || minimum < 0
    ) {
      setError("Vérifiez les informations et les montants saisis.");
      return;
    }

    const product: Product = {
      id: editingId ?? Date.now(),
      name: name.trim(),
      category,
      purchasePrice: purchase,
      sellingPrice: selling,
      quantity: qty,
      minStock: minimum,
    };

    try {
      await saveProduct(product);
      setProducts(await getProducts());
      resetForm();
    } catch {
      setError("Enregistrement impossible sur ce téléphone.");
    }
  }

  async function handleMovementSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setMovementError("");
    setMovementSuccess("");

    const productId = Number(movementProductId);
    const qty = Number(movementQuantity);

    if (
      !movementProductId ||
      !Number.isInteger(productId) ||
      !Number.isInteger(qty) ||
      qty <= 0 ||
      !movementReason.trim()
    ) {
      setMovementError("Vérifiez le produit, la quantité et le motif.");
      return;
    }

    try {
      await applyStockMovement(
        productId,
        movementType,
        qty,
        movementReason
      );

      const [updatedProducts, updatedMovements] = await Promise.all([
        getProducts(),
        getMovements(),
      ]);

      setProducts(updatedProducts);
      setMovements(updatedMovements);
      setMovementQuantity("");
      setMovementReason("");
      setMovementSuccess(
        movementType === "IN"
          ? "Entrée de stock enregistrée avec succès."
          : "Sortie de stock enregistrée avec succès."
      );
    } catch (err) {
      setMovementError(
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer le mouvement."
      );
    }
  }

  function resetForm() {
    setName("");
    setCategory("Alimentation");
    setPurchasePrice("");
    setSellingPrice("");
    setQuantity("");
    setMinStock("5");
    setEditingId(null);
  }

  function editProduct(product: Product) {
    setEditingId(product.id);
    setName(product.name);
    setCategory(product.category);
    setPurchasePrice(String(product.purchasePrice));
    setSellingPrice(String(product.sellingPrice));
    setQuantity(String(product.quantity));
    setMinStock(String(product.minStock));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(search.toLowerCase())
  );

  const lowStock = products.filter(
    (product) => product.quantity <= product.minStock
  ).length;

  const totalValue = products.reduce(
    (sum, product) => sum + product.purchasePrice * product.quantity,
    0
  );

  const formatMoney = (value: number) =>
    new Intl.NumberFormat("fr-FR").format(value) + " FCFA";

  if (!loaded) {
    return <main className="p-8 text-center">Chargement du stock...</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-800 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <Link href="/" className="text-sm font-semibold text-blue-700">
              ← Retour au tableau de bord
            </Link>
            <h1 className="mt-3 text-2xl font-extrabold text-slate-900">
              Produits et Stock
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Gérez les produits de votre boutique.
            </p>
          </div>
          <span className="rounded-xl bg-blue-100 px-3 py-2 text-sm font-bold text-blue-800">
            BP
          </span>
        </header>

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">Produits</p>
            <p className="mt-2 text-2xl font-extrabold">{products.length}</p>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">Valeur du stock</p>
            <p className="mt-2 text-lg font-extrabold">
              {formatMoney(totalValue)}
            </p>
          </div>
          <div className="col-span-2 rounded-2xl border bg-white p-4 shadow-sm sm:col-span-1">
            <p className="text-xs text-slate-500">Stocks faibles</p>
            <p className="mt-2 text-2xl font-extrabold text-orange-600">
              {lowStock}
            </p>
          </div>
        </section>

        <section className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">
            {editingId ? "Modifier le produit" : "Ajouter un produit"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Nom du produit</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Exemple : Riz parfumé"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Catégorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
              >
                <option>Alimentation</option>
                <option>Boissons</option>
                <option>Hygiène</option>
                <option>Cosmétiques</option>
                <option>Vêtements</option>
                <option>Électronique</option>
                <option>Autres</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Prix d&apos;achat (FCFA)</label>
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="Ex : 1000"
                  className="w-full rounded-xl border border-slate-300 px-3 py-3"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Prix de vente (FCFA)</label>
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                  placeholder="Ex : 1200"
                  className="w-full rounded-xl border border-slate-300 px-3 py-3"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Quantité disponible</label>
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Ex : 20"
                  className="w-full rounded-xl border border-slate-300 px-3 py-3"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Alerte stock à partir de</label>
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-3"
                />
              </div>
            </div>

            {purchasePrice !== "" && sellingPrice !== "" && (
              <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
                Marge unitaire estimée :{" "}
                <strong>
                  {formatMoney(Number(sellingPrice) - Number(purchasePrice))}
                </strong>
              </p>
            )}

            {error && (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 rounded-xl bg-[#173B70] px-4 py-3 font-bold text-white"
              >
                {editingId ? "Enregistrer les modifications" : "Enregistrer le produit"}
              </button>
              {editingId !== null && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-xl border px-4 py-3 font-semibold"
                >
                  Annuler
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Liste des produits</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un produit..."
            className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3"
          />

          <div className="mt-4 space-y-3">
            {filteredProducts.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">
                Aucun produit enregistré pour le moment.
              </p>
            )}

            {filteredProducts.map((product) => (
              <article key={product.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold">{product.name}</h3>
                    <p className="text-xs text-slate-500">{product.category}</p>
                  </div>
                  <button
                    onClick={() => editProduct(product)}
                    className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"
                  >
                    Modifier
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <p>Prix achat : <strong>{formatMoney(product.purchasePrice)}</strong></p>
                  <p>Prix vente : <strong>{formatMoney(product.sellingPrice)}</strong></p>
                  <p>Quantité : <strong>{product.quantity}</strong></p>
                  <p>Marge : <strong>{formatMoney(product.sellingPrice - product.purchasePrice)}</strong></p>
                </div>

                {product.quantity <= product.minStock && (
                  <p className="mt-3 rounded-lg bg-orange-50 p-2 text-xs font-semibold text-orange-700">
                    ⚠️ Stock faible : seuil de {product.minStock}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>


        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Mouvements de stock</h2>
          <p className="mt-1 text-sm text-slate-500">
            Enregistrez les réapprovisionnements, pertes et autres sorties.
          </p>

          <form onSubmit={handleMovementSubmit} className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold">Produit</label>
              <select
                value={movementProductId}
                onChange={(e) => setMovementProductId(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-300 px-4 py-3"
              >
                <option value="">Choisir un produit</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} — Stock : {product.quantity}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold">Type de mouvement</label>
              <select
                value={movementType}
                onChange={(e) => setMovementType(e.target.value as "IN" | "OUT")}
                className="w-full rounded-xl border border-slate-300 px-4 py-3"
              >
                <option value="IN">Entrée de stock</option>
                <option value="OUT">Sortie de stock</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold">Quantité</label>
              <input
                type="number"
                min="1"
                step="1"
                value={movementQuantity}
                onChange={(e) => setMovementQuantity(e.target.value)}
                required
                placeholder="Ex. : 10"
                className="w-full rounded-xl border border-slate-300 px-4 py-3"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold">Motif</label>
              <select
                value={movementReason}
                onChange={(e) => setMovementReason(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-300 px-4 py-3"
              >
                <option value="">Choisir un motif</option>
                {(
                  movementType === "IN"
                    ? ["Réapprovisionnement", "Retour client", "Correction d'inventaire", "Autre"]
                    : ["Perte", "Casse", "Correction d'inventaire", "Usage interne", "Autre"]
                ).map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </div>

            {movementError && (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {movementError}
              </p>
            )}

            {movementSuccess && (
              <p className="rounded-xl bg-green-50 p-3 text-sm text-green-700">
                {movementSuccess}
              </p>
            )}

            <button
              type="submit"
              disabled={products.length === 0}
              className="w-full rounded-xl bg-[#173B70] px-4 py-3 font-bold text-white disabled:opacity-50"
            >
              Enregistrer le mouvement
            </button>
          </form>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Historique des mouvements</h2>
          <p className="mt-1 text-sm text-slate-500">
            Consultez toutes les entrées et sorties enregistrées.
          </p>

          <div className="mt-4 space-y-3">
            {movements.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">
                Aucun mouvement enregistré pour le moment.
              </p>
            )}

            {movements.map((movement) => (
              <article key={movement.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold">{movement.productName}</h3>
                    <p className="text-xs text-slate-500">
                      {new Date(movement.date).toLocaleString("fr-FR")}
                    </p>
                  </div>
                  <span className={movement.type === "IN"
                    ? "rounded-lg bg-green-50 px-3 py-2 text-xs font-bold text-green-700"
                    : "rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
                  }>
                    {movement.type === "IN" ? "Entrée +" : "Sortie -"}{movement.quantity}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Motif : {movement.reason}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Stock : {movement.stockBefore} → {movement.stockAfter}
                </p>
              </article>
            ))}
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-slate-400">
          BoutiquePro · Stock enregistré localement sur cet appareil
        </p>
      </div>
    </main>
  );
}
