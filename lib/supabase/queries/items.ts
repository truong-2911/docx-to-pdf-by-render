import { embedQueryText } from "@/lib/ai/utils/embedding";
import { createClient as supabaseClient } from "@supabase/supabase-js";

const supabase = supabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Item = {
  name: string;
  category: string;
  is_purchase: boolean;
  is_sales: boolean;
  purchase_description: string;
  sales_description: string;
  aliases: string[];
  status: string;
  zoho_id: string;
};

export async function syncItems(item: Item) {
  console.log("Syncing item: ", JSON.stringify(item));
  try {
    // Normalize the name and aliases
    const name = item.name.toLowerCase();
    const category = item.category.toLowerCase();
    const purchaseDescription = item.purchase_description.toLowerCase();
    const salesDescription = item.sales_description.toLowerCase();
    const status = item.status.toLowerCase();
    const aliases = item.aliases.map(alias => alias.toLowerCase());

    const aliasLine = aliases.length ? `Aliases: ${aliases.join(", ")}` : null;

    // Create the input text
    // Use both purchase and sales description for experiment
    const inputText = [
      `Item: ${name}`,
      `Category: ${category}`,
      `Purchase Description: ${purchaseDescription}`,
      `Sales Description: ${salesDescription}`,
      aliasLine,
    ]
      .filter(Boolean)
      .join("\n");

    const embedding = await embedQueryText(inputText);

    const { data, error } = await supabase.from("items").upsert(
      {
        name: item.name,
        is_purchase: item.is_purchase,
        is_sales: item.is_sales,
        status: status,
        embedding_input: inputText,
        embedding: embedding,
        aliases: aliases,
        zoho_id: item.zoho_id,
      },
      {
        onConflict: "zoho_id",
      }
    );
    if (error) {
      console.error("🔍 Error:", error);
      throw error;
    }
    console.log("🔍 Item synced: ", JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("🔍 Error:", error);
    throw error;
  }
}

export async function findSimilarItem(
  query: string,
  queryEmbedding: number[],
  status: string,
  purchase_or_sales: "purchase" | "sales"
) {
  // Name match
  let query_builder_name = supabase
    .from("items")
    .select("*")
    .ilike("name", `%${query}%`)
    .eq("status", status)
    .limit(1);

  if (purchase_or_sales === "purchase") {
    query_builder_name = query_builder_name.eq("is_purchase", true);
  } else if (purchase_or_sales === "sales") {
    query_builder_name = query_builder_name.eq("is_sales", true);
  }

  const { data: nameMatch, error: nameMatchError } = await query_builder_name;
  if (nameMatchError) throw nameMatchError;

  if (nameMatch.length > 0) return { source: "name", data: nameMatch };

  // Alias match
  let query_builder_alias = supabase
    .from("items")
    .select("*")
    .contains("aliases", [query])
    .eq("status", status)
    .limit(1);

  if (purchase_or_sales === "purchase") {
    query_builder_alias = query_builder_alias.eq("is_purchase", true);
  } else if (purchase_or_sales === "sales") {
    query_builder_alias = query_builder_alias.eq("is_sales", true);
  }
  const { data: aliasMatch, error: aliasMatchError } =
    await query_builder_alias;
  if (aliasMatchError) throw aliasMatchError;

  if (aliasMatch.length > 0) return { source: "alias", data: aliasMatch };

  // Similarity search
  const { data, error } = await supabase.rpc("get_item", {
    status: status,
    purchase_or_sales: purchase_or_sales,
    query: query,
    query_embedding: queryEmbedding,
    match_threshold: 0.6,
    match_count: 1,
  });
  if (error) throw error;
  if (data.length > 0) return { source: "embedding", data };
  return null;
}
