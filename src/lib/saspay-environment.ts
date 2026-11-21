export type SasPayRuntimeEnvironment = "production" | "preview" | "development" | "unknown";

export type SasPayKeyMode = "test" | "live" | "invalid";

export type SasPayEnvironmentVariables = Readonly<Record<string, string | undefined>>;

export type SasPayConfigurationErrorCode =
  | "SASPAY_CONFIG_UNKNOWN_ENVIRONMENT"
  | "SASPAY_CONFIG_MISSING_KEY"
  | "SASPAY_CONFIG_INVALID_KEY"
  | "SASPAY_CONFIG_MODE_MISMATCH";

export class SasPayConfigurationError extends Error {
  readonly code: SasPayConfigurationErrorCode;
  readonly environment: SasPayRuntimeEnvironment;
  readonly expectedKeyMode: SasPayKeyMode | null;

  constructor(
    code: SasPayConfigurationErrorCode,
    message: string,
    environment: SasPayRuntimeEnvironment,
    expectedKeyMode: SasPayKeyMode | null,
  ) {
    super(message);
    this.name = "SasPayConfigurationError";
    this.code = code;
    this.environment = environment;
    this.expectedKeyMode = expectedKeyMode;
  }
}

export type SasPayConfiguration = {
  environment: SasPayRuntimeEnvironment;
  keyMode: Exclude<SasPayKeyMode, "invalid">;
  secretKey: string;
};

function readVariable(env: SasPayEnvironmentVariables, name: string): string | null {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveSasPayRuntimeEnvironment(
  env: SasPayEnvironmentVariables = process.env,
): SasPayRuntimeEnvironment {
  const vercelEnv = readVariable(env, "VERCEL_ENV");
  if (vercelEnv !== null) {
    if (vercelEnv === "production" || vercelEnv === "preview" || vercelEnv === "development") {
      return vercelEnv;
    }
    return "unknown";
  }

  const nodeEnv = readVariable(env, "NODE_ENV");
  if (nodeEnv === "production" || nodeEnv === "development") return nodeEnv;
  if (nodeEnv === "test") return "development";
  return "unknown";
}

export function getSasPayKeyMode(secretKey: string | null | undefined): SasPayKeyMode {
  if (typeof secretKey !== "string") return "invalid";
  const trimmed = secretKey.trim();
  if (trimmed.startsWith("sk_test_") && trimmed.length > "sk_test_".length) return "test";
  if (trimmed.startsWith("sk_live_") && trimmed.length > "sk_live_".length) return "live";
  return "invalid";
}

const EXPECTED_KEY_MODE: Record<SasPayRuntimeEnvironment, SasPayKeyMode> = {
  production: "live",
  preview: "test",
  development: "test",
  unknown: "invalid",
};

export function assertSasPayConfiguration(
  env: SasPayEnvironmentVariables = process.env,
): SasPayConfiguration {
  const environment = resolveSasPayRuntimeEnvironment(env);

  if (environment === "unknown") {
    throw new SasPayConfigurationError(
      "SASPAY_CONFIG_UNKNOWN_ENVIRONMENT",
      "SasPay payment API calls are disabled because the runtime environment is unknown.",
      environment,
      null,
    );
  }

  const expectedKeyMode = EXPECTED_KEY_MODE[environment];
  const secretKey = readVariable(env, "SASPAY_SECRET_KEY");

  if (secretKey === null) {
    throw new SasPayConfigurationError(
      "SASPAY_CONFIG_MISSING_KEY",
      "SASPAY_SECRET_KEY is not configured for the current environment.",
      environment,
      expectedKeyMode,
    );
  }

  const keyMode = getSasPayKeyMode(secretKey);
  if (keyMode === "invalid") {
    throw new SasPayConfigurationError(
      "SASPAY_CONFIG_INVALID_KEY",
      "SASPAY_SECRET_KEY is not a valid SasPay secret key.",
      environment,
      expectedKeyMode,
    );
  }

  if (keyMode !== expectedKeyMode) {
    throw new SasPayConfigurationError(
      "SASPAY_CONFIG_MODE_MISMATCH",
      `SasPay ${expectedKeyMode} credentials are required in the ${environment} environment.`,
      environment,
      expectedKeyMode,
    );
  }

  return { environment, keyMode, secretKey };
}
