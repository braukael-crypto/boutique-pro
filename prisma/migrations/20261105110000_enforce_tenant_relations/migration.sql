-- Enforce tenant consistency for every optional product/customer reference.
-- Composite foreign keys prevent a row in one shop from referencing another
-- shop's product or customer, even if the UUID is known.

ALTER TABLE public.sales
  ADD CONSTRAINT sales_shopId_customerId_fkey
  FOREIGN KEY ("shopId", "customerId")
  REFERENCES public.customers ("shopId", id)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_shopId_productId_fkey
  FOREIGN KEY ("shopId", "productId")
  REFERENCES public.products ("shopId", id)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_shopId_productId_fkey
  FOREIGN KEY ("shopId", "productId")
  REFERENCES public.products ("shopId", id)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE public.credit_payments
  ADD CONSTRAINT credit_payments_shopId_customerId_fkey
  FOREIGN KEY ("shopId", "customerId")
  REFERENCES public.customers ("shopId", id)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- Reject impossible financial and inventory values at the database boundary.
ALTER TABLE public.products
  ADD CONSTRAINT products_nonnegative_prices_check
  CHECK ("purchasePrice" >= 0 AND "sellingPrice" >= 0),
  ADD CONSTRAINT products_nonnegative_stock_check
  CHECK (quantity >= 0 AND "minStock" >= 0);

ALTER TABLE public.sales
  ADD CONSTRAINT sales_nonnegative_amounts_check
  CHECK (total >= 0 AND "estimatedProfit" >= 0);

ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_positive_quantity_check
  CHECK (quantity > 0),
  ADD CONSTRAINT sale_items_nonnegative_amounts_check
  CHECK (
    "purchasePrice" >= 0
    AND "sellingPrice" >= 0
    AND subtotal >= 0
    AND "estimatedProfit" >= 0
  );

ALTER TABLE public.credit_payments
  ADD CONSTRAINT credit_payments_positive_amount_check
  CHECK (amount > 0);

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_positive_amount_check
  CHECK (amount > 0);

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_positive_quantity_check
  CHECK (quantity > 0);
