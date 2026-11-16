import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function proxyRequest(request: NextRequest, path: string) {
  const token = request.cookies.get('mm_access_token')?.value;
  const search = request.nextUrl.search;

  const reqContentType = request.headers.get('content-type') || '';
  const isJsonBody = reqContentType.includes('application/json') || reqContentType === '';

  const headers: Record<string, string> = {};
  // Reenviar el content-type original (clave para multipart con boundary).
  if (reqContentType) headers['Content-Type'] = reqContentType;
  else headers['Content-Type'] = 'application/json';
  // Authorization: el header entrante (impersonación) tiene prioridad; si no, la cookie.
  const incomingAuth = request.headers.get('authorization');
  if (incomingAuth) headers.Authorization = incomingAuth;
  else if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = { method: request.method, headers };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (isJsonBody) {
      init.body = await request.text();
    } else {
      // Subidas de archivos (multipart) u otros binarios: reenviar bytes crudos.
      init.body = Buffer.from(await request.arrayBuffer());
    }
  }

  const res = await fetch(`${API_URL}${path}${search}`, init);
  const resContentType = res.headers.get('content-type') || '';

  // Descargas/binarios (xlsx, csv, pdf…): pasar el cuerpo tal cual con sus headers.
  const isJsonResponse = resContentType.includes('application/json');
  if (!isJsonResponse && resContentType) {
    const buf = await res.arrayBuffer();
    const out = new NextResponse(buf, { status: res.status });
    out.headers.set('content-type', resContentType);
    const cd = res.headers.get('content-disposition');
    if (cd) out.headers.set('content-disposition', cd);
    return out;
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return NextResponse.json(body, { status: res.status });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(request, `/${path.join('/')}`);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(request, `/${path.join('/')}`);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(request, `/${path.join('/')}`);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(request, `/${path.join('/')}`);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(request, `/${path.join('/')}`);
}
