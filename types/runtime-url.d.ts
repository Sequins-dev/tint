type TintWebURL = URL;
type TintWebURLConstructor = typeof URL;
type TintWebURLSearchParams = URLSearchParams;
type TintWebURLSearchParamsConstructor = typeof URLSearchParams;

declare module "node:url" {
  export const URL: TintWebURLConstructor;
  export type URL = TintWebURL;
  export const URLSearchParams: TintWebURLSearchParamsConstructor;
  export type URLSearchParams = TintWebURLSearchParams;

  export interface FileURLOptions {
    windows?: boolean;
  }
  export interface URLFormatOptions {
    auth?: boolean;
    fragment?: boolean;
    search?: boolean;
    unicode?: boolean;
  }
  export interface LegacyURLFormat {
    protocol?: string;
    slashes?: boolean;
    auth?: string;
    host?: string;
    hostname?: string;
    port?: string | number;
    pathname?: string;
    search?: string;
    hash?: string;
    query?: Record<string, unknown>;
  }
  export interface HttpOptions {
    protocol: string;
    hostname: string;
    hash: string;
    search: string;
    pathname: string;
    path: string;
    href: string;
    auth?: string;
    port?: number;
  }
  export function fileURLToPath(
    input: string | URL,
    options?: FileURLOptions,
  ): string;
  export function pathToFileURL(input: string, options?: FileURLOptions): URL;
  export function urlToHttpOptions(input: URL): HttpOptions;
  export function domainToASCII(domain: string): string;
  export function domainToUnicode(domain: string): string;
  export function format(
    input: URL | string | LegacyURLFormat,
    options?: URLFormatOptions,
  ): string;
  const url: {
    URL: typeof URL;
    URLSearchParams: typeof URLSearchParams;
    fileURLToPath: typeof fileURLToPath;
    pathToFileURL: typeof pathToFileURL;
    urlToHttpOptions: typeof urlToHttpOptions;
    domainToASCII: typeof domainToASCII;
    domainToUnicode: typeof domainToUnicode;
    format: typeof format;
  };
  export default url;
}
