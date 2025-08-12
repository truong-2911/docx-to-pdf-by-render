import { convert } from "html-to-text";

export const isStringHasHtml = (s: string) => /<[^>]*>/.test(s);

export const convertHtmlToString = (htmlString: string) =>
  convert(htmlString, { wordwrap: 500 });

export const replaceHtmlTags = (obj: any) => {
  const walk = (o: any) => {
    if (Array.isArray(o)) {
      o.forEach((v, i) => {
        if (typeof v === "string" && isStringHasHtml(v)) o[i] = convertHtmlToString(v);
        else if (v && typeof v === "object") walk(v);
      });
    } else if (o && typeof o === "object") {
      Object.keys(o).forEach((k) => {
        const v = o[k];
        if (typeof v === "string" && isStringHasHtml(v)) o[k] = convertHtmlToString(v);
        else if (v && typeof v === "object") walk(v);
      });
    }
  };
  walk(obj);
  return obj;
};
