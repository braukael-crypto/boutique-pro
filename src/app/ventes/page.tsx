"use client";

import { useEffect, useMemo, useState } from "react";
import {
  openDatabase,
  STORE_NAME,
  MOVEMENT_STORE,
  SALES_STORE,
} from "@/lib/boutiquepro-db";

type Product = {
  id: number;
  name: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;
  quantity: number;
  minStock: number;
};

type CartItem = {
  productId: number;
  quantity: number;
};

type SaleItem = {
  productId: number;
  productName: string;
  quantity: number;
  purchasePrice: number;
  sellingPrice: number;
  subtotal: number;
  estimatedProfit: number;
};

type Sale = {
  id: number;
  date: string;
  items: SaleItem[];
  total: number;
  estimatedProfit: number;
  paymentMethod: "CASH" | "MOBILE_MONEY" | "CREDIT";
};

type PaymentMethod = Sale["paymentMethod"];

async function getProducts(): Promise<Product[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => resolve(request.result as Product[]);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function getSales(): Promise<Sale[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SALES_STORE, "readonly");
    const request = transaction.objectStore(SALES_STORE).getAll();

    request.onsuccess = () => {
      const sales = request.result as Sale[];
      resolve(sales.sort((a, b) => b.date.localeCompare(a.date)));
    };

    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function saveSale(
  cart: CartItem[],
  paymentMethod: PaymentMethod,
  products: Product[],
): Promise<void> {
  if (cart.length === 0) {
    throw new Error("Ajoutez au moins un produit à la vente.");
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [STORE_NAME, MOVEMENT_STORE, SALES_STORE],
      "readwrite",
    );

    const productStore = transaction.objectStore(STORE_NAME);
    const movementStore = transaction.objectStore(MOVEMENT_STORE);
    const salesStore = transaction.objectStore(SALES_STORE);

    const saleId = Date.now();
    const date = new Date().toISOString();
    const items: SaleItem[] = [];
    let failure: Error | null = null;
    let pending = cart.length;

    const fail = (message: string) => {
      if (!failure) {
        failure = new Error(message);
        transaction.abort();
      }
    };

    cart.forEach((cartItem) => {
      const request = productStore.get(cartItem.productId);

      request.onsuccess = () => {
        if (failure) return;

        const product = request.result as Product | undefined;

        if (!product) {
          fail("Un produit sélectionné est introuvable.");
          return;
        }

        if (
          !Number.isInteger(cartItem.quantity) ||
          cartItem.quantity <= 0
        ) {
          fail("Une quantité de vente est invalide.");
          return;
        }

        if (cartItem.quantity > product.quantity) {
          fail(`Stock insuffisant pour ${product.name}. Disponible : ${product.quantity}.`);
          return;
        }

        const subtotal = product.sellingPrice * cartItem.quantity;
        const estimatedProfit =
          (product.sellingPrice - product.purchasePrice) *
          cartItem.quantity;

        items.push({
          productId: product.id,
          productName: product.name,
          quantity: cartItem.quantity,
          purchasePrice: product.purchasePrice,
          sellingPrice: product.sellingPrice,
          subtotal,
          estimatedProfit,
        });

        productStore.put({
          ...product,
          quantity: product.quantity - cartItem.quantity,
        });

        movementStore.add({
          id: saleId + items.length,
          productId: product.id,
          productName: product.name,
          type: "OUT",
          quantity: cartItem.quantity,
          reason: `Vente #${saleId}`,
          date,
          stockBefore: product.quantity,
          stockAfter: product.quantity - cartItem.quantity,
        });

        pending -= 1;

        if (pending === 0) {
          const total = items.reduce((sum, item) => sum + item.subtotal, 0);
          const profit = items.reduce(
            (sum, item) => sum + item.estimatedProfit,
            0,
          );

          salesStore.add({
            id: saleId,
            date,
            items,
            total,
            estimatedProfit: profit,
            paymentMethod,
          } satisfies Sale);
        }
      };

      request.onerror = () => fail("Impossible de lire un produit.");
    });

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onabort = () => {
      db.close();
      reject(failure ?? transaction.error ?? new Error("Vente annulée."));
    };

    transaction.onerror = () => {
      db.close();
    };
  });
}

