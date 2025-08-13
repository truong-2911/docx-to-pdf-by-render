// lib/convert-api/docx-to-pdf/html-helper.ts
export function replaceHtmlTags(obj: any) {
  const hasHtml = (s: string) => /<[^>]*>/.test(s);
  const htmlToText = (s: string) => s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "");

  const walk = (o: any) => {
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) {
        const v = o[i];
        if (typeof v === "string") { if (hasHtml(v)) o[i] = htmlToText(v); }
        else if (v && typeof v === "object") walk(v);
      }
    } else if (o && typeof o === "object") {
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === "string") { if (hasHtml(v)) o[k] = htmlToText(v); }
        else if (v && typeof v === "object") walk(v);
      }
    }
  };

  walk(obj);
  return obj;
}
