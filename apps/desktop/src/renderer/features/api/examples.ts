/** Illustrative snippets only; no endpoint, key or model ID denotes a connected service. */
export const exampleLanguages = ['Python', 'cURL', 'JavaScript', 'OpenAI SDK'] as const;
export type ExampleLanguage = (typeof exampleLanguages)[number];

export const apiExamples: Readonly<Record<ExampleLanguage, string>> = {
  Python: `from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8000/v1",
    api_key="YOUR_API_KEY",
)

response = client.chat.completions.create(
    model="YOUR_MODEL_ID",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)`,
  cURL: `curl http://127.0.0.1:8000/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "YOUR_MODEL_ID",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`,
  JavaScript: `const response = await fetch(
  "http://127.0.0.1:8000/v1/chat/completions",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer YOUR_API_KEY",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "YOUR_MODEL_ID",
      messages: [{ role: "user", content: "Hello" }],
    }),
  },
);
console.log(await response.json());`,
  'OpenAI SDK': `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:8000/v1",
  apiKey: "YOUR_API_KEY",
});

const response = await client.chat.completions.create({
  model: "YOUR_MODEL_ID",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(response.choices[0].message.content);`,
};
