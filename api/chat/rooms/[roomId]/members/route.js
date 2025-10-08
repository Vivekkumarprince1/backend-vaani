import { NextResponse } from 'next/server';

// Placeholder handler for room members - returns 404 by default
export async function GET(req, { params }) {
	return NextResponse.json({ message: 'Not implemented' }, { status: 404 });
}

