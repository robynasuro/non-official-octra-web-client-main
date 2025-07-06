import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { method, endpoint, rpcUrl, payload } = await request.json();
    console.log('Proxy Request Payload:', payload); // Tambah log buat cek payload

    if (!rpcUrl || !endpoint) {
      return NextResponse.json({ error: 'Missing rpcUrl or endpoint' }, { status: 400 });
    }

    const url = `${rpcUrl}${endpoint}`;
    console.log('Proxy URL:', url);

    const response = await fetch(url, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(10000),
    });

    console.log('Proxy Response Status:', response.status);
    if (!response.ok) {
      const errorText = await response.text();
      let errorJson;
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        errorJson = { error: errorText || 'RPC Error' };
      }
      console.log('Proxy Error:', errorJson);
      return NextResponse.json(errorJson, { status: response.status });
    }

    const data = await response.json();
    console.log('Proxy Data:', data);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API Proxy Error:', error.message);
    return NextResponse.json(
      { error: 'An unexpected error occurred in the proxy.', details: error.message },
      { status: 500 }
    );
  }
}