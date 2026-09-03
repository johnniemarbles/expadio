import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const maxDuration = 60; // Allow more time for vision processing

export async function POST(req: Request) {
  try {
    // Initialize the OpenAI client inside the handler to prevent Next.js build-time 
    // evaluation errors when OPENAI_API_KEY is not present in the environment (e.g. CI)
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured on server' }, { status: 500 });
    }
    const openai = new OpenAI();
    
    const { image, prompt } = await req.json();

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const systemPrompt = `You are an expert UI/UX designer. Your task is to analyze the provided UI screenshot and extract a comprehensive design theme.
You must output ONLY a valid JSON object with the following schema:
{
  "name": "string (A catchy 2-3 word name for this theme)",
  "primary": "string (hex color for primary buttons and accents)",
  "background": "string (hex color for the main page background)",
  "text": "string (hex color for the main body text)",
  "surface": "string (hex color for cards, panels, or secondary backgrounds)",
  "borderRadius": "string (e.g. '4px', '8px', '12px', '9999px' for pills)"
}
Ensure high contrast between background and text. Ensure primary stands out against both background and surface. Do not include markdown codeblocks (\`\`\`json), just raw JSON.`;

    const userContent = prompt 
      ? `Additionally, the user provided this instruction for the theme extraction: "${prompt}"` 
      : 'Extract the theme from this screenshot.';

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: [
            { type: "text", text: userContent },
            {
              type: "image_url",
              image_url: {
                url: image,
                detail: "low" // Keep latency and token usage low
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" }, // Guarantee JSON output
      max_tokens: 300,
    });

    const resultText = response.choices[0]?.message?.content || '{}';
    const theme = JSON.parse(resultText);

    return NextResponse.json(theme);
  } catch (error: any) {
    console.error('Theme extraction error:', error);
    return NextResponse.json({ error: error.message || 'Failed to extract theme' }, { status: 500 });
  }
}
