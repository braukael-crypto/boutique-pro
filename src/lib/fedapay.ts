import "server-only";

import { FedaPay, Transaction, Webhook, Currency } from "fedapay";

/**
 * Configuration serveur FedaPay.
 * Le mode Sandbox est imposé pour les premiers tests.
 */
export function getFedaPay() {
  const secretKey = process.env.FEDAPAY_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new Error("FEDAPAY_SECRET_KEY is not configured");
  }

  FedaPay.setApiKey(secretKey);
  FedaPay.setEnvironment("sandbox");
  FedaPay.setApiVersion("v1");

  return {
    Transaction,
    Webhook,
    Currency,
  };
}
