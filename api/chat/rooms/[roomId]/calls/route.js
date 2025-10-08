import { NextResponse } from 'next/server';

/**
 * This endpoint is deprecated. Use /api/chat/group-call/initiate instead
 * Keeping stub to prevent 405 errors from old code
 */
export async function POST(req, { params }) {
  return NextResponse.json(
    { 
      message: 'This endpoint is deprecated. Please use /api/chat/group-call/initiate',
      redirectTo: '/api/chat/group-call/initiate'
    },
    { status: 410 } // Gone
  );
}

export async function GET(req, { params }) {
  return NextResponse.json(
    { 
      message: 'This endpoint is deprecated. Please use /api/chat/group-call endpoints',
    },
    { status: 410 } // Gone
  );
}
