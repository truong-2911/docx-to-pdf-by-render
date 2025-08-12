import { embedQueryText } from "@/lib/ai/utils/embedding";
import { createClient as supabaseClient } from "@supabase/supabase-js";

const supabase = supabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Document = {
  title: string;
  category: string;
  aliases: string[];
  zoho_id: string;
  status: string;
};

type DocumentSearchResult = {
  source: string;
  data: any[];
};

export async function syncDocuments(document: Document) {
  console.log("Syncing document", document.title);
  try {
    // Normalize the name and aliases
    const title = document.title.toLowerCase();
    const aliases = document.aliases.map(alias => alias.toLowerCase());

    // Create the alias line
    const aliasLine = aliases?.length ? `Aliases: ${aliases.join(", ")}` : null;

    // Create the input text
    const inputText = [
      `Document: ${title}`,
      `Category: ${document.category}`,
      aliasLine,
    ]
      .filter(Boolean)
      .join("\n");

    const embedding = await embedQueryText(inputText);

    await supabase.from("documents").upsert(
      {
        title: title,
        aliases: aliases,
        embedding_input: inputText,
        embedding: embedding,
        status: document.status,
        zoho_id: document.zoho_id,
      },
      {
        onConflict: "zoho_id",
      }
    );

    return true;
  } catch (error) {
    console.error("🔍 Error:", error);
    throw error;
  }
}

export async function findSimilarDocuments(
  query: string,
  queryEmbedding: number[],
  status: string
): Promise<DocumentSearchResult> {
  // title match
  const { data: titleData, error: titleError } = await supabase
    .from("documents")
    .select("*")
    .ilike("title", `%${query}%`)
    .eq("status", status)
    .limit(1);
  if (titleError) throw titleError;

  if (titleData.length > 0) {
    return { source: "title", data: titleData };
  }

  // alias match
  const { data: aliasData, error: aliasError } = await supabase
    .from("documents")
    .select("*")
    .contains("aliases", [query])
    .eq("status", status)
    .limit(1);
  if (aliasError) throw aliasError;

  if (aliasData.length > 0) {
    return { source: "alias", data: aliasData };
  }

  // similarity search
  const { data, error } = await supabase.rpc("get_document_by_status", {
    status_input: status,
    query: query,
    query_embedding: queryEmbedding,
    match_threshold: 0.5,
    match_count: 1,
  });

  if (error) throw error;

  console.log("🔍 Similar documents:", data);

  return { source: "embedding", data: data };
}