function printReceipt(sale: Sale) {
  const paymentLabel =
    sale.paymentMethod === "CASH"
      ? "Espèces"
      : sale.paymentMethod === "MOBILE_MONEY"
        ? "Mobile Money"
        : "Crédit";

  const rows = sale.items.map((item) => `
    <tr>
      <td>${item.productName} × ${item.quantity}</td>
      <td>${item.subtotal.toLocaleString("fr-FR")} FCFA</td>
    </tr>
  `).join("");

  const receipt = `
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Reçu BoutiquePro</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #222; }
          .receipt { max-width: 380px; margin: auto; }
          h1, .center { text-align: center; }
          h1 { color: #173B70; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          td { padding: 10px 4px; border-bottom: 1px solid #ddd; }
          td:last-child { text-align: right; }
          .total { font-size: 18px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; margin-top: 30px; font-size: 12px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="receipt">
          <h1>BoutiquePro</h1>
          <p class="center">REÇU DE VENTE</p>
          <p>Reçu N° : ${sale.id}</p>
          <p>Date : ${new Date(sale.date).toLocaleString("fr-FR")}</p>
          <table>
            ${rows}
          </table>
          <p class="total">TOTAL : ${sale.total.toLocaleString("fr-FR")} FCFA</p>
          <p>Mode de paiement : ${paymentLabel}</p>
          <p class="footer">Merci pour votre confiance !</p>
        </div>
      </body>
    </html>
  `;

  const printWindow = window.open("", "_blank", "width=500,height=700");

  if (!printWindow) {
    alert("Autorisez les fenêtres contextuelles pour imprimer le reçu.");
    return;
  }

  printWindow.document.write(receipt);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function formatMoney(value: number): string {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

export default function SalesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("CASH");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  async function refreshData() {
    const [loadedProducts, loadedSales] = await Promise.all([
      getProducts(),
      getSales(),
    ]);

    setProducts(loadedProducts);
    setSales(loadedSales);
  }

  useEffect(() => {
    refreshData()
      .catch(() => setError("Impossible de charger les données."))
      .finally(() => setLoaded(true));
  }, []);

  const cartDetails = useMemo(
    () =>
      cart.map((item) => ({
        ...item,
        product: products.find((product) => product.id === item.productId),
      })),
    [cart, products],
  );

  const total = cartDetails.reduce(
    (sum, item) =>
      sum + (item.product?.sellingPrice ?? 0) * item.quantity,
    0,
  );

  const estimatedProfit = cartDetails.reduce(
    (sum, item) =>
      sum +
      ((item.product?.sellingPrice ?? 0) -
        (item.product?.purchasePrice ?? 0)) *
        item.quantity,
    0,
  );

  function addToCart() {
    setError("");
    setSuccess("");

    const productId = Number(selectedProduct);
    const requestedQuantity = Number(quantity);
    const product = products.find((item) => item.id === productId);

    if (!product) {
      setError("Sélectionnez un produit.");
      return;
    }

    if (
      !Number.isInteger(requestedQuantity) ||
      requestedQuantity <= 0
    ) {
      setError("La quantité doit être un entier positif.");
      return;
    }

    const existing = cart.find((item) => item.productId === productId);
    const currentQuantity = existing?.quantity ?? 0;

    if (currentQuantity + requestedQuantity > product.quantity) {
      setError(`Stock insuffisant. Disponible : ${product.quantity}.`);
      return;
    }

    setCart((current) => {
      const found = current.find((item) => item.productId === productId);

      if (found) {
        return current.map((item) =>
          item.productId === productId
            ? { ...item, quantity: item.quantity + requestedQuantity }
            : item,
        );
      }

      return [...current, { productId, quantity: requestedQuantity }];
    });

    setQuantity("1");
    setSuccess(`${product.name} ajouté à la vente.`);
  }

  function updateQuantity(productId: number, value: string) {
    const nextQuantity = Number(value);
    const product = products.find((item) => item.id === productId);

    if (!product || !Number.isInteger(nextQuantity) || nextQuantity < 1) {
      return;
    }

    if (nextQuantity > product.quantity) {
      setError(`Stock insuffisant pour ${product.name}.`);
      return;
    }

    setError("");
    setCart((current) =>
      current.map((item) =>
        item.productId === productId
          ? { ...item, quantity: nextQuantity }
          : item,
      ),
    );
  }

  async function handleSale() {
    setError("");
    setSuccess("");

    if (cart.length === 0) {
      setError("Ajoutez des produits avant de valider.");
      return;
    }

    setSaving(true);

    try {
      await saveSale(cart, paymentMethod, products);
      await refreshData();
      setCart([]);
      setPaymentMethod("CASH");
      setSuccess("Vente enregistrée et stock mis à jour.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible d'enregistrer la vente.",
      );
      await refreshData().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <main className="min-h-screen bg-slate-50 p-5 text-slate-800">
        Chargement du module Ventes...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-800">
      <header className="rounded-2xl bg-[#173B70] p-6 text-white">
        <a href="/" className="text-sm text-blue-100">
          ← Accueil
        </a>
        <h1 className="mt-3 text-2xl font-extrabold">Module Ventes</h1>
        <p className="mt-2 text-sm text-blue-100">
          Enregistrez vos ventes et suivez vos recettes.
        </p>
      </header>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Nouvelle vente</h2>

        <div className="mt-4 grid gap-3">
          <label className="text-sm font-semibold">
            Produit
            <select
              value={selectedProduct}
              onChange={(event) => setSelectedProduct(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal"
            >
              <option value="">Choisir un produit</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} — Stock : {product.quantity}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold">
            Quantité
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 font-normal"
            />
          </label>

          <button
            type="button"
            onClick={addToCart}
            className="rounded-xl bg-[#173B70] p-3 font-bold text-white"
          >
            + Ajouter à la vente
          </button>
        </div>

        {products.length === 0 && (
          <p className="mt-3 text-sm text-amber-700">
            Aucun produit disponible. Ajoutez d'abord des produits dans le Stock.
          </p>
        )}

        {cartDetails.length > 0 && (
          <div className="mt-6">
            <h3 className="font-bold">Articles de la vente</h3>

            <div className="mt-3 space-y-3">
              {cartDetails.map((item) => (
                <div
                  key={item.productId}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{item.product?.name}</p>
                      <p className="text-xs text-slate-500">
                        {formatMoney(item.product?.sellingPrice ?? 0)} / unité
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCart((current) =>
                          current.filter(
                            (entry) => entry.productId !== item.productId,
                          ),
                        )
                      }
                      className="text-sm font-semibold text-red-600"
                    >
                      Retirer
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <label className="text-sm">
                      Quantité
                      <input
                        type="number"
                        min="1"
                        max={item.product?.quantity ?? 1}
                        value={item.quantity}
                        onChange={(event) =>
                          updateQuantity(item.productId, event.target.value)
                        }
                        className="ml-2 w-20 rounded-lg border border-slate-300 p-2"
                      />
                    </label>
                    <strong>
                      {formatMoney(
                        (item.product?.sellingPrice ?? 0) * item.quantity,
                      )}
                    </strong>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-2 rounded-xl bg-slate-50 p-4">
              <div className="flex justify-between text-sm">
                <span>Total à payer</span>
                <strong>{formatMoney(total)}</strong>
              </div>
              <div className="flex justify-between text-sm text-emerald-700">
                <span>Bénéfice estimé</span>
                <strong>{formatMoney(estimatedProfit)}</strong>
              </div>
            </div>

            <label className="mt-5 block text-sm font-semibold">
              Mode de paiement
              <select
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(event.target.value as PaymentMethod)
                }
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal"
              >
                <option value="CASH">Espèces</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
                <option value="CREDIT">Crédit client</option>
              </select>
            </label>

            <button
              type="button"
              onClick={handleSale}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-emerald-600 p-4 font-bold text-white disabled:opacity-50"
            >
              {saving ? "Enregistrement..." : "Valider la vente"}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {success && (
          <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
            {success}
          </p>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Historique des ventes</h2>

        {sales.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Aucune vente enregistrée pour le moment.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {sales.map((sale) => (
              <article
                key={sale.id}
                className="rounded-xl border border-slate-200 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">Vente #{sale.id}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(sale.date).toLocaleString("fr-FR")}
                    </p>
                  </div>
                  <strong>{formatMoney(sale.total)}</strong>
                </div>

                <ul className="mt-3 space-y-1 text-sm text-slate-600">
                  {sale.items.map((item) => (
                    <li key={item.productId}>
                      {item.productName} × {item.quantity}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => printReceipt(sale)}
                  className="mt-4 w-full rounded-xl border border-[#173B70] p-3 text-sm font-bold text-[#173B70]"
                >
                  Imprimer le reçu
                </button>

                <div className="mt-3 flex justify-between border-t border-slate-100 pt-2 text-xs">
                  <span>
                    Paiement :{" "}
                    {sale.paymentMethod === "CASH"
                      ? "Espèces"
                      : sale.paymentMethod === "MOBILE_MONEY"
                        ? "Mobile Money"
                        : "Crédit"}
                  </span>
                  <span className="font-semibold text-emerald-700">
                    Bénéfice estimé : {formatMoney(sale.estimatedProfit)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
