export async function POST(req: Request) {
    const { description, submission } = await req.json();

    // simulate backend AI
    let result = submission.length > 10 ? "PASS" : "FAIL";

    return Response.json({ result });
}