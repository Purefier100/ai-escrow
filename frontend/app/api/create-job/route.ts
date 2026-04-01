export async function POST(req: Request) {
    const data = await req.json();

    console.log("Job created:", data);

    return Response.json({ success: true });
}