import { NextResponse } from 'next/server';

/**
 * This endpoint is deprecated. Use /api/chat/group-call/pending instead
 * Keeping stub to prevent 405 errors from old code
 */
export async function GET(req) {
  return NextResponse.json(
    { 
      message: 'This endpoint is deprecated. Please use /api/chat/group-call/pending',
      redirectTo: '/api/chat/group-call/pending',
      notifications: []
    },
    { status: 410 } // Gone
  );
}
