import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const maxDuration = 300; 

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { transcript, choiceCount, questionCount } = body;

    if (!transcript) {
      return NextResponse.json({ error: '대본 데이터가 없습니다.' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    const optionsCount = choiceCount === 5 ? 5 : 4;
    const qCount = questionCount ? parseInt(questionCount) : 5;

    const systemPrompt = `You are an expert educator. Your task is to read the provided video transcript and generate exactly ${qCount} multiple-choice questions based on its key concepts.
Each question MUST have exactly ${optionsCount} choices.
The output MUST be a valid JSON object with a single key "quizzes" containing an array of exactly ${qCount} objects.
Each object must follow this format:
{
  "question": "The question text in Korean",
  "choices": ["Choice 1", "Choice 2", "Choice 3", "Choice 4"${optionsCount === 5 ? ', "Choice 5"' : ''}],
  "answer": "The exact string of the correct choice from the choices array",
  "explanation": "A brief explanation in Korean of why this is the correct answer"
}
Do not use markdown wrappers like \`\`\`json. Return only the raw JSON string.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Transcript:\n\n${transcript}` }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("API 응답이 비어있습니다.");
    }

    const parsedContent = JSON.parse(content);
    return NextResponse.json(parsedContent);

  } catch (error: any) {
    console.error('Quiz Generation Error:', error);
    return NextResponse.json(
      { error: error.message || '시험지 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
