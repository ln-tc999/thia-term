/**
 * Initialize OpenTelemetry distributed tracing and metrics.
 * Only activates when OTEL_EXPORTER_OTLP_ENDPOINT is set — returns undefined otherwise.
 */
// @ts-nocheck — OTel packages use CJS exports incompatible with verbatimModuleSyntax
export async function initTelemetry(): Promise<{ shutdown(): Promise<void> } | undefined> {
  const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  if (!endpoint) return undefined;

  try {
    const sdkNode = await import("@opentelemetry/sdk-node");
    const traceExporter = await import("@opentelemetry/exporter-trace-otlp-http");
    const metricExporter = await import("@opentelemetry/exporter-metrics-otlp-http");
    const autoInstrumentations = await import("@opentelemetry/auto-instrumentations-node");
    const resources = await import("@opentelemetry/resources");
    const semconv = await import("@opentelemetry/semantic-conventions");
    const sdkMetrics = await import("@opentelemetry/sdk-metrics");

    const ResourceClass = resources.Resource ?? (resources as any).default?.Resource;
    const resource = new ResourceClass({
      [semconv.ATTR_SERVICE_NAME]: "prooflink-api",
      [semconv.ATTR_SERVICE_VERSION]: process.env["npm_package_version"] ?? "0.1.0",
    });

    const sdk = new sdkNode.NodeSDK({
      resource,
      traceExporter: new traceExporter.OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      metricReader: new sdkMetrics.PeriodicExportingMetricReader({
        exporter: new metricExporter.OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 30_000,
      }),
      instrumentations: [
        autoInstrumentations.getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
          "@opentelemetry/instrumentation-http": { enabled: true },
          "@opentelemetry/instrumentation-pg": { enabled: true },
        }),
      ],
    });

    sdk.start();
    return sdk;
  } catch (err) {
    console.warn("[telemetry] Failed to initialize OpenTelemetry:", err);
    return undefined;
  }
}
