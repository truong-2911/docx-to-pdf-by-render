export function toPdfKey(rawName?: string, fallback?: string) {
    const base0 = (rawName || fallback || "output").replace(/\.[^.]+$/i, ""); // bỏ .docx/.pdf ở cuối nếu có
    // slug an toàn: bỏ dấu, chỉ giữ a-z A-Z 0-9 . _ -
    const safe = base0
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-_.]+|[-_.]+$/g, "")
      .slice(0, 120) || "file";
    const prefix = process.env.BLOB_PREFIX || "pdf/";
    return `${prefix}${safe}.pdf`;
  }
  