import { registerHooks } from "node:module";

export function bindHostRecordViews() {
  // Each test file has its own Node process. Bind only the native record-view
  // capabilities for this host; production retains its compiler-bound intrinsics.
  return registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (
        !/\/js-runtime\/(src|dist)\/(objects\/(values|symbols|bigints|intl-format-views)|modules\/referrer)\.(ts|js)$/.test(
          url,
        )
      )
        return loaded;
      const source = String(loaded.source)
        .replace(
          'throw "UNBOUND_MODULE_RECORD_VIEW";',
          'return typeof value === "object" && value !== null && value.kind === "module" && "shape" in value ? value : undefined;',
        )
        .replace(
          'throw "UNBOUND_SCRIPT_RECORD_VIEW";',
          'return typeof value === "object" && value !== null && value.kind === "script" && "loadedRequests" in value ? value : undefined;',
        )
        .replace(
          'throw "UNBOUND_OBJECT_VIEW";',
          'return typeof value === "object" && value !== null && "internalCall" in value ? value : undefined;',
        )
        .replace(
          'throw "UNBOUND_TYPEOF_OBJECT_VIEW";',
          'return typeof value === "object" && value !== null && "internalCall" in value ? value : undefined;',
        )
        .replace(
          'throw "UNBOUND_WEAK_REGISTRY_VIEW";',
          'return typeof value === "object" && value !== null && "internalCall" in value ? value : undefined;',
        )
        .replace(
          'throw "UNBOUND_SYMBOL_VIEW";',
          'return typeof value === "object" && value !== null && value.symbolBrand === "symbol" ? value : undefined;',
        )
        .replace(
          'throw "UNBOUND_DATE_TIME_FORMATTER_VIEW";',
          'return typeof value === "object" && value !== null && "configuration" in value && "temporalPatterns" in value ? value : undefined;',
        )
        .replace(
          'throw "UNBOUND_DISPLAY_NAMES_VIEW";',
          'return typeof value === "object" && value !== null && "languageDisplay" in value && "fallback" in value && "table" in value ? value : undefined;',
        )
        .replace(
          'throw "UNBOUND_DURATION_FORMATTER_VIEW";',
          'return typeof value === "object" && value !== null && "digital" in value && "list" in value && "options" in value ? value : undefined;',
        )
        .replace(
          'throw "UNBOUND_BIGINT_VIEW";',
          'return typeof value === "object" && value !== null && value.bigintBrand === "bigint" ? value : undefined;',
        );
      return { ...loaded, source };
    },
  });
}
