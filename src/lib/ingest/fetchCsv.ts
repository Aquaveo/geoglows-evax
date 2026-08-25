/**
 * Fetch CSV text from a URL, with errors that name the likely cause.
 *
 * This is a browser-only app, so a cross-origin fetch succeeds only when the
 * host sets `Access-Control-Allow-Origin`. There is no way around that from
 * JavaScript — no proxy, no header the page can send. Worse, the browser
 * deliberately hides the reason: a blocked request surfaces as a bare TypeError
 * with no status and no detail, indistinguishable from the host being down.
 *
 * So the failure path guesses, and says it is guessing. Silence here would leave
 * the user re-checking a URL that is perfectly correct.
 */
export interface FetchedCsv {
  text: string;
  /** Bytes received, for the status line. */
  bytes: number;
  contentType: string | null;
}

const MAX_BYTES = 64 * 1024 * 1024;

/**
 * A URL safe to put in a message.
 *
 * A presigned S3 URL carries `X-Amz-Signature` and friends in the query string.
 * Those are short-lived credentials, and echoing them into an error string puts
 * them somewhere they may be screenshotted or pasted into an issue. Only the
 * host and path are ever shown.
 */
function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname}`;
  } catch {
    return raw.split('?')[0].slice(0, 120);
  }
}

export async function fetchCsvText(rawUrl: string): Promise<FetchedCsv> {
  const url = rawUrl.trim();
  if (!url) throw new Error('Enter a URL.');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${safeUrl(url)}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    // s3:// is the form people paste from the AWS console, and it is not
    // something a browser can open — but it maps mechanically to an https URL.
    if (parsed.protocol === 's3:') {
      const bucket = parsed.hostname;
      const key = parsed.pathname.replace(/^\//, '');
      throw new Error(
        `A browser cannot open an s3:// address. Use the HTTPS form instead: ` +
          `https://${bucket}.s3.amazonaws.com/${key}`,
      );
    }
    throw new Error(`Only http(s) URLs can be fetched, not ${parsed.protocol}`);
  }

  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    throw new Error(
      `Could not reach ${parsed.host}. The most likely cause is that the host does not allow ` +
        `browser requests from other sites — it must send an Access-Control-Allow-Origin header, ` +
        `and most S3 buckets do not unless the owner has configured CORS. Note that a presigned ` +
        `URL does not help here: signing satisfies S3's authorization, but CORS is enforced ` +
        `separately by the browser, so a private bucket needs BOTH. The browser hides the real ` +
        `reason, so this cannot be confirmed from here — download the file and upload it instead, ` +
        `or ask the bucket owner to add a CORS rule. ` +
        `(underlying error: ${e instanceof Error ? e.message : String(e)})`,
      // Keep the original: the message above is a guess, and the real one is
      // the only evidence for what actually happened.
      { cause: e },
    );
  }

  if (!res.ok) {
    throw new Error(
      `${parsed.host} returned HTTP ${res.status} ${res.statusText}. ` +
        (res.status === 403
          ? 'For a private object, generate a presigned URL and paste that — a presigned URL ' +
            'carries its own signature, so no credentials are needed here. If you already used ' +
            'one, it may have expired.'
          : res.status === 404
            ? 'Check the bucket name and object key.'
            : ''),
    );
  }

  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > MAX_BYTES) {
    throw new Error(
      `That file is ${(len / 1024 / 1024).toFixed(0)} MB, over the ${MAX_BYTES / 1024 / 1024} MB ` +
        `limit for an in-browser fetch.`,
    );
  }

  const text = await res.text();
  if (text.length > MAX_BYTES) {
    throw new Error(`That file is too large to parse in the browser (${text.length} bytes).`);
  }
  // A wrong URL often returns an HTML error page with HTTP 200; parsing that
  // yields a baffling column error instead of a useful one.
  const head = text.slice(0, 400).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml')) {
    throw new Error(
      `${parsed.host} returned ${head.startsWith('<?xml') ? 'XML' : 'HTML'}, not CSV. ` +
        `That is usually a bucket listing or an error page rather than the object itself — ` +
        `check the object key.`,
    );
  }

  return { text, bytes: text.length, contentType: res.headers.get('content-type') };
}
