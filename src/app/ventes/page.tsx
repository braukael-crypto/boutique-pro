"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  openDatabase,
  STORE_NAME,
  MOVEMENT_STORE,
  SALES_STORE,
  CUSTOMER_STORE,
  SETTINGS_STORE,
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
  customerId?: number;
  customerName?: string;
};

type StoreProfile = { id: "profile"; name: string; phone: string; whatsapp: string; address: string; logo?: string };
type PaymentMethod = Sale["paymentMethod"];
type Customer = { id: number; name: string; phone: string; address: string; createdAt: string };

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
  customer: Customer | undefined,
  saleId: number,
  date: string,
): Promise<void> {
  if (cart.length === 0) {
    throw new Error("Ajoutez au moins un produit à la vente.");
  }
  if (paymentMethod === "CREDIT" && !customer) {
    throw new Error("Sélectionnez un client pour une vente à crédit.");
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

    // The same identifier is sent to Supabase and kept in IndexedDB for idempotent retries.
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
            ...(paymentMethod === "CREDIT" && customer
              ? { customerId: customer.id, customerName: customer.name }
              : {}),
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

type ReceiptFormat = "thermal" | "a4";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

async function printReceipt(sale: Sale, format: ReceiptFormat) {
  const db = await openDatabase();
  const profile = await new Promise<StoreProfile | undefined>((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE, "readonly");
    const request = transaction.objectStore(SETTINGS_STORE).get("profile");
    request.onsuccess = () => resolve(request.result as StoreProfile | undefined);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
  const storeName = escapeHtml(profile?.name?.trim() || "BoutiquePro");
  const storePhone = escapeHtml(profile?.phone?.trim() || "");
  const storeWhatsapp = escapeHtml(profile?.whatsapp?.trim() || "");
  const storeAddress = escapeHtml(profile?.address?.trim() || "");
  const logoMarkup = profile?.logo ? `<img src="${profile.logo}" alt="Logo" style="display:block;max-width:100px;max-height:70px;object-fit:contain;margin:0 auto 8px;">` : "";
  const paymentLabel =
    sale.paymentMethod === "CASH"
      ? "Espèces"
      : sale.paymentMethod === "MOBILE_MONEY"
        ? "Mobile Money"
        : "Crédit";

  const rows = sale.items.map((item) => `
    <tr>
      <td>${escapeHtml(item.productName)} × ${item.quantity}</td>
      <td>${item.subtotal.toLocaleString("fr-FR")} FCFA</td>
    </tr>
  `).join("");

  const isThermal = format === "thermal";
  const pageSize = isThermal ? "80mm auto" : "A4";
  const pageMargin = isThermal ? "3mm" : "12mm";
  const receiptWidth = isThermal ? "74mm" : "100%";
  const receiptMaxWidth = isThermal ? "74mm" : "700px";

  const receipt = `
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Reçu BoutiquePro - ${sale.id}</title>
        <style>
          @page {
            size: ${pageSize};
            margin: ${pageMargin};
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 16px;
            color: #222;
            font-family: Arial, sans-serif;
            font-size: ${isThermal ? "12px" : "14px"};
          }
          .receipt {
            width: ${receiptWidth};
            max-width: ${receiptMaxWidth};
            margin: 0 auto;
          }
          h1, .center { text-align: center; }
          h1 {
            margin: 0 0 6px;
            color: #173B70;
            font-size: ${isThermal ? "20px" : "26px"};
          }
          .subtitle {
            margin: 0 0 18px;
            text-align: center;
            font-weight: bold;
            letter-spacing: 1px;
          }
          .meta p { margin: 5px 0; overflow-wrap: anywhere; }
          table {
            width: 100%;
            margin-top: 16px;
            border-collapse: collapse;
          }
          td {
            padding: 8px 2px;
            border-bottom: 1px dashed #bbb;
            vertical-align: top;
            overflow-wrap: anywhere;
          }
          td:last-child {
            text-align: right;
            white-space: nowrap;
            padding-left: 6px;
          }
          .total {
            margin-top: 16px;
            padding-top: 10px;
            border-top: 1px solid #222;
            font-size: ${isThermal ? "16px" : "20px"};
            font-weight: bold;
            text-align: right;
          }
          .payment { margin-top: 12px; }
          .footer {
            margin-top: 24px;
            text-align: center;
            font-size: 11px;
          }
          @media screen {
            body { background: #f1f5f9; }
            .receipt {
              padding: ${isThermal ? "10px" : "28px"};
              background: white;
            }
          }
          @media print {
            body { padding: 0; }
            .receipt { margin: 0 auto; }
          }
        </style>
      </head>
      <body>
        <main class="receipt">
          ${logoMarkup}<h1>${storeName}</h1>
          <p class="subtitle">REÇU DE VENTE</p>
          ${storeAddress ? `<p class="center">${storeAddress}</p>` : ""}
          ${storePhone ? `<p class="center">Tél. : ${storePhone}</p>` : ""}
          ${storeWhatsapp ? `<p class="center">WhatsApp : ${storeWhatsapp}</p>` : ""}
          <section class="meta">
            <p><strong>Reçu N° :</strong> ${sale.id}</p>
            <p><strong>Date :</strong> ${new Date(sale.date).toLocaleString("fr-FR")}</p>
          </section>
          <table>
            <tbody>${rows}</tbody>
          </table>
          <p class="total">TOTAL : ${sale.total.toLocaleString("fr-FR")} FCFA</p>
          <p class="payment"><strong>Mode de paiement :</strong> ${paymentLabel}</p>
          <p class="footer">Merci pour votre confiance !</p>
        </main>
      </body>
    </html>
  `;

  const printWindow = window.open("", "_blank", "width=500,height=700");

  if (!printWindow) {
    alert("Autorisez les fenêtres contextuelles pour imprimer le reçu.");
    return;
  }

  printWindow.document.open();
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("CASH");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingSaleId, setPendingSaleId] = useState<number | null>(null);

  async function refreshData(): Promise<[Product[], Sale[]]> {
    const [loadedProducts, localSales] = await Promise.all([getProducts(), getSales()]);
    try {
      const response = await fetch("/api/sales", { cache: "no-store" });
      if (!response.ok) return [loadedProducts, localSales];
      const result = await response.json() as { sales?: Sale[] };
      const remoteSales = Array.isArray(result.sales) ? result.sales : [];
      const merged = new Map<number, Sale>();
      for (const sale of localSales) merged.set(sale.id, sale);
      // Supabase is authoritative when the same sale exists in both places.
      for (const sale of remoteSales) merged.set(sale.id, sale);
      return [
        loadedProducts,
        [...merged.values()].sort((a, b) => b.date.localeCompare(a.date)),
      ];
    } catch {
      // Preserve access to this device's history if the network is unavailable.
      return [loadedProducts, localSales];
    }
  }

  useEffect(() => {
    let active = true;
    const db = openDatabase();

    Promise.all([
      refreshData(),
      db.then((database) => new Promise<Customer[]>((resolve, reject) => {
        const transaction = database.transaction(CUSTOMER_STORE, "readonly");
        const request = transaction.objectStore(CUSTOMER_STORE).getAll();
        request.onsuccess = () => resolve(request.result as Customer[]);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      })),
    ])
      .then(([[loadedProducts, loadedSales], loadedCustomers]) => {
        if (!active) return;
        setProducts(loadedProducts);
        setSales(loadedSales);
        setCustomers(loadedCustomers.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (active) setError("Impossible de charger les données.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
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
      const customer = customers.find((item) => item.id === Number(selectedCustomer));
      if (paymentMethod === "CREDIT" && !customer) {
        throw new Error("Sélectionnez un client pour une vente à crédit.");
      }

      // Supabase is the source of truth: it validates stock and atomically
      // creates the sale, sale lines and OUT movements before the local cache changes.
      const saleId = pendingSaleId ?? Date.now();
      if (pendingSaleId === null) setPendingSaleId(saleId);
      const date = new Date().toISOString();
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          legacyId: saleId,
          date,
          paymentMethod,
          customerLegacyId: customer?.id ?? null,
          customerName: customer?.name ?? "",
          items: cart.map((item) => ({
            productLegacyId: item.productId,
            quantity: item.quantity,
          })),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "La vente n'a pas été enregistrée dans Supabase.");
      }

      // This updates only this device's IndexedDB copy. The remote stock
      // decrement and remote OUT movements were already performed by the SQL function.
      await saveSale(cart, paymentMethod, customer, saleId, date);
      setPendingSaleId(null);
      const [loadedProducts, loadedSales] = await refreshData();
      setProducts(loadedProducts);
      setSales(loadedSales);
      setCart([]);
      setPaymentMethod("CASH");
      setSelectedCustomer("");
      setSuccess("Vente enregistrée dans Supabase et copiée sur cet appareil.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer la vente. Vérifiez la connexion avant de réessayer.",
      );
      const refreshed = await refreshData().catch(() => null);
      if (refreshed) {
        setProducts(refreshed[0]);
        setSales(refreshed[1]);
      }
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
        <Link href="/" className="text-sm text-blue-100">
          ← Accueil
        </Link>
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
            Aucun produit disponible. Ajoutez d&apos;abord des produits dans le Stock.
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

            {paymentMethod === "CREDIT" && (
              <label className="mt-4 block text-sm font-semibold">
                Client concerné par le crédit
                <select
                  required
                  value={selectedCustomer}
                  onChange={(event) => setSelectedCustomer(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal"
                >
                  <option value="">Choisir un client</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} — {customer.phone}
                    </option>
                  ))}
                </select>
                {customers.length === 0 && (
                  <span className="mt-2 block text-xs font-normal text-amber-700">
                    Enregistrez d&apos;abord un client dans le module Clients et crédits.
                  </span>
                )}
              </label>
            )}

            <button
              type="button"
              onClick={handleSale}
              disabled={saving || (paymentMethod === "CREDIT" && !selectedCustomer)}
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

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => printReceipt(sale, "thermal")}
                    className="rounded-xl border border-[#173B70] p-3 text-sm font-bold text-[#173B70]"
                  >
                    Reçu 80 mm
                  </button>
                  <button
                    type="button"
                    onClick={() => printReceipt(sale, "a4")}
                    className="rounded-xl bg-[#173B70] p-3 text-sm font-bold text-white"
                  >
                    Reçu A4
                  </button>
                </div>

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
