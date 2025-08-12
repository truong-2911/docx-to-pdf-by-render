import { embedQueryText } from "@/lib/ai/utils/embedding";
import { createClient as supabaseClient } from "@supabase/supabase-js";

const supabase = supabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Article = {
  title: string;
  aliases?: string[];
  zoho_id: string;
};

/**
 * Sync articles from Zoho to vector db
 * @param article - The article to sync
 * @returns True if successful, false otherwise
 */
export async function syncArticles(article: Article) {
  try {
    // Normalize the name and aliases
    const title = article.title.toLowerCase();
    const aliases = article.aliases?.map(alias => alias.toLowerCase());

    // Create the alias line
    const aliasLine = aliases?.length ? `Aliases: ${aliases.join(", ")}` : null;

    // Create the input text
    const inputText = [`Title: ${title}`, aliasLine].filter(Boolean).join("\n");

    const embedding = await embedQueryText(inputText);

    await supabase.from("articles").upsert(
      {
        title: title,
        aliases: aliases,
        embedding_input: inputText,
        embedding: embedding,
        zoho_id: article.zoho_id,
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

/**
 * Find similar articles by title, alias, or embedding
 * @param query - The query to search for
 * @param queryEmbedding - The embedding of the query
 * @returns The similar articles with source and data
 */
export async function findSimilarArticles(
  query: string,
  queryEmbedding: number[]
) {
  // Name match
  const { data: nameMatch, error: nameMatchError } = await supabase
    .from("articles")
    .select("*")
    .ilike("title", `%${query}%`)
    .limit(1);
  if (nameMatchError) throw nameMatchError;

  if (nameMatch.length > 0) return { source: "name", data: nameMatch };

  // Alias match
  const { data: aliasMatch, error: aliasMatchError } = await supabase
    .from("articles")
    .select("*")
    .contains("aliases", [query])
    .limit(1);
  if (aliasMatchError) throw aliasMatchError;

  if (aliasMatch.length > 0) return { source: "alias", data: aliasMatch };

  // Similarity search
  const { data, error } = await supabase.rpc("get_article_by_title", {
    query: query,
    query_embedding: queryEmbedding,
    match_threshold: 0.6,
    match_count: 1,
  });
  if (error) throw error;
  if (data.length > 0) return { source: "embedding", data };
  return null;
}
