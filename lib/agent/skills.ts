import { escapeRegExp } from "./text";

export interface SkillDef {
  name: string;
  category: string;
  aliases?: string[];
  caseSensitive?: boolean;
}

/**
 * Canonical skill taxonomy. Used for tagging facts, parsing job descriptions and
 * checking that CV text only names skills that are verified. Matching is by
 * canonical name or alias; adding a skill here never adds it to a CV.
 */
export const SKILLS: SkillDef[] = [
  // Languages
  { name: "Python", category: "Languages" },
  { name: "TypeScript", category: "Languages" },
  { name: "JavaScript", category: "Languages", aliases: ["ecmascript"] },
  { name: "PHP", category: "Languages", caseSensitive: true },
  { name: "SQL", category: "Languages", caseSensitive: true },
  { name: "Java", category: "Languages", caseSensitive: true },
  { name: "C#", category: "Languages", caseSensitive: true },
  { name: "C++", category: "Languages", caseSensitive: true },
  { name: "Go", category: "Languages", aliases: ["Golang"], caseSensitive: true },
  { name: "Rust", category: "Languages", caseSensitive: true },
  { name: "Scala", category: "Languages", caseSensitive: true },
  { name: "Kotlin", category: "Languages" },
  { name: "SuiteScript", category: "Languages" },
  // Web & backend
  { name: "React", category: "Web and Backend", aliases: ["React.js", "ReactJS"] },
  { name: "Next.js", category: "Web and Backend", aliases: ["NextJS"] },
  { name: "Node.js", category: "Web and Backend", aliases: ["NodeJS", "Node"], caseSensitive: false },
  { name: "FastAPI", category: "Web and Backend" },
  { name: "Django", category: "Web and Backend" },
  { name: "Flask", category: "Web and Backend" },
  { name: "Spring Boot", category: "Web and Backend" },
  { name: ".NET", category: "Web and Backend", aliases: ["dotnet"], caseSensitive: true },
  { name: "GraphQL", category: "Web and Backend" },
  { name: "REST APIs", category: "Web and Backend", aliases: ["REST API", "RESTful", "REST"] },
  { name: "Webhooks", category: "Web and Backend", aliases: ["webhook"] },
  { name: "Tailwind CSS", category: "Web and Backend", aliases: ["Tailwind"] },
  { name: "Microservices", category: "Web and Backend", aliases: ["microservice"] },
  // Databases & data
  { name: "PostgreSQL", category: "Databases", aliases: ["Postgres"] },
  { name: "MySQL", category: "Databases" },
  { name: "MongoDB", category: "Databases" },
  { name: "SQLite", category: "Databases" },
  { name: "Supabase", category: "Databases" },
  { name: "Firebase", category: "Databases" },
  { name: "Redis", category: "Databases" },
  { name: "Elasticsearch", category: "Databases" },
  { name: "Vector Databases", category: "Databases", aliases: ["vector database", "vector db", "vector store", "pgvector", "Pinecone", "Weaviate", "FAISS", "Milvus", "Chroma"] },
  { name: "Pandas", category: "Data and Tools" },
  { name: "NumPy", category: "Data and Tools" },
  { name: "Spark", category: "Data and Tools", aliases: ["PySpark", "Apache Spark"] },
  { name: "Kafka", category: "Data and Tools" },
  { name: "Airflow", category: "Data and Tools" },
  { name: "Snowflake", category: "Data and Tools" },
  { name: "BigQuery", category: "Data and Tools" },
  { name: "ETL", category: "Data and Tools", aliases: ["data pipelines", "data pipeline"] },
  { name: "Big Data", category: "Data and Tools" },
  // AI & ML
  { name: "LLM integration", category: "AI and ML", aliases: ["LLM", "LLMs", "large language model", "large language models"] },
  { name: "Generative AI", category: "AI and ML", aliases: ["GenAI", "generative artificial intelligence"] },
  { name: "AI agents", category: "AI and ML", aliases: ["AI agent", "agentic", "multi-agent", "agent frameworks"] },
  { name: "RAG", category: "AI and ML", aliases: ["retrieval augmented generation", "retrieval-augmented generation"], caseSensitive: true },
  { name: "Prompt engineering", category: "AI and ML", aliases: ["prompting"] },
  { name: "Fine-tuning", category: "AI and ML", aliases: ["fine tuning", "finetuning", "LoRA", "QLoRA", "PEFT"] },
  { name: "Embeddings", category: "AI and ML", aliases: ["embedding"] },
  { name: "LangChain", category: "AI and ML", aliases: ["LangGraph"] },
  { name: "LlamaIndex", category: "AI and ML" },
  { name: "OpenAI API", category: "AI and ML", aliases: ["OpenAI", "GPT-4", "ChatGPT"] },
  { name: "Claude API", category: "AI and ML", aliases: ["Anthropic"] },
  { name: "Hugging Face", category: "AI and ML", aliases: ["HuggingFace", "Transformers"] },
  { name: "PyTorch", category: "AI and ML" },
  { name: "TensorFlow", category: "AI and ML" },
  { name: "Scikit-learn", category: "AI and ML", aliases: ["scikit learn", "sklearn"] },
  { name: "Spark ML", category: "AI and ML", aliases: ["MLlib"] },
  { name: "Machine learning", category: "AI and ML", aliases: ["ML"], caseSensitive: false },
  { name: "Deep learning", category: "AI and ML" },
  { name: "NLP", category: "AI and ML", aliases: ["natural language processing"], caseSensitive: true },
  { name: "Computer vision", category: "AI and ML", aliases: ["OpenCV"] },
  { name: "MLOps", category: "AI and ML" },
  { name: "Speech and voice AI", category: "AI and ML", aliases: ["speech-to-text", "text-to-speech", "voice AI", "ElevenLabs", "Whisper"] },
  { name: "Evaluation", category: "AI and ML", aliases: ["LLM evaluation", "evals"] },
  // Cloud & tooling
  { name: "AWS", category: "Cloud and DevOps", caseSensitive: true },
  { name: "Azure", category: "Cloud and DevOps" },
  { name: "GCP", category: "Cloud and DevOps", aliases: ["Google Cloud"], caseSensitive: true },
  { name: "Oracle Cloud", category: "Cloud and DevOps", aliases: ["OCI"] },
  { name: "Docker", category: "Cloud and DevOps" },
  { name: "Kubernetes", category: "Cloud and DevOps", aliases: ["k8s"] },
  { name: "Terraform", category: "Cloud and DevOps" },
  { name: "CI/CD", category: "Cloud and DevOps", aliases: ["continuous integration"] },
  { name: "Linux", category: "Cloud and DevOps" },
  { name: "Git", category: "Data and Tools", caseSensitive: true },
  { name: "GitHub", category: "Data and Tools" },
  { name: "n8n", category: "Data and Tools" },
  { name: "Voiceflow", category: "Data and Tools" },
  { name: "Twilio", category: "Data and Tools" },
  // Enterprise
  { name: "NetSuite", category: "Enterprise Systems", aliases: ["Oracle NetSuite"] },
  { name: "ERP", category: "Enterprise Systems", caseSensitive: true },
  { name: "Salesforce", category: "Enterprise Systems" },
  { name: "SAP", category: "Enterprise Systems", caseSensitive: true },
  { name: "Workflow automation", category: "Enterprise Systems", aliases: ["workflow automations", "business process automation"] },
  { name: "System design", category: "Practices", aliases: ["distributed systems"] },
  { name: "Agile", category: "Practices", aliases: ["scrum"] },
];

const compiled = SKILLS.map((def) => {
  const terms = [def.name, ...(def.aliases ?? [])];
  const parts = terms.map((t) => {
    const e = escapeRegExp(t);
    // word boundary that also works for terms ending in + or #
    return `(?<![A-Za-z0-9_])${e}(?![A-Za-z0-9_])`;
  });
  return { def, re: new RegExp(parts.join("|"), def.caseSensitive ? "" : "i") };
});

const byName = new Map(SKILLS.map((s) => [s.name.toLowerCase(), s]));

export function skillDef(name: string): SkillDef | undefined {
  return byName.get(name.toLowerCase());
}

export function canonicalSkill(label: string): string | null {
  const t = label.trim();
  if (!t) return null;
  const hits = extractSkills(t);
  return hits.length === 1 ? hits[0] : (byName.get(t.toLowerCase())?.name ?? null);
}

/** Canonical skills mentioned in `text` (taxonomy-based, deterministic). */
export function extractSkills(text: string): string[] {
  const out: string[] = [];
  for (const { def, re } of compiled) if (re.test(text)) out.push(def.name);
  return out;
}
